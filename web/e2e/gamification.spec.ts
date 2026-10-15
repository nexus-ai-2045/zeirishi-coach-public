import { expect, test, type Page } from '@playwright/test';

type MomentAudit = { moments: string[] };
const moments = (page: Page) => page.locator('[role="status"][data-kind]');
const post = (page: Page, action: string) => page.waitForResponse(response => new URL(response.url()).pathname === '/api/cafe'
  && response.request().method() === 'POST' && response.request().postDataJSON()?.action === action);
const audit = (page: Page) => page.evaluate(() => (window as unknown as MomentAudit).moments);

async function observeMoments(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as MomentAudit;
    state.moments = [];
    const seen = new WeakSet<Element>();
    new MutationObserver(records => {
      for (const record of records) for (const added of record.addedNodes) {
        if (!(added instanceof Element)) continue;
        const candidates = [...added.querySelectorAll('[role="status"][data-kind]')];
        if (added.matches('[role="status"][data-kind]')) candidates.push(added);
        for (const item of candidates) if (!seen.has(item)) {
          seen.add(item); state.moments.push(item.getAttribute('data-kind') ?? '');
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

async function start(page: Page, zoom = false) {
  await page.goto('/#map');
  if (zoom) await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  const response = post(page, 'start');
  await page.getByRole('button', { name: 'この考え方を相談で試す →', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole('button', { name: '資料を見て判断する →', exact: true })).toBeVisible();
}

async function decide(page: Page) {
  const entered = post(page, 'save');
  await page.getByRole('button', { name: '資料を見て判断する →', exact: true }).click();
  expect((await entered).status()).toBe(200);
  const saved = post(page, 'save');
  await page.getByRole('radio', { name: '40,000円', exact: true }).check();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}

async function explain(page: Page) {
  const confidence = post(page, 'confidence');
  await page.getByRole('button', { name: 'この回答で進む →', exact: true }).click();
  expect((await confidence).status()).toBe(200);
  await expect(page.getByRole('heading', { name: '判断の理由を理解する' })).toBeVisible();
}

async function reflect(page: Page) {
  const teach = post(page, 'progress');
  await page.getByRole('button', { name: '自分の言葉で説明してみる →', exact: true }).click();
  expect((await teach).status()).toBe(200);
  const reflection = post(page, 'progress');
  await page.getByRole('button', { name: '保存して振り返る →', exact: true }).click();
  expect((await reflection).status()).toBe(200);
  await expect(page.getByRole('button', { name: 'この相談を完了する', exact: true })).toBeVisible();
}

async function expectMoment(page: Page, kind: string, title: string) {
  await expect(moments(page)).toHaveCount(1);
  await expect(moments(page)).toHaveAttribute('data-kind', kind);
  await expect(moments(page)).toContainText(title);
  await expect(moments(page)).toHaveCount(0);
}

test('初回読込は演出せず、開始・回答と自信の保存・完了成功で一度ずつ演出する', async ({ page }) => {
  await observeMoments(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今日は、どこから始めますか？' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await start(page);
  await expectMoment(page, 'start', '新しい相談、スタート！');
  await decide(page);
  expect(await audit(page)).toEqual(['start']);
  await explain(page);
  await expectMoment(page, 'insight', '資料から判断できました！');
  await reflect(page);
  expect(await audit(page)).toEqual(['start', 'insight']);
  const completed = post(page, 'complete');
  await page.getByRole('button', { name: 'この相談を完了する', exact: true }).click();
  expect((await completed).status()).toBe(200);
  await expectMoment(page, 'complete', '相談を最後までやり遂げました！');
  expect(await audit(page)).toEqual(['start', 'insight', 'complete']);
  await page.getByRole('navigation', { name: '学習ナビゲーション' }).getByRole('button', { name: 'ホーム', exact: true }).click();
  expect(await audit(page)).toEqual(['start', 'insight', 'complete']);
  await page.reload();
  await expect(page.getByRole('heading', { name: '今日は、どこから始めますか？' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
  await expect(moments(page)).toHaveCount(0);
});

for (const action of ['start', 'submit', 'confidence', 'complete'] as const) {
  test(`${action}の保存失敗では達成演出を出さない`, async ({ page }) => {
    await observeMoments(page);
    if (action === 'start') await page.goto('/#map');
    else {
      await start(page);
      await expect(moments(page)).toHaveCount(0);
      await decide(page);
      if (action === 'complete') {
        await explain(page);
        await expect(moments(page)).toHaveCount(0);
        await reflect(page);
      }
    }
    const before = await audit(page);
    await page.route('**/api/cafe', route => route.request().method() === 'POST' && route.request().postDataJSON()?.action === action
      ? route.fulfill({ status: 503, json: { error: '保存できませんでした' } }) : route.continue());
    const failed = post(page, action);
    await page.getByRole('button', { name: action === 'start' ? 'この考え方を相談で試す →' : action === 'complete' ? 'この相談を完了する' : 'この回答で進む →', exact: true }).click();
    expect((await failed).status()).toBe(503);
    await expect(page.getByRole('alert', { name: '保存エラー', exact: true })).toBeVisible();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await expect(moments(page)).toHaveCount(0);
    expect(await audit(page)).toEqual(before);
  });
}

test('控えめ設定を再読込後も保ち、390px・200%・OSの動きを減らす設定で演出が収まる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const preference = page.getByRole('checkbox', { name: '演出を控えめに' });
  await preference.check();
  await page.reload();
  await expect(preference).toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('zc-reduced-effects'))).toBe('1');
  await start(page, true);
  await expect(moments(page)).toHaveAttribute('data-reduced', 'true');
  await expect(moments(page)).toHaveCSS('animation-name', 'none');
  await expect(moments(page).locator('[aria-hidden="true"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const bounds = await moments(page).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await expect(moments(page)).toHaveCount(0);
  await page.reload();
  await expect(preference).toBeChecked();
  await expect(page.getByRole('button', { name: '資料を見て判断する →', exact: true })).toBeVisible();
  await expect(moments(page)).toHaveCount(0);
});

test('誤答は発見した確認点と次の挑戦を示し、正解の達成と分ける', async ({ page }) => {
  await observeMoments(page); await start(page); await expect(moments(page)).toHaveCount(0);
  await page.getByRole('button',{name:'資料を見て判断する →',exact:true}).click();
  await page.getByRole('radio',{name:'120,000円',exact:true}).check();
  await expect(page.locator('main')).toHaveAttribute('aria-busy','false');
  await explain(page);
  await expectMoment(page,'insight','次の一歩が見つかりました');
  await expect(page.getByText('ここが理解のチャンスです',{exact:true})).toBeVisible();
  await expect(page.locator('main')).toContainText('支払');
  await expect(page.getByRole('button',{name:'自分の言葉で説明してみる →',exact:true})).toBeVisible();
});
