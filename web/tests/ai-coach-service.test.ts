import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createCafeService } from '../src/server/cafe-service';
import { AI_COACH_SCHEMA, createAiCoachServiceOnPreparedDatabase, parseAiCoachRequest, type AiCoachProvider } from '../src/server/ai-coach-service';

test('explicit saved teachback: ownership, revision, disabled fallback and immutable evidence', async () => {
 const db = new PGlite();
 try {
  const cafe = await createCafeService(db); await db.exec(AI_COACH_SCHEMA);
  const start = await cafe.start('alice','start');
  const submitted = await cafe.submit('alice',start.id,{requestId:'submit',optionId:'h4r9'});
  const input = {requestId:'ai',attemptId:submitted.attemptId!,caseVersion:submitted.caseVersion,progressRevision:0,purpose:'explain_to_owner',explanation:'支払った期間と費用になる期間を分けます。',confirmed:true};
  const service = createAiCoachServiceOnPreparedDatabase(db);
  await assert.rejects(service.request('alice',start.id,input));
  const revealed = await cafe.confidence('alice',start.id,{requestId:'confidence',confidence:null});
  const saved = await cafe.saveProgress('alice',start.id,{requestId:'save',revision:revealed.progressRevision,phase:'teach_back',explanation:input.explanation});
  input.progressRevision=saved.progressRevision;
  assert.equal((await db.query('SELECT * FROM ai_interaction_summaries')).rows.length,0);
  await assert.rejects(service.request('bob',start.id,input));
  await assert.rejects(service.request('alice',start.id,{...input,progressRevision:0}));
  assert.throws(() => parseAiCoachRequest({...input,mastery:100}));
  assert.throws(() => parseAiCoachRequest({...input,confirmed:false}));
  assert.throws(() => parseAiCoachRequest({...input,purpose:'invalid'}));
  const before = (await db.query('SELECT * FROM cafe_attempts')).rows;
  assert.equal((await service.request('alice',start.id,input)).label,'固定の理解確認');
  assert.equal((await service.request('alice',start.id,input)).reason,'already_requested');
  assert.deepEqual((await db.query('SELECT * FROM cafe_attempts')).rows,before);
 } finally { await db.close(); }
});

test('disabled fixed fallback keeps the purpose-specific understanding check', async () => {
 const db = new PGlite();
 try {
  const cafe = await createCafeService(db); await db.exec(AI_COACH_SCHEMA);
  const start = await cafe.start('alice','start');
  await cafe.submit('alice',start.id,{requestId:'submit',optionId:'h4r9'});
  const revealed = await cafe.confidence('alice',start.id,{requestId:'confidence',confidence:null});
  const saved = await cafe.saveProgress('alice',start.id,{requestId:'save',revision:revealed.progressRevision,phase:'teach_back',explanation:'期間を分けます。'});
  const checks = {
   explain_to_owner: ['事実','判断','理由','次アクション'],
   rephrase: ['専門語','原則','境界'],
   another_example: ['条件','別の例','変わらない'],
   check_my_example: ['適用した原則','成立条件','反例'],
  } as const;
  const service = createAiCoachServiceOnPreparedDatabase(db);
  for (const [purpose, terms] of Object.entries(checks)) {
   const result = await service.request('alice',start.id,{requestId:`ai-${purpose}`,attemptId:saved.attemptId!,caseVersion:saved.caseVersion,progressRevision:saved.progressRevision,purpose:purpose as keyof typeof checks,explanation:saved.explanation,confirmed:true});
   assert.equal(result.mode,'fixed');
   assert.equal(result.label,'固定の理解確認');
   for (const term of terms) assert.match(`${result.reply} ${result.follow_up}`,new RegExp(term));
   assert.equal(result.evidenceQualification,'practice_only');
  }
 } finally { await db.close(); }
});

test('reservation, replay, minimal payload, timeout and late revision prevent duplicate billing or disclosure', async () => {
 const db = new PGlite();
 try {
  const now=()=>new Date('2026-09-30T15:00:00Z');
  const cafe=await createCafeService(db,now); await db.exec(AI_COACH_SCHEMA);
  const start=await cafe.start('alice','start');
  await cafe.submit('alice',start.id,{requestId:'submit',optionId:'h4r9'});
  const revealed=await cafe.confidence('alice',start.id,{requestId:'confidence',confidence:null});
  const saved=await cafe.saveProgress('alice',start.id,{requestId:'save',revision:revealed.progressRevision,phase:'teach_back',explanation:'期間を分けます。'});
  const input={requestId:'ai',attemptId:saved.attemptId!,caseVersion:saved.caseVersion,progressRevision:saved.progressRevision,purpose:'explain_to_owner',explanation:saved.explanation,confirmed:true};
  let calls=0;
  const provider:AiCoachProvider={maximumCostMilliYen:600,async generate(payload){calls++;assert.equal(payload.selected_option_id,'h4r9');return {reply:'もう少し説明してください。',source_ids:[],follow_up:'どの期間ですか？',uncertainty:true,actualCostMilliYen:400};}};
  const current=createAiCoachServiceOnPreparedDatabase(db,{provider,monthlyLimitMilliYen:900,now});
  assert.equal((await current.request('alice',start.id,input)).mode,'ai');
  assert.equal((await current.request('alice',start.id,input)).reason,'already_requested');
  assert.equal((await current.request('alice',start.id,{...input,requestId:'over'})).reason,'budget_exceeded');
  assert.equal(calls,1);
  assert.equal(JSON.stringify((await db.query('SELECT * FROM ai_interaction_summaries')).rows).includes('もう少し'),false);
  assert.equal((await db.query<{month:string}>('SELECT month FROM ai_coach_budgets')).rows[0].month,'2026-10');
  const timeout=createAiCoachServiceOnPreparedDatabase(db,{provider:{maximumCostMilliYen:1,generate:async()=>new Promise(()=>{})},timeoutMs:5,now});
  assert.equal((await timeout.request('alice',start.id,{...input,requestId:'timeout'})).reason,'provider_unavailable');
  assert.equal((await current.request('alice',start.id,{...input,requestId:'fresh'})).reason,'request_pending');
  assert.equal(calls,1);
 } finally {await db.close();}
});

