import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createDiagnosticEngine, type DiagnosticTrialSettings } from '../src/domain/diagnostic-session';
import { BOOKKEEPING_INDEPENDENT_DRAFTS } from '../src/server/bookkeeping-question-drafts';
import { createBookkeepingMiniExamServiceOnPreparedDatabase, initializeDiagnosticSchema, readDiagnosticRecords } from '../src/server/diagnostic-service';
import { GET } from '../src/app/api/mini-exam/route';
import { initializeMasteryEvidenceSchema } from '../src/server/mastery-evidence-service';
import { initializeExamEvidenceSchema } from '../src/server/exam-evidence-service';

const origin = Date.parse('2026-10-05T00:00:00.000Z');
const at = (seconds: number) => new Date(origin + seconds * 1000).toISOString();
const catalog = BOOKKEEPING_INDEPENDENT_DRAFTS.filter(item => item.intendedUse === 'mini_a').map(item => item.question);
const settings: DiagnosticTrialSettings = { purpose: 'before_evaluation', questionLimit: 6, durationSeconds: 720, stageFilter: false };
const trial = () => createDiagnosticEngine(catalog, { practiceOnly: true, ...settings });
const seed = { id: 'mini', mode: 'detailed' as const, subjectId: 'bookkeeping' as const, conceptId: null, createdAt: at(0), seenFamilies: [] };
const start = (requestId: string) => ({ action: 'start', requestId, mode: 'detailed', subjectId: 'bookkeeping', conceptId: null });

test('ミニ演習の固定6問・12分・用途設定は試用だけに保存し、途中の採点・正答・解説を隠す', () => {
  assert.throws(() => createDiagnosticEngine(catalog, settings), /INVALID_DIAGNOSTIC/);
  assert.throws(() => createDiagnosticEngine(catalog, { practiceOnly: true, questionLimit: 6 }), /INVALID_DIAGNOSTIC/);
  const engine = trial();
  let session = engine.start(seed);
  assert.deepEqual(session.trialSettings, settings);
  for (let index = 0; index < 6; index++) {
    const seconds = index * 10;
    session = engine.transition(session, { type: 'present', requestId: `present-${index}`, at: at(seconds), seenFamilies: [] });
    const before = engine.view(session, at(seconds));
    assert.equal(before.deadline, at(720));
    assert.ok(before.currentQuestion);
    assert.equal(before.currentQuestion.options.length, 4);
    const question = catalog.find(item => item.id === before.attempts[index].questionId)!;
    const answer = question.options.find(option => option.earned === 0)!;
    assert.throws(() => engine.transition(session, { type: 'submit', requestId: `hint-${index}`, at: at(seconds + 1), instanceId: `question-${index + 1}`, answerId: answer.id, hintsUsed: true }), /INVALID_DIAGNOSTIC/);
    session = engine.transition(session, { type: 'submit', requestId: `submit-${index}`, at: at(seconds + 1), instanceId: `question-${index + 1}`, answerId: answer.id, hintsUsed: false });
    const awaiting = engine.view(session, at(seconds + 1));
    assert.ok('trialResults' in awaiting);
    assert.deepEqual(awaiting.trialResults, []);
    assert.ok(awaiting.attempts.every(attempt => attempt.earned === null && attempt.errorReason === null));
    session = engine.transition(session, { type: 'confidence', requestId: `confidence-${index}`, at: at(seconds + 2), instanceId: `question-${index + 1}`, value: index === 5 ? null : 'high' });
    if (index < 5) {
      const hidden = engine.view(session, at(seconds + 2));
      assert.ok(hidden.attempts.every(attempt => attempt.earned === null && attempt.errorReason === null));
      assert.deepEqual(hidden.risks, []);
      assert.ok('trialResults' in hidden);
      assert.deepEqual(hidden.trialResults, []);
    }
  }
  const result = engine.view(session, at(60));
  assert.equal(result.status, 'completed');
  assert.ok('trialResults' in result);
  assert.equal(result.trialResults.length, 6);
  assert.ok(result.trialResults.every(item => item.earned === 0 && item.explanation && item.correctAnswers.length === 1));
  assert.ok(result.attempts.every(attempt => attempt.earned === 0));
  assert.equal(new Set(result.attempts.map(attempt => attempt.conceptId)).size, 6);
  assert.deepEqual(engine.view(JSON.parse(JSON.stringify(session)), at(60)), result);
  assert.throws(() => createDiagnosticEngine(catalog, { practiceOnly: true }).view(session, at(60)), /INVALID_DIAGNOSTIC/);
  assert.throws(() => engine.transition(session, { type: 'present', requestId: 'extra', at: at(60), seenFamilies: [] }), /DIAGNOSTIC_CLOSED/);
});

