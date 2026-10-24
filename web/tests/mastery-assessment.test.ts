import test from 'node:test';
import assert from 'node:assert/strict';
import { assessMastery, type MasteryMeasurement } from '../src/domain/mastery-assessment';

const base: MasteryMeasurement = { measurementId: 'm', subjectId: 'bookkeeping', conceptId: 'concept', conceptVersion: 'v1', criterionVersion: 'criterion-v1',
  caseId: 'case', caseVersion: 'case-v1', familyId: 'family', occurredAt: '2026-01-01T00:00:00.000Z', evidenceKind: 'explanation', outcome: 'met', score: 8, maxScore: 10, targetScore: 6,
  elapsedMinutes: 5, timeLimitMinutes: 10, hintsUsed: 0, aiAnswerViewed: false, sourceKind: 'formal', reviewStatus: 'approved', scoringAuthority: 'reviewed_rules', measurementQuality: 'verified', mixedConceptIds: [], confidence: null, confidenceFixedBeforeResult: false, invalidated: false };
const input = (measurements: MasteryMeasurement[], prepared = true) => assessMastery({ subjectId: 'bookkeeping', conceptId: 'concept', conceptVersion: 'v1', criterion: { prepared, version: prepared ? 'criterion-v1' : null }, disclosures: [], measurements, asOf: '2026-02-01T00:00:00.000Z' });
const m = (id: string, patch: Partial<MasteryMeasurement>): MasteryMeasurement => ({ ...base, measurementId: id, ...patch });

test('基準未準備では学習者の不足や未達を理由として返さない', () => {
  for (const measurements of [[], [m('failed', { outcome: 'not_met', score: 5 })]]) {
    const result = input(measurements, false);
    assert.equal(result.status, 'measurement_preparing');
    assert.equal(result.needsRecheck, false);
    assert.deepEqual(result.reasons, ['概念別の専門レビュー済み基準が未準備です。']);
  }
});

test('未準備の基準に版番号と測定があっても派生結果を返さない', () => {
  const result = assessMastery({ subjectId: 'bookkeeping', conceptId: 'concept', conceptVersion: 'v1',
    criterion: { prepared: false, version: 'criterion-v1' }, disclosures: [],
    measurements: [m('known-version', {})], asOf: '2026-02-01T00:00:00Z' });
  assert.equal(result.status, 'measurement_preparing');
  assert.equal(result.needsRecheck, false);
  assert.deepEqual(result.qualifyingMeasurementIds, []);
  for (const value of Object.values(result.scores)) assert.deepEqual(value, { score: null, observedCount: 0, coverage: 0 });
});

test('後続の成功後も残る未達は最新測定の失敗と誤記しない', () => {
  const result = input([m('failed', { evidenceKind: 'exam', outcome: 'not_met', score: 5 }),
    m('success', { occurredAt: '2026-01-02T00:00:00Z' })]);
  assert.equal(result.needsRecheck, true);
  assert.ok(result.reasons.includes('未達となった正式測定の再確認がまだ完了していません。'));
  assert.ok(!result.reasons.some(reason => reason.includes('最新の正式測定が未達')));
});

const retentionHistory = () => [m('explain', {}),
  m('app-a', { evidenceKind: 'application', caseId: 'app-a' }),
  m('app-b', { evidenceKind: 'application', caseId: 'app-b' }),
  m('exam-a', { evidenceKind: 'exam', familyId: 'exam-a', mixedConceptIds: ['concept', 'other'], occurredAt: '2026-01-03T00:00:00Z' }),
  m('exam-b', { evidenceKind: 'exam', familyId: 'exam-b', occurredAt: '2026-01-05T00:00:00Z' }),
  m('retention', { evidenceKind: 'retention', caseId: 'retention', familyId: 'retention', occurredAt: '2026-01-27T00:00:00Z' })];

test('支援付きでも正式未達は保持を取り消し、支援付き成功では回復しない', () => {
  for (const assistance of [{ hintsUsed: 1 }, { aiAnswerViewed: true }]) {
    const failed = m('assisted-failure', { evidenceKind: 'explanation', outcome: 'not_met', score: 5, occurredAt: '2026-01-28T00:00:00Z', ...assistance });
    const result = input([...retentionHistory(), failed]);
    assert.equal(result.needsRecheck, true);
    assert.equal(result.status, 'exam_confirmed');
    const success = m('assisted-success', { occurredAt: '2026-01-29T00:00:00Z', ...assistance });
    assert.equal(input([...retentionHistory(), failed, success]).needsRecheck, true);
    assert.equal(input([...retentionHistory(), failed, { ...success, hintsUsed: 0, aiAnswerViewed: false }]).needsRecheck, false);
  }
});

