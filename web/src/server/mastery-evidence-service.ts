import { createHash } from 'node:crypto';
import { assessMastery, type MasteryAssessment, type MasteryMeasurement } from '../domain/mastery-assessment';
import { SUBJECTS, type SubjectId } from '../domain/onboarding';
import { strictIsoInstant } from '../domain/strict-iso-instant';
import { StudyError } from '../domain/types';
import type { SchemaDatabase, TransactionDatabase, QueryExecutor } from './database';
import { assertOwnerActive, initializeOwnerAccess } from './owner-access';
import { strictCanonicalJson } from './strict-canonical-json';

export type MasteryEvidenceScope = { subjectId: SubjectId; conceptId: string; conceptVersion: string; criterionVersion: string };
export type MasteryEvidenceRecord = { kind: 'measurement'; measurement: MasteryMeasurement }
  | ({ kind: 'criterion'; prepared: boolean; disclosureHistoryComplete: boolean } & MasteryEvidenceScope)
  | { kind: 'disclosure'; subjectId: SubjectId; conceptId: string; conceptVersion: string; occurredAt: string }
  | { kind: 'disclosure_invalidation'; targetId: string; subjectId: SubjectId; conceptId: string; conceptVersion: string; occurredAt: string; reason: string };
/** Management-only declarations: the caller authenticates the operator and verifies
 * owner, source, scoring/timer binding, reviewed criteria and disclosure completeness.
 * A string naming a verifier is an audit reference, not proof of authority.
 */
export type MasteryEvidenceDocument = {
  schemaVersion: 'mastery-evidence-v1'; ownerId: string; id: string; record: MasteryEvidenceRecord;
  verification: { verifiedBy: string; verifiedAt: string; sourceReference: string };
};
export type MasteryEvidenceItem = { id: string; revision: number; sequence: string; updatedAt: string;
  document: MasteryEvidenceDocument; withdrawn: boolean; reason: string | null };