test('12分期限は中断・復元で延びず、期限の提出を拒否し、回答済みだけを終了結果へ出す', () => {
  const engine = trial();
  let session = engine.transition(engine.start(seed), { type: 'present', requestId: 'present', at: at(30), seenFamilies: [] });
  const question = catalog.find(item => item.id === engine.view(session, at(30)).attempts[0].questionId)!;
  session = engine.transition(session, { type: 'submit', requestId: 'submit', at: at(31), instanceId: 'question-1', answerId: question.options.find(item => item.earned === 1)!.id, hintsUsed: false });
  session = engine.transition(session, { type: 'pause', requestId: 'pause', at: at(32) });
  session = JSON.parse(JSON.stringify(session));
  assert.equal(engine.view(session, at(749)).deadline, at(750));
  const expired = engine.view(session, at(750));
  assert.equal(expired.status, 'expired');
  assert.ok('trialResults' in expired);
  assert.deepEqual(expired.trialResults, []);
  assert.equal(expired.attempts[0].earned, null);
  const confidence = { type: 'confidence' as const, requestId: 'confidence-late', at: at(751), instanceId: 'question-1', value: null };
  session = engine.transition(session, confidence);
  assert.deepEqual(engine.transition(session, { ...confidence, at: at(752) }), session);
  const finalized = engine.view(session, at(752));
  assert.ok('trialResults' in finalized);
  assert.equal(finalized.trialResults.length, 1);
  assert.equal(finalized.trialResults[0].earned, 1);
  assert.throws(() => engine.transition(session, { type: 'resume', requestId: 'resume-late', at: at(752) }), /DIAGNOSTIC_CLOSED/);
  assert.ok(expired.reasons.some(reason => reason.includes('12分の期限')));
});

test('同じ保存機構で開始前・終了時を分離し、既見在庫・所有者・独力・資格・exportを守る', async () => {
  const db = new PGlite();
  try {
    await initializeDiagnosticSchema(db);
    await initializeMasteryEvidenceSchema(db);
    await initializeExamEvidenceSchema(db);
    const now = () => new Date(at(0));
    const before = createBookkeepingMiniExamServiceOnPreparedDatabase(db, 'before', now);
    const after = createBookkeepingMiniExamServiceOnPreparedDatabase(db, 'after', now);
    let record = await before.save('alice', start('before-start'));
    await assert.rejects(after.save('alice', start('before-start')), /REQUEST_CONFLICT/);
    const beforeFamily = record.view.attempts[0].familyId;
    const next = (action: string, extra = {}) => ({ action, requestId: `${action}-${record.revision}`, sessionId: record.id, revision: record.revision, ...extra });
    await assert.rejects(before.save('alice', { ...start('wrong-mode'), mode: 'short', conceptId: 'cash-is-not-profit' }), /INVALID_DIAGNOSTIC/);
    await assert.rejects(after.get('alice', record.id), /NOT_FOUND/);
    await assert.rejects(before.get('bob', record.id), /NOT_FOUND/);
    const question = catalog.find(item => item.id === record.view.attempts[0].questionId)!;
    await assert.rejects(before.save('alice', next('submit', { instanceId: 'question-1', answerId: question.options[0].id, hintsUsed: true })), /INVALID_DIAGNOSTIC/);
    record = await before.save('alice', next('submit', { instanceId: 'question-1', answerId: question.options[0].id, hintsUsed: false }));
    record = await before.save('alice', next('pause'));
    const restored = createBookkeepingMiniExamServiceOnPreparedDatabase(db, 'before', now);
    record = await restored.save('alice', next('resume'));
    assert.ok(record.view.attempts.every(attempt => attempt.earned === null));
    record = await restored.save('alice', next('finish'));
    assert.ok('trialResults' in record.view);
    assert.deepEqual(record.view.trialResults, []);
    record = await restored.save('alice', next('confidence', { instanceId: 'question-1', value: null }));
    const ending = await after.save('alice', start('after-start'));
    assert.notEqual(ending.view.attempts[0].familyId, beforeFamily);
    assert.ok(ending.view.attempts[0].questionId.startsWith('bk-mini_b-'));
    const aFamilies = new Set(catalog.map(question => question.familyId));
    assert.ok(BOOKKEEPING_INDEPENDENT_DRAFTS.filter(item => item.intendedUse === 'mini_b').every(item => !aFamilies.has(item.question.familyId)));
    assert.equal((await before.list('alice')).length, 1);
    assert.equal((await after.list('alice')).length, 1);
    const exported = await db.transaction(tx => readDiagnosticRecords(tx, 'alice', undefined, at(0)));
    const oldBefore = exported.find(item => item.id === record.id)!;
    const oldAfter = exported.find(item => item.id === ending.id)!;
    assert.ok('trialResults' in oldBefore.view && 'qualification' in oldBefore.view);
    assert.equal(oldBefore.view.qualification, 'practice_only');
    assert.equal(oldBefore.view.trialResults.length, 1);
    assert.ok('trialResults' in oldAfter.view);
    assert.deepEqual(oldAfter.view.trialResults, []);
    assert.equal(oldAfter.view.currentQuestion, null);
    assert.equal(JSON.stringify(exported).includes('"catalog"'), false);
    const stored = (await db.query<{ state: { trialSettings: DiagnosticTrialSettings } }>('SELECT state FROM diagnostic_sessions WHERE owner_id=$1 AND id=$2', ['alice', record.id])).rows[0];
    assert.deepEqual(stored.state.trialSettings, settings);
    assert.equal((await db.query('SELECT * FROM mastery_evidence_revisions')).rows.length, 0);
    assert.equal((await db.query('SELECT * FROM exam_evidence_revisions')).rows.length, 0);
  } finally { await db.close(); }
});

