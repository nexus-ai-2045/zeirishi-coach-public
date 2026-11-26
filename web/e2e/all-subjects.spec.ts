import { expect, test, type Page } from '@playwright/test';
import { SUBJECTS } from '../src/domain/onboarding';
import { topicConcepts, type SubjectMapPack } from '../src/domain/subject-map';

const origin = 'http://127.0.0.1:3210';
type Choice = { subjectId: string; conceptId: string; conceptVersion: string; materialId: string; caseVersion: string; label: string };

async function openSubject(page: Page, label: string) {
  await page.goto('/#map');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  const button = page.getByRole('navigation', { name: '科目', exact: true }).getByRole('button', { name: new RegExp(label) });
  if (await button.getAttribute('aria-current') === 'page') return;
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/profile' && response.request().method() === 'GET');
  await page.getByRole('navigation', { name: '科目', exact: true }).getByRole('button', { name: new RegExp(label) }).click();
  await loaded;
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}

for (const subject of SUBJECTS) test(`${subject.label}：地図の見出し・★頻出の確認問題・解説1回・再読み込み`, async ({ page }) => {
  test.setTimeout(60000);
  await openSubject(page, subject.label);

  await expect(page.getByRole('list', { name: `${subject.label}の全体ツリー` })).toBeVisible();
  await expect(page.locator('[data-tree-root]')).toHaveText(subject.label);
  await expect(page.getByLabel(/ブレインマップ/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'これまでの地図' })).toHaveCount(0);

  const profile = await (await page.request.get(`/api/profile?subjectId=${subject.id}`)).json() as { subjectMap: SubjectMapPack; materialChoices: Choice[] };
  const frequent = profile.subjectMap.topics.filter(topic => topic.frequency === 'high');
  const pool = frequent.length ? frequent : profile.subjectMap.topics;
  const choice = pool.flatMap(topic => topicConcepts(profile.subjectMap, topic.topicId))
    .map(concept => profile.materialChoices.find(item => item.conceptId === concept.conceptId && item.conceptVersion === concept.conceptVersion))
    .find((item): item is Choice => item !== undefined);
  expect(choice, `${subject.label}の★頻出に確認問題がある`).toBeDefined();
  const created = await page.request.post('/api/cafe', { headers: { Origin: origin }, data: { action: 'start', requestId: crypto.randomUUID(),
    concept: { subjectId: choice!.subjectId, conceptId: choice!.conceptId, conceptVersion: choice!.conceptVersion }, materialId: choice!.materialId, caseVersion: choice!.caseVersion } });
  expect(created.status()).toBe(200);
  const { session } = await created.json();

  await page.goto(`/#case/${session.id}`);
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText(`${subject.label} · 相談ケース`)).toBeVisible();

  const toDecision = page.getByRole('button', { name: '資料を見て判断する →' });
  if (await toDecision.count()) await toDecision.click();
  await page.getByRole('radio').first().check();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await page.getByRole('button', { name: 'この回答で進む →' }).click();
  const skip = page.getByRole('button', { name: /選ばずに解説を見る/ });
  await expect(page.getByRole('heading', { name: '判断の理由を理解する' }).or(skip).first()).toBeVisible();
  if (await skip.count()) await skip.click();
  await expect(page.getByRole('heading', { name: '判断の理由を理解する' })).toBeVisible();

  const saved = await (await page.request.get(`/api/cafe?caseId=${encodeURIComponent(session.id)}`)).json();
  const explanation: string = saved.session.result.explanation;
  expect(explanation.length).toBeGreaterThan(10);
  const text = await page.locator('main').innerText();
  expect(text.split(explanation).length - 1, '解説の重複表示がない').toBe(1);

  await page.reload();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByText(`${subject.label} · 相談ケース`)).toBeVisible();
  await page.getByRole('button', { name: '← 学習地図へ' }).first().click();
  await expect(page.getByRole('heading', { name: '学習地図' })).toBeVisible();
  await expect(page.getByRole('list', { name: `${subject.label}の全体ツリー` })).toBeVisible();

  if (subject.id !== 'bookkeeping') {
    await page.getByRole('navigation', { name: '科目', exact: true }).getByRole('button', { name: /簿記論/ }).click();
    await expect(page.getByRole('list', { name: '簿記論の全体ツリー' })).toBeVisible();
    await page.getByRole('button', { name: '学習記録', exact: true }).first().click();
    await page.getByRole('button', { name: /この記録を開く|この記録から再開|この相談を再開/ }).first().click();
    await expect(page.getByText(`${subject.label} · 相談ケース`)).toBeVisible();

    await page.getByRole('button', { name: '← 学習地図へ' }).first().click();
    await page.getByRole('navigation', { name: '科目', exact: true }).getByRole('button', { name: /簿記論/ }).click();
    await expect(page.getByRole('list', { name: '簿記論の全体ツリー' })).toBeVisible();
    await page.getByRole('button', { name: 'ホーム', exact: true }).first().click();
    await page.getByRole('button', { name: '続きから再開' }).click();
    await expect(page.getByText(`${subject.label} · 相談ケース`)).toBeVisible();
  }
});

