import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const sqlFile = new URL('../../supabase/schemas/learner-access.sql', import.meta.url);
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const revoked = '33333333-3333-4333-8333-333333333333';
const uninvited = '44444444-4444-4444-8444-444444444444';
const sqlState = (code: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === code;

/** Isolated Postgres-semantics fixture only: this does not emulate Auth/JWT signature verification,
 * token revocation, PostgREST, or production Supabase. Never install these helpers in a service DB.
 */
async function setup() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon nologin nosuperuser nobypassrls;
      create role authenticated nologin nosuperuser nobypassrls;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable security invoker
        set search_path = '' as $$
          select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
        $$;
      create function auth.uid() returns uuid language sql stable security invoker
        set search_path = '' as $$
          select (auth.jwt() ->> 'sub')::uuid
        $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid(), auth.jwt() to anon, authenticated;
      -- Simulate permissive existing default grants: the canonical SQL must revoke them.
      alter default privileges in schema public grant all on tables to anon, authenticated;
    `);
    const sql = await readFile(sqlFile, 'utf8');
    await db.exec(sql);
    for (const id of [alice, bob, revoked, uninvited]) await db.query('insert into auth.users values ($1)', [id]);
    await db.query(`insert into public.learner_access (user_id,status,granted_at,revoked_at) values
      ($1,'active','2026-09-08T00:00:00Z',null),
      ($2,'active','2026-09-08T00:00:00Z',null),
      ($3,'revoked','2026-09-08T00:00:00Z','2026-09-08T01:00:00Z')`, [alice, bob, revoked]);
    return db;
  } catch (error) { await db.close(); throw error; }
}
async function withClaims<T>(db: PGlite, role: 'anon' | 'authenticated', claims: unknown, action: () => Promise<T>) {
  // role is a closed test-fixture union; claims substitute server-validated request context only here.
  await db.exec(`set role ${role}`);
  try {
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(claims)]);
    return await action();
  } finally { await db.exec('reset role'); }
}
const rows = async (db: PGlite) => (await db.query<{ user_id: string; status: string }>(
  'select user_id,status from public.learner_access order by user_id')).rows;

test('宣言SQLのRLSを隔離DBの実ロールで検証: 本人のみ・匿名拒否・失効本人参照', async () => {
  const db = await setup();
  try {
    const protection = await db.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
      "select relrowsecurity,relforcerowsecurity from pg_class where oid='public.learner_access'::regclass");
    assert.deepEqual(protection.rows, [{ relrowsecurity: true, relforcerowsecurity: true }]);
    const policies = await db.query<{ cmd: string; roles: string[] }>(
      "select cmd,roles from pg_policies where schemaname='public' and tablename='learner_access'");
    assert.deepEqual(policies.rows, [{ cmd: 'SELECT', roles: ['authenticated'] }]);
    assert.deepEqual(await withClaims(db, 'authenticated', { sub: alice, is_anonymous: false }, () => rows(db)),
      [{ user_id: alice, status: 'active' }]);
    assert.deepEqual(await withClaims(db, 'authenticated', { sub: bob, is_anonymous: false }, () => rows(db)),
      [{ user_id: bob, status: 'active' }]);
    assert.deepEqual(await withClaims(db, 'authenticated', { sub: revoked, is_anonymous: false }, () => rows(db)),
      [{ user_id: revoked, status: 'revoked' }]);
    assert.deepEqual(await withClaims(db, 'authenticated', { sub: uninvited, is_anonymous: false }, () => rows(db)), []);
    for (const claims of [{ sub: alice, is_anonymous: true }, { sub: alice }, { sub: alice, is_anonymous: null },
      { sub: alice, is_anonymous: 'false' }, { sub: alice, is_anonymous: 0 }, {},
      { sub: alice, user_metadata: { is_anonymous: false, status: 'active' } }]) {
      assert.deepEqual(await withClaims(db, 'authenticated', claims, () => rows(db)), []);
    }
    await assert.rejects(withClaims(db, 'anon', { sub: alice, is_anonymous: false }, () => rows(db)), sqlState('42501'));
    const foreign = await withClaims(db, 'authenticated', { sub: alice, is_anonymous: false }, () => db.query(
      'select user_id from public.learner_access where user_id=$1', [bob]));
    assert.deepEqual(foreign.rows, []);
  } finally { await db.close(); }
});

test('宣言SQLのgrant/整合制約/削除cascadeを隔離DBで検証: 自己昇格と更新・削除を禁止', async () => {
  const db = await setup();
  try {
    for (const privilege of ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) {
      const permission = await db.query<{ allowed: boolean }>(
        "select has_table_privilege('authenticated','public.learner_access',$1) as allowed", [privilege]);
      assert.equal(permission.rows[0].allowed, false, privilege);
    }
    assert.equal((await db.query<{ allowed: boolean }>(
      "select has_table_privilege('authenticated','public.learner_access','SELECT') as allowed")).rows[0].allowed, true);
    assert.equal((await db.query<{ allowed: boolean }>(
      "select has_table_privilege('anon','public.learner_access','SELECT') as allowed")).rows[0].allowed, false);
    const actions: Array<() => Promise<unknown>> = [
      () => db.query("insert into public.learner_access (user_id,status) values ($1,'active')", [uninvited]),
      () => db.query("update public.learner_access set status='active',revoked_at=null where user_id=$1", [revoked]),
      () => db.query('update public.learner_access set user_id=$1 where user_id=$2', [uninvited, alice]),
      () => db.query('delete from public.learner_access where user_id=$1', [alice]),
      () => db.exec('truncate public.learner_access'),
    ];
    for (const action of actions) await assert.rejects(withClaims(db, 'authenticated',
      { sub: revoked, is_anonymous: false }, action), sqlState('42501'));
    for (const [status, grantedAt, revokedAt] of [
      ['pending', '2026-09-08T00:00:00Z', null], ['revoked', '2026-09-08T00:00:00Z', null],
      ['active', '2026-09-08T00:00:00Z', '2026-09-08T01:00:00Z'],
      ['revoked', '2026-09-08T00:00:00Z', '2026-09-07T00:00:00Z'],
      ['active', 'infinity', null], ['revoked', '2026-09-08T00:00:00Z', 'infinity'],
    ]) {
      await assert.rejects(db.query('insert into public.learner_access (user_id,status,granted_at,revoked_at) values ($1,$2,$3,$4)',
        [uninvited, status, grantedAt, revokedAt]), sqlState('23514'));
    }
    await assert.rejects(db.query("insert into public.learner_access (user_id,status) values ('55555555-5555-4555-8555-555555555555','active')"), sqlState('23503'));
    await db.query('delete from auth.users where id=$1', [alice]);
    assert.equal((await db.query('select 1 from public.learner_access where user_id=$1', [alice])).rows.length, 0);
    assert.deepEqual(await withClaims(db, 'authenticated', { sub: alice, is_anonymous: false }, () => rows(db)), []);
    assert.deepEqual(await rows(db), [{ user_id: bob, status: 'active' }, { user_id: revoked, status: 'revoked' }]);
  } finally { await db.close(); }
});
