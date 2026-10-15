import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExamReadiness, type ExamReadinessInput, type ExamReadinessRecord as Record } from '../src/domain/exam-readiness';

// 架空の専門確認・出典を含む隔離入力。本物の模試承認や合格確率の検証ではない。
function exam(id: string, completedAt: string, patch: Partial<Record> = {}): Record {
  return { id, recordVersion: 'test-record-v1', subjectId: 'bookkeeping', examYear: 2026,
    kind: 'external_comprehensive', provider: '架空テスト提供元', examId: 'exam-' + id, familyId: 'family-' + id,
    completedAt, score: 65, maxScore: 100,
    criterion: { version: 'test-target-v1', year: 2026, sourceKind: 'provider',
      sourceUrl: 'https://example.test/criteria', targetScore: 60 },
    comparisonReview: { reviewerId: 'fictional-reviewer', reviewedAt: '2026-08-01T00:00:00Z',
      comparisonGroup: 'test-group', scopeConfirmed: true, difficultyConfirmed: true,
      pointsConfirmed: true, timeLimitConfirmed: true },
    elapsedMinutes: 110, timeLimitMinutes: 120, timeAllocation: [{ sectionId: 'all', minutes: 110 }],
    rank: null, unseenDeclaration: { claimed: true, declaredAt: completedAt },
    freshProblem: true, freshFamily: true, aiAssisted: false, hintsUsed: false,
    measurementQuality: { scoreVerified: true, timingVerified: true, coverageVerified: true }, unmeasuredRanges: [], ...patch };
}
const old = () => exam('old', '2026-08-10T00:00:00Z');
const recent = () => exam('recent', '2026-08-20T00:00:00Z');
function assess(records: Record[], patch: Partial<ExamReadinessInput> = {}) {
  return evaluateExamReadiness({ subjectId: 'bookkeeping', examYear: 2026,
    criterionVersion: 'test-target-v1', asOf: '2026-09-08T00:00:00Z', records, ...patch });
}

test('総合模試0回・1回は未測定、適格な異なる2回が各出典目標を満たすと到達を表示する', () => {
  for (const records of [[], [old()]]) {
    const result = assess(records);
    assert.equal(result.status, 'held');
    assert.ok(result.holdReasons.includes('two-comprehensive-exams-required'));
  }
  const result = assess([old(), recent()]);
  assert.equal(result.status, 'target_met_twice');
  assert.deepEqual(result.selectedIds, ['recent', 'old']);
  assert.deepEqual(result.holdReasons, []);
  assert.equal('passProbability' in result, false);
  // 65%でも出典の目標60点を満たす。一律70%や満点を要求しない。
  assert.deepEqual(result.records.map(record => record.targetDifference), [5, 5]);
});

test('評価器単独でも基準URLの配列を文字列へ暗黙変換しない', () => {
  const record = old();
  Object.assign(record.criterion!, { sourceUrl: ['https://example.test/criteria'] });
  assert.throws(() => assess([record, recent()]), /INVALID_EXAM_READINESS_INPUT/);
});

test('目標差・残り時間・各区分をそのまま返し異なる満点を平均しない', () => {
  const a = old(), b = recent();
  b.maxScore = 200; b.score = 59;
  b.elapsedMinutes = 100; b.timeLimitMinutes = 105; b.timeAllocation = [{ sectionId: 'all', minutes: 100 }];
  const result = assess([a, b]);
  assert.equal(result.status, 'below_target');
  assert.deepEqual(result.records.map(record => record.targetDifference), [5, -1]);
  assert.deepEqual(result.records.map(record => record.remainingMinutes), [10, 5]);
  assert.deepEqual(result.records[1].timeAllocation, b.timeAllocation);
});

test('同じ基準版の目標点・出典URLが相反する記録を混ぜて到達にしない', () => {
  for (const patch of [{ targetScore: 50 }, { sourceUrl: 'https://example.test/conflicting-source' }]) {
    const b = recent(); Object.assign(b.criterion!, patch);
    const result = assess([old(), b]);
    assert.equal(result.status, 'held');
    assert.ok(result.holdReasons.length > 0);
  }
});

test('過去記録の同試験・同ファミリーはfresh申告より優先し、過去の練習も無視しない', () => {
  for (const kind of ['external_comprehensive', 'practice'] as const) {
    for (const field of ['examId', 'familyId'] as const) {
      const a = old(), b = recent();
      const history = exam('earlier-exposure', '2026-08-02T00:00:00Z', { kind });
      history[field] = b[field];
      const result = assess([history, a, b]);
      assert.deepEqual(result.selectedIds, ['recent', 'old']);
      assert.equal(result.status, 'held', kind + '/' + field);
      assert.equal(result.records.find(record => record.id === b.id)!.eligible, false);
    }
  }
});

