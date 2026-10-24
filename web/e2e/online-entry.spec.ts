import { test, expect, type Page, type Route } from '@playwright/test';
import { SUBJECTS } from '../src/domain/onboarding';
import { cafePrompt, gradeCafeChoice, CAFE_CASE_VERSION } from '../src/server/cafe-case';
import type { CafeView } from '../src/server/cafe-service';
import { createWeeklyPlan, type PlanCandidate } from '../src/domain/weekly-plan';

// Browser plugin not available: the existing Playwright runner owns browser validation.
// UI transport fixtures only. These tests prove neither real Auth/DB access nor published material.
// The synthetic case is imported in the test process, never into a client component.
const pointerKey = 'zc-cafe-case-v2';
const auditKey = 'online-pointer-audit';
const sentinel = 'local-only-resume-sentinel';
const learnerId = '11111111-1111-4111-8111-111111111111';

async function auditLocalPointer(page: Page) {
  await page.addInitScript(({ pointerKey, auditKey, sentinel }) => {
    if (sessionStorage.getItem(auditKey) === null) {
      localStorage.setItem(pointerKey, sentinel);
      sessionStorage.setItem(auditKey, '[]');
    }
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      const original = Storage.prototype[method];
      Object.defineProperty(Storage.prototype, method, { configurable: true, value: function (this: Storage, ...args: string[]) {
        if (this === localStorage && args[0] === pointerKey) {
          const records = JSON.parse(sessionStorage.getItem(auditKey) ?? '[]') as string[];
          sessionStorage.setItem(auditKey, JSON.stringify([...records, method]));
        }
        return Reflect.apply(original, this, args);
      } });
    }
  }, { pointerKey, auditKey, sentinel });
}

async function expectLocalPointerUntouched(page: Page) {
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? '[]'), auditKey)).toEqual([]);
  // Property access does not itself invoke our instrumented getItem.
  expect(await page.evaluate(key => localStorage[key], pointerKey)).toBe(sentinel);
}

function emptyCatalog() {
  return { developmentOnly: false, profile: { revision: 0, reports: [], examSubjects: null },
    subjectId: 'bookkeeping', subjects: SUBJECTS.map(subject => ({ ...subject, available: false })),
    concepts: [], recommendations: [], materialNotice: 'UI通信テスト用。オンライン教材は0件です。' };
}

async function mockOnline(page: Page, handle?: (route: Route, path: string) => Promise<boolean>) {
  const unexpected: string[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/auth/')) expect(route.request().headers()['x-zeirishi-learner']).toBe(learnerId);
    if (handle && await handle(route, path)) return;
    if (path === '/api/auth/session') return route.fulfill({ json: { authenticated: true, userId: learnerId, learningBackendReady: false } });
    if (path === '/api/profile') return route.fulfill({ json: emptyCatalog() });
    if (path === '/api/history') return route.fulfill({ json: { items: [], drafts: [], developmentOnly: false } });
    unexpected.push(path);
    await route.abort('blockedbyclient');
  });
  return unexpected;
}

async function enterOnline(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'ログインを確認しました' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '学習ナビゲーション' })).toHaveCount(0);
  await page.getByRole('button', { name: 'プロフィールと教材の準備状況を見る', exact: true }).click();
  await expect(page.getByRole('heading', { name: '今日は、どこから始めますか？' })).toBeVisible();
}

async function openView(page: Page, name: '学習地図' | '学習記録') {
  await page.getByRole('navigation', { name: '学習ナビゲーション' }).getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

function selectionView(concept: { conceptId: string; conceptVersion: string; label: string }): CafeView {
  return { id: 'ui-only-' + concept.conceptId, caseVersion: concept.conceptVersion, status: 'active',
    phase: 'consultation', revision: 0, progressRevision: 0, savedAt: null, expiresAt: '2099-01-01T00:00:00.000Z',
    optionId: null, explanation: '', attemptId: null, confidence: null, confidenceFixed: false, result: null,
    prompt: { ...cafePrompt(), caseId: 'ui-material-' + concept.conceptId, caseVersion: concept.conceptVersion,
      conceptId: concept.conceptId, title: concept.label, consultationTitle: concept.label + 'の相談',
      context: '架空のUI通信テストです。実教材の提供ではありません。' } };
}

test('同じ概念の複数相談を明示選択し再試行でも教材IDとケース版を保持する', async ({ page }) => {
  const concept = { subjectId: 'bookkeeping', conceptId: 'shared-concept', conceptVersion: 'concept-v1',
    label: '同じ概念', importance: 3, durationMinutes: 8, unseenQuestionCount: 0 };
  const materialChoices = ['保険料の相談', '家賃の相談'].map((label, index) => ({
    ...concept, label, materialId: 'case-' + index, caseVersion: 'case-version-' + index,
  }));
  const posts: Record<string, unknown>[] = [];
  const unexpected = await mockOnline(page, async (route, path) => {
    if (path === '/api/profile') {
      await route.fulfill({ json: { ...emptyCatalog(), concepts: [concept], materialChoices } }); return true;
    }
    if (path === '/api/cafe') {
      posts.push(route.request().postDataJSON());
      if (posts.length === 1) await route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } });
      else await route.fulfill({ json: { session: selectionView({ ...concept, label: '家賃の相談', conceptVersion: 'case-version-1' }) } });
      return true;
    }
    return false;
  });
  await enterOnline(page);
  await openView(page, '学習地図');
  await page.getByRole('button', { name: 'この相談で学ぶ →', exact: true }).click();
  expect(posts).toHaveLength(0);
  await page.getByRole('region', { name: '相談ケースを選ぶ' }).getByRole('button', { name: '家賃の相談', exact: true }).click();
  await expect(page.getByRole('alert', { name: '保存エラー' })).toBeVisible();
  await page.getByRole('button', { name: '同じ操作を再試行', exact: true }).click();
  await expect(page.getByRole('heading', { name: '家賃の相談', exact: true })).toBeVisible();
  expect(posts).toHaveLength(2);
  expect(posts[1]).toEqual(posts[0]);
  expect(posts[0]).toMatchObject({ materialId: 'case-1', caseVersion: 'case-version-1',
    concept: { subjectId: 'bookkeeping', conceptId: 'shared-concept', conceptVersion: 'concept-v1' } });
  expect(unexpected).toEqual([]);
});