test('簿記論の問題演習の問題も、別の科目から学習記録で開くと簿記論に戻る', async ({ page }) => {
  test.setTimeout(60000);
  await openSubject(page, '簿記論');
  const profile = await (await page.request.get('/api/profile?subjectId=bookkeeping')).json() as { subjectMap: SubjectMapPack; materialChoices: Choice[] };
  const listed = new Set(profile.materialChoices.map(item => item.materialId));
  const link = profile.subjectMap.links.find(item => item.kind === 'uses-case' && !listed.has(item.targetId));
  expect(link, '選択肢に出ない問題演習の問題がある').toBeDefined();
  const concept = profile.subjectMap.concepts.find(item => item.conceptId === link!.sourceId && item.conceptVersion === link!.sourceVersion)!;
  const created = await page.request.post('/api/cafe', { headers: { Origin: origin }, data: { action: 'start', requestId: crypto.randomUUID(),
    concept: { subjectId: 'bookkeeping', conceptId: concept.conceptId, conceptVersion: concept.conceptVersion }, materialId: link!.targetId, caseVersion: link!.targetVersion } });
  expect(created.status()).toBe(200);
  await openSubject(page, '固定資産税');
  await page.getByRole('button', { name: '学習記録', exact: true }).first().click();
  await page.getByRole('button', { name: /この記録を開く|この記録から再開|この相談を再開/ }).first().click();
  await expect(page.getByText('簿記論 · 相談ケース')).toBeVisible();
});

test('問題の科目を探している間に別の科目を選んでも、選んだ科目のまま', async ({ page }) => {
  test.setTimeout(60000);
  await openSubject(page, '簿記論');
  const profile = await (await page.request.get('/api/profile?subjectId=bookkeeping')).json() as { materialChoices: Choice[] };
  const choice = profile.materialChoices[0];
  const created = await page.request.post('/api/cafe', { headers: { Origin: origin }, data: { action: 'start', requestId: crypto.randomUUID(),
    concept: { subjectId: 'bookkeeping', conceptId: choice.conceptId, conceptVersion: choice.conceptVersion }, materialId: choice.materialId, caseVersion: choice.caseVersion } });
  expect(created.status()).toBe(200);
  await openSubject(page, '固定資産税');
  await page.route(url => url.pathname === '/api/profile' && url.searchParams.get('subjectId') === 'bookkeeping',
    async route => { await new Promise(resolve => setTimeout(resolve, 4000)); await route.continue().catch(() => undefined); });
  await page.getByRole('button', { name: '学習記録', exact: true }).first().click();
  await page.getByRole('button', { name: /この記録を開く|この記録から再開|この相談を再開/ }).first().click();
  await page.getByRole('button', { name: '← 学習地図へ' }).first().click();
  await page.getByRole('navigation', { name: '科目', exact: true }).getByRole('button', { name: /酒税法/ }).click();
  await expect(page.getByRole('list', { name: '酒税法の全体ツリー' })).toBeVisible();
  await page.waitForTimeout(6000);
  await expect(page.getByRole('list', { name: '酒税法の全体ツリー' })).toBeVisible();
});

