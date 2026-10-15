import { createHash, randomUUID } from 'node:crypto';
import type { QueryExecutor, SchemaDatabase, TransactionDatabase } from './database';
import { emptyAnswer, StudyError, validateAnswer } from '../domain/types';
import type { Answer, SessionView } from '../domain/types';
import { gradeFixture } from './fixture-grading';
import { initializeOwnerAccess, assertOwnerActive } from './owner-access';

export type { Answer, SessionView } from '../domain/types';
export { StudyError } from '../domain/types';

type Row = { id: string; owner_id: string; status: SessionView['status']; revision: number; saved_at: string | null;
  expires_at: string; answer: Answer | null; result: SessionView['result'] };
type Receipt = { operation: string; fingerprint: string; response: SessionView | null };
type Queryable = QueryExecutor;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const identifier = (value: unknown) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new StudyError('INVALID_ID');
};
const view = (row: Row): SessionView => ({ id: row.id, status: row.status, revision: row.revision,
  savedAt: row.saved_at, answer: row.answer ?? emptyAnswer(), result: row.result });
export async function purgeExpiredStudy(tx: Queryable, at: Date) {
  await tx.query(`UPDATE study_sessions SET status='expired', answer=NULL, saved_at=NULL
    WHERE status='active' AND expires_at <= $1`, [at.toISOString()]);
  await tx.query(`UPDATE study_requests SET response=NULL WHERE operation='save' AND response IS NOT NULL AND session_id IN
    (SELECT id FROM study_sessions WHERE status <> 'active')`);
}

