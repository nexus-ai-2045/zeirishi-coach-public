import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceReviewSchedule as advance, REVIEW_RULES_VERSION, type ReviewScheduleEvent as Event } from '../src/domain/review-schedule';
const evidence = (id: string, at: string, patch: Partial<Event> = {}): Event => ({
  eventId: id, subjectId: 'bookkeeping', conceptId: 'prepaid-expenses', conceptVersion: 'v1',
  questionId: id, questionVersion: 'v1', questionFamilyId: `family-${id}`, scoringVersion: 'v1',
  rulesVersion: REVIEW_RULES_VERSION, occurredAt: at, sourceKind: 'formal', reviewStatus: 'approved',
  scoringAuthority: 'reviewed_rules', measurementQuality: 'verified', outcome: 'met', hintsUsed: 0,
  aiAnswerViewed: false, ...patch,
});
const first = evidence('a', '2026-09-08T10:00:00Z');
test('復習は1・3・7・21日へ進み21日を超えず、再送で二重更新しない', () => {
  let state = advance(null, first);
  assert.equal(state.intervalDays, 1);
  for (const [id, expected] of [['b', 3], ['c', 7], ['d', 21], ['e', 21]] as const) {
    const next = evidence(id, state.nextReviewAt!);
    state = advance(state, next);
    assert.equal(state.intervalDays, expected);
    assert.deepEqual(advance(state, next), state);
  }
  assert.equal(state.events.length, 5);
  assert.equal(state.rulesVersion, REVIEW_RULES_VERSION);
});
test('practice・AI案閲覧・旧ログ・未審査・自己申告は予定を作らず進めず戻さない', () => {
  const state = advance(null, first);
  const patches: Partial<Event>[] = [{ sourceKind: 'practice' }, { sourceKind: 'legacy_unverified' },
    { sourceKind: 'fixture' }, { aiAnswerViewed: true }, { reviewStatus: 'unreviewed' },
    { reviewStatus: 'withdrawn' }, { scoringAuthority: 'ai' }, { scoringAuthority: 'self_reported' },
    { measurementQuality: 'unverified' }];
  for (const patch of patches) {
    const event = evidence('b', '2026-09-12T10:00:00Z', { ...patch, outcome: 'not_met', hintsUsed: 1 });
    assert.equal(advance(null, event).nextReviewAt, null);
    assert.equal(advance(state, event).nextReviewAt, state.nextReviewAt);
  }
});
test('当該概念の正式な未達・ヒントは翌日へ戻り、同日・期限前の正答は進めない', () => {
  const state = advance(null, first);
  assert.equal(advance(state, evidence('b', '2026-09-08T11:00:00Z')).nextReviewAt, state.nextReviewAt);
  // JST翌日でも24時間未経過なら期限前。
  assert.equal(advance(state, evidence('c', '2026-09-08T16:00:00Z')).nextReviewAt, state.nextReviewAt);
  const progressed = advance(state, evidence('d', state.nextReviewAt!));
  for (const patch of [{ outcome: 'not_met' as const }, { hintsUsed: 1 }]) {
    const reset = advance(progressed, evidence('e', '2026-09-09T11:00:00Z', patch));
    assert.equal(reset.intervalDays, 1);
    assert.equal(reset.nextReviewAt, '2026-09-10T11:00:00.000Z');
  }
  assert.equal(state.events.length, 1);
});
test('異概念・版違い・古いイベント・改ざん再送・改ざん予定を拒否する', () => {
  const state = advance(null, first);
  assert.throws(() => advance(state, evidence('b', first.occurredAt, { conceptId: 'another' })), /REVIEW_SCOPE_CONFLICT/);
  assert.throws(() => advance(state, evidence('b', first.occurredAt, { conceptVersion: 'v2' })), /REVIEW_SCOPE_CONFLICT/);
  assert.throws(() => advance(state, { ...first, outcome: 'not_met' }), /REVIEW_EVENT_CONFLICT/);
  assert.throws(() => advance(state, evidence('b', '2026-09-07T10:00:00Z')), /REVIEW_EVENT_OUT_OF_ORDER/);
  assert.throws(() => advance({ ...state, intervalDays: 21 }, evidence('b', state.nextReviewAt!)), /INVALID_REVIEW_STATE/);
});
test('日時は明示timezoneと実在日が必須で、等価なoffsetの再送は一致する', () => {
  const state = advance(null, first);
  assert.deepEqual(advance(state, { ...first, occurredAt: '2026-09-08T19:00:00+09:00' }), state);
  for (const at of ['2026-02-30T10:00:00Z', '2026-09-08', '2026-09-08T10:00:00', '2026-09-08T10:00:00+15:00']) {
    assert.throws(() => advance(null, evidence('b', at)), /INVALID_REVIEW_INPUT/);
  }
});
