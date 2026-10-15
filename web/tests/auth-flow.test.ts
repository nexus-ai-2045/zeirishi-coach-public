import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthFlowHandler, requireEmailDelivery } from '../src/http/auth-flow-handler';
import { StudyError } from '../src/domain/types';

const settings = { url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'sb_publishable_test_only_not_a_real_key', appOrigin: 'https://coach.example' };
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const code = '01234567-89ab-4cde-8fab-0123456789ab';
function fixture(active = true) {
  const calls: string[] = [];
  const headers = new Headers({ 'Cache-Control': 'private, no-store' });
  return { calls, context: {
    headers,
    reader: {
      getUser: async () => ({ error: false, user: { id, isAnonymous: false, emailConfirmed: true } }),
      getAccess: async () => ({ userId: id, status: active ? 'active' : 'revoked' }),
    },
    requestLink: async (email: string, redirect: string) => { calls.push(`request:${email}:${redirect}`); headers.append('Set-Cookie', 'verifier=test; HttpOnly; Secure'); },
    exchange: async (value: string) => { calls.push(`exchange:${value}`); headers.append('Set-Cookie', 'session=test; HttpOnly; Secure'); },
    logout: async () => { calls.push('logout'); headers.append('Set-Cookie', 'session=; Max-Age=0; HttpOnly; Secure'); },
  } };
}
function post(action: string, body: unknown, origin = settings.appOrigin) {
  return new Request(`${settings.appOrigin}/api/auth/${action}`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

test('email activation, origin, body and method guards run before provider access', async () => {
  assert.throws(() => requireEmailDelivery({}), /AUTH_EMAIL_DISABLED/);
  requireEmailDelivery({ ZEIRISHI_AUTH_EMAIL_ENABLED: '1' });
  const fx = fixture();
  let contexts = 0;
  const context = () => { contexts++; return fx.context; };
  const disabled = createAuthFlowHandler('request', () => settings, context, () => requireEmailDelivery({}));
  assert.equal((await disabled(post('request', { email: 'learner@example.test' }))).status, 503);
  const handler = createAuthFlowHandler('request', () => settings, context, () => {});
  assert.equal((await handler(post('request', { email: 'learner@example.test' }, 'https://evil.example'))).status, 403);
  assert.equal((await handler(post('request', { email: 'learner@example.test', next: 'https://evil.example' }))).status, 400);
  assert.equal((await handler(post('request', { email: 'bad\n@example.test' }))).status, 400);
  assert.equal((await handler(post('request', { email: 'x'.repeat(17000) }))).status, 413);
  assert.equal((await handler(new Request(`${settings.appOrigin}/api/auth/request`))).status, 405);
  assert.equal(contexts, 0);
});

test('request uses fixed callback and preserves verifier without claiming email delivery', async () => {
  const fx = fixture();
  const response = await createAuthFlowHandler('request', () => settings, () => fx.context, () => {})(post('request', { email: ' learner@example.test ' }));
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true, deliveryConfirmed: false });
  assert.deepEqual(fx.calls, ['request:learner@example.test:https://coach.example/api/auth/callback']);
  assert.match(response.headers.get('set-cookie')!, /verifier/);
  assert.match(response.headers.get('cache-control')!, /no-store/);
});

test('callback rejects ambiguous inputs, verifies membership and strips code from fixed redirect', async () => {
  const fx = fixture();
  const handler = createAuthFlowHandler('callback', () => settings, () => fx.context);
  for (const query of ['', '?code=x', `?code=${code}&code=${code}`, `?code=${code}&next=https://evil.example`, '?token_hash=secret&type=email']) {
    const invalid = await handler(new Request(`${settings.appOrigin}/api/auth/callback${query}`));
    assert.equal(invalid.status, 303);
    assert.equal(invalid.headers.get('location'), 'https://coach.example/login?auth=link-invalid');
  }
  assert.deepEqual(fx.calls, []);
  const response = await handler(new Request(`${settings.appOrigin}/api/auth/callback?code=${code}`, { headers: { 'sec-fetch-site': 'cross-site' } }));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://coach.example/login');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('set-cookie')!, /session/);
  assert.deepEqual(fx.calls, [`exchange:${code}`]);
});

test('uninvited callback signs out and preserves deletion cookies; failures are opaque', async () => {
  const fx = fixture(false);
  const handler = createAuthFlowHandler('callback', () => settings, () => fx.context);
  const response = await handler(new Request(`${settings.appOrigin}/api/auth/callback?code=${code}`));
  assert.equal(response.status, 303);
  assert.equal(response.headers.get('location'), 'https://coach.example/login?auth=invitation-required');
  assert.match(response.headers.get('set-cookie')!, /Max-Age=0/);
  assert.deepEqual(fx.calls, [`exchange:${code}`, 'logout']);
  fx.context.exchange = async () => { throw new Error('private provider response'); };
  const failed = await handler(new Request(`${settings.appOrigin}/api/auth/callback?code=${code}`));
  assert.equal(failed.status, 303);
  assert.equal(failed.headers.get('location'), 'https://coach.example/login?auth=unavailable');
});

test('logout does not require active membership and does not claim revocation on failure', async () => {
  const fx = fixture(false);
  fx.context.reader.getUser = async () => { throw new Error('must not check membership'); };
  const handler = createAuthFlowHandler('logout', () => settings, () => fx.context);
  assert.equal((await handler(post('logout', { scope: 'global' }))).status, 400);
  const response = await handler(post('logout', {}));
  assert.deepEqual(await response.json(), { signedOut: true, scope: 'local' });
  fx.context.logout = async () => { fx.context.headers.append('Set-Cookie', 'session=; Max-Age=0'); throw new StudyError('AUTH_UNAVAILABLE', 503); };
  const failed = await handler(post('logout', {}));
  assert.equal(failed.status, 503);
  assert.match(failed.headers.get('set-cookie')!, /Max-Age=0/);
  assert.deepEqual(await failed.json(), { error: 'AUTH_UNAVAILABLE' });
});

test('actual SDK requests PKCE with signup disabled; rejected provider response still returns verifier cookies', async () => {
  const original = globalThis.fetch;
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    // Isolated transport stub only: no network, real credentials, user or email.
    return Response.json({ code: 'otp_disabled', msg: 'test provider rejection' }, { status: 400 });
  };
  try {
    const response = await createAuthFlowHandler('request', () => settings, undefined, () => {})(post('request', { email: 'learner@example.test' }));
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { accepted: true, deliveryConfirmed: false });
    assert.equal(calls.length, 1);
    const target = new URL(calls[0].url);
    assert.equal(target.pathname, '/auth/v1/otp');
    assert.equal(target.searchParams.get('redirect_to'), 'https://coach.example/api/auth/callback');
    assert.equal(calls[0].body.create_user, false);
    assert.equal(calls[0].body.code_challenge_method, 's256');
    assert.equal(typeof calls[0].body.code_challenge, 'string');
    assert.match(response.headers.get('set-cookie')!, /code-verifier/);
    assert.match(response.headers.get('set-cookie')!, /HttpOnly/);
    assert.match(response.headers.get('set-cookie')!, /Secure/);
  } finally { globalThis.fetch = original; }
});