test('最新の低得点や未適格結果を除外して古い高得点2回を選ばない', () => {
  const latest = exam('latest', '2026-09-01T00:00:00Z', { score: 30 });
  for (const records of [[old(), recent(), latest], [latest, old(), recent()]]) {
    const result = assess(records);
    assert.equal(result.status, 'below_target');
    assert.deepEqual(result.selectedIds, ['latest', 'recent']);
    assert.equal(result.records.find(record => record.id === 'old')!.selected, false);
  }
  latest.comparisonReview = null;
  const held = assess([old(), recent(), latest]);
  assert.equal(held.status, 'held');
  assert.deepEqual(held.selectedIds, ['latest', 'recent']);
  assert.ok(held.holdReasons.includes('latest-measurement-ineligible'));
});

test('ミニ模試・練習・自己申告の高得点2回を総合模試の代用にしない', () => {
  for (const kind of ['mini', 'practice', 'self_report'] as const) {
    const result = assess([{ ...old(), kind, score: 100 }, { ...recent(), kind, score: 100 }]);
    assert.equal(result.status, 'held', kind);
    assert.deepEqual(result.selectedIds, []);
    assert.ok(result.records.every(record => record.exclusionReasons.includes('not-comprehensive')));
  }
});

test('同試験・同ファミリー・専門的な比較不成立・基準出典種別混在は保留する', () => {
  for (const [mutate, reason] of [
    [(b: Record) => { b.examId = old().examId; }, 'same-exam'],
    [(b: Record) => { b.familyId = old().familyId; }, 'same-family'],
    [(b: Record) => { b.comparisonReview!.comparisonGroup = 'other'; }, 'not-comparable'],
    [(b: Record) => { b.criterion!.sourceKind = 'official'; }, 'criterion-source-kind-mismatch'],
  ] as const) {
    const b = recent(); mutate(b);
    const result = assess([old(), b]);
    assert.equal(result.status, 'held');
    assert.ok(result.holdReasons.includes(reason), reason);
  }
});

test('独自総合模試にも専門確認が必要で、本人の未見申告だけでは資格を作らない', () => {
  const a = old(), b = recent();
  a.kind = b.kind = 'original_comprehensive';
  assert.equal(assess([a, b]).status, 'target_met_twice');
  b.comparisonReview = null;
  const result = assess([a, b]);
  assert.equal(result.status, 'held');
  assert.ok(result.records[1].exclusionReasons.includes('expert-review-missing'));
});

test('基準・独力未見・時間・範囲の不足は理由を残し達成扱いにしない', () => {
  const cases: Array<[Partial<Record>, string]> = [
    [{ criterion: null }, 'criterion-missing'],
    [{ unseenDeclaration: null }, 'unseen-unconfirmed'],
    [{ freshProblem: false }, 'previously-seen-problem'],
    [{ freshFamily: false }, 'previously-seen-family'],
    [{ aiAssisted: true }, 'ai-assistance-or-unknown'],
    [{ aiAssisted: null }, 'ai-assistance-or-unknown'],
    [{ hintsUsed: true }, 'hints-or-unknown'],
    [{ elapsedMinutes: null }, 'time-unknown'],
    [{ elapsedMinutes: 121 }, 'time-exceeded'],
    [{ unmeasuredRanges: ['未測定の総合範囲'] }, 'unmeasured-ranges'],
    [{ measurementQuality: { scoreVerified: false, timingVerified: true, coverageVerified: true } }, 'score-unverified'],
    [{ measurementQuality: { scoreVerified: true, timingVerified: false, coverageVerified: true } }, 'timing-unverified'],
    [{ measurementQuality: { scoreVerified: true, timingVerified: true, coverageVerified: false } }, 'coverage-unverified'],
  ];
  for (const [patch, reason] of cases) {
    const result = assess([old(), { ...recent(), ...patch }]);
    assert.equal(result.status, 'held', reason);
    assert.ok(result.records[1].exclusionReasons.includes(reason as never), reason);
  }
  const missing = assess([old(), { ...recent(), criterion: null, elapsedMinutes: null, unmeasuredRanges: ['理論'] }]);
  assert.equal(missing.records[1].targetDifference, null);
  assert.equal(missing.records[1].remainingMinutes, null);
  assert.deepEqual(missing.records[1].unmeasuredRanges, ['理論']);
});

test('専門確認の範囲・難度・配点・制限時間と基準年度版が欠ける場合は保留する', () => {
  for (const field of ['scopeConfirmed', 'difficultyConfirmed', 'pointsConfirmed', 'timeLimitConfirmed'] as const) {
    const b = recent(); b.comparisonReview![field] = false;
    assert.equal(assess([old(), b]).status, 'held', field);
  }
  for (const patch of [{ version: 'other-v2' }, { year: 2025 }]) {
    const b = recent(); Object.assign(b.criterion!, patch);
    assert.equal(assess([old(), b]).status, 'held');
  }
});

