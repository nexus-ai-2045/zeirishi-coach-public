import assert from 'node:assert/strict';
import test from 'node:test';
import { GET } from '../src/app/api/profile/route';
import { GET as PLAN_GET } from '../src/app/api/plan/route';
import { GET as HISTORY_GET } from '../src/app/api/history/route';
import { GET as DATA_GET, POST as DATA_POST } from '../src/app/api/data/route';
import { POST as CAFE_POST } from '../src/app/api/cafe/route';
import { APPROVED_CATALOG } from '../src/server/approved-catalog';

test('real profile, plan, history and data routes refuse mode conflict and cannot authenticate a local cookie or connect externally', async () => {
  const keys = ['ZEIRISHI_SUPABASE_ENABLED', 'ZEIRISHI_FIXTURE_MODE', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'ZEIRISHI_APP_ORIGIN'] as const;
  const previous = keys.map(key => process.env[key]);
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  try {
    globalThis.fetch = async () => { fetches++; throw new Error('unexpected external access'); };
    process.env.ZEIRISHI_SUPABASE_ENABLED = '1';
    process.env.ZEIRISHI_FIXTURE_MODE = '1';
    const request = () => new Request('https://coach.example/api/profile', { headers: { cookie: 'zc-user=11111111-1111-4111-8111-111111111111' } });
    const conflict = await GET(request());
    assert.equal(conflict.status, 503);
    assert.deepEqual(await conflict.json(), { error: 'AUTH_MODE_CONFLICT' });
    delete process.env.ZEIRISHI_FIXTURE_MODE;
    process.env.SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_only_a_test_fixture_key';
    process.env.ZEIRISHI_APP_ORIGIN = 'https://coach.example';
    const denied = await GET(request());
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { error: 'AUTH_REQUIRED' });
    assert.equal(denied.headers.get('cache-control'), 'private, no-store');
    assert.equal(denied.headers.get('set-cookie'), null);
    assert.equal(fetches, 0);
    assert.deepEqual(APPROVED_CATALOG, []);
    for (const fixture of ['1', undefined]) {
      if (fixture) process.env.ZEIRISHI_FIXTURE_MODE = fixture;
      else delete process.env.ZEIRISHI_FIXTURE_MODE;
      const plan = await PLAN_GET(new Request('https://coach.example/api/plan', { headers: { cookie: 'zc-user=11111111-1111-4111-8111-111111111111' } }));
      assert.equal(plan.status, fixture ? 503 : 401);
      assert.deepEqual(await plan.json(), { error: fixture ? 'AUTH_MODE_CONFLICT' : 'AUTH_REQUIRED' });
      const history = await HISTORY_GET(new Request('https://coach.example/api/history', { headers: { cookie: 'zc-user=11111111-1111-4111-8111-111111111111' } }));
      assert.equal(history.status, fixture ? 503 : 401);
      assert.deepEqual(await history.json(), { error: fixture ? 'AUTH_MODE_CONFLICT' : 'AUTH_REQUIRED' });
      const data = await DATA_GET(new Request('https://coach.example/api/data', { headers: { cookie: 'zc-user=11111111-1111-4111-8111-111111111111' } }));
      assert.equal(data.status, fixture ? 503 : 401);
      assert.equal(data.headers.get('content-disposition'), null);
      const deleted = await DATA_POST(new Request('https://coach.example/api/data', { method: 'POST',
        headers: { origin: 'https://coach.example', 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'delete', confirmation: 'DELETE_MY_LEARNING_DATA' }) }));
      assert.equal(deleted.status, fixture ? 503 : 401);
      const cafe = await CAFE_POST(new Request('https://coach.example/api/cafe', { method: 'POST',
        headers: { origin: 'https://coach.example', 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'start', requestId: crypto.randomUUID() }) }));
      assert.equal(cafe.status, fixture ? 503 : 401);
      assert.equal(fetches, 0);
    }
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});
