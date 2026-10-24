import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createLearnerDatabase } from '../src/server/learner-database';
import type { TransactionDatabase } from '../src/server/database';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const revoked = '33333333-3333-4333-8333-333333333333';
const missing = '44444444-4444-4444-8444-444444444444';
const sqlState = (code: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === code;

/** Auth helpers below are isolated fixtures, NOT deployable JWT validation or Supabase Auth. */
async function setup() {
  const db = new PGlite();
  try {
    await db.exec(`create role anon nologin nosuperuser nobypassrls;
      create role authenticated nologin nosuperuser nobypassrls;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable security invoker set search_path='' as $$
        select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
      create function auth.uid() returns uuid language sql stable security invoker set search_path='' as $$
        select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      grant execute on function auth.uid(),auth.jwt() to anon,authenticated;`);
    await db.exec(await readFile(new URL('../../supabase/schemas/learner-access.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../../supabase/schemas/learner-transaction.sql', import.meta.url), 'utf8'));
    for (const id of [alice, bob, revoked, missing]) await db.query('insert into auth.users values ($1)', [id]);
    await db.query(`insert into public.learner_access (user_id,status,granted_at,revoked_at) values
      ($1,'active','2026-09-08T00:00:00Z',null),($2,'active','2026-09-08T00:00:00Z',null),
      ($3,'revoked','2026-09-08T00:00:00Z','2026-09-08T01:00:00Z')`, [alice,bob,revoked]);
    return db;
  } catch (error) { await db.close(); throw error; }
}
async function call(db: PGlite, expected: string | null, claims: unknown, role = 'zeirishi_app') {
  assert.ok(['zeirishi_app', 'authenticated', 'anon'].includes(role));
  return db.transaction(async tx => {
    await tx.exec('set transaction isolation level read committed');
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
    return tx.query('select zeirishi_private.require_active_learner($1::uuid)', [expected]);
  });
}
test('制限されたdefiner関数は本人activeだけ許可し、匿名・ID違い・失効・不存在を専用コードで拒否する', async () => {
  const db = await setup();
  try {
    await call(db, alice, { sub: alice, is_anonymous: false });
    for (const [expected, claims] of [
      [revoked, { sub: revoked, is_anonymous: false }], [missing, { sub: missing, is_anonymous: false }],
      [bob, { sub: alice, is_anonymous: false }], [null, { sub: alice, is_anonymous: false }],
      [alice, { sub: alice, is_anonymous: true }], [alice, { sub: alice }],
      [alice, { sub: alice, is_anonymous: 'false' }], [alice, {}],
    ] as const) await assert.rejects(call(db, expected, claims), sqlState('ZC403'));
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(call(db, alice, { sub: alice, is_anonymous: false }, role), sqlState('42501'));
    }
    // Guard operation must not depend on the public schema's default PUBLIC USAGE grant.
    await db.exec('revoke usage on schema public from public');
    await call(db, alice, { sub: alice, is_anonymous: false });
    assert.equal((await db.query('select 1 from public.learner_access')).rows.length, 3);
  } finally { await db.close(); }
});

test('definer所有者は非特権・非tableownerで、app/一般利用者にguard所属やschema作成を与えない', async () => {
  const db = await setup();
  try {
    const roles = (await db.query<{ rolname: string; rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>(
      "select rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb from pg_roles where rolname in ('zeirishi_app','zeirishi_access_guard')")).rows;
    assert.equal(roles.length, 2);
    for (const role of roles) for (const flag of ['rolcanlogin','rolsuper','rolbypassrls','rolcreaterole','rolcreatedb'] as const) assert.equal(role[flag], false);
    const definition = (await db.query<{ owner: string; prosecdef: boolean; proconfig: string[]; table_owner: string }>(
      `select pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,pg_get_userbyid(c.relowner) as table_owner
       from pg_proc p cross join pg_class c where p.oid='zeirishi_private.require_active_learner(uuid)'::regprocedure
       and c.oid='public.learner_access'::regclass`)).rows[0];
    assert.equal(definition.owner, 'zeirishi_access_guard');
    assert.notEqual(definition.owner, definition.table_owner);
    assert.equal(definition.prosecdef, true);
    assert.ok(definition.proconfig.includes('search_path=""'));
    assert.ok(definition.proconfig.includes('row_security=on'));
    for (const role of ['anon','authenticated','zeirishi_app','zeirishi_access_guard']) {
      assert.equal((await db.query<{ allowed: boolean }>(
        "select has_schema_privilege($1,'zeirishi_private','CREATE') as allowed", [role])).rows[0].allowed, false);
    }
    for (const member of ['anon','authenticated','zeirishi_app']) {
      assert.equal((await db.query<{ member: boolean }>("select pg_has_role($1,'zeirishi_access_guard','MEMBER') as member", [member])).rows[0].member, false);
    }
    for (const member of ['anon','authenticated']) {
      assert.equal((await db.query<{ member: boolean }>("select pg_has_role($1,'zeirishi_app','MEMBER') as member", [member])).rows[0].member, false);
      assert.equal((await db.query<{ allowed: boolean }>(
        "select has_function_privilege($1,'zeirishi_private.require_active_learner(uuid)','EXECUTE') as allowed", [member])).rows[0].allowed, false);
      assert.equal((await db.query<{ allowed: boolean }>(
        "select has_any_column_privilege($1,'public.learner_access','UPDATE') as allowed", [member])).rows[0].allowed, false);
    }
    await assert.rejects(db.transaction(async tx => {
      await tx.exec('set local role zeirishi_access_guard');
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: alice,is_anonymous:false })]);
      await tx.query('update public.learner_access set user_id=user_id where user_id=$1', [alice]);
    }), sqlState('42501'));
  } finally { await db.close(); }
});

