import { test, expect } from '@playwright/test';

test('試用の二層地図から論点・概念・案件を往復できる', async ({ page }) => {
  await page.goto('/#map');
  const intro = page.getByRole('region', { name: '簿記のコア概念' });
  const map = intro;
  await expect(map.getByRole('button', { name: '試験論点で見る' })).toHaveAttribute('aria-pressed', 'true');
  await expect(map.getByRole('region', { name: '試験論点の地図' })).toBeVisible();
  await map.getByRole('button', { name: /期間に対応する費用/ }).click();
  await expect(map).toContainText('つながる考え方');
  await expect(map).toContainText('お金と利益は別');
  await expect(map).toContainText('支払日と費用の期間は別');
  await map.getByRole('button', { name: /支払日と費用の期間は別/ }).first().click();
  await expect(map.getByRole('button', { name: '考え方で見る' })).toHaveAttribute('aria-pressed', 'true');
  await intro.getByRole('button', { name: 'この考え方を相談で試す →' }).click();
  await expect(page.getByRole('heading', { name: 'カフェの年間保険料をどう処理する？' })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'この相談の科目内の位置' }).click();
  await page.getByRole('button', { name: 'この位置を地図で見る ↗' }).click();
  await expect(map.getByRole('button', { name: '試験論点で見る' })).toHaveAttribute('aria-pressed', 'true');
  await expect(map.getByRole('button', { name: /期間に対応する費用/ })).toHaveAttribute('aria-pressed', 'true');
});

test('未接続論点は教材を捏造せず、モバイルと拡大でも操作できる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#map');
  const intro = page.getByRole('region', { name: '簿記のコア概念' });
  const map = intro;
  await map.getByRole('button', { name: '試験論点で見る' }).click();
  await map.getByRole('button', { name: /未接続の論点例/ }).click();
  await expect(map).toContainText('対応する考え方は未確認');
  await expect(map.getByRole('button', { name: /未接続の論点例/ })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveCount(1);
  await map.getByRole('button', { name: '考え方で見る' }).focus();
  await page.keyboard.press('Enter');
  await expect(map.getByRole('button', { name: '考え方で見る' })).toHaveAttribute('aria-pressed', 'true');
});

test('教材候補の版が地図と合わなければ開始操作を出さない', async ({ page }) => {
  await page.route('**/api/profile?subjectId=bookkeeping', async route => {
    const response = await route.fetch();
    const payload = await response.json();
    await route.fulfill({ response, json: { ...payload, materialChoices: payload.materialChoices.map((choice: object) => ({ ...choice, caseVersion: 'stale-case-version' })) } });
  });
  await page.goto('/#map');
  const intro = page.getByRole('region', { name: '簿記のコア概念' });
  await expect(intro.getByRole('button', { name: 'この考え方を相談で試す →' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '教材準備中' })).toBeDisabled();
});