test('確認問題の正誤で論点・分野・科目の色が変わり、翌日から復習カードで「覚えた」まで進められる', async ({ page }) => {
  test.setTimeout(90000);
  await openSubject(page, '所得税法');
  const profile = await (await page.request.get('/api/profile?subjectId=income-tax')).json() as { subjectMap: SubjectMapPack; materialChoices: Choice[] };
  const topic = profile.subjectMap.topics.find(item => topicConcepts(profile.subjectMap, item.topicId)
    .some(concept => profile.materialChoices.some(choice => choice.conceptId === concept.conceptId)))!;
  const concept = topicConcepts(profile.subjectMap, topic.topicId)[0];
  const choice = profile.materialChoices.find(item => item.conceptId === concept.conceptId)!;
  const unit = profile.subjectMap.units.find(item => item.unitId === topic.unitId)!;
  const tree = page.getByRole('list', { name: '所得税法の全体ツリー' });
  const reopen = async () => { await page.reload(); await openSubject(page, '所得税法'); };
  await expect(tree.getByRole('button', { name: `${topic.label}（まだ）` })).toBeVisible();

  async function solve(correct: boolean) {
    const created = await page.request.post('/api/cafe', { headers: { Origin: origin }, data: { action: 'start', requestId: crypto.randomUUID(),
      concept: { subjectId: choice.subjectId, conceptId: choice.conceptId, conceptVersion: choice.conceptVersion }, materialId: choice.materialId, caseVersion: choice.caseVersion } });
    const { session } = await created.json();
    const sample = (await import('../src/server/subject-samples.json', { with: { type: 'json' } })).default.items.find((item: { title: string }) => item.title === session.prompt.title)!;
    const option = session.prompt.options.find((item: { label: string }) => (item.label === sample.answer) === correct);
    for (const data of [{ action: 'submit', optionId: option.id }, { action: 'confidence', confidence: 'normal' }]) {
      const response = await page.request.post('/api/cafe', { headers: { Origin: origin }, data: { ...data, requestId: crypto.randomUUID(), caseId: session.id } });
      expect(response.status()).toBe(200);
    }
  }
  await solve(false);
  await reopen();
  await expect(tree.getByRole('button', { name: `${topic.label}（もう一度）` })).toBeVisible();
  await solve(true);
  await reopen();
  const understood = tree.getByRole('button', { name: `${topic.label}（理解した）` });
  await expect(understood).toBeVisible();
  await expect(understood.locator('[data-stage="understood"]').first()).toHaveCSS('background-color', 'rgb(47, 111, 179)');
  await expect(tree.locator(`[title^="${unit.label}："]`)).toHaveAttribute('title', /理解した1/);
  await expect(page.locator('[aria-label="この科目の進み具合"]')).toContainText('理解した 1（うち覚えた 0）');
  const cards = page.getByRole('region', { name: '今日の復習カード' });
  await expect(cards).toContainText('今日の復習カードはありません');
  await understood.click();
  await expect(page.getByRole('complementary', { name: '選んだ論点の説明' })).toContainText('いまの復習：0 / 3回');

  let now = Date.now();
  const checkedAt: string[] = [];
  await page.route('**/api/practice-progress', async route => {
    if (route.request().method() === 'POST') { checkedAt.push(new Date(now).toISOString()); return route.continue(); }
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, checks: body.checks.map((check: object, index: number) => ({ ...check, checkedAt: checkedAt[index] ?? (check as { checkedAt: string }).checkedAt })) } });
  });
  for (const [index, days] of [1, 3, 7].entries()) {
    now += days * 86_400_000;
    if (index === 0) await page.clock.install({ time: new Date(now) }); else await page.clock.setSystemTime(new Date(now));
    await reopen();
    await expect(cards.getByRole('heading', { name: topic.label })).toBeVisible();
    await cards.getByRole('button', { name: '裏返す' }).click();
    await expect(cards).toContainText(topic.summary);
    await cards.getByRole('button', { name: '覚えていた' }).click();
    await expect(cards).toContainText('今日の分は終わりです');
    if (index < 2) await expect(tree.getByRole('button', { name: `${topic.label}（理解した）` })).toBeVisible();
  }
  await expect(tree.getByRole('button', { name: `${topic.label}（覚えた）` })).toBeVisible();
  await expect(page.locator('[aria-label="この科目の進み具合"]')).toContainText('うち覚えた 1');

  await page.getByRole('button', { name: 'ホーム', exact: true }).first().click();
  const home = page.locator('[aria-label="いまの科目の進み具合"]');
  await expect(home.getByRole('heading', { name: '所得税法' })).toBeVisible();
  await expect(home).toContainText('理解した 1（うち覚えた 1）');
  await expect(home).toContainText('今日の復習カード：0枚');
  await home.getByRole('button', { name: '所得税法の学習地図を開く →' }).click();
  await expect(page.locator('[aria-label="この科目の進み具合"]')).toContainText('うち覚えた 1');
  await page.unrouteAll({ behavior: 'wait' });
});

