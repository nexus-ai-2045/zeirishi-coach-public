import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeeklyPlan, type PlanCandidate, type WeeklyPlanInput } from '../src/domain/weekly-plan';
const candidate = (id: string, patch: Partial<PlanCandidate> = {}): PlanCandidate => ({
  id, subjectId: 'bookkeeping', conceptId: id, conceptVersion: 'v1', label: id, familyId: id, minutes: 5,
  bucket: 'new', qualification: 'practice', unseen: false, differentFormat: false, sourceTrust: 1,
  priority: { importance: 3, observedExamScoreRatio: null, reviewStatus: 'unknown', recentMisconceptions: [],
    lockedDirectSuccessors: 0, observedMinutes: null, designedMinutes: 5 }, ...patch,
});
const base: WeeklyPlanInput = { weekStart: '2026-09-07', weeklyMinutes: 20, examSubjects: ['bookkeeping'],
  candidates: [candidate('prepaid')], excludedIds: [] };
test('週計画は受験予定の未回答・なし・教材不足を区別し、架空の予定を作らない', () => {
  assert.equal(createWeeklyPlan({ ...base, examSubjects: null }).status, 'subjects-unset');
  assert.equal(createWeeklyPlan({ ...base, examSubjects: [] }).status, 'no-subjects');
  const result = createWeeklyPlan(base);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.allocatedMinutes, 5);
  assert.equal(result.remainingMinutes, 15);
  assert.equal(result.status, 'inventory-shortage');
  assert.equal(result.sessions[0].qualification, 'practice');
  assert.match(result.sessions[0].reason, /練習枠/);
  assert.equal(createWeeklyPlan({ ...base, examSubjects: ['corporation-tax'] }).sessions.length, 0);
  assert.deepEqual(createWeeklyPlan({ ...base, examSubjects: ['corporation-tax'] }).unavailableSubjects, ['corporation-tax']);
});
test('60/25/15を問題数でなく時間に適用し、候補不足は他枠へ振り替える', () => {
  const stock: PlanCandidate[] = [];
  for (const bucket of ['weak', 'review', 'new'] as const) {
    for (let i = 0; i < 30; i++) stock.push(candidate(`${bucket}-${i}`, { bucket, minutes: 1 }));
  }
  const result = createWeeklyPlan({ ...base, candidates: stock });
  assert.deepEqual(result.allocated, { weak: 12, review: 5, new: 3 });
  assert.equal(result.allocatedMinutes, 20);
  const transferred = createWeeklyPlan({ ...base, candidates: stock.filter(c => c.bucket === 'new') });
  assert.equal(transferred.allocated.new, 20);
  assert.equal(transferred.remainingMinutes, 0);
  assert.equal(transferred.status, 'planned');
});
test('各受験科目の最低枠を先に確保し、時間不足の順番を翌週に回す', () => {
  const input = { ...base, weeklyMinutes: 5, examSubjects: ['bookkeeping', 'corporation-tax'] as WeeklyPlanInput['examSubjects'],
    candidates: [candidate('a'), candidate('b', { subjectId: 'corporation-tax' })] };
  const first = createWeeklyPlan(input);
  const next = createWeeklyPlan({ ...input, weekStart: '2026-09-14' });
  assert.equal(first.sessions.length, 1);
  assert.equal(first.deferredSubjects.length, 1);
  assert.notEqual(first.sessions[0].subjectId, next.sessions[0].subjectId);
  const enough = createWeeklyPlan({ ...input, weeklyMinutes: 10 });
  assert.equal(enough.sessions.length, 2);
  assert.equal(enough.deferredSubjects.length, 0);
});
test('除外・同一family・時間上限・決定的同点処理を守り、元入力を変更しない', () => {
  const input = { ...base, candidates: [candidate('a', { qualification: 'eligible' }), candidate('b', { familyId: 'a', unseen: true, qualification: 'eligible' }), candidate('c')] };
  const snapshot = JSON.stringify(input);
  const result = createWeeklyPlan(input);
  assert.deepEqual(result.sessions.map(c => c.id), ['b', 'c']);
  assert.deepEqual(createWeeklyPlan({ ...input, excludedIds: ['b'] }).sessions.map(c => c.id), ['a', 'c']);
  assert.equal(createWeeklyPlan({ ...base, weeklyMinutes: 4 }).sessions.length, 0);
  assert.equal(createWeeklyPlan({ ...base, weeklyMinutes: 0 }).allocatedMinutes, 0);
  assert.equal(JSON.stringify(input), snapshot);
});
test('長い高優先候補で別科目の最低枠を奪わず、別セッションの練習は同familyでも許す', () => {
  const input: WeeklyPlanInput = { ...base, weekStart: '2026-09-14', examSubjects: ['bookkeeping', 'corporation-tax'],
    candidates: [candidate('a-long', { minutes: 20 }), candidate('a-short'), candidate('b-short', { subjectId: 'corporation-tax' })] };
  assert.equal(createWeeklyPlan(input).deferredSubjects.length, 0);
  assert.equal(createWeeklyPlan(input).sessions.length, 2);
  assert.equal(createWeeklyPlan({ ...base, candidates: [candidate('a'), candidate('b', { familyId: 'a' })] }).sessions.length, 2);
});
test('不正な週・予算・科目・疎配列・重複候補をfail closedで拒否する', () => {
  for (const patch of [{ weekStart: '2026-02-30' }, { weekStart: '2026-09-08' }, { weeklyMinutes: NaN },
    { weeklyMinutes: -1 }, { weeklyMinutes: 10081 }, { weeklyMinutes: 1.5 }, { candidates: Array(1) },
    { candidates: [candidate('a'), candidate('a')] }, { candidates: [candidate('a', { minutes: 0 })] },
    { excludedIds: ['missing'] }, { excludedIds: Array(1) }, { excludedIds: ['prepaid', 'prepaid'] }]) {
    assert.throws(() => createWeeklyPlan({ ...base, ...patch } as WeeklyPlanInput));
  }
});
