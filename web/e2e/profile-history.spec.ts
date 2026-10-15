import { test, expect, type Page } from '@playwright/test';

async function profileChange(page: Page, click: () => Promise<void>, status = 200) {
  const response = page.waitForResponse(r => r.url().endsWith('/api/profile') && r.request().method() === 'POST');
  await click();
  expect((await response).status()).toBe(status);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}

async function enterDecision(page: Page) {
  await page.goto('/#map');
  await page.getByRole('button', { name: 'この相談で学ぶ →', exact: true }).click();
  const entered = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save');
  await page.getByRole('button', { name: '資料を見て判断する →', exact: true }).click();
  expect((await entered).status()).toBe(200);
}

test('ローカル再開pointerがなくても未提出の相談一覧から選択済み回答を再開できる', async ({ page }) => {
  await enterDecision(page);
  const saved = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save');
  await page.getByRole('radio', { name: '40,000円', exact: true }).check();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.evaluate(() => localStorage.removeItem('zc-cafe-case-v2'));
  await page.goto('/');
  await expect(page.getByRole('button', { name: '続きから再開', exact: true })).toHaveCount(0);
  await page.getByRole('navigation', { name: '学習ナビゲーション' }).getByRole('button', { name: '学習記録' }).click();
  await expect(page.getByRole('heading', { name: '回答前の相談', exact: true })).toBeVisible();
  await page.getByRole('region', { name: '回答前の相談', exact: true }).screenshot({ path: '/tmp/zeirishi-resume-list.png' });
  const resumed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/cafe'
    && response.request().method() === 'GET');
  await page.getByRole('button', { name: 'この相談を再開', exact: true }).click();
  expect((await resumed).status()).toBe(200);
  await expect(page.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  const submit = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'submit');
  const confidence = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'confidence');
  await page.getByRole('button', { name: 'この回答で進む →', exact: true }).click();
  expect((await submit).status()).toBe(200);
  expect((await confidence).status()).toBe(200);
  await expect(page.getByRole('heading', { name: '判断の理由を理解する' })).toBeVisible();
  await page.getByRole('navigation', { name: '学習ナビゲーション' }).getByRole('button', { name: '学習記録' }).click();
  await expect(page.getByRole('button', { name: 'この相談を再開', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'この記録から再開', exact: true })).toBeVisible();
});

test('受験予定の複数登録・未回答・一括自信を今日の科目と分離して保存する', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: '学習ナビゲーション' });
  await page.goto('/#records');
  const examSummary = page.locator('summary').filter({ hasText: '受験予定の科目' });
  await examSummary.click();
  const subjects = page.getByRole('group', { name: '受験予定の科目を選択' });
  await profileChange(page, () => subjects.getByLabel('簿記論', { exact: true }).click());
  await profileChange(page, () => subjects.getByLabel('法人税法', { exact: true }).click());
  await expect(examSummary).toContainText('2科目を登録済み');
  await nav.getByRole('button', { name: '学習地図' }).click();
  await profileChange(page, () => page.getByRole('button', { name: 'すべて「少し怪しい」', exact: true }).click());
  await page.reload();
  await expect(page.getByRole('button', { name: '少し怪しい', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await nav.getByRole('button', { name: '学習記録' }).click();
  await examSummary.click();
  await expect(subjects.getByLabel('簿記論', { exact: true })).toBeChecked();
  await expect(subjects.getByLabel('法人税法', { exact: true })).toBeChecked();
  await profileChange(page, () => page.getByRole('button', { name: '受験予定なしとして保存' }).click());
  await expect(examSummary).toContainText('受験予定なしとして登録済み');
  await profileChange(page, () => page.getByRole('button', { name: '未回答に戻す' }).click());
  await expect(examSummary).toContainText('未回答');
  await nav.getByRole('button', { name: '学習地図' }).click();
  await profileChange(page, () => page.getByRole('button', { name: 'この科目の自信を解除' }).click());
  await expect(page.getByRole('button', { name: '少し怪しい', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/zeirishi-profile-mobile.png', fullPage: true });
});

test('提出済み履歴を再開でき、profile競合から保存を再開できる', async ({ page, context }) => {
  const nav = page.getByRole('navigation', { name: '学習ナビゲーション' });
  await enterDecision(page);
  await page.getByRole('radio', { name: '40,000円', exact: true }).check();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'この回答で進む →', exact: true }).click();
  await expect(page.getByRole('heading', { name: '判断の理由を理解する' })).toBeVisible();
  await nav.getByRole('button', { name: '学習記録' }).click();
  const history = page.getByRole('region', { name: '最近の学習記録' });
  await expect(history).toContainText('今回の選択は正解');
  await history.getByRole('button', { name: 'この記録から再開' }).click();
  await expect(page.getByRole('heading', { name: '判断の理由を理解する' })).toBeVisible();
  await page.getByRole('button', { name: '← 学習地図へ', exact: true }).click();
  const other = await context.newPage();
  await other.goto('/#map');
  await profileChange(other, () => other.getByRole('button', { name: '説明できる', exact: true }).click());
  await profileChange(page, () => page.getByRole('button', { name: '少し怪しい', exact: true }).click(), 409);
  await page.getByRole('button', { name: '入力を残して保存状態を更新' }).click();
  await expect(page.getByRole('alert', { name: '保存エラー' })).toHaveCount(0);
  await profileChange(page, () => page.getByRole('button', { name: '少し怪しい', exact: true }).click());
  await expect(page.getByRole('button', { name: '少し怪しい', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await other.close();
});