test('正式復習の現行版だけを本人の相談へ接続し、旧版と未提供は開始しない（合成UI通信）', async ({ page }) => {
  await auditLocalPointer(page);
  const concept = { subjectId: 'bookkeeping', conceptId: 'review-ui-concept', conceptVersion: 'review-ui-v2',
    label: '復習する現行概念', importance: 3, durationMinutes: 8, unseenQuestionCount: 0 };
  const posts: Array<{ action: string; concept: unknown }> = [];
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
  const unexpected = await mockOnline(page, async (route, path) => {
    if (path === '/api/profile') { await route.fulfill({ json: { ...emptyCatalog(), concepts: [concept],
      subjects: SUBJECTS.map(subject => ({ ...subject, available: subject.id === concept.subjectId })),
      materialChoices: [{ ...concept, materialId: 'ui-material-' + concept.conceptId, caseVersion: concept.conceptVersion }] } }); return true; }
    if (path === '/api/learning-evidence') {
      await route.fulfill({ json: { assessment: { status: 'held', holdReasons: [], records: [] },
        review: { evidenceCount: 4, correctionCount: 0, items: [concept, { ...concept, conceptVersion: 'review-ui-v1' },
          { ...concept, conceptId: 'not-offered' }, { ...concept, subjectId: 'income-tax', conceptId: 'other-subject-review' }]
          .map(item => ({ ...item, nextReviewAt: '2026-09-13T00:00:00.000Z', scheduledFor: '2026-09-13T00:00:00.000Z', examAdjusted: false })) } } });
      return true;
    }
    if (path === '/api/cafe' && route.request().method() === 'POST') {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ json: { session: selectionView(concept) } }); return true;
    }
    return false;
  });
  await enterOnline(page);
  await openView(page, '学習記録');
  await page.getByText('合格ラインと復習の根拠', { exact: true }).click();
  await page.getByRole('button', { name: '保存済みの根拠を確認', exact: true }).click();
  await expect(page.getByRole('button', { name: 'この復習の相談を始める', exact: true })).toHaveCount(1);
  await expect(page.getByText('この版の教材は現在提供されていないため、ここから相談を開始できません。', { exact: true })).toHaveCount(2);
  await expect(page.getByText('other-subject-review', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'この復習の相談を始める', exact: true }).click();
  await expect(page.getByRole('heading', { name: '復習する現行概念', exact: true })).toBeVisible();
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({ action: 'start', concept: { subjectId: 'bookkeeping', conceptId: 'review-ui-concept', conceptVersion: 'review-ui-v2' } });
  expect(writes).toEqual(['/api/cafe']);
  await expectLocalPointerUntouched(page);
  expect(unexpected).toEqual([]);
});

for (const action of ['individual', 'bulk', 'exam-subjects'] as const) {
  test(`教材版の保存競合(${action})は明示GETで回復し旧自信を新版へ再送しない`, async ({ page }) => {
    let retired = false;
    const posts: Array<{ revision: number; reports: Array<{ conceptVersion: string; selfConfidence: string | null }> }> = [];
    let reads = 0;
    const unexpected = await mockOnline(page, async (route, path) => {
      if (path === '/api/mock-exams') { await route.fulfill({ json: { items: [], limit: 20, developmentOnly: false } }); return true; }
      if (path !== '/api/profile') return false;
      if (route.request().method() === 'POST') {
        posts.push(route.request().postDataJSON());
        if (posts.length === 1) { retired = true; await route.fulfill({ status: 409, json: { error: 'CONCEPT_VERSION_UNAVAILABLE' } }); }
        else await route.fulfill({ json: { developmentOnly: false } });
        return true;
      }
      reads++;
      await route.fulfill({ json: { ...emptyCatalog(), profile: { revision: retired ? 4 : 3, reports: [], examSubjects: null }, concepts: [{
        subjectId: 'bookkeeping', conceptId: 'ui-versioned', conceptVersion: retired ? 'v2' : 'v1',
        label: retired ? '新版の概念' : '旧版の概念', importance: 3, durationMinutes: 8, unseenQuestionCount: 0,
      }] } });
      return true;
    });
    await enterOnline(page);
    await openView(page, '学習記録');
    await page.locator('summary').filter({ hasText: '模試の参考記録' }).click();
    const unsaved = page.getByLabel('主催・提供元', { exact: true });
    await unsaved.fill('保存していない別の入力');
    // The hidden mock-exam draft must survive moving to the map for confidence changes.
    if (action !== 'exam-subjects') await openView(page, '学習地図');
    if (action === 'individual') await page.getByRole('group', { name: 'この概念の自信', exact: true }).getByRole('button', { name: '少し怪しい', exact: true }).click();
    else if (action === 'bulk') await page.getByRole('button', { name: 'すべて「少し怪しい」', exact: true }).click();
    else {
      await page.locator('summary').filter({ hasText: '受験予定の科目' }).click();
      await page.getByRole('button', { name: '受験予定なしとして保存', exact: true }).click();
    }
    await expect(page.getByRole('alert', { name: '保存エラー' })).toContainText('旧版の自信は新版へ引き継ぎません');
    await expect(page.getByRole('button', { name: '同じ操作を再試行', exact: true })).toHaveCount(0);
    expect(posts).toHaveLength(1);
    expect(reads).toBe(1);
    await page.getByRole('button', { name: '最新の教材一覧を読み直す', exact: true }).click();
    if (action === 'exam-subjects') await openView(page, '学習地図');
    await expect(page.getByRole('heading', { name: '新版の概念', exact: true })).toBeVisible();
    await expect(unsaved).toHaveValue('保存していない別の入力');
    const uncertain = page.getByRole('group', { name: 'この概念の自信', exact: true }).getByRole('button', { name: '少し怪しい', exact: true });
    await expect(uncertain).toHaveAttribute('aria-pressed', 'false');
    expect(posts).toHaveLength(1);
    expect(reads).toBe(2);
    await uncertain.click();
    await expect(page.getByRole('alert', { name: '保存エラー' })).toHaveCount(0);
    await expect.poll(() => posts.length).toBe(2);
    expect(posts[1].revision).toBe(4);
    expect(posts[1].reports).toEqual([{ subjectId: 'bookkeeping', conceptId: 'ui-versioned', conceptVersion: 'v2', selfConfidence: 'uncertain' }]);
    // Back on records, the retained draft is shown again, not only kept in a hidden field.
    await openView(page, '学習記録');
    await expect(unsaved).toBeVisible();
    await expect(unsaved).toHaveValue('保存していない別の入力');
    expect(unexpected).toEqual([]);
  });
}

