import assert from 'node:assert/strict';
import test from 'node:test';
import { assessMastery, type MasteryMeasurement } from '../src/domain/mastery-assessment';

const base: MasteryMeasurement = {
  measurementId: 'base', subjectId: 'bookkeeping', conceptId: 'concept', conceptVersion: 'v1', criterionVersion: 'criterion-v1',
  caseId: 'case', caseVersion: 'case-v1', familyId: 'family', occurredAt: '2026-01-01T00:00:00.000Z',
  evidenceKind: 'explanation', outcome: 'met', score: 8, maxScore: 10, targetScore: 6, elapsedMinutes: 5, timeLimitMinutes: 10,
  hintsUsed: 0, aiAnswerViewed: false, sourceKind: 'formal', reviewStatus: 'approved', scoringAuthority: 'reviewed_rules',
  measurementQuality: 'verified', mixedConceptIds: [], confidence: null, confidenceFixedBeforeResult: false, invalidated: false,
};
const m = (measurementId: string, patch: Partial<MasteryMeasurement> = {}): MasteryMeasurement => ({ ...base, measurementId, ...patch });
const assess = (measurements: MasteryMeasurement[], asOf = '2026-02-01T00:00:00.000Z', prepared = true, disclosures: readonly string[] = []) => assessMastery({
  subjectId: 'bookkeeping', conceptId: 'concept', conceptVersion: 'v1', criterion: { prepared, version: prepared ? 'criterion-v1' : null },
  disclosures, measurements, asOf,
});
const foundation = (mixed = true) => [
  m('explanation', { evidenceKind: 'explanation', occurredAt: '2026-01-01T00:00:00.000Z' }),
  m('app-1', { evidenceKind: 'application', caseId: 'case-1', occurredAt: '2026-01-01T01:00:00.000Z' }),
  m('app-2', { evidenceKind: 'application', caseId: 'case-2', occurredAt: '2026-01-01T02:00:00.000Z' }),
  m('exam-1', { evidenceKind: 'exam', caseId: 'exam-case-1', familyId: 'exam-family-1', occurredAt: '2026-01-01T03:00:00.000Z', mixedConceptIds: mixed ? ['concept', 'other'] : [] }),
  m('exam-2', { evidenceKind: 'exam', caseId: 'exam-case-2', familyId: 'exam-family-2', occurredAt: '2026-01-03T03:00:00.000Z' }),
];

test('試験形式の48時間は未満では不成立、ちょうど48時間では成立する', () => {
  const exact = foundation();
  assert.equal(assess(exact).status, 'exam_confirmed');
  const short = foundation(); short[4] = { ...short[4], occurredAt: '2026-01-03T02:59:59.000Z' };
  assert.notEqual(assess(short).status, 'exam_confirmed');
});

test('21日保持は最後の適格証拠からちょうど21日後の別familyだけで成立し、介在する適格証拠が時計を更新する', () => {
  const confirmed = foundation();
  const retention = m('retention', { evidenceKind: 'retention', caseId: 'retention-case', familyId: 'retention-family', occurredAt: '2026-01-24T03:00:00.000Z' });
  assert.equal(assess([...confirmed, retention]).status, 'maintained');
  const intervening = m('intervening', { evidenceKind: 'application', caseId: 'case-3', occurredAt: '2026-01-10T03:00:00.000Z' });
  assert.equal(assess([...confirmed, intervening, retention]).status, 'exam_confirmed');
});

test('mixed問題は対象概念を含むペアでなければ試験形式確認へ昇格しない', () => {
  const noMixed = assess(foundation(false));
  assert.notEqual(noMixed.status, 'exam_confirmed');
  assert.match(noMixed.reasons.join(' '), /混合問題/);
  const mixedOther = assess(foundation(true));
  assert.equal(mixedOther.status, 'exam_confirmed');
});

test('mixed問題が同一familyの重複側にあるだけでは、異なるfamilyの確認ペアを満たさない', () => {
  const measurements = [
    ...foundation(false).slice(0, 3),
    m('exam-a', { evidenceKind: 'exam', caseId: 'exam-case-a', familyId: 'family-a', occurredAt: '2026-01-01T03:00:00.000Z' }),
    m('exam-a-mixed', { evidenceKind: 'exam', caseId: 'exam-case-a-mixed', familyId: 'family-a', occurredAt: '2026-01-02T03:00:00.000Z', mixedConceptIds: ['concept', 'other'] }),
    m('exam-b', { evidenceKind: 'exam', caseId: 'exam-case-b', familyId: 'family-b', occurredAt: '2026-01-03T03:00:00.000Z' }),
  ];
  assert.notEqual(assess(measurements).status, 'exam_confirmed');
});

