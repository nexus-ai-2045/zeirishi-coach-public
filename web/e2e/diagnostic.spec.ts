import { test, expect, type Page } from '@playwright/test';
import { createDiagnosticEngine, type DiagnosticCommand, type DiagnosticQuestion, type DiagnosticSession } from '../src/domain/diagnostic-session';
import type { DiagnosticInput, DiagnosticRecord } from '../src/server/diagnostic-service';

const summary = '理解度を短く確認する（任意）';
async function clickResponse(page: Page, name: string, method = 'POST') {
 const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/diagnostic' && response.request().method() === method);
 await page.getByRole('button', { name, exact: true }).click();
 const result = await response; expect(result.status()).toBe(200); return result;
}

test('実APIの診断在庫ゼロは未達にせず、記録を作らず相談へ進める', async ({ page }) => {
 await page.setViewportSize({ width: 390, height: 844 });
 await page.goto('/#records');
 await page.getByText(summary, { exact: true }).click();
 const initial = await clickResponse(page, '保存した診断を確認', 'GET');
 expect((await initial.json()).items).toEqual([]);
 const started = await clickResponse(page, '短く確認する（最大3問）');
 const item: DiagnosticRecord = (await started.json()).item;
 expect(item.view.status).toBe('unavailable'); expect(item.view.attempts).toEqual([]);
 await expect(page.getByRole('heading', { name: '確認問題準備中です', exact: true })).toBeVisible();
 const result = page.getByRole('region', { name: '理解度確認の結果', exact: true });
 await expect(result).toContainText('科目の合格判定ではありません。');
 await expect(result).not.toContainText('基準未達');
 await expect(page.getByRole('button', { name: '診断の回答を確定', exact: true })).toHaveCount(0);
 const listed = await clickResponse(page, '保存した診断を確認', 'GET');
 expect((await listed.json()).items).toEqual([]);
 const exported = await page.request.get('/api/data');
 expect(exported.status()).toBe(200); expect((await exported.json()).diagnostics).toEqual([]);
 await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
 await page.screenshot({ path: '/tmp/zeirishi-diagnostic-mobile.png', fullPage: true });
 await page.getByText(summary, { exact: true }).click();
 await page.getByRole('navigation', { name: '学習ナビゲーション' }).getByRole('button', { name: '学習地図' }).click();
 await page.getByRole('button', { name: 'この相談で学ぶ →', exact: true }).click();
 await expect(page.getByRole('heading', { name: 'カフェの年間保険料をどう処理する？', exact: true })).toBeVisible();
});

// Explicit synthetic material, restricted to intercepted browser responses. The deployed inventory remains empty.
const fixture: DiagnosticQuestion = {
 id: 'screen-only-q1', version: 'screen-v1', subjectId: 'bookkeeping', conceptId: 'prepaid-expenses', conceptVersion: 'screen-v1',
 familyId: 'screen-only-family', poolId: 'screen-only-pool', poolVersion: 'screen-v1', purpose: 'diagnostic', stage: 'anchor', status: 'active',
 review: { reviewerId: 'synthetic-screen-review', reviewedAt: '2020-01-01T00:00:00.000Z', rightsConfirmed: true },
 prompt: '画面試験用：翌期に使う保険料はどちらに分けますか？', maxScore: 1, targetScore: 1,
 options: [{ id: 'future', label: '翌期分の前払費用', earned: 1, errorReason: null },
  { id: 'current', label: '当期分の費用', earned: 0, errorReason: 'まだ使っていない期間を確認します。' }],
};