test('区分ごとの配分欠測は保留条件を増やさず、確認済みの総時間と不足表示を維持する', () => {
  const a = old(), b = recent();
  a.timeAllocation = [];
  b.timeAllocation = [{ sectionId: 'theory', minutes: null }];
  const result = assess([a, b]);
  assert.equal(result.status, 'target_met_twice');
  assert.deepEqual(result.records[0].timeAllocation, []);
  assert.deepEqual(result.records[1].timeAllocation, [{ sectionId: 'theory', minutes: null }]);
  assert.equal(result.records[1].remainingMinutes, 10);
});

test('既習か不明な場合は保留するが、既習だったとは断定しない', () => {
  const b = recent(); b.freshFamily = null; b.freshProblem = null;
  const result = assess([old(), b]);
  assert.equal(result.status, 'held');
  assert.equal(result.records[1].eligible, false);
  assert.ok(!result.records[1].exclusionReasons.includes('previously-seen-family'));
  assert.ok(!result.records[1].exclusionReasons.includes('previously-seen-problem'));
  assert.ok(result.records[1].exclusionReasons.length >= 2);
});

test('別科目・別年度を算入せず、順位の母集団が異なっても得点目標に置き換えない', () => {
  const foreign = exam('foreign', '2026-09-01T00:00:00Z', { subjectId: 'income-tax', rank: { position: 1, population: 5 } });
  const priorYear = exam('prior', '2026-09-02T00:00:00Z', { examYear: 2025 });
  const a = old(), b = recent();
  a.rank = { position: 1, population: 100 }; b.rank = { position: 90, population: 1000 };
  const result = assess([a, b, foreign, priorYear]);
  assert.equal(result.status, 'target_met_twice');
  assert.deepEqual(result.selectedIds, ['recent', 'old']);
  assert.ok(result.records[2].exclusionReasons.includes('other-subject'));
  assert.ok(result.records[3].exclusionReasons.includes('other-year'));
});

test('重複ID・相反する再送・不正日時・範囲外得点・不正順位を拒否する', () => {
  assert.throws(() => assess([old(), old()]), /INVALID_EXAM_READINESS_INPUT/);
  assert.throws(() => assess([old(), { ...old(), score: 99 }]), /INVALID_EXAM_READINESS_INPUT/);
  for (const at of ['2026-02-30T00:00:00Z', '2026-08-20', '2026-08-20T00:00:00', '2026-09-09T00:00:00Z']) {
    assert.throws(() => assess([{ ...old(), completedAt: at }]), /INVALID_EXAM_READINESS_INPUT/, at);
  }
  const patches: Partial<Record>[] = [{ score: -1 }, { score: 101 }, { score: NaN }, { maxScore: 0 },
    { maxScore: Infinity }, { rank: { position: 0, population: 10 } }, { rank: { position: 11, population: 10 } },
    { rank: { position: 1.5, population: 10 } }, { rank: { position: 1, population: 0 } }];
  for (const patch of patches) assert.throws(() => assess([{ ...old(), ...patch }]), /INVALID_EXAM_READINESS_INPUT/);
  const missingSource = old(); missingSource.criterion!.sourceUrl = '';
  assert.throws(() => assess([missingSource]), /INVALID_EXAM_READINESS_INPUT/);
});

test('同時刻は入力順で選択を変えず、入力や戻り値を通じて元記録を変更しない', () => {
  const a = old(), b = recent(); b.completedAt = a.completedAt;
  const snapshot = structuredClone([a, b]);
  const first = assess([a, b]), reverse = assess([b, a]);
  assert.deepEqual(first.selectedIds, reverse.selectedIds);
  assert.equal(first.status, reverse.status);
  first.records[0].timeAllocation[0].minutes = 0;
  assert.deepEqual([a, b], snapshot);
});

test('明示offsetの同じ時刻はUTCと同じ判定になり、不正な現地日付は拒否する', () => {
  const a = old(), b = recent();
  const expected = assess([a, b]);
  b.completedAt = '2026-08-20T09:00:00+09:00';
  b.unseenDeclaration!.declaredAt = '2026-08-20T09:00:00+09:00';
  b.comparisonReview!.reviewedAt = '2026-08-01T09:00:00+09:00';
  const actual = assess([a, b], { asOf: '2026-09-08T09:00:00+09:00' });
  assert.deepEqual(actual, expected);
  for (const completedAt of ['2026-02-30T09:00:00+09:00', '2026-08-20T09:00:00+15:00'])
    assert.throws(() => assess([{ ...a, completedAt }]), /INVALID_EXAM_READINESS_INPUT/);
});
