import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOKKEEPING_TRIAL_CHOICES, BOOKKEEPING_TRIAL_MAP } from '../src/server/bookkeeping-trial-supply';
import { DEVELOPMENT_BOOKKEEPING_MAP } from '../src/server/development-subject-map';
import { DEVELOPMENT_CAFE_MATERIAL } from '../src/server/cafe-case';
import { availableCasesForConcept, caseCountNotice, resolveTopicConcepts, startableCaseCount } from '../src/domain/bookkeeping-overview';

const INTRO = ['cash-is-not-profit', 'double-entry', 'prepaid-expenses'];
const cafe = DEVELOPMENT_CAFE_MATERIAL.prompt();
const developmentChoices = [{ subjectId: 'bookkeeping', conceptId: cafe.conceptId, conceptVersion: DEVELOPMENT_CAFE_MATERIAL.caseVersion,
  materialId: cafe.caseId, caseVersion: DEVELOPMENT_CAFE_MATERIAL.caseVersion, label: cafe.consultationTitle }];

test('trial map: the consultation for prepaid expenses is found although the map version differs from the concept version', () => {
  const prepaid = BOOKKEEPING_TRIAL_MAP.concepts.find(item => item.conceptId === 'prepaid-expenses')!;
  assert.notEqual(BOOKKEEPING_TRIAL_MAP.version, prepaid.conceptVersion);
  const found = availableCasesForConcept(BOOKKEEPING_TRIAL_MAP, BOOKKEEPING_TRIAL_CHOICES, 'prepaid-expenses');
  assert.deepEqual(found.map(item => item.materialId), ['cafe-prepaid']);
});

test('trial map: every concept finds exactly the consultations the supply offers for it, and no more', () => {
  let total = 0;
  for (const concept of BOOKKEEPING_TRIAL_MAP.concepts) {
    const offered = BOOKKEEPING_TRIAL_CHOICES.filter(choice => choice.conceptId === concept.conceptId).map(choice => choice.materialId);
    const found = availableCasesForConcept(BOOKKEEPING_TRIAL_MAP, BOOKKEEPING_TRIAL_CHOICES, concept.conceptId).map(choice => choice.materialId);
    assert.deepEqual(found, offered, concept.conceptId);
    total += found.length;
  }
  assert.equal(total, BOOKKEEPING_TRIAL_CHOICES.length);
  assert.deepEqual(availableCasesForConcept(BOOKKEEPING_TRIAL_MAP, BOOKKEEPING_TRIAL_CHOICES, 'double-entry'), []);
});

test('a candidate whose case version or concept version is not the mapped one is never offered', () => {
  const stale = BOOKKEEPING_TRIAL_CHOICES.map(choice => ({ ...choice, caseVersion: 'stale-case-version' }));
  assert.deepEqual(availableCasesForConcept(BOOKKEEPING_TRIAL_MAP, stale, 'prepaid-expenses'), []);
  const oldConcept = BOOKKEEPING_TRIAL_CHOICES.map(choice => ({ ...choice, conceptVersion: 'stale-concept-version' }));
  assert.deepEqual(availableCasesForConcept(BOOKKEEPING_TRIAL_MAP, oldConcept, 'prepaid-expenses'), []);
  const otherSubject = BOOKKEEPING_TRIAL_CHOICES.map(choice => ({ ...choice, subjectId: 'financial-statements' }));
  assert.deepEqual(availableCasesForConcept(BOOKKEEPING_TRIAL_MAP, otherSubject, 'prepaid-expenses'), []);
  assert.deepEqual(availableCasesForConcept(BOOKKEEPING_TRIAL_MAP, BOOKKEEPING_TRIAL_CHOICES, 'unknown-concept'), []);
  assert.deepEqual(availableCasesForConcept(undefined, BOOKKEEPING_TRIAL_CHOICES, 'prepaid-expenses'), []);
});

test('development map: the cafe consultation is offered for prepaid expenses only', () => {
  assert.deepEqual(availableCasesForConcept(DEVELOPMENT_BOOKKEEPING_MAP, developmentChoices, 'prepaid-expenses').map(item => item.materialId), ['cafe-prepaid']);
  assert.deepEqual(availableCasesForConcept(DEVELOPMENT_BOOKKEEPING_MAP, developmentChoices, 'cash-is-not-profit'), []);
});

