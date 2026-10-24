import { SUBJECTS, type ConceptRef, type SubjectId } from './onboarding';
import { StudyError } from './types';
import { strictIsoInstant } from './strict-iso-instant';
import { strictCanonicalJson } from '../server/strict-canonical-json';

/** Trusted server catalog only. These fields check a supplied review record, not human expertise.
 * Never serialize the options' scores/reasons to a learner before answer acceptance. */
export type DiagnosticQuestion = ConceptRef & {
  id: string; version: string; familyId: string; poolId: string; poolVersion: string;
  purpose: 'diagnostic' | 'practice' | 'before_evaluation' | 'after_evaluation';
  stage: 'anchor' | 'boundary' | 'transfer'; status: 'draft' | 'active' | 'retired';
  review: { reviewerId: string; reviewedAt: string; rightsConfirmed: boolean } | null;
  prompt: string; maxScore: number; targetScore: number;
  options: { id: string; label: string; earned: number; errorReason: string | null }[];
};
export type DiagnosticSeed = {
  id: string; mode: 'short' | 'detailed'; subjectId: SubjectId; conceptId: string | null;
  createdAt: string; seenFamilies: string[];
};
type CommonCommand = { requestId: string; at: string };
export type DiagnosticCommand = CommonCommand & (
  { type: 'pause' } | { type: 'resume' } | { type: 'finish' }
  | { type: 'present'; seenFamilies: string[] }
  | { type: 'submit'; instanceId: string; answerId: string; hintsUsed: boolean }
  | { type: 'reveal'; instanceId: string }
  | { type: 'confidence'; instanceId: string; value: 'low' | 'normal' | 'high' | null }
);
export type DiagnosticTrialSettings = { purpose: 'before_evaluation' | 'after_evaluation'; questionLimit: 6; durationSeconds: 720; stageFilter: false };
export type DiagnosticEngineOptions = { practiceOnly?: boolean } & Partial<DiagnosticTrialSettings>;
export type DiagnosticSession = { version: 'diagnostic-session-v1'; catalog: string; seed: DiagnosticSeed; events: DiagnosticCommand[];
  practiceOnly?: true; qualification?: 'practice_only'; trialSettings?: DiagnosticTrialSettings };
export type DiagnosticAttempt = {
  instanceId: string; questionId: string; questionVersion: string; conceptId: string; conceptVersion: string; familyId: string;
  presentedAt: string; acceptedAt: string | null; answerId: string | null; earned: number | null; maxScore: number;
  targetScore: number; errorReason: string | null; hintsUsed: boolean; revealed: boolean;
  confidence: 'low' | 'normal' | 'high' | null; confidenceRecorded: boolean; elapsedSeconds: number | null; selectionReason: string;
};
type State = { status: 'active' | 'paused' | 'completed' | 'expired' | 'unavailable'; startedAt: string | null;
  deadline: string | null; lastAt: string; interrupted: boolean; attempts: DiagnosticAttempt[]; seenFamilies: string[] };