test('FOR SHAREで取得したロックが同じTX内に残る（2接続の競合・待機保証は別検証）', async () => {
  const db = await setup();
  try {
    await db.transaction(async tx => {
      await tx.exec('set transaction isolation level read committed');
      await tx.exec('set local role zeirishi_app');
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: alice,is_anonymous:false })]);
      await tx.query('select zeirishi_private.require_active_learner($1::uuid)', [alice]);
      const locks = await tx.query<{ mode: string; granted: boolean }>(
        `select mode,granted from pg_locks where pid=pg_backend_pid()
         and relation='public.learner_access'::regclass and mode='RowShareLock'`);
      assert.deepEqual(locks.rows, [{ mode: 'RowShareLock', granted: true }]);
      await tx.exec('reset role');
      const row = (await tx.query<{ xmax: string; status: string }>(
        'select xmax::text,status from public.learner_access where user_id=$1', [alice])).rows[0];
      assert.notEqual(row.xmax, '0');
      assert.equal(row.status, 'active');
    });
    const after = await db.query(`select 1 from pg_locks where pid=pg_backend_pid()
      and relation='public.learner_access'::regclass and mode='RowShareLock'`);
    assert.equal(after.rows.length, 0);
  } finally { await db.close(); }
});

test('実TS wrapperから宣言SQL関数・callback・commitを通し、TX終了後のclaims残留を防ぐ', async () => {
  const db = await setup();
  try {
    // Only this fixture supplies pre-verified identity. No real Auth provider was contacted.
    const reader = { getUser: async () => ({ error: false, user: { id: alice, isAnonymous: false, emailConfirmed: true } }) };
    const base: TransactionDatabase = { transaction: operation => db.transaction(async tx => {
      await tx.exec('set local role zeirishi_app');
      return operation(tx);
    }) };
    const bound = await createLearnerDatabase(base, reader);
    const result = await bound.database.transaction(async tx => {
      const context = (await tx.query<{ role: string; claims: string }>(
        "select current_user as role,current_setting('request.jwt.claims',true) as claims")).rows[0];
      assert.equal(context.role, 'zeirishi_app');
      assert.deepEqual(JSON.parse(context.claims), { sub: alice, is_anonymous: false });
      const locks = await tx.query(`select 1 from pg_catalog.pg_locks where pid=pg_catalog.pg_backend_pid()
        and relation='public.learner_access'::regclass and mode='RowShareLock' and granted`);
      assert.equal(locks.rows.length, 1);
      return 42;
    });
    assert.equal(result, 42);
    const cleared = async () => {
      const row = (await db.query<{ claims: string | null; role: string }>(
        "select current_setting('request.jwt.claims',true) as claims,current_user as role")).rows[0];
      assert.ok(row.claims === null || row.claims === '');
      assert.notEqual(row.role, 'zeirishi_app');
    };
    await cleared();
    await db.query("update public.learner_access set status='revoked',revoked_at='2026-09-08T02:00:00Z' where user_id=$1", [alice]);
    let callbackRan = false;
    await assert.rejects(bound.database.transaction(async () => { callbackRan = true; }), /INVITATION_REQUIRED/);
    assert.equal(callbackRan, false);
    await cleared();
  } finally { await db.close(); }
});
