import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createDiagnosticService, createDiagnosticServiceOnPreparedDatabase, readDiagnosticRecords } from '../src/server/diagnostic-service';
import type { DiagnosticQuestion } from '../src/domain/diagnostic-session';
import { createDiagnosticHandler } from '../src/http/diagnostic-handler';
import { lockOwner } from '../src/server/owner-access';
const questions: DiagnosticQuestion[] = Array.from({length: 5}, (_, index) => ({ id: `q${index}`, version:'v1',
  subjectId:'bookkeeping', conceptId:'prepaid',conceptVersion:'v1',familyId:`f${index}`,poolId:'diagnostic',poolVersion:'v1',
  purpose:'diagnostic',stage:'anchor',status:'active',prompt:'どの期間ですか？',review:{reviewerId:'expert',reviewedAt:'2026-09-01T00:00:00.000Z',rightsConfirmed:true},
  maxScore:1,targetScore:1,options:[{id:'correct',label:'当期',earned:1,errorReason:null},{id:'wrong',label:'前期',earned:0,errorReason:'期間を再確認'}] }));
const start = (requestId: string, mode: 'short' | 'detailed' = 'short') => ({action:'start',requestId,mode,subjectId:'bookkeeping',conceptId:'prepaid'});
test('診断保存は在庫ゼロを補完せず、本人別・CAS・冪等・全セッション露出と回答非開示を保持する',async()=>{
  const db=new PGlite();
  try {
    let at=new Date('2026-09-02T00:00:00.000Z');
    const empty=await createDiagnosticService(db,[],()=>at);
    const unavailable=await empty.save('empty',start('empty-start'));
    assert.equal(unavailable.view.status,'unavailable');
    assert.deepEqual(unavailable.view.attempts,[]);
    assert.equal((await db.query('SELECT * FROM diagnostic_sessions')).rows.length,0);
    assert.equal((await db.query('SELECT * FROM diagnostic_requests')).rows.length,0);
    // Catalog-version binding is deliberately fail-closed; use a distinct owner for fixtures.
    const service=createDiagnosticServiceOnPreparedDatabase(db,questions,()=>at);
    const first=await service.save('alice',start('start-one'));
    assert.deepEqual(await service.save('alice',start('start-one')),first);
    assert.equal(first.view.attempts[0].earned,null);
    assert.equal(JSON.stringify(first).includes('"catalog"'),false);
    assert.equal(first.view.currentQuestion!.options[0].label,'当期');
    assert.equal('earned' in first.view.currentQuestion!.options[0],false);
    await assert.rejects(service.get('bob',first.id),/NOT_FOUND/);
    const second=await service.save('alice',start('start-two'));
    assert.notEqual(second.view.attempts[0].familyId,first.view.attempts[0].familyId);
    const submit={action:'submit',requestId:'submit',sessionId:first.id,revision:0,instanceId:first.view.attempts[0].instanceId,answerId:'correct',hintsUsed:false};
    const accepted=await service.save('alice',submit);
    assert.deepEqual(await service.save('alice',submit),accepted);
    await assert.rejects(service.save('alice',{...submit,answerId:'wrong'}),/REQUEST_CONFLICT/);
    await assert.rejects(service.save('alice',{...submit,requestId:'stale'}),/REVISION_CONFLICT/);
    assert.equal(accepted.view.attempts[0].earned,null);
    await service.save('alice',{action:'confidence',requestId:'skip-confidence',sessionId:first.id,revision:1,instanceId:'question-1',value:null});
    const next=await service.save('alice',{action:'present',requestId:'next',sessionId:first.id,revision:2});
    assert.equal(next.view.attempts[1].familyId,'f2');
    const finish=await service.save('alice',{action:'finish',requestId:'finish',sessionId:first.id,revision:3});
    assert.equal(finish.view.attempts[1].earned,null);
    assert.equal(finish.view.attempts[1].answerId,null);
    assert.equal((await db.transaction(tx=>readDiagnosticRecords(tx,'alice',questions,at.toISOString()))).length,2);
    const archived=await empty.get('alice',first.id);
    assert.equal(archived.view.currentQuestion,null);
    assert.equal(archived.view.status,'unavailable');
    assert.equal((await db.transaction(tx=>readDiagnosticRecords(tx,'alice',[],at.toISOString()))).length,2);
    const detailed=await service.save('bob',start('timed','detailed'));
    at=new Date(at.getTime()+480000);
    assert.equal((await service.get('bob',detailed.id)).view.status,'expired');
    await assert.rejects(service.save('bob',{...submit,sessionId:detailed.id,requestId:'late'}),/DIAGNOSTIC_CLOSED/);
    assert.equal((await service.get('bob',detailed.id)).view.attempts[0].earned,null);
    await db.transaction(async tx=>{const owner=await lockOwner(tx,'alice');await tx.query('UPDATE owner_access SET revoked_at=$2 WHERE owner_hash=$1',[owner.hash,at.toISOString()]);});
    await assert.rejects(service.list('alice'),/OWNER_REVOKED/);
    await assert.rejects(service.save('alice',start('after-delete')),/OWNER_REVOKED/);
  }finally{await db.close();}
});
test('診断HTTPはfixtureガードを保ち、状態やclockのクライアント注入を拒否する',async()=>{
  const db=new PGlite();
  try{
    const service=await createDiagnosticService(db);
    const request=(input:unknown)=>new Request('http://127.0.0.1:3210/api/diagnostic',{method:'POST',headers:{host:'127.0.0.1:3210',origin:'http://127.0.0.1:3210','content-type':'application/json',cookie:'zc-user=11111111-1111-4111-8111-111111111111'},body:JSON.stringify(input)});
    let acquisitions=0;
    const handler=createDiagnosticHandler(async()=>{acquisitions++;return service;},()=> '1');
    assert.equal((await createDiagnosticHandler(async()=>service,()=>undefined)(request(start('off')))).status,503);
    assert.equal((await handler(request({...start('bad'),at:'2026-01-01T00:00:00.000Z'}))).status,400);
    assert.equal((await handler(request({...start('bad2'),seenFamilies:[]}))).status,400);
    assert.equal((await handler(request({...start('bad-mode'),mode:'invented'}))).status,400);
    const getHeaders={host:'127.0.0.1:3210',cookie:'zc-user=11111111-1111-4111-8111-111111111111'};
    assert.equal((await handler(new Request('http://127.0.0.1:3210/api/diagnostic?id=',{headers:getHeaders}))).status,400);
    assert.equal((await handler(new Request('http://127.0.0.1:3210/api/diagnostic',{method:'DELETE',headers:getHeaders}))).status,405);
    assert.equal(acquisitions,0);
    const response=await handler(request(start('okay')));
    assert.equal(response.status,200);
    assert.equal((await response.json()).item.view.status,'unavailable');
  }finally{await db.close();}
});
test('診断一覧は最新20件、exportと出題済みfamilyの合流は全履歴を保持する',async()=>{
  const db=new PGlite();
  try{
    let at=new Date('2026-09-02T00:00:00.000Z');
    const catalog=Array.from({length:22},(_,index)=>({...questions[0],id:`q${String(index).padStart(2,'0')}`,familyId:`f${index}`}));
    const service=await createDiagnosticService(db,catalog,()=>at);
    const ids:string[]=[];
    for(let index=0;index<21;index++){
      ids.push((await service.save('alice',start(`start-${index}`))).id);
      at=new Date(at.getTime()+1000);
    }
    const list=await service.list('alice');
    assert.equal(list.length,20);
    assert.equal(list[0].id,ids[20]);
    assert.equal(list.some(item=>item.id===ids[0]),false);
    assert.equal((await db.transaction(tx=>readDiagnosticRecords(tx,'alice',catalog,at.toISOString()))).length,21);
    assert.equal((await service.get('alice',ids[0])).view.attempts[0].familyId,'f0');
    const next=await service.save('alice',start('start-last'));
    assert.equal(next.view.attempts[0].familyId,'f21');
  }finally{await db.close();}
});
test('同じfamilyIdでも科目が違う既見履歴は診断の出題を相互に除外しない', async () => {
  const db = new PGlite();
  try {
    const catalog: DiagnosticQuestion[] = [
      { ...questions[0], id: 'a-bookkeeping-shared', familyId: 'shared-family' },
      { ...questions[0], id: 'b-bookkeeping-next', familyId: 'bookkeeping-next-family' },
      { ...questions[0], id: 'a-income-shared', subjectId: 'income-tax', familyId: 'shared-family' },
    ];
    let at = new Date('2026-09-02T00:00:00.000Z');
    const service = await createDiagnosticService(db, catalog, () => at);
    const bookkeeping = await service.save('alice', start('bookkeeping-start'));
    assert.equal(bookkeeping.view.attempts[0].familyId, 'shared-family');
    const income = await service.save('alice', { ...start('income-start'), subjectId: 'income-tax' });
    assert.equal(income.view.attempts[0].familyId, 'shared-family');
    at = new Date(at.getTime() + 1000);
    const next = await service.save('alice', { ...start('bookkeeping-next-start') });
    assert.equal(next.view.attempts[0].familyId, 'bookkeeping-next-family');
  } finally { await db.close(); }
});
