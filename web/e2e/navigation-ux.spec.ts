import { expect, test, type Page } from '@playwright/test';

// Local fixture trial only. Passing these checks does not make the synthetic material an expert-reviewed MVP.
const navName = '学習ナビゲーション';
const caseTitle = 'カフェの年間保険料をどう処理する？';
// Text that would reveal the verdict or the period allocation before the answer is fixed.
const revealTexts = ['判断の理由を理解する', '判断できました', 'ここが理解のチャンスです', '当期の費用 · 4か月',
  '翌期以降に残す · 8か月', '月あたり120,000÷12＝10,000円', '当期にサービスを受けた月を数えた判断です'];

const cafePost = (page: Page, action: string) => page.waitForResponse(r => new URL(r.url()).pathname === '/api/cafe'
  && r.request().method() === 'POST' && r.request().postDataJSON()?.action === action);
const nav = (page: Page) => page.getByRole('navigation', { name: navName });
const fitsWidth = (page: Page) => expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

async function openMap(page: Page) {
  await nav(page).getByRole('button', { name: '学習地図' }).click();
  await expect(page.getByRole('region', { name: '簿記のコア概念' })).toBeVisible();
}

async function startCaseFromMap(page: Page) {
  const started = cafePost(page, 'start');
  await page.getByRole('button', { name: 'この考え方を相談で試す →', exact: true }).click();
  expect((await started).status()).toBe(200);
  // The map lists the same consultation title; a case-only control proves the case view is open.
  await expect(page.getByRole('button', { name: '← 学習地図へ', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: caseTitle })).toBeVisible();
}

async function startCase(page: Page) {
  await openMap(page);
  await startCaseFromMap(page);
}

async function enterDecision(page: Page) {
  const entered = cafePost(page, 'save');
  await page.getByRole('button', { name: '資料を見て判断する →', exact: true }).click();
  expect((await entered).status()).toBe(200);
  await expect(page.getByRole('heading', { name: '資料から判断してみよう' })).toBeVisible();
}

async function choose(page: Page, answer: string) {
  if (await page.getByRole('button', { name: '資料を見て判断する →', exact: true }).isVisible()) await enterDecision(page);
  const saved = cafePost(page, 'save');
  await page.getByRole('radio', { name: answer, exact: true }).check();
  expect((await saved).status()).toBe(200);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}

async function reveal(page: Page) {
  const submitted = cafePost(page, 'submit');
  await page.getByRole('button', { name: 'この回答で進む →', exact: true }).click();
  expect((await submitted).status()).toBe(200);
  await expect(page.getByRole('heading', { name: '判断の理由を理解する' })).toBeVisible();
}

async function expectNoAnswerLeak(page: Page) {
  // Open every visible disclosure so collapsed helper panels in the case are inspected too.
  const closed = page.locator('main details:not([open]) > summary:visible');
  for (let guard = 0; guard < 10 && await closed.count(); guard++) await closed.first().click();
  await expect(closed).toHaveCount(0);
  for (const text of revealTexts) await expect(page.getByText(text, { exact: false })).toHaveCount(0);
  await expect(page.getByText('40,000円', { exact: true })).toHaveCount(await page.getByRole('radio').count() ? 1 : 0);
}

test('ホーム・地図・相談・記録を分け、相談から地図へ戻れる', async ({ page }) => {
  await page.goto('/');
  await expect(nav(page).getByRole('button', { name: 'ホーム' })).toHaveAttribute('aria-current', 'page');
  await expect(nav(page).getByRole('button', { name: '学習地図' })).toBeVisible();
  await expect(nav(page).getByRole('button', { name: '学習記録' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '今日は、どこから始めますか？' })).toBeVisible();
  await expect(page.getByRole('region', { name: '簿記のコア概念' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: '最近の学習記録' })).toHaveCount(0);
  await openMap(page);
  await expect(page.getByRole('button', { name: '試験論点で見る' })).toHaveAttribute('aria-pressed', 'true');
  await startCaseFromMap(page);
  await page.locator('summary').filter({ hasText: 'この相談の科目内の位置' }).click();
  await page.getByRole('button', { name: 'この位置を地図で見る ↗' }).click();
  await expect(page.getByRole('region', { name: '簿記のコア概念' })).toBeVisible();
  await expect(page.getByRole('button', { name: '試験論点で見る' })).toHaveAttribute('aria-pressed', 'true');
  await nav(page).getByRole('button', { name: '学習記録' }).click();
  await expect(page.getByRole('region', { name: '最近の学習記録' })).toBeVisible();
  await expect(page.getByRole('region', { name: '簿記のコア概念' })).toHaveCount(0);
});