test('reply arriving after another tab saves is not exposed',async()=>{
 const db=new PGlite();
 try {
  const cafe=await createCafeService(db);await db.exec(AI_COACH_SCHEMA);
  const start=await cafe.start('alice','start');await cafe.submit('alice',start.id,{requestId:'submit',optionId:'h4r9'});
  const revealed=await cafe.confidence('alice',start.id,{requestId:'confidence',confidence:null});
  const saved=await cafe.saveProgress('alice',start.id,{requestId:'save',revision:revealed.progressRevision,phase:'teach_back',explanation:'期間を分けます。'});
  const service=createAiCoachServiceOnPreparedDatabase(db,{provider:{maximumCostMilliYen:1,async generate(){
   await cafe.saveProgress('alice',start.id,{requestId:'another-tab',revision:saved.progressRevision,phase:'teach_back',explanation:'新しい説明です。'});
   return {reply:'古い返答',follow_up:'質問',source_ids:[],uncertainty:true,actualCostMilliYen:1};
  }}});
  await assert.rejects(service.request('alice',start.id,{requestId:'ai',attemptId:saved.attemptId,caseVersion:saved.caseVersion,progressRevision:saved.progressRevision,purpose:'explain_to_owner',explanation:saved.explanation,confirmed:true}),{code:'REVISION_CONFLICT'});
  assert.equal((await db.query<{status:string}>('SELECT status FROM ai_interaction_summaries')).rows[0].status,'reserved');
 }finally{await db.close();}
});

async function startSavedTeachBack(db: PGlite, now?: () => Date) {
 const cafe = await createCafeService(db, now); await db.exec(AI_COACH_SCHEMA);
 const start = await cafe.start('alice', 'start'); await cafe.submit('alice', start.id, { requestId: 'submit', optionId: 'h4r9' });
 const revealed = await cafe.confidence('alice', start.id, { requestId: 'confidence', confidence: null });
 const saved = await cafe.saveProgress('alice', start.id, { requestId: 'save', revision: revealed.progressRevision, phase: 'teach_back', explanation: '期間を分けます。' });
 const requestFor = (progress: typeof saved, requestId: string) => ({ requestId, attemptId: progress.attemptId!, caseVersion: progress.caseVersion,
  progressRevision: progress.progressRevision, purpose: 'explain_to_owner' as const, explanation: progress.explanation, confirmed: true as const });
 return { cafe, start, saved, requestFor };
}
const lateReply = { reply: '遅れた返答', follow_up: '質問', source_ids: [], uncertainty: true };

test('subscription reply that loses the revision race is marked failed and does not block later requests', async () => {
 const db = new PGlite();
 try {
  const { cafe, start, saved, requestFor } = await startSavedTeachBack(db);
  let calls = 0;
  const service = createAiCoachServiceOnPreparedDatabase(db, { provider: { billingMode: 'subscription', async generate() {
   calls++;
   if (calls === 1) await cafe.saveProgress('alice', start.id, { requestId: 'another-tab', revision: saved.progressRevision, phase: 'teach_back', explanation: '新しい説明です。' });
   return lateReply;
  } } });
  await assert.rejects(service.request('alice', start.id, requestFor(saved, 'late')), { code: 'REVISION_CONFLICT' });
  assert.equal((await db.query<{ status: string }>("SELECT status FROM ai_interaction_summaries WHERE request_id='late'")).rows[0].status, 'failed');
  const current = await cafe.saveProgress('alice', start.id, { requestId: 'next-screen', revision: saved.progressRevision + 1, phase: 'teach_back', explanation: '次の説明です。' });
  const next = await service.request('alice', start.id, requestFor(current, 'fresh'));
  assert.equal(next.mode, 'ai');
  assert.equal(next.reason, 'completed');
  assert.equal(calls, 2);
 } finally { await db.close(); }
});

