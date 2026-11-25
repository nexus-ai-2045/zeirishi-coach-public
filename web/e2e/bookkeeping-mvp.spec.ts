import { expect, test, type Page } from '@playwright/test';
import { BOOKKEEPING_TRIAL_CASES } from '../src/server/bookkeeping-trial-supply';

const origin = 'http://127.0.0.1:3210';

async function openBookkeepingMap(page: Page) {
  // 初回の本人cookieと画面初期化を確定してから、同じ本人として案件を準備する。
  const ready = page.waitForResponse(response => new URL(response.url()).pathname === '/api/profile'
    && response.request().method() === 'GET');
  await page.goto('/#map');
  const response = await ready;
  expect(response.status()).toBe(200);
  const profile = await response.json();
  await expect(page.getByRole('region', { name: '科目の全体ツリー' })).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  return profile;
}
for (const material of BOOKKEEPING_TRIAL_CASES) test(`案件 ${material.prompt().caseId} を再開して最後まで保存できる`, async ({ page }) => {
  test.setTimeout(45000);
  const profile = await openBookkeepingMap(page);
  expect(profile.concepts).toHaveLength(36); expect(profile.materialChoices).toHaveLength(35);
  await expect(page.getByRole('region',{name:'科目の全体ツリー'})).toContainText('10分野・36論点');
    const prompt = material.prompt();
    const choice = profile.materialChoices.find((item:{materialId:string}) => item.materialId===prompt.caseId);
    const created = await page.request.post('/api/cafe',{headers:{Origin:origin},data:{action:'start',requestId:crypto.randomUUID(),concept:{subjectId:choice.subjectId,conceptId:choice.conceptId,conceptVersion:choice.conceptVersion},materialId:choice.materialId,caseVersion:choice.caseVersion}});
    expect(created.status()).toBe(200); const {session} = await created.json();
    expect(JSON.stringify(session)).not.toContain('earned');
    await page.goto(`/#case/${session.id}`);
    await expect(page.getByRole('heading',{name:prompt.consultationTitle})).toBeVisible();
    if (!prompt.caseId.startsWith('syllabus-case-')) {
      await expect(page.getByRole('img',{name:'相談先のお店と資料のイメージ'})).toBeVisible();
      await expect.poll(()=>page.getByRole('img',{name:'相談先のお店と資料のイメージ'}).evaluate((image:HTMLImageElement)=>image.complete && image.naturalWidth>0)).toBe(true);
    }
    await page.getByRole('button',{name:'資料を見て判断する →'}).click();
    const answer = prompt.options.find(option => material.grade(material.caseVersion,option.id).correct)!;
    await page.getByRole('radio',{name:answer.label,exact:true}).check();
    await expect(page.locator('main')).toHaveAttribute('aria-busy','false');
    await page.getByRole('button',{name:'この回答で進む →'}).click();
    await expect(page.getByRole('heading',{name:'判断の理由を理解する'})).toBeVisible();
    await page.getByRole('button',{name:'自分の言葉で説明してみる →'}).click();
    await page.getByLabel('相談者への説明（任意・2,000文字まで）').fill('資料の条件を確かめて、今回の根拠を説明しました。');
    await page.getByRole('button',{name:'保存して振り返る →'}).click();
    await page.getByRole('button',{name:'この相談を完了する',exact:true}).click();
    await expect(page.getByText('相談ケース完了',{exact:true})).toBeVisible();
    await page.reload(); await expect(page.getByText('相談ケース完了',{exact:true})).toBeVisible();
});

