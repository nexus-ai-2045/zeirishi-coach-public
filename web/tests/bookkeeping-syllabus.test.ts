import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOOKKEEPING_SYLLABUS_LESSONS, syllabusConceptId } from '../src/server/bookkeeping-syllabus';
import { BOOKKEEPING_ALL_CONCEPTS, BOOKKEEPING_TRIAL_MAP, BOOKKEEPING_TRIAL_CASES, getBookkeepingTrialPracticeMaterial } from '../src/server/bookkeeping-trial-supply';
import { BOOKKEEPING_ALL_QUESTION_DRAFTS, publicBookkeepingQuestion, bookkeepingDiagnosticDraftAdapter } from '../src/server/bookkeeping-question-drafts';
import { createDiagnosticEngine } from '../src/domain/diagnostic-session';
import { projectBookkeepingTrialReview } from '../src/server/bookkeeping-trial-review';

const legacy = JSON.parse(readFileSync(new URL('../../references/subjects/boki.json',import.meta.url),'utf8'));
const counts = {practice:263,diagnostic:108,evaluation:36,retention:72,mini_a:6,mini_b:6};
test('旧28論点を明示対応し公式出題ポイントのCFとOCIを加え、承認・頻度を捏造しない',()=>{
  assert.equal(BOOKKEEPING_SYLLABUS_LESSONS.length,30);
  assert.deepEqual(BOOKKEEPING_SYLLABUS_LESSONS.filter(item=>item.legacyTopicId.startsWith('boki.')).map(item=>item.legacyTopicId).sort(),legacy.topics.map((item:{id:string})=>item.id).sort());
  assert.equal(BOOKKEEPING_ALL_CONCEPTS.length,36); assert.equal(BOOKKEEPING_TRIAL_MAP.units.length,10);
  assert.equal(BOOKKEEPING_TRIAL_MAP.topics.length,36); assert.equal(BOOKKEEPING_TRIAL_CASES.length,35);
  assert.ok(BOOKKEEPING_ALL_CONCEPTS.every(item=>item.status==='draft'&&item.applicableYear===null));
  for(const lesson of BOOKKEEPING_SYLLABUS_LESSONS) {
    const id=syllabusConceptId(lesson);
    assert.ok(lesson.coveredSkills.length&&lesson.remainingSkills.length,id);
    assert.ok(BOOKKEEPING_TRIAL_MAP.links.some(link=>link.kind==='explains-topic'&&link.sourceId===id&&link.targetId===`topic-${id}`));
    assert.ok(BOOKKEEPING_TRIAL_MAP.links.some(link=>link.kind==='uses-case'&&link.sourceId===id&&link.targetId===`syllabus-case-${lesson.id}`));
    assert.ok(lesson.exercises.length>=12,id);
    assert.ok(lesson.exercises.filter(item=>item.use==='practice').length>=6,id);
    assert.ok(new Set(lesson.exercises.filter(item=>item.use==='practice').map(item=>item.family)).size>=3,id);
    assert.equal(lesson.exercises.filter(item=>item.use==='diagnostic').length,3,id);
    assert.equal(lesson.exercises.filter(item=>item.use==='evaluation').length,1,id);
    for(const interval of [7,21]) assert.equal(lesson.exercises.filter(item=>item.use==='retention'&&item.family===`retain-${interval}-day`).length,1,id);
  }
});
test('全491問は用途別に隔離し正答と根拠を出題前に漏らさず、採点を固定する',()=>{
  assert.equal(BOOKKEEPING_ALL_QUESTION_DRAFTS.length,491);
  const ids=new Set<string>(); const prompts=new Set<string>();
  for(const [use,count] of Object.entries(counts)) assert.equal(BOOKKEEPING_ALL_QUESTION_DRAFTS.filter(item=>item.intendedUse===use).length,count,use);
  for(const item of BOOKKEEPING_ALL_QUESTION_DRAFTS) {
    const q=item.question; assert.ok(!ids.has(q.id),q.id);ids.add(q.id);
    assert.ok(!prompts.has(q.prompt),q.id);prompts.add(q.prompt);
    assert.equal(q.options.length,4); assert.equal(new Set(q.options.map(option=>option.label)).size,4,q.id);
    assert.equal(q.options.filter(option=>option.earned===q.maxScore).length,1,q.id);
    const publicQ=JSON.stringify(publicBookkeepingQuestion(item));
    for(const key of ['earned','correct','explanation','errorReason']) assert.ok(!publicQ.includes(`"${key}"`),q.id);
    if(!['practice','retention'].includes(item.intendedUse)) assert.throws(()=>getBookkeepingTrialPracticeMaterial({materialId:q.id}));
  }
});
test('全30追加概念で独立診断と7/21日の復習を用意し、未測定を弱点にしない',()=>{
  const engine=createDiagnosticEngine(bookkeepingDiagnosticDraftAdapter(),{practiceOnly:true});
  const at='2026-10-07T00:00:00.000Z';
  const unknown=projectBookkeepingTrialReview([],new Date(at)); assert.equal(unknown.items.length,72);
  for(const lesson of BOOKKEEPING_SYLLABUS_LESSONS) {
    const id=syllabusConceptId(lesson);
    const state=engine.transition(engine.start({id:`probe-${id}`,mode:'short',subjectId:'bookkeeping',conceptId:id,createdAt:at,seenFamilies:[]}),{type:'present',requestId:'present',at,seenFamilies:[]});
    assert.ok(engine.view(state,at).currentQuestion,id);
    const items=unknown.items.filter(item=>item.conceptId===id); assert.equal(items.length,2,id);
    assert.ok(items.every(item=>item.status==='unknown'&&item.anchorAt===null),id);
  }
});
test('補助CF・OCIの数値を原稿の採点とは独立に検算する',()=>{
  const audit:[string,string,string][]=[['cash-flow','direct-sum',String(120-70-20)],['cash-flow','receipt-bridge',String(20+100-30)],['cash-flow','supplier-bridge',String(15+80+20-10-25)],['cash-flow','cash-reconcile',String(50+20-30+40)],['oci-recycling','comprehensive',String(40+6)],['oci-recycling','balance-movement',String(16-10)],['oci-recycling','loss-recycle',String(-20+20)],['oci-recycling','tax-effect',String(10-3)],['oci-recycling','statement-reconcile',String(30+8-5)]];
  for(const [id,family,answer] of audit) assert.equal(BOOKKEEPING_SYLLABUS_LESSONS.find(item=>item.id===id)!.exercises.find(item=>item.family===family)!.answer,answer);
});

