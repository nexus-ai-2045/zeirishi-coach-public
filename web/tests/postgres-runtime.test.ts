import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientBase } from 'pg';
import { rootCertificates } from 'node:tls';
import { PGlite } from '@electric-sql/pglite';
import { readDatabaseConfig, createPostgresRuntime } from '../src/server/postgres-runtime';
const ref = 'abcdefghijklmnopqrst';
const settings = {
  ZEIRISHI_DATABASE_ENABLED: '1', ZEIRISHI_SUPABASE_ENABLED: '1', SUPABASE_URL: `https://${ref}.supabase.co`,
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_only_a_test_fixture_key', ZEIRISHI_APP_ORIGIN: 'https://coach.example',
  ZEIRISHI_DATABASE_HOST: `db.${ref}.supabase.co`, ZEIRISHI_DATABASE_USER: 'zeirishi_runtime',
  ZEIRISHI_DATABASE_PORT: '5432', ZEIRISHI_DATABASE_PASSWORD: 'test-fixture-not-a-real-password',
};
test('database config requires explicit activation, matching project, dedicated user and TLS', () => {
  assert.throws(() => readDatabaseConfig({}), /DATABASE_DISABLED/);
  for (const override of [{ ZEIRISHI_FIXTURE_MODE: '1' }, { ZEIRISHI_DATABASE_USER: 'postgres' },
    { ZEIRISHI_DATABASE_HOST: 'db.zyxwvutsrqponmlkjihg.supabase.co' }, { ZEIRISHI_DATABASE_HOST: 'localhost' },
    { ZEIRISHI_DATABASE_PORT: '5432?sslmode=disable' }, { ZEIRISHI_DATABASE_PASSWORD: '' }, { ZEIRISHI_DATABASE_CA_PEM: 'invalid' }]) {
    assert.throws(() => readDatabaseConfig({ ...settings, ...override }));
  }
  const config = readDatabaseConfig({ ...settings, ZEIRISHI_DATABASE_CA_PEM: rootCertificates[0], PGOPTIONS: '-c role=postgres', PGSSLMODE: 'disable' });
  assert.equal(config.connectionString, undefined);
  assert.equal(config.options, '-c application_name=zeirishi-coach');
  assert.equal(config.max, 4);
  assert.equal(config.ssl && typeof config.ssl === 'object' && config.ssl.rejectUnauthorized, true);
  assert.equal(config.connectionTimeoutMillis, 5000);
  assert.equal(config.query_timeout, 20000);
});
test('pooler login suffix binds the selected Supabase project', () => {
  const pooler = { ...settings, ZEIRISHI_DATABASE_HOST: 'aws-0-ap-northeast-1.pooler.supabase.com', ZEIRISHI_DATABASE_USER: `zeirishi_runtime.${ref}`, ZEIRISHI_DATABASE_PORT: '6543' };
  assert.equal(readDatabaseConfig(pooler).port, 6543);
  // Real hosts have one label before pooler.supabase.com, not arbitrary lookalike suffixes.
  assert.throws(() => readDatabaseConfig({ ...pooler, ZEIRISHI_DATABASE_USER: 'zeirishi_runtime.other' }));
});
test('new connection admission rejects admin or guard-capable credentials', async () => {
  const check = readDatabaseConfig(settings).onConnect!;
  const client = (row: unknown) => ({ query: async () => ({ rows: row ? [row] : [] }) }) as unknown as ClientBase;
  const good = { name: 'zeirishi_runtime', safe: true, app: true, guard: false, restricted: true };
  await check(client(good));
  for (const row of [null, { ...good, safe: false }, { ...good, guard: true }, { ...good, app: false }, { ...good, name: 'postgres' }, { ...good, restricted: false }]) {
    await assert.rejects(async () => check(client(row)), /DATABASE_ROLE_REJECTED/);
  }
});
test('actual pg pool stays unconnected until use and can close without network', async () => {
  const runtime = createPostgresRuntime(settings);
  assert.deepEqual(runtime.health(), { idleErrors: 0, total: 0, idle: 0, waiting: 0 });
  await runtime.close();
});

test('admission SQL detects indirect privilege membership using real isolated PostgreSQL roles', async () => {
  for (const extraMembership of [false, true]) {
    const db = new PGlite();
    try {
      await db.exec(`create role zeirishi_app nologin noinherit;
      create role zeirishi_access_guard nologin noinherit;
      create role zeirishi_runtime nologin noinherit nosuperuser nobypassrls nocreatedb nocreaterole noreplication;
      grant zeirishi_app to zeirishi_runtime with inherit false, set true;`);
      // Prepare each graph as the fixture owner before dropping session authority.
      // A fresh database avoids assuming RESET restores a pooled/embedded session's owner.
      if (extraMembership) await db.exec(`create role fixture_extra_privilege nologin;
      grant fixture_extra_privilege to zeirishi_app;`);
      const check = readDatabaseConfig(settings).onConnect!;
      const client = { query: (sql: string) => db.query(sql) } as unknown as ClientBase;
      await db.exec('set session authorization zeirishi_runtime');
      if (extraMembership) await assert.rejects(async () => check(client), /DATABASE_ROLE_REJECTED/);
      else await check(client);
    } finally {
      await db.close();
    }
  }
});
