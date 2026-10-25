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
  await expect(page.getByRole('region', { name: '簿記のコア概念' })).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  return profile;
}
for (const material of BOOKKEEPING_TRIAL_CASES) test(`案件 ${material.prompt().caseId} を再開して最後まで保存できる`, async ({ page }) => {
  test.setTimeout(45000);
  const profile = await openBookkeepingMap(page);
  expect(profile.concepts).toHaveLength(36); expect(profile.materialChoices).toHaveLength(35);
  await expect(page.getByRole('region',{name:'簿記のコア概念'})).toContainText('大きな枝');
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

test('練習263問と独立プールを分離し、選択前に正答・採点情報を返さない', async ({page}) => {
  test.setTimeout(90000);
  const ready=page.waitForResponse(response=>response.url().includes('/api/profile')&&response.request().method()==='GET');
  await page.goto('/#map');
  expect((await ready).status()).toBe(200);
  await expect(page.getByRole('region',{name:'簿記論の問題演習'})).toBeVisible();
  const practice = await (await page.request.get('/api/practice?pool=practice')).json();
  expect(practice.items).toHaveLength(263);
  const serialized=JSON.stringify(practice); for(const field of ['earned','errorReason','explanation','correct','targetScore']) expect(serialized).not.toContain(`"${field}"`);
  const first=practice.items[0];
  const created=await page.request.post('/api/cafe',{headers:{Origin:origin},data:{action:'start',requestId:crypto.randomUUID(),concept:{subjectId:first.subjectId,conceptId:first.conceptId,conceptVersion:first.conceptVersion},materialId:first.id,caseVersion:first.caseVersion}});
  expect(created.status()).toBe(200);
  const {session}=await created.json(); await page.goto(`/#case/${session.id}`);
  await expect(page.getByRole('button',{name:'資料を見て判断する →',exact:true})).toBeVisible();
  await page.getByRole('navigation',{name:'学習ナビゲーション'}).getByRole('button',{name:'学習地図',exact:true}).click();
  await expect(page.getByRole('region',{name:'簿記のコア概念'}).locator('[data-current="true"]').first()).toBeVisible();
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

test('開始前・終了時の6問を12分で独力提出し、結果は終了時だけ公開して保存・再開する', async ({page}) => {
  test.setTimeout(60000);
  await page.goto('/#map');
  await page.getByText('開始前・終了時のミニ演習（各6問・12分）',{exact:true}).click();
  for(const kind of ['開始前','終了時']) {
    const started = page.waitForResponse(r=>r.url().includes('/api/mini-exam') && r.request().method()==='POST' && r.request().postDataJSON()?.action==='start');
    await page.getByRole('button',{name:`${kind}の6問を始める`,exact:true}).click();
    const initial=(await (await started).json()).item;
    expect(Date.parse(initial.view.deadline)-Date.parse(initial.view.startedAt)).toBe(720000);
    expect(initial.view.qualification).toBe('practice_only'); expect(initial.view.trialResults).toEqual([]);
    const region=page.getByRole('region',{name:'ミニ演習の問題と結果'});
    for(let i=0;i<6;i++) {
      await region.getByRole('radio').first().check();
      const saved=page.waitForResponse(r=>r.url().includes('/api/mini-exam') && r.request().postDataJSON()?.action==='submit');
      await region.getByRole('button',{name:'ミニ演習の回答を確定',exact:true}).click();
      const current=(await (await saved).json()).item;
      if(i<5) {
        expect(current.view.trialResults).toEqual([]); expect(current.view.attempts.every((a:{earned:number|null})=>a.earned===null)).toBe(true);
        await region.getByRole('button',{name:'自信は記録しない',exact:true}).click();
        await region.getByRole('button',{name:'次のミニ演習問題へ',exact:true}).click();
      } else {
        expect(current.view.status).toBe('completed'); expect(current.view.trialResults).toEqual([]);
        expect(current.view.attempts.every((a:{earned:number|null})=>a.earned===null)).toBe(true);
        await expect(region.getByRole('heading',{name:`${kind}のミニ演習の結果`,exact:true})).toHaveCount(0);
        await region.getByRole('button',{name:'自信は記録しない',exact:true}).click();
        await expect(region.getByRole('heading',{name:`${kind}のミニ演習の結果`,exact:true})).toBeVisible();
      }
    }
    await page.reload();
    await page.getByText('開始前・終了時のミニ演習（各6問・12分）',{exact:true}).click();
    await page.getByRole('button',{name:`保存した${kind}の演習を見る`,exact:true}).click();
    await page.getByRole('button',{name:new RegExp(`^${kind}：.*の演習を開く$`)}).first().click();
    await expect(page.getByRole('heading',{name:`${kind}のミニ演習の結果`,exact:true})).toBeVisible();
  }
  const evidence=await (await page.request.get('/api/learning-evidence?subjectId=bookkeeping&examYear=2026&criterionVersion=unconfirmed')).json(); expect(evidence.mastery).toEqual([]);
});

test('ミニ演習を自信未記録で早期終了しても、再読込後に自信を確定してから結果を見る', async ({page}) => {
  await page.goto('/#map');
  await page.getByText('開始前・終了時のミニ演習（各6問・12分）',{exact:true}).click();
  await page.getByRole('button',{name:'開始前の6問を始める',exact:true}).click();
  const region=page.getByRole('region',{name:'ミニ演習の問題と結果'});
  await region.getByRole('radio').first().check();
  await region.getByRole('button',{name:'ミニ演習の回答を確定',exact:true}).click();
  const finished=page.waitForResponse(r=>r.url().includes('/api/mini-exam') && r.request().postDataJSON()?.action==='finish');
  await region.getByRole('button',{name:'ミニ演習をここまでで終了',exact:true}).click();
  const closed=(await (await finished).json()).item;
  expect(closed.view.status).toBe('completed'); expect(closed.view.trialResults).toEqual([]);
  expect(closed.view.attempts[0].earned).toBeNull();
  await expect(region.getByRole('heading',{name:'開始前のミニ演習の結果',exact:true})).toHaveCount(0);
  await page.reload();
  await page.getByText('開始前・終了時のミニ演習（各6問・12分）',{exact:true}).click();
  await page.getByRole('button',{name:'保存した開始前の演習を見る',exact:true}).click();
  await page.getByRole('button',{name:/^開始前：.*の演習を開く$/}).first().click();
  await expect(region.getByRole('button',{name:'自信は記録しない',exact:true})).toBeVisible();
  await region.getByRole('button',{name:'自信は記録しない',exact:true}).click();
  await expect(region.getByRole('heading',{name:'開始前のミニ演習の結果',exact:true})).toBeVisible();
  await expect(region.getByText(/正答：/)).toHaveCount(1);
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

test('キーボードで地図の枝を展開し、390px・200%拡大でも案件完了まで進める',async ({page})=>{
  test.setTimeout(45000);
  await page.setViewportSize({width:390,height:844}); await page.goto('/#map');
  const atlas=page.getByRole('region',{name:'簿記のコア概念'});
  const branch=atlas.getByRole('region',{name:'試験論点の地図'}).getByRole('heading').first().getByRole('button');
  await branch.focus(); await page.keyboard.press('Enter'); await expect(branch).toHaveAttribute('aria-expanded','false');
  await page.keyboard.press('Enter'); await expect(branch).toHaveAttribute('aria-expanded','true');
  const start=page.getByRole('button',{name:'この考え方を相談で試す →',exact:true}); await start.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'資料を見て判断する →',exact:true})).toBeVisible();
  await page.evaluate(()=>{document.documentElement.style.zoom='2';});
  for(const name of ['資料を見て判断する →','この回答で進む →','自分の言葉で説明してみる →','保存して振り返る →','この相談を完了する']) {
    if(name==='この回答で進む →') { const answer=page.getByRole('radio',{name:'40,000円',exact:true}); await answer.focus(); await page.keyboard.press('Space'); await expect(page.locator('main')).toHaveAttribute('aria-busy','false'); }
    const button=page.getByRole('button',{name,exact:true}); await button.focus(); await page.keyboard.press('Enter');
    await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await expect(page.getByText('相談ケース完了',{exact:true})).toBeVisible();
});

test('地図の接続線はPC・縦ツリー・拡大・枝の開閉で親子カードへ届く', async ({ page }) => {
  await page.goto('/#map');
  const atlas = page.getByRole('region', { name: '簿記のコア概念' });
  async function connected() {
    await expect.poll(() => atlas.evaluate(element => {
      const root = element.querySelector<HTMLElement>('[data-tree-root]');
      const svg = element.querySelector<SVGSVGElement>('[aria-label="簿記の全体像"] > svg');
      const cards = [...element.querySelectorAll<HTMLElement>('[data-tree-branch]')];
      const paths = [...(svg?.querySelectorAll<SVGPathElement>(':scope > path') ?? [])];
      if (!root || !svg || paths.length !== cards.length || !paths.length) return false;
      const rootBox = root.getBoundingClientRect();
      const matrix = svg.getScreenCTM();
      if (!matrix) return false;
      return paths.every((path, index) => {
        const start = path.getPointAtLength(0).matrixTransform(matrix);
        const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
        const box = cards[index].getBoundingClientRect();
        const onParent = Math.abs(start.y-rootBox.bottom) < 3 && start.x >= rootBox.left && start.x <= rootBox.right;
        const onChild = (Math.abs(end.y-box.top) < 3 && end.x >= box.left && end.x <= box.right) ||
          (Math.abs(end.x-box.left) < 3 && end.y >= box.top && end.y <= box.bottom);
        return onParent && onChild && getComputedStyle(svg).pointerEvents === 'none';
      });
    })).toBe(true);
    await expect.poll(() => atlas.evaluate(element => [...element.querySelectorAll<HTMLElement>('[data-tree-branch]')].every(card => {
      const marker=card.querySelector<HTMLElement>('[data-branch-marker]');
      const leaves=[...card.querySelectorAll<HTMLElement>('[data-branch-leaf]')].filter(node=>node.getClientRects().length>0);
      const svg=card.querySelector<SVGSVGElement>(':scope > svg'); const path=svg?.querySelector('path');
      if(!marker || !svg || !path) return false;
      if(!leaves.length) return !path.getAttribute('d');
      if(!path.getAttribute('d')) return false;
      const matrix=svg.getScreenCTM(); if(!matrix) return false;
      const start=path.getPointAtLength(0).matrixTransform(matrix), end=path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
      const parent=marker.getBoundingClientRect(), child=leaves[leaves.length-1].getBoundingClientRect();
      return Math.abs(start.x-(parent.left+parent.width/2))<3 && Math.abs(start.y-parent.bottom)<3 &&
        Math.abs(end.x-child.left)<3 && Math.abs(end.y-(child.top+child.height/2))<3;
    }))).toBe(true);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 1505, height: 1045 });
  await connected();
  await atlas.locator('[aria-label="簿記の全体像"]').screenshot({ path: '/tmp/zeirishi-tree-desktop-final.png' });
  const branch = atlas.getByRole('region', { name: '試験論点の地図' }).getByRole('heading').first().getByRole('button');
  await branch.focus(); await page.keyboard.press('Enter'); await connected();
  await page.keyboard.press('Enter'); await connected();
  await page.setViewportSize({ width: 1101, height: 1000 }); await connected();
  await atlas.getByRole('button', { name: '考え方で見る' }).click(); await connected();
  await atlas.locator('[aria-label="簿記の全体像"]').screenshot({path:'/tmp/zeirishi-tree-inner-final.png'});
  await atlas.getByRole('button', { name: '試験論点で見る' }).click(); await connected();
  await page.setViewportSize({ width: 900, height: 1000 }); await connected();
  await page.setViewportSize({ width: 390, height: 844 }); await connected();
  await atlas.locator('[aria-label="簿記の全体像"]').screenshot({ path: '/tmp/zeirishi-tree-mobile-final.png' });
  await page.evaluate(() => { document.documentElement.style.zoom = '2'; }); await connected();
  await atlas.getByRole('button', { name: '考え方で見る' }).click(); await connected();
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
  await expect(page.getByRole('region',{name:'簿記のコア概念'})).toBeVisible();
  expect(unintendedStarts).toBe(0);
});
