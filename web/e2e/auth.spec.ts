import { test, expect } from '@playwright/test';

test('ローカル教材モードでは本番認証を有効化したと見せない', async ({ request }) => {
  const response = await request.get('/api/auth/session');
  expect(response.status()).toBe(503);
  expect(['AUTH_DISABLED', 'AUTH_MODE_CONFLICT']).toContain((await response.json()).error);
  expect(response.headers()['cache-control']).toContain('no-store');
  for (const path of ['request', 'logout', 'callback']) {
    const blocked = path === 'callback' ? await request.get('/api/auth/callback?code=test')
      : await request.post(`/api/auth/${path}`, { data: {} });
    expect(blocked.status()).toBe(503);
    expect(['AUTH_DISABLED', 'AUTH_MODE_CONFLICT']).toContain((await blocked.json()).error);
    expect(blocked.headers()['cache-control']).toContain('no-store');
  }
  const profile = await request.get('/api/profile');
  expect(profile.ok()).toBe(true);
  expect((await profile.json()).developmentOnly).toBe(true);
});
