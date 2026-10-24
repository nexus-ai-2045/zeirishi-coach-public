import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBJECTS, OnboardingInputError, parseSubjectId, parseSelfConfidence, parseConfidenceReport, parseExamSubjects,
  initialRecommendations, directSelection, shortCheckAvailability,
  type Concept, type SubjectPack, type ConfidenceReport, type SelfConfidence,
} from '../src/domain/onboarding';

const concept = (id: string, overrides: Partial<Concept> = {}): Concept => ({
  subjectId: 'bookkeeping', conceptId: id, conceptVersion: 'v2', label: id,
  importance: 3, durationMinutes: 2, unseenQuestionCount: 3, ...overrides,
});
const pack = (concepts: Concept[], active = true): SubjectPack => ({ subjectId: 'bookkeeping', version: 'pack-v2', active, concepts });
const report = (item: Concept, selfConfidence: SelfConfidence): ConfidenceReport => ({
  subjectId: item.subjectId, conceptId: item.conceptId, conceptVersion: item.conceptVersion, selfConfidence,
});

test('all eleven subjects are selectable independently of material availability', () => {
  assert.equal(SUBJECTS.length, 11);
  assert.equal(new Set(SUBJECTS.map(subject => subject.id)).size, 11);
  for (const subject of SUBJECTS) assert.equal(parseSubjectId(subject.id), subject.id);
  assert.deepEqual(initialRecommendations([], [], 'income-tax'), []);
});

test('受験予定科目はnullと空配列を区別し、有効な11科目だけを重複なく正規化する', () => {
  assert.equal(parseExamSubjects(null), null);
  assert.deepEqual(parseExamSubjects([]), []);
  const input = ['income-tax', 'bookkeeping'];
  assert.deepEqual(parseExamSubjects(input), ['bookkeeping', 'income-tax']);
  assert.deepEqual(input, ['income-tax', 'bookkeeping']);
  const all = SUBJECTS.map(subject => subject.id);
  assert.deepEqual(parseExamSubjects(all), [...all].sort());
  for (const invalid of [undefined, false, '', 'bookkeeping', {}, 1, ['unknown'], ['bookkeeping', 'bookkeeping'],
    [null], [undefined], [1], Array(1), Array(12).fill('bookkeeping')]) {
    assert.throws(() => parseExamSubjects(invalid), OnboardingInputError);
  }
});

test('skip/null leaves confidence unknown; recommendations never manufacture measured evidence', () => {
  const items = [concept('a'), concept('b'), concept('c'), concept('d')];
  const skipped = initialRecommendations([pack(items)], [], 'bookkeeping');
  assert.equal(skipped.length, 3);
  assert.deepEqual(skipped, initialRecommendations([pack(items)], [report(items[0], null)], 'bookkeeping'));
  assert.ok(skipped.every(item => item.selfConfidence === null && item.basis === 'unselected'));
  assert.equal(JSON.stringify(skipped).includes('mastery'), false);
  assert.equal(JSON.stringify(skipped).includes('attempt'), false);
});

test('all explained means no forced basics; direct selection remains possible', () => {
  const items = [concept('a'), concept('b')];
  assert.deepEqual(initialRecommendations([pack(items)], items.map(item => report(item, 'explained')), 'bookkeeping'), []);
  assert.deepEqual(directSelection([pack(items)], items[1]), items[1]);
});

test('self confidence ranks uncertain, unlearned, null; ties use importance, duration, id', () => {
  const items = [concept('null', { importance: 5 }), concept('unlearned'),
    concept('c', { durationMinutes: 1 }), concept('b', { durationMinutes: 1 }),
    concept('a', { durationMinutes: 3 }), concept('first', { importance: 4 })];
  const reports = items.slice(1).map(item => report(item, item.conceptId === 'unlearned' ? 'unlearned' : 'uncertain'));
  const before = JSON.stringify({ items, reports });
  assert.deepEqual(initialRecommendations([pack(items)], reports, 'bookkeeping').map(item => item.concept.conceptId), ['first', 'b', 'c']);
  assert.equal(JSON.stringify({ items, reports }), before);
  assert.deepEqual(initialRecommendations([pack(items.slice(0, 2))], reports, 'bookkeeping').map(item => item.selfConfidence), ['unlearned', null]);
});

test('inactive packs, wrong subjects and stale concept versions cannot become selectable', () => {
  const item = concept('a');
  assert.deepEqual(initialRecommendations([pack([item], false)], [], 'bookkeeping'), []);
  assert.equal(directSelection([pack([item], false)], item), null);
  assert.deepEqual(initialRecommendations([pack([item])], [], 'income-tax'), []);
  assert.equal(directSelection([pack([item])], { ...item, conceptVersion: 'v1' }), null);
  const stale = { ...report(item, 'explained'), conceptVersion: 'v1' };
  const candidate = initialRecommendations([pack([item])], [stale], 'bookkeeping')[0];
  assert.equal(candidate.selfConfidence, null);
  assert.equal(candidate.packVersion, 'pack-v2');
});

test('zero unseen inventory disables short check but never locks direct learning', () => {
  for (const count of [0, 1, 2, 3, 9]) {
    const item = concept('a', { unseenQuestionCount: count });
    assert.deepEqual(shortCheckAvailability([pack([item])], item), count === 0
      ? { available: false, reason: 'unseen-inventory-empty' }
      : { available: true, questionCount: Math.min(3, count), estimatedMinutes: 2 });
    assert.deepEqual(directSelection([pack([item])], item), item);
  }
  assert.deepEqual(shortCheckAvailability([], concept('a')), { available: false, reason: 'material-unavailable' });
});

test('invalid confidence, identities, ambiguous reports and invalid pack metadata fail closed', () => {
  for (const value of [undefined, '', 'mastered', 'high', 1, {}, []]) assert.throws(() => parseSelfConfidence(value), OnboardingInputError);
  for (const value of [null, 'unknown', 42]) assert.throws(() => parseSubjectId(value), OnboardingInputError);
  const item = concept('a');
  assert.throws(() => parseConfidenceReport({ ...report(item, null), mastery: true }), OnboardingInputError);
  assert.throws(() => parseConfidenceReport({ ...report(item, null), conceptVersion: '' }), OnboardingInputError);
  assert.throws(() => initialRecommendations([pack([item])], [report(item, null), report(item, 'explained')], 'bookkeeping'), OnboardingInputError);
  assert.throws(() => initialRecommendations([pack([item]), pack([item])], [], 'bookkeeping'), OnboardingInputError);
  for (const override of [{ importance: NaN }, { importance: 0 }, { importance: 6 }, { importance: 1.5 }, { durationMinutes: 0 }, { unseenQuestionCount: -1 }, { unseenQuestionCount: 1.5 }]) {
    assert.throws(() => initialRecommendations([pack([concept('a', override)])], [], 'bookkeeping'), OnboardingInputError);
  }
  assert.throws(() => initialRecommendations([pack([item, item])], [], 'bookkeeping'), OnboardingInputError);
});

test('importance accepts both integer boundaries from the specification', () => {
  for (const importance of [1, 5]) {
    assert.equal(initialRecommendations([pack([concept('a', { importance })])], [], 'bookkeeping')[0].concept.importance, importance);
  }
});
