import { randomUUID } from 'node:crypto';
import { createDiagnosticEngine, type DiagnosticQuestion, type DiagnosticSession, type DiagnosticCommand, type DiagnosticEngineOptions } from '../domain/diagnostic-session';
import { SUBJECTS, type SubjectId } from '../domain/onboarding';
import { StudyError } from '../domain/types';
import type { SchemaDatabase, TransactionDatabase, QueryExecutor } from './database';
import { assertOwnerActive, initializeOwnerAccess } from './owner-access';
import { strictCanonicalJson } from './strict-canonical-json';
import { BOOKKEEPING_INDEPENDENT_DRAFTS } from './bookkeeping-question-drafts';

/** Human-reviewed diagnostic material is not yet available. Fixtures must be explicitly injected. */
export const APPROVED_DIAGNOSTIC_QUESTIONS: readonly DiagnosticQuestion[] = Object.freeze([]);
export type DiagnosticRecord = { id: string; revision: number; updatedAt: string; view: ReturnType<ReturnType<typeof createDiagnosticEngine>['view']> };
type Row = { id: string; revision: number; updated_at: string; state: DiagnosticSession };
export type DiagnosticInput = { action: 'start'; requestId: string; mode: 'short' | 'detailed'; subjectId: SubjectId; conceptId: string | null }
  | { action: 'present' | 'pause' | 'resume' | 'finish'; requestId: string; sessionId: string; revision: number }
  | { action: 'submit'; requestId: string; sessionId: string; revision: number; instanceId: string; answerId: string; hintsUsed: boolean }
  | { action: 'reveal'; requestId: string; sessionId: string; revision: number; instanceId: string }
  | { action: 'confidence'; requestId: string; sessionId: string; revision: number; instanceId: string; value: 'low' | 'normal' | 'high' | null };
