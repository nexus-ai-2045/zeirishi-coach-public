import { expect, test, type Page } from '@playwright/test';
import { SUBJECTS } from '../src/domain/onboarding';
import { topicConcepts, type SubjectMapPack } from '../src/domain/subject-map';

// 11科目それぞれで「科目を選ぶ → 地図の見出しがその科目名 → ★頻出の確認問題を解く → 解説は1回だけ → 再読み込みでも科目が保たれる」を確かめる。
const origin = 'http://127.0.0.1:3210';
type Choice = { subjectId: string; conceptId: string; conceptVersion: string; materialId: string; caseVersion: string; label: string };

async function openSubject(page: Page, label: string) {
  await page.goto('/#map');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  if (label === '簿記論') return;
  const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/profile' && response.request().method() === 'GET');
  await page.getByRole('navigation', { name: '科目', exact: true }).getByRole('button', { name: new RegExp(label) }).click();
  await loaded;
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}

for (const subject of SUBJECTS) test(`${subject.label}：地図の見出し・★頻出の確認問題・解説1回・再読み込み`, async ({ page }) => {
  test.setTimeout(60000);
  await openSubject(page, subject.label);

  // 地図の見出しが選んだ科目名になる（「これまでの地図」の根の箱も含む）。
  if (subject.id !== 'bookkeeping') {
    await expect(page.getByLabel(`${subject.label}のブレインマップ`)).toBeVisible();
    await page.getByRole('button', { name: 'これまでの地図' }).click();
  }
  await expect(page.locator('[data-tree-root]')).toHaveText(new RegExp(`^${subject.label}`));
  if (subject.id !== 'bookkeeping') await expect(page.locator('[data-tree-root]')).not.toContainText('簿記論');

  // ★頻出の論点につながる確認問題を1問選ぶ。
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

  // 問題を開くと、ページを読み直しても科目名が保たれる。
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

  // 解説は画面に1回だけ出る。
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
  if (subject.id === 'bookkeeping') await expect(page.locator('[data-tree-root]')).toHaveText(/^簿記論/);
  else await expect(page.getByLabel(`${subject.label}のブレインマップ`)).toBeVisible();

  // 別の科目に切り替えてから学習記録で開き直しても、問題の科目に戻る。
  if (subject.id !== 'bookkeeping') {
    await page.getByRole('navigation', { name: '科目', exact: true }).getByRole('button', { name: /簿記論/ }).click();
    await expect(page.getByRole('region', { name: '簿記のコア概念' })).toBeVisible();
    await page.getByRole('button', { name: '学習記録', exact: true }).first().click();
    await page.getByRole('button', { name: /この記録を開く|この記録から再開|この相談を再開/ }).first().click();
    await expect(page.getByText(`${subject.label} · 相談ケース`)).toBeVisible();

    // ホームの「続きから再開」から戻っても同じ。
    await page.getByRole('button', { name: '← 学習地図へ' }).first().click();
    await page.getByRole('navigation', { name: '科目', exact: true }).getByRole('button', { name: /簿記論/ }).click();
    await expect(page.getByRole('region', { name: '簿記のコア概念' })).toBeVisible();
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