test('練習309問と独立プールを分離し、選択前に正答・採点情報を返さない', async ({page}) => {
  test.setTimeout(90000);
  const ready=page.waitForResponse(response=>response.url().includes('/api/profile')&&response.request().method()==='GET');
  await page.goto('/#map');
  expect((await ready).status()).toBe(200);
  // 練習問題の一覧パネルは学習地図から外した（ツリー1つに統一）。問題はツリーの論点と学習記録から開く。
  await expect(page.getByRole('region',{name:'簿記論の問題演習'})).toHaveCount(0);
  const practice = await (await page.request.get('/api/practice?pool=practice')).json();
  expect(practice.items).toHaveLength(309);
  const serialized=JSON.stringify(practice); for(const field of ['earned','errorReason','explanation','correct','targetScore']) expect(serialized).not.toContain(`"${field}"`);
  const first=practice.items[0];
  const created=await page.request.post('/api/cafe',{headers:{Origin:origin},data:{action:'start',requestId:crypto.randomUUID(),concept:{subjectId:first.subjectId,conceptId:first.conceptId,conceptVersion:first.conceptVersion},materialId:first.id,caseVersion:first.caseVersion}});
  expect(created.status()).toBe(200);
  const {session}=await created.json(); await page.goto(`/#case/${session.id}`);
  await expect(page.getByRole('button',{name:'資料を見て判断する →',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'学習ナビゲーション'}).getByRole('button',{name:'学習地図',exact:true}).click();
  await expect(page.getByRole('list',{name:'簿記論の全体ツリー'})).toBeVisible();
  await page.goto(`/#case/${session.id}`);
  await page.getByRole('button',{name:'資料を見て判断する →'}).click();
  await page.getByRole('radio').first().check(); await expect(page.locator('main')).toHaveAttribute('aria-busy','false');
  await page.reload(); await expect(page.getByRole('radio').first()).toBeChecked();
  await page.getByRole('button',{name:'この回答で進む →'}).click();
  await expect(page.getByRole('heading',{name:'判断の理由を理解する'})).toBeVisible();
  for(const pool of ['retention']) {
    const response=await page.request.get(`/api/practice?pool=${pool}`); expect(response.status()).toBe(200); const data=await response.json();
    expect(data.items.length).toBeGreaterThan(0); expect(data.items.every((item:{intendedUse:string})=>item.intendedUse===pool)).toBe(true);
    expect(data.items.some((item:{id:string})=>practice.items.some((p:{id:string})=>p.id===item.id))).toBe(false);
  }
  for(const pool of ['diagnostic','evaluation','mini_a','mini_b']) {
    expect((await page.request.get(`/api/practice?pool=${pool}`)).status()).toBe(503);
  }
  const evidence=await (await page.request.get('/api/learning-evidence?subjectId=bookkeeping&examYear=2026&criterionVersion=unconfirmed')).json(); expect(evidence.mastery).toHaveLength(0);
  await page.goto('/#map'); await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/zeirishi-bookkeeping-mvp-mobile.png',fullPage:true});
});

test('未審査の診断を3問まで試し、復習は保存済み完了から予定だけを導く', async ({page}) => {
  test.setTimeout(90000);
  await page.goto('/#records');
  await page.getByText('理解度を短く確認する（任意）',{exact:true}).click();
  const started=page.waitForResponse(response=>response.url().includes('/api/diagnostic')&&response.request().method()==='POST'&&response.request().postDataJSON()?.action==='start');
  await page.getByRole('button',{name:'短く確認する（最大3問）',exact:true}).click();
  expect((await started).status()).toBe(200);
  const region=page.getByRole('region',{name:'理解度確認の結果'});
  await expect(region).toContainText('原稿試用');
  await region.getByRole('radio').first().check();
  await region.getByRole('button',{name:'診断の回答を確定',exact:true}).click();
  await region.getByRole('button',{name:'選ばず確認する',exact:true}).click();
  await region.getByRole('button',{name:'ここまでで確認を終える',exact:true}).click();
  await page.reload(); await page.getByText('理解度を短く確認する（任意）',{exact:true}).click();
  await page.getByRole('button',{name:'保存した診断を確認',exact:true}).click();
  await page.getByRole('button',{name:/の確認を開く$/}).first().click();
  await expect(page.getByRole('region',{name:'理解度確認の結果'})).toContainText('原稿試用');
  const reviews=await (await page.request.get('/api/practice-review')).json();
  expect(reviews.qualification).toBe('practice_only');
  expect(reviews.items.every((item:{status:string})=>item.status==='unknown')).toBe(true);
});

test('キーボードで地図の分野を開閉し、論点から390px・200%拡大でも案件完了まで進める',async ({page})=>{
  test.setTimeout(45000);
  await page.setViewportSize({width:390,height:844}); await page.goto('/#map');
  const tree=page.getByRole('list',{name:'簿記論の全体ツリー'});
  const unit=tree.getByRole('button',{name:/記録・利益・期間配分の基礎/});
  await unit.focus(); await page.keyboard.press('Enter'); await expect(unit).toHaveAttribute('aria-expanded','true');
  await page.keyboard.press('Enter'); await expect(unit).toHaveAttribute('aria-expanded','false');
  await page.keyboard.press('Enter'); await expect(unit).toHaveAttribute('aria-expanded','true');
  const topic=tree.getByRole('button',{name:/^支払日と費用の期間は別（/}); await topic.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary',{name:'選んだ論点の説明'})).toContainText('支払日と費用の期間は別');
  const start=page.getByRole('button',{name:'理解を問題で確かめる →',exact:true}); await start.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'資料を見て判断する →',exact:true})).toBeVisible();
  await page.evaluate(()=>{document.documentElement.style.zoom='2';});
  for(const name of ['資料を見て判断する →','この回答で進む →','自分の言葉で説明してみる →','保存して振り返る →','この相談を完了する']) {
    if(name==='この回答で進む →') { const answer=page.getByRole('radio',{name:'40,000円',exact:true}); await answer.focus(); await page.keyboard.press('Space'); await expect(page.locator('main')).toHaveAttribute('aria-busy','false'); }
    const button=page.getByRole('button',{name,exact:true}); await button.focus(); await page.keyboard.press('Enter');
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await expect(page.getByText('相談ケース完了',{exact:true})).toBeVisible();
});