test('適用と試験pairが揃っても原理説明の不足理由を返す', () => {
  const result = input(retentionHistory().filter(item => item.evidenceKind !== 'explanation' && item.evidenceKind !== 'retention'));
  assert.equal(result.status, 'applicable');
  assert.ok(result.reasons.some(reason => reason.includes('原理説明')));
});

test('同時刻の成功は失敗を回復せずIDや入力順に依存しない', () => {
  for (const [failureId, successId] of [['a', 'z'], ['z', 'a']]) {
    const events = [m(failureId, { outcome: 'not_met', score: 5 }), m(successId, {})];
    for (const ordered of [events, [...events].reverse()]) {
      assert.equal(input(ordered).needsRecheck, true);
      assert.equal(input([...ordered, m('later', { occurredAt: '2026-01-02T00:00:00Z' })]).needsRecheck, false);
    }
  }
});

test('保持の直前同時刻証拠は全case/familyと比較し、IDで一件を選ばない', () => {
  const history = retentionHistory().slice(0, -1);
  for (const [firstId, secondId] of [['a', 'z'], ['z', 'a']]) {
    const latest = [m(firstId, { caseId: 'retention', familyId: 'retention', occurredAt: '2026-01-06T00:00:00Z' }),
      m(secondId, { caseId: 'different', familyId: 'different', occurredAt: '2026-01-06T00:00:00Z' })];
    const retained = retentionHistory().at(-1)!;
    assert.equal(input([...history, ...latest, retained]).status, 'exam_confirmed');
    assert.equal(input([...history, ...latest.reverse(), { ...retained, caseId: 'new', familyId: 'new' }]).status, 'maintained');
  }
});

test('同時刻の通常成功と保持は順序を推測して維持済みにしない', () => {
  for (const [retentionId, successId] of [['a', 'z'], ['z', 'a']]) {
    const history = retentionHistory().map(item => item.evidenceKind === 'retention' ? { ...item, measurementId: retentionId } : item);
    assert.equal(input([...history, m(successId, { occurredAt: '2026-01-27T00:00:00Z' })]).status, 'exam_confirmed');
  }
});

test('直近5件の同時刻境界は群ごと除外し、ID変更でも全評価が不変になる', () => {
  const tied = Array.from({ length: 6 }, (_, i) => m(`tie-${i}`, {
    score: i === 0 ? 5 : 8, outcome: i === 0 ? 'not_met' : 'met',
    confidence: i === 0 ? 'high' : 'low', confidenceFixedBeforeResult: true,
  }));
  const rename = (events: MasteryMeasurement[]) => events.map((item, i) => ({ ...item, measurementId: `renamed-${events.length - i}` })).reverse();
  const withoutIds = (events: MasteryMeasurement[]) => {
    const { qualifyingMeasurementIds, ...result } = input(events);
    const qualified = qualifyingMeasurementIds.map(id => events.find(item => item.measurementId === id)!.score).sort();
    return { ...result, qualified };
  };
  const empty = input(tied);
  assert.equal(empty.scores.explanation.score, null);
  assert.equal(empty.scores.calibration.score, null);
  assert.equal(empty.scores.overall.coverage, 0);
  assert.equal(empty.needsRecheck, true); // Score exclusion never drops negative evidence.
  assert.deepEqual(withoutIds(tied), withoutIds(rename(tied)));
  const newer = m('newer', { occurredAt: '2026-01-02T00:00:00Z', confidence: 'high', confidenceFixedBeforeResult: true });
  const events = [...tied, newer];
  const partial = input(events);
  assert.deepEqual(partial.scores.explanation, { score: 80, observedCount: 1, coverage: 0.2 });
  assert.deepEqual(partial.scores.calibration, { score: 75, observedCount: 1, coverage: 0.2 });
  assert.ok(partial.reasons.some(reason => reason.includes('同時刻で直近5件')));
  assert.deepEqual(withoutIds(events), withoutIds(rename(events)));
  assert.equal(input(tied.slice(1)).scores.explanation.observedCount, 5);
});

