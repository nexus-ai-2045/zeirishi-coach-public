import { createHash } from 'node:crypto';
import type { SchemaDatabase, TransactionDatabase } from './database';
import { parseExamSubjects, validateConfidenceReport, type ConfidenceReport, type SubjectId, type SubjectPack } from '../domain/onboarding';
import { StudyError } from '../domain/types';
import { initializeOwnerAccess, assertOwnerActive } from './owner-access';

export type ConfidenceProfile = { revision: number; updatedAt: string | null; reports: ConfidenceReport[]; examSubjects: SubjectId[] | null };
type ProfileRow = { revision: number; updated_at: string | null; reports: ConfidenceReport[]; exam_subjects: SubjectId[] | null };
const empty = (): ConfidenceProfile => ({ revision: 0, updatedAt: null, reports: [], examSubjects: null });
const checkId = (value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new StudyError('INVALID_ID');
};

/** Development schema bootstrap on the shared study database. No HTTP/auth bypass is exposed. */
export async function createConfidenceService(db: SchemaDatabase, catalog: readonly SubjectPack[], now = () => new Date()) {
  await initializeOwnerAccess(db);
  await db.exec(`CREATE TABLE IF NOT EXISTS confidence_profiles (
    owner_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT, reports JSONB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS confidence_requests (
    owner_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, response JSONB NOT NULL,
    PRIMARY KEY(owner_id, request_id)
  );
  ALTER TABLE confidence_profiles ADD COLUMN IF NOT EXISTS exam_subjects JSONB;`);
  return createConfidenceServiceOnPreparedDatabase(db, catalog, now);
}

/** No schema writes; callers must prepare schema and authorization separately. */
export function createConfidenceServiceOnPreparedDatabase(db: TransactionDatabase, catalog: readonly SubjectPack[], now = () => new Date()) {
  return {
    async get(ownerId: string): Promise<ConfidenceProfile> {
      checkId(ownerId);
      return db.transaction(async tx => {
        await assertOwnerActive(tx, ownerId);
        const result = await tx.query<ProfileRow>('SELECT * FROM confidence_profiles WHERE owner_id=$1', [ownerId]);
        const row = result.rows[0];
        return row ? { revision: row.revision, updatedAt: row.updated_at, reports: row.reports, examSubjects: row.exam_subjects } : empty();
      });
    },
    async save(ownerId: string, input: { requestId: string; revision: number; reports: unknown[]; examSubjects?: unknown }): Promise<ConfidenceProfile> {
      checkId(ownerId); checkId(input?.requestId);
      if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new StudyError('INVALID_REVISION');
      if (!Array.isArray(input.reports) || input.reports.length > 300) throw new StudyError('INVALID_REPORTS');
      const reports = input.reports.map(validateConfidenceReport);
      const keys = reports.map(x => `${x.subjectId}/${x.conceptId}`);
      if (new Set(keys).size !== keys.length) throw new StudyError('DUPLICATE_CONCEPT');
      reports.sort((a, b) => `${a.subjectId}/${a.conceptId}`.localeCompare(`${b.subjectId}/${b.conceptId}`, 'en'));
      const hasExamSubjects = Object.hasOwn(input, 'examSubjects');
      const examSubjects = hasExamSubjects ? parseExamSubjects(input.examSubjects) : null;
      // Omission keeps the pre-migration fingerprint; explicit null/[] are distinct mutations.
      const fingerprint = createHash('sha256').update(JSON.stringify({ revision: input.revision, reports,
        ...(hasExamSubjects ? { examSubjects } : {}),
      })).digest('hex');
      return db.transaction(async tx => {
        await assertOwnerActive(tx, ownerId);
        const prior = await tx.query<{ fingerprint: string; response: ConfidenceProfile }>(
          'SELECT fingerprint,response FROM confidence_requests WHERE owner_id=$1 AND request_id=$2', [ownerId, input.requestId]);
        if (prior.rows[0]) {
          if (prior.rows[0].fingerprint !== fingerprint) throw new StudyError('REQUEST_CONFLICT', 409);
          return { ...prior.rows[0].response, examSubjects: prior.rows[0].response.examSubjects ?? null };
        }
        for (const report of reports) {
          if (!catalog.some(pack => pack.active && pack.subjectId === report.subjectId && pack.concepts.some(
            concept => concept.conceptId === report.conceptId && concept.conceptVersion === report.conceptVersion))) {
            throw new StudyError('CONCEPT_VERSION_UNAVAILABLE', 409);
          }
        }
        await tx.query(`INSERT INTO confidence_profiles (owner_id,revision,updated_at,reports)
          VALUES ($1,0,NULL,'[]'::jsonb) ON CONFLICT DO NOTHING`, [ownerId]);
        const at = now();
        if (!Number.isFinite(at.getTime())) throw new StudyError('INVALID_CLOCK');
        const saved = await tx.query<ProfileRow>(
          `UPDATE confidence_profiles SET revision=revision+1,updated_at=$3,reports=$4::jsonb,
           exam_subjects=CASE WHEN $5::boolean THEN $6::jsonb ELSE exam_subjects END
           WHERE owner_id=$1 AND revision=$2 RETURNING *`,
          [ownerId, input.revision, at.toISOString(), JSON.stringify(reports), hasExamSubjects, JSON.stringify(examSubjects)]);
        if (!saved.rows[0]) throw new StudyError('REVISION_CONFLICT', 409);
        const row = saved.rows[0];
        const response = { revision: row.revision, updatedAt: row.updated_at, reports: row.reports, examSubjects: row.exam_subjects };
        await tx.query('INSERT INTO confidence_requests VALUES ($1,$2,$3,$4::jsonb)',
          [ownerId, input.requestId, fingerprint, JSON.stringify(response)]);
        return response;
      });
    },
  };
}
