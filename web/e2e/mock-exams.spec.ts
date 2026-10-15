import { test, expect, type Page } from '@playwright/test';

// Browser plugin not available: use the repository's Playwright runner.
// Local development DB only. Self-reported examples do not establish reviewed exam readiness.
const api = '/api/mock-exams';
const summary = (page: Page) => page.locator('summary').filter({ hasText: '模試の参考記録' });
async function openRecords(page: Page) {
  await page.goto('/#records');
  await summary(page).click();
  await expect(page.getByRole('heading', { name: '模試の成績を記録', exact: true })).toBeVisible();
  await expect(page.getByLabel('主催・提供元', { exact: true })).toBeEnabled();
}
async function fillRecord(page: Page, score = '65') {
  await page.getByLabel('模試の科目', { exact: true }).selectOption('bookkeeping');
  await page.getByLabel('対象年度', { exact: true }).fill('2026');
  await page.getByLabel('主催・提供元', { exact: true }).fill('架空E2E提供元');
  await page.getByLabel('模試の識別名', { exact: true }).fill('架空E2E模試');
  await page.getByLabel('実施日', { exact: true }).fill('2026-08-20');
  await page.getByLabel('得点', { exact: true }).fill(score);
  await page.getByLabel('満点', { exact: true }).fill('100');
  await page.getByLabel('所要時間（分・任意）', { exact: true }).fill('110');
  await page.getByLabel('順位（任意）', { exact: true }).fill('30');
  await page.getByLabel('受験者数（任意）', { exact: true }).fill('100');
  await page.getByLabel('初めて解いた問題でしたか', { exact: true }).selectOption({ label: 'はい' });
}
async function save(page: Page, status = 200) {
  const response = page.waitForResponse(item => new URL(item.url()).pathname === api && item.request().method() === 'POST');
  await page.getByRole('button', { name: '参考記録を保存', exact: true }).click();
  expect((await response).status()).toBe(status);
  if (status === 200) await expect(page.getByText('参考記録を保存しました', { exact: true })).toBeVisible();
}

test('模試記録をlazy読込して保存・復元・修正し、mobileでも参考記録の境界を示す', async ({ page }) => {
  const errors: string[] = [];
  let reads = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).pathname === api && request.method() === 'GET') reads++; });
  await page.goto('/#records');
  await expect(summary(page)).toBeVisible();
  expect(reads).toBe(0);
  await summary(page).click();
  await expect(page.getByLabel('主催・提供元', { exact: true })).toBeEnabled();
  await fillRecord(page);
  await save(page);
  await page.reload();
  await summary(page).click();
  await page.getByRole('button', { name: '記録を修正', exact: true }).click();
  await expect(page.getByLabel('主催・提供元', { exact: true })).toHaveValue('架空E2E提供元');
  await expect(page.getByLabel('得点', { exact: true })).toHaveValue('65');
  await expect(page.getByLabel('実施日', { exact: true })).toHaveValue('2026-08-20');
  await page.getByLabel('得点', { exact: true }).fill('70');
  await save(page);
  await page.reload();
  await summary(page).click();
  await page.getByRole('button', { name: '記録を修正', exact: true }).click();
  await expect(page.getByLabel('得点', { exact: true })).toHaveValue('70');
  await expect(page.getByText('自己申告の参考記録です。合格ライン判定には使用しません。', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/zeirishi-mock-exams-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('模試保存が通信失敗しても入力を保ち、明示再試行で同じrequestIdを送る', async ({ page }) => {
  await openRecords(page);
  await fillRecord(page);
  const bodies: unknown[] = [];
  await page.route('**/api/mock-exams', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) return route.abort('failed');
    return route.continue();
  });
  await page.getByRole('button', { name: '参考記録を保存', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: /入力|保存/ })).toBeVisible();
  await expect(page.getByLabel('得点', { exact: true })).toHaveValue('65');
  await expect(page.getByLabel('主催・提供元', { exact: true })).toHaveValue('架空E2E提供元');
  expect(bodies).toHaveLength(1);
  await expect(page.getByLabel('得点', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '同じ内容で再試行', exact: true }).click();
  await expect(page.getByText('参考記録を保存しました', { exact: true })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
});