test('subscription ignores a reservation older than the timeout window while metered billing keeps waiting for reconciliation', async () => {
 const db = new PGlite();
 try {
  let clock = Date.parse('2026-09-30T15:00:00Z');
  const now = () => new Date(clock);
  const { cafe, start, saved, requestFor } = await startSavedTeachBack(db, now);
  const metered = createAiCoachServiceOnPreparedDatabase(db, { now, provider: { maximumCostMilliYen: 1, async generate() {
   await cafe.saveProgress('alice', start.id, { requestId: 'another-tab', revision: saved.progressRevision, phase: 'teach_back', explanation: '新しい説明です。' });
   return { ...lateReply, actualCostMilliYen: 1 };
  } } });
  await assert.rejects(metered.request('alice', start.id, requestFor(saved, 'late')), { code: 'REVISION_CONFLICT' });
  assert.equal((await db.query<{ status: string }>("SELECT status FROM ai_interaction_summaries WHERE request_id='late'")).rows[0].status, 'reserved');
  const current = await cafe.saveProgress('alice', start.id, { requestId: 'next-screen', revision: saved.progressRevision + 1, phase: 'teach_back', explanation: '次の説明です。' });
  let subscriptionCalls = 0;
  const subscription = createAiCoachServiceOnPreparedDatabase(db, { now, provider: { billingMode: 'subscription', async generate() { subscriptionCalls++; return lateReply; } } });
  clock += 30_000;
  assert.equal((await subscription.request('alice', start.id, requestFor(current, 'inside-window'))).reason, 'request_pending');
  clock += 30_000;
  assert.equal((await metered.request('alice', start.id, requestFor(current, 'metered-after-window'))).reason, 'request_pending');
  assert.equal(subscriptionCalls, 0);
  assert.equal((await subscription.request('alice', start.id, requestFor(current, 'after-window'))).mode, 'ai');
  assert.equal(subscriptionCalls, 1);
  assert.equal((await db.query<{ status: string }>("SELECT status FROM ai_interaction_summaries WHERE request_id='late'")).rows[0].status, 'reserved');
 } finally { await db.close(); }
});

test('wrong-answer feedback accepts bounded learner questions without changing the attempt', async () => {
 const db = new PGlite();
 try {
  const cafe = await createCafeService(db); await db.exec(AI_COACH_SCHEMA);
  const started = await cafe.start('alice', 'chat-start');
  await cafe.submit('alice', started.id, { requestId: 'wrong-answer', optionId: 'c7m2' });
  const feedback = await cafe.confidence('alice', started.id, { requestId: 'confidence', confidence: null });
  const before = (await db.query('SELECT * FROM cafe_attempts')).rows;
  const seen: unknown[] = [];
  const service = createAiCoachServiceOnPreparedDatabase(db, { provider: { billingMode: 'subscription',
   async generate(input) { seen.push(input); return { reply: 'はい。ただし当期に受けた4か月分だけが費用です。', follow_up: '残り8か月分はどうなりますか？', source_ids: [], uncertainty: true }; },
  } });
  const base = { requestId: 'question-1', attemptId: feedback.attemptId!, caseVersion: feedback.caseVersion,
   progressRevision: feedback.progressRevision, purpose: 'rephrase' as const, explanation: '', confirmed: true as const };
  const question = '12万円を選んだけど、使った月だけ費用になるという理解で合ってる？';
  assert.throws(() => parseAiCoachRequest({ ...base, question: 'x'.repeat(601) }));
  assert.throws(() => parseAiCoachRequest({ ...base, question, recentTurns: [{ question: 'x', reply: '' }] }));
  assert.throws(() => parseAiCoachRequest({ ...base, question, recentTurns: Array(3).fill({ question: 'x', reply: 'y' }) }));
  assert.equal((await service.request('alice', started.id, { ...base, question })).mode, 'ai');
  assert.deepEqual(seen[0], { case_version: feedback.caseVersion, purpose: 'rephrase', explanation: '', question,
   recent_turns: undefined, selected_option_id: 'c7m2' });
  await assert.rejects(service.request('alice', started.id, { ...base, question: '別の質問' }), { code: 'REQUEST_CONFLICT' });
  const next = { ...base, requestId: 'question-2', question: '次はどうなる？', recentTurns: [{ question, reply: '当期は4か月分です。' }] };
  assert.equal((await service.request('alice', started.id, next)).mode, 'ai');
  assert.deepEqual((seen[1] as { recent_turns: unknown }).recent_turns, next.recentTurns);
  assert.deepEqual((await db.query('SELECT * FROM cafe_attempts')).rows, before);
  await assert.rejects(service.request('bob', started.id, { ...next, requestId: 'other-owner' }), { code: 'NOT_FOUND' });
  const progressed = await cafe.saveProgress('alice', started.id, { requestId: 'advance', revision: feedback.progressRevision,
   phase: 'teach_back', explanation: '' });
  assert.notEqual(progressed.progressRevision, feedback.progressRevision);
  await assert.rejects(service.request('alice', started.id, { ...next, requestId: 'stale' }), { code: 'REVISION_CONFLICT' });
 } finally { await db.close(); }
});
