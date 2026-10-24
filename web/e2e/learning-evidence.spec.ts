import { test, expect } from '@playwright/test';

const reviewFixture = (items: { subjectId: string; conceptId: string; conceptVersion: string }[]) => ({
  assessment: { status: 'held', holdReasons: [], records: [] },
  review: { items: items.map(item => ({ ...item, nextReviewAt: '2026-09-13T00:00:00.000Z', scheduledFor: '2026-09-13T00:00:00.000Z', examAdjusted: false })), evidenceCount: items.length, correctionCount: 0 },
});

test('正式復習から相談練習を開始し、通信失敗後も正式証拠を更新せず再試行する（合成予定・正式供給は未検証）', async ({ page }) => {
  const writes: string[] = [];
  const errors: string[] = [];
  let starts = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
  await page.route('**/api/learning-evidence?**', route => route.fulfill({ json: reviewFixture([
    { subjectId: 'bookkeeping', conceptId: 'prepaid-expenses', conceptVersion: 'synthetic-cafe-prepaid-v2' },
  ]) }));
  await page.route('**/api/cafe', route => {
    if (route.request().method() !== 'POST') return route.continue();
    expect(route.request().postDataJSON().action).toBe('start');
    return ++starts === 1 ? route.abort() : route.continue();
  });
  await page.goto('/#records');
  await expect(page.getByRole('heading', { name: '学習記録', level: 1 })).toBeVisible();
  await page.getByText('合格ラインと復習の根拠', { exact: true }).click();
  await page.getByRole('button', { name: '保存済みの根拠を確認', exact: true }).click();
  await expect(page.getByText('開始や相談の完了だけでは、正式な測定の証拠・理解度・復習予定を更新しません。', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'この復習の相談を始める', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/zeirishi-review-queue-mobile.png' });
  await page.getByRole('button', { name: 'この復習の相談を始める', exact: true }).click();
  await expect(page.getByRole('alert', { name: '保存エラー' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '合格ライン評価は保留です' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'この復習の相談を始める', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '同じ操作を再試行', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'カフェの年間保険料をどう処理する？' })).toBeVisible();
  expect(starts).toBe(2);
  expect(writes).toEqual(['/api/cafe', '/api/cafe']);
  expect(errors).toEqual([]);
});

test('復習の旧版・未提供・固定教材以外は開始できず、別科目の予定は混ぜない（合成予定・正式供給は未検証）', async ({ page }) => {
  await page.route('**/api/profile?**', async route => {
    const response = await route.fetch();
    const catalog = await response.json();
    catalog.concepts.push({ subjectId: 'bookkeeping', conceptId: 'catalog-only', conceptVersion: 'v1', label: '固定教材ではない概念', importance: 1, durationMinutes: 5, unseenQuestionCount: 0 });
    await route.fulfill({ json: catalog });
  });
  await page.route('**/api/learning-evidence?**', route => route.fulfill({ json: reviewFixture([
    { subjectId: 'bookkeeping', conceptId: 'prepaid-expenses', conceptVersion: 'retired-v1' },
    { subjectId: 'bookkeeping', conceptId: 'not-offered', conceptVersion: 'v1' },
    { subjectId: 'bookkeeping', conceptId: 'catalog-only', conceptVersion: 'v1' },
    { subjectId: 'income-tax', conceptId: 'other-subject-review', conceptVersion: 'v1' },
  ]) }));
  await page.goto('/#records');
  await expect(page.getByRole('heading', { name: '学習記録', level: 1 })).toBeVisible();
  await page.getByText('合格ラインと復習の根拠', { exact: true }).click();
  await page.getByRole('button', { name: '保存済みの根拠を確認', exact: true }).click();
  await expect(page.getByText('この版の教材は現在提供されていないため、ここから相談を開始できません。', { exact: true })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'この復習の相談を始める', exact: true })).toHaveCount(0);
  await expect(page.getByText('other-subject-review', { exact: false })).toHaveCount(0);
});