test('維持確認後の適格証拠で保持時計を更新し、不適格証拠では更新しない', () => {
  const history = retentionHistory();
  assert.equal(input(history).status, 'maintained');
  for (const evidenceKind of ['application', 'retention'] as const) {
    const later = m('later', { evidenceKind, caseId: 'later', familyId: 'later', occurredAt: '2026-01-28T00:00:00Z' });
    const result = input([...history, later]);
    assert.equal(result.status, 'exam_confirmed');
    assert.equal(result.needsRecheck, false);
    assert.equal(input([...history, { ...later, hintsUsed: 1 }]).status, 'maintained');
  }
  const renewed = assessMastery({ subjectId: 'bookkeeping', conceptId: 'concept', conceptVersion: 'v1', criterion: { prepared: true, version: 'criterion-v1' }, disclosures: [],
    measurements: [...history, m('renewed', { evidenceKind: 'retention', caseId: 'renewed', familyId: 'renewed', occurredAt: '2026-02-17T00:00:00Z' })], asOf: '2026-02-18T00:00:00Z' });
  assert.equal(renewed.status, 'maintained');
});

test('保持証拠にも概念全体の直前開示から48時間の境界を適用する', () => {
  for (const [disclosure, expected] of [['2026-01-25T00:00:00Z', 'maintained'], ['2026-01-25T00:00:01Z', 'exam_confirmed']] as const) {
    const result = assessMastery({ subjectId: 'bookkeeping', conceptId: 'concept', conceptVersion: 'v1', criterion: { prepared: true, version: 'criterion-v1' },
      disclosures: [disclosure], measurements: retentionHistory(), asOf: '2026-02-01T00:00:00Z' });
    assert.equal(result.status, expected);
    assert.equal(result.qualifyingMeasurementIds.includes('retention'), expected === 'maintained');
  }
});

test('他種類の未達では適用の再確認ケースと試験の再確認候補を破棄しない', () => {
  const events = [m('app-fail', { evidenceKind: 'application', outcome: 'not_met', score: 5 }),
    m('app-first', { evidenceKind: 'application', caseId: 'case-a', occurredAt: '2026-01-02T00:00:00Z' }),
    m('exam-fail', { evidenceKind: 'exam', outcome: 'not_met', score: 5, occurredAt: '2026-01-03T00:00:00Z' }),
    m('app-second', { evidenceKind: 'application', caseId: 'case-b', occurredAt: '2026-01-04T00:00:00Z' }),
    m('exam-first', { evidenceKind: 'exam', familyId: 'fam-a', mixedConceptIds: ['concept','other'], occurredAt: '2026-01-05T00:00:00Z' }),
    m('exam-second', { evidenceKind: 'exam', familyId: 'fam-b', occurredAt: '2026-01-07T00:00:00Z' })];
  assert.equal(input(events.slice(0,4)).needsRecheck, true); // The exam still needs its pair.
  assert.equal(input(events).needsRecheck, false);
  const reversed = [m('exam-fail', { evidenceKind: 'exam', outcome: 'not_met', score: 5 }),
    m('exam-first', { evidenceKind: 'exam', familyId: 'fam-a', mixedConceptIds: ['concept','other'], occurredAt: '2026-01-02T00:00:00Z' }),
    m('app-fail', { evidenceKind: 'application', outcome: 'not_met', score: 5, occurredAt: '2026-01-03T00:00:00Z' }),
    m('exam-second', { evidenceKind: 'exam', familyId: 'fam-b', occurredAt: '2026-01-04T00:00:00Z' }),
    m('app-first', { evidenceKind: 'application', caseId: 'case-a', occurredAt: '2026-01-05T00:00:00Z' }),
    m('app-second', { evidenceKind: 'application', caseId: 'case-b', occurredAt: '2026-01-06T00:00:00Z' })];
  assert.equal(input(reversed).needsRecheck, false);
});

test('保持時計は開示直後や計時欠測のpassing examを除外し、正式未達は除外しない', () => {
  const confirmed = [m('explain', {}), m('app-a', { evidenceKind: 'application', caseId: 'app-a' }),
    m('app-b', { evidenceKind: 'application', caseId: 'app-b', occurredAt: '2026-01-02T00:00:00Z' }),
    m('exam-a', { evidenceKind: 'exam', familyId: 'fam-a', mixedConceptIds: ['concept','other'], occurredAt: '2026-01-03T00:00:00Z' }),
    m('exam-b', { evidenceKind: 'exam', familyId: 'fam-b', occurredAt: '2026-01-05T00:00:00Z' })];
  const retention = m('retention', { evidenceKind: 'retention', caseId: 'retention', familyId: 'retention', occurredAt: '2026-01-27T00:00:00Z' });
  const excluded = m('excluded', { evidenceKind: 'exam', familyId: 'excluded', occurredAt: '2026-01-07T00:00:00Z' });
  assert.equal(input([...confirmed, { ...excluded, elapsedMinutes: null }, retention]).status, 'maintained');
  const disclosed = assessMastery({ subjectId: 'bookkeeping', conceptId: 'concept', conceptVersion: 'v1', criterion: { prepared: true, version: 'criterion-v1' },
    disclosures: ['2026-01-06T00:00:00Z'], measurements: [...confirmed, excluded, retention], asOf: '2026-02-01T00:00:00Z' });
  assert.equal(disclosed.status, 'maintained');
  const failed = input([...confirmed, { ...excluded, outcome: 'not_met', score: 5 }, retention]);
  assert.notEqual(failed.status, 'maintained'); assert.equal(failed.needsRecheck, true);
  const overtime = input([...confirmed, { ...excluded, elapsedMinutes: 11 }, retention]);
  assert.notEqual(overtime.status, 'maintained'); assert.equal(overtime.needsRecheck, true);
});