function invalid(): never { throw new StudyError('INVALID_DIAGNOSTIC'); }
function fail(code: string): never { throw new StudyError(code, 409); }
function snapshot<T>(value: T): T { return JSON.parse(strictCanonicalJson(value, invalid)) as T; }
function exact(value: unknown, fields: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) invalid();
}
function id(value: unknown) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) invalid(); }
function instant(value: unknown) { return strictIsoInstant(value, invalid); }
function text(value: unknown) { if (typeof value !== 'string' || !value.trim() || value.length > 1000) invalid(); }
function validSeed(seed: DiagnosticSeed) {
  exact(seed, ['id', 'mode', 'subjectId', 'conceptId', 'createdAt', 'seenFamilies']); id(seed.id); instant(seed.createdAt);
  if (!['short', 'detailed'].includes(seed.mode) || !SUBJECTS.some(subject => subject.id === seed.subjectId)) invalid();
  if (seed.conceptId !== null) id(seed.conceptId);
  if (seed.mode === 'short' && seed.conceptId === null) invalid();
  if (!Array.isArray(seed.seenFamilies) || seed.seenFamilies.length > 10000) invalid(); seed.seenFamilies.forEach(id);
  if (new Set(seed.seenFamilies).size !== seed.seenFamilies.length) invalid();
}
function validCommand(command: DiagnosticCommand) {
  const extra = command?.type === 'submit' ? ['instanceId', 'answerId', 'hintsUsed'] : command?.type === 'reveal' ? ['instanceId'] : command?.type === 'confidence' ? ['instanceId', 'value'] : command?.type === 'present' ? ['seenFamilies'] : [];
  exact(command, ['type', 'requestId', 'at', ...extra]); id(command.requestId); instant(command.at);
  if (!['present', 'pause', 'resume', 'finish', 'submit', 'reveal', 'confidence'].includes(command.type)) invalid();
  if ('instanceId' in command) id(command.instanceId);
  if (command.type === 'submit') { id(command.answerId); if (typeof command.hintsUsed !== 'boolean') invalid(); }
  if (command.type === 'confidence' && command.value !== null && !['low', 'normal', 'high'].includes(command.value)) invalid();
  if (command.type === 'present') {
    if (!Array.isArray(command.seenFamilies) || command.seenFamilies.length > 10000) invalid(); command.seenFamilies.forEach(id);
    if (new Set(command.seenFamilies).size !== command.seenFamilies.length) invalid();
  }
}
/** Pure replayable model. Storage must bind seed/journal to the verified owner and persist
 * presented families across new sessions. No public question pool or ingestion is created. */
