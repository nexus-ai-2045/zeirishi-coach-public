import { test, expect, type Locator } from '@playwright/test';

const concepts = [
  'お金と利益は別',
  '取引には二つの面がある',
  '支払日と費用の期間は別',
] as const;

async function narrative(section: Locator) {
  return section.locator('p, blockquote, li').allTextContents();
}

test('簿記の全体像で閉じる操作と相談開始を区別してケースへ進める', async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#overview');
  const heading = page.getByRole('heading', { name: '簿記の全体像をつかむ', exact: true });
  await expect(heading).toBeVisible();
  await expect(page.getByRole('figure', { name: /商売の出来事から帳簿/ })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '簿記はどういう仕組み？' })).toBeVisible();
  await page.screenshot({ path: '/tmp/zeirishi-concept-intro.png', fullPage: true });
  const intro = heading.locator('xpath=ancestor::section[1]');

  const map = intro.locator('[aria-label="簿記の全体像"]');
  await expect(map).toContainText('ある時点の姿');
  await expect(map).toContainText('資産・負債・純資産');
  await expect(map).toContainText('一定期間の成果');
  await expect(map).toContainText('収益・費用・利益');
  await expect(map).toContainText('カフェの年間保険料をどう処理する？');

  for (const concept of concepts) await expect(intro.getByRole('button', { name: concept, exact: true })).toBeVisible();
  await expect(intro.getByRole('button', { name: concepts[2], exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(intro.getByRole('list', { name: '今日の学習ルート' }).getByRole('listitem')).toHaveCount(3);
  await expect(intro.getByRole('region', { name: '次の相談ケース' }).getByRole('img')).toBeVisible();
  const initialNarrative = await narrative(intro);

  await intro.getByRole('button', { name: concepts[1], exact: true }).click();
  await expect(intro.getByRole('button', { name: concepts[1], exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(map).not.toContainText('この考え方を使う相談ケース');
  await expect(intro.getByRole('region', { name: '次の相談ケース' })).toHaveCount(0);
  const doubleEntryNarrative = await narrative(intro);
  expect(doubleEntryNarrative).not.toEqual(initialNarrative);
  const simulation = intro.getByRole('group', { name: '取引シミュレーション' });
  const state = intro.locator('dl[aria-label="取引後の状態"]');
  await simulation.getByRole('button', { name: '10万円を借りる', exact: true }).click();
  await expect(state).toContainText('現金10万円');
  await expect(state).toContainText('借入金（返す義務）10万円');
  await expect(state).toContainText('この取引による利益0円');
  await simulation.getByRole('button', { name: '借りたお金で備品を3万円購入', exact: true }).click();
  await expect(state).toContainText('現金7万円');
  await expect(state).toContainText('備品3万円');
  await expect(intro.getByRole('img', { name: '資産：現金7万円と備品3万円。負債：借入金10万円。利益0円。', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/zeirishi-concept-visual-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await simulation.getByRole('button', { name: '取引前', exact: true }).click();
  await expect(intro.getByRole('img', { name: '資産：現金0万円と備品0万円。負債：借入金0万円。利益0円。', exact: true })).toBeVisible();
  await simulation.getByRole('button', { name: '10万円を借りる', exact: true }).click();
  await page.screenshot({ path: '/tmp/zeirishi-concept-visual-desktop.png', fullPage: true });

  await intro.getByRole('button', { name: concepts[2], exact: true }).click();
  await expect(intro.getByRole('button', { name: concepts[2], exact: true })).toHaveAttribute('aria-pressed', 'true');
  const timingNarrative = await narrative(intro);
  expect(timingNarrative).not.toEqual(doubleEntryNarrative);
  await expect(intro.getByRole('button', { name: 'この考え方を相談で試す →', exact: true })).toBeVisible();

  await intro.getByRole('button', { name: concepts[0], exact: true }).click();
  await expect(intro.getByRole('button', { name: 'もう分かるので相談へ', exact: true })).toHaveCount(0);
  await intro.getByRole('button', { name: '説明を閉じる', exact: true }).click();
  for (const concept of concepts) await expect(intro.getByRole('button', { name: concept, exact: true })).toBeHidden();
  await intro.getByRole('button', { name: 'コア概念を開く', exact: true }).click();
  await expect(intro.getByRole('button', { name: concepts[2], exact: true })).toBeVisible();
  await intro.getByRole('button', { name: concepts[2], exact: true }).click();

  const started = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'start');
  await intro.getByRole('button', { name: 'もう分かるので相談へ', exact: true }).click();
  expect((await started).status()).toBe(200);
  await expect(page.getByRole('heading', { name: 'カフェの年間保険料をどう処理する？' })).toBeVisible();
  await expect(page.locator('details summary', { hasText: 'この相談につながるコア概念' })).toBeVisible();
});
