import { createHash } from 'node:crypto';
import type { SchemaDatabase, TransactionDatabase } from './database';
import type { ConfidenceReport, SubjectId, SubjectPack } from '../domain/onboarding';
import { createWeeklyPlan, type PlanCandidate, type WeeklyPlan } from '../domain/weekly-plan';
import { StudyError } from '../domain/types';
import { assertOwnerActive, initializeOwnerAccess, type OwnerTransaction } from './owner-access';
import { cafePrompt } from './cafe-case';

export type WeeklyPlanRecord = { revision: number; updatedAt: string; profileRevision: number;
  weeklyMinutes: number; excludedIds: string[]; adjustmentReason: string; plan: WeeklyPlan };
export type WeeklyPlanSave = { requestId: string; revision: number; weeklyMinutes: number;
  excludedIds: string[]; adjustmentReason: string };
export type WeeklyPlanResponse = { planRecord: WeeklyPlanRecord | null; stale: boolean;
  developmentOnly: boolean; candidates: PlanCandidate[]; autoSkippedIds: string[] };
export type PlanInventory = { developmentOnly: boolean; candidates: readonly PlanCandidate[] };
type CurrentProfile = { revision: number; exam_subjects: SubjectId[] | null; reports: ConfidenceReport[] };
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
const automaticSkips = (candidates: PlanCandidate[], current: CurrentProfile) => candidates.filter(candidate =>
  current.reports.some(report => report.subjectId === candidate.subjectId && report.conceptId === candidate.conceptId
    && report.conceptVersion === candidate.conceptVersion && report.selfConfidence === 'explained')).map(candidate => candidate.id).sort();
const fields = ['requestId', 'revision', 'weeklyMinutes', 'excludedIds', 'adjustmentReason'];
const validIdentifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
export function parseWeeklyPlanSave(value: unknown): WeeklyPlanSave {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StudyError('INVALID_INPUT');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== fields.length || Object.keys(input).some(key => !fields.includes(key))) throw new StudyError('INVALID_INPUT');
  if (!validIdentifier(input.requestId)) throw new StudyError('INVALID_REQUEST_ID');
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0) throw new StudyError('INVALID_REVISION');
  if (!Number.isSafeInteger(input.weeklyMinutes) || (input.weeklyMinutes as number) < 0 || (input.weeklyMinutes as number) > 10080) throw new StudyError('INVALID_WEEKLY_MINUTES');
  if (!Array.isArray(input.excludedIds) || input.excludedIds.length > 1000
    || Array.from(input.excludedIds).some(id => !validIdentifier(id))
    || new Set(input.excludedIds).size !== input.excludedIds.length) throw new StudyError('INVALID_EXCLUSIONS');
  if (typeof input.adjustmentReason !== 'string' || input.adjustmentReason.length > 500) throw new StudyError('INVALID_ADJUSTMENT_REASON');
  if (input.excludedIds.length && !input.adjustmentReason.trim()) throw new StudyError('ADJUSTMENT_REASON_REQUIRED');
  return { requestId: input.requestId, revision: input.revision as number, weeklyMinutes: input.weeklyMinutes as number,
    excludedIds: [...input.excludedIds].sort(), adjustmentReason: input.adjustmentReason };
}
export async function initializeWeeklyPlanSchema(db: Pick<SchemaDatabase, 'exec'>) {
  await initializeOwnerAccess(db);
  await db.exec(`CREATE TABLE IF NOT EXISTS weekly_plans (
    owner_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, updated_at TEXT NOT NULL,
    profile_revision INTEGER NOT NULL, weekly_minutes INTEGER NOT NULL, excluded_ids JSONB NOT NULL,
    adjustment_reason TEXT NOT NULL, plan JSONB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS weekly_plan_requests (
    owner_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, response JSONB NOT NULL,
    PRIMARY KEY(owner_id,request_id)
  )`);
}
export async function readWeeklyPlanRecord(tx: OwnerTransaction, owner: string): Promise<WeeklyPlanRecord | null> {
  return (await tx.query<WeeklyPlanRecord>(`SELECT revision,updated_at AS "updatedAt",profile_revision AS "profileRevision",
    weekly_minutes AS "weeklyMinutes",excluded_ids AS "excludedIds",adjustment_reason AS "adjustmentReason",plan
    FROM weekly_plans WHERE owner_id=$1`, [owner])).rows[0] ?? null;
}
function weekStart(at: Date) {
  const day = new Date(at.getTime() + 9 * 60 * 60 * 1000);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return day.toISOString().slice(0, 10);
}
/** Only real development inventory is mapped, never inferred from confidence or unseen counts. */
function candidatesFor(catalog: readonly SubjectPack[]): PlanCandidate[] {
  const prompt = cafePrompt();
  return catalog.filter(pack => pack.active).flatMap(pack => pack.concepts.filter(concept =>
    concept.subjectId === pack.subjectId && concept.subjectId === 'bookkeeping'
    && concept.conceptId === prompt.conceptId && concept.conceptVersion === prompt.caseVersion)
    .map(concept => ({ subjectId: concept.subjectId, conceptId: concept.conceptId, conceptVersion: concept.conceptVersion,
      id: concept.conceptId, label: concept.label, familyId: prompt.familyId, minutes: concept.durationMinutes,
      bucket: 'new' as const, qualification: 'practice' as const, unseen: false, differentFormat: false, sourceTrust: 1,
      priority: { importance: concept.importance, observedExamScoreRatio: null, reviewStatus: 'unknown' as const,
        recentMisconceptions: [], lockedDirectSuccessors: 0, observedMinutes: null, designedMinutes: concept.durationMinutes },
    })));
}
/** Profile schema must already exist on this same DB; no external authentication or AI is implied. */
export async function createWeeklyPlanService(db: SchemaDatabase, catalog: readonly SubjectPack[], now = () => new Date()) {
  await initializeWeeklyPlanSchema(db);
  return createWeeklyPlanServiceOnPreparedDatabase(db, catalog, now);
}