test('地図を読み直しても、最後に選んだ科目のまま（別の科目の続きの相談があっても）', async ({ page }) => {
  test.setTimeout(60000);
  await openSubject(page, '簿記論');
  await page.getByRole('list', { name: '簿記論の全体ツリー' }).getByRole('button', { name: /記録・利益・期間配分の基礎/ }).click();
  await page.getByRole('button', { name: /^支払日と費用の期間は別（/ }).click();
  await page.getByRole('button', { name: '理解を問題で確かめる →' }).click();
  await expect(page.getByText('簿記論 · 相談ケース')).toBeVisible();
  await page.getByRole('button', { name: '← 学習地図へ' }).first().click();
  await openSubject(page, '酒税法');
  await expect(page.getByRole('list', { name: '酒税法の全体ツリー' })).toBeVisible();
  for (let index = 0; index < 2; index++) {
    await page.reload();
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    await expect(page.getByRole('list', { name: '酒税法の全体ツリー' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: '科目', exact: true }).getByRole('button', { name: /酒税法/ })).toHaveAttribute('aria-current', 'page');
  }
  await page.getByRole('button', { name: 'ホーム', exact: true }).first().click();
  await page.getByRole('button', { name: '続きから再開' }).click();
  await expect(page.getByText('簿記論 · 相談ケース')).toBeVisible();
});

test('消費税法：未成立の1%法案は「現行の制度」と「成立した場合（未確定）」をボタンで切り替えられる', async ({ page }) => {
  test.setTimeout(60000);
  await openSubject(page, '消費税法');
  const tree = page.getByRole('list', { name: '消費税法の全体ツリー' });
  const unit = tree.getByRole('button', { name: /基本（何に・いつ・いくらに課税）/ });
  if (await unit.getAttribute('aria-expanded') !== 'true') await unit.click();
  await tree.getByRole('button', { name: /^課税標準と税率（軽減税率）（/ }).click();
  const detail = page.getByRole('complementary', { name: '選んだ論点の説明' });
  const current = detail.getByRole('button', { name: '現行の制度' });
  const enacted = detail.getByRole('button', { name: '成立した場合（未確定）' });
  await expect(current).toHaveAttribute('aria-pressed', 'true');
  await expect(detail).toContainText('食料品や新聞は8%');
  await expect(detail).not.toContainText('2027年4月1日から2029年3月31日');
  await enacted.click();
  await expect(enacted).toHaveAttribute('aria-pressed', 'true');
  await expect(detail).toContainText('食料品は2027年4月から2年間だけ1%');
  await expect(detail).toContainText('2027年4月1日から2029年3月31日');
  await expect(detail).toContainText('まだ決まっていません');
  await tree.getByRole('button', { name: /^非課税・免税・不課税の区分（/ }).click();
  await expect(detail.getByRole('button', { name: '成立した場合（未確定）' })).toHaveCount(0);
  await tree.getByRole('button', { name: /^課税標準と税率（軽減税率）（/ }).click();
  await current.click();
  await expect(detail).toContainText('食料品や新聞は8%');
});

test('ホームで11科目のどれからでも始められ、選んだ科目が学習地図と読み直し後も続く', async ({ page }) => {
  await page.goto('/#home');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  const choose = page.getByRole('group', { name: '今日学ぶ科目を選ぶ' });
  await expect(choose.getByRole('button')).toHaveCount(SUBJECTS.length);
  const home = page.locator('[aria-label="いまの科目の進み具合"]');
  await choose.getByRole('button', { name: '酒税法', exact: true }).click();
  await expect(home.getByRole('heading', { name: '酒税法' })).toBeVisible();
  await expect(choose.getByRole('button', { name: '酒税法', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('[aria-label="いまの科目の進み具合"]').getByRole('heading', { name: '酒税法' })).toBeVisible();
  await page.getByRole('button', { name: '酒税法の学習地図を開く →' }).click();
  await expect(page.getByRole('list', { name: '酒税法の全体ツリー' })).toBeVisible();
});