test('48時間未満の開示直後の試験があっても、後続の開示間隔を満たす試験ペアは確認に使える', () => {
  const measurements = [
    ...foundation(false).slice(0, 3),
    m('exam-early', { evidenceKind: 'exam', caseId: 'exam-case-early', familyId: 'family-early', occurredAt: '2026-01-01T01:00:00.000Z', mixedConceptIds: ['concept', 'other'] }),
    m('exam-valid-1', { evidenceKind: 'exam', caseId: 'exam-case-valid-1', familyId: 'family-valid-1', occurredAt: '2026-01-03T01:00:00.000Z', mixedConceptIds: ['concept', 'other'] }),
    m('exam-valid-2', { evidenceKind: 'exam', caseId: 'exam-case-valid-2', familyId: 'family-valid-2', occurredAt: '2026-01-05T01:00:00.000Z' }),
  ];
  assert.equal(assess(measurements, '2026-02-01T00:00:00.000Z', true, ['2026-01-01T00:00:00.000Z']).status, 'exam_confirmed');
});

test('最新の正式未達は要再確認として保持し、古い昇格証拠だけで維持済みにしない', () => {
  const retained = m('retention', { evidenceKind: 'retention', familyId: 'retention-family', occurredAt: '2026-01-24T03:00:00.000Z' });
  const latestFail = m('latest-fail', { evidenceKind: 'exam', familyId: 'latest-family', occurredAt: '2026-01-25T03:00:00.000Z', outcome: 'not_met', score: 5 });
  const result = assess([...foundation(), retained, latestFail]);
  assert.equal(result.needsRecheck, true);
  assert.notEqual(result.status, 'maintained');
  assert.match(result.reasons.join(' '), /未達/);
});

test('保持後の最新未達は保持済みを取り消し、要再確認に戻す', () => {
  const retained = m('retention-0125', { evidenceKind: 'retention', familyId: 'retention-family', occurredAt: '2026-01-25T03:00:00.000Z' });
  const latestFail = m('fail-0126', { evidenceKind: 'exam', familyId: 'latest-family', occurredAt: '2026-01-26T03:00:00.000Z', outcome: 'not_met', score: 5 });
  const result = assess([...foundation(), retained, latestFail]);
  assert.equal(result.needsRecheck, true);
  assert.notEqual(result.status, 'maintained');
});

test('既達成後の時間超過は得点metでも要再確認にする', () => {
  const late = m('late-met', { evidenceKind: 'exam', familyId: 'late-family', occurredAt: '2026-01-06T03:00:00.000Z', elapsedMinutes: 11, timeLimitMinutes: 10 });
  const result = assess([...foundation(), late]);
  assert.equal(result.status, 'exam_confirmed');
  assert.equal(result.needsRecheck, true);
});

test('保持証拠より後に成立した試験pairがある場合、古い保持だけで維持済みにしない', () => {
  const earlyRetention = m('retention-0123', { evidenceKind: 'retention', caseId: 'retention-case-0123', familyId: 'retention-family', occurredAt: '2026-01-23T03:00:00.000Z' });
  const laterExam1 = m('exam-0124', { evidenceKind: 'exam', caseId: 'exam-case-0124', familyId: 'later-family-1', occurredAt: '2026-01-24T03:00:00.000Z', mixedConceptIds: ['concept', 'other'] });
  const laterExam2 = m('exam-0126', { evidenceKind: 'exam', caseId: 'exam-case-0126', familyId: 'later-family-2', occurredAt: '2026-01-26T03:00:00.000Z' });
  const result = assess([...foundation(false).slice(0, 3), earlyRetention, laterExam1, laterExam2]);
  assert.equal(result.status, 'exam_confirmed');
});

test('無効化証拠は昇格条件から除外し、重複IDの内容競合は拒否する', () => {
  const invalidated = foundation().map(item => ({ ...item, invalidated: item.measurementId === 'exam-2' }));
  const result = assess(invalidated);
  assert.notEqual(result.status, 'exam_confirmed');
  assert.equal(result.qualifyingMeasurementIds.includes('exam-2'), false);
  assert.throws(() => assess([m('same'), m('same', { score: 7 })]), /INVALID_MASTERY_INPUT/);
});

test('基準未準備は証拠が揃っていてもmeasurement_preparingであり未達扱いにしない', () => {
  const result = assess(foundation(), '2026-02-01T00:00:00.000Z', false);
  assert.equal(result.status, 'measurement_preparing');
  assert.equal(result.needsRecheck, false);
  assert.match(result.reasons.join(' '), /専門レビュー済み基準が未準備/);
});
