import assert from 'node:assert/strict';
import test from 'node:test';
import { createLearnerContextHandler } from '../src/http/learner-context';
import type { TransactionDatabase } from '../src/server/database';
import type { VerifiedAuthReader } from '../src/server/supabase-auth';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const settings = { url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_test_only', appOrigin: 'https://coach.example' };
function request(method = 'GET', headers: Record<string, string> = {}) {
  return new Request(`${settings.appOrigin}/api/learning`, { method, headers: { 'X-Zeirishi-Learner': alice, ...headers } });
}
function fixture(id = alice) {
  let currentId: string | null = id;
  let active = true;
  let revoked = false;
  let dbCalls = 0;
  const queries: string[] = [];
  const headers = new Headers();
  const reader: VerifiedAuthReader = {
    getUser: async () => {
      headers.append('Set-Cookie', `verified-${id}=updated; HttpOnly; Secure`);
      return { error: false, user: currentId ? { id: currentId, isAnonymous: false, emailConfirmed: true } : null };
    },
    getAccess: async userId => ({ userId, status: active ? 'active' : 'revoked' }),
  };
  const base: TransactionDatabase = { transaction: async operation => operation({ query: async <T>(sql: string, params?: unknown[]) => {
    queries.push(sql);
    if (sql.includes('pg_catalog.pg_roles')) return { rows: [{ name: 'zeirishi_app', superuser: false, bypass: false }] as T[] };
    if (sql.includes('require_active_learner') && revoked) throw { code: 'ZC403' };
    if (sql === 'LEARNING_OPERATION') return { rows: [{ user: params![0] }] as T[] };
    return { rows: [] };
  } }) };
  return { headers, reader, base, queries,
    setId: (value: string | null) => { currentId = value; }, setActive: (value: boolean) => { active = value; }, revoke: () => { revoked = true; },
    getDatabase: () => { dbCalls++; return base; }, dbCalls: () => dbCalls,
  };
}

test('method, origin, cross-site and strict JSON guards precede auth and database', async () => {
  let contexts = 0; const fx = fixture();
  const handler = createLearnerContextHandler({ config: () => settings, context: () => { contexts++; return fx; }, getDatabase: fx.getDatabase, operation: async () => ({ ok: true }) });
  for (const [req, status] of [
    [request('DELETE'), 405], [new Request('https://evil.example/api/learning'), 403],
    [request('GET', { origin: 'https://evil.example' }), 403], [request('GET', { 'sec-fetch-site': 'cross-site' }), 403],
    [request('POST', { 'content-type': 'application/json' }), 403],
    [request('POST', { origin: settings.appOrigin, 'content-type': 'text/plain' }), 415],
    [request('POST', { origin: settings.appOrigin, 'content-type': 'application/json;bad=true' }), 415],
  ] as const) assert.equal((await handler(req)).status, status);
  assert.equal(contexts, 0); assert.equal(fx.dbCalls(), 0);
  assert.equal((await handler(request('POST', { origin: settings.appOrigin, 'content-type': 'application/json; charset=utf-8' }))).status, 200);
});

test('missing user and revoked invitation do not acquire the database; refresh cookies survive rejection', async () => {
  for (const missing of [true, false]) {
    const fx = fixture(); if (missing) fx.setId(null); else fx.setActive(false);
    const handler = createLearnerContextHandler({ config: () => settings, context: () => fx, getDatabase: fx.getDatabase, operation: async () => { throw new Error('must not run'); } });
    const response = await handler(request());
    assert.equal(response.status, missing ? 401 : 403); assert.equal(fx.dbCalls(), 0);
    assert.match(response.headers.get('set-cookie')!, /updated/); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});

test('concurrent users retain separate identities, claims and refresh headers on a shared injected database', async () => {
  const a = fixture(alice); const b = fixture(bob); const claims: string[] = [];
  const shared: TransactionDatabase = { transaction: async operation => operation({ query: async <T>(sql: string, params?: unknown[]) => {
    await Promise.resolve();
    if (sql.includes('pg_catalog.pg_roles')) return { rows: [{ name: 'zeirishi_app', superuser: false, bypass: false }] as T[] };
    if (sql.includes('set_config')) claims.push(JSON.parse(params![0] as string).sub);
    return { rows: [] };
  } }) };
  const handler = createLearnerContextHandler({ config: () => settings, context: req => req.headers.get('x-test-user') === 'a' ? a : b, getDatabase: () => shared,
    operation: async (_request, learner) => learner.database.transaction(async () => ({ userId: learner.userId })) });
  const [ra, rb] = await Promise.all([handler(request('GET', { 'x-test-user': 'a', cookie: `zc-user=${bob}` })), handler(request('GET', { 'x-test-user': 'b', 'X-Zeirishi-Learner': bob, cookie: `zc-user=${alice}` }))]);
  assert.deepEqual(await ra.json(), { userId: alice }); assert.deepEqual(await rb.json(), { userId: bob });
  assert.deepEqual(claims.sort(), [alice, bob]);
  assert.match(ra.headers.get('set-cookie')!, new RegExp(alice)); assert.doesNotMatch(ra.headers.get('set-cookie')!, new RegExp(bob));
  assert.match(rb.headers.get('set-cookie')!, new RegExp(bob));
});

test('missing or stale displayed identity cannot read, save or delete the currently authenticated learner data', async () => {
  const fx = fixture(bob); let operations = 0;
  const handler = createLearnerContextHandler({ config: () => settings, context: () => fx, getDatabase: fx.getDatabase,
    operation: async () => { operations++; return { deleted: true }; } });
  for (const method of ['GET', 'POST']) {
    for (const identity of [null, alice, `${bob}, ${alice}`]) {
      const headers = new Headers({ origin: settings.appOrigin, 'content-type': 'application/json' });
      if (identity !== null) headers.set('X-Zeirishi-Learner', identity);
      const response = await handler(new Request(`${settings.appOrigin}/api/data`, { method, headers }));
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: 'AUTH_IDENTITY_CHANGED' });
      assert.match(response.headers.get('set-cookie')!, /updated/);
    }
  }
  assert.equal(fx.dbCalls(), 0); assert.equal(operations, 0);
});