test('trial map: only the three introduction concepts can be explained by the introduction; the other topics keep their own concept', () => {
  const outside = BOOKKEEPING_TRIAL_MAP.topics.filter(topic => resolveTopicConcepts(BOOKKEEPING_TRIAL_MAP, topic.topicId, INTRO).introConceptId === null);
  assert.equal(BOOKKEEPING_TRIAL_MAP.topics.length, 36);
  assert.equal(outside.length, 33);
  for (const topic of outside) {
    const resolved = resolveTopicConcepts(BOOKKEEPING_TRIAL_MAP, topic.topicId, INTRO);
    assert.equal(resolved.unconnected, false, topic.topicId);
    assert.deepEqual(resolved.otherConcepts.map(item => item.conceptId), [topic.topicId.replace(/^topic-/, '')], topic.topicId);
  }
  for (const id of INTRO) {
    const resolved = resolveTopicConcepts(BOOKKEEPING_TRIAL_MAP, `topic-${id}`, INTRO);
    assert.equal(resolved.introConceptId, id);
    assert.deepEqual(resolved.otherConcepts, []);
  }
});

test('development map: shared topics resolve to the first introduction concept, and an unconnected topic stays unconnected', () => {
  assert.equal(resolveTopicConcepts(DEVELOPMENT_BOOKKEEPING_MAP, 'period-expense', INTRO).introConceptId, 'cash-is-not-profit');
  assert.equal(resolveTopicConcepts(DEVELOPMENT_BOOKKEEPING_MAP, 'prepaid-assets', INTRO).introConceptId, 'prepaid-expenses');
  const unconnected = resolveTopicConcepts(DEVELOPMENT_BOOKKEEPING_MAP, 'unconnected-topic', INTRO);
  assert.deepEqual({ unconnected: unconnected.unconnected, introConceptId: unconnected.introConceptId, others: unconnected.otherConcepts.length },
    { unconnected: true, introConceptId: null, others: 0 });
  assert.equal(resolveTopicConcepts(DEVELOPMENT_BOOKKEEPING_MAP, 'no-such-topic', INTRO).unconnected, true);
});

test('the number of consultations comes from the supplied candidates that the map really connects', () => {
  assert.equal(startableCaseCount(BOOKKEEPING_TRIAL_MAP, BOOKKEEPING_TRIAL_CHOICES, 'bookkeeping'), 35);
  assert.equal(startableCaseCount(DEVELOPMENT_BOOKKEEPING_MAP, developmentChoices, 'bookkeeping'), 1);
  assert.equal(startableCaseCount(BOOKKEEPING_TRIAL_MAP, [], 'bookkeeping'), 0);
  assert.equal(startableCaseCount(null, BOOKKEEPING_TRIAL_CHOICES, 'bookkeeping'), 0);
  assert.equal(startableCaseCount(BOOKKEEPING_TRIAL_MAP, BOOKKEEPING_TRIAL_CHOICES, 'financial-statements'), 0);
  const stale = BOOKKEEPING_TRIAL_CHOICES.map(choice => ({ ...choice, caseVersion: 'stale-case-version' }));
  assert.equal(startableCaseCount(BOOKKEEPING_TRIAL_MAP, stale, 'bookkeeping'), 0);
  const duplicated = [...developmentChoices, ...developmentChoices];
  assert.equal(startableCaseCount(DEVELOPMENT_BOOKKEEPING_MAP, duplicated, 'bookkeeping'), 1);
});

test('the case-count notice states the real count and never claims a single case when there are more', () => {
  assert.equal(caseCountNotice('簿記論', 35), '現在、相談できる簿記論のケースは35件です。');
  assert.equal(caseCountNotice('簿記論', 1), '現在、相談できる簿記論のケースは1件です。');
  assert.equal(caseCountNotice('簿記論', 0), '現在、相談できる簿記論のケースはありません。');
  assert.doesNotMatch(caseCountNotice('簿記論', 35), /1ケースのみ/);
});
