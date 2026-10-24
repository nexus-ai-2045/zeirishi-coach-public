import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createDataHandler } from '../src/http/data-handler';

const owner = randomUUID();
function request(body?: unknown, cookie = `zc-user=${owner}`, origin = 'http://127.0.0.1:3210') {
  return new Request('http://127.0.0.1:3210/api/data', { method: body === undefined ? 'GET' : 'POST',
    headers: { host: '127.0.0.1:3210', origin, cookie, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const intent = { action: 'delete', confirmation: 'DELETE_MY_LEARNING_DATA' };
test('data HTTP confirms delete, rejects cross-site/owner overrides and never connects before validation', async () => {
  let calls = 0;
  const service = async (): Promise<never> => { calls++; throw Error('private'); };
  const handler = createDataHandler(service, () => '1');
  assert.equal((await handler(request(undefined, ''))).status, 401);
  for (const body of [null, {}, { action: 'delete' }, { ...intent, owner: randomUUID() }]) {
    assert.equal((await handler(request(body))).status, 400);
  }
  assert.equal((await handler(request(intent, `zc-user=${owner}`, 'https://other.test'))).status, 403);
  assert.equal((await createDataHandler(service, () => undefined)(request(intent))).status, 503);
  assert.equal(calls, 0);
  const repeated = await handler(request(intent, ''));
  assert.equal(repeated.status, 401);
  assert.deepEqual(await repeated.json(), { error: 'USER_REQUIRED' });
  assert.equal(calls, 0);
});
test('data HTTP binds cookie owner, downloads no-store JSON and clears both local cookies only after successful delete', async () => {
  const seen: string[] = [];
  const handler = createDataHandler(async () => ({
    export: async id => { seen.push(id); return { formatVersion: 'test', profile: {} }; },
    delete: async id => { seen.push(id); return { deleted: true as const, developmentOnly: true as const, notice: '削除済み' }; },
  }), () => '1');
  const exported = await handler(request());
  assert.equal(exported.status, 200);
  assert.equal(exported.headers.get('cache-control'), 'no-store');
  assert.match(exported.headers.get('content-disposition')!, /attachment/);
  const deleted = await handler(request(intent));
  assert.equal(deleted.status, 200);
  assert.deepEqual(seen, [owner, owner]);
  assert.equal(deleted.headers.getSetCookie().length, 2);
  assert.ok(deleted.headers.getSetCookie().every(value => value.includes('Max-Age=0')));
  const fail = createDataHandler(async () => { throw Error('sensitive'); }, () => '1');
  const error = await fail(request(intent));
  assert.equal(error.status, 500);
  assert.equal(error.headers.get('set-cookie'), null);
  assert.deepEqual(await error.json(), { error: 'INTERNAL_ERROR' });
});