test('別タブの明示ログアウトは応答待ち中から旧本人の未保存入力を破棄する', async ({ page, context }) => {
  let signedOut = false;
  let releaseLogout!: () => void;
  const logoutGate = new Promise<void>(resolve => { releaseLogout = resolve; });
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') return signedOut
      ? route.fulfill({ status: 401, json: { error: 'AUTH_REQUIRED' } })
      : route.fulfill({ json: { authenticated: true, userId: learnerId } });
    if (path === '/api/auth/logout') { await logoutGate; signedOut = true; return route.fulfill({ json: { signedOut: true } }); }
    if (path === '/api/profile') return route.fulfill({ json: emptyCatalog() });
    if (path === '/api/history') return route.fulfill({ json: { items: [], drafts: [], developmentOnly: false } });
    if (path === '/api/mock-exams') return route.fulfill({ json: { items: [], limit: 20, developmentOnly: false } });
    throw new Error('Unexpected request: ' + path);
  });
  await enterOnline(page);
  await openView(page, '学習記録');
  await page.locator('summary').filter({ hasText: '模試の参考記録' }).click();
  const provider = page.getByLabel('主催・提供元', { exact: true });
  await provider.fill('Aliceだけの未保存入力');
  const login = await context.newPage();
  await login.goto('/login');
  await expect(login.getByRole('heading', { name: 'ログインを確認しました' })).toBeVisible();
  // Opening the login tab with the same identity must not destroy the draft.
  await expect(provider).toHaveValue('Aliceだけの未保存入力');
  try {
    await login.getByRole('button', { name: 'このブラウザーからログアウト' }).click();
    await expect(provider).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: '学習ナビゲーション' })).toHaveCount(0);
  } finally { releaseLogout(); }
  await expect(page.getByText('まだログインしていません。', { exact: false })).toBeVisible();
});

test('本人変更後は遅延した旧session応答でも旧入力を復活させず、再確認の同本人入力は保持する', async ({ page, context }) => {
  const bob = '22222222-2222-4222-8222-222222222222';
  let current = learnerId;
  let hold = false;
  let delayed!: () => void;
  let started!: () => void;
  const oldRequest = new Promise<void>(resolve => { started = resolve; });
  const responseGate = new Promise<void>(resolve => { delayed = resolve; });
  const profileIdentities: string[] = [];
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/session') {
      const snapshot = current;
      if (hold && route.request().frame().page() === page) { hold = false; started(); await responseGate; }
      return route.fulfill({ json: { authenticated: true, userId: snapshot } }).catch(() => {});
    }
    if (path === '/api/profile') {
      profileIdentities.push(route.request().headers()['x-zeirishi-learner']);
      return route.fulfill({ json: emptyCatalog() });
    }
    if (path === '/api/history') return route.fulfill({ json: { items: [], drafts: [], developmentOnly: false } });
    if (path === '/api/mock-exams') return route.fulfill({ json: { items: [], limit: 20, developmentOnly: false } });
    throw new Error('Unexpected request: ' + path);
  });
  await enterOnline(page);
  await openView(page, '学習記録');
  await page.locator('summary').filter({ hasText: '模試の参考記録' }).click();
  const provider = page.getByLabel('主催・提供元', { exact: true });
  await provider.fill('Aliceだけの未保存入力');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(provider).toBeVisible();
  await expect(provider).toHaveValue('Aliceだけの未保存入力');
  hold = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await oldRequest;
  await expect(provider).toBeHidden();
  current = bob;
  const login = await context.newPage();
  try {
    await login.goto('/login');
    await expect(login.getByRole('heading', { name: 'ログインを確認しました' })).toBeVisible();
    await expect(provider).toHaveCount(0);
  } finally { delayed(); }
  await expect(page.getByRole('heading', { name: 'ログインを確認しました' })).toBeVisible();
  await page.getByRole('button', { name: 'プロフィールと教材の準備状況を見る', exact: true }).click();
  await expect(page).toHaveURL(/#records$/);
  await expect(page.getByRole('heading', { name: '学習記録', level: 1 })).toBeVisible();
  await page.locator('summary').filter({ hasText: '模試の参考記録' }).click();
  await expect(provider).toHaveValue('');
  expect(profileIdentities).toEqual([learnerId, bob]);
});

