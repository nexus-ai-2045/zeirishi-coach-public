import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { authReader, createAuthContext, readAuthConfig, requireInvitedLearner, type VerifiedAuthReader } from '../src/server/supabase-auth';
import { createAuthSessionHandler } from '../src/http/auth-session-handler';

// Test-only values, never connected to a provider and never written to an environment file.
const env = { ZEIRISHI_SUPABASE_ENABLED: '1', SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_only_not_a_credential', ZEIRISHI_APP_ORIGIN: 'https://coach.example' };
const config = () => readAuthConfig(env);
const request = (suffix = '', init?: RequestInit) => new Request(`https://coach.example/api/auth/session${suffix}`, init);
test('認証は明示設定が必要で、fixtureとの併用・秘密key・不正URLを拒否する', () => {
  assert.throws(() => readAuthConfig({}), /AUTH_DISABLED/);
  assert.throws(() => readAuthConfig({ ...env, ZEIRISHI_FIXTURE_MODE: '1' }), /AUTH_MODE_CONFLICT/);
  for (const patch of [{ SUPABASE_PUBLISHABLE_KEY: 'sb_secret_private' }, { SUPABASE_URL: 'http://localhost' },
    { SUPABASE_URL: `${env.SUPABASE_URL}/other` }, { ZEIRISHI_APP_ORIGIN: 'https://user:password@coach.example' },
    { ZEIRISHI_APP_ORIGIN: 'https://coach.example/redirect?next=other' }]) {
    assert.throws(() => readAuthConfig({ ...env, ...patch }), /AUTH_CONFIGURATION_REQUIRED/);
  }
  assert.equal(config().appOrigin, 'https://coach.example');
});
test('認証済IDと現在の利用権だけを信頼し、未招待・他人・失効・匿名・未確認メールを拒否する', async () => {
  const id = randomUUID();
  let reads = 0;
  const good: VerifiedAuthReader = {
    getUser: async () => ({ user: { id, isAnonymous: false, emailConfirmed: true }, error: false }),
    getAccess: async requested => { assert.equal(requested, id); reads++; return { userId: id, status: 'active' }; },
  };
  assert.deepEqual(await requireInvitedLearner(good), { userId: id });
  assert.equal(reads, 1);
  for (const access of [null, { userId: randomUUID(), status: 'active' }, { userId: id, status: 'revoked' }]) {
    await assert.rejects(requireInvitedLearner({ ...good, getAccess: async () => access }), /INVITATION_REQUIRED/);
  }
  for (const user of [null, { id, isAnonymous: true, emailConfirmed: true }, { id, isAnonymous: false, emailConfirmed: false }]) {
    await assert.rejects(requireInvitedLearner({ ...good, getUser: async () => ({ user, error: false }) }), /AUTH_REQUIRED/);
  }
  assert.equal(reads, 1);
  await assert.rejects(requireInvitedLearner({ ...good, getUser: async () => ({ user: null, error: true }) }), /AUTH_UNAVAILABLE/);
});
test('実SDKはcookieなしの利用者を401とし、外部通信せずリクエスト間で状態共有しない', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network forbidden in this test'); };
  try {
    const a = createAuthContext(request(), config()), b = createAuthContext(request(), config());
    assert.notEqual(a.client, b.client);
    assert.notEqual(a.headers, b.headers);
    await assert.rejects(requireInvitedLearner(authReader(a.client)), /AUTH_REQUIRED/);
    const response = await createAuthSessionHandler(config)(request());
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'AUTH_REQUIRED' });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(calls, 0);
    assert.throws(() => createAuthContext(request('', { headers: { cookie: 'x=one; x=two' } }), config()), /INVALID_COOKIE/);
    assert.throws(() => createAuthContext(request('', { headers: { cookie: `x=${'a'.repeat(33000)}` } }), config()), /INVALID_COOKIE/);
  } finally { globalThis.fetch = original; }
});
test('認証HTTPは入力を先に拒否し、成功でも学習backend完成を偽装しない', async () => {
  let calls = 0;
  const id = randomUUID();
  const handler = createAuthSessionHandler(config, () => {
    calls++;
    return { headers: new Headers({ 'cache-control': 'private, no-store', 'set-cookie': 'test-refresh=value; HttpOnly; Secure' }),
      reader: { getUser: async () => ({ user: { id, isAnonymous: false, emailConfirmed: true }, error: false }),
        getAccess: async () => ({ userId: id, status: 'active' }) } };
  });
  for (const req of [request('?owner=other'), request('', { method: 'POST' }), request('', { headers: { 'sec-fetch-site': 'cross-site' } }),
    new Request('https://evil.example/api/auth/session')]) assert.ok((await handler(req)).status >= 400);
  assert.equal(calls, 0);
  const response = await handler(request());
  assert.deepEqual(await response.json(), { authenticated: true, userId: id, learningBackendReady: false });
  assert.match(response.headers.get('set-cookie')!, /test-refresh/);
  const failed = await createAuthSessionHandler(config, () => { throw new Error('private provider details'); })(request());
  assert.equal(failed.status, 503);
  assert.deepEqual(await failed.json(), { error: 'AUTH_UNAVAILABLE' });
  const disabled = await createAuthSessionHandler(() => readAuthConfig({}))(request());
  assert.equal(disabled.status, 503);
});
