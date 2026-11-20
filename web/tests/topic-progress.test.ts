import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, countStages, dueCards, topicProgress, topicProgressMap, topicQuestions } from '../src/domain/topic-progress';
import { SUBJECT_SAMPLE_CATALOG } from '../src/server/subject-samples';
import { parseReviewCheck } from '../src/http/practice-progress-handler';

const day = (iso: string) => iso.slice(0, 10);
const q = new Set(['case-a']);
const answer = (at: string, correct: boolean) => ({ caseVersion: 'case-a', submittedAt: `${at}T09:00:00.000Z`, correct });
const check = (at: string, remembered: boolean) => ({ checkedAt: `${at}T10:00:00.000Z`, remembered });

test('問題のない論点は「問題なし」、未回答は「まだ」、直近が不正解なら「もう一度」', () => {
  assert.equal(topicProgress(new Set(), [], [], day).stage, 'none');
  assert.equal(topicProgress(q, [], [], day).stage, 'new');
  assert.equal(topicProgress(q, [answer('2026-11-01', false)], [], day).stage, 'retry');
  assert.equal(topicProgress(q, [answer('2026-11-01', true), answer('2026-11-02', false)], [], day).stage, 'retry');
  assert.equal(topicProgress(q, [{ ...answer('2026-11-01', true), caseVersion: 'other' }], [], day).stage, 'new');
});

test('正解すると「理解した」になり、翌日に最初のカードが出る', () => {
  const progress = topicProgress(q, [answer('2026-11-01', false), answer('2026-11-01', true)], [], day);
  assert.deepEqual(progress, { stage: 'understood', step: 0, dueDay: '2026-11-02' });
});

test('1日・3日・7日のカードで3回続けて覚えていたら「覚えた」、その後は21日ごと', () => {
  const records = [answer('2026-11-01', true)];
  const one = topicProgress(q, records, [check('2026-11-02', true)], day);
  assert.deepEqual(one, { stage: 'understood', step: 1, dueDay: '2026-11-05' });
  const three = topicProgress(q, records, [check('2026-11-02', true), check('2026-11-05', true)], day);
  assert.deepEqual(three, { stage: 'understood', step: 2, dueDay: '2026-11-12' });
  const seven = topicProgress(q, records, [check('2026-11-02', true), check('2026-11-05', true), check('2026-11-12', true)], day);
  assert.deepEqual(seven, { stage: 'memorized', step: 3, dueDay: '2026-12-03' });
});

test('忘れていたら1日後に戻り、期日前のチェックは数えない', () => {
  const records = [answer('2026-11-01', true)];
  assert.deepEqual(topicProgress(q, records, [check('2026-11-02', true), check('2026-11-05', false)], day), { stage: 'understood', step: 0, dueDay: '2026-11-06' });
  assert.deepEqual(topicProgress(q, records, [check('2026-11-01', true), check('2026-11-02', true), check('2026-11-03', true)], day), { stage: 'understood', step: 1, dueDay: '2026-11-05' });
  const memorized = [check('2026-11-02', true), check('2026-11-05', true), check('2026-11-12', true)];
  assert.equal(topicProgress(q, records, [...memorized, check('2026-12-03', false)], day).stage, 'understood');
});

test('期日の来たカードを古い順に出し、「もう一度」の論点は出さない', () => {
  const progress = new Map([
    ['a', { stage: 'understood' as const, step: 0, dueDay: '2026-11-03' }],
    ['b', { stage: 'understood' as const, step: 1, dueDay: '2026-11-01' }],
    ['c', { stage: 'understood' as const, step: 0, dueDay: '2026-11-09' }],
    ['d', { stage: 'retry' as const, step: 0, dueDay: '2026-11-01' }],
    ['e', { stage: 'new' as const, step: 0, dueDay: null }],
  ]);
  assert.deepEqual(dueCards(progress, '2026-11-03'), ['b', 'a']);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('全10科目の地図で、確認問題のある論点を数えられる', () => {
  for (const pack of SUBJECT_SAMPLE_CATALOG) {
    const map = pack.subjectMap!;
    const withQuestion = map.topics.filter(topic => topicQuestions(map, topic.topicId).size > 0);
    assert.ok(withQuestion.length >= 3, map.subjectId);
    const caseVersion = [...topicQuestions(map, withQuestion[0].topicId)][0];
    const stages = topicProgressMap(map, [{ caseVersion, submittedAt: '2026-11-01T00:00:00.000Z', correct: true }], [], day);
    const counts = countStages([...stages.values()].map(item => item.stage));
    assert.equal(counts.understood, 1, map.subjectId);
    assert.equal(counts.none, map.topics.length - withQuestion.length);
  }
});

test('復習カードの記録は決まった項目だけ受け付ける', () => {
  const ok = { requestId: crypto.randomUUID(), subjectId: 'income-tax', topicId: 'topic-x', remembered: true };
  assert.deepEqual(parseReviewCheck(ok), ok);
  for (const bad of [{ ...ok, remembered: 'yes' }, { ...ok, extra: 1 }, { ...ok, topicId: '../x' }, { ...ok, requestId: 'nope' }, null, []])
    assert.throws(() => parseReviewCheck(bad));
});

test('復習カードの記録は同じ要求を二重に数えず、本人の書き出しに入り、データ削除で消える', async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  const { createReviewCardService } = await import('../src/server/review-card-service');
  const { createCafeService } = await import('../src/server/cafe-service');
  const { createDataService } = await import('../src/server/data-service');
  const { createStudyService } = await import('../src/server/study-service');
  const { createConfidenceService } = await import('../src/server/confidence-service');
  const { createWeeklyPlanService } = await import('../src/server/weekly-plan-service');
  const { createMockExamService } = await import('../src/server/mock-exam-service');
  const db = new PGlite();
  try {
    await createStudyService(db); await createCafeService(db); await createConfidenceService(db, []);
    await createWeeklyPlanService(db, []); await createMockExamService(db);
    const cards = await createReviewCardService(db, () => new Date('2026-11-20T01:00:00.000Z'));
    const data = await createDataService(db);
    const owner = crypto.randomUUID(), other = crypto.randomUUID(), requestId = crypto.randomUUID();
    const input = { requestId, subjectId: 'income-tax', topicId: 'topic-x', remembered: true };
    await cards.record(owner, input); await cards.record(owner, input);
    await cards.record(other, { ...input, requestId: crypto.randomUUID() });
    assert.deepEqual(await cards.checks(owner), [{ subjectId: 'income-tax', topicId: 'topic-x', checkedAt: '2026-11-20T01:00:00.000Z', remembered: true }]);
    await assert.rejects(cards.record(owner, { ...input, topicId: '../x' }));
    const exported = await data.export(owner) as { reviewCards?: unknown[] };
    assert.deepEqual(exported.reviewCards, [{ subjectId: 'income-tax', topicId: 'topic-x', checkedAt: '2026-11-20T01:00:00.000Z', remembered: true }]);
    await data.delete(owner);
    await assert.rejects(cards.checks(owner));
    assert.equal((await db.query<{ n: number }>('SELECT count(*)::int AS n FROM review_card_checks WHERE owner_id=$1', [owner])).rows[0].n, 0);
    assert.equal((await cards.checks(other)).length, 1);
  } finally { await db.close(); }
});
