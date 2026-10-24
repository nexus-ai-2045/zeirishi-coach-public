import { createHash, randomUUID } from 'node:crypto';
import type { QueryExecutor, SchemaDatabase, TransactionDatabase } from './database';
import { StudyError } from '../domain/types';
import { DEVELOPMENT_CAFE_MATERIAL, type CafeMaterial, type CafePrompt, type CafeResult } from './cafe-case';
import { initializeOwnerAccess, assertOwnerActive } from './owner-access';

export type CafeConfidence = 'low' | 'normal' | 'high' | null;
export type CafePhase = 'consultation' | 'decision' | 'confidence' | 'feedback' | 'teach_back' | 'reflection' | 'completed' | 'expired';
export type CafeView = {
  id: string; caseVersion: string; status: 'active' | 'completed' | 'expired'; phase: CafePhase;
  revision: number; progressRevision: number; savedAt: string | null; expiresAt: string;
  optionId: string | null; explanation: string; attemptId: string | null;
  confidence: CafeConfidence; confidenceFixed: boolean;
  prompt: CafePrompt; result: CafeResult | null;
};
export type CafeHistoryItem = {
  caseId: string; caseVersion: string; submittedAt: string; status: CafeView['status'];
  phase: CafePhase; confidenceFixed: boolean; correct: boolean | null;
  evidenceQualification: 'practice_only';
};
export type CafeDraftItem = {
  caseId: string; caseVersion: string; phase: 'consultation' | 'decision';
  savedAt: string | null; expiresAt: string;
};
type Tx = QueryExecutor;
type Instance = { id: string; owner_id: string; case_version: string; status: CafeView['status'];
  draft_phase: 'consultation' | 'decision' | null; option_id: string | null; revision: number;
  saved_at: string | null; expires_at: string; completed_at: string | null };
type Attempt = { id: string; option_id: string; result: CafeResult };
type Progress = { phase: CafePhase; explanation: string; revision: number; saved_at: string; expires_at: string };
const DAY = 86_400_000;
const validId = (id: unknown) => { if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id)) throw new StudyError('INVALID_ID'); };
const revisionCheck = (revision: unknown) => { if (!Number.isSafeInteger(revision) || (revision as number) < 0) throw new StudyError('INVALID_REVISION'); };
const digest = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
const deadline = (at: Date) => new Date(at.getTime() + 7 * DAY).toISOString();
export async function purgeExpiredCafe(tx: Tx, at: Date) {
  await tx.query(`UPDATE cafe_instances SET status='expired',draft_phase=NULL,option_id=NULL,saved_at=NULL
    WHERE status='active' AND expires_at <= $1`, [at.toISOString()]);
  await tx.query("DELETE FROM cafe_progress WHERE instance_id IN (SELECT id FROM cafe_instances WHERE status<>'active')");
}

