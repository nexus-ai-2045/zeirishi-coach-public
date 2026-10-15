import { parseExamSubjects, parseConceptRef, type ConceptRef, type SubjectId } from './onboarding';
import { learningPriority, type PriorityInput } from './learning-priority';

export const WEEKLY_PLAN_VERSION = 'weekly-plan-v1' as const;
export type PlanBucket = 'weak' | 'review' | 'new';
/** Server-selected inventory only. Client input cannot establish evidence eligibility. */
export type PlanCandidate = ConceptRef & {
  id: string; label: string; familyId: string; minutes: number; bucket: PlanBucket;
  caseVersion?: string;
  qualification: 'practice' | 'eligible'; priority: PriorityInput;
  unseen: boolean; differentFormat: boolean; sourceTrust: number;
};
export type WeeklyPlanInput = {
  weekStart: string; weeklyMinutes: number; examSubjects: SubjectId[] | null;
  candidates: readonly PlanCandidate[]; excludedIds: readonly string[];
};
export type WeeklyPlan = {
  ruleVersion: typeof WEEKLY_PLAN_VERSION; weekStart: string; weeklyMinutes: number;
  allocatedMinutes: number; remainingMinutes: number; targets: Record<PlanBucket, number>;
  allocated: Record<PlanBucket, number>;
  sessions: Array<PlanCandidate & { score: number; reason: string }>;
  deferredSubjects: SubjectId[]; unavailableSubjects: SubjectId[];
  status: 'subjects-unset' | 'no-subjects' | 'planned' | 'inventory-shortage';
};

const buckets: PlanBucket[] = ['weak', 'review', 'new'];
const shares = { weak: 0.6, review: 0.25, new: 0.15 };
const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
function invalid(): never { throw new Error('INVALID_WEEKLY_PLAN'); }

/** A bounded week is recalculated from current inventory, never from accumulated overdue tasks. */
export function createWeeklyPlan(input: WeeklyPlanInput): WeeklyPlan {
  if (!input || !Number.isSafeInteger(input.weeklyMinutes) || input.weeklyMinutes < 0 || input.weeklyMinutes > 10080
    || typeof input.weekStart !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.weekStart)) invalid();
  const date = new Date(`${input.weekStart}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.weekStart || date.getUTCDay() !== 1) invalid();
  const subjects = parseExamSubjects(input.examSubjects);
  if (!Array.isArray(input.candidates) || input.candidates.length > 1000 || !Array.isArray(input.excludedIds)
    || input.excludedIds.length > 1000 || Array.from(input.excludedIds).some(value => !id(value))
    || new Set(input.excludedIds).size !== input.excludedIds.length) invalid();
  const seen = new Set<string>();
  const all = Array.from(input.candidates, (candidate: PlanCandidate) => {
    if (!candidate || typeof candidate !== 'object') invalid();
    parseConceptRef(candidate);
    if (candidate.caseVersion !== undefined && !id(candidate.caseVersion)) invalid();
    if (!id(candidate.id) || !id(candidate.familyId) || seen.has(candidate.id)
      || typeof candidate.label !== 'string' || !candidate.label.trim() || candidate.label.length > 200
      || !Number.isSafeInteger(candidate.minutes) || candidate.minutes < 1 || candidate.minutes > 10080
      || !buckets.includes(candidate.bucket) || !['practice', 'eligible'].includes(candidate.qualification)
      || typeof candidate.unseen !== 'boolean' || typeof candidate.differentFormat !== 'boolean'
      || !Number.isInteger(candidate.sourceTrust) || candidate.sourceTrust < 1 || candidate.sourceTrust > 5) invalid();
    seen.add(candidate.id);
    const ranked = learningPriority(candidate.priority);
    return { ...candidate, priority: { ...candidate.priority, recentMisconceptions: [...candidate.priority.recentMisconceptions] },
      score: ranked.score, reason: `${candidate.qualification === 'practice' ? '練習枠' : '適格教材'}。重要度${ranked.factors.importance}、忘却係数${ranked.factors.forgettingRisk}、予定${candidate.minutes}分。` };
  });
  if (input.excludedIds.some(value => !seen.has(value))) invalid();
  const excluded = new Set(input.excludedIds);
  const candidates = all.filter(c => subjects?.includes(c.subjectId) && !excluded.has(c.id));
  const compare = (a: typeof all[number], b: typeof all[number]) => b.score - a.score
    || Number(b.unseen) - Number(a.unseen) || Number(b.differentFormat) - Number(a.differentFormat)
    || b.sourceTrust - a.sourceTrust || a.id.localeCompare(b.id, 'en');
  candidates.sort(compare);
  const result: WeeklyPlan = {
    ruleVersion: WEEKLY_PLAN_VERSION, weekStart: input.weekStart, weeklyMinutes: input.weeklyMinutes,
    allocatedMinutes: 0, remainingMinutes: input.weeklyMinutes,
    targets: { weak: input.weeklyMinutes * shares.weak, review: input.weeklyMinutes * shares.review, new: input.weeklyMinutes * shares.new },
    allocated: { weak: 0, review: 0, new: 0 }, sessions: [], deferredSubjects: [], unavailableSubjects: [],
    status: subjects === null ? 'subjects-unset' : subjects.length === 0 ? 'no-subjects' : 'inventory-shortage',
  };
  if (!subjects?.length) return result;
  const families = new Set<string>();
  const selectedIds = new Set<string>();
  const familyKey = (c: PlanCandidate) => `${c.subjectId}/${c.familyId}`;
  const fits = (c: PlanCandidate) => c.minutes <= result.remainingMinutes && !selectedIds.has(c.id)
    && (c.qualification === 'practice' || !families.has(familyKey(c)));
  const take = (c: typeof all[number], reason: string) => {
    families.add(familyKey(c));
    selectedIds.add(c.id);
    result.sessions.push({ ...c, reason: `${reason} ${c.reason}` });
    result.allocated[c.bucket] += c.minutes;
    result.allocatedMinutes += c.minutes;
    result.remainingMinutes -= c.minutes;
  };
  // A rotating first subject prevents the same subject taking every short week's minimum slot.
  const week = Math.floor((date.getTime() - Date.UTC(1970, 0, 5)) / (7 * 86400000));
  const offset = ((week % subjects.length) + subjects.length) % subjects.length;
  const ordered = [...subjects.slice(offset), ...subjects.slice(0, offset)];
  for (const subject of ordered) {
    const stock = candidates.filter(c => c.subjectId === subject);
    // Protect every subject's minimum before spending remaining time on higher priorities.
    const next = stock.filter(fits).sort((a, b) => a.minutes - b.minutes || compare(a, b))[0];
    if (next) take(next, '受験予定科目の週1枠を優先。');
    else if (stock.length === 0) result.unavailableSubjects.push(subject);
    else result.deferredSubjects.push(subject);
  }
  // Allocate remaining time by the largest remaining share; transfer unavailable shares.
  // Sessions are indivisible, so exact percentages are targets, not fabricated precision.
  while (true) {
    const available = candidates.filter(fits);
    if (!available.length) break;
    const order = [...buckets].sort((a, b) => (result.targets[b] - result.allocated[b]) - (result.targets[a] - result.allocated[a]));
    const next = order.map(bucket => available.find(c => c.bucket === bucket)).find(Boolean)!;
    take(next, '時間配分60/25/15の不足枠を優先（候補不足は他枠へ移動）。');
  }
  result.status = result.remainingMinutes === 0 && !result.unavailableSubjects.length && !result.deferredSubjects.length ? 'planned' : 'inventory-shortage';
  return result;
}
