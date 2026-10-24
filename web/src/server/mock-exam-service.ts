import { createHash } from 'node:crypto';
import { SUBJECTS, type SubjectId } from '../domain/onboarding';
import { StudyError } from '../domain/types';
import type { SchemaDatabase, TransactionDatabase } from './database';
import { assertOwnerActive, initializeOwnerAccess, type OwnerTransaction } from './owner-access';

/** Unverified personal reference only. Never convert this to trusted exam-readiness evidence. */
export type MockExamRecord = { subjectId: SubjectId; examYear: number; provider: string; examId: string;
  completedOn: string; score: number; maxScore: number; elapsedMinutes: number | null;
  rank: { position: number; population: number } | null; unseen: boolean | null };
export type MockExamItem = { id: string; revision: number; updatedAt: string; record: MockExamRecord;
  evidenceQualification: 'self_report_only' };
export type MockExamSave = { requestId: string; id: string; revision: number; record: MockExamRecord };
function invalid(): never { throw new StudyError('INVALID_MOCK_EXAM'); }
function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const result = value as Record<string, unknown>;
  if (Object.keys(result).length !== keys.length || Object.keys(result).some(key => !keys.includes(key))) invalid();
  return result;
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
function label(value: unknown): string { if (typeof value !== 'string' || !value.trim() || value.length > 200) invalid(); return value.trim(); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
/** Date-only input is evaluated in Japan, not in the server host's local timezone. */
export function parseMockExamSave(value: unknown, now = new Date()): MockExamSave {
  if (!Number.isFinite(now.getTime())) throw new StudyError('INVALID_CLOCK', 500);
  const input = exact(value, ['requestId', 'id', 'revision', 'record']);
  if (!uuid(input.requestId) || !uuid(input.id)) invalid();
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0 || (input.revision as number) >= 2147483647) invalid();
  const record = exact(input.record, ['subjectId', 'examYear', 'provider', 'examId', 'completedOn', 'score', 'maxScore', 'elapsedMinutes', 'rank', 'unseen']);
  if (!SUBJECTS.some(subject => subject.id === record.subjectId)) invalid();
  if (!Number.isInteger(record.examYear) || (record.examYear as number) < 1900 || (record.examYear as number) > 2200) invalid();
  if (typeof record.completedOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(record.completedOn)) invalid();
  const day = new Date(`${record.completedOn}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== record.completedOn
    || record.completedOn > new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)) invalid();
  if (!finite(record.score) || !finite(record.maxScore) || record.maxScore <= 0 || record.score < 0 || record.score > record.maxScore) invalid();
  if (record.elapsedMinutes !== null && (!finite(record.elapsedMinutes) || record.elapsedMinutes < 0 || record.elapsedMinutes > 10080)) invalid();
  if (record.unseen !== null && typeof record.unseen !== 'boolean') invalid();
  let rank: MockExamRecord['rank'] = null;
  if (record.rank !== null) {
    const raw = exact(record.rank, ['position', 'population']);
    if (!Number.isSafeInteger(raw.position) || !Number.isSafeInteger(raw.population)
      || (raw.position as number) < 1 || (raw.population as number) < (raw.position as number)) invalid();
    rank = { position: raw.position as number, population: raw.population as number };
  }
  return { requestId: input.requestId.toLowerCase(), id: input.id.toLowerCase(), revision: input.revision as number,
    record: { subjectId: record.subjectId as SubjectId, examYear: record.examYear as number,
      provider: label(record.provider), examId: label(record.examId), completedOn: record.completedOn,
      score: record.score, maxScore: record.maxScore, elapsedMinutes: record.elapsedMinutes as number | null,
      rank, unseen: record.unseen as boolean | null } };
}
export async function initializeMockExamSchema(db: Pick<SchemaDatabase, 'exec'>) {
  await initializeOwnerAccess(db);
  await db.exec(`CREATE TABLE IF NOT EXISTS mock_exam_records (
    owner_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0),
    updated_at TEXT NOT NULL, record JSONB NOT NULL,
    PRIMARY KEY(owner_id,id)
  );
  CREATE TABLE IF NOT EXISTS mock_exam_requests (
    owner_id TEXT NOT NULL, request_id TEXT NOT NULL, record_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation='save'), response JSONB NOT NULL,
    PRIMARY KEY(owner_id,request_id),
    FOREIGN KEY(owner_id,record_id) REFERENCES mock_exam_records(owner_id,id)
  );`);
}
/** Internal export may request all records; the UI list is always limited to the latest 20. */
export async function readMockExamRecords(tx: OwnerTransaction, owner: string, all = false): Promise<MockExamItem[]> {
  return (await tx.query<MockExamItem>(`SELECT id,revision,updated_at AS "updatedAt",record,
    'self_report_only'::text AS "evidenceQualification" FROM mock_exam_records WHERE owner_id=$1
    ORDER BY updated_at DESC,id DESC${all ? '' : ' LIMIT 20'}`, [owner])).rows;
}
async function readItem(tx: OwnerTransaction, owner: string, id: string): Promise<MockExamItem> {
  const item = (await tx.query<MockExamItem>(`SELECT id,revision,updated_at AS "updatedAt",record,
    'self_report_only'::text AS "evidenceQualification" FROM mock_exam_records WHERE owner_id=$1 AND id=$2`, [owner, id])).rows[0];
  if (!item) throw new StudyError('NOT_FOUND', 404);
  return item;
}
export async function createMockExamService(db: SchemaDatabase, now = () => new Date()) {
  await initializeMockExamSchema(db);
  return createMockExamServiceOnPreparedDatabase(db, now);
}
export function createMockExamServiceOnPreparedDatabase(db: TransactionDatabase, now = () => new Date()) {
  return {
    async get(owner: string, id: string): Promise<MockExamItem> {
      if (!uuid(id)) invalid();
      return db.transaction(async tx => {
        await assertOwnerActive(tx, owner);
        return readItem(tx, owner, id.toLowerCase());
      });
    },
    async list(owner: string) {
      return db.transaction(async tx => { await assertOwnerActive(tx, owner); return readMockExamRecords(tx, owner); });
    },
    async save(owner: string, raw: MockExamSave): Promise<MockExamItem> {
      const at = now(), input = parseMockExamSave(raw, at);
      const fingerprint = createHash('sha256').update(JSON.stringify({ operation: 'save', id: input.id, revision: input.revision, record: input.record })).digest('hex');
      return db.transaction(async tx => {
        await assertOwnerActive(tx, owner);
        const receipt = (await tx.query<{ fingerprint: string; response: MockExamItem }>(
          'SELECT fingerprint,response FROM mock_exam_requests WHERE owner_id=$1 AND request_id=$2', [owner, input.requestId])).rows[0];
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) throw new StudyError('REQUEST_CONFLICT', 409);
          // Do not reapply an old save or display its old snapshot over a newer edit.
          // The immutable receipt retains the original operation's result for audit only.
          return readItem(tx, owner, input.id);
        }
        const previous = (await tx.query<{ revision: number }>('SELECT revision FROM mock_exam_records WHERE owner_id=$1 AND id=$2', [owner, input.id])).rows[0];
        if ((previous?.revision ?? 0) !== input.revision) throw new StudyError('MOCK_EXAM_REVISION_CONFLICT', 409);
        const item: MockExamItem = { id: input.id, revision: input.revision + 1, updatedAt: at.toISOString(), record: input.record, evidenceQualification: 'self_report_only' };
        await tx.query(`INSERT INTO mock_exam_records(owner_id,id,revision,updated_at,record) VALUES ($1,$2,$3,$4,$5::jsonb)
          ON CONFLICT(owner_id,id) DO UPDATE SET revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at,record=EXCLUDED.record`,
          [owner, item.id, item.revision, item.updatedAt, JSON.stringify(item.record)]);
        await tx.query(`INSERT INTO mock_exam_requests(owner_id,request_id,record_id,fingerprint,operation,response)
          VALUES ($1,$2,$3,$4,'save',$5::jsonb)`, [owner, input.requestId, input.id, fingerprint, JSON.stringify(item)]);
        return item;
      });
    },
  };
}