test('概念だけを改訂しても教材版が変わり旧完了を新版の復習へ移さない',async()=>{
  const {syllabusCaseMaterial}=await import('../src/server/bookkeeping-syllabus-materials');
  const current=BOOKKEEPING_SYLLABUS_LESSONS[0];
  const changed=syllabusCaseMaterial({...current,definition:current.definition+' 指定の改訂条件。'});
  const original=syllabusCaseMaterial(current);
  assert.notEqual(original.concept!.conceptVersion,changed.concept!.conceptVersion);
  assert.notEqual(original.caseVersion,changed.caseVersion);
  assert.throws(()=>original.grade(changed.caseVersion,original.prompt().options[0].id));
  const stale=projectBookkeepingTrialReview([{caseVersion:changed.caseVersion,scoringVersion:changed.scoringVersion,completedAt:'2026-09-01T00:00:00.000Z'}],new Date('2026-10-07T00:00:00.000Z'));
  assert.equal(stale.unresolvedCompletions,1);
  assert.ok(stale.items.filter(item=>item.conceptId===original.concept!.conceptId).every(item=>item.status==='unknown'));
});


test('公開された問題版の先頭バイトから追加383問の正答を復元できない',()=>{
  const questions=BOOKKEEPING_ALL_QUESTION_DRAFTS.filter(item=>item.question.conceptId.startsWith('syllabus-'));
  assert.equal(questions.length,383);
  const recovered=questions.filter(item=>{
    const publicView=publicBookkeepingQuestion(item);
    const hash=publicView.version.split('-').at(-1)!;
    const guessedId=`o${Number.parseInt(hash.slice(0,2),16)%4+1}`;
    return item.question.options.find(option=>option.id===guessedId)?.earned===1;
  }).length;
  assert.ok(recovered<questions.length/2,`公開版から${recovered}/383問の正答が復元された`);
});

test('選択肢ごとの誤答理由がある問題は、選んだ誤答に対応する理由を返す',()=>{
  const lessons=BOOKKEEPING_SYLLABUS_LESSONS.filter(lesson=>lesson.exercises.some(item=>item.wrongReasons));
  assert.ok(lessons.length>0);
  for(const lesson of lessons) lesson.exercises.forEach((seed,index)=>{
    if(!seed.wrongReasons) return;
    assert.equal(new Set(seed.wrongReasons).size,3,seed.family);
    const item=BOOKKEEPING_ALL_QUESTION_DRAFTS.find(draft=>draft.question.id===`bk-${seed.use}-${syllabusConceptId(lesson)}-${index+1}`)!;
    assert.ok(item,seed.family);
    for(const option of item.question.options){
      if(option.earned===1){ assert.equal(option.errorReason,null); continue; }
      assert.equal(option.errorReason,seed.wrongReasons[seed.wrong.indexOf(option.label)],seed.family);
    }
  });
});
