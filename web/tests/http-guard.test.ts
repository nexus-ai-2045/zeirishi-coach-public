import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createStudyService } from '../src/server/study-service';
import { createStudyHandler } from '../src/http/study-handler';
import { guardRequest, readBody, parseInput } from '../src/http/guard';

const baseHeaders = { host: 'localhost:3210', origin: 'http://localhost:3210', 'content-type': 'application/json' };
const request = (body: unknown, extra: Record<string, string> = {}) => new Request('http://localhost:3210/api/study', {
  method: 'POST', headers: { ...baseHeaders, ...extra }, body: JSON.stringify(body),
});
test('fixture flag, exact Host and Origin, JSON, cross-site are required', () => {
  const start = { action: 'start', requestId: randomUUID() };
  assert.throws(() => guardRequest(request(start), undefined), /FIXTURE_DISABLED/);
  const rejectedHeaders: Record<string, string>[] = [{ host: 'evil.test' }, { origin: 'http://evil.test' }, { origin: 'null' }, { origin: '' },
    { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }];
  for (const headers of rejectedHeaders) {
    assert.throws(() => guardRequest(request(start, headers), '1'));
  }
  assert.doesNotThrow(() => guardRequest(request(start), '1'));
});
test('stream limit ignores forged Content-Length and handles chunk boundaries', async () => {
  let count = 0;
  const stream = new ReadableStream({ pull(controller) {
    if (count++ < 17) controller.enqueue(new Uint8Array(1024).fill(32));
    else controller.close();
  } });
  const input = new Request('http://localhost:3210/api/study', {
    method: 'POST', body: stream, headers: { ...baseHeaders, 'content-length': '1' }, duplex: 'half',
  } as RequestInit);
  await assert.rejects(readBody(input), /BODY_TOO_LARGE/);
  await assert.rejects(readBody(new Request('http://localhost:3210', { method: 'POST', body: '{bad' })), /INVALID_JSON/);
});
test('input allowlist, UUID and answer limits', () => {
  assert.throws(() => parseInput({ action: 'start', requestId: randomUUID(), ownerId: 'spoof' }), /INVALID_INPUT/);
  assert.throws(() => parseInput({ action: 'start', requestId: 'bad' }), /INVALID_REQUEST_ID/);
  assert.throws(() => parseInput({ action: 'save', requestId: randomUUID(), sessionId: randomUUID(), revision: -1, answer: { insurance: '', equipment: '', explanation: '' } }), /INVALID_REVISION/);
  assert.throws(() => parseInput({ action: 'submit', requestId: randomUUID(), sessionId: randomUUID(), answer: { insurance: '1', equipment: '2', explanation: 'x'.repeat(4001) } }), /INVALID_EXPLANATION/);
});
test('guard fails before DB initialization and every error is no-store', async () => {
  const handler = createStudyHandler(async () => { throw new Error('must not initialize'); }, () => undefined);
  const response = await handler(request({ action: 'start', requestId: randomUUID() }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'FIXTURE_DISABLED' });
});
test('database errors are opaque and cookies only appear after persisted start', async () => {
  const handler = createStudyHandler(async () => { throw new Error('postgres secret /private/db'); }, () => '1');
  const response = await handler(request({ action: 'start', requestId: randomUUID() }, { cookie: `zc-user=${randomUUID()}` }));
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), { error: 'INTERNAL_ERROR' });
});
test('actual service: start cookie, owner isolation, save and duplicate cookie rejection', async () => {
  const db = new PGlite();
  try {
    const service = await createStudyService(db);
    const handler = createStudyHandler(async () => service, () => '1');
    const noOwner = await handler(request({ action: 'start', requestId: randomUUID() }));
    assert.equal(noOwner.status, 401);
    const initial = await handler(new Request('http://localhost:3210/api/study', { headers: { host: 'localhost:3210' } }));
    assert.deepEqual(await initial.json(), { session: null });
    const ownerCookie = initial.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const startInput = { action: 'start', requestId: randomUUID() };
    const started = await handler(request(startInput, { cookie: ownerCookie }));
    assert.equal(started.status, 200);
    const cookies = started.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    assert.match(cookies, /zc-user=/);
    assert.match(cookies, /zc-session=/);
    const { session } = await started.json();
    const replay = await handler(request(startInput, { cookie: ownerCookie }));
    assert.equal((await replay.json()).session.id, session.id);
    const intruder = `zc-user=${randomUUID()}; zc-session=${session.id}`;
    const denied = await handler(new Request('http://localhost:3210/api/study', { headers: { host: 'localhost:3210', cookie: intruder } }));
    assert.equal(denied.status, 404);
    const answer = { insurance: '100', equipment: '200', explanation: '検証用' };
    const save = await handler(request({ action: 'save', requestId: randomUUID(), sessionId: session.id, revision: 0, answer }, { cookie: cookies }));
    assert.equal(save.status, 200);
    assert.equal((await save.json()).session.revision, 1);
    assert.match(save.headers.get('set-cookie')!, /zc-user=/);
    assert.match(save.headers.get('set-cookie')!, /zc-session=/);
    const failedSave = await handler(request({ action: 'save', requestId: randomUUID(), sessionId: session.id, revision: 0, answer }, { cookie: cookies }));
    assert.equal(failedSave.status, 409);
    assert.equal(failedSave.headers.get('set-cookie'), null);
    const deniedWrite = await handler(request({ action: 'submit', requestId: randomUUID(), sessionId: session.id, answer }, { cookie: intruder }));
    assert.equal(deniedWrite.status, 404);
    const newTab = await handler(request({ action: 'start', requestId: randomUUID() }, { cookie: cookies }));
    const newCookies = newTab.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const newerSession = (await newTab.json()).session;
    const oldTabSave = await handler(request({ action: 'save', requestId: randomUUID(), sessionId: session.id, revision: 1, answer }, { cookie: newCookies }));
    assert.equal((await oldTabSave.json()).session.id, session.id);
    const explicitGet = await handler(new Request(`http://localhost:3210/api/study?sessionId=${session.id}`, { headers: { host: 'localhost:3210', cookie: newCookies } }));
    assert.equal((await explicitGet.json()).session.id, session.id);
    assert.match(explicitGet.headers.get('set-cookie')!, /zc-user=/);
    assert.match(explicitGet.headers.get('set-cookie')!, /zc-session=/);
    assert.equal((await service.get(ownerCookie.split('=')[1], newerSession.id)).revision, 0);
    const duplicate = await handler(request({ action: 'start', requestId: randomUUID() }, { cookie: `zc-user=${randomUUID()}; zc-user=${randomUUID()}` }));
    assert.equal(duplicate.status, 400);
  } finally { await db.close(); }
});
