import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createCafeHandler } from '../src/http/cafe-handler';
import { createCafeService } from '../src/server/cafe-service';
const owner = randomUUID();
function request(body?: unknown, cookieOwner: string = owner, query = '') {
  return new Request(`http://127.0.0.1:3210/api/cafe${query}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { host: '127.0.0.1:3210', origin: 'http://127.0.0.1:3210', 'content-type': 'application/json',
      ...(cookieOwner ? { cookie: `zc-user=${cookieOwner}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
test('cafe HTTP rejects malformed actions and ownership fields before DB access', async () => {
  let calls = 0;
  const handler = createCafeHandler(async () => { calls++; throw new Error('secret'); }, () => '1');
  const invalid = [
    { action: 'constructor', requestId: randomUUID() },
    { action: 'start', requestId: [randomUUID()] },
    { action: 'start', requestId: randomUUID(), ownerId: randomUUID() },
    { action: 'start', requestId: randomUUID(), materialId: 'without-concept' },
    { action: 'start', requestId: randomUUID(), caseVersion: 'without-material' },
    { action: 'progress', requestId: randomUUID(), caseId: randomUUID(), revision: 0, phase: 'reflection', explanation: 'x'.repeat(2001) },
    { action: 'confidence', requestId: randomUUID(), caseId: randomUUID(), confidence: 'wrong' },
  ];
  for (const body of invalid) {
    const response = await handler(request(body));
    assert.equal(response.status, 400);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal((await handler(request({ action: 'start', requestId: randomUUID() }, ''))).status, 401);
  const unavailable = await handler(request({ action: 'start', requestId: randomUUID(),
    concept: { subjectId: 'bookkeeping', conceptId: 'other-concept', conceptVersion: 'other-v1' } }));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { error: 'MATERIAL_NOT_AVAILABLE' });
  assert.equal(calls, 0);
  const disabled = createCafeHandler(async () => { calls++; throw Error(); }, () => undefined);
  assert.equal((await disabled(request({ action: 'start', requestId: randomUUID() }))).status, 503);
  assert.equal(calls, 0);
});

test('cafe HTTP persists a complete flow while hiding result until confidence is fixed', async () => {
  const db = new PGlite();
  try {
    const service = await createCafeService(db);
    const handler = createCafeHandler(async () => service, () => '1');
    const startResponse = await handler(request({ action: 'start', requestId: randomUUID() }));
    assert.equal(startResponse.status, 200);
    assert.match(startResponse.headers.get('set-cookie')!, new RegExp(`^zc-user=${owner};`));
    const start = (await startResponse.json()).session;
    const submitRequest = { action: 'submit', requestId: randomUUID(), caseId: start.id, optionId: 'h4r9' };
    const submitted = await handler(request(submitRequest));
    assert.equal(submitted.status, 200);
    assert.equal((await submitted.json()).session.result, null);
    const get = await handler(request(undefined, owner, `?caseId=${start.id}`));
    assert.match(get.headers.get('set-cookie')!, /Max-Age=604800/);
    assert.equal((await get.json()).session.result, null);
    assert.equal((await handler(request(undefined, randomUUID(), `?caseId=${start.id}`))).status, 404);
    const fixedResponse = await handler(request({ action: 'confidence', requestId: randomUUID(), caseId: start.id, confidence: null }));
    assert.equal(fixedResponse.status, 200);
    const fixed = (await fixedResponse.json()).session;
    assert.equal(fixed.result.correct, true);
    const progressResponse = await handler(request({ action: 'progress', requestId: randomUUID(), caseId: start.id,
      revision: fixed.progressRevision, phase: 'teach_back', explanation: '今年使う4か月だけを費用にします。' }));
    assert.equal(progressResponse.status, 200);
    const progress = (await progressResponse.json()).session;
    assert.equal((await handler(request({ action: 'complete', requestId: randomUUID(), caseId: start.id }))).status, 409);
    const reflection = await handler(request({ action: 'progress', requestId: randomUUID(), caseId: start.id,
      revision: progress.progressRevision, phase: 'reflection', explanation: progress.explanation }));
    assert.equal(reflection.status, 200);
    const replay = await handler(request(submitRequest));
    assert.equal((await replay.json()).session.explanation, '今年使う4か月だけを費用にします。');
    assert.equal((await handler(request({ action: 'complete', requestId: randomUUID(), caseId: start.id }))).status, 200);
  } finally { await db.close(); }
});