test('identity change between invitation and binding is rejected; transaction revocation is enforced by existing adapter', async () => {
  const fx = fixture();
  const switched = createLearnerContextHandler({ config: () => settings, context: () => fx, getDatabase: () => { fx.setId(bob); return fx.base; }, operation: async () => { throw new Error('must not run'); } });
  assert.deepEqual(await (await switched(request())).json(), { error: 'AUTH_IDENTITY_CHANGED' });
  assert.equal(fx.queries.length, 0);
  for (const mode of ['revoked', 'switched'] as const) {
    const current = fixture(); let ran = false;
    const handler = createLearnerContextHandler({ config: () => settings, context: () => current, getDatabase: current.getDatabase,
      operation: async (_request, learner) => {
        if (mode === 'revoked') current.revoke(); else current.setId(bob);
        return learner.database.transaction(async () => { ran = true; return null; });
      } });
    const response = await handler(request()); assert.equal(response.status, mode === 'revoked' ? 403 : 401); assert.equal(ran, false);
    assert.match(response.headers.get('set-cookie')!, /updated/);
  }
});

test('operation errors and invalid response returns remain opaque 503 JSON with refreshed cookies', async () => {
  for (const invalid of [false, true]) {
    const fx = fixture();
    const handler = createLearnerContextHandler({ config: () => settings, context: () => fx, getDatabase: fx.getDatabase,
      operation: async () => {
        if (invalid) return new Response('secret', { status: 302, headers: { Location: 'https://evil.example' } }) as never;
        throw new Error('postgres://secret-password@private');
      } });
    const response = await handler(request()); assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'LEARNING_UNAVAILABLE' });
    assert.equal(response.headers.get('location'), null); assert.match(response.headers.get('set-cookie')!, /updated/);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});
