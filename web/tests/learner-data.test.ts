import assert from 'node:assert/strict';
import test from 'node:test';
import { createLearnerDataHandler } from '../src/http/learner-data-handler';
import type { TransactionDatabase } from '../src/server/database';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const settings = { url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_test_only', appOrigin: 'https://coach.example' };
const body = { action: 'delete', confirmation: 'DELETE_MY_LEARNING_DATA' };
function request(input?: unknown, query = '') {
  return new Request(`${settings.appOrigin}/api/data${query}`, { method: input ? 'POST' : 'GET',
    headers: { 'X-Zeirishi-Learner': alice, cookie: `zc-user=${bob}`, ...(input ? { origin: settings.appOrigin, 'content-type': 'application/json' } : {}) },
    ...(input ? { body: JSON.stringify(input) } : {}) });
}
function fixture(missing = false, invited = true) {
  let acquisitions = 0; let revoked: string | null = null;
  const queries: { sql: string; params?: unknown[] }[] = [];
  // HTTP boundary unit only: SQL results are stubs. Real deletion/RLS/rollback is
  // covered by the existing data-service and PostgreSQL integration suites.
  const database: TransactionDatabase = { transaction: operation => operation({ query: async <T>(sql: string, params?: unknown[]) => {
    queries.push({ sql, params });
    if (sql.includes('pg_catalog.pg_roles')) return { rows: [{ name: 'zeirishi_app', superuser: false, bypass: false }] as T[] };
    if (sql.startsWith('SELECT revoked_at')) return { rows: [{ revoked_at: revoked }] as T[] };
    if (sql.startsWith('UPDATE owner_access')) revoked = params![1] as string;
    return { rows: [] };
  } }) };
  const handler = createLearnerDataHandler({ config: () => settings, getDatabase: () => { acquisitions++; return database; },
    context: () => ({ headers: new Headers({ 'Set-Cookie': 'auth=refreshed; HttpOnly; Secure' }), reader: {
      getUser: async () => ({ error: false, user: missing ? null : { id: alice, isAnonymous: false, emailConfirmed: true } }),
      getAccess: async id => ({ userId: id, status: invited ? 'active' : 'revoked' }),
    } }),
  });
  return { handler, queries, acquisitions: () => acquisitions };
}
test('export attachment is fixed only on success; identity and refreshed auth cookies are preserved', async () => {
  const fx = fixture(); const response = await fx.handler(request());
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-disposition'), 'attachment; filename="zeirishi-learning-data.json"');
  const data = await response.json(); assert.equal(data.developmentOnly, false);
  assert.match(response.headers.get('set-cookie')!, /auth=refreshed/); assert.doesNotMatch(response.headers.get('set-cookie')!, /zc-user|Max-Age=0/);
  assert.ok(fx.queries.some(item => item.params?.includes(alice))); assert.ok(fx.queries.every(item => !item.params?.includes(bob)));
  const invalid = await fx.handler(request(undefined, '?owner=' + bob)); assert.equal(invalid.status, 400); assert.equal(invalid.headers.get('content-disposition'), null);
});
test('deletion requires exact confirmation, keeps auth, reports limited scope and supports retry', async () => {
  const fx = fixture();
  for (const input of [{}, { action: 'delete' }, { ...body, owner: bob }, { ...body, confirmation: 'yes' }]) {
    assert.equal((await fx.handler(request(input))).status, 400);
  }
  assert.equal(fx.queries.length, 0);
  const first = await fx.handler(request(body)); const data = await first.json();
  assert.equal(first.status, 200); assert.equal(data.deleted, true); assert.equal(data.developmentOnly, false);
  assert.equal(data.accountDeleted, false); assert.equal(data.backupsDeleted, false);
  assert.equal(first.headers.get('content-disposition'), null); assert.doesNotMatch(first.headers.get('set-cookie')!, /zc-user|Max-Age=0/);
  assert.ok(fx.queries.filter(item => item.sql.startsWith('DELETE')).every(item => item.params?.[0] === alice));
  const deletes = fx.queries.filter(item => item.sql.startsWith('DELETE')).length;
  const replay = await fx.handler(request(body)); assert.equal(replay.status, 200); assert.deepEqual(await replay.json(), data);
  assert.equal(fx.queries.filter(item => item.sql.startsWith('DELETE')).length, deletes);
  const after = await fx.handler(request()); assert.equal(after.status, 401); assert.equal(after.headers.get('content-disposition'), null);
});
test('unauthenticated or revoked membership cannot acquire a data connection or attachment', async () => {
  for (const missing of [true, false]) {
    const fx = fixture(missing, false); const response = await fx.handler(request());
    assert.equal(response.status, missing ? 401 : 403); assert.equal(fx.acquisitions(), 0);
    assert.equal(response.headers.get('content-disposition'), null); assert.match(response.headers.get('set-cookie')!, /auth=refreshed/);
  }
});