test('初回はホームから地図・相談・説明・振り返りまで一周し、途中で中断してもホームから再開できる', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '続きから再開', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '簿記の全体像を見る →', exact: true }).click();
  await expect(page.getByRole('heading', { name: '簿記の全体像', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: '学習地図へ進む →', exact: true }).click();
  await expect(page.getByRole('heading', { name: '学習地図', level: 1 })).toBeVisible();
  await startCaseFromMap(page);
  await expect(page.getByRole('list', { name: '学習の流れ' }).getByRole('listitem').first()).toHaveAttribute('aria-current', 'step');
  await choose(page, '40,000円');
  await reveal(page);
  const toTeachBack = cafePost(page, 'progress');
  await page.getByRole('button', { name: '自分の言葉で説明してみる →' }).click();
  expect((await toTeachBack).status()).toBe(200);
  const draft = page.getByLabel('相談者への説明（任意・2,000文字まで）');
  const text = '支払った時期ではなく、決算日までの4か月を今期の費用と考えます。';
  await draft.fill(text);
  const savedDraft = cafePost(page, 'progress');
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  expect((await savedDraft).status()).toBe(200);
  // Interrupt: leave through the global navigation, then come back from home.
  await nav(page).getByRole('button', { name: 'ホーム' }).click();
  await expect(page.getByText('前回の相談の続きがあります', { exact: true })).toBeVisible();
  await expect(page.getByText('前払費用 · 説明する', { exact: true })).toBeVisible();
  await page.goto('/');
  await page.getByRole('button', { name: '続きから再開', exact: true }).click();
  await expect(draft).toHaveValue(text);
  const toReflection = cafePost(page, 'progress');
  await page.getByRole('button', { name: '保存して振り返る →' }).click();
  expect((await toReflection).status()).toBe(200);
  await expect(page.getByRole('heading', { name: '説明に、これらのポイントが入っていますか？' })).toBeVisible();
  await expect(page.getByText(text, { exact: true })).toBeVisible();
  const completed = cafePost(page, 'complete');
  await page.getByRole('button', { name: 'この相談を完了する', exact: true }).click();
  expect((await completed).status()).toBe(200);
  await expect(page.getByText('相談ケース完了', { exact: true })).toBeVisible();
  await expect(page.getByText('合格判定は未実施です。', { exact: false })).toBeVisible();
  await nav(page).getByRole('button', { name: 'ホーム' }).click();
  await expect(page.getByRole('button', { name: '続きから再開', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '簿記の全体像を見る →', exact: true })).toBeVisible();
});