const invalid = (): never => { throw new StudyError('INVALID_DIAGNOSTIC'); };
const canonical = (value: unknown) => strictCanonicalJson(value, invalid);
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
export function parseDiagnosticInput(raw: unknown): DiagnosticInput {
  const value = JSON.parse(canonical(raw));
  if (!value || Array.isArray(value) || typeof value !== 'object') invalid();
  const fields = value.action === 'start' ? ['action','requestId','mode','subjectId','conceptId']
    : ['action','requestId','sessionId','revision', ...(value.action === 'submit' ? ['instanceId','answerId','hintsUsed']
      : value.action === 'reveal' ? ['instanceId'] : value.action === 'confidence' ? ['instanceId','value'] : [])];
  if (Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key)) || !id(value.requestId)) invalid();
  if (value.action !== 'start' && (!['present','pause','resume','finish','submit','reveal','confidence'].includes(value.action)
    || !id(value.sessionId) || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision >= 2147483647)) invalid();
  if (value.action === 'start' && (!['short','detailed'].includes(value.mode)
    || !SUBJECTS.some(subject => subject.id === value.subjectId) || !(value.conceptId === null || id(value.conceptId))
    || (value.mode === 'short' && value.conceptId === null))) invalid();
  if (['submit','reveal','confidence'].includes(value.action) && !id(value.instanceId)) invalid();
  if (value.action === 'submit' && (!id(value.answerId) || typeof value.hintsUsed !== 'boolean')) invalid();
  if (value.action === 'confidence' && !['low','normal','high',null].includes(value.value)) invalid();
  return value as DiagnosticInput;
}
export async function initializeDiagnosticSchema(db: Pick<SchemaDatabase, 'exec'>) {
  await initializeOwnerAccess(db);
  await db.exec(`CREATE TABLE IF NOT EXISTS diagnostic_sessions (
    owner_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL,state JSONB NOT NULL,
    PRIMARY KEY(owner_id,id));
    CREATE TABLE IF NOT EXISTS diagnostic_requests (
    owner_id TEXT NOT NULL,request_id TEXT NOT NULL,session_id TEXT NOT NULL,fingerprint TEXT NOT NULL,response JSONB NOT NULL,
    PRIMARY KEY(owner_id,request_id),FOREIGN KEY(owner_id,session_id) REFERENCES diagnostic_sessions(owner_id,id));`);
}
async function rows(tx: QueryExecutor, owner: string) { return (await tx.query<Row>('SELECT id,revision,updated_at,state FROM diagnostic_sessions WHERE owner_id=$1 ORDER BY updated_at,id', [owner])).rows; }
function seenFamiliesForSubject(history: Row[], subjectId: SubjectId, at: string, project: (row: Row, at: string) => DiagnosticRecord) {
  return [...new Set(history.filter(row => row.state.seed.subjectId === subjectId)
    // Aggregate observed attempts, not the session seed. Older rows may have
    // copied the pre-fix cross-subject aggregate into that seed.
    .flatMap(row => project(row, at).view.attempts.map(attempt => attempt.familyId)))].sort();
}
function publicRecord(row: Row, engine: ReturnType<typeof createDiagnosticEngine>, at: string): DiagnosticRecord {
  let view: DiagnosticRecord['view'];
  try { view = engine.view(row.state, at); }
  catch (error) {
    if (!(error instanceof StudyError) || error.code !== 'INVALID_DIAGNOSTIC') throw error;
    // Persisted catalog is trusted internal history. Use it only to project old observations;
    // never continue an obsolete session or reveal its pending question.
    const archived = createDiagnosticEngine(JSON.parse(row.state.catalog), { practiceOnly: row.state.practiceOnly === true, ...row.state.trialSettings }).view(row.state, at);
    view = { ...archived, status: 'unavailable', currentQuestion: null,
      reasons: [...archived.reasons, '教材の版が変更されたため、この確認は再開できません。過去の回答記録です。'] };
  }
  return { id: row.id, revision: row.revision, updatedAt: row.updated_at, view };
}
/** Export uses the public projection, never the state catalog containing answer keys. Caller holds owner lock. */
export async function readDiagnosticRecords(tx: QueryExecutor, owner: string, catalog = APPROVED_DIAGNOSTIC_QUESTIONS, at = new Date().toISOString()): Promise<DiagnosticRecord[]> {
  const engine = createDiagnosticEngine(catalog);
  return (await rows(tx, owner)).map(row => publicRecord(row, engine, at));
}
export async function createDiagnosticService(db: SchemaDatabase, catalog = APPROVED_DIAGNOSTIC_QUESTIONS, now = () => new Date(), options: DiagnosticEngineOptions = {}) {
  await initializeDiagnosticSchema(db);
  return createDiagnosticServiceOnPreparedDatabase(db, catalog, now, options);
}
export function createDiagnosticServiceOnPreparedDatabase(db: TransactionDatabase, catalog = APPROVED_DIAGNOSTIC_QUESTIONS, now = () => new Date(), options: DiagnosticEngineOptions = {}) {
  const engine = createDiagnosticEngine(catalog, options);
  const clock = () => { const at = now(); if (!Number.isFinite(at.getTime())) throw new StudyError('INVALID_CLOCK', 500); return at.toISOString(); };
  const project = (row: Row, at: string): DiagnosticRecord => publicRecord(row, engine, at);
  return {
    async list(owner: string, trialPurpose?: string) { return db.transaction(async tx => {
      await assertOwnerActive(tx, owner); const at = clock();
      const latest = trialPurpose === undefined
        ? (await tx.query<Row>('SELECT id,revision,updated_at,state FROM diagnostic_sessions WHERE owner_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 20', [owner])).rows
        : (await tx.query<Row>("SELECT id,revision,updated_at,state FROM diagnostic_sessions WHERE owner_id=$1 AND state->'trialSettings'->>'purpose'=$2 ORDER BY updated_at DESC,id DESC LIMIT 20", [owner, trialPurpose])).rows;
      return latest.map(row => project(row, at));
    }); },
    async get(owner: string, sessionId: string) {
      if (!id(sessionId)) invalid();
      return db.transaction(async tx => { await assertOwnerActive(tx, owner);
        const row = (await tx.query<Row>('SELECT * FROM diagnostic_sessions WHERE owner_id=$1 AND id=$2', [owner, sessionId])).rows[0];
        if (!row) throw new StudyError('NOT_FOUND', 404); return project(row, clock()); });
    },
    async save(owner: string, raw: unknown): Promise<DiagnosticRecord> {
      const input = parseDiagnosticInput(raw), fingerprint = canonical(input);
      return db.transaction(async tx => {
        await assertOwnerActive(tx, owner); const at = clock();
        const previous = (await tx.query<{ fingerprint: string; response: Row }>('SELECT fingerprint,response FROM diagnostic_requests WHERE owner_id=$1 AND request_id=$2', [owner,input.requestId])).rows[0];
        if (previous) { if (previous.fingerprint !== fingerprint) throw new StudyError('REQUEST_CONFLICT',409); return project(previous.response, at); }
        const history = await rows(tx, owner);
        let saved: Row;
        if (input.action === 'start') {
          const sessionId = randomUUID();
          const seenFamilies = seenFamiliesForSubject(history, input.subjectId, at, project);
          let state = engine.start({ id: sessionId, mode: input.mode, subjectId: input.subjectId, conceptId: input.conceptId, createdAt: at, seenFamilies });
          state = engine.transition(state, { type: 'present', requestId: input.requestId, at, seenFamilies });
          saved = { id: sessionId, revision: 0, updated_at: at, state };
          if (engine.view(state, at).status === 'unavailable') return project(saved, at);
          await tx.query('INSERT INTO diagnostic_sessions VALUES ($1,$2,$3,$4,$5::jsonb)', [owner,saved.id,0,at,JSON.stringify(state)]);
        } else {
          const previous = history.find(row => row.id === input.sessionId);
          if (!previous) throw new StudyError('NOT_FOUND',404);
          if (previous.revision !== input.revision) throw new StudyError('REVISION_CONFLICT',409);
          const { action, requestId, sessionId: _id, revision: _revision, ...extra } = input;
          const command = { type: action, requestId, at, ...extra, ...(action === 'present'
            ? { seenFamilies: seenFamiliesForSubject(history, previous.state.seed.subjectId, at, project) } : {}) } as DiagnosticCommand;
          const state = engine.transition(previous.state, command);
          saved = { ...previous, state, revision: previous.revision + 1, updated_at: at };
          await tx.query('UPDATE diagnostic_sessions SET revision=$3,updated_at=$4,state=$5::jsonb WHERE owner_id=$1 AND id=$2', [owner,saved.id,saved.revision,at,JSON.stringify(state)]);
        }
        await tx.query('INSERT INTO diagnostic_requests VALUES ($1,$2,$3,$4,$5::jsonb)', [owner,input.requestId,saved.id,fingerprint,JSON.stringify(saved)]);
        return project(saved, at);
      });
    },
  };
}

