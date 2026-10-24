import test from 'node:test';
import assert from 'node:assert/strict';
import { learningPriority, type PriorityInput } from '../src/domain/learning-priority';

const base: PriorityInput = {
  importance: 3, observedExamScoreRatio: null, reviewStatus: 'unknown',
  recentMisconceptions: [], lockedDirectSuccessors: 0, observedMinutes: null, designedMinutes: 5,
};
test('学習優先度は設計の係数を公開し、未観測を低得点や合格確率に変えない', () => {
  const result = learningPriority(base);
  assert.equal(result.score, 0.6);
  assert.equal(result.basis, 'unmeasured');
  assert.equal(result.ruleVersion, 'learning-priority-v1');
  assert.deepEqual(result.factors, { importance: 3, masteryGap: 1, forgettingRisk: 1,
    recurrence: 1, prerequisiteImpact: 1, minutes: 5 });
  assert.equal(learningPriority({ ...base, observedExamScoreRatio: 1 }).factors.masteryGap, 0.2);
  assert.equal(learningPriority({ ...base, observedExamScoreRatio: 0 }).basis, 'observed-exam-score');
});
test('期限・同じ誤概念の再発・直接後続・実測時間を独立に反映する', () => {
  assert.equal(learningPriority({ ...base, reviewStatus: 'today' }).factors.forgettingRisk, 1.5);
  const result = learningPriority({ ...base, reviewStatus: 'overdue', recentMisconceptions: ['a', null, 'b', 'a', null],
    lockedDirectSuccessors: 99, observedMinutes: 0.5 });
  assert.equal(result.score, 21);
  assert.equal(result.factors.minutes, 1);
  assert.equal(learningPriority({ ...base, recentMisconceptions: ['a', 'b'] }).factors.recurrence, 1);
  assert.equal(base.recentMisconceptions.length, 0);
});
test('不正な比率・履歴・時間を黙って補正しない', () => {
  for (const patch of [{ importance: 0 }, { importance: 1.5 }, { observedExamScoreRatio: NaN },
    { observedExamScoreRatio: -0.1 }, { observedExamScoreRatio: 1.1 }, { designedMinutes: 0 },
    { observedMinutes: Infinity }, { observedMinutes: -1 }, { lockedDirectSuccessors: -1 },
    { recentMisconceptions: Array(6).fill(null) }, { recentMisconceptions: Array(2) },
    { recentMisconceptions: [''] }, { reviewStatus: 'invalid' }]) {
    assert.throws(() => learningPriority({ ...base, ...patch } as PriorityInput), /INVALID_PRIORITY_INPUT/);
  }
});
