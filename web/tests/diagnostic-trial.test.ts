import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createDiagnosticEngine, type DiagnosticQuestion, type DiagnosticSeed } from '../src/domain/diagnostic-session';
import { createDiagnosticHandler } from '../src/http/diagnostic-handler';
import { BOOKKEEPING_ALL_QUESTION_DRAFTS, BOOKKEEPING_DIAGNOSTIC_DRAFTS } from '../src/server/bookkeeping-question-drafts';
import { APPROVED_DIAGNOSTIC_QUESTIONS, createDiagnosticService, createDiagnosticServiceOnPreparedDatabase, readDiagnosticRecords } from '../src/server/diagnostic-service';

const at = '2026-10-05T00:00:00.000Z';
const questions = BOOKKEEPING_DIAGNOSTIC_DRAFTS.map(item => item.question);
const seed: DiagnosticSeed = { id: 'trial', mode: 'short', subjectId: 'bookkeeping', conceptId: 'cash-is-not-profit', createdAt: at, seenFamilies: [] };
const start = (requestId: string) => ({ action: 'start', requestId, mode: 'short', subjectId: 'bookkeeping', conceptId: seed.conceptId });
const notice = /原稿試用.*正式診断・習熟の証拠には使えません/;
const qualification = (view: ReturnType<ReturnType<typeof createDiagnosticEngine>['view']>) => 'qualification' in view ? view.qualification : undefined;

test('未審査診断はサーバーの明示試用だけで出題され、正式経路と旧sessionの形を保つ', () => {
  assert.deepEqual(APPROVED_DIAGNOSTIC_QUESTIONS, []);
  assert.ok(questions.every(question => question.status === 'draft' && question.review === null));
  const official = createDiagnosticEngine(questions);
  const old = official.start(seed);
  assert.deepEqual(Object.keys(old).sort(), ['catalog', 'events', 'seed', 'version']);
  assert.equal(official.view(official.transition(old, { type: 'present', requestId: 'official', at, seenFamilies: [] }), at).status, 'unavailable');
  assert.deepEqual(official.view(JSON.parse(JSON.stringify(old)), at), official.view(old, at));
  const trial = createDiagnosticEngine(questions, { practiceOnly: true });
  const session = trial.transition(trial.start(seed), { type: 'present', requestId: 'trial', at, seenFamilies: [] });
  assert.equal(session.practiceOnly, true);
  assert.equal(session.qualification, 'practice_only');
  const restored = JSON.parse(JSON.stringify(session));
  assert.deepEqual(trial.view(restored, at), trial.view(session, at));
  const view = trial.view(restored, at);
  assert.equal(qualification(view), 'practice_only');
  assert.ok(view.reasons.some(reason => notice.test(reason)));
  assert.equal(view.currentQuestion!.options.length, 4);
  assert.ok(view.currentQuestion!.options.every(option => Object.keys(option).sort().join(',') === 'id,label'));
  assert.throws(() => official.view(session, at), /INVALID_DIAGNOSTIC/);
  assert.throws(() => trial.view(old, at), /INVALID_DIAGNOSTIC/);
  assert.throws(() => trial.view({ ...session, qualification: undefined }, at), /INVALID_DIAGNOSTIC/);
});

test('試用でも前後評価と練習のpool・familyを診断へ混入させない', () => {
  const catalog = BOOKKEEPING_ALL_QUESTION_DRAFTS.map(item => item.question);
  const engine = createDiagnosticEngine(catalog, { practiceOnly: true });
  const session = engine.transition(engine.start(seed), { type: 'present', requestId: 'only-diagnostic', at, seenFamilies: [] });
  assert.ok(questions.some(question => question.id === engine.view(session, at).attempts[0].questionId));
  for (const purpose of ['before_evaluation', 'after_evaluation', 'practice'] as const) {
    const candidate = questions.find(question => question.conceptId === seed.conceptId)!;
    const foreign: DiagnosticQuestion = { ...candidate, id: `foreign-${purpose}`, purpose };
    const conflicted = createDiagnosticEngine([candidate, foreign], { practiceOnly: true });
    assert.equal(conflicted.view(conflicted.transition(conflicted.start(seed), { type: 'present', requestId: purpose, at, seenFamilies: [] }), at).status, 'unavailable');
    const onlyForeign = createDiagnosticEngine([foreign], { practiceOnly: true });
    assert.equal(onlyForeign.view(onlyForeign.transition(onlyForeign.start(seed), { type: 'present', requestId: purpose, at, seenFamilies: [] }), at).status, 'unavailable');
  }
});

