import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticEngine, type DiagnosticQuestion, type DiagnosticSeed, type DiagnosticCommand } from '../src/domain/diagnostic-session';

const at = (seconds: number) => new Date(Date.parse('2026-01-02T00:00:00Z') + seconds * 1000).toISOString();
// Synthetic, isolated catalog. Not real approved material or a human review receipt.
function question(index: number, patch: Partial<DiagnosticQuestion> = {}): DiagnosticQuestion {
  return { id: `q${String(index).padStart(2, '0')}`, version: 'v1', subjectId: 'bookkeeping', conceptId: 'period', conceptVersion: 'v1', familyId: `family-${index}`,
    poolId: 'diagnostic-only', poolVersion: 'v1', purpose: 'diagnostic', stage: index < 3 ? 'anchor' : index < 9 ? 'boundary' : 'transfer',
    status: 'active', review: { reviewerId: 'synthetic-reviewer', reviewedAt: at(-1), rightsConfirmed: true }, prompt: '架空の確認問題', maxScore: 10, targetScore: 6,
    options: [{ id: 'a', label: '架空選択肢A', earned: 8, errorReason: null }, { id: 'b', label: '架空選択肢B', earned: 3, errorReason: '架空の期間配分の誤り' }], ...patch };
}
function seed(mode: DiagnosticSeed['mode'] = 'detailed'): DiagnosticSeed { return { id: 'session-1', mode, subjectId: 'bookkeeping', conceptId: mode === 'short' ? 'period' : null, createdAt: at(0), seenFamilies: [] }; }
const present = (n: number, seconds = n * 10): Extract<DiagnosticCommand, { type: 'present' }> => ({ type: 'present', requestId: `present-${n}`, at: at(seconds), seenFamilies: [] });
const submit = (n: number, seconds = n * 10 + 1): Extract<DiagnosticCommand, { type: 'submit' }> => ({ type: 'submit', requestId: `submit-${n}`, at: at(seconds), instanceId: `question-${n + 1}`, answerId: 'a', hintsUsed: false });
const confidence = (n: number, seconds = n * 10 + 2): DiagnosticCommand => ({ type: 'confidence', requestId: `confidence-${n}`, at: at(seconds), instanceId: `question-${n + 1}`, value: null });

test('詳しい診断は初出題から8分の壁時計、離脱で延長せず期限前提出だけ保持する', () => {
  const engine = createDiagnosticEngine(Array.from({ length: 12 }, (_, i) => question(i)));
  let session = engine.start(seed());
  assert.equal(engine.view(session, at(30)).deadline, null);
  session = engine.transition(session, present(0, 30));
  assert.equal(engine.view(session, at(30)).deadline, at(510));
  session = engine.transition(session, submit(0, 40));
  session = engine.transition(session, confidence(0, 41));
  session = engine.transition(session, present(1, 42));
  session = engine.transition(session, { type: 'pause', requestId: 'pause', at: at(50) });
  session = engine.transition(session, { type: 'resume', requestId: 'resume', at: at(500) });
  session = engine.transition(session, submit(1, 509));
  session = engine.transition(session, confidence(1, 509));
  const state = engine.view(session, at(510));
  assert.equal(state.status, 'expired'); assert.equal(state.attempts[1].elapsedSeconds, null);
  assert.equal(state.attempts[0].earned, 8); assert.equal(state.longTermRetention, null);
  assert.ok(state.reasons.some(reason => reason.includes('8分の期限')));
  assert.ok(!state.reasons.some(reason => reason.includes('在庫不足')));
  assert.throws(() => engine.transition(session, present(2, 510)), /DIAGNOSTIC_CLOSED/);
  assert.deepEqual(engine.transition(session, submit(1, 999)), session);
  assert.throws(() => engine.transition(session, { ...submit(1, 999), answerId: 'b' } as DiagnosticCommand), /REQUEST_CONFLICT/);
  let unanswered = engine.transition(engine.start(seed()), present(0));
  unanswered = engine.transition(unanswered, { type: 'pause', requestId: 'pause', at: at(1) });
  assert.throws(() => engine.transition(unanswered, { type: 'resume', requestId: 'resume', at: at(480) }), /CLOSED/);
  assert.throws(() => engine.transition(unanswered, submit(0, 481)), /CLOSED/);
  assert.equal(engine.view(unanswered, at(481)).attempts[0].earned, null);
  assert.deepEqual(engine.view(unanswered, at(481)).risks, []);
});

