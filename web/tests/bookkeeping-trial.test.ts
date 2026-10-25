import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { BOOKKEEPING_TRIAL_CASES, BOOKKEEPING_TRIAL_CATALOG, BOOKKEEPING_TRIAL_CHOICES, BOOKKEEPING_TRIAL_MATERIALS, getBookkeepingTrialMaterial } from '../src/server/bookkeeping-trial-supply';
import { createCafeService, createCafeServiceOnPreparedDatabase, readOwnedCafeVersion } from '../src/server/cafe-service';
import { APPROVED_CATALOG, MATERIAL_RECORDS } from '../src/server/approved-catalog';

test('draft inventory cannot activate production and every material selection binds its concept and version', () => {
  assert.equal(BOOKKEEPING_TRIAL_CATALOG[0].concepts.length,36); assert.equal(BOOKKEEPING_TRIAL_CASES.length,35);
  assert.equal(MATERIAL_RECORDS.length,572); assert.ok(MATERIAL_RECORDS.every(record=>record.status==='draft'));
  assert.equal(APPROVED_CATALOG.length,0);
  assert.equal(new Set(BOOKKEEPING_TRIAL_MATERIALS.map(material=>material.caseVersion)).size,BOOKKEEPING_TRIAL_MATERIALS.length);
  for(const choice of BOOKKEEPING_TRIAL_CHOICES) {
    const material=getBookkeepingTrialMaterial({concept:choice,materialId:choice.materialId,caseVersion:choice.caseVersion});
    assert.equal(material.prompt().caseId,choice.materialId);
    assert.throws(()=>getBookkeepingTrialMaterial({concept:{...choice,subjectId:'financial-statements'},materialId:choice.materialId}));
    assert.throws(()=>getBookkeepingTrialMaterial({concept:choice,materialId:choice.materialId,caseVersion:'stale-version'}));
    assert.equal(material.prompt().options.filter(option=>material.grade(material.caseVersion,option.id).correct).length,1);
  }
});

test('owner-bound version resumes all registered cases and request replay cannot duplicate a case', async () => {
  const db=new PGlite();
  try {
    await createCafeService(db);
    for(const material of BOOKKEEPING_TRIAL_CASES) {
      const service=createCafeServiceOnPreparedDatabase(db,()=>new Date(),material);
      const requestId=`start-${material.prompt().caseId}`;
      const started=await service.start('alice',requestId,{bindMaterialVersion:true});
      assert.equal((await service.start('alice',requestId,{bindMaterialVersion:true})).id,started.id);
      const version=await readOwnedCafeVersion(db,'alice',started.id); assert.equal(version,material.caseVersion);
      await assert.rejects(()=>readOwnedCafeVersion(db,'bob',started.id));
      const resolved=createCafeServiceOnPreparedDatabase(db,()=>new Date(),getBookkeepingTrialMaterial({caseVersion:version}));
      assert.equal((await resolved.get('alice',started.id)).prompt.caseId,material.prompt().caseId);
    }
  } finally {await db.close();}
});

test('key-free adapter uses the selected case rather than the original insurance grounding', async () => {
  const { createLocalClaudeCoachProvider }=await import('../src/server/local-cli-coach');
  const material=BOOKKEEPING_TRIAL_CASES.find(item=>item.prompt().caseId==='shop-inventory')!;
  let seen='';
  const provider=createLocalClaudeCoachProvider(async prompt=>{seen=prompt;return {subtype:'success',structured_output:{reply:'販売分と在庫を区別して説明してください。',follow_up:'残った商品はどこに残りますか？'}};},version=>getBookkeepingTrialMaterial({caseVersion:version}));
  const answer=material.prompt().options.find(option=>material.grade(material.caseVersion,option.id).correct)!;
  await provider.generate({case_version:material.caseVersion,purpose:'rephrase',explanation:'売れた商品の分を原価と考えます。',selected_option_id:answer.id},{signal:new AbortController().signal,maxOutputCharacters:2000});
  assert.ok(seen.includes(material.prompt().consultation)); assert.ok(!seen.includes('火災保険'));
});

test('ordinary practice cannot start independent diagnostic, evaluation or mini-exam questions', async () => {
  const { BOOKKEEPING_ALL_QUESTION_DRAFTS } = await import('../src/server/bookkeeping-question-drafts');
  const { getBookkeepingTrialPracticeMaterial } = await import('../src/server/bookkeeping-trial-supply');
  for (const item of BOOKKEEPING_ALL_QUESTION_DRAFTS) {
    const material = getBookkeepingTrialMaterial({ materialId: item.question.id });
    const selection = { materialId: item.question.id, caseVersion: material.caseVersion };
    if (['practice','retention'].includes(item.intendedUse)) assert.equal(getBookkeepingTrialPracticeMaterial(selection), material);
    else assert.throws(() => getBookkeepingTrialPracticeMaterial(selection));
  }
});