/** Isolated server-side development fixture; no production identity, AI calls or legacy migration. */
export async function createCafeService(db: SchemaDatabase, now: () => Date = () => new Date()) {
  await initializeOwnerAccess(db);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS cafe_instances (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, case_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','completed','expired')),
      draft_phase TEXT, option_id TEXT, revision INTEGER NOT NULL DEFAULT 0,
      saved_at TEXT, expires_at TEXT NOT NULL, completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS cafe_attempts (
      id TEXT PRIMARY KEY, instance_id TEXT NOT NULL UNIQUE REFERENCES cafe_instances(id),
      owner_id TEXT NOT NULL, case_version TEXT NOT NULL, submitted_at TEXT NOT NULL,
      option_id TEXT NOT NULL, result JSONB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cafe_confidence (
      attempt_id TEXT PRIMARY KEY REFERENCES cafe_attempts(id), confidence TEXT,
      fixed_at TEXT NOT NULL, CHECK(confidence IS NULL OR confidence IN ('low','normal','high'))
    );
    CREATE TABLE IF NOT EXISTS cafe_progress (
      instance_id TEXT PRIMARY KEY REFERENCES cafe_instances(id), owner_id TEXT NOT NULL,
      case_version TEXT NOT NULL, attempt_id TEXT NOT NULL REFERENCES cafe_attempts(id),
      phase TEXT NOT NULL, explanation TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0,
      saved_at TEXT NOT NULL, expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cafe_requests (
      owner_id TEXT NOT NULL, request_id TEXT NOT NULL, instance_id TEXT NOT NULL REFERENCES cafe_instances(id),
      operation TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(owner_id,request_id)
    );
  `);
  return createCafeServiceOnPreparedDatabase(db, now);
}

/** Same fixture business logic on an already prepared schema; this does not approve material for production. */
/** Resolve only a verified owner's persisted version; never trust a client-provided case version. */
export async function readOwnedCafeVersion(db: TransactionDatabase, owner: string, caseId: string): Promise<string> {
  validId(owner); validId(caseId);
  return db.transaction(async tx => {
    await assertOwnerActive(tx, owner);
    const row = (await tx.query<{ case_version: string }>('SELECT case_version FROM cafe_instances WHERE id=$1 AND owner_id=$2', [caseId, owner])).rows[0];
    if (!row) throw new StudyError('NOT_FOUND', 404);
    return row.case_version;
  });
}

export function createCafeServiceOnPreparedDatabase(db: TransactionDatabase, now: () => Date = () => new Date(), material: CafeMaterial = DEVELOPMENT_CAFE_MATERIAL) {
  const caseVersion = material.caseVersion;
  const scoringVersion = material.scoringVersion;
  const source = material.prompt();
  const textFields = ['caseId', 'caseVersion', 'conceptId', 'familyId', 'title', 'consultationTitle', 'context', 'consultation', 'task', 'assumption'] as const;
  if (!source || textFields.some(field => typeof source[field] !== 'string') || typeof source.developmentOnly !== 'boolean'
    || !Array.isArray(source.options) || Array.from(source.options).some(option => !option || typeof option.id !== 'string' || typeof option.label !== 'string')
    || !Array.isArray(source.facts) || Array.from(source.facts).some(fact => !fact || typeof fact.label !== 'string' || typeof fact.value !== 'string'))
    throw new StudyError('INVALID_MATERIAL', 503);
  // Explicit public projection at every nested level: material authoring data may contain answers.
  const prompt: CafePrompt = {
    caseId: source.caseId, caseVersion: source.caseVersion, conceptId: source.conceptId, familyId: source.familyId,
    developmentOnly: source.developmentOnly, title: source.title, consultationTitle: source.consultationTitle,
    context: source.context, consultation: source.consultation, task: source.task, assumption: source.assumption,
    options: source.options.map(({ id, label }) => ({ id, label })),
    facts: source.facts.map(({ label, value }) => ({ label, value })),
  };
  const grade = material.grade;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(caseVersion) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(scoringVersion)
    || prompt.caseVersion !== caseVersion || !Array.isArray(prompt.options) || prompt.options.length === 0
    || prompt.options.some(option => typeof option.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(option.id) || typeof option.label !== 'string' || !option.label.trim())
    || new Set(prompt.options.map(option => option.id)).size !== prompt.options.length) throw new StudyError('INVALID_MATERIAL', 503);
  const optionCheck = (id: unknown, nullable = false) => {
    if (nullable && id === null) return;
    if (typeof id !== 'string' || !prompt.options.some(option => option.id === id)) throw new StudyError('INVALID_OPTION');
  };
  async function transact<T>(fn: (tx: Tx, at: Date) => Promise<T | StudyError>, owner?: string): Promise<T> {
    const result = await db.transaction(async tx => {
      const at = now();
      if (!Number.isFinite(at.getTime())) throw new StudyError('INVALID_CLOCK', 500);
      if (owner !== undefined) await assertOwnerActive(tx, owner);
      await purgeExpiredCafe(tx, at);
      return fn(tx, at);
    });
    if (result instanceof StudyError) throw result;
    return result;
  }
  async function owned(tx: Tx, owner: string, id: string): Promise<Instance | StudyError> {
    const row = (await tx.query<Instance>('SELECT * FROM cafe_instances WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, owner])).rows[0];
    if (!row) return new StudyError('NOT_FOUND', 404);
    if (row.case_version !== caseVersion) return new StudyError('CASE_VERSION_CONFLICT', 409);
    return row;
  }
  async function project(tx: Tx, row: Instance): Promise<CafeView> {
    const attempt = (await tx.query<Attempt>('SELECT id,option_id,result FROM cafe_attempts WHERE instance_id=$1 AND owner_id=$2', [row.id, row.owner_id])).rows[0];
    const confidence = attempt ? (await tx.query<{ confidence: CafeConfidence }>('SELECT confidence FROM cafe_confidence WHERE attempt_id=$1', [attempt.id])).rows[0] : undefined;
    const progress = (await tx.query<Progress>('SELECT * FROM cafe_progress WHERE instance_id=$1 AND owner_id=$2', [row.id, row.owner_id])).rows[0];
    return { id: row.id, caseVersion: row.case_version, status: row.status,
      phase: row.status !== 'active' ? row.status : progress?.phase ?? row.draft_phase ?? 'consultation',
      revision: row.revision, progressRevision: progress?.revision ?? 0,
      savedAt: progress?.saved_at ?? row.saved_at, expiresAt: row.expires_at,
      optionId: attempt?.option_id ?? row.option_id, explanation: progress?.explanation ?? '',
      attemptId: attempt?.id ?? null, confidence: confidence?.confidence ?? null,
      confidenceFixed: Boolean(confidence), prompt: structuredClone(prompt), result: confidence && attempt ? attempt.result : null };
  }
  async function replay(tx: Tx, owner: string, requestId: string, operation: string, fingerprint: string) {
    const row = (await tx.query<{ instance_id: string; operation: string; fingerprint: string }>(
      'SELECT * FROM cafe_requests WHERE owner_id=$1 AND request_id=$2', [owner, requestId])).rows[0];
    if (!row) return null;
    if (row.operation !== operation || row.fingerprint !== fingerprint) return new StudyError('REQUEST_CONFLICT', 409);
    const instance = await owned(tx, owner, row.instance_id);
    return instance instanceof StudyError ? instance : project(tx, instance);
  }
  async function remember(tx: Tx, owner: string, id: string, requestId: string, operation: string, fingerprint: string) {
    await tx.query('INSERT INTO cafe_requests VALUES ($1,$2,$3,$4,$5)', [owner, requestId, id, operation, fingerprint]);
  }
  async function mutate(owner: string, id: string, requestId: string, operation: string, payload: unknown,
    fn: (tx: Tx, row: Instance, at: Date) => Promise<void | StudyError>): Promise<CafeView> {
    validId(owner); validId(id); validId(requestId);
    const fingerprint = digest({ id, payload });
    return transact(async (tx, at) => {
      const row = await owned(tx, owner, id);
      if (row instanceof StudyError) return row;
      const existing = await replay(tx, owner, requestId, operation, fingerprint);
      if (existing) return existing;
      if (row.status !== 'active') return new StudyError('SESSION_CLOSED', 409);
      const failure = await fn(tx, row, at);
      if (failure) return failure;
      await remember(tx, owner, id, requestId, operation, fingerprint);
      const updated = await owned(tx, owner, id);
      return updated instanceof StudyError ? updated : project(tx, updated);
    }, owner);
  }
  const hasAttempt = async (tx: Tx, id: string) => (await tx.query<Attempt>('SELECT * FROM cafe_attempts WHERE instance_id=$1', [id])).rows[0];
  return {
    async drafts(owner: string): Promise<CafeDraftItem[]> {
      validId(owner);
      return transact(async (tx, at) => {
        const result = await tx.query<CafeDraftItem>(`SELECT i.id AS "caseId",i.case_version AS "caseVersion",
          i.draft_phase AS phase,i.saved_at AS "savedAt",i.expires_at AS "expiresAt"
          FROM cafe_instances i WHERE i.owner_id=$1 AND i.status='active' AND i.expires_at>$2
          AND i.draft_phase IN ('consultation','decision')
          AND NOT EXISTS (SELECT 1 FROM cafe_attempts a WHERE a.instance_id=i.id)
          ORDER BY i.expires_at DESC,i.id DESC LIMIT 20`, [owner, at.toISOString()]);
        return result.rows;
      }, owner);
    },
    async history(owner: string): Promise<CafeHistoryItem[]> {
      validId(owner);
      return transact(async tx => {
        const rows = await tx.query<{
          case_id: string; case_version: string; submitted_at: string; status: CafeView['status'];
          phase: CafePhase | null; confidence_fixed: boolean; correct: boolean | null;
        }>(`SELECT i.id AS case_id, i.case_version, a.submitted_at, i.status, p.phase,
          (c.attempt_id IS NOT NULL) AS confidence_fixed,
          CASE WHEN c.attempt_id IS NOT NULL THEN (a.result->>'correct')::boolean ELSE NULL END AS correct
          FROM cafe_attempts a
          JOIN cafe_instances i ON i.id=a.instance_id AND i.owner_id=a.owner_id
          LEFT JOIN cafe_confidence c ON c.attempt_id=a.id
          LEFT JOIN cafe_progress p ON p.instance_id=i.id AND p.owner_id=a.owner_id
          WHERE a.owner_id=$1
          ORDER BY a.submitted_at DESC, a.id DESC LIMIT 20`, [owner]);
        return rows.rows.map(row => ({ caseId: row.case_id, caseVersion: row.case_version,
          submittedAt: row.submitted_at, status: row.status,
          phase: row.status !== 'active' ? row.status : row.phase ?? 'confidence',
          confidenceFixed: row.confidence_fixed, correct: row.correct,
          evidenceQualification: 'practice_only' as const }));
      }, owner);
    },
    async start(owner: string, requestId: string, options: { bindMaterialVersion?: boolean } = {}): Promise<CafeView> {
      validId(owner); validId(requestId);
      const fingerprint = digest({ operation: 'start', ...((options.bindMaterialVersion || caseVersion !== DEVELOPMENT_CAFE_MATERIAL.caseVersion) ? { caseVersion } : {}) });
      return transact(async (tx, at) => {
        const existing = await replay(tx, owner, requestId, 'start', fingerprint);
        if (existing) return existing;
        const id = randomUUID();
        const row = (await tx.query<Instance>(`INSERT INTO cafe_instances
          (id,owner_id,case_version,status,draft_phase,expires_at) VALUES ($1,$2,$3,'active','consultation',$4) RETURNING *`,
          [id, owner, caseVersion, deadline(at)])).rows[0];
        await remember(tx, owner, id, requestId, 'start', fingerprint);
        return project(tx, row);
      }, owner);
    },
    async get(owner: string, id: string): Promise<CafeView> {
      validId(owner); validId(id);
      return transact(async tx => { const row = await owned(tx, owner, id); return row instanceof StudyError ? row : project(tx, row); }, owner);
    },
    async save(owner: string, id: string, input: { requestId: string; revision: number; optionId: string | null; phase: 'consultation' | 'decision' }): Promise<CafeView> {
      revisionCheck(input.revision); optionCheck(input.optionId, true);
      if (!['consultation', 'decision'].includes(input.phase)) throw new StudyError('INVALID_PHASE');
      const payload = { revision: input.revision, optionId: input.optionId, phase: input.phase };
      return mutate(owner, id, input.requestId, 'save', payload, async (tx, row, at) => {
        if (await hasAttempt(tx, id)) return new StudyError('ANSWER_ALREADY_SUBMITTED', 409);
        if (row.revision !== input.revision) return new StudyError('REVISION_CONFLICT', 409);
        const changed = row.option_id !== input.optionId || row.draft_phase !== input.phase;
        await tx.query(`UPDATE cafe_instances SET option_id=$2,draft_phase=$3,revision=revision+1,saved_at=$4,expires_at=$5 WHERE id=$1`,
          [id, input.optionId, input.phase, changed ? at.toISOString() : row.saved_at, changed ? deadline(at) : row.expires_at]);
      });
    },
    async submit(owner: string, id: string, input: { requestId: string; optionId: string }): Promise<CafeView> {
      optionCheck(input.optionId);
      return mutate(owner, id, input.requestId, 'submit', { optionId: input.optionId }, async (tx, row, at) => {
        if (await hasAttempt(tx, id)) return new StudyError('ANSWER_ALREADY_SUBMITTED', 409);
        const attemptId = randomUUID();
        const result = grade(row.case_version, input.optionId);
        if (!result || result.caseVersion !== row.case_version || result.optionId !== input.optionId || result.scoringVersion !== scoringVersion
          || result.evidenceQualification !== 'practice_only' || typeof result.correct !== 'boolean'
          || !Number.isFinite(result.earned) || !Number.isFinite(result.max) || result.max <= 0 || result.earned < 0 || result.earned > result.max)
          return new StudyError('INVALID_MATERIAL_RESULT', 503);
        await tx.query('INSERT INTO cafe_attempts VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)',
          [attemptId, id, owner, row.case_version, at.toISOString(), input.optionId, JSON.stringify(result)]);
        await tx.query(`INSERT INTO cafe_progress (instance_id,owner_id,case_version,attempt_id,phase,saved_at,expires_at)
          VALUES ($1,$2,$3,$4,'confidence',$5,$6)`, [id, owner, row.case_version, attemptId, at.toISOString(), deadline(at)]);
        await tx.query('UPDATE cafe_instances SET draft_phase=NULL,option_id=NULL,saved_at=NULL,expires_at=$2 WHERE id=$1', [id, deadline(at)]);
      });
    },
    async confidence(owner: string, id: string, input: { requestId: string; confidence: CafeConfidence }): Promise<CafeView> {
      if (input.confidence !== null && !['low', 'normal', 'high'].includes(input.confidence)) throw new StudyError('INVALID_CONFIDENCE');
      return mutate(owner, id, input.requestId, 'confidence', { confidence: input.confidence }, async (tx, _row, at) => {
        const attempt = await hasAttempt(tx, id);
        if (!attempt) return new StudyError('ANSWER_REQUIRED', 409);
        if ((await tx.query('SELECT 1 FROM cafe_confidence WHERE attempt_id=$1', [attempt.id])).rows.length) return new StudyError('CONFIDENCE_ALREADY_FIXED', 409);
        await tx.query('INSERT INTO cafe_confidence VALUES ($1,$2,$3)', [attempt.id, input.confidence, at.toISOString()]);
        await tx.query("UPDATE cafe_progress SET phase='feedback',revision=revision+1,saved_at=$2,expires_at=$3 WHERE instance_id=$1", [id, at.toISOString(), deadline(at)]);
        await tx.query('UPDATE cafe_instances SET expires_at=$2 WHERE id=$1', [id, deadline(at)]);
      });
    },
    async saveProgress(owner: string, id: string, input: { requestId: string; revision: number; phase: 'feedback' | 'teach_back' | 'reflection'; explanation: string }): Promise<CafeView> {
      revisionCheck(input.revision);
      if (typeof input.explanation !== 'string' || input.explanation.length > 2000) throw new StudyError('INVALID_EXPLANATION');
      const phases = ['feedback', 'teach_back', 'reflection'];
      if (!phases.includes(input.phase)) throw new StudyError('INVALID_PHASE');
      const payload = { revision: input.revision, phase: input.phase, explanation: input.explanation };
      return mutate(owner, id, input.requestId, 'progress', payload, async (tx, _row, at) => {
        const progress = (await tx.query<Progress>('SELECT * FROM cafe_progress WHERE instance_id=$1', [id])).rows[0];
        if (!progress || progress.phase === 'confidence') return new StudyError('CONFIDENCE_REQUIRED', 409);
        if (progress.revision !== input.revision) return new StudyError('REVISION_CONFLICT', 409);
        if (phases.indexOf(input.phase) > phases.indexOf(progress.phase) + 1) return new StudyError('PHASE_CONFLICT', 409);
        const changed = progress.phase !== input.phase || progress.explanation !== input.explanation;
        const expires = changed ? deadline(at) : progress.expires_at;
        await tx.query('UPDATE cafe_progress SET phase=$2,explanation=$3,revision=revision+1,saved_at=$4,expires_at=$5 WHERE instance_id=$1',
          [id, input.phase, input.explanation, changed ? at.toISOString() : progress.saved_at, expires]);
        await tx.query('UPDATE cafe_instances SET expires_at=$2 WHERE id=$1', [id, expires]);
      });
    },
    async complete(owner: string, id: string, input: { requestId: string }): Promise<CafeView> {
      return mutate(owner, id, input.requestId, 'complete', {}, async (tx, _row, at) => {
        const progress = (await tx.query<Progress>('SELECT * FROM cafe_progress WHERE instance_id=$1', [id])).rows[0];
        if (!progress || progress.phase !== 'reflection') return new StudyError('REFLECTION_REQUIRED', 409);
        await tx.query("UPDATE cafe_instances SET status='completed',completed_at=$2,draft_phase=NULL,option_id=NULL,saved_at=NULL WHERE id=$1", [id, at.toISOString()]);
        await tx.query('DELETE FROM cafe_progress WHERE instance_id=$1', [id]);
      });
    },
    async purgeExpired(): Promise<void> { await transact(async () => undefined); },
  };
}
