/** PRODUCT_SPEC §8 / §22.2. Evidence-based ranking, not a pass probability. */
export const PRIORITY_RULE_VERSION = 'learning-priority-v1' as const;
export type PriorityInput = {
  importance: number;
  observedExamScoreRatio: number | null;
  reviewStatus: 'unknown' | 'future' | 'today' | 'overdue';
  // Chronological concept-specific misconception IDs, oldest first, at most five.
  recentMisconceptions: readonly (string | null)[];
  lockedDirectSuccessors: number;
  observedMinutes: number | null;
  designedMinutes: number;
};

export function learningPriority(input: PriorityInput) {
  const fail = (): never => { throw new Error('INVALID_PRIORITY_INPUT'); };
  if (!input || typeof input !== 'object') fail();
  if (!Number.isInteger(input.importance) || input.importance < 1 || input.importance > 5
    || (input.observedExamScoreRatio !== null && (!Number.isFinite(input.observedExamScoreRatio)
      || input.observedExamScoreRatio < 0 || input.observedExamScoreRatio > 1))
    || !['unknown', 'future', 'today', 'overdue'].includes(input.reviewStatus)
    || !Array.isArray(input.recentMisconceptions) || input.recentMisconceptions.length > 5
    || !Number.isSafeInteger(input.lockedDirectSuccessors) || input.lockedDirectSuccessors < 0
    || !Number.isFinite(input.designedMinutes) || input.designedMinutes <= 0
    || (input.observedMinutes !== null && (!Number.isFinite(input.observedMinutes) || input.observedMinutes <= 0))) fail();
  const counts = new Map<string, number>();
  for (const id of input.recentMisconceptions) {
    if (id === null) continue;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id)) fail();
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const factors = {
    importance: input.importance,
    masteryGap: input.observedExamScoreRatio === null ? 1 : Math.max(0.2, 1 - input.observedExamScoreRatio),
    forgettingRisk: input.reviewStatus === 'overdue' ? 2 : input.reviewStatus === 'today' ? 1.5 : 1,
    recurrence: [...counts.values()].some(count => count >= 2) ? 2 : 1,
    prerequisiteImpact: 1 + Math.min(input.lockedDirectSuccessors, 3) * 0.25,
    minutes: Math.max(1, input.observedMinutes ?? input.designedMinutes),
  };
  return {
    ruleVersion: PRIORITY_RULE_VERSION,
    basis: input.observedExamScoreRatio === null ? 'unmeasured' as const : 'observed-exam-score' as const,
    factors,
    score: factors.importance * factors.masteryGap * factors.forgettingRisk
      * factors.recurrence * factors.prerequisiteImpact / factors.minutes,
  };
}