/** Local server adapter. Production authentication/RLS are intentionally not supplied here. */
export async function createStudyService(db: SchemaDatabase, now: () => Date = () => new Date()) {
  await initializeOwnerAccess(db);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS study_sessions (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('active','completed','expired')),
      revision INTEGER NOT NULL DEFAULT 0, saved_at TEXT, expires_at TEXT NOT NULL,
      answer JSONB, result JSONB, fixture_version TEXT NOT NULL DEFAULT 'synthetic-v1',
      scoring_version TEXT NOT NULL DEFAULT 'synthetic-score-v1'
    );
    CREATE TABLE IF NOT EXISTS study_requests (
      owner_id TEXT NOT NULL, request_id TEXT NOT NULL, session_id TEXT NOT NULL REFERENCES study_sessions(id),
      operation TEXT NOT NULL, fingerprint TEXT NOT NULL, response JSONB,
      PRIMARY KEY (owner_id, request_id)
    );
    CREATE TABLE IF NOT EXISTS study_attempts (
      session_id TEXT PRIMARY KEY REFERENCES study_sessions(id), owner_id TEXT NOT NULL,
      submitted_at TEXT NOT NULL, answer JSONB NOT NULL, result JSONB NOT NULL,
      fixture_version TEXT NOT NULL, scoring_version TEXT NOT NULL
    );
  `);
  return createStudyServiceOnPreparedDatabase(db, now);
}

/** Uses an already prepared schema without DDL. Authentication/RLS readiness is a separate gate. */
export function createStudyServiceOnPreparedDatabase(db: TransactionDatabase, now: () => Date = () => new Date()) {
  const clock = () => {
    const value = now();
    if (!Number.isFinite(value.getTime())) throw new StudyError('INVALID_CLOCK', 500);
    return value;
  };
  const owned = async (tx: Queryable, userId: string, id: string) => {
    const { rows } = await tx.query<Row>(`SELECT s.*, COALESCE(s.answer,
      (SELECT a.answer FROM study_attempts a WHERE a.session_id=s.id AND a.owner_id=s.owner_id)) AS answer
      FROM study_sessions s WHERE s.id=$1 AND s.owner_id=$2 FOR UPDATE`, [id, userId]);
    if (!rows[0]) return new StudyError('NOT_FOUND', 404);
    return rows[0];
  };
  const transaction = async <T>(fn: (tx: Queryable, at: Date) => Promise<T | StudyError>, owner?: string): Promise<T> => {
    // Return domain failures through the transaction so expiry cleanup commits even on rejected access.
    const outcome = await db.transaction(async tx => {
      const at = clock();
      if (owner !== undefined) await assertOwnerActive(tx, owner);
      await purgeExpiredStudy(tx, at);
      return fn(tx, at);
    });
    if (outcome instanceof StudyError) throw outcome;
    return outcome;
  };
  const checkReceipt = async (tx: Queryable, userId: string, requestId: string, fingerprint: string, operation: string) => {
    const { rows } = await tx.query<Receipt>('SELECT * FROM study_requests WHERE owner_id=$1 AND request_id=$2', [userId, requestId]);
    if (!rows[0]) return null;
    if (rows[0].fingerprint !== fingerprint || rows[0].operation !== operation) return new StudyError('REQUEST_CONFLICT', 409);
    return rows[0].response;
  };
  const receipt = async (tx: Queryable, userId: string, id: string, requestId: string, operation: string, fingerprint: string, response: SessionView) => {
    await tx.query('INSERT INTO study_requests VALUES ($1,$2,$3,$4,$5,$6::jsonb)', [userId, requestId, id, operation, fingerprint, JSON.stringify(response)]);
  };
  return {
    async start(userId: string, requestId: string): Promise<SessionView> {
      identifier(userId); identifier(requestId);
      return transaction(async (tx, at) => {
        const existing = await tx.query<Receipt & { session_id: string }>(
          'SELECT * FROM study_requests WHERE owner_id=$1 AND request_id=$2', [userId, requestId]);
        if (existing.rows[0]) {
          if (existing.rows[0].operation !== 'start') return new StudyError('REQUEST_CONFLICT', 409);
          const row = await owned(tx, userId, existing.rows[0].session_id);
          return row instanceof StudyError ? row : view(row);
        }
        const id = randomUUID();
        const { rows } = await tx.query<Row>(`INSERT INTO study_sessions (id,owner_id,status,expires_at)
          VALUES ($1,$2,'active',$3) RETURNING *`, [id, userId, new Date(at.getTime() + 7 * 86_400_000).toISOString()]);
        // Store only the session reference: replay resolves current state, never a copied draft.
        await tx.query(`INSERT INTO study_requests (owner_id,request_id,session_id,operation,fingerprint,response)
          VALUES ($1,$2,$3,'start',$4,NULL)`, [userId, requestId, id, hash({ operation: 'start' })]);
        return view(rows[0]);
      }, userId);
    },
    async get(userId: string, id: string): Promise<SessionView> {
      identifier(userId); identifier(id);
      return transaction(async tx => { const row = await owned(tx, userId, id); return row instanceof StudyError ? row : view(row); }, userId);
    },
    async save(userId: string, id: string, input: { requestId: string; revision: number; answer: Answer }): Promise<SessionView> {
      identifier(userId); identifier(id); identifier(input?.requestId);
      if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new StudyError('INVALID_REVISION');
      const answer = validateAnswer(input.answer);
      const fingerprint = hash({ id, revision: input.revision, answer });
      return transaction(async (tx, at) => {
        const row = await owned(tx, userId, id);
        if (row instanceof StudyError) return row;
        if (row.status !== 'active') return new StudyError('SESSION_CLOSED', 409);
        const replay = await checkReceipt(tx, userId, input.requestId, fingerprint, 'save');
        if (replay) return replay;
        if (row.revision !== input.revision) return new StudyError('REVISION_CONFLICT', 409);
        const previous = row.answer ?? emptyAnswer();
        const changed = previous.insurance !== answer.insurance || previous.equipment !== answer.equipment || previous.explanation !== answer.explanation;
        const { rows } = await tx.query<Row>(`UPDATE study_sessions SET answer=$2::jsonb,revision=revision+1,saved_at=$3,expires_at=$4
          WHERE id=$1 RETURNING *`, [id, JSON.stringify(answer), changed ? at.toISOString() : row.saved_at,
          changed ? new Date(at.getTime() + 7 * 86_400_000).toISOString() : row.expires_at]);
        const response = view(rows[0]);
        await receipt(tx, userId, id, input.requestId, 'save', fingerprint, response);
        return response;
      }, userId);
    },
    async submit(userId: string, id: string, input: { requestId: string; answer: Answer }): Promise<SessionView> {
      identifier(userId); identifier(id); identifier(input?.requestId);
      const answer = validateAnswer(input.answer, true);
      const fingerprint = hash({ id, answer });
      return transaction(async (tx, at) => {
        const row = await owned(tx, userId, id);
        if (row instanceof StudyError) return row;
        const replay = await checkReceipt(tx, userId, input.requestId, fingerprint, 'submit');
        if (replay) return replay;
        if (row.status !== 'active') return new StudyError('SESSION_CLOSED', 409);
        const result = gradeFixture(answer, at);
        await tx.query(`INSERT INTO study_attempts VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,'synthetic-v1','synthetic-score-v1')`,
          [id, userId, at.toISOString(), JSON.stringify(answer), JSON.stringify(result)]);
        await tx.query(`UPDATE study_sessions SET status='completed',answer=NULL,saved_at=NULL,result=$2::jsonb WHERE id=$1`, [id, JSON.stringify(result)]);
        await tx.query("UPDATE study_requests SET response=NULL WHERE session_id=$1 AND operation='save'", [id]);
        const response: SessionView = { ...view(row), status: 'completed', answer, savedAt: null, result };
        await receipt(tx, userId, id, input.requestId, 'submit', fingerprint, response);
        return response;
      }, userId);
    },
    async purgeExpired(): Promise<void> { await transaction(async () => undefined); },
  };
}
