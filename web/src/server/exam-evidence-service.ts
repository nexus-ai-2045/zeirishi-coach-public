import { createHash } from 'node:crypto';
import { evaluateExamReadiness, type ExamReadinessInput } from '../domain/exam-readiness';
import { strictIsoInstant } from '../domain/strict-iso-instant';
import { StudyError } from '../domain/types';
import type { SchemaDatabase, TransactionDatabase, QueryExecutor } from './database';
import { assertOwnerActive, initializeOwnerAccess } from './owner-access';
import { verifyExamEvidenceDocument, type ExamEvidenceDocument } from './exam-evidence-registry';
import { strictCanonicalJson } from './strict-canonical-json';

export type ExamEvidenceItem = { id: string; revision: number; updatedAt: string; document: ExamEvidenceDocument; withdrawn: boolean; reason: string | null };
export type ExamEvidenceSave = { requestId: string; revision: number; document: ExamEvidenceDocument };
export type ExamEvidenceWithdrawal = { requestId: string; id: string; revision: number; reason: string };
export type ExamEvidenceAssessment = Omit<ExamReadinessInput, 'records'>;
function invalid(): never { throw new StudyError('INVALID_EXAM_EVIDENCE'); }
function clock(now: () => Date) { const at = now(); if (!Number.isFinite(at.getTime())) throw new StudyError('INVALID_CLOCK', 500); return at.toISOString(); }
function envelope(value: unknown, keys: string[]) {
  const snapshot = JSON.parse(strictCanonicalJson(value, invalid)) as Record<string, unknown>;
  if (!snapshot || Array.isArray(snapshot) || Object.keys(snapshot).length !== keys.length || Object.keys(snapshot).some(key => !keys.includes(key))) invalid();
  if (typeof snapshot.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshot.requestId)) invalid();
  if (!Number.isSafeInteger(snapshot.revision) || (snapshot.revision as number) < 0 || (snapshot.revision as number) >= 2147483647) invalid();
  snapshot.requestId = snapshot.requestId.toLowerCase();
  return snapshot;
}
function identifier(id: unknown): asserts id is string { if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) invalid(); }
export async function initializeExamEvidenceSchema(db: Pick<SchemaDatabase, 'exec'>) {
  await initializeOwnerAccess(db);
  await db.exec(`CREATE TABLE IF NOT EXISTS exam_evidence_revisions (
    owner_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
    updated_at TEXT NOT NULL, document JSONB NOT NULL, withdrawn BOOLEAN NOT NULL, reason TEXT,
    PRIMARY KEY(owner_id,id,revision), CHECK ((withdrawn AND reason IS NOT NULL) OR (NOT withdrawn AND reason IS NULL))
  );
  CREATE TABLE IF NOT EXISTS exam_evidence_requests (
    owner_id TEXT NOT NULL, request_id TEXT NOT NULL, record_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
    PRIMARY KEY(owner_id,request_id)
  );`);
}
/** Audit/export must read every revision. Caller holds the owner lock. */
export async function readExamEvidenceHistory(tx: QueryExecutor, owner: string): Promise<ExamEvidenceItem[]> {
  return (await tx.query<ExamEvidenceItem>(`SELECT id,revision,updated_at AS "updatedAt",document,withdrawn,reason
    FROM exam_evidence_revisions WHERE owner_id=$1 ORDER BY id,revision`, [owner])).rows;
}
async function latest(tx: QueryExecutor, owner: string, id: string) {
  return (await tx.query<ExamEvidenceItem>(`SELECT id,revision,updated_at AS "updatedAt",document,withdrawn,reason
    FROM exam_evidence_revisions WHERE owner_id=$1 AND id=$2 ORDER BY revision DESC LIMIT 1`, [owner, id])).rows[0];
}
function identity(document: ExamEvidenceDocument) {
  const r = document.record;
  return JSON.stringify([r.id, r.subjectId, r.examYear, r.examId, r.familyId, Date.parse(r.completedAt), r.kind]);
}
/** Read capability only; management methods must never be included in a learner HTTP service. */
export function createExamEvidenceReaderOnPreparedDatabase(db: TransactionDatabase, now = () => new Date()) {
  return {
    async list(owner: string) { return db.transaction(async tx => { await assertOwnerActive(tx, owner); return readExamEvidenceHistory(tx, owner); }); },
    async evaluate(owner: string, input: ExamEvidenceAssessment) {
      const current = clock(now), asOf = strictIsoInstant(input.asOf, invalid);
      if (asOf > Date.parse(current)) invalid();
      return db.transaction(async tx => {
        await assertOwnerActive(tx, owner);
        const history = await readExamEvidenceHistory(tx, owner);
        const visible = new Map<string, ExamEvidenceItem>();
        for (const item of history) if (Date.parse(item.updatedAt) <= asOf) visible.set(item.id, item);
        const items = [...visible.values()];
        // Withdrawal remains in chronological selection and exposure history. Never fall back
        // to an older high score, nor erase an encounter from novelty checks.
        const records = items.map(item => item.withdrawn ? { ...item.document.record,
          measurementQuality: { scoreVerified: false, timingVerified: false, coverageVerified: false } } : item.document.record);
        const result = evaluateExamReadiness({ ...input, records });
        if (items.some(item => item.withdrawn && result.selectedIds.includes(item.id))) result.holdReasons.push('evidence-withdrawn');
        return result;
      });
    },
  };
}
/** Trusted management capability only. Document integrity is not operator authentication or expert approval. */
export function createExamEvidenceServiceOnPreparedDatabase(db: TransactionDatabase, now = () => new Date()) {
  async function append(owner: string, requestId: string, revision: number, id: string, at: string,
    fingerprint: string, document: ExamEvidenceDocument | null, reason: string | null): Promise<ExamEvidenceItem> {
    return db.transaction(async tx => {
      await assertOwnerActive(tx, owner);
      const receipt = (await tx.query<{ fingerprint: string }>('SELECT fingerprint FROM exam_evidence_requests WHERE owner_id=$1 AND request_id=$2', [owner, requestId])).rows[0];
      const previous = await latest(tx, owner, id);
      if (receipt) { if (receipt.fingerprint !== fingerprint) throw new StudyError('REQUEST_CONFLICT', 409); if (!previous) invalid(); return previous; }
      if ((previous?.revision ?? 0) !== revision) throw new StudyError('EXAM_EVIDENCE_REVISION_CONFLICT', 409);
      if (!document && !previous) throw new StudyError('NOT_FOUND', 404);
      if (previous && Date.parse(at) < Date.parse(previous.updatedAt)) throw new StudyError('INVALID_CLOCK', 500);
      if (document && previous && identity(document) !== identity(previous.document)) throw new StudyError('EXAM_EVIDENCE_IDENTITY_IMMUTABLE', 409);
      if (previous?.withdrawn) throw new StudyError('EXAM_EVIDENCE_WITHDRAWN', 409);
      const item: ExamEvidenceItem = { id, revision: revision + 1, updatedAt: at, document: document ?? previous!.document, withdrawn: document === null, reason };
      await tx.query(`INSERT INTO exam_evidence_revisions(owner_id,id,revision,updated_at,document,withdrawn,reason)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`, [owner, id, item.revision, at, JSON.stringify(item.document), item.withdrawn, reason]);
      await tx.query('INSERT INTO exam_evidence_requests(owner_id,request_id,record_id,fingerprint) VALUES($1,$2,$3,$4)', [owner, requestId, id, fingerprint]);
      return item;
    });
  }
  const fingerprint = (input: unknown) => createHash('sha256').update(strictCanonicalJson(input, invalid)).digest('hex');
  return {
    ...createExamEvidenceReaderOnPreparedDatabase(db, now),
    async save(owner: string, raw: ExamEvidenceSave) {
      const at = clock(now), input = envelope(raw, ['requestId', 'revision', 'document']);
      const document = verifyExamEvidenceDocument(input.document, { expectedOwnerId: owner, asOf: at });
      return append(owner, input.requestId as string, input.revision as number, document.record.id, at, fingerprint(input), document, null);
    },
    async withdraw(owner: string, raw: ExamEvidenceWithdrawal) {
      const at = clock(now), input = envelope(raw, ['requestId', 'id', 'revision', 'reason']);
      identifier(input.id);
      if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 2000) invalid();
      return append(owner, input.requestId as string, input.revision as number, input.id, at, fingerprint(input), null, input.reason);
    },
  };
}
export async function createExamEvidenceService(db: SchemaDatabase, now = () => new Date()) {
  await initializeExamEvidenceSchema(db);
  return createExamEvidenceServiceOnPreparedDatabase(db, now);
}