/** 固定したローカル原稿だけを使う6問のミニ演習。正式模試・習熟記録へ接続しない。 */
export function createBookkeepingMiniExamServiceOnPreparedDatabase(db: TransactionDatabase, kind: 'before' | 'after', now = () => new Date()) {
  if (kind !== 'before' && kind !== 'after') invalid();
  const purpose = kind === 'before' ? 'before_evaluation' : 'after_evaluation';
  const intendedUse = kind === 'before' ? 'mini_a' : 'mini_b';
  const catalog = BOOKKEEPING_INDEPENDENT_DRAFTS.filter(item => item.intendedUse === intendedUse).map(item => item.question);
  const service = createDiagnosticServiceOnPreparedDatabase(db, catalog, now,
    { practiceOnly: true, purpose, questionLimit: 6, durationSeconds: 720, stageFilter: false });
  const belongs = (record: DiagnosticRecord) => 'trialSettings' in record.view && record.view.trialSettings.purpose === purpose;
  const get = async (owner: string, sessionId: string) => {
    const record = await service.get(owner, sessionId);
    if (!belongs(record)) throw new StudyError('NOT_FOUND', 404);
    return record;
  };
  return {
    list: async (owner: string) => (await service.list(owner, purpose)).filter(belongs),
    get,
    async save(owner: string, raw: unknown) {
      const input = parseDiagnosticInput(raw);
      if (input.action === 'start') {
        if (input.mode !== 'detailed' || input.subjectId !== 'bookkeeping' || input.conceptId !== null) invalid();
      } else {
        if (input.action === 'submit' && input.hintsUsed) invalid();
        await get(owner, input.sessionId);
      }
      const record = await service.save(owner, input);
      // request IDs are shared by the existing journal: a retry may belong to the other fixed pool.
      if (!belongs(record)) throw new StudyError('REQUEST_CONFLICT', 409);
      return record;
    },
  };
}