async function mockDiagnostic(page: Page, failFirstSubmit: boolean) {
 const engine = createDiagnosticEngine([fixture]);
 let state: DiagnosticSession | undefined;
 let revision = 0;
 let failed = false;
 const submitBodies: DiagnosticInput[] = [];
 const receipts = new Map<string, DiagnosticRecord>();
 await page.route('**/api/diagnostic**', async route => {
  const request = route.request();
  const at = new Date().toISOString();
  const project = (): DiagnosticRecord => ({ id: state!.seed.id, revision, updatedAt: at, view: engine.view(state!, at) });
  if (request.method() === 'GET') {
   await route.fulfill({ json: new URL(request.url()).searchParams.has('id') ? { item: project() } : { items: state ? [project()] : [] } }); return;
  }
  const body = request.postDataJSON() as DiagnosticInput;
  if (body.action === 'submit') submitBodies.push(body);
  const prior = receipts.get(body.requestId);
  if (prior) { await route.fulfill({ json: { item: prior } }); return; }
  if (body.action === 'start') {
   state = engine.start({ id: 'screen-only-session', mode: body.mode, subjectId: body.subjectId,
    conceptId: body.conceptId, createdAt: at, seenFamilies: [] });
   state = engine.transition(state, { type: 'present', requestId: body.requestId, at, seenFamilies: [] });
  } else {
   expect(body.sessionId).toBe(state!.seed.id); expect(body.revision).toBe(revision);
   const { action, requestId, sessionId: _id, revision: _revision, ...extra } = body;
   state = engine.transition(state!, { type: action, requestId, at, ...extra,
    ...(action === 'present' ? { seenFamilies: [] } : {}) } as DiagnosticCommand);
   revision++;
  }
  const item = project(); receipts.set(body.requestId, item);
  // The first submission is accepted server-side, then its response is lost.
  if (body.action === 'submit' && failFirstSubmit && !failed) { failed = true; await route.abort('failed'); return; }
  await route.fulfill({ json: { item } });
 });
 return { submitBodies };
}

for (const confidence of ['普通', '選ばず確認する']) {
 test(`合成問題の構造化回答は自信「${confidence}」まで採点を隠し、中断再開できる`, async ({ page }) => {
  await mockDiagnostic(page, false);
  await page.goto('/#records'); await page.getByText(summary, { exact: true }).click();
  await clickResponse(page, '短く確認する（最大3問）');
  await expect(page.getByRole('group', { name: fixture.prompt, exact: true })).toBeVisible();
  await page.getByRole('radio', { name: '翌期分の前払費用', exact: true }).check();
  const accepted = await clickResponse(page, '診断の回答を確定');
  expect((await accepted.json()).item.view.attempts[0].earned).toBeNull();
  await expect(page.getByRole('group', { name: '答えを確定しました。どのくらい自信がありますか？', exact: true })).toBeVisible();
  await expect(page.getByText(/：1 \/ 1点/)).toHaveCount(0);
  await clickResponse(page, confidence);
  await expect(page.getByText('prepaid-expenses：1 / 1点', { exact: true })).toBeVisible();
  await clickResponse(page, '保存して一旦中断');
  await page.reload(); await page.getByText(summary, { exact: true }).click();
  await clickResponse(page, '保存した診断を確認', 'GET');
  await page.getByRole('button', { name: /の確認を開く$/ }).click();
  await expect(page.getByRole('button', { name: '診断を再開', exact: true })).toBeVisible();
  await clickResponse(page, '診断を再開');
  await clickResponse(page, 'ここまでで確認を終える');
  await expect(page.getByRole('button', { name: '診断を再開', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '次の確認へ', exact: true })).toHaveCount(0);
  await expect(page.getByText('prepaid-expenses：1 / 1点', { exact: true })).toBeVisible();
 });
}

test('回答受理後の通信失敗でも選択を保持し、同じrequestIdと本文で再試行する', async ({ page }) => {
 const { submitBodies } = await mockDiagnostic(page, true);
 await page.goto('/#records'); await page.getByText(summary, { exact: true }).click();
 await clickResponse(page, '短く確認する（最大3問）');
 const choice = page.getByRole('radio', { name: '翌期分の前払費用', exact: true });
 await choice.check(); await page.getByRole('button', { name: '診断の回答を確定', exact: true }).click();
 await expect(page.getByRole('alert').filter({ hasText: '保存・読込を確認できませんでした。' })).toBeVisible();
 await expect(choice).toBeChecked();
 await expect(page.getByText(/：1 \/ 1点/)).toHaveCount(0);
 await clickResponse(page, '診断の同じ操作を再試行');
 expect(submitBodies).toHaveLength(2); expect(submitBodies[1]).toEqual(submitBodies[0]);
 await clickResponse(page, '選ばず確認する');
 await expect(page.getByText('prepaid-expenses：1 / 1点', { exact: true })).toBeVisible();
});