test('ミニAPIはLOCAL試用flag・host・owner・固定selector・厳密入力をDB取得前に検査する', async () => {
  const names = ['ZEIRISHI_FIXTURE_MODE', 'ZEIRISHI_BOOKKEEPING_MVP', 'ZEIRISHI_SUPABASE_ENABLED'] as const;
  const previous = names.map(name => process.env[name]);
  const request = (url: string, patch: HeadersInit = {}, body: unknown = start('guard')) => new Request(url, { method: 'POST', headers: {
    host: '127.0.0.1:3210', origin: 'http://127.0.0.1:3210', 'content-type': 'application/json', cookie: 'zc-user=11111111-1111-4111-8111-111111111111', ...patch,
  }, body: JSON.stringify(body) });
  try {
    process.env.ZEIRISHI_FIXTURE_MODE = '1'; process.env.ZEIRISHI_BOOKKEEPING_MVP = '1'; process.env.ZEIRISHI_SUPABASE_ENABLED = '1';
    assert.equal((await GET(request('http://127.0.0.1:3210/api/mini-exam?kind=before'))).status, 503);
    process.env.ZEIRISHI_SUPABASE_ENABLED = '0';
    assert.equal((await GET(request('http://127.0.0.1:3210/api/mini-exam?kind=before', { host: 'outside.example' }))).status, 403);
    assert.equal((await GET(request('http://127.0.0.1:3210/api/mini-exam?kind=before', { cookie: '' }))).status, 401);
    assert.equal((await GET(request('http://127.0.0.1:3210/api/mini-exam?kind=before&kind=after'))).status, 400);
    assert.equal((await GET(request('http://127.0.0.1:3210/api/mini-exam?kind=unknown'))).status, 400);
    assert.equal((await GET(request('http://127.0.0.1:3210/api/mini-exam?kind=before', {}, { ...start('inject'), durationSeconds: 999 }))).status, 400);
    process.env.ZEIRISHI_BOOKKEEPING_MVP = '0';
    assert.equal((await GET(request('http://127.0.0.1:3210/api/mini-exam?kind=before'))).status, 503);
  } finally {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index]; });
  }
});


test('ミニ演習の一覧は、新しい別用途の記録が20件を超えても自分の用途の記録を落とさない', async () => {
  const db = new PGlite();
  try {
    await initializeDiagnosticSchema(db);
    const now = () => new Date(at(0));
    const before = createBookkeepingMiniExamServiceOnPreparedDatabase(db, 'before', now);
    const after = createBookkeepingMiniExamServiceOnPreparedDatabase(db, 'after', now);
    const own = await before.save('alice', start('own-start'));
    const other = await after.save('alice', start('other-start'));
    const row = (await db.query<{ revision: number; state: unknown }>('SELECT revision,state FROM diagnostic_sessions WHERE owner_id=$1 AND id=$2', ['alice', other.id])).rows[0];
    for (let index = 0; index < 20; index++) {
      await db.query('INSERT INTO diagnostic_sessions(owner_id,id,revision,updated_at,state) VALUES ($1,$2,$3,$4,$5)',
        ['alice', `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, row.revision, at(100 + index), JSON.stringify(row.state)]);
    }
    assert.deepEqual((await before.list('alice')).map(record => record.id), [own.id]);
    assert.equal((await after.list('alice')).length, 20);
  } finally { await db.close(); }
});

test('早期終了でも受理済み回答すべての自信を確定するまで結果を公開しない', () => {
  const engine = trial();
  let session = engine.transition(engine.start(seed), { type: 'present', requestId: 'early-present', at: at(0), seenFamilies: [] });
  const question = catalog.find(item => item.id === engine.view(session, at(0)).attempts[0].questionId)!;
  session = engine.transition(session, { type: 'submit', requestId: 'early-submit', at: at(1), instanceId: 'question-1', answerId: question.options[0].id, hintsUsed: false });
  session = engine.transition(session, { type: 'finish', requestId: 'early-finish', at: at(2) });
  const hidden = engine.view(session, at(2));
  assert.equal(hidden.status, 'completed');
  assert.ok('trialResults' in hidden);
  assert.deepEqual(hidden.trialResults, []);
  assert.deepEqual(hidden.risks, []);
  assert.equal(hidden.attempts[0].earned, null);
  session = engine.transition(session, { type: 'confidence', requestId: 'early-confidence', at: at(3), instanceId: 'question-1', value: null });
  const result = engine.view(session, at(3));
  assert.ok('trialResults' in result);
  assert.equal(result.trialResults.length, 1);
  assert.equal(result.attempts[0].confidenceRecorded, true);
});
