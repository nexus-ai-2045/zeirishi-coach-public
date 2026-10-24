import { test, expect } from '@playwright/test';

for (const failure of ['http-error', 'network-error', 'unconfirmed'] as const) {
  test(`ログアウト失敗(${failure})後も確認中に残留せず明示再試行できる`, async ({ page }) => {
    await page.route('**/api/auth/session', route => route.fulfill({ json: {
      authenticated: true, userId: '11111111-1111-4111-8111-111111111111',
    } }));
    let calls = 0;
    await page.route('**/api/auth/logout', route => {
      calls++;
      if (calls > 1) return route.fulfill({ json: { signedOut: true } });
      if (failure === 'network-error') return route.abort();
      if (failure === 'unconfirmed') return route.fulfill({ json: { signedOut: false } });
      return route.fulfill({ status: 503, json: { error: 'AUTH_UNAVAILABLE' } });
    });
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'ログインを確認しました' })).toBeVisible();
    const logout = page.getByRole('button', { name: 'このブラウザーからログアウト' });
    await logout.click();
    await expect(page.getByRole('heading', { name: '認証サービスを確認できません' })).toBeVisible();
    await expect(page.getByText('ログイン状態を確認しています…', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('alert')).toContainText(/ログアウト/);
    await expect(logout).toBeEnabled();
    await expect(page.getByRole('button', { name: 'ログイン状態を再確認' })).toBeEnabled();
    expect(calls).toBe(1);
    await logout.click();
    await expect(page.getByText('このブラウザーからログアウトしました。', { exact: true })).toBeVisible();
    expect(calls).toBe(2);
  });
}

test('未設定のログイン画面はメール送信せず準備中を案内する', async ({ page }) => {
  const posts: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'ログインは準備中です' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ログインリンクを送信する' })).toBeDisabled();
  expect(posts).toEqual([]);
  await page.screenshot({ path: '/tmp/zeirishi-login-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/zeirishi-login-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('メール要求失敗は入力保持・自動再送なし・明示再試行だけで受け付ける', async ({ page }) => {
  // UI transport fixtures only; neither auth provider nor SMTP is contacted.
  await page.route('**/api/auth/session', route => route.fulfill({ status: 401, json: { error: 'AUTH_REQUIRED' } }));
  let sends = 0;
  await page.route('**/api/auth/request', route => {
    sends++;
    expect(route.request().postDataJSON()).toEqual({ email: 'learner@example.test' });
    return sends === 1 ? route.abort() : route.fulfill({ status: 202, json: { accepted: true, deliveryConfirmed: false } });
  });
  await page.goto('/login?auth=link-invalid');
  await expect(page.getByText('まだログインしていません。', { exact: false })).toBeVisible();
  await expect(page.getByText('ログインリンクを確認できませんでした。', { exact: false })).toBeVisible();
  await page.getByLabel('招待されたメールアドレス').fill('learner@example.test');
  expect(sends).toBe(0);
  await page.getByRole('button', { name: 'ログインリンクを送信する' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '自動で再送はしません' })).toBeVisible();
  await expect(page.getByLabel('招待されたメールアドレス')).toHaveValue('learner@example.test');
  await page.getByRole('button', { name: 'ログイン状態を再確認' }).click();
  await expect(page.getByRole('button', { name: 'ログインリンクを送信する' })).toBeEnabled();
  expect(sends).toBe(1);
  await page.getByRole('button', { name: 'ログインリンクを送信する' }).click();
  await expect(page.getByText('ログインリンクの送信要求を受け付けました。', { exact: false })).toBeVisible();
  expect(sends).toBe(2);
});

test('失効した会員もログアウトでき、認証成功だけでは学習開始を表示しない', async ({ page }) => {
  let authState: 'forbidden' | 'signed-out' | 'authenticated' = 'forbidden';
  await page.route('**/api/auth/session', route => {
    if (authState === 'forbidden') return route.fulfill({ status: 403, json: { error: 'INVITATION_REQUIRED' } });
    if (authState === 'signed-out') return route.fulfill({ status: 401, json: { error: 'AUTH_REQUIRED' } });
    return route.fulfill({ json: { authenticated: true, userId: '11111111-1111-4111-8111-111111111111', learningBackendReady: false } });
  });
  let logoutCalls = 0;
  await page.route('**/api/auth/logout', route => {
    logoutCalls++;
    authState = 'signed-out';
    return route.fulfill({ json: { signedOut: true, scope: 'local' } });
  });
  await page.goto('/login?auth=authenticated');
  await expect(page.getByText('この利用者の有効な招待を確認できません。', { exact: false })).toBeVisible();
  await page.getByLabel('招待されたメールアドレス').fill('learner@example.test');
  await page.getByRole('button', { name: 'このブラウザーからログアウト' }).click();
  await expect(page.getByText('このブラウザーからログアウトしました。', { exact: true })).toBeVisible();
  await expect(page.getByLabel('招待されたメールアドレス')).toHaveValue('');
  expect(logoutCalls).toBe(1);
  // Simulate a successful external login; repeated session reads never change identity by themselves.
  authState = 'authenticated';
  await page.getByRole('button', { name: 'ログイン状態を再確認' }).click();
  await expect(page.getByRole('heading', { name: 'ログインを確認しました' })).toBeVisible();
  await expect(page.getByText('このブラウザーからログアウトしました。', { exact: true })).toHaveCount(0);
  await expect(page.getByText('学習教材の提供準備は、認証とは別に確認します。', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'プロフィールと教材の準備状況を見る', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '今日は、どこから始めますか？' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /学習.*開始|学習.*始める/ })).toHaveCount(0);
});

test('メール停止と認証障害は区別し、停止後に再送しない', async ({ page }) => {
  let authUnavailable = true;
  await page.route('**/api/auth/session', route => {
    return authUnavailable ? route.fulfill({ status: 503, json: { error: 'AUTH_UNAVAILABLE' } })
      : route.fulfill({ status: 401, json: { error: 'AUTH_REQUIRED' } });
  });
  await page.route('**/api/auth/request', route => route.fulfill({ status: 503, json: { error: 'AUTH_EMAIL_DISABLED' } }));
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: '認証サービスを確認できません' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ログインリンクを送信する' })).toBeDisabled();
  // The provider recovers explicitly, independently of foreground/pageshow revalidation counts.
  authUnavailable = false;
  await page.getByRole('button', { name: 'ログイン状態を再確認' }).click();
  await expect(page.getByRole('button', { name: 'ログインリンクを送信する' })).toBeEnabled();
  await page.getByLabel('招待されたメールアドレス').fill('learner@example.test');
  await page.getByRole('button', { name: 'ログインリンクを送信する' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'メールは送信していません' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ログインリンクを送信する' })).toBeDisabled();
});