test('短確認は最大3問で強制時間なし、採点前に任意自信またはスキップ、回答前rubric非公開', () => {
  const engine = createDiagnosticEngine(Array.from({ length: 4 }, (_, i) => question(i)));
  let session = engine.start(seed('short'));
  for (let n = 0; n < 3; n++) {
    session = engine.transition(session, present(n, n * 86400));
    const view = engine.view(session, at(n * 86400));
    assert.deepEqual(Object.keys(view.currentQuestion!).sort(), ['instanceId', 'options', 'prompt']);
    assert.deepEqual(Object.keys(view.currentQuestion!.options[0]).sort(), ['id', 'label']);
    assert.equal(view.deadline, null);
    assert.throws(() => engine.transition(session, confidence(n, n * 86400)), /CONFIDENCE_UNAVAILABLE/);
    session = engine.transition(session, submit(n, n * 86400 + 1));
    assert.equal(engine.view(session, at(n * 86400 + 1)).attempts[n].earned, null);
    if (n < 2) assert.throws(() => engine.transition(session, present(n + 1, n * 86400 + 1)), /CONFIDENCE_PENDING/);
    session = engine.transition(session, confidence(n, n * 86400 + 2));
    assert.equal(engine.view(session, at(n * 86400 + 2)).attempts[n].earned, 8);
  }
  const view = engine.view(session, at(999999));
  assert.equal(view.status, 'completed'); assert.equal(view.attempts.length, 3);
  assert.ok(view.attempts.every(item => item.elapsedSeconds === null));
  assert.throws(() => engine.transition(session, present(4, 999999)), /CLOSED/);
});

test('未見在庫・pool用途・専門審査と利用権を確認し、提示だけでも別sessionから既見になる', () => {
  const questions = [question(0, { status: 'draft' }), question(1, { review: null }), question(2, { purpose: 'before_evaluation' }),
    question(3, { poolId: 'eligible', stage: 'anchor', review: { reviewerId: 'synthetic', reviewedAt: at(-1), rightsConfirmed: false } }),
    question(4, { poolId: 'eligible', stage: 'anchor' })];
  const engine = createDiagnosticEngine(questions);
  let first = engine.transition(engine.start(seed()), present(0));
  assert.equal(engine.view(first, at(0)).attempts[0].questionId, 'q04');
  const exposure = engine.view(first, at(0)).seenFamilies;
  const second = engine.transition(engine.start({ ...seed(), id: 'session-2' }), { ...present(0), seenFamilies: exposure });
  assert.equal(engine.view(second, at(0)).status, 'unavailable');
  assert.equal(engine.view(second, at(0)).directSelectionAllowed, true);
  first = engine.transition(first, { type: 'reveal', requestId: 'reveal', at: at(1), instanceId: 'question-1' });
  assert.throws(() => engine.transition(first, submit(0, 2)), /ANSWER_FIXED/);
  assert.deepEqual(engine.view(first, at(2)).risks, []);
  const conflict = createDiagnosticEngine([question(0), question(1, { poolId: 'practice', purpose: 'practice', familyId: 'family-0' })]);
  assert.equal(conflict.view(conflict.transition(conflict.start(seed()), present(0)), at(0)).status, 'unavailable');
});

test('詳細は最大12問、部分点を維持し実測誤答だけ最大3リスク、未確認を0にしない', () => {
  const engine = createDiagnosticEngine(Array.from({ length: 14 }, (_, i) => question(i)));
  let session = engine.start(seed());
  for (let n = 0; n < 12; n++) {
    session = engine.transition(session, present(n));
    session = engine.transition(session, { ...submit(n), answerId: 'b' } as DiagnosticCommand);
    session = engine.transition(session, confidence(n));
  }
  const view = engine.view(session, at(120));
  assert.equal(view.status, 'completed'); assert.equal(view.attempts.length, 12);
  assert.equal(view.risks.length, 3); assert.ok(view.risks.every(item => item.evidenceId && item.occurredAt && item.reason));
  assert.ok(view.attempts.every(item => item.earned === 3)); assert.equal(view.longTermRetention, null);
  assert.throws(() => engine.transition(session, present(12)), /CLOSED/);
});