test('LOCAL fixture試用は入力注入を拒否し、保存・再開・一覧・export・旧版履歴でも資格を保持する', async () => {
  const db = new PGlite();
  try {
    const now = () => new Date(at);
    const service = await createDiagnosticService(db, questions, now, { practiceOnly: true });
    const request = (body: unknown) => new Request('http://127.0.0.1:3210/api/diagnostic', { method: 'POST', headers: {
      host: '127.0.0.1:3210', origin: 'http://127.0.0.1:3210', 'content-type': 'application/json', cookie: 'zc-user=11111111-1111-4111-8111-111111111111',
    }, body: JSON.stringify(body) });
    let acquisitions = 0;
    const acquire = async () => { acquisitions++; return service; };
    assert.equal((await createDiagnosticHandler(acquire, () => undefined)(request(start('off')))).status, 503);
    const handler = createDiagnosticHandler(acquire, () => '1');
    assert.equal((await handler(request({ ...start('inject'), practiceOnly: true }))).status, 400);
    assert.equal((await handler(request({ ...start('inject-qualification'), qualification: 'practice_only' }))).status, 400);
    assert.equal(acquisitions, 0);
    const response = await handler(request(start('fixture')));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).item.view.qualification, 'practice_only');

    let record = await service.save('alice', start('saved'));
    const sessionId = record.id;
    const command = (action: string, extra = {}) => ({ action, requestId: `${action}-${record.revision}`, sessionId, revision: record.revision, ...extra });
    record = await service.save('alice', command('submit', { instanceId: 'question-1', answerId: questions.find(question => question.id === record.view.attempts[0].questionId)!.options[0].id, hintsUsed: true }));
    assert.equal(record.view.attempts[0].earned, null);
    record = await service.save('alice', command('confidence', { instanceId: 'question-1', value: 'low' }));
    record = await service.save('alice', command('pause'));
    const restored = createDiagnosticServiceOnPreparedDatabase(db, questions, now, { practiceOnly: true });
    record = await restored.save('alice', command('resume'));
    assert.equal(qualification(record.view), 'practice_only');
    assert.ok(record.view.reasons.some(reason => reason.includes('ヒント利用')));
    assert.equal(qualification((await restored.list('alice'))[0].view), 'practice_only');
    const exported = await db.transaction(tx => readDiagnosticRecords(tx, 'alice', undefined, at));
    assert.equal(qualification(exported[0].view), 'practice_only');
    assert.ok('practiceOnly' in exported[0].view && exported[0].view.practiceOnly === true);
    assert.ok(exported[0].view.reasons.some(reason => notice.test(reason)));
    assert.equal(exported[0].view.currentQuestion, null);
    assert.equal(JSON.stringify(exported).includes('"catalog"'), false);
    const official = createDiagnosticServiceOnPreparedDatabase(db, questions, now);
    const archived = await official.get('alice', sessionId);
    assert.equal(archived.view.status, 'unavailable');
    assert.equal(qualification(archived.view), 'practice_only');
    assert.ok(archived.view.reasons.some(reason => notice.test(reason)));
    await assert.rejects(official.save('alice', command('present')), /INVALID_DIAGNOSTIC/);
    const row = (await db.query<{ state: { practiceOnly: boolean; qualification: string } }>('SELECT state FROM diagnostic_sessions WHERE owner_id=$1', ['alice'])).rows[0];
    assert.equal(row.state.practiceOnly, true);
    assert.equal(row.state.qualification, 'practice_only');
  } finally { await db.close(); }
});