export type MasteryEvidenceSave = { requestId: string; revision: number; document: MasteryEvidenceDocument };
export type MasteryEvidenceWithdrawal = { requestId: string; id: string; revision: number; reason: string };
export type MasteryEvidenceAssessment = MasteryEvidenceScope & { asOf: string };
export const MASTERY_EVIDENCE_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS mastery_evidence_revisions (
  owner_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
  sequence BIGSERIAL UNIQUE NOT NULL, updated_at TEXT NOT NULL, document JSONB NOT NULL,
  withdrawn BOOLEAN NOT NULL, reason TEXT, PRIMARY KEY(owner_id,id,revision),
  CHECK ((withdrawn AND reason IS NOT NULL) OR (NOT withdrawn AND reason IS NULL))
);
CREATE TABLE IF NOT EXISTS mastery_evidence_requests (
  owner_id TEXT NOT NULL, request_id TEXT NOT NULL, record_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
  PRIMARY KEY(owner_id,request_id)
);`;
export async function initializeMasteryEvidenceSchema(db: Pick<SchemaDatabase, 'exec'>) {
  await initializeOwnerAccess(db); await db.exec(MASTERY_EVIDENCE_SCHEMA_SQL);
}
const columns = 'id,revision,sequence::text,updated_at AS "updatedAt",document,withdrawn,reason';
/** Export/audit gets all revisions, in append order, while holding the shared owner lock. */
export async function readMasteryEvidenceHistory(tx: QueryExecutor, owner: string): Promise<MasteryEvidenceItem[]> {
  return (await tx.query<MasteryEvidenceItem>(`SELECT ${columns} FROM mastery_evidence_revisions WHERE owner_id=$1 ORDER BY sequence`, [owner])).rows;
}
function invalid(): never { throw new StudyError('INVALID_MASTERY_EVIDENCE'); }
function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) invalid();
}
function uuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)) invalid();
}
function subject(value: unknown): asserts value is SubjectId {
  if (!SUBJECTS.some(item => item.id === value)) invalid();
}
function keys(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  if (Object.keys(value).length !== expected.length || Object.keys(value).some(key => !expected.includes(key))) invalid();
}
function text(value: unknown) { if (typeof value !== 'string' || !value.trim() || value.length > 2000) invalid(); }
function canonical(value: unknown) {
  const result = strictCanonicalJson(value, invalid);
  if (Buffer.byteLength(result, 'utf8') > 262144) invalid();
  return result;
}
function snapshot(value: unknown): unknown { return JSON.parse(canonical(value)); }
function clock(now: () => Date) {
  const time = now(); if (!Number.isFinite(time.getTime())) throw new StudyError('INVALID_CLOCK', 500);
  return time.toISOString();
}
function scope(value: MasteryEvidenceScope) {
  subject(value.subjectId); identifier(value.conceptId); identifier(value.conceptVersion); identifier(value.criterionVersion);
}
const measurementKeys = ['measurementId','subjectId','conceptId','conceptVersion','criterionVersion','caseId','caseVersion','familyId','occurredAt',
  'evidenceKind','outcome','score','maxScore','targetScore','elapsedMinutes','timeLimitMinutes','hintsUsed','aiAnswerViewed','sourceKind','reviewStatus',
  'scoringAuthority','measurementQuality','mixedConceptIds','confidence','confidenceFixedBeforeResult','invalidated'];
function verify(raw: unknown, owner: string, at: string): MasteryEvidenceDocument {
  const document = snapshot(raw) as MasteryEvidenceDocument;
  keys(document, ['schemaVersion','ownerId','id','record','verification']);
  uuid(owner); uuid(document.ownerId); identifier(document.id);
  if (document.schemaVersion !== 'mastery-evidence-v1' || document.ownerId !== owner) invalid();
  keys(document.verification, ['verifiedBy','verifiedAt','sourceReference']);
  identifier(document.verification.verifiedBy); text(document.verification.sourceReference);
  const verifiedAt = strictIsoInstant(document.verification.verifiedAt, invalid);
  if (verifiedAt > Date.parse(at)) invalid();
  const record = document.record;
  if (!record || typeof record !== 'object') invalid();
  if (record.kind === 'measurement') {
    keys(record, ['kind','measurement']); keys(record.measurement, measurementKeys);
    const measurement = record.measurement;
    scope(measurement);
    if (measurement.measurementId !== document.id || strictIsoInstant(measurement.occurredAt, invalid) > verifiedAt
      || !Array.isArray(measurement.mixedConceptIds) || measurement.mixedConceptIds.length > 300
      || new Set(measurement.mixedConceptIds).size !== measurement.mixedConceptIds.length) invalid();
    try { assessMastery({ subjectId: measurement.subjectId, conceptId: measurement.conceptId, conceptVersion: measurement.conceptVersion,
      criterion: { prepared: true, version: measurement.criterionVersion }, disclosures: [], measurements: [measurement], asOf: at }); }
    catch { invalid(); }
  } else if (record.kind === 'criterion') {
    keys(record, ['kind','subjectId','conceptId','conceptVersion','criterionVersion','prepared','disclosureHistoryComplete']);
    scope(record);
    if (typeof record.prepared !== 'boolean' || typeof record.disclosureHistoryComplete !== 'boolean') invalid();
  } else if (record.kind === 'disclosure') {
    keys(record, ['kind','subjectId','conceptId','conceptVersion','occurredAt']);
    subject(record.subjectId); identifier(record.conceptId); identifier(record.conceptVersion);
    if (strictIsoInstant(record.occurredAt, invalid) > verifiedAt) invalid();
  } else if (record.kind === 'disclosure_invalidation') {
    keys(record, ['kind','targetId','subjectId','conceptId','conceptVersion','occurredAt','reason']);
    identifier(record.targetId); subject(record.subjectId); identifier(record.conceptId); identifier(record.conceptVersion);
    if (strictIsoInstant(record.occurredAt, invalid) > verifiedAt) invalid(); text(record.reason);
  } else invalid();
  return document;
}
function identity(document: MasteryEvidenceDocument) {
  const r = document.record;
  const value = r.kind === 'measurement' ? [r.kind, r.measurement.subjectId, r.measurement.conceptId, r.measurement.conceptVersion,
    r.measurement.criterionVersion, r.measurement.measurementId, r.measurement.caseId, r.measurement.caseVersion, r.measurement.familyId,
    Date.parse(r.measurement.occurredAt), r.measurement.evidenceKind]
    : r.kind === 'criterion' ? [r.kind, r.subjectId, r.conceptId, r.conceptVersion, r.criterionVersion]
    : r.kind === 'disclosure' ? [r.kind, r.subjectId, r.conceptId, r.conceptVersion, Date.parse(r.occurredAt)]
      : [r.kind, r.targetId, r.subjectId, r.conceptId, r.conceptVersion, Date.parse(r.occurredAt)];
  return JSON.stringify(value);
}
function current(history: MasteryEvidenceItem[], asOf: string) {
  const latest = new Map<string, MasteryEvidenceItem>();
  const firstSequence = new Map<string, string>();
  for (const item of history) if (Date.parse(item.updatedAt) <= Date.parse(asOf)) {
    firstSequence.set(item.id, firstSequence.get(item.id) ?? item.sequence);
    latest.set(item.id, item);
  }
  return [...latest.values()].sort((a, b) => {
    const aSequence = firstSequence.get(a.id)!; const bSequence = firstSequence.get(b.id)!;
    return BigInt(aSequence) < BigInt(bSequence) ? -1 : BigInt(aSequence) > BigInt(bSequence) ? 1 : 0;
  });
}
function evaluate(items: MasteryEvidenceItem[], query: MasteryEvidenceAssessment): MasteryAssessment {
  const criteria = items.filter(item => item.document.record.kind === 'criterion' && item.document.record.subjectId === query.subjectId
    && item.document.record.conceptId === query.conceptId);
  // Select the latest initially registered criterion, including withdrawn
  // criteria, so a withdrawal cannot fall back to an older version.
  const latest = criteria.at(-1);
  const record = latest?.document.record;
  const selected = record?.kind === 'criterion' && record.conceptVersion === query.conceptVersion && record.criterionVersion === query.criterionVersion;
  // Never choose an old successful scope after the current criterion is withdrawn or ambiguous.
  const unambiguous = criteria.filter(item => !item.withdrawn).length === 1;
  const prepared = Boolean(selected && unambiguous && latest && !latest.withdrawn && record.kind === 'criterion'
    && record.prepared && record.disclosureHistoryComplete);
  const measurements: MasteryMeasurement[] = [];
  const disclosures: string[] = [];
  const invalidatedDisclosures = new Set<string>();
  for (const item of items) {
    const r = item.document.record;
    if (r.kind === 'measurement' && r.measurement.subjectId === query.subjectId && r.measurement.conceptId === query.conceptId
      && r.measurement.conceptVersion === query.conceptVersion && r.measurement.criterionVersion === query.criterionVersion) {
      measurements.push(item.withdrawn ? { ...r.measurement, invalidated: true } : r.measurement);
    }
    // Ordinary withdrawal or criterion rollover never erases exposure. Only a
    // separately verified false-record invalidation excludes the referenced encounter.
    if (r.kind === 'disclosure_invalidation' && !item.withdrawn) invalidatedDisclosures.add(r.targetId);
  }
  for (const item of items) {
    const r = item.document.record;
    if (r.kind === 'disclosure' && !invalidatedDisclosures.has(item.document.id) && r.subjectId === query.subjectId && r.conceptId === query.conceptId) disclosures.push(r.occurredAt);
  }
  const result = assessMastery({ ...query, criterion: { prepared, version: selected ? query.criterionVersion : null }, measurements, disclosures });
  if (!prepared) result.reasons.push('現在の基準・教材準備・概念全体の開示履歴の確認が揃っていません。');
  return result;
}
/** Learner capability: readonly assessments; complete documents are for owner export/audit only. */
export function createMasteryEvidenceReaderOnPreparedDatabase(db: TransactionDatabase, now = () => new Date()) {
  function asOf(value?: string) { const at = clock(now); const requested = value ?? at;
    if (strictIsoInstant(requested, invalid) > Date.parse(at)) invalid(); return new Date(requested).toISOString(); }
  return {
    async list(owner: string) { return db.transaction(async tx => { await assertOwnerActive(tx, owner); return readMasteryEvidenceHistory(tx, owner); }); },
    async evaluate(owner: string, query: MasteryEvidenceAssessment) {
      const input = snapshot(query) as MasteryEvidenceAssessment;
      keys(input, ['subjectId','conceptId','conceptVersion','criterionVersion','asOf']); scope(input); input.asOf = asOf(input.asOf);
      return db.transaction(async tx => { await assertOwnerActive(tx, owner); return evaluate(current(await readMasteryEvidenceHistory(tx, owner), input.asOf), input); });
    },
    async evaluateSubject(owner: string, subjectId: SubjectId, requestedAsOf?: string): Promise<MasteryAssessment[]> {
      subject(subjectId); const at = asOf(requestedAsOf);
      return db.transaction(async tx => {
        await assertOwnerActive(tx, owner);
        const items = current(await readMasteryEvidenceHistory(tx, owner), at);
        const concepts = new Map<string, MasteryEvidenceScope>();
        for (const item of items) {
          const r = item.document.record;
          if (r.kind === 'criterion' && r.subjectId === subjectId) concepts.set(r.conceptId, r);
        }
        const registeredCriteria = new Set(concepts.keys());
        for (const item of items) {
          const r = item.document.record;
          if (r.kind === 'measurement' && r.measurement.subjectId === subjectId && !registeredCriteria.has(r.measurement.conceptId)) {
            concepts.set(r.measurement.conceptId, { subjectId, conceptId: r.measurement.conceptId,
              conceptVersion: r.measurement.conceptVersion, criterionVersion: r.measurement.criterionVersion });
          }
        }
        return [...concepts.values()].sort((a, b) => a.conceptId.localeCompare(b.conceptId))
          .map(value => evaluate(items, { subjectId: value.subjectId, conceptId: value.conceptId, conceptVersion: value.conceptVersion,
            criterionVersion: value.criterionVersion, asOf: at }));
      });
    },
  };
}
/** Private management capability. Never expose this factory through a learner POST or flag. */
export function createMasteryEvidenceServiceOnPreparedDatabase(db: TransactionDatabase, now = () => new Date()) {
  function envelope(raw: unknown, names: string[]) {
    const input = snapshot(raw) as Record<string, unknown>; keys(input, names); uuid(input.requestId);
    if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0 || (input.revision as number) >= 2147483647) invalid();
    return input;
  }
  async function append(owner: string, requestId: string, revision: number, id: string, at: string,
    fingerprint: string, document: MasteryEvidenceDocument | null, reason: string | null): Promise<MasteryEvidenceItem> {
    return db.transaction(async tx => {
      await assertOwnerActive(tx, owner);
      const receipt = (await tx.query<{ fingerprint: string }>('SELECT fingerprint FROM mastery_evidence_requests WHERE owner_id=$1 AND request_id=$2', [owner, requestId])).rows[0];
      const previous = (await tx.query<MasteryEvidenceItem>(`SELECT ${columns} FROM mastery_evidence_revisions WHERE owner_id=$1 AND id=$2 ORDER BY revision DESC LIMIT 1`, [owner, id])).rows[0];
      if (receipt) { if (receipt.fingerprint !== fingerprint) throw new StudyError('REQUEST_CONFLICT', 409); if (!previous) invalid(); return previous; }
      if ((previous?.revision ?? 0) !== revision) throw new StudyError('MASTERY_EVIDENCE_REVISION_CONFLICT', 409);
      if (!document && !previous) throw new StudyError('NOT_FOUND', 404);
      if (previous?.withdrawn) throw new StudyError('MASTERY_EVIDENCE_WITHDRAWN', 409);
      if (document && previous && identity(document) !== identity(previous.document)) throw new StudyError('MASTERY_EVIDENCE_IDENTITY_IMMUTABLE', 409);
      if (document?.record.kind === 'disclosure_invalidation') {
        const target = (await tx.query<{ document: MasteryEvidenceDocument }>(
          'SELECT document FROM mastery_evidence_revisions WHERE owner_id=$1 AND id=$2 ORDER BY revision DESC LIMIT 1',
          [owner, document.record.targetId])).rows[0]?.document;
        if (!target || target.ownerId !== owner || target.record.kind !== 'disclosure'
          || target.record.subjectId !== document.record.subjectId || target.record.conceptId !== document.record.conceptId
          || target.record.conceptVersion !== document.record.conceptVersion || Date.parse(target.record.occurredAt) !== Date.parse(document.record.occurredAt)) {
          throw new StudyError('INVALID_MASTERY_EVIDENCE');
        }
      }
      const last = (await tx.query<{ updated_at: string }>('SELECT updated_at FROM mastery_evidence_revisions WHERE owner_id=$1 ORDER BY sequence DESC LIMIT 1', [owner])).rows[0];
      if (last && Date.parse(at) < Date.parse(last.updated_at)) throw new StudyError('INVALID_CLOCK', 500);
      const rows = await tx.query<MasteryEvidenceItem>(`INSERT INTO mastery_evidence_revisions(owner_id,id,revision,updated_at,document,withdrawn,reason)
        VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING ${columns}`, [owner, id, revision + 1, at, JSON.stringify(document ?? previous!.document), document === null, reason]);
      await tx.query('INSERT INTO mastery_evidence_requests(owner_id,request_id,record_id,fingerprint) VALUES($1,$2,$3,$4)', [owner, requestId, id, fingerprint]);
      return rows.rows[0];
    });
  }
  return {
    ...createMasteryEvidenceReaderOnPreparedDatabase(db, now),
    async save(owner: string, raw: MasteryEvidenceSave) {
      const at = clock(now), input = envelope(raw, ['requestId','revision','document']);
      const document = verify(input.document, owner, at);
      return append(owner, input.requestId as string, input.revision as number, document.id, at,
        createHash('sha256').update(canonical(input)).digest('hex'), document, null);
    },
    async withdraw(owner: string, raw: MasteryEvidenceWithdrawal) {
      uuid(owner); const at = clock(now), input = envelope(raw, ['requestId','revision','id','reason']);
      identifier(input.id); text(input.reason);
      return append(owner, input.requestId as string, input.revision as number, input.id, at,
        createHash('sha256').update(canonical(input)).digest('hex'), null, input.reason as string);
    },
  };
}
export async function createMasteryEvidenceService(db: SchemaDatabase, now = () => new Date()) {
  await initializeMasteryEvidenceSchema(db); return createMasteryEvidenceServiceOnPreparedDatabase(db, now);
}