test('初回6単元に絞っても展開後の7番目を選択できる（架空UI通信mock）', async ({ page }) => {
  const concepts = Array.from({ length: 7 }, (_, i) => ({
    subjectId: 'bookkeeping', conceptId: 'ui-concept-' + i, conceptVersion: 'ui-v1',
    label: '架空単元' + (i + 1), importance: 3, durationMinutes: 8, unseenQuestionCount: 0,
  }));
  let selected: unknown;
  const unexpected = await mockOnline(page, async (route, path) => {
    if (path === '/api/profile') {
      await route.fulfill({ json: { ...emptyCatalog(), concepts,
        subjects: SUBJECTS.map(subject => ({ ...subject, available: subject.id === 'bookkeeping' })),
        materialChoices: concepts.map(concept => ({ ...concept, materialId: 'ui-material-' + concept.conceptId, caseVersion: concept.conceptVersion })) } }); return true;
    }
    if (path !== '/api/cafe') return false;
    const body = route.request().postDataJSON();
    expect(body.action).toBe('start');
    selected = body.concept;
    await route.fulfill({ json: { session: selectionView(concepts[6]) } }); return true;
  });
  await enterOnline(page);
  await openView(page, '学習地図');
  const starts = page.getByRole('button', { name: 'この相談で学ぶ →', exact: true });
  await expect(starts).toHaveCount(6);
  await expect(page.getByRole('group', { name: 'この科目の自信をまとめて設定（対象 7件）', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '架空単元7', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '残り1単元を表示', exact: true }).click();
  await expect(starts).toHaveCount(7);
  await page.getByRole('button', { name: '最初の6単元だけ表示', exact: true }).click();
  await expect(starts).toHaveCount(6);
  await page.getByRole('button', { name: '残り1単元を表示', exact: true }).click();
  await starts.nth(6).click();
  await expect(page.getByRole('heading', { name: '架空単元7', exact: true })).toBeVisible();
  expect(selected).toEqual({ subjectId: 'bookkeeping', conceptId: concepts[6].conceptId, conceptVersion: 'ui-v1' });
  expect(unexpected).toEqual([]);
});

test('オンライン模試記録は本人ヘッダーを固定し、本人変更の保存拒否で入力を残す（UI通信mock）', async ({ page }) => {
  const requests: Array<{ method: string; learner: string | undefined }> = [];
  let saves = 0;
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  const unexpected = await mockOnline(page, async (route, path) => {
    if (path !== '/api/mock-exams') return false;
    const method = route.request().method();
    requests.push({ method, learner: route.request().headers()['x-zeirishi-learner'] });
    if (method === 'GET') {
      await route.fulfill({ json: { items: [], limit: 20, developmentOnly: false } });
    } else {
      expect(method).toBe('POST');
      saves++;
      const body = route.request().postDataJSON();
      expect(body.record.provider).toBe('架空オンライン提供元');
      expect(body.record.score).toBe(67);
      // This response only simulates rejection after the verified session changed.
      // No real Auth session is switched and no server identity check is proved here.
      await route.fulfill({ status: 409, json: { error: 'AUTH_IDENTITY_CHANGED' } });
    }
    return true;
  });
  await enterOnline(page);
  await openView(page, '学習記録');
  expect(requests).toEqual([]);
  await page.locator('summary').filter({ hasText: '模試の参考記録' }).click();
  await expect(page.getByLabel('主催・提供元', { exact: true })).toBeEnabled();
  await page.getByLabel('模試の科目', { exact: true }).selectOption('bookkeeping');
  await page.getByLabel('対象年度', { exact: true }).fill('2026');
  await page.getByLabel('主催・提供元', { exact: true }).fill('架空オンライン提供元');
  await page.getByLabel('模試の識別名', { exact: true }).fill('本人変更テスト用模試');
  await page.getByLabel('実施日', { exact: true }).fill('2026-08-20');
  await page.getByLabel('得点', { exact: true }).fill('67');
  await page.getByLabel('満点', { exact: true }).fill('100');
  await page.getByRole('button', { name: '参考記録を保存', exact: true }).click();
  const error = page.getByRole('alert').filter({ hasText: 'ログイン状態を確認できません。入力を残しています。' });
  await expect(error).toBeVisible();
  await expect(page.getByLabel('得点', { exact: true })).toHaveValue('67');
  await expect(page.getByLabel('主催・提供元', { exact: true })).toHaveValue('架空オンライン提供元');
  await expect(page.getByLabel('模試の識別名', { exact: true })).toHaveValue('本人変更テスト用模試');
  await expect(page.getByLabel('得点', { exact: true })).toBeDisabled();
  await expect(page.getByText('参考記録を保存しました', { exact: true })).toHaveCount(0);
  const login = error.getByRole('link', { name: '別タブでログインを確認', exact: true });
  await expect(login).toHaveAttribute('href', '/login');
  await expect(login).toHaveAttribute('target', '_blank');
  await expect(login).toHaveAttribute('rel', /noopener/);
  await expect(error.getByRole('button', { name: '同じ内容で再試行', exact: true })).toBeEnabled();
  await page.waitForTimeout(1500);
  expect(saves).toBe(1);
  expect(requests).toEqual([{ method: 'GET', learner: learnerId }, { method: 'POST', learner: learnerId }]);
  expect(unexpected).toEqual([]);
  expect(pageErrors).toEqual([]);
});

for (const available of [true, false]) {
test(`異科目の週計画は概念と教材版を送信し、${available ? '提供中なら開始する' : '提供停止なら学習記録に留まる'}（架空UI通信mock）`, async ({ page }) => {
  const candidate: PlanCandidate = { subjectId: 'financial-statements', conceptId: 'ui-other-subject', conceptVersion: 'ui-other-v1',
    id: 'ui-other-material', caseVersion: 'ui-other-case-v3', familyId: 'ui-other-family', label: '架空の財務諸表論相談', minutes: 10,
    bucket: 'new', qualification: 'practice', unseen: false, differentFormat: false, sourceTrust: 1,
    priority: { importance: 3, observedExamScoreRatio: null, reviewStatus: 'unknown', recentMisconceptions: [],
      lockedDirectSuccessors: 0, observedMinutes: null, designedMinutes: 10 } };
  const plan = createWeeklyPlan({ weekStart: '2026-09-07', weeklyMinutes: 60,
    examSubjects: ['financial-statements'], candidates: [candidate], excludedIds: [] });
  let selected: unknown;
  let starts = 0;
  const unexpected = await mockOnline(page, async (route, path) => {
    if (path === '/api/plan') {
      expect(route.request().method()).toBe('GET');
      await route.fulfill({ json: { developmentOnly: false, stale: false, autoSkippedIds: [], candidates: [candidate],
        planRecord: { revision: 1, updatedAt: '2026-09-08T00:00:00.000Z', profileRevision: 0,
          weeklyMinutes: 60, excludedIds: [], adjustmentReason: '', plan } } }); return true;
    }
    if (path !== '/api/cafe') return false;
    const body = route.request().postDataJSON();
    expect(body.action).toBe('start');
    expect(body.materialId).toBe(candidate.id);
    expect(body.caseVersion).toBe(candidate.caseVersion);
    selected = body.concept;
    starts++;
    if (!available) { await route.fulfill({ status: 503, json: { error: 'MATERIAL_NOT_AVAILABLE' } }); return true; }
    await route.fulfill({ json: { session: selectionView(candidate) } }); return true;
  });
  await enterOnline(page);
  await openView(page, '学習地図');
  await expect(page.getByRole('heading', { name: '簿記論', exact: true })).toBeVisible();
  await openView(page, '学習記録');
  await page.locator('summary').filter({ hasText: '今週の学習計画' }).click();
  await page.getByRole('button', { name: 'この計画の相談を始める', exact: true }).click();
  if (available) await expect(page.getByRole('heading', { name: candidate.label, exact: true })).toBeVisible();
  else {
    await expect(page.getByRole('alert', { name: '保存エラー' })).toContainText('この相談教材はまだ提供準備中です');
    await expect(page).toHaveURL(/#records$/);
    await expect(page.getByRole('heading', { name: '学習記録', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: '資料を見て判断する →', exact: true })).toHaveCount(0);
  }
  expect(starts).toBe(1);
  expect(selected).toEqual({ subjectId: candidate.subjectId, conceptId: candidate.conceptId, conceptVersion: candidate.conceptVersion });
  expect(unexpected).toEqual([]);
});
}

test('online entry never presents local-only data deletion or learning controls', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '学びの続きを、ここから。' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ログインは準備中です' })).toBeVisible();
  await expect(page.getByText('このブラウザーの学習データを管理', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '確認した学習データを削除する' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'この相談で学ぶ →', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'ログインリンクを送信する' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('オンライン認証の確認後も明示操作まで進まず、教材0件を準備中と表示する（UI通信mock）', async ({ page }) => {
  await auditLocalPointer(page);
  const unexpected = await mockOnline(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await enterOnline(page);
  await expect(page.getByRole('button', { name: '続きから再開', exact: true })).toHaveCount(0);
  await openView(page, '学習地図');
  await expect(page.getByRole('heading', { name: 'この科目の教材は準備中です' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'この相談で学ぶ →', exact: true })).toHaveCount(0);
  await expect(page.getByText('開発用・固定教材モード', { exact: true })).toHaveCount(0);
  await expect(page.getByText('このブラウザーの学習データを管理', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: '/tmp/zeirishi-online-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/zeirishi-online-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expectLocalPointerUntouched(page);
  expect(unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('オンライン削除は対象と除外範囲を説明し、確認後だけ送信してlocal pointerを触らない（UI通信mock）', async ({ page }) => {
  await auditLocalPointer(page);
  let deletes = 0;
  const unexpected = await mockOnline(page, async (route, path) => {
    if (path !== '/api/data') return false;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ action: 'delete', confirmation: 'DELETE_MY_LEARNING_DATA' });
    deletes++;
    await route.fulfill({ json: { deleted: true, developmentOnly: false, accountDeleted: false, backupsDeleted: false } });
    return true;
  });
  await enterOnline(page);
  await openView(page, '学習記録');
  await page.locator('summary').filter({ hasText: /学習データを管理/ }).click();
  await expect(page.getByText(/現在ログインしている本人/).first()).toBeVisible();
  await expect(page.getByText(/バックアップ/).first()).toBeVisible();
  await expect(page.getByText(/アカウント削除やログアウトは行いません/)).toBeVisible();
  await page.getByRole('button', { name: '学習データの削除を確認する', exact: true }).click();
  const confirmation = page.getByRole('region', { name: '学習データ削除の最終確認' });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.getByRole('button', { name: '確認した学習データを削除する' })).toBeDisabled();
  expect(deletes).toBe(0);
  await confirmation.getByRole('checkbox', { name: '対象と、元に戻せないことを確認しました' }).check();
  await confirmation.getByRole('button', { name: '確認した学習データを削除する' }).click();
  await expect.poll(() => deletes).toBe(1);
  await expect(page.getByRole('heading', { name: '学習データを削除しました' })).toBeVisible();
  await expectLocalPointerUntouched(page);
  expect(unexpected).toEqual([]);
});

test('説明保存の認証切れで入力を残し、別タブログインを案内する（合成UI通信mock）', async ({ page }) => {
  await auditLocalPointer(page);
  const view: CafeView = { id: 'ui-only-online-case', caseVersion: CAFE_CASE_VERSION,
    status: 'active', phase: 'teach_back', revision: 1, progressRevision: 1,
    savedAt: '2026-09-08T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
    optionId: 'h4r9', explanation: '', attemptId: 'ui-only-attempt', confidence: null, confidenceFixed: true,
    prompt: cafePrompt(), result: gradeCafeChoice(CAFE_CASE_VERSION, 'h4r9') };
  let failedSaves = 0;
  const unexpected = await mockOnline(page, async (route, path) => {
    if (path === '/api/history') {
      await route.fulfill({ json: { developmentOnly: false, drafts: [], items: [{ caseId: view.id, caseVersion: view.caseVersion,
        submittedAt: view.savedAt, status: view.status, phase: view.phase, confidenceFixed: true, correct: true, evidenceQualification: 'practice_only' }] } });
      return true;
    }
    if (path !== '/api/cafe') return false;
    if (route.request().method() === 'GET') await route.fulfill({ json: { session: view } });
    else {
      expect(route.request().postDataJSON().action).toBe('progress');
      failedSaves++;
      await route.fulfill({ status: 401, json: { error: 'AUTH_REQUIRED' } });
    }
    return true;
  });
  await enterOnline(page);
  await openView(page, '学習記録');
  await page.getByRole('button', { name: 'この記録から再開', exact: true }).click();
  const input = page.getByLabel('相談者への説明（任意・2,000文字まで）');
  const explanation = 'これはUIテスト用の手元の説明です。再ログインのために消えてはいけません。';
  await input.fill(explanation);
  await page.getByRole('button', { name: '下書きを保存', exact: true }).click();
  await expect(page.getByRole('alert', { name: '保存エラー' })).toContainText(/ログイン/);
  await expect(input).toHaveValue(explanation);
  const login = page.getByRole('link', { name: '入力を残して別タブでログイン', exact: true });
  await expect(login).toHaveAttribute('href', '/login');
  await expect(login).toHaveAttribute('target', '_blank');
  await expect(login).toHaveAttribute('rel', /noopener/);
  // Advance beyond autosave debounce; authentication errors must not create a retry loop.
  await page.waitForTimeout(1500);
  expect(failedSaves).toBe(1);
  await expect(input).toHaveValue(explanation);
  await expectLocalPointerUntouched(page);
  expect(unexpected).toEqual([]);
});

test('別タブでAliceからBobへ切り替わった削除409は成功と扱わない（UI通信mock）', async ({ page }) => {
  await auditLocalPointer(page);
  let deletes = 0;
  const unexpected = await mockOnline(page, async (route, path) => {
    if (path !== '/api/data') return false;
    // The transport stands in for a verified Bob session. The stale UI must keep Alice's
    // expected learner header; only the real server can prove the identity mismatch.
    expect(route.request().headers()['x-zeirishi-learner']).toBe(learnerId);
    expect(route.request().method()).toBe('POST');
    deletes++;
    await route.fulfill({ status: 409, json: { error: 'AUTH_IDENTITY_CHANGED' } });
    return true;
  });
  await enterOnline(page);
  await openView(page, '学習記録');
  await page.locator('summary').filter({ hasText: /学習データを管理/ }).click();
  await page.getByRole('button', { name: '学習データの削除を確認する', exact: true }).click();
  await page.getByRole('checkbox', { name: '対象と、元に戻せないことを確認しました' }).check();
  await page.getByRole('button', { name: '確認した学習データを削除する', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '削除の完了を確認できませんでした' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '学習データを削除しました' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: '入力を残して別タブでログイン', exact: true })).toHaveAttribute('target', '_blank');
  expect(deletes).toBe(1);
  await expectLocalPointerUntouched(page);
  expect(unexpected).toEqual([]);
});

for (const refusal of [
  { code: 'AUTH_REQUIRED', status: 401, message: 'ログイン状態または招待の有効性を確認できません。' },
  { code: 'MATERIAL_NOT_AVAILABLE', status: 503, message: 'この相談教材はまだ提供準備中です。' },
]) {
  test(`オンライン未提出一覧の再開で${refusal.code}なら新規相談を自動作成しない（UI通信mock）`, async ({ page }) => {
    await auditLocalPointer(page);
    const caseId = 'ui-only-unsubmitted-case';
    let reads = 0;
    let writes = 0;
    const unexpected = await mockOnline(page, async (route, path) => {
      if (path === '/api/history') {
        await route.fulfill({ json: { items: [], developmentOnly: false, drafts: [{
          caseId, caseVersion: 'ui-only-draft-v1', phase: 'decision',
          savedAt: '2026-09-08T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
        }] } });
        return true;
      }
      if (path !== '/api/cafe') return false;
      if (route.request().method() === 'GET') {
        reads++;
        expect(new URL(route.request().url()).searchParams.get('caseId')).toBe(caseId);
      } else writes++;
      await route.fulfill({ status: refusal.status, json: { error: refusal.code } });
      return true;
    });
    await enterOnline(page);
    await openView(page, '学習記録');
    await expect(page.getByRole('heading', { name: '回答前の相談', exact: true })).toBeVisible();
    await expect(page.getByText('判断の途中', { exact: false })).toBeVisible();
    expect(reads).toBe(0);
    await page.getByRole('button', { name: 'この相談を再開', exact: true }).click();
    await expect(page.getByRole('alert', { name: '保存エラー' })).toContainText(refusal.message);
    await expect(page.getByRole('heading', { name: '学習記録', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: 'この相談で学ぶ →', exact: true })).toHaveCount(0);
    // No automatic retries or fallback starts after a refused resume.
    await page.waitForTimeout(1500);
    expect(reads).toBe(1);
    expect(writes).toBe(0);
    await expectLocalPointerUntouched(page);
    expect(unexpected).toEqual([]);
  });
}

test('保険料以外の架空教材を表示し、教材注記は自信固定後だけ開示する（UI通信mock）', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  // Entirely fictional UI transport data. No real material review or publication is asserted.
  const caseId = 'ui-only-sales-return';
  const version = 'ui-only-sales-return-v1';
  const checkpoints = ['返品された売上を取り消す', '入金の処理と区別する'];
  const exception = 'テスト専用注記：返品時期が異なる場合は追加確認が必要です。';
  const examTranslation = 'テスト専用対応：返品による売上取消しを仕訳の判断につなげます。';
  const result = { ...gradeCafeChoice(CAFE_CASE_VERSION, 'h4r9'), caseVersion: version,
    scoringVersion: 'ui-only-return-score', optionId: 'return-sales', developmentOnly: false,
    explanation: '返品の事実を確認し、売上の取消しと入金の処理を区別します。',
    periods: [], misconceptionCandidate: null,
    teachBack: '店長の田中さんに返品の処理を自分の言葉で説明してください。',
    followUp: '代金をまだ受け取っていない場合はどうなりますか？',
    checkpoints, learningNotes: { exceptions: [exception], examTranslation },
  };
  let view: CafeView = { id: caseId, caseVersion: version, status: 'active', phase: 'consultation',
    revision: 0, progressRevision: 0, savedAt: null, expiresAt: '2099-01-01T00:00:00.000Z',
    optionId: null, explanation: '', attemptId: null, confidence: null, confidenceFixed: false, result: null,
    prompt: { caseId, caseVersion: version, conceptId: 'sales-return', familyId: 'ui-return-family',
      developmentOnly: false, title: '売上返品', consultationTitle: '返品された商品の帳簿を直したい',
      context: '雑貨店の田中さんが、返品された商品の記録を確認しています。',
      consultation: '売った商品が返品されました。売上の記録をどう直すべきでしょうか？',
      task: '返品の記録として適切な処理を選んでください。',
      facts: [{ label: '返品商品', value: '雑貨1点' }], assumption: '返品の事実が確認済みの架空練習です。',
      options: [{ id: 'return-sales', label: '売上を取り消す' }, { id: 'keep-sales', label: '売上を残す' },
        { id: 'new-sales', label: '売上を増やす' }, { id: 'ignore', label: '記録しない' }] },
  };
  let releaseConfidence!: () => void;
  let confidenceRequested!: () => void;
  const confidenceGate = new Promise<void>(resolve => { releaseConfidence = resolve; });
  const confidenceStarted = new Promise<void>(resolve => { confidenceRequested = resolve; });
  const unexpected = await mockOnline(page, async (route, path) => {
    if (path === '/api/history') {
      await route.fulfill({ json: { items: [], developmentOnly: false, drafts: [{
        caseId, caseVersion: version, phase: 'consultation', savedAt: null, expiresAt: view.expiresAt,
      }] } }); return true;
    }
    if (path !== '/api/cafe') return false;
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      expect(body.caseId).toBe(caseId);
      if (body.action === 'save') view = { ...view, phase: body.phase, optionId: body.optionId, revision: view.revision + 1 };
      else if (body.action === 'submit') view = { ...view, phase: 'confidence', attemptId: 'ui-only-return-attempt' };
      else if (body.action === 'confidence') {
        expect(body.confidence).toBe(null);
        confidenceRequested();
        await confidenceGate;
        view = { ...view, phase: 'feedback', confidenceFixed: true, result };
      }
      else if (body.action === 'progress') view = { ...view, phase: body.phase, explanation: body.explanation, progressRevision: view.progressRevision + 1 };
      else throw new Error('Unexpected mock action: ' + body.action);
    }
    await route.fulfill({ json: { session: view } });
    return true;
  });
  const noInsuranceText = async () => {
    await expect(page.locator('main')).not.toContainText(/佐藤|前払費用|当期4か月|翌期8か月|この3つ|いつのサービスか|保険の12か月/);
  };
  await enterOnline(page);
  await page.getByRole('button', { name: '続きから再開', exact: true }).click();
  await expect(page.getByRole('heading', { name: '売上返品', exact: true })).toBeVisible();
  await expect(page.getByText(view.prompt.context, { exact: true })).toBeVisible();
  await noInsuranceText();
  await page.getByRole('button', { name: '資料を見て判断する →', exact: true }).click();
  await expect(page.getByText(view.prompt.task, { exact: true })).toBeVisible();
  await expect(page.getByText(exception, { exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: '売上を取り消す', exact: true }).check();
  await page.getByRole('button', { name: 'この回答で進む →', exact: true }).click();
  await confidenceStarted;
  try {
    await expect(page.getByText(exception, { exact: true })).toHaveCount(0);
    await expect(page.getByText(examTranslation, { exact: true })).toHaveCount(0);
    await expect(page.getByText(result.explanation, { exact: true })).toHaveCount(0);
    await noInsuranceText();
  } finally { releaseConfidence(); }
  await expect(page.getByText(result.explanation, { exact: true })).toBeVisible();
  await expect(page.getByText(exception, { exact: true })).toBeVisible();
  await expect(page.getByText(examTranslation, { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/zeirishi-generic-feedback-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/zeirishi-generic-feedback-mobile.png', fullPage: true });
  await noInsuranceText();
  await page.getByRole('button', { name: '自分の言葉で説明してみる →', exact: true }).click();
  await expect(page.getByText(result.teachBack, { exact: true })).toBeVisible();
  await expect(page.getByLabel('相談者への説明（任意・2,000文字まで）')).toBeVisible();
  await page.getByRole('button', { name: '相談者からの追加質問を見る', exact: true }).click();
  await expect(page.getByText(result.followUp, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存して振り返る →', exact: true }).click();
  for (const checkpoint of checkpoints) await expect(page.getByText(checkpoint, { exact: true })).toBeVisible();
  await noInsuranceText();
  expect(unexpected).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('2番目の教材を選択して再試行しても概念とrequestIdが保持され、別教材も選び直せる（架空UI通信mock）', async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    // A single deliberate 503 transport response is expected; all other console errors fail.
    if (message.type() === 'error' && !/Failed to load resource.*503/.test(message.text())) consoleErrors.push(message.text());
  });
  const concepts = [
    { subjectId: 'bookkeeping', conceptId: 'ui-first-concept', conceptVersion: 'ui-first-v1', label: '架空の売上返品',
      importance: 3, durationMinutes: 8, unseenQuestionCount: 0 },
    { subjectId: 'bookkeeping', conceptId: 'ui-second-concept', conceptVersion: 'ui-second-v1', label: '架空の売掛金',
      importance: 3, durationMinutes: 9, unseenQuestionCount: 0 },
  ];
  const expectedConcept = (index: number) => ({ subjectId: concepts[index].subjectId,
    conceptId: concepts[index].conceptId, conceptVersion: concepts[index].conceptVersion });
  const starts: Array<{ requestId: string; concept: unknown }> = [];
  const unexpected = await mockOnline(page, async (route, path) => {
    if (path === '/api/profile') {
      await route.fulfill({ json: { ...emptyCatalog(), concepts,
        materialChoices: concepts.map((concept, index) => ({ ...concept, materialId: 'ui-only-material-' + index, caseVersion: concept.conceptVersion })),
        subjects: SUBJECTS.map(subject => ({ ...subject, available: subject.id === 'bookkeeping' })) } });
      return true;
    }
    if (path !== '/api/cafe') return false;
    expect(route.request().method()).toBe('POST');
    const body = route.request().postDataJSON();
    expect(body.action).toBe('start');
    starts.push({ requestId: body.requestId, concept: body.concept });
    if (starts.length === 1) {
      await route.fulfill({ status: 503, json: { error: 'INTERNAL_ERROR' } });
      return true;
    }
    const index = concepts.findIndex(concept => concept.conceptId === body.concept?.conceptId);
    expect(index).toBeGreaterThanOrEqual(0);
    const concept = concepts[index];
    const view: CafeView = { id: 'ui-only-case-' + index, caseVersion: concept.conceptVersion, status: 'active',
      phase: 'consultation', revision: 0, progressRevision: 0, savedAt: null, expiresAt: '2099-01-01T00:00:00.000Z',
      optionId: null, explanation: '', attemptId: null, confidence: null, confidenceFixed: false, result: null,
      prompt: { ...cafePrompt(), caseId: 'ui-only-material-' + index, caseVersion: concept.conceptVersion,
        conceptId: concept.conceptId, title: concept.label, consultationTitle: concept.label + 'の相談',
        context: '架空のUIテスト用相談です。', consultation: '教材選択が正しく引き継がれるか確認します。' } };
    await route.fulfill({ json: { session: view } });
    return true;
  });
  await enterOnline(page);
  await openView(page, '学習地図');
  await expect(page.getByRole('button', { name: 'この相談で学ぶ →', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'この相談で学ぶ →', exact: true }).nth(1).click();
  await expect(page.getByRole('alert', { name: '保存エラー' })).toBeVisible();
  expect(starts).toHaveLength(1);
  expect(starts[0].concept).toEqual(expectedConcept(1));
  expect(starts[0].requestId).toMatch(/^[0-9a-f-]{36}$/i);
  await page.getByRole('button', { name: '同じ操作を再試行', exact: true }).click();
  await expect(page.getByRole('heading', { name: concepts[1].label, exact: true })).toBeVisible();
  expect(starts).toHaveLength(2);
  expect(starts[1]).toEqual(starts[0]);
  await page.getByRole('button', { name: '← 学習地図へ', exact: true }).click();
  await page.getByRole('button', { name: 'この相談で学ぶ →', exact: true }).nth(0).click();
  await expect(page.getByRole('heading', { name: concepts[0].label, exact: true })).toBeVisible();
  expect(starts).toHaveLength(3);
  expect(starts[2].concept).toEqual(expectedConcept(0));
  expect(starts[2].requestId).not.toBe(starts[0].requestId);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/zeirishi-multi-material-mobile.png', fullPage: true });
  expect(unexpected).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test('オンラインのホームは保存中の相談を本文を読まずに示し、続きから再開で本人の相談を開く（UI通信mock）', async ({ page }) => {
  await auditLocalPointer(page);
  const draftId = 'ui-only-home-resume-draft';
  const view: CafeView = { id: draftId, caseVersion: CAFE_CASE_VERSION, status: 'active', phase: 'decision',
    revision: 2, progressRevision: 0, savedAt: '2026-09-20T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z',
    optionId: 'h4r9', explanation: '', attemptId: null, confidence: null, confidenceFixed: false, prompt: cafePrompt(), result: null };
  const reads: string[] = [];
  const unexpected = await mockOnline(page, async (route, path) => {
    if (path === '/api/history') {
      // An older submitted case and a newer unsubmitted draft: home offers only the most recent one.
      await route.fulfill({ json: { developmentOnly: false,
        items: [{ caseId: 'ui-only-older-submitted', caseVersion: CAFE_CASE_VERSION, submittedAt: '2026-09-10T00:00:00.000Z',
          status: 'active', phase: 'teach_back', confidenceFixed: true, correct: true, evidenceQualification: 'practice_only' }],
        drafts: [{ caseId: draftId, caseVersion: CAFE_CASE_VERSION, phase: 'decision', savedAt: view.savedAt, expiresAt: view.expiresAt }] } });
      return true;
    }
    if (path !== '/api/cafe') return false;
    expect(route.request().method()).toBe('GET');
    reads.push(new URL(route.request().url()).searchParams.get('caseId') ?? '');
    await route.fulfill({ json: { session: view } });
    return true;
  });
  await enterOnline(page);
  const resume = page.getByRole('button', { name: '続きから再開', exact: true });
  await expect(resume).toBeVisible();
  await expect(page.getByText('保存中の相談ケース · 判断する', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '簿記の全体像を見る →', exact: true })).toHaveCount(0);
  // The card comes from the history projection; the case body is read only after the explicit action.
  await page.waitForLoadState('networkidle');
  expect(reads).toEqual([]);
  await resume.click();
  await expect(page.getByRole('heading', { name: view.prompt.title, exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: '40,000円', exact: true })).toBeChecked();
  await expect(page.getByRole('heading', { name: '判断の理由を理解する' })).toHaveCount(0);
  expect(reads).toEqual([draftId]);
  await expectLocalPointerUntouched(page);
  expect(unexpected).toEqual([]);
});

test('オンラインの保存中相談を確認できなくても相談を自動作成せず、記録からの再開を案内する（UI通信mock）', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(new URL(request.url()).pathname); });
  const unexpected = await mockOnline(page, async (route, path) => {
    if (path !== '/api/history') return false;
    await route.fulfill({ status: 503, json: { error: 'UNAVAILABLE' } });
    return true;
  });
  await enterOnline(page);
  await expect(page.getByRole('button', { name: '続きから再開', exact: true })).toHaveCount(0);
  await expect(page.getByText('保存中の相談を確認できませんでした。', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '簿記の全体像を見る →', exact: true })).toBeEnabled();
  await expect(page.getByRole('alert', { name: '保存エラー' })).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(unexpected).toEqual([]);
});

test('オンラインのホームは戻るたびに履歴を読み直し、終わった相談を続きとして出さない（UI通信mock）', async ({ page }) => {
  let historyReads = 0;
  const unexpected = await mockOnline(page, async (route, path) => {
    if (path !== '/api/history') return false;
    historyReads++;
    // First visit: one draft. Later visits: the draft was finished elsewhere.
    await route.fulfill({ json: { developmentOnly: false, items: [], drafts: historyReads === 1 ? [{
      caseId: 'ui-only-finished-elsewhere', caseVersion: CAFE_CASE_VERSION, phase: 'decision',
      savedAt: '2026-09-20T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z' }] : [] } });
    return true;
  });
  await enterOnline(page);
  await expect(page.getByRole('button', { name: '続きから再開', exact: true })).toBeVisible();
  await openView(page, '学習地図');
  await page.getByRole('navigation', { name: '学習ナビゲーション' }).getByRole('button', { name: 'ホーム', exact: true }).click();
  await expect(page.getByRole('button', { name: '簿記の全体像を見る →', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '続きから再開', exact: true })).toHaveCount(0);
  expect(historyReads).toBe(2);
  expect(unexpected).toEqual([]);
});