test('保存済み根拠への入口と未測定の保留を390px画面でも表示する', async ({ page }) => {
  await page.goto('/#records');
  await expect(page.getByRole('heading', { name: '学習記録', level: 1 })).toBeVisible();
  await page.getByText('合格ラインと復習の根拠', { exact: true }).click();
  const response = page.waitForResponse(response => response.url().includes('/api/learning-evidence?'));
  await page.getByRole('button', { name: '保存済みの根拠を確認', exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(page.getByRole('heading', { name: '合格ライン評価は保留です', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '概念ごとの理解の根拠', exact: true })).toBeVisible();
  await expect(page.getByText('概念別の測定は準備中です。', { exact: false })).toBeVisible();
  await expect(page.getByText('正式な復習予定を作る証拠がまだありません。好きな単元の練習は続けられます。', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'この復習の相談を始める', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: '合格ライン評価は保留です', exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/zeirishi-evidence-mobile.png', fullPage: true });
});

test('通信失敗で到達とせず再試行できる（到達応答は画面用合成fixture）', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/learning-evidence?**', route => {
    calls++;
    if (calls === 1) return route.abort();
    const query = new URL(route.request().url()).searchParams;
    return route.fulfill({ json: { assessment: { version: 'exam-readiness-v1', subjectId: query.get('subjectId'),
      examYear: Number(query.get('examYear')), criterionVersion: query.get('criterionVersion'), status: 'target_met_twice',
      selectedIds: [], holdReasons: [], records: [] }, review: { items: [], evidenceCount: 0, correctionCount: 0 } } });
  });
  await page.goto('/#records');
  await expect(page.getByRole('heading', { name: '学習記録', level: 1 })).toBeVisible();
  await page.getByText('合格ラインと復習の根拠', { exact: true }).click();
  await page.getByLabel('評価基準の版（任意）', { exact: true }).fill('synthetic-screen-test');
  await page.getByRole('button', { name: '保存済みの根拠を確認', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '評価の根拠を取得できませんでした。' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '直近2回で確認済みの基準に到達', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '保存済みの根拠を確認', exact: true }).click();
  await expect(page.getByRole('heading', { name: '直近2回で確認済みの基準に到達', exact: true })).toBeVisible();
  await expect(page.getByText('合格保証・合格確率ではありません。', { exact: false })).toBeVisible();
  expect(calls).toBe(2);
});

test('概念の再確認を科目合格と分離して表示する（画面用合成fixture）', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/learning-evidence?**', route => route.fulfill({ json: {
    assessment: { status: 'held', holdReasons: [], records: [] }, review: { items: [], evidenceCount: 0, correctionCount: 0 },
    mastery: [{ subjectId: 'bookkeeping', conceptId: 'screen-fixture', conceptVersion: 'v1', criterionVersion: 'fixture-v1',
      status: 'exam_confirmed', needsRecheck: true, reasons: ['最新の正式測定が未達のため要再確認です。'] }],
  } }));
  await page.goto('/#records');
  await expect(page.getByRole('heading', { name: '学習記録', level: 1 })).toBeVisible();
  await page.getByText('合格ラインと復習の根拠', { exact: true }).click();
  await page.getByRole('button', { name: '保存済みの根拠を確認', exact: true }).click();
  await expect(page.getByRole('heading', { name: '合格ライン評価は保留です' })).toBeVisible();
  await expect(page.getByText('screen-fixture：試験形式で確認済み', { exact: true })).toBeVisible();
  await expect(page.getByText('要再確認：新しい独力の測定が必要です。', { exact: true })).toBeVisible();
  await page.getByText('要再確認：新しい独力の測定が必要です。', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: '/tmp/zeirishi-mastery-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText('要再確認：新しい独力の測定が必要です。', { exact: true }).evaluate(element => element.scrollIntoView({ block: 'center' }));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/zeirishi-mastery-mobile.png' });
  expect(errors).toEqual([]);
});
