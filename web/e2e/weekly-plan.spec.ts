import { test, expect } from '@playwright/test';

test('週計画は未回答を区別し、予定科目から計画・除外・再読込・開始できる', async ({ page }) => {
  await page.goto('/#records');
  await expect(page.getByRole('heading', { name: '学習記録', level: 1 })).toBeVisible();
  await page.getByText('今週の学習計画', { exact: true }).click();
  await expect(page.getByText('今週の計画はまだ作成していません。')).toBeVisible();
  await page.getByLabel('今週の学習時間（分）').fill('30');
  await page.getByRole('button', { name: '今週の計画を作る', exact: true }).click();
  await expect(page.getByText('受験予定が未回答です。', { exact: false })).toBeVisible();
  await page.getByText('受験予定の科目（任意・複数選択）', { exact: false }).click();
  const examSubject = page.getByRole('group', { name: '受験予定の科目を選択', exact: true }).getByRole('checkbox', { name: '簿記論', exact: true });
  await examSubject.click();
  await expect(examSubject).toBeChecked();
  await expect(page.getByText('受験予定・自信・教材などの条件が変わっています。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '今の条件で再計画する', exact: true }).click();
  await expect(page.getByRole('region', { name: '保存済みの週計画' }).getByRole('button', { name: 'この計画の相談を始める' })).toBeVisible();
  await page.screenshot({ path: '/tmp/zeirishi-weekly-plan-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/zeirishi-weekly-plan-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('group', { name: '今週は外す教材（任意）' }).getByRole('checkbox').check();
  await page.getByLabel('計画を調整する理由（除外時は必須・500文字まで）').fill('今週は別の教材で復習するため');
  await page.getByRole('button', { name: '今の条件で再計画する' }).click();
  await expect(page.getByRole('button', { name: 'この計画の相談を始める' })).toHaveCount(0);
  await page.reload();
  await page.getByText('今週の学習計画', { exact: true }).click();
  await expect(page.getByLabel('今週の学習時間（分）')).toHaveValue('30');
  await expect(page.getByLabel('計画を調整する理由（除外時は必須・500文字まで）')).toHaveValue('今週は別の教材で復習するため');
  await page.getByRole('group', { name: '今週は外す教材（任意）' }).getByRole('checkbox').uncheck();
  await page.getByRole('button', { name: '今の条件で再計画する' }).click();
  await page.getByRole('button', { name: 'この計画の相談を始める' }).click();
  await expect(page.getByRole('heading', { name: 'カフェの年間保険料をどう処理する？' })).toBeVisible();
});

test('週計画の通信失敗は入力と同一要求を保持して再試行する', async ({ page }) => {
  await page.goto('/#records');
  await expect(page.getByRole('heading', { name: '学習記録', level: 1 })).toBeVisible();
  await page.getByText('今週の学習計画', { exact: true }).click();
  await expect(page.getByLabel('今週の学習時間（分）')).toBeVisible();
  const ids: string[] = [];
  await page.route('**/api/plan', route => {
    if (route.request().method() !== 'POST') return route.continue();
    ids.push(route.request().postDataJSON().requestId);
    return ids.length === 1 ? route.abort() : route.continue();
  });
  await page.getByLabel('今週の学習時間（分）').fill('45');
  await page.getByRole('button', { name: '今週の計画を作る' }).click();
  await expect(page.getByRole('alert').filter({ hasText: '入力は保持しています' })).toBeVisible();
  await expect(page.getByLabel('今週の学習時間（分）')).toHaveValue('45');
  await expect(page.getByLabel('今週の学習時間（分）')).toBeDisabled();
  await page.getByRole('button', { name: '同じ計画操作を再試行' }).click();
  await expect(page.getByRole('region', { name: '保存済みの週計画' })).toBeVisible();
  expect(ids).toHaveLength(2); expect(ids[0]).toBe(ids[1]);
});

test('説明できる単元は週計画で強制せず直接学習は残る', async ({ page }) => {
  await page.goto('/#records');
  await expect(page.getByRole('heading', { name: '学習記録', level: 1 })).toBeVisible();
  const profile = await (await page.request.get('/api/profile')).json();
  const concept = profile.concepts[0];
  const saved = await page.request.post('/api/profile', { headers: { origin: 'http://127.0.0.1:3210' }, data: {
    requestId: crypto.randomUUID(), revision: profile.profile.revision, examSubjects: ['bookkeeping'],
    reports: [{ subjectId: concept.subjectId, conceptId: concept.conceptId, conceptVersion: concept.conceptVersion, selfConfidence: 'explained' }],
  } });
  expect(saved.ok()).toBe(true);
  await page.reload();
  await page.getByText('今週の学習計画', { exact: true }).click();
  await expect(page.getByText('「説明できる」と回答した単元は計画から自動で省略します。', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '今週の計画を作る' }).click();
  await expect(page.getByRole('region', { name: '保存済みの週計画' })).toContainText('予定 0分');
  await expect(page.getByRole('button', { name: 'この計画の相談を始める' })).toHaveCount(0);
  await page.getByRole('navigation', { name: '学習ナビゲーション' }).getByRole('button', { name: '学習地図' }).click();
  await expect(page.getByRole('button', { name: 'この相談で学ぶ →', exact: true })).toBeEnabled();
});

test('週計画の未保存入力は画面移動と履歴往復で保持し、再読込を警告する', async ({ page }) => {
  await page.goto('/#records');
  await page.getByText('今週の学習計画', { exact: true }).click();
  const minutes = page.getByLabel('今週の学習時間（分）');
  const reason = page.getByLabel('計画を調整する理由（除外時は必須・500文字まで）');
  await minutes.fill('45');
  await reason.fill('今週は復習を優先します');
  const nav = page.getByRole('navigation', { name: '学習ナビゲーション' });
  await nav.getByRole('button', { name: 'ホーム', exact: true }).click();
  await expect(minutes).toBeHidden();
  expect(await page.evaluate(() => !window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  await page.goBack();
  await expect(minutes).toHaveValue('45');
  await expect(reason).toHaveValue('今週は復習を優先します');
  await page.goForward();
  await nav.getByRole('button', { name: '学習記録', exact: true }).click();
  await expect(minutes).toHaveValue('45');
  await expect(reason).toHaveValue('今週は復習を優先します');
  const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/plan' && response.request().method() === 'POST');
  await page.getByRole('button', { name: '今週の計画を作る', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByRole('button', { name: '今の条件で再計画する', exact: true })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
  await page.reload();
  await page.getByText('今週の学習計画', { exact: true }).click();
  await expect(minutes).toHaveValue('45');
  await expect(reason).toHaveValue('今週は復習を優先します');
});