test('詳細診断は在庫枯渇だけを不足表示し、本人の途中終了と短確認を不足診断へ変えない', () => {
  const limited = createDiagnosticEngine(Array.from({ length: 3 }, (_, i) => question(i)));
  let exhausted = limited.start(seed());
  for (let n = 0; n < 3; n++) {
    exhausted = limited.transition(exhausted, present(n));
    exhausted = limited.transition(exhausted, submit(n));
    exhausted = limited.transition(exhausted, confidence(n));
  }
  exhausted = limited.transition(exhausted, present(3));
  const exhaustedView = limited.view(exhausted, at(40));
  assert.equal(exhaustedView.status, 'completed');
  assert.equal(exhaustedView.attempts.length, 3);
  assert.ok(exhaustedView.reasons.some(reason => reason.includes('暫定診断（在庫不足）')));

  const completeEngine = createDiagnosticEngine(Array.from({ length: 12 }, (_, i) => question(i)));
  let stopped = completeEngine.transition(completeEngine.start(seed()), present(0));
  stopped = completeEngine.transition(stopped, submit(0));
  stopped = completeEngine.transition(stopped, confidence(0));
  stopped = completeEngine.transition(stopped, { type: 'finish', requestId: 'finish-early', at: at(3) });
  const stoppedView = completeEngine.view(stopped, at(3));
  assert.equal(stoppedView.status, 'completed');
  assert.ok(!stoppedView.reasons.some(reason => reason.includes('在庫不足')));

  const shortEngine = createDiagnosticEngine([question(0)]);
  let short = shortEngine.transition(shortEngine.start(seed('short')), present(0));
  short = shortEngine.transition(short, submit(0));
  short = shortEngine.transition(short, confidence(0));
  short = shortEngine.transition(short, present(1));
  const shortView = shortEngine.view(short, at(12));
  assert.equal(shortView.status, 'completed');
  assert.ok(shortView.reasons.some(reason => reason.includes('短い確認')));
  assert.ok(!shortView.reasons.some(reason => reason.includes('在庫不足')));
});

test('immutable replay・厳密入力・逆行時計・catalog変更を拒否する', () => {
  const questions = [question(0)], engine = createDiagnosticEngine(questions), initial = engine.start(seed());
  const session = engine.transition(initial, present(0));
  assert.deepEqual(initial.events, []); assert.equal(questions[0].options[0].earned, 8);
  const view = engine.view(session, at(0)); view.seenFamilies.length = 0;
  assert.deepEqual(engine.view(session, at(0)).seenFamilies, ['family-0']);
  assert.deepEqual(engine.view(JSON.parse(JSON.stringify(session)), at(1)), engine.view(session, at(1)));
  assert.throws(() => engine.transition(session, submit(0, -1)), /CLOCK_REVERSED/);
  assert.throws(() => engine.view(session, at(-1)), /CLOCK_REVERSED/);
  assert.throws(() => engine.transition(session, { ...submit(0), extra: true } as unknown as DiagnosticCommand), /INVALID_DIAGNOSTIC/);
  assert.throws(() => createDiagnosticEngine([{ ...question(0), maxScore: NaN }]), /INVALID_DIAGNOSTIC/);
  assert.throws(() => createDiagnosticEngine([question(0, { version: 'v2' })]).view(session, at(0)), /INVALID_DIAGNOSTIC/);
  assert.throws(() => engine.view({ ...session, events: [...session.events, ...session.events] }, at(0)), /INVALID_DIAGNOSTIC/);
});

test('段階内は未測定の概念を確保し、同じ測定量なら実測未達の概念を再確認する', () => {
  const engine = createDiagnosticEngine([question(0, { conceptId: 'a' }), question(1, { conceptId: 'b' }), question(2, { conceptId: 'c' }),
    question(3, { id: 'z-boundary', conceptId: 'a' }), question(4, { id: 'a-boundary', conceptId: 'b' })]);
  let session = engine.start(seed());
  for (let n = 0; n < 3; n++) {
    session = engine.transition(session, present(n));
    session = engine.transition(session, { ...submit(n), answerId: n === 0 ? 'b' : 'a' });
    session = engine.transition(session, confidence(n));
  }
  session = engine.transition(session, present(3));
  const view = engine.view(session, at(30));
  assert.equal(view.attempts[3].questionId, 'z-boundary');
  assert.match(view.attempts[3].selectionReason, /基準未達があった概念/);
  assert.deepEqual(view.attempts.slice(0, 3).map(item => item.conceptId), ['a', 'b', 'c']);
});
