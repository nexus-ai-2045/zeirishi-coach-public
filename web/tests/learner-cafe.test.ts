import assert from 'node:assert/strict';
import test from 'node:test';
import { createLearnerCafeHandler } from '../src/http/learner-cafe-handler';
import { getApprovedCafeMaterial } from '../src/server/approved-catalog';

test('unapproved consultation inventory fails closed without any learning transaction', async () => {
  let transactions = 0;
  const userId = '11111111-1111-4111-8111-111111111111';
  const handler = createLearnerCafeHandler({ getMaterial: getApprovedCafeMaterial,
    getDatabase: () => ({ transaction: async () => { transactions++; throw new Error('must not use fixture'); } }),
    config: () => ({ url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'test-only', appOrigin: 'https://coach.example' }),
    context: () => ({ headers: new Headers({ 'Set-Cookie': 'auth=updated; Secure; HttpOnly' }), reader: {
      getUser: async () => ({ error: false, user: { id: userId, isAnonymous: false, emailConfirmed: true } }),
      getAccess: async () => ({ userId, status: 'active' }),
    } }),
  });
  const request = (body: unknown) => new Request('https://coach.example/api/cafe', { method: 'POST',
    headers: { 'X-Zeirishi-Learner': userId, origin: 'https://coach.example', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const response = await handler(request({ action: 'start', requestId: crypto.randomUUID() }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'MATERIAL_NOT_AVAILABLE' });
  assert.match(response.headers.get('set-cookie')!, /auth=updated/);
  assert.equal((await handler(request({ action: 'start', requestId: crypto.randomUUID(), owner: 'other' }))).status, 400);
  assert.equal(transactions, 0);
});
