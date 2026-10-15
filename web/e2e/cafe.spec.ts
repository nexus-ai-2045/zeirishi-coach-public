import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Browser plugin not available: use the repository's existing Playwright runner.
// Flow: consultation + materials -> choice + optional confidence -> feedback -> teach-back -> completion.
async function cafeAction(page: Page, action: string, button: string | RegExp) {
  const response = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST'
    && response.request().postDataJSON()?.action === action);
  await page.getByRole('button', { name: button, exact: typeof button === 'string' }).click();
  expect((await response).status()).toBe(200);
}

async function chooseAnswer(page: Page) {
  const response = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save');
  await page.getByRole('radio', { name: '40,000円', exact: true }).check();
  expect((await response).status()).toBe(200);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}

async function startDecision(page: Page) {
  await page.goto('/#map');
  await expect(page.getByRole('heading', { name: '学習地図', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: '簿記のコア概念' })).toContainText('学びの枝を見渡す');
  await cafeAction(page, 'start', 'この相談で学ぶ →');
  await expect(page.getByRole('heading', { name: 'カフェの年間保険料をどう処理する？' })).toBeVisible();
  await expect(page.getByRole('list', { name: '学習の流れ' }).getByRole('listitem').first()).toHaveAttribute('data-state', 'current');
  await expect(page.getByText('帳簿には全部「保険料」で入れてあります。', { exact: false })).toBeVisible();
  // The consultation step shows one decision at a time: no options until the learner moves on.
  await expect(page.getByRole('group', { name: '回答を選んでください' })).toHaveCount(0);
  await cafeAction(page, 'save', '資料を見て判断する →');
  await expect(page.getByRole('heading', { name: '資料から判断してみよう' })).toBeVisible();
  await expect(page.getByRole('region', { name: '相談資料' })).toContainText('店舗火災保険');
  await expect(page.getByRole('region', { name: '相談資料' })).toContainText('全額を保険料として記録済み');
  await expect(page.getByText('40,000円', { exact: true })).toHaveCount(1);
  await expect(page.getByRole('group', { name: '回答を選んでください' }).getByRole('radio')).toHaveCount(4);
  await expect(page.getByRole('button', { name: '資料を見て考える →', exact: true })).toHaveCount(0);
}

test('誤答でも選んだ考え方から期間を見直せる', async ({ page }) => {
  await startDecision(page);
  await page.screenshot({ path: '/tmp/zeirishi-cafe-consultation-desktop.png', fullPage: true });
  const saved = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save');
  await page.getByRole('radio', { name: '120,000円', exact: true }).check();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await submitAndExplain(page);
  await expect(page.getByText('支払いをそのまま費用と考えたかもしれません。', { exact: false })).toBeVisible();
  await expect(page.getByText('翌期以降に残す · 8か月')).toBeVisible();
});

async function submitAndExplain(page: Page) {
  const submitResponse = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'submit');
  const confidenceResponse = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'confidence');
  await page.getByRole('button', { name: 'この回答で進む →', exact: true }).click();
  expect((await submitResponse).status()).toBe(200);
  expect((await confidenceResponse).status()).toBe(200);
  await expect(page.getByRole('heading', { name: '判断の理由を理解する' })).toBeVisible();
}

async function reachFeedback(page: Page, confidence: '' | 'low' | 'normal' | 'high' = '') {
  await startDecision(page);
  await chooseAnswer(page);
  await page.getByLabel('回答の自信（任意）').selectOption(confidence);
  await submitAndExplain(page);
}

async function resume(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '続きから再開', exact: true }).click();
}