test('簿記論の学習地図も他科目と同じツリー1つで、ブレインマップや旧地図の切り替えがない', async ({ page }) => {
  await page.goto('/#map');
  const view = page.getByRole('region', { name: '科目の全体ツリー' });
  await expect(view.locator('[data-tree-root]')).toHaveText('簿記論');
  await expect(page.getByRole('region', { name: '簿記のコア概念' })).toHaveCount(0);
  for (const name of ['これまでの地図', '全体ツリー（新）', 'マップ', 'リスト']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  await expect(page.getByLabel(/ブレインマップ/)).toHaveCount(0);
  await expect(view.locator('[aria-label="この科目の進み具合"]')).toContainText('理解した');
  // 簿記論だけの旧「全体像」ページと、ツリーの下の旧パネル（自信の申告・ミニ演習・試用復習）はない。
  await expect(page.getByRole('button', { name: '簿記の全体像をつかむ →' })).toHaveCount(0);
  for (const text of ['この科目の自信をまとめて設定', '開始前・終了時のミニ演習', '簿記論の試用復習']) await expect(page.getByText(text)).toHaveCount(0);
  await page.goto('/#overview');
  await expect(page).toHaveURL(/#map$/);
  await expect(page.getByRole('list', { name: '簿記論の全体ツリー' })).toBeVisible();
  // 旧パネルにあった練習問題は、論点の説明の中から開ける。
  await page.getByRole('list', { name: '簿記論の全体ツリー' }).getByRole('button', { name: /記録・利益・期間配分の基礎/ }).click();
  await page.getByRole('button', { name: /^支払日と費用の期間は別（/ }).click();
  const detail = page.getByRole('complementary', { name: '選んだ論点の説明' });
  await detail.getByText(/^練習問題（\d+問）$/).click();
  await detail.getByRole('button', { name: '練習問題 1 →' }).click();
  await expect(page.getByText('簿記論 · 相談ケース')).toBeVisible();
  for (const width of [1440, 900, 390]) {
    await page.goto('/#map'); await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('list', { name: '簿記論の全体ツリー' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});


test('期限切れの別教材は地図へ戻り、保険料ケースへ無指定で開始しない', async ({page})=>{
  test.setTimeout(90000);
  // 初回応答が遅い場合も、本人と画面の準備が終わるまで案件準備を待つ。
  await page.route('**/api/profile?subjectId=bookkeeping', async route => {
    const response = await route.fetch();
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ response });
  }, { times: 1 });
  const profile = await openBookkeepingMap(page);
  const choice=profile.materialChoices.find((item:{materialId:string})=>item.materialId==='syllabus-case-fixed-aro');
  expect(choice).toBeTruthy();
  const created=await page.request.post('/api/cafe',{headers:{Origin:origin},data:{action:'start',requestId:crypto.randomUUID(),concept:{subjectId:choice.subjectId,conceptId:choice.conceptId,conceptVersion:choice.conceptVersion},materialId:choice.materialId,caseVersion:choice.caseVersion}});
  expect(created.status()).toBe(200);
  const {session}=await created.json(); let unintendedStarts=0;
  await page.route('**/api/cafe**',async route=>{
    const request=route.request();
    if(request.method()==='GET'&&new URL(request.url()).searchParams.get('caseId')===session.id) {
      await route.fulfill({json:{session:{...session,phase:'expired'}}}); return;
    }
    if(request.method()==='POST'&&request.postDataJSON()?.action==='start') unintendedStarts++;
    await route.continue();
  });
  await page.goto(`/#case/${session.id}`);
  await expect(page.getByRole('heading',{name:'この下書きの保存期限が切れました'})).toBeVisible();
  await page.getByRole('button',{name:'学習地図で教材を選ぶ',exact:true}).click();
  await expect(page.getByRole('region',{name:'科目の全体ツリー'})).toBeVisible();
  expect(unintendedStarts).toBe(0);
});
