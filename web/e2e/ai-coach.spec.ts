import { test, expect, type Page } from '@playwright/test';

async function action(page: Page, action: string, name: string) {
 const response = page.waitForResponse(response => response.url().endsWith('/api/cafe')
  && response.request().method() === 'POST' && response.request().postDataJSON()?.action === action);
 await page.getByRole('button', { name, exact: true }).click();
 expect((await response).status()).toBe(200);
}
async function teachBack(page: Page) {
 await page.goto('/#map');
 await action(page, 'start', 'この相談で学ぶ →');
 await action(page, 'save', '資料を見て判断する →');
 const response = page.waitForResponse(response => response.url().endsWith('/api/cafe')
  && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save');
 await page.getByRole('radio', { name: '40,000円', exact: true }).check();
 expect((await response).status()).toBe(200);
 const submit = page.waitForResponse(response => response.url().endsWith('/api/cafe')
  && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'submit');
 const confidence = page.waitForResponse(response => response.url().endsWith('/api/cafe')
  && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'confidence');
 await page.getByRole('button', { name: 'この回答で進む →', exact: true }).click();
 expect((await submit).status()).toBe(200);
 expect((await confidence).status()).toBe(200);
 await action(page, 'progress', '自分の言葉で説明してみる →');
}

test('誤答の解説から質問でき、接続状態を正しく表示する', async ({ page }) => {
 await page.goto('/#map');
 await action(page, 'start', 'この相談で学ぶ →');
 await page.locator('summary').filter({ hasText: 'この相談の科目内の位置' }).click();
  await expect(page.getByRole('region', { name: '学習上の見取り図' })).toContainText('今回の相談：カフェの年間保険料をどう処理する？（試用例）');
 await action(page, 'save', '資料を見て判断する →');
 const saved = page.waitForResponse(response => response.url().endsWith('/api/cafe')
  && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save');
 await page.getByRole('radio', { name: '120,000円', exact: true }).check();
 expect((await saved).status()).toBe(200);
 const submitted = page.waitForResponse(response => response.url().endsWith('/api/cafe')
  && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'submit');
 const confidence = page.waitForResponse(response => response.url().endsWith('/api/cafe')
  && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'confidence');
 await page.getByRole('button', { name: 'この回答で進む →', exact: true }).click();
 expect((await submitted).status()).toBe(200);
 expect((await confidence).status()).toBe(200);
 const panel = page.getByRole('region', { name: '説明について相談' });
 await expect(panel.getByRole('heading', { name: '間違い・疑問をチャットで確かめる' })).toBeVisible();
 const question = '12万円と答えたけど、使った4か月だけ費用になる理解で合ってる？';
 await panel.getByLabel('解説について聞きたいこと').fill(question);
 const reply = page.waitForResponse(response => response.url().endsWith('/api/ai-coach'));
 await panel.getByRole('button', { name: 'AIに質問する →' }).click();
 const response = await reply;
 expect(response.status()).toBe(200);
 expect(response.request().postDataJSON()).toMatchObject({ question, explanation: '', confirmed: true });
 const answer = await response.json();
 await expect(panel.getByRole('list', { name: 'この画面の会話' })).toContainText(question);
 if (process.env.ZEIRISHI_LOCAL_CLI_PROVIDER === 'claude') {
  expect(answer.mode).toBe('ai');
  await expect(panel.getByText('AIの返答', { exact: true })).toBeVisible();
 } else {
  expect(answer.mode).toBe('fixed');
  await expect(panel.getByText('AIに接続できないため、この質問には個別に回答できません。', { exact: false })).toBeVisible();
 }
 await expect(page.getByRole('heading', { name: '判断の理由を理解する' })).toBeVisible();
});

test('保存確認済みの説明だけで固定の理解確認を要求し、相談を完了できる', async ({ page }) => {
 let requests = 0;
 page.on('request', request => { if (new URL(request.url()).pathname === '/api/ai-coach') requests++; });
 await teachBack(page);
 const ask = page.getByRole('button', { name: '保存済み説明で理解を確認', exact: true });
 const input = page.getByLabel('相談者への説明（任意・2,000文字まで）');
 await expect(ask).toBeDisabled();
 const explanation = '今年使った4か月分は費用、翌期の8か月分は前払費用です。';
 await input.fill(explanation);
 await expect(ask).toBeDisabled();
 await action(page, 'progress', '下書きを保存');
 await expect(ask).toBeEnabled(); expect(requests).toBe(0);
 const response = page.waitForResponse(response => response.url().endsWith('/api/ai-coach'));
 await ask.click();
 const received = await response;
 expect(received.status()).toBe(200);
 expect(received.request().postDataJSON()).toMatchObject({ explanation, confirmed: true, purpose: 'explain_to_owner' });
 const firstReply = await received.json();
 expect(firstReply.mode).toBe('fixed');
 const panel = page.getByRole('region', { name: '説明について相談' });
 await expect(panel.getByText('固定の理解確認', { exact: true })).toBeVisible();
 await expect(input).toHaveValue(explanation); expect(requests).toBe(1);
 const followUps = [firstReply.follow_up];
 for (const purpose of ['rephrase', 'another_example', 'check_my_example']) {
  await panel.getByRole('combobox').selectOption(purpose);
  const next = page.waitForResponse(response => response.url().endsWith('/api/ai-coach'));
  await ask.click();
  const received = await next;
  expect(received.status()).toBe(200);
  expect(received.request().postDataJSON()).toMatchObject({ purpose, explanation });
  const result = await received.json();
  expect(result.mode).toBe('fixed');
  expect(result.evidenceQualification).toBe('practice_only');
  followUps.push(result.follow_up);
  await expect(panel.getByText(result.follow_up, { exact: true })).toBeVisible();
 }
 expect(new Set(followUps).size).toBe(4);
 await expect(input).toHaveValue(explanation); expect(requests).toBe(4);
 await action(page, 'progress', '保存して振り返る →');
 await action(page, 'complete', 'この相談を完了する');
 await expect(page.getByText('相談ケース完了', { exact: true })).toBeVisible();
 await expect(page.getByText('合格判定は未実施です。', { exact: false })).toBeVisible();
});

test('返信の待機を中止しても保存した説明を保持し自動再送しない', async ({ page }) => {
 await teachBack(page);
 const explanation = '使った期間と、まだ使っていない期間を分けます。';
 const input = page.getByLabel('相談者への説明（任意・2,000文字まで）');
 await input.fill(explanation); await action(page, 'progress', '下書きを保存');
 let requests = 0;
 let release!: () => void;
 const held = new Promise<void>(resolve => { release = resolve; });
 await page.route('**/api/ai-coach', async route => {
  requests++; await held; await route.abort('failed').catch(() => {});
 });
 try {
  await page.getByRole('button', { name: '保存済み説明で理解を確認', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await page.getByRole('button', { name: '返信の待機を中止', exact: true }).click();
  await expect(page.getByText('中止しました。保存済みの説明は残っています。固定要点で続けられます。', { exact: true })).toBeVisible();
  await expect(input).toHaveValue(explanation);
  await expect(page.getByRole('button', { name: '保存済み説明で理解を確認', exact: true })).toBeEnabled();
  expect(requests).toBe(1);
 } finally { release(); await page.unroute('**/api/ai-coach'); }
 await page.goto('/');
 await page.getByRole('button', { name: '続きから再開', exact: true }).click();
 await expect(input).toHaveValue(explanation);
});

test('未送信の質問は同じ相談の画面移動と履歴往復で保持し、別の相談には引き継がない', async ({ page }) => {
 await teachBack(page);
 const question = page.getByLabel('解説について聞きたいこと');
 const text = 'どの期間を費用として考えるのか確認したいです';
 await question.fill(text);
 let requests = 0;
 page.on('request', request => { if (new URL(request.url()).pathname === '/api/ai-coach') requests++; });
 const nav = page.getByRole('navigation', { name: '学習ナビゲーション' });
 await nav.getByRole('button', { name: 'ホーム', exact: true }).click();
 await expect(question).toBeHidden();
 expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
 await page.goBack();
 await expect(question).toHaveValue(text);
 await page.goForward();
 await page.getByRole('button', { name: '続きから再開', exact: true }).click();
 await expect(question).toHaveValue(text);
 await action(page, 'progress', '保存して振り返る →');
 await expect(question).toBeHidden();
 expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
 await action(page, 'progress', '説明を直す');
 await expect(question).toHaveValue(text);
 expect(requests).toBe(0);
 await nav.getByRole('button', { name: '学習地図', exact: true }).click();
 await action(page, 'start', 'この相談で学ぶ →');
 await expect.poll(() => page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
 await action(page, 'save', '資料を見て判断する →');
 const saved = page.waitForResponse(response => response.url().endsWith('/api/cafe') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save');
 await page.getByRole('radio', { name: '40,000円', exact: true }).check();
 expect((await saved).status()).toBe(200);
 await page.getByRole('button', { name: 'この回答で進む →', exact: true }).click();
 await expect(question).toBeVisible();
 await expect(question).toHaveValue('');
 expect(requests).toBe(0);
});