test('2タブで同じ模試を編集すると古いrevisionを拒否し、手元の得点を残す', async ({ page, context }) => {
  await openRecords(page);
  await fillRecord(page);
  await save(page);
  await page.getByRole('button', { name: '記録を修正', exact: true }).click();
  const other = await context.newPage();
  await openRecords(other);
  await other.getByRole('button', { name: '記録を修正', exact: true }).click();
  await other.getByLabel('得点', { exact: true }).fill('80');
  await save(other);
  await page.getByLabel('得点', { exact: true }).fill('55');
  await save(page, 409);
  await expect(page.getByRole('alert').filter({ hasText: /別の|競合/ })).toBeVisible();
  await expect(page.getByLabel('得点', { exact: true })).toHaveValue('55');
  const persisted = await other.request.get(api);
  expect(persisted.status()).toBe(200);
  expect((await persisted.json()).items[0].record.score).toBe(80);
  await expect(page.getByLabel('得点', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '保存版を読み直す', exact: true }).click();
  await expect(page.getByLabel('得点', { exact: true })).toHaveValue('80');
  await expect(page.getByLabel('得点', { exact: true })).toBeEnabled();
  await page.getByLabel('得点', { exact: true }).fill('75');
  await save(page);
  await other.close();
});

test('模試の参考記録を書き出し、確認後の本人削除に含める', async ({ page }) => {
  await openRecords(page);
  await fillRecord(page);
  await save(page);
  await page.getByText('このブラウザーの学習データを管理', { exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '学習データを書き出す', exact: true }).click();
  const stream = await (await event).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(exported.mockExamRecords).toHaveLength(1);
  expect(JSON.stringify(exported.mockExamRecords[0])).toContain('架空E2E模試');
  await page.getByRole('button', { name: '学習データの削除を確認する', exact: true }).click();
  const confirmation = page.getByRole('region', { name: '学習データ削除の最終確認' });
  await confirmation.getByRole('checkbox').check();
  const reloaded = page.waitForEvent('load');
  await confirmation.getByRole('button', { name: '確認した学習データを削除する', exact: true }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: '学習記録', level: 1 })).toBeVisible();
  await summary(page).click();
  await expect(page.getByRole('button', { name: '記録を修正', exact: true })).toHaveCount(0);
  const response = await page.request.get(api);
  expect(response.status()).toBe(200);
  expect((await response.json()).items).toEqual([]);
});

test('模試の未保存入力は相談との往復で残り、本人データ操作は保存まで無効になる', async ({ page }) => {
  await openRecords(page);
  await fillRecord(page, '67');
  await page.getByText('このブラウザーの学習データを管理', { exact: true }).click();
  await expect(page.getByRole('button', { name: '学習データを書き出す', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '学習データの削除を確認する', exact: true })).toBeDisabled();
  const nav = page.getByRole('navigation', { name: '学習ナビゲーション' });
  await nav.getByRole('button', { name: '学習地図' }).click();
  await expect(page.getByText('学習記録の「模試の参考記録」に未保存の入力があります。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'この相談で学ぶ →', exact: true }).click();
  // The map also lists this consultation title, so wait for a case-only control before using history.
  await expect(page.getByRole('button', { name: '← 学習地図へ', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'カフェの年間保険料をどう処理する？', exact: true })).toBeVisible();
  // Browser history back to the map, then back to records, must not drop the hidden draft.
  await page.goBack();
  await expect(page.getByRole('heading', { name: '学習地図', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '学習記録', level: 1 })).toBeVisible();
  // The details may remain open. Reopen only when the retained form is hidden.
  if (!await page.getByLabel('得点', { exact: true }).isVisible()) await summary(page).click();
  await expect(page.getByLabel('得点', { exact: true })).toHaveValue('67');
  await expect(page.getByLabel('主催・提供元', { exact: true })).toHaveValue('架空E2E提供元');
  await expect(page.getByLabel('実施日', { exact: true })).toHaveValue('2026-08-20');
  await expect(page.getByLabel('順位（任意）', { exact: true })).toHaveValue('30');
  await save(page);
});