export function createDiagnosticEngine(rawQuestions: readonly DiagnosticQuestion[], options: DiagnosticEngineOptions = {}) {
  // A trusted server opt-in, never a learner command or a substituted review record.
  if (Object.keys(options).some(key => !['practiceOnly', 'purpose', 'questionLimit', 'durationSeconds', 'stageFilter'].includes(key)) || (options.practiceOnly !== undefined && typeof options.practiceOnly !== 'boolean')) invalid();
  const practiceOnly = options.practiceOnly === true;
  const configuredTrial = Object.keys(options).some(key => key !== 'practiceOnly');
  if (configuredTrial && (!practiceOnly || !['before_evaluation', 'after_evaluation'].includes(options.purpose ?? '')
    || options.questionLimit !== 6 || options.durationSeconds !== 720 || options.stageFilter !== false)) invalid();
  const trialSettings: DiagnosticTrialSettings | null = configuredTrial ? { purpose: options.purpose!, questionLimit: 6, durationSeconds: 720, stageFilter: false } : null;
  const purpose = trialSettings?.purpose ?? 'diagnostic';
  const qualification = practiceOnly ? { practiceOnly: true as const, qualification: 'practice_only' as const } : {};
  const questions = snapshot(rawQuestions) as DiagnosticQuestion[];
  if (!Array.isArray(questions) || questions.length > 10000) invalid();
  const ids = new Set<string>();
  for (const q of questions) {
    exact(q, ['id', 'version', 'subjectId', 'conceptId', 'conceptVersion', 'familyId', 'poolId', 'poolVersion', 'purpose', 'stage', 'status', 'review', 'prompt', 'maxScore', 'targetScore', 'options']);
    text(q.prompt);
    for (const value of [q.id, q.version, q.conceptId, q.conceptVersion, q.familyId, q.poolId, q.poolVersion]) id(value);
    if (ids.has(q.id)) invalid(); ids.add(q.id);
    if (!SUBJECTS.some(subject => subject.id === q.subjectId) || !['diagnostic', 'practice', 'before_evaluation', 'after_evaluation'].includes(q.purpose)
      || !['anchor', 'boundary', 'transfer'].includes(q.stage) || !['draft', 'active', 'retired'].includes(q.status)) invalid();
    if (!Number.isFinite(q.maxScore) || q.maxScore <= 0 || !Number.isFinite(q.targetScore) || q.targetScore <= 0 || q.targetScore > q.maxScore) invalid();
    if (q.review !== null) { exact(q.review, ['reviewerId', 'reviewedAt', 'rightsConfirmed']); id(q.review.reviewerId); instant(q.review.reviewedAt); if (typeof q.review.rightsConfirmed !== 'boolean') invalid(); }
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 20) invalid();
    const options = new Set<string>();
    for (const option of q.options) { exact(option, ['id', 'label', 'earned', 'errorReason']); id(option.id); text(option.label);
      if (options.has(option.id) || !Number.isFinite(option.earned) || option.earned < 0 || option.earned > q.maxScore) invalid(); options.add(option.id);
      if (option.errorReason !== null) text(option.errorReason);
      if (option.earned < q.targetScore && option.errorReason === null) invalid();
    }
  }
  const catalog = strictCanonicalJson(questions, invalid);
  const foreignFamilies = new Set(questions.filter(q => q.purpose !== purpose).map(q => `${q.subjectId}:${q.familyId}`));
  const foreignPools = new Set(questions.filter(q => q.purpose !== purpose).map(q => q.poolId));
  function candidates(seed: DiagnosticSeed, state: State, at: string) {
    const stage = state.attempts.length < 3 ? 'anchor' : state.attempts.length < 9 ? 'boundary' : 'transfer';
    return questions.filter(q => q.subjectId === seed.subjectId && (seed.mode !== 'short' || q.conceptId === seed.conceptId)
      && q.purpose === purpose && ((q.status === 'active' && q.review?.rightsConfirmed === true && instant(q.review.reviewedAt) <= instant(at))
        || (practiceOnly && q.status === 'draft' && q.review === null))
      && !foreignFamilies.has(`${q.subjectId}:${q.familyId}`) && !foreignPools.has(q.poolId) && !state.seenFamilies.includes(q.familyId)
      && (trialSettings?.stageFilter === false || seed.mode === 'short' || q.stage === stage)).sort((a, b) => {
        // Balance concept coverage, then revisit observed misses; never infer an ability score.
        const attempts = (q: DiagnosticQuestion) => state.attempts.filter(item => item.conceptId === q.conceptId && item.conceptVersion === q.conceptVersion);
        const aa = attempts(a), bb = attempts(b);
        return aa.length - bb.length || Number(bb.some(item => item.earned !== null && item.earned < item.targetScore))
          - Number(aa.some(item => item.earned !== null && item.earned < item.targetScore)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      });
  }
  function initial(seed: DiagnosticSeed): State {
    return { status: 'active', startedAt: null, deadline: null, lastAt: seed.createdAt, interrupted: false, attempts: [], seenFamilies: [...seed.seenFamilies] };
  }
  function apply(seed: DiagnosticSeed, state: State, event: DiagnosticCommand) {
    if (instant(event.at) < instant(state.lastAt)) fail('DIAGNOSTIC_CLOCK_REVERSED');
    if (state.deadline && instant(event.at) >= instant(state.deadline) && ['active', 'paused'].includes(state.status)) state.status = 'expired';
    if (event.type === 'confidence') {
      const attempt = state.attempts.find(item => item.instanceId === event.instanceId);
      if (!attempt?.acceptedAt || attempt.confidenceRecorded) fail('DIAGNOSTIC_CONFIDENCE_UNAVAILABLE');
      attempt.confidence = event.value; attempt.confidenceRecorded = true; state.lastAt = event.at; return;
    }
    if (['expired', 'completed', 'unavailable'].includes(state.status)) fail('DIAGNOSTIC_CLOSED');
    if (event.type === 'finish') { state.status = 'completed'; state.lastAt = event.at; return; }
    if (event.type === 'pause') { if (state.status !== 'active') fail('DIAGNOSTIC_NOT_ACTIVE'); state.status = 'paused'; state.interrupted = true; state.lastAt = event.at; return; }
    if (event.type === 'resume') { if (state.status !== 'paused') fail('DIAGNOSTIC_NOT_PAUSED'); state.status = 'active'; state.lastAt = event.at; return; }
    if (state.status !== 'active') fail('DIAGNOSTIC_NOT_ACTIVE');
    const pending = state.attempts.find(item => item.acceptedAt === null && !item.revealed);
    if (event.type === 'present') {
      if (pending) fail('DIAGNOSTIC_ANSWER_PENDING');
      if (state.attempts.some(item => item.acceptedAt && !item.confidenceRecorded)) fail('DIAGNOSTIC_CONFIDENCE_PENDING');
      state.seenFamilies = [...new Set([...state.seenFamilies, ...event.seenFamilies])];
      const q = candidates(seed, state, event.at)[0];
      if (!q) { state.status = state.attempts.length ? 'completed' : 'unavailable'; state.lastAt = event.at; return; }
      if (!state.startedAt) { state.startedAt = event.at; if (seed.mode === 'detailed') state.deadline = new Date(instant(event.at) + (trialSettings?.durationSeconds ?? 480) * 1000).toISOString(); }
      state.seenFamilies.push(q.familyId);
      const previous = state.attempts.filter(item => item.conceptId === q.conceptId && item.conceptVersion === q.conceptVersion);
      state.attempts.push({ instanceId: `question-${state.attempts.length + 1}`, questionId: q.id, questionVersion: q.version,
        conceptId: q.conceptId, conceptVersion: q.conceptVersion, familyId: q.familyId, presentedAt: event.at,
        acceptedAt: null, answerId: null, earned: null, maxScore: q.maxScore, targetScore: q.targetScore, errorReason: null,
        hintsUsed: false, revealed: false, confidence: null, confidenceRecorded: false, elapsedSeconds: null,
        selectionReason: previous.some(item => item.earned !== null && item.earned < item.targetScore)
          ? '回答済みの問題で基準未達があった概念を、別の問題で確認します。' : previous.length === 0 ? 'まだ測定していない概念を確認します。' : '同じ概念を別の問題で確認します。' });
    } else {
      if (!pending || pending.instanceId !== event.instanceId) fail('DIAGNOSTIC_ANSWER_FIXED');
      if (event.type === 'reveal') pending.revealed = true;
      else if (event.type === 'submit') {
        if (trialSettings && event.hintsUsed) invalid();
        const q = questions.find(q => q.id === pending.questionId)!;
        const option = q.options.find(option => option.id === event.answerId); if (!option) invalid();
        Object.assign(pending, { acceptedAt: event.at, answerId: event.answerId, earned: option.earned, errorReason: option.errorReason,
          hintsUsed: event.hintsUsed, elapsedSeconds: seed.mode === 'detailed' && !state.interrupted ? (instant(event.at) - instant(pending.presentedAt)) / 1000 : null });
      }
      if (state.attempts.length >= (trialSettings?.questionLimit ?? (seed.mode === 'short' ? 3 : 12))) state.status = 'completed';
    }
    state.lastAt = event.at;
  }
  function replay(raw: DiagnosticSession) {
    const session = snapshot(raw);
    exact(session, ['version', 'catalog', 'seed', 'events', ...(session.practiceOnly === true ? ['practiceOnly', 'qualification'] : []), ...(session.trialSettings ? ['trialSettings'] : [])]);
    if ((session.practiceOnly === true) !== practiceOnly || (practiceOnly && session.qualification !== 'practice_only')
      || strictCanonicalJson(session.trialSettings ?? null, invalid) !== strictCanonicalJson(trialSettings, invalid)) invalid();
    if (trialSettings && (session.seed.mode !== 'detailed' || session.seed.conceptId !== null)) invalid();
    if (session.version !== 'diagnostic-session-v1' || session.catalog !== catalog || !Array.isArray(session.events) || session.events.length > 100) invalid();
    validSeed(session.seed); const state = initial(session.seed), requests = new Set<string>();
    for (const event of session.events) { validCommand(event); if (requests.has(event.requestId)) invalid(); requests.add(event.requestId); apply(session.seed, state, event); }
    return { session, state };
  }
  return {
    start(raw: DiagnosticSeed): DiagnosticSession {
      const seed = snapshot(raw); validSeed(seed);
      if (trialSettings && (seed.mode !== 'detailed' || seed.conceptId !== null)) invalid();
      return { version: 'diagnostic-session-v1', catalog, seed, events: [], ...qualification, ...(trialSettings ? { trialSettings } : {}) };
    },
    transition(raw: DiagnosticSession, rawCommand: DiagnosticCommand): DiagnosticSession {
      const { session, state } = replay(raw), command = snapshot(rawCommand); validCommand(command);
      const prior = session.events.find(event => event.requestId === command.requestId);
      if (prior) {
        const { at: _a, ...first } = prior, { at: _b, ...retry } = command;
        if (strictCanonicalJson(first, invalid) !== strictCanonicalJson(retry, invalid)) fail('DIAGNOSTIC_REQUEST_CONFLICT');
        return session; // Receipt survives deadline; no regrading or overwriting subsequent answers.
      }
      apply(session.seed, state, command);
      if (session.events.length >= 100) fail('DIAGNOSTIC_EVENT_LIMIT');
      return { ...session, events: [...session.events, command] };
    },
    view(raw: DiagnosticSession, asOf: string) {
      const { session, state } = replay(raw); if (instant(asOf) < instant(state.lastAt)) fail('DIAGNOSTIC_CLOCK_REVERSED');
      if (state.deadline && instant(asOf) >= instant(state.deadline) && ['active', 'paused'].includes(state.status)) state.status = 'expired';
      const accepted = state.attempts.filter(item => item.acceptedAt !== null);
      const reasons = ['長期保持は未確認です。', '測定した概念だけの暫定診断です。'];
      if (practiceOnly) reasons.unshift('原稿試用です。専門審査前のため、正式診断・習熟の証拠には使えません。');
      if (session.seed.mode === 'short') reasons.push('短い確認は試験速度・科目合格の証拠には使いません。');
      if (accepted.length < (trialSettings?.questionLimit ?? (session.seed.mode === 'short' ? 3 : 8))) reasons.push('回答済みの問題が少なく、未出題領域は未確認です。');
      // Only a detailed session whose final `present` exhausted the eligible unseen
      // inventory is stock-limited. A learner's early finish and the eight-minute
      // deadline have separate states/events; short checks do not use the 8-question bar.
      const inventoryExhausted = session.seed.mode === 'detailed' && state.status === 'completed'
        && state.attempts.length < (trialSettings?.questionLimit ?? 12) && session.events.at(-1)?.type === 'present';
      if (inventoryExhausted) reasons.push('暫定診断（在庫不足）です。未見の診断問題がなくなったため、測定できた範囲だけを表示しています。');
      if (state.attempts.some(item => item.acceptedAt === null)) reasons.push('未回答・回答放棄は誤答にせず未確認です。');
      if (state.interrupted) reasons.push('中断を含むため速度は参考評価に使いません。');
      if (accepted.some(item => item.hintsUsed)) reasons.push('ヒント利用を含む回答は独力の証拠ではありません。');
      if (state.status === 'unavailable') reasons.push('確認問題準備中です。好きな単元を直接選べます。');
      if (state.status === 'expired') reasons.push(`${trialSettings ? '12' : '8'}分の期限に達しました。提出済みの証拠だけで確認します。`);
      const resultsHidden = trialSettings !== null && (['active', 'paused'].includes(state.status)
        || accepted.some(item => !item.confidenceRecorded));
      const risks = (resultsHidden ? [] : accepted).filter(item => item.confidenceRecorded && item.earned! < item.targetScore).sort((a, b) =>
        a.earned! / a.maxScore - b.earned! / b.maxScore || a.instanceId.localeCompare(b.instanceId)).slice(0, 3)
        .map(item => ({ conceptId: item.conceptId, evidenceId: item.instanceId, occurredAt: item.acceptedAt!, reason: item.errorReason! }));
      const pending = state.attempts.find(item => item.acceptedAt === null && !item.revealed);
      const q = pending && questions.find(item => item.id === pending.questionId);
      const currentQuestion = q && pending && state.status === 'active' ? { instanceId: pending.instanceId, prompt: q.prompt,
        options: q.options.map(option => ({ id: option.id, label: option.label })) } : null;
      const view = { ...state, attempts: state.attempts.map(item => !resultsHidden && (item.confidenceRecorded || trialSettings !== null) ? item : { ...item, earned: null, errorReason: null }),
        currentQuestion, provisional: true as const, reasons, risks, longTermRetention: null, directSelectionAllowed: true as const };
      if (practiceOnly) {
        const qualified = { ...view, practiceOnly: true as const, qualification: 'practice_only' as const };
        if (trialSettings) return { ...qualified, trialSettings, trialResults: resultsHidden ? [] : accepted.map(attempt => {
          const question = questions.find(item => item.id === attempt.questionId)!;
          return { questionId: attempt.questionId, earned: attempt.earned!, maxScore: attempt.maxScore,
            correctAnswers: question.options.filter(option => option.earned >= question.targetScore).map(option => option.label),
            explanation: question.options.find(option => option.errorReason !== null)?.errorReason ?? 'この回答で基準を満たしています。' };
        }) };
        return qualified;
      }
      return view;
    },
  };
}
