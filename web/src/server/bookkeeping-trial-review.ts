import 'node:crypto';
import type { ConceptRef } from '../domain/onboarding';
import { StudyError } from '../domain/types';
import { strictIsoInstant } from '../domain/strict-iso-instant';
import { guardRequest } from '../http/guard';
import { jsonResponse, readLocalCookie } from '../http/local-session';
import type { TransactionDatabase } from './database';
import { assertOwnerActive } from './owner-access';
import { BOOKKEEPING_ALL_CONCEPTS } from './bookkeeping-trial-supply';
import { BOOKKEEPING_RETENTION_DRAFTS } from './bookkeeping-question-drafts';
import { getBookkeepingTrialMaterial } from './bookkeeping-trial-supply';

const DAY = 86_400_000;
export type BookkeepingTrialReviewItem = ConceptRef & {
  label: string; intervalDays: 7 | 21; familyId: string; materialId: string; caseVersion: string;
  anchorAt: string | null; scheduledFor: string | null; completedAt: string | null;
  status: 'unknown' | 'scheduled' | 'due' | 'completed'; qualification: 'practice_only';
};
export type BookkeepingTrialReview = {
  asOf: string; items: BookkeepingTrialReviewItem[]; unresolvedCompletions: number;
  developmentOnly: true; qualification: 'practice_only';
};
type CompletedCase = { caseVersion: string; scoringVersion: string; completedAt: string };
function instant(value: string) {
  return strictIsoInstant(value, () => { throw new StudyError('INVALID_REVIEW_HISTORY', 503); });
}
const key = (ref: ConceptRef) => JSON.stringify([ref.subjectId, ref.conceptId, ref.conceptVersion]);

/** A projection of the existing completed-case history, not a new schedule or mastery ledger.
 * First non-retention completion anchors a concept version; repeating practice cannot postpone it.
 * Completing a retention draft never becomes the anchor for another retention draft.
 */
export function projectBookkeepingTrialReview(rows: readonly CompletedCase[], asOf: Date): BookkeepingTrialReview {
  if (!Number.isFinite(asOf.getTime())) throw new StudyError('INVALID_CLOCK', 500);
  const current = new Set(BOOKKEEPING_ALL_CONCEPTS.map(concept => key({ subjectId: 'bookkeeping', ...concept })));
  const resolved: { concept: ConceptRef; familyId: string; completedAt: string; at: number; retention: boolean }[] = [];
  let unresolvedCompletions = 0;
  for (const row of rows) {
    const at = instant(row.completedAt);
    if (asOf.getTime() < at) continue;
    let material;
    try { material = getBookkeepingTrialMaterial({ caseVersion: row.caseVersion }); }
    catch (error) {
      if (!(error instanceof StudyError)) throw error;
      unresolvedCompletions++; continue;
    }
    if (material.scoringVersion !== row.scoringVersion) { unresolvedCompletions++; continue; }
    const prompt = material.prompt();
    const concept = material.concept ?? { subjectId: 'bookkeeping' as const, conceptId: prompt.conceptId, conceptVersion: material.caseVersion };
    if (!current.has(key(concept))) { unresolvedCompletions++; continue; }
    const retention = BOOKKEEPING_RETENTION_DRAFTS.some(item => item.question.id === prompt.caseId
      && item.question.familyId === prompt.familyId && key(item.question) === key(concept));
    resolved.push({ concept, familyId: prompt.familyId, completedAt: row.completedAt, at, retention });
  }
  const items: BookkeepingTrialReviewItem[] = [];
  for (const concept of BOOKKEEPING_ALL_CONCEPTS) {
    const ref: ConceptRef = { subjectId: 'bookkeeping', conceptId: concept.conceptId, conceptVersion: concept.conceptVersion };
    const history = resolved.filter(row => key(row.concept) === key(ref));
    const anchor = history.filter(row => !row.retention).sort((a, b) => a.at - b.at)[0];
    for (const intervalDays of [7, 21] as const) {
      const drafts = BOOKKEEPING_RETENTION_DRAFTS.filter(item => key(item.question) === key(ref)
        && item.question.familyId.endsWith(`-retain-${intervalDays}-day`));
      if (drafts.length !== 1) throw new StudyError('MATERIAL_NOT_AVAILABLE', 503);
      const draft = drafts[0];
      const material = getBookkeepingTrialMaterial({ concept: ref, materialId: draft.question.id });
      const scheduled = anchor ? anchor.at + intervalDays * DAY : null;
      const completed = scheduled === null ? undefined : history.filter(row => row.retention
        && row.familyId === draft.question.familyId && row.at >= scheduled).sort((a, b) => a.at - b.at)[0];
      items.push({ ...ref, label: concept.label, intervalDays, familyId: draft.question.familyId,
        materialId: draft.question.id, caseVersion: material.caseVersion,
        anchorAt: anchor?.completedAt ?? null, scheduledFor: scheduled === null ? null : new Date(scheduled).toISOString(),
        completedAt: completed?.completedAt ?? null, status: scheduled === null ? 'unknown'
          : completed ? 'completed' : scheduled <= asOf.getTime() ? 'due' : 'scheduled', qualification: 'practice_only' });
    }
  }
  return { asOf: asOf.toISOString(), items, unresolvedCompletions, developmentOnly: true, qualification: 'practice_only' };
}

export function createBookkeepingTrialReviewReader(db: TransactionDatabase, now = () => new Date()) {
  return async (owner: string) => db.transaction(async tx => {
    await assertOwnerActive(tx, owner);
    // Do not call CafeService.history(): it caps history at 20 and returns submission rather
    // than completion time. Do not write or purge practice/progress records from this GET.
    const rows = (await tx.query<CompletedCase>(`SELECT i.case_version AS "caseVersion", a.result->>'scoringVersion' AS "scoringVersion", i.completed_at AS "completedAt"
      FROM cafe_instances i JOIN cafe_attempts a ON a.instance_id=i.id AND a.owner_id=i.owner_id
        AND a.case_version=i.case_version AND a.result->>'caseVersion'=i.case_version
      WHERE i.owner_id=$1 AND i.status='completed' AND i.completed_at IS NOT NULL
      ORDER BY i.completed_at,i.id`, [owner])).rows;
    return projectBookkeepingTrialReview(rows, now());
  });
}

type TrialConfig = { fixtureMode?: string; bookkeepingMvp?: string; supabaseEnabled?: string };
export function createBookkeepingTrialReviewHandler(deps: {
  getDatabase: () => Promise<TransactionDatabase>;
  config: () => TrialConfig;
  now?: () => Date;
}) {
  return async (request: Request) => {
    try {
      const config = deps.config();
      guardRequest(request, config.fixtureMode);
      if (request.method !== 'GET') throw new StudyError('METHOD_NOT_ALLOWED', 405);
      if (config.bookkeepingMvp !== '1' || config.supabaseEnabled === '1') throw new StudyError('MATERIAL_NOT_AVAILABLE', 503);
      const owner = readLocalCookie(request, 'zc-user');
      if (!owner) throw new StudyError('USER_REQUIRED', 401);
      if ([...new URL(request.url).searchParams.keys()].length) throw new StudyError('INVALID_INPUT');
      return jsonResponse(await createBookkeepingTrialReviewReader(await deps.getDatabase(), deps.now)(owner));
    } catch (error) {
      return jsonResponse({ error: error instanceof StudyError ? error.code : 'INTERNAL_ERROR' }, error instanceof StudyError ? error.status : 500);
    }
  };
}