test('時間family不足と混合問題不足を区別し、昇格条件は同一ペアに束縛する', () => {
  const a = m('a', { evidenceKind: 'exam', familyId: 'a' });
  const b = m('b', { evidenceKind: 'exam', familyId: 'b', occurredAt: '2026-01-03T00:00:00Z' });
  const noMixed = input([a,b]);
  assert.ok(!noMixed.reasons.some(reason => reason.startsWith('48時間')));
  assert.ok(noMixed.reasons.some(reason => reason.startsWith('対象概念と別概念')));
  const mixed = { ...a, mixedConceptIds: ['concept','other'] };
  const tooClose = input([mixed, { ...b, occurredAt: '2026-01-02T00:00:00Z' }]);
  assert.ok(tooClose.reasons.some(reason => reason.startsWith('48時間')));
  assert.ok(!tooClose.reasons.some(reason => reason.startsWith('対象概念と別概念')));
  const outsidePair = input([m('explain', {}), m('app-a', { evidenceKind: 'application', caseId: 'app-a' }),
    m('app-b', { evidenceKind: 'application', caseId: 'app-b' }), a,b,
    m('middle', { evidenceKind: 'exam', familyId: 'middle', mixedConceptIds: ['concept','other'], occurredAt: '2026-01-02T00:00:00Z' })]);
  assert.equal(outsidePair.status, 'applicable');
  assert.ok(outsidePair.reasons.some(reason => reason.includes('同じペア')));
});

test('総合の証拠充足率は各種類の観測件数を重み付けし、参考得点の重みは変えない', () => {
  const result = input([m('explanation', { confidence: 'high', confidenceFixedBeforeResult: true }),
    m('application', { evidenceKind: 'application' }), m('exam', { evidenceKind: 'exam' }), m('retention', { evidenceKind: 'retention' })]);
  assert.equal(result.scores.overall.coverage, 0.2);
  assert.equal(result.scores.overall.score, 79.75);
  const partial = input([m('only-explanation', {})]);
  assert.equal(partial.scores.overall.coverage, 0.05);
  assert.equal(partial.scores.overall.score, 80);
});

test('証拠ゼロと基準未準備は異なる保留状態で、根拠スコアを0埋めしない', () => {
  const empty = input([]);
  assert.equal(empty.status, 'unconfirmed'); assert.equal(empty.scores.overall.score, null); assert.equal(empty.scores.overall.coverage, 0);
  const preparing = input([], false);
  assert.equal(preparing.status, 'measurement_preparing'); assert.equal(preparing.criterionVersion, null);
});

test('説明・適用・較正の参考スコアを直近5件から出し、支援付き測定だけで正式昇格しない', () => {
  const measurements = [m('explain', { confidence: 'high', confidenceFixedBeforeResult: true }),
    m('supported', { measurementId: 'supported', evidenceKind: 'application', caseId: 'case-1', hintsUsed: 1 }),
    m('supported-2', { evidenceKind: 'application', caseId: 'case-2', aiAnswerViewed: true })];
  const result = input(measurements);
  assert.equal(result.status, 'in_progress'); assert.equal(result.scores.explanation.score, 80); assert.equal(result.scores.application.score, 80);
  assert.equal(result.scores.calibration.score, 75); assert.ok(result.scores.overall.score !== null && result.scores.overall.coverage > 0);
});