/** Uses prepared profile/plan/owner tables without schema initialization. */
export function createWeeklyPlanServiceOnPreparedDatabase(db: TransactionDatabase, catalog: readonly SubjectPack[], now = () => new Date(), inventory?: PlanInventory) {
  // Production inventory is explicitly supplied by the server; never manufacture it from concepts.
  const currentCandidates = () => inventory ? [...inventory.candidates] : candidatesFor(catalog);
  function clock() {
    const at = now();
    if (!Number.isFinite(at.getTime())) throw new StudyError('INVALID_CLOCK', 500);
    return at;
  }
  const profile = async (tx: OwnerTransaction, owner: string): Promise<CurrentProfile> => (await tx.query<CurrentProfile>(
    'SELECT revision,exam_subjects,reports FROM confidence_profiles WHERE owner_id=$1', [owner])).rows[0]
    ?? { revision: 0, exam_subjects: null, reports: [] };
  const response = (planRecord: WeeklyPlanRecord | null, current: CurrentProfile, at: Date, currentRevision: number): WeeklyPlanResponse => {
    const candidates = currentCandidates(), autoSkippedIds = automaticSkips(candidates, current);
    let stale = !!planRecord && (planRecord.profileRevision !== current.revision
      || planRecord.plan.weekStart !== weekStart(at) || planRecord.revision !== currentRevision);
    if (planRecord && !stale) {
      const excludedIds = [...new Set([...planRecord.excludedIds, ...autoSkippedIds])].sort();
      if (excludedIds.some(id => !candidates.some(candidate => candidate.id === id))) stale = true;
      else {
        const expected = createWeeklyPlan({ weekStart: weekStart(at), weeklyMinutes: planRecord.weeklyMinutes,
          examSubjects: current.exam_subjects, candidates, excludedIds });
        stale = canonical(expected) !== canonical(planRecord.plan);
      }
    }
    return { planRecord, stale, developmentOnly: inventory?.developmentOnly ?? true, candidates, autoSkippedIds };
  };
  return {
    async get(owner: string): Promise<WeeklyPlanResponse> {
      return db.transaction(async tx => {
        await assertOwnerActive(tx, owner);
        const record = await readWeeklyPlanRecord(tx, owner);
        return response(record, await profile(tx, owner), clock(), record?.revision ?? 0);
      });
    },
    async save(owner: string, raw: WeeklyPlanSave): Promise<WeeklyPlanResponse> {
      const input = parseWeeklyPlanSave(raw);
      const fingerprint = createHash('sha256').update(JSON.stringify({ revision: input.revision,
        weeklyMinutes: input.weeklyMinutes, excludedIds: input.excludedIds, adjustmentReason: input.adjustmentReason })).digest('hex');
      return db.transaction(async tx => {
        await assertOwnerActive(tx, owner);
        const at = clock(), currentProfile = await profile(tx, owner);
        const previous = await readWeeklyPlanRecord(tx, owner);
        const receipt = (await tx.query<{ fingerprint: string; response: WeeklyPlanRecord }>(
          'SELECT fingerprint,response FROM weekly_plan_requests WHERE owner_id=$1 AND request_id=$2', [owner, input.requestId])).rows[0];
        if (receipt) {
          if (receipt.fingerprint !== fingerprint) throw new StudyError('REQUEST_CONFLICT', 409);
          return response(receipt.response, currentProfile, at, previous?.revision ?? 0);
        }
        if ((previous?.revision ?? 0) !== input.revision) throw new StudyError('REVISION_CONFLICT', 409);
        const candidates = currentCandidates();
        if (input.excludedIds.some(id => !candidates.some(candidate => candidate.id === id))) throw new StudyError('UNKNOWN_PLAN_CANDIDATE');
        const plan = createWeeklyPlan({ weekStart: weekStart(at), weeklyMinutes: input.weeklyMinutes,
          examSubjects: currentProfile.exam_subjects, candidates,
          excludedIds: [...new Set([...input.excludedIds, ...automaticSkips(candidates, currentProfile)])].sort() });
        const saved: WeeklyPlanRecord = { revision: input.revision + 1, updatedAt: at.toISOString(), profileRevision: currentProfile.revision,
          weeklyMinutes: input.weeklyMinutes, excludedIds: input.excludedIds, adjustmentReason: input.adjustmentReason, plan };
        await tx.query(`INSERT INTO weekly_plans VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)
          ON CONFLICT(owner_id) DO UPDATE SET revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at,
          profile_revision=EXCLUDED.profile_revision,weekly_minutes=EXCLUDED.weekly_minutes,
          excluded_ids=EXCLUDED.excluded_ids,adjustment_reason=EXCLUDED.adjustment_reason,plan=EXCLUDED.plan`,
          [owner, saved.revision, saved.updatedAt, saved.profileRevision, saved.weeklyMinutes,
            JSON.stringify(saved.excludedIds), saved.adjustmentReason, JSON.stringify(plan)]);
        await tx.query('INSERT INTO weekly_plan_requests VALUES ($1,$2,$3,$4::jsonb)',
          [owner, input.requestId, fingerprint, JSON.stringify(saved)]);
        return response(saved, currentProfile, at, saved.revision);
      });
    },
  };
}
