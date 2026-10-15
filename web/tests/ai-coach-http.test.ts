import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createAiCoachHandler } from '../src/http/ai-coach-handler';
import { createCafeService } from '../src/server/cafe-service';
import { AI_COACH_SCHEMA, createAiCoachServiceOnPreparedDatabase } from '../src/server/ai-coach-service';

const owner = randomUUID();
const valid = { caseId: randomUUID(), requestId: randomUUID(), attemptId: randomUUID(), caseVersion: 'fixture-v1',
 progressRevision: 1, purpose: 'explain_to_owner', explanation: '当期と翌期に分けます。', confirmed: true };
function request(body: unknown = valid, cookie: string = owner, suffix = '', method = 'POST') {
 return new Request(`http://127.0.0.1:3210/api/ai-coach${suffix}`, { method,
  headers: { host: '127.0.0.1:3210', origin: 'http://127.0.0.1:3210', 'content-type': 'application/json',
   ...(cookie ? { cookie: `zc-user=${cookie}` } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
}
test('AI HTTP validates explicit intent and input before acquiring the service', async () => {
 let acquisitions = 0;
 const handler = createAiCoachHandler(async () => { acquisitions++; throw new Error('private-provider-error'); }, () => '1');
 for (const body of [null, [], { ...valid, ownerId: randomUUID() }, { ...valid, mastery: 100 },
  { ...valid, confirmed: false }, { ...valid, explanation: 'x'.repeat(2001) }, { ...valid, progressRevision: -1 },
  { ...valid, attemptId: null }, { ...valid, purpose: 'grade' }, { ...valid, caseId: ['bad'] },
  { ...valid, question: 'x'.repeat(601) }, { ...valid, question: '質問', recentTurns: [{ question: '前の質問', reply: '' }] }]) {
  const response = await handler(request(body));
  assert.equal(response.status, 400); assert.equal(response.headers.get('cache-control'), 'no-store');
 }
 assert.equal((await handler(request(valid, ''))).status, 401);
 assert.equal((await handler(request(valid, owner, '?owner=other'))).status, 400);
 assert.equal((await handler(request(valid, owner, '', 'GET'))).status, 405);
 assert.equal(acquisitions, 0);
 assert.equal((await createAiCoachHandler(async () => { acquisitions++; throw Error(); }, () => undefined)(request())).status, 503);
 assert.equal(acquisitions, 0);
 const unavailable = await handler(request());
 assert.equal(unavailable.status, 503); assert.deepEqual(await unavailable.json(), { error: 'AI_UNAVAILABLE' });
});

test('AI HTTP binds saved explanation to owner and revision and returns an honest disabled fallback', async () => {
 const db = new PGlite();
 try {
  const cafe = await createCafeService(db); await db.exec(AI_COACH_SCHEMA);
  const service = createAiCoachServiceOnPreparedDatabase(db);
  const handler = createAiCoachHandler(async () => service, () => '1');
  const start = await cafe.start(owner, randomUUID());
  const submitted = await cafe.submit(owner, start.id, { requestId: randomUUID(), optionId: 'h4r9' });
  let body = { ...valid, caseId: start.id, attemptId: submitted.attemptId!, caseVersion: submitted.caseVersion };
  assert.equal((await handler(request(body))).status, 404);
  const revealed = await cafe.confidence(owner, start.id, { requestId: randomUUID(), confidence: null });
  const saved = await cafe.saveProgress(owner, start.id, { requestId: randomUUID(), revision: revealed.progressRevision,
   phase: 'teach_back', explanation: body.explanation });
  body = { ...body, progressRevision: saved.progressRevision };
  assert.equal((await handler(request(body, randomUUID()))).status, 404);
  assert.equal((await handler(request({ ...body, progressRevision: saved.progressRevision - 1 }))).status, 409);
  assert.equal((await handler(request({ ...body, explanation: '保存していない説明' }))).status, 409);
  assert.equal((await db.query('SELECT * FROM ai_interaction_summaries')).rows.length, 0);
  const before = (await db.query('SELECT * FROM cafe_attempts')).rows;
  const response = await handler(request(body));
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  const reply = await response.json();
  assert.equal(reply.mode, 'fixed'); assert.equal(reply.label, '固定の理解確認');
  assert.equal(reply.reason, 'disabled'); assert.equal(reply.evidenceQualification, 'practice_only');
  assert.equal('score' in reply, false); assert.equal('mastery' in reply, false);
  assert.equal((await (await handler(request(body))).json()).reason, 'already_requested');
  assert.deepEqual((await db.query('SELECT * FROM cafe_attempts')).rows, before);
 } finally { await db.close(); }
});