test('適用可能・試験形式確認済み・維持済みは仕様の独立条件を順に満たした場合だけ到達する', () => {
  const applications = [m('app-1', { evidenceKind: 'application', caseId: 'case-1', familyId: 'app-family-1', occurredAt: '2026-01-01T00:00:00.000Z' }),
    m('app-2', { evidenceKind: 'application', caseId: 'case-2', familyId: 'app-family-2', occurredAt: '2026-01-02T00:00:00.000Z' })];
  assert.equal(input(applications).status, 'applicable');
  const exams = [m('exam-1', { evidenceKind: 'exam', caseId: 'exam-case-1', familyId: 'exam-family-1', occurredAt: '2026-01-03T00:00:00.000Z', mixedConceptIds: ['concept', 'other'] }),
    m('exam-2', { evidenceKind: 'exam', caseId: 'exam-case-2', familyId: 'exam-family-2', occurredAt: '2026-01-05T00:00:00.000Z', mixedConceptIds: [] })];
  const confirmed = input([m('explanation', {}), ...applications, ...exams]);
  assert.equal(confirmed.status, 'exam_confirmed'); assert.deepEqual(confirmed.qualifyingMeasurementIds, ['app-1', 'explanation', 'app-2', 'exam-1', 'exam-2']);
  const maintained = input([m('explanation', {}), ...applications, ...exams, m('retention', { evidenceKind: 'retention', caseId: 'retention-case', familyId: 'retention-family', occurredAt: '2026-01-27T00:00:00.000Z' })]);
  assert.equal(maintained.status, 'maintained');
});

test('版・科目を跨ぐ証拠、撤回/未来/練習は昇格へ混ぜず、重複IDの競合は拒否する', () => {
  const result = input([m('future', { occurredAt: '2026-03-01T00:00:00.000Z' }), m('withdrawn', { measurementId: 'withdrawn', reviewStatus: 'withdrawn' }),
    m('practice', { measurementId: 'practice', sourceKind: 'practice' }), m('old', { measurementId: 'old', conceptVersion: 'v0' }),
    m('other-subject', { measurementId: 'other-subject', subjectId: 'income-tax' })]);
  assert.equal(result.status, 'unconfirmed'); assert.deepEqual(result.qualifyingMeasurementIds, []); assert.equal(result.scores.explanation.observedCount, 0);
  assert.throws(() => input([m('same', {}), m('same', { score: 7 })]), /INVALID_MASTERY_INPUT/);
});

test('正式昇格に必要な時間・ヒント・AI・mixed欠測は推測せず保留する', () => {
  const app = [m('app-1', { evidenceKind: 'application', caseId: 'case-1' }), m('app-2', { evidenceKind: 'application', caseId: 'case-2' })];
  const badExams = [m('exam-1', { evidenceKind: 'exam', familyId: 'family-1', occurredAt: '2026-01-01T00:00:00.000Z', mixedConceptIds: ['concept', 'other'], hintsUsed: 1 }),
    m('exam-2', { evidenceKind: 'exam', familyId: 'family-2', occurredAt: '2026-01-04T00:00:00.000Z', mixedConceptIds: [], aiAnswerViewed: true })];
  const result = input([...app, ...badExams]);
  assert.equal(result.status, 'applicable'); assert.match(result.reasons.join(' '), /48時間/);
});

test('参考スコアは直近5件の平均で、較正は開示前に固定した自信のみを使う', () => {
  const measurements = Array.from({ length: 6 }, (_, i) => m(`score-${i}`, {
    occurredAt: `2026-01-0${i + 1}T00:00:00.000Z`, score: i === 0 ? 10 : 6,
    confidence: 'high', confidenceFixedBeforeResult: i === 0,
  }));
  const result = input(measurements);
  assert.equal(result.scores.explanation.score, 60);
  assert.equal(result.scores.explanation.observedCount, 5);
  assert.equal(result.scores.calibration.observedCount, 1);
  assert.equal(result.scores.calibration.score, 75);
});

test('試験未達は簡単な適用の成功で消さず、新しい適格な試験ペアで回復できる', () => {
  const failed = m('failed', { evidenceKind: 'exam', score: 5, outcome: 'not_met' });
  const simple = m('simple', { evidenceKind: 'application', occurredAt: '2026-01-02T00:00:00.000Z' });
  assert.equal(input([failed, simple]).needsRecheck, true);
  const exams = [m('new-1', { evidenceKind: 'exam', familyId: 'new-1', occurredAt: '2026-01-03T00:00:00.000Z', mixedConceptIds: ['concept', 'other'] }),
    m('new-2', { evidenceKind: 'exam', familyId: 'new-2', occurredAt: '2026-01-05T00:00:00.000Z' })];
  assert.equal(input([failed, simple, ...exams]).needsRecheck, false);
});

test('別種類の未達と回復が未解決の試験再確認を上書きしない', () => {
  const evidence = [m('exam-fail', { evidenceKind: 'exam', outcome: 'not_met', score: 5 }),
    m('explain-fail', { evidenceKind: 'explanation', outcome: 'not_met', score: 5, occurredAt: '2026-01-02T00:00:00.000Z' }),
    m('explain-recovery', { occurredAt: '2026-01-03T00:00:00.000Z' })];
  assert.equal(input(evidence).needsRecheck, true);
});
