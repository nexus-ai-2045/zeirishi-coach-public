import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionDatabaseProvider } from '../src/server/production-database';
import type { createPostgresRuntime } from '../src/server/postgres-runtime';

const settings = {
  ZEIRISHI_DATABASE_ENABLED: '1', ZEIRISHI_SUPABASE_ENABLED: '1',
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_only_a_test_fixture_key', ZEIRISHI_APP_ORIGIN: 'https://coach.example',
  ZEIRISHI_DATABASE_HOST: 'db.abcdefghijklmnopqrst.supabase.co', ZEIRISHI_DATABASE_USER: 'zeirishi_runtime',
  ZEIRISHI_DATABASE_PORT: '5432', ZEIRISHI_DATABASE_PASSWORD: 'only-a-test-fixture',
};
const runtime: ReturnType<typeof createPostgresRuntime> = {
  database: { transaction: async () => { throw new Error('not used'); } },
  health: () => ({ idleErrors: 0, total: 0, idle: 0, waiting: 0 }), close: async () => {},
};

test('production provider shares only one lazy pool and never bypasses current activation gates', () => {
  let creations = 0;
  const get = createProductionDatabaseProvider(() => { creations++; return runtime; });
  assert.equal(creations, 0);
  assert.throws(() => get({}), /DATABASE_DISABLED/);
  assert.equal(creations, 0);
  assert.equal(get(settings), runtime.database);
  assert.equal(get({ ...settings }), runtime.database);
  assert.equal(creations, 1);
  assert.throws(() => get({ ...settings, ZEIRISHI_DATABASE_ENABLED: '0' }), /DATABASE_DISABLED/);
  assert.throws(() => get({ ...settings, ZEIRISHI_FIXTURE_MODE: '1' }), /AUTH_MODE_CONFLICT/);
  assert.throws(() => get({ ...settings, ZEIRISHI_DATABASE_PASSWORD: 'rotated-test-fixture' }), /DATABASE_RESTART_REQUIRED/);
  assert.equal(creations, 1);
});

test('failed pool construction is not cached and has no local database fallback', () => {
  let creations = 0;
  const get = createProductionDatabaseProvider(() => {
    if (++creations === 1) throw new Error('construction failed');
    return runtime;
  });
  assert.throws(() => get(settings), /construction failed/);
  assert.equal(get(settings), runtime.database);
  assert.equal(creations, 2);
});
