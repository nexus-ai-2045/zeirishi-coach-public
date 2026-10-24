import assert from 'node:assert/strict';
import test from 'node:test';
import { createLearnerDatabase } from '../src/server/learner-database';
import type { TransactionDatabase } from '../src/server/database';
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const reader = (id = alice) => ({ getUser: async () => ({ error: false, user: { id, isAnonymous: false, emailConfirmed: true } }) });
function setup(role = 'zeirishi_app', denial?: string) {
  const calls: { sql: string; params?: unknown[] }[] = [];
  const base: TransactionDatabase = { transaction: async operation => operation({ query: async <T>(sql: string, params?: unknown[]) => {
    calls.push({ sql, params });
    if (sql.includes('pg_catalog.pg_roles')) return { rows: [{ name: role, superuser: false, bypass: false }] as T[] };
    if (sql.includes('require_active_learner') && denial) throw { code: denial, message: 'private diagnostic' };
    return { rows: [] };
  } }) };
  return { base, calls };
}
test('verified identity is rebound per transaction, role checked and local claims precede membership lock', async () => {
  const fx = setup(); const bound = await createLearnerDatabase(fx.base, reader());
  assert.equal(bound.userId, alice);
  await bound.database.transaction(tx => tx.query('LEARNING_OPERATION'));
  assert.equal(fx.calls[0].sql, 'SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
  assert.deepEqual(JSON.parse(fx.calls[2].params![0] as string), { sub: alice, is_anonymous: false });
  assert.match(fx.calls[2].sql, /true\)/);
  assert.match(fx.calls[3].sql, /require_active_learner/);
  assert.deepEqual(fx.calls[3].params, [alice]);
  assert.equal(fx.calls[4].sql, 'LEARNING_OPERATION');
});
test('identity switch, anonymous and missing session fail before any database operation', async () => {
  const fx = setup(); let id = alice;
  const auth = { getUser: async () => reader(id).getUser() };
  const bound = await createLearnerDatabase(fx.base, auth);
  id = bob;
  await assert.rejects(bound.database.transaction(async () => 1), /AUTH_IDENTITY_CHANGED/);
  await assert.rejects(createLearnerDatabase(fx.base, { getUser: async () => ({ error: false, user: null }) }), /AUTH_REQUIRED/);
  await assert.rejects(createLearnerDatabase(fx.base, { getUser: async () => ({ error: false, user: { id: alice, isAnonymous: true, emailConfirmed: true } }) }), /AUTH_REQUIRED/);
  assert.equal(fx.calls.length, 0);
});
test('unsafe role and membership denial cannot enter learning callback; provider details stay opaque', async () => {
  for (const [role, denial, expected] of [['postgres', undefined, /DATABASE_ROLE_REJECTED/],
    ['zeirishi_app', 'ZC403', /INVITATION_REQUIRED/], ['zeirishi_app', '42501', /AUTH_UNAVAILABLE/]] as const) {
    const fx = setup(role, denial); let ran = false;
    const bound = await createLearnerDatabase(fx.base, reader());
    await assert.rejects(bound.database.transaction(async () => { ran = true; }), expected);
    assert.equal(ran, false);
  }
});