test('任意の自信チェックを飛ばし、相談・4択・理解・説明の保存復元・完了まで進める', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await startDecision(page);
  await expect(page.getByRole('group', { name: '回答を選んでください' }).getByRole('radio')).toHaveCount(4);
  await chooseAnswer(page);
  await resume(page);
  await expect(page.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  const confidenceResponse = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'confidence');
  await submitAndExplain(page);
  expect((await confidenceResponse).request().postDataJSON().confidence).toBeNull();
  await expect(page.getByText('判断できました', { exact: true })).toBeVisible();
  await expect(page.getByRole('list', { name: '学習の流れ' }).getByRole('listitem').nth(2)).toHaveAttribute('data-state', 'current');
  await expect(page.getByText('月あたり120,000÷12＝10,000円。', { exact: false })).toBeVisible();
  await expect(page.getByText('当期の費用 · 4か月')).toBeVisible();
  await expect(page.getByText('翌期以降に残す · 8か月')).toBeVisible();
  await page.screenshot({ path: '/tmp/zeirishi-cafe-desktop.png', fullPage: true });
  await cafeAction(page, 'progress', '自分の言葉で説明してみる →');
  await expect(page.getByRole('list', { name: '学習の流れ' }).getByRole('listitem').nth(3)).toHaveAttribute('data-state', 'current');
  const explanation = '払ったのは12万円ですが、今年使った安心は4か月分の4万円です。残り8万円は翌期の前払費用です。';
  await page.getByLabel('相談者への説明（任意・2,000文字まで）').fill(explanation);
  await cafeAction(page, 'progress', '下書きを保存');
  await resume(page);
  await expect(page.getByLabel('相談者への説明（任意・2,000文字まで）')).toHaveValue(explanation);
  await page.getByRole('button', { name: '相談者からの追加質問を見る', exact: true }).click();
  await expect(page.getByText('まだ使っていない8か月分は、払ってしまったのに帳簿に残るんですか？')).toBeVisible();
  await expect(page.getByText('追加質問は固定教材です。', { exact: false })).toBeVisible();
  await cafeAction(page, 'progress', '保存して振り返る →');
  await expect(page.getByRole('list', { name: '学習の流れ' }).getByRole('listitem').nth(4)).toHaveAttribute('data-state', 'current');
  await expect(page.getByRole('heading', { name: '説明に、これらのポイントが入っていますか？' })).toBeVisible();
  await expect(page.getByText(explanation, { exact: true })).toBeVisible();
  await cafeAction(page, 'complete', 'この相談を完了する');
  await expect(page.getByRole('list', { name: '学習の流れ' }).locator('li[data-state="complete"]')).toHaveCount(5);
  await expect(page.getByText('相談ケース完了', { exact: true })).toBeVisible();
  await expect(page.getByText('合格判定は未実施です。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '学習地図へ戻る', exact: true }).click();
  await expect(page.getByRole('heading', { name: '学習地図', level: 1 })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '今日は、どこから始めますか？' })).toBeVisible();
  await expect(page.getByRole('button', { name: '続きから再開', exact: true })).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('390pxのスマートフォンで入口と資料・解説が横にはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await startDecision(page);
  await page.screenshot({ path: '/tmp/zeirishi-cafe-consultation-mobile.png', fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await chooseAnswer(page);
  await page.getByLabel('回答の自信（任意）').selectOption('high');
  await submitAndExplain(page);
  await expect(page.getByRole('heading', { name: '判断の理由を理解する' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/zeirishi-cafe-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '← 学習地図へ', exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('全概念に自信があっても直接開始でき、自信は再読み込み後も残る', async ({ page }) => {
  await page.goto('/#map');
  await page.getByRole('button', { name: '説明できる', exact: true }).click();
  await expect(page.getByRole('button', { name: '説明できる', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: '自信のある概念は、おすすめから外しました' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '説明できる', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await cafeAction(page, 'start', 'この相談で学ぶ →');
  await expect(page.getByRole('heading', { name: 'カフェの年間保険料をどう処理する？' })).toBeVisible();
});

test('未提供科目を教材ありと見せず、準備中から簿記論に戻れる', async ({ page }) => {
  await page.goto('/#map');
  await page.getByRole('navigation', { name: '科目', exact: true }).getByRole('button', { name: /財務諸表論/ }).click();
  await expect(page.getByRole('heading', { name: 'この科目の教材は準備中です' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'この相談で学ぶ →', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '簿記論を見る', exact: true }).click();
  await expect(page.getByRole('button', { name: 'この相談で学ぶ →', exact: true })).toBeVisible();
});

test('説明の保存が通信失敗しても入力を保持し、同じ操作の再試行で保存できる', async ({ page }) => {
  await reachFeedback(page);
  await cafeAction(page, 'progress', '自分の言葉で説明してみる →');
  const explanation = '当期の4か月分だけが費用で、翌期の8か月分は前払費用です。';
  const input = page.getByLabel('相談者への説明（任意・2,000文字まで）');
  await page.route('**/api/cafe', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
  await input.fill(explanation);
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.getByRole('alert', { name: '保存エラー', exact: true })).toContainText('入力はこの画面に残っています');
  await expect(input).toHaveValue(explanation);
  await page.unroute('**/api/cafe');
  await cafeAction(page, 'progress', '同じ操作を再試行');
  await expect(page.getByRole('alert', { name: '保存エラー', exact: true })).toHaveCount(0);
  await resume(page);
  await expect(input).toHaveValue(explanation);
});

test('回答送信後の自信保存失敗では送信を重ねず、同じ自信要求を再試行する', async ({ page }) => {
  await startDecision(page);
  await chooseAnswer(page);
  await page.getByLabel('回答の自信（任意）').selectOption('normal');
  const requests: Array<{ action: string; requestId: string; confidence?: string | null }> = [];
  page.on('request', request => {
    if (request.url().endsWith('/api/cafe') && request.method() === 'POST') {
      const body = request.postDataJSON();
      if (body?.action === 'submit' || body?.action === 'confidence') requests.push(body);
    }
  });
  let failFirstConfidence = true;
  await page.route('**/api/cafe', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'confidence' && failFirstConfidence) {
      failFirstConfidence = false;
      await route.abort('failed');
      return;
    }
    await route.continue();
  });
  await page.getByRole('button', { name: 'この回答で進む →', exact: true }).click();
  await expect(page.getByRole('alert', { name: '保存エラー', exact: true })).toContainText('入力はこの画面に残っています');
  expect(requests.map(request => request.action)).toEqual(['submit', 'confidence']);
  expect(requests[1].confidence).toBe('normal');
  await page.unroute('**/api/cafe');
  const confidenceRetry = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'confidence');
  await page.getByRole('button', { name: '同じ操作を再試行', exact: true }).click();
  expect((await confidenceRetry).status()).toBe(200);
  expect(requests.map(request => request.action)).toEqual(['submit', 'confidence', 'confidence']);
  expect(requests[2].requestId).toBe(requests[1].requestId);
  expect(requests[0].requestId).not.toBe(requests[1].requestId);
  await expect(page.getByRole('heading', { name: '判断の理由を理解する' })).toBeVisible();
});

test('既に回答を送信済みのconfidence状態は再開後も従来どおり選べる', async ({ page }) => {
  await startDecision(page);
  await chooseAnswer(page);
  const caseId = await page.evaluate(() => localStorage.getItem('zc-cafe-case-v2'));
  const optionId = await page.getByRole('radio', { name: '40,000円', exact: true }).getAttribute('value');
  expect(caseId).toBeTruthy();
  expect(optionId).toBeTruthy();
  const response = await page.request.post('/api/cafe', { headers: { Origin: 'http://127.0.0.1:3210' }, data: {
    action: 'submit', requestId: randomUUID(), caseId, optionId,
  } });
  expect(response.status()).toBe(200);
  await resume(page);
  await expect(page.getByRole('heading', { name: '今の回答、どれくらい自信がありますか？' })).toBeVisible();
  await cafeAction(page, 'confidence', '選ばずに解説を見る →');
  await expect(page.getByRole('heading', { name: '判断の理由を理解する' })).toBeVisible();
});

test('失敗した説明Aの再試行で編集後の説明Bを消さず、比較で選んだBを保存する', async ({ page }) => {
  await reachFeedback(page);
  await cafeAction(page, 'progress', '自分の言葉で説明してみる →');
  const input = page.getByLabel('相談者への説明（任意・2,000文字まで）');
  const revised = '説明B：今年は4か月分の4万円、翌期8か月分の8万円は前払費用です。';
  await page.route('**/api/cafe', route => route.request().method() === 'POST' ? route.abort('failed') : route.continue());
  await input.fill('説明A：支払日と費用の期間は別です。');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.getByRole('alert', { name: '保存エラー', exact: true })).toContainText('入力はこの画面に残っています');
  await page.unroute('**/api/cafe');
  await input.fill(revised);
  await page.getByRole('button', { name: '同じ操作を再試行', exact: true }).click();
  await expect(page.getByRole('alert', { name: '保存エラー', exact: true })).toContainText('失敗した送信のあとに入力を変更しています');
  await expect(input).toHaveValue(revised);
  await page.getByRole('button', { name: '入力を残して保存状態を更新', exact: true }).click();
  await expect(page.getByRole('region', { name: '保存済み説明との比較' })).toContainText(revised);
  await expect(input).toHaveValue(revised);
  await cafeAction(page, 'progress', '手元の説明を保存する');
  await resume(page);
  await expect(input).toHaveValue(revised);
});

test('別タブとの保存競合は比較中に自動上書きせず、手元の説明を明示選択して保存する', async ({ page, context }) => {
  await reachFeedback(page);
  await cafeAction(page, 'progress', '自分の言葉で説明してみる →');
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: '続きから再開', exact: true }).click();
  const serverExplanation = '別タブの説明A：今年使った4か月分だけ費用です。';
  const localExplanation = '手元の説明B：今年4万円、翌期8万円に期間で分けます。';
  await other.getByLabel('相談者への説明（任意・2,000文字まで）').fill(serverExplanation);
  await cafeAction(other, 'progress', '下書きを保存');
  const input = page.getByLabel('相談者への説明（任意・2,000文字まで）');
  await input.fill(localExplanation);
  const conflict = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'progress');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  expect((await conflict).status()).toBe(409);
  await expect(page.getByRole('alert', { name: '保存エラー', exact: true })).toContainText('別の画面で保存されています');
  await page.getByRole('button', { name: '入力を残して保存状態を更新', exact: true }).click();
  const comparison = page.getByRole('region', { name: '保存済み説明との比較' });
  await expect(comparison).toContainText(serverExplanation);
  await expect(comparison).toContainText(localExplanation);
  await expect(input).toHaveValue(localExplanation);
  // Deliberately cross the 1.2s autosave boundary: merely viewing a comparison must not write B.
  await page.waitForTimeout(1600);
  const caseId = await page.evaluate(() => localStorage.getItem('zc-cafe-case-v2'));
  expect(caseId).toBeTruthy();
  const stored = await page.request.get(`/api/cafe?caseId=${encodeURIComponent(caseId!)}`);
  expect(stored.status()).toBe(200);
  expect((await stored.json()).session.explanation).toBe(serverExplanation);
  await expect(comparison).toBeVisible();
  await cafeAction(page, 'progress', '手元の説明を保存する');
  await resume(page);
  await expect(input).toHaveValue(localExplanation);
  await other.close();
});

test('200%拡大でも四択をキーボードで選び、解説に進める', async ({ page }) => {
  await startDecision(page);
  // CSS zoom scales every rendered element, including px-sized copy; root font-size alone does not.
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('radio', { name: '120,000円', exact: true }).focus();
  const saved = page.waitForResponse(response => response.url().endsWith('/api/cafe')
    && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'save');
  await page.keyboard.press('ArrowRight');
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  await page.getByLabel('回答の自信（任意）').selectOption('');
  await submitAndExplain(page);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/zeirishi-cafe-zoom.png', fullPage: true });
});