test('ホームから保存済み相談を直接再開し、ブラウザー履歴と再読込を保つ', async ({ page }) => {
  await page.goto('/');
  await startCase(page);
  await choose(page, '40,000円');
  await page.reload();
  await expect(page.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  await nav(page).getByRole('button', { name: 'ホーム' }).click();
  await expect(page.getByRole('button', { name: '続きから再開', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  await page.goForward();
  await expect(page.getByRole('button', { name: '続きから再開', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '続きから再開', exact: true })).toBeVisible();
  await openMap(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: '学習地図', level: 1 })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('button', { name: '続きから再開', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '続きから再開', exact: true }).click();
  await expect(page.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  // History moves never create a new answer or re-grade: still one saved choice, nothing submitted.
  await expect(page.getByRole('heading', { name: '判断の理由を理解する' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'この回答で進む →', exact: true })).toBeEnabled();
});

for (const [answer, verdict, reflection] of [
  ['120,000円', 'ここが理解のチャンスです', '支払いをそのまま費用と考えたかもしれません。'],
  ['40,000円', '判断できました', '当期にサービスを受けた月を数えた判断です。'],
] as const) {
  test(`${answer} の回答前は正解を出さず、確定後だけ選んだ回答に応じた解説を出す`, async ({ page }) => {
    await page.goto('/');
    await startCase(page);
    await expect(page.getByRole('button', { name: '資料を見て判断する →' })).toBeVisible();
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expectNoAnswerLeak(page);
    await choose(page, answer);
    await expectNoAnswerLeak(page);
    await reveal(page);
    await expect(page.getByText(verdict, { exact: true })).toBeVisible();
    await expect(page.getByText(reflection, { exact: false })).toBeVisible();
    await expect(page.getByText('月あたり120,000÷12＝10,000円。', { exact: false })).toBeVisible();
    await expect(page.getByText('当期の費用 · 4か月')).toBeVisible();
    await page.getByRole('button', { name: '自分の言葉で説明してみる →' }).click();
    const draft = page.getByLabel('相談者への説明（任意・2,000文字まで）');
    await expect(draft).toBeVisible();
    await draft.fill('支払った時期ではなく、決算日までの4か月を今期の費用と考えます。');
    await page.getByRole('button', { name: '保存して振り返る →' }).click();
    await expect(page.getByRole('heading', { name: '説明に、これらのポイントが入っていますか？' })).toBeVisible();
    await expect(page.getByText('合格ラインの評価には使いません。', { exact: false })).toBeVisible();
  });
}

test('4択の保存が通信失敗しても、保存状態を更新したあと手元の選択を残して明示保存できる', async ({ page }) => {
  await page.goto('/');
  await startCase(page);
  await choose(page, '120,000円');
  await page.route('**/api/cafe', route => route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'save'
    ? route.abort('failed') : route.continue());
  await page.getByRole('radio', { name: '40,000円', exact: true }).check();
  const alert = page.getByRole('alert', { name: '保存エラー', exact: true });
  await expect(alert).toContainText('入力はこの画面に残っています');
  await expect(page.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  await expect(nav(page).getByRole('button', { name: 'ホーム' })).toBeDisabled();
  const refreshed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/cafe' && r.request().method() === 'GET');
  await page.getByRole('button', { name: '入力を残して保存状態を更新', exact: true }).click();
  expect((await refreshed).status()).toBe(200);
  await expect(alert).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  await expect(page.getByText('手元で選んだ回答はまだ保存されていません。', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'この回答で進む →', exact: true })).toBeDisabled();
  // Still unsaved: global navigation and browser back must not drop the local choice.
  await expect(nav(page).getByRole('button', { name: 'ホーム' })).toBeDisabled();
  await page.goBack();
  await expect(page).toHaveURL(/#case\//);
  await expect(page.getByText('未保存の入力があります。保存してから画面を移動してください。', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  await page.unroute('**/api/cafe');
  const saved = cafePost(page, 'save');
  await page.getByRole('button', { name: '選んだ回答を保存', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('button', { name: '選んだ回答を保存', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'この回答で進む →', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  await reveal(page);
  await expect(page.getByText('判断できました', { exact: true })).toBeVisible();
});

test('別タブとの4択保存競合では保存済みの選択で手元の選択を上書きせず、選び直しを明示保存する', async ({ page, context }) => {
  await page.goto('/');
  await startCase(page);
  await choose(page, '120,000円');
  const other = await context.newPage();
  await other.goto('/');
  await other.getByRole('button', { name: '続きから再開', exact: true }).click();
  await choose(other, '80,000円');
  const conflict = cafePost(page, 'save');
  await page.getByRole('radio', { name: '40,000円', exact: true }).check();
  expect((await conflict).status()).toBe(409);
  await expect(page.getByRole('alert', { name: '保存エラー', exact: true })).toContainText('別の画面で保存されています');
  await page.getByRole('button', { name: '入力を残して保存状態を更新', exact: true }).click();
  await expect(page.getByRole('alert', { name: '保存エラー', exact: true })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '80,000円', exact: true })).not.toBeChecked();
  const saved = cafePost(page, 'save');
  await page.getByRole('button', { name: '選んだ回答を保存', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await other.reload();
  await expect(other.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  await other.close();
});

test('390pxとキーボードで地図から相談・4択へ進み、横はみ出しがない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await fitsWidth(page);
  const mapButton = nav(page).getByRole('button', { name: '学習地図' });
  await mapButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: '簿記のコア概念' })).toBeVisible();
  await fitsWidth(page);
  const start = page.getByRole('button', { name: 'この考え方を相談で試す →', exact: true });
  await start.focus();
  const started = cafePost(page, 'start');
  await page.keyboard.press('Enter');
  expect((await started).status()).toBe(200);
  await expect(page.getByRole('heading', { name: caseTitle })).toBeVisible();
  await fitsWidth(page);
  const decide = page.getByRole('button', { name: '資料を見て判断する →', exact: true });
  await decide.focus();
  const entered = cafePost(page, 'save');
  await page.keyboard.press('Enter');
  expect((await entered).status()).toBe(200);
  await page.getByRole('radio', { name: '120,000円', exact: true }).focus();
  const saved = cafePost(page, 'save');
  await page.keyboard.press('ArrowRight');
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  await fitsWidth(page);
});

test('200%拡大でもホームの主操作・ナビゲーション・地図が横にはみ出さずキーボードで使える', async ({ page }) => {
  await page.goto('/');
  await startCase(page);
  await nav(page).getByRole('button', { name: 'ホーム' }).click();
  // CSS zoom scales px-sized copy as well; root font-size alone would not.
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; });
  await fitsWidth(page);
  const resume = page.getByRole('button', { name: '続きから再開', exact: true });
  await expect(resume).toBeVisible();
  await resume.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: caseTitle })).toBeVisible();
  await fitsWidth(page);
  await nav(page).getByRole('button', { name: '学習地図' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: '簿記のコア概念' })).toBeVisible();
  await fitsWidth(page);
});

test('相談開始の応答待ちにブラウザーで戻っても、遅れた応答で相談画面へ引き戻さない', async ({ page }) => {
  await page.goto('/');
  await openMap(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/cafe', async route => {
    if (route.request().method() === 'POST' && route.request().postDataJSON()?.action === 'start') await gate;
    await route.continue();
  });
  const started = cafePost(page, 'start');
  await page.getByRole('button', { name: 'この考え方を相談で試す →', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { name: '今日は、どこから始めますか？' })).toBeVisible();
  release();
  expect((await started).status()).toBe(200);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  // The started case is saved and offered from home, but the learner's screen stays where they moved.
  await expect(page).toHaveURL(/#home$/);
  await expect(page.getByRole('heading', { name: '今日は、どこから始めますか？' })).toBeVisible();
  await expect(page.getByRole('button', { name: '続きから再開', exact: true })).toBeVisible();
  await page.unroute('**/api/cafe');
});
