import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createLearnerDatabase } from '../src/server/learner-database';
import { createLearnerProfileHandler } from '../src/http/learner-profile-handler';
import { createLearnerPlanHandler } from '../src/http/learner-plan-handler';
import { createLearnerHistoryHandler } from '../src/http/learner-history-handler';
import { createLearnerDataHandler } from '../src/http/learner-data-handler';
import { createLearnerCafeHandler } from '../src/http/learner-cafe-handler';
import { createLearnerMockExamHandler } from '../src/http/learner-mock-exam-handler';
import { DEVELOPMENT_CAFE_MATERIAL } from '../src/server/cafe-case';
import { createStudyService, createStudyServiceOnPreparedDatabase } from '../src/server/study-service';
import { createCafeService, createCafeServiceOnPreparedDatabase } from '../src/server/cafe-service';
import { createConfidenceService, createConfidenceServiceOnPreparedDatabase } from '../src/server/confidence-service';
import { createWeeklyPlanService, createWeeklyPlanServiceOnPreparedDatabase } from '../src/server/weekly-plan-service';
import { createDataServiceOnPreparedDatabase } from '../src/server/data-service';
import { initializeMockExamSchema, createMockExamServiceOnPreparedDatabase } from '../src/server/mock-exam-service';
import { DEVELOPMENT_CATALOG } from '../src/server/development-catalog';
import type { QueryExecutor, TransactionDatabase } from '../src/server/database';
import { initializeExamEvidenceSchema } from '../src/server/exam-evidence-service';
import { initializeReviewSchema, createReviewServiceOnPreparedDatabase, createTrustedReviewIngestionOnPreparedDatabase } from '../src/server/review-service';
import { REVIEW_RULES_VERSION } from '../src/domain/review-schedule';
import { AI_COACH_SCHEMA } from '../src/server/ai-coach-service';
import { createLearnerLearningEvidenceHandler } from '../src/http/learning-evidence-handler';
import { initializeDiagnosticSchema } from '../src/server/diagnostic-service';
import { initializeMasteryEvidenceSchema } from '../src/server/mastery-evidence-service';

const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const sqlState = (code: string) => (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === code;
const tables = ['owner_access', 'confidence_profiles', 'confidence_requests', 'weekly_plans', 'weekly_plan_requests',
  'study_sessions', 'study_requests', 'study_attempts', 'cafe_instances', 'cafe_attempts', 'cafe_requests', 'cafe_progress', 'cafe_confidence', 'mock_exam_records', 'mock_exam_requests',
  'exam_evidence_revisions', 'exam_evidence_requests', 'review_evidence_events', 'mastery_evidence_revisions', 'mastery_evidence_requests', 'ai_interaction_summaries', 'ai_coach_budgets', 'diagnostic_sessions', 'diagnostic_requests'];

test('全学習RLSと既存サービスを隔離DB・実ロールで統合検証する', async t => {
  const db = new PGlite();
  try {
    // Isolated Auth fixture only, never a replacement for real JWT verification.
    await db.exec(`create role anon nologin nosuperuser nobypassrls;
      create role authenticated nologin nosuperuser nobypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable security invoker set search_path='' as $$
        select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
      create function auth.uid() returns uuid language sql stable security invoker set search_path='' as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema auth to anon,authenticated;
      grant execute on function auth.uid(),auth.jwt() to anon,authenticated;
      alter default privileges in schema public grant all on tables to anon,authenticated;`);
    await createStudyService(db); await createCafeService(db);
    await createConfidenceService(db, DEVELOPMENT_CATALOG); await createWeeklyPlanService(db, DEVELOPMENT_CATALOG);
    await initializeMockExamSchema(db);
    await initializeExamEvidenceSchema(db); await initializeReviewSchema(db); await db.exec(AI_COACH_SCHEMA);
    await initializeDiagnosticSchema(db);
    await initializeMasteryEvidenceSchema(db);
    for (const file of ['learner-access.sql', 'learner-transaction.sql', 'learning-rls.sql', 'learning-evidence-rls.sql']) {
      await db.exec(await readFile(new URL(`../../supabase/schemas/${file}`, import.meta.url), 'utf8'));
    }
    for (const id of [alice, bob]) {
      await db.query('insert into auth.users values ($1)', [id]);
      await db.query("insert into public.learner_access(user_id,status) values ($1,'active')", [id]);
    }
    const raw = <T>(role: 'anon' | 'authenticated' | 'zeirishi_app', claims: unknown, action: (tx: QueryExecutor) => Promise<T>) => db.transaction(async tx => {
      await tx.exec(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
      return action(tx);
    });
    const base: TransactionDatabase = { transaction: action => db.transaction(async tx => {
      await tx.exec('set local role zeirishi_app'); return action(tx);
    }) };
    const services = async (id: string) => {
      const bound = await createLearnerDatabase(base, { getUser: async () => ({ error: false, user: { id, isAnonymous: false, emailConfirmed: true } }) });
      return { database: bound.database, profile: createConfidenceServiceOnPreparedDatabase(bound.database, DEVELOPMENT_CATALOG),
        cafe: createCafeServiceOnPreparedDatabase(bound.database), study: createStudyServiceOnPreparedDatabase(bound.database),
        plan: createWeeklyPlanServiceOnPreparedDatabase(bound.database, DEVELOPMENT_CATALOG), data: createDataServiceOnPreparedDatabase(bound.database) };
    };
    const a = await services(alice); const b = await services(bob);
    await t.test('全学習表を強制RLSにし、一般利用者から未開示の採点表も直接参照できない', async () => {
      const inventory = (await db.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public' order by tablename")).rows.map(row => row.tablename);
      assert.deepEqual(inventory, [...tables, 'learner_access'].sort(), 'new learning tables must join the security coverage');
      assert.equal((await db.query<{ allowed: boolean }>("select has_schema_privilege('zeirishi_app','public','CREATE') as allowed")).rows[0].allowed, false);
      for (const table of ['study_attempts', 'cafe_attempts', 'cafe_confidence', 'cafe_requests', 'confidence_requests', 'weekly_plan_requests', 'mock_exam_requests']) {
        assert.equal((await db.query<{ allowed: boolean }>("select has_table_privilege('zeirishi_app',$1,'UPDATE') as allowed", [`public.${table}`])).rows[0].allowed, false);
      }
      for (const table of tables) {
        const flags = (await db.query<{ enabled: boolean; forced: boolean }>(
          'select relrowsecurity as enabled,relforcerowsecurity as forced from pg_class where oid=$1::regclass', [`public.${table}`])).rows[0];
        assert.deepEqual(flags, { enabled: true, forced: true }, table);
        for (const operation of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          assert.equal((await db.query<{ allowed: boolean }>('select has_table_privilege($1,$2,$3) as allowed', ['zeirishi_app', `public.${table}`, operation])).rows[0].allowed, false);
        }
        for (const role of ['anon', 'authenticated'] as const) {
          for (const operation of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) {
            assert.equal((await db.query<{ allowed: boolean }>('select has_table_privilege($1,$2,$3) as allowed', [role, `public.${table}`, operation])).rows[0].allowed, false);
          }
          await assert.rejects(raw(role, { sub: alice, is_anonymous: false }, tx => tx.query(`select * from public.${table}`)), sqlState('42501'));
        }
      }
    });
    const aCase = await a.cafe.start(alice, crypto.randomUUID());
    const bCase = await b.cafe.start(bob, crypto.randomUUID());
    const bAnswer = await b.cafe.submit(bob, bCase.id, { requestId: crypto.randomUUID(), optionId: 'h4r9' });
    const bStudy = await b.study.start(bob, crypto.randomUUID());
    await t.test('正式証拠は本人読取と削除だけを許可し、学習者による正式証拠の挿入・更新を拒否する', async () => {
      const trusted = createTrustedReviewIngestionOnPreparedDatabase(db);
      for (const owner of [alice, bob]) {
        await trusted.append(owner, { eventId: 'formal-review', subjectId: 'bookkeeping', conceptId: 'prepaid', conceptVersion: 'v1',
          questionId: 'q1', questionVersion: 'v1', questionFamilyId: 'f1', scoringVersion: 'v1', rulesVersion: REVIEW_RULES_VERSION,
          occurredAt: '2026-09-01T00:00:00.000Z', sourceKind: 'formal', reviewStatus: 'approved', scoringAuthority: 'reviewed_rules',
          measurementQuality: 'verified', outcome: 'met', hintsUsed: 0, aiAnswerViewed: false });
        await db.query("INSERT INTO exam_evidence_revisions VALUES ($1,'exam',1,'2026-09-01','{}',false,null)", [owner]);
        await db.query("INSERT INTO exam_evidence_requests VALUES ($1,'request','exam','fingerprint')", [owner]);
        // Minimal rows test SQL isolation, not evidence eligibility or expert approval.
        await db.query("INSERT INTO mastery_evidence_revisions(owner_id,id,revision,updated_at,document,withdrawn,reason) VALUES ($1,'mastery',1,'2026-09-01','{}',false,null)", [owner]);
        await db.query("INSERT INTO mastery_evidence_requests VALUES ($1,'mastery-request','mastery','fingerprint')", [owner]);
      }
      assert.equal((await createReviewServiceOnPreparedDatabase(a.database).get(alice)).items.length, 1);
      for (const table of ['exam_evidence_revisions', 'exam_evidence_requests', 'review_evidence_events', 'mastery_evidence_revisions', 'mastery_evidence_requests']) {
        assert.equal((await a.database.transaction(tx => tx.query(`SELECT * FROM ${table} WHERE owner_id=$1`, [bob]))).rows.length, 0);
        await assert.rejects(a.database.transaction(tx => tx.query(`INSERT INTO ${table} SELECT * FROM ${table} WHERE false`)), sqlState('42501'));
        await assert.rejects(a.database.transaction(tx => tx.query(`UPDATE ${table} SET owner_id=owner_id`)), sqlState('42501'));
        await a.database.transaction(tx => tx.query(`DELETE FROM ${table} WHERE owner_id=$1`, [bob]));
        assert.equal((await db.query(`SELECT * FROM ${table} WHERE owner_id=$1`, [bob])).rows.length, 1);
      }
      await a.database.transaction(tx => tx.query("INSERT INTO ai_coach_budgets(month) VALUES ('2026-09')"));
      await a.database.transaction(tx => tx.query("UPDATE ai_coach_budgets SET reserved_milliyen=1 WHERE month='2026-09'"));
      await assert.rejects(a.database.transaction(tx => tx.query('DELETE FROM ai_coach_budgets')), sqlState('42501'));
      const insertSummary = (tx: QueryExecutor, owner: string, caseId: string, attemptId: string) => tx.query(`INSERT INTO ai_interaction_summaries
        (owner_id,request_id,instance_id,attempt_id,case_version,progress_revision,purpose,fingerprint,status,reserved_milliyen,month,created_at)
        VALUES ($1,'ai-test',$2,$3,$4,0,'rephrase','fingerprint','disabled',0,'2026-09','2026-09-01')`, [owner, caseId, attemptId, bCase.caseVersion]);
      await assert.rejects(a.database.transaction(tx => insertSummary(tx, alice, bCase.id, bAnswer.attemptId!)), sqlState('42501'));
      await b.database.transaction(tx => insertSummary(tx, bob, bCase.id, bAnswer.attemptId!));
      assert.equal((await a.database.transaction(tx => tx.query('SELECT * FROM ai_interaction_summaries'))).rows.length, 0);
      await a.database.transaction(tx => tx.query('DELETE FROM ai_interaction_summaries'));
      assert.equal((await b.database.transaction(tx => tx.query('SELECT * FROM ai_interaction_summaries'))).rows.length, 1);
    });
    await t.test('模試参考記録も本人固定のRLSと親receipt制約に従い、他人の取得・書替えを拒否する', async () => {
      const own = createMockExamServiceOnPreparedDatabase(a.database);
      const other = createMockExamServiceOnPreparedDatabase(b.database);
      const input = { id: crypto.randomUUID(), requestId: crypto.randomUUID(), revision: 0,
        record: { subjectId: 'bookkeeping' as const, examYear: 2026, provider: '本人参考', examId: '模試1',
          completedOn: '2026-01-01', score: 60, maxScore: 100, elapsedMinutes: 120, rank: null, unseen: null } };
      const saved = await own.save(alice, input);
      assert.deepEqual(await own.save(alice, input), saved);
      assert.equal(saved.evidenceQualification, 'self_report_only');
      assert.deepEqual(await other.list(bob), []);
      await assert.rejects(other.get(bob, input.id), /NOT_FOUND/);
      await assert.rejects(own.list(bob), sqlState('42501'));
      await assert.rejects(a.database.transaction(tx => tx.query('update mock_exam_records set owner_id=$1', [bob])), sqlState('42501'));
      await assert.rejects(b.database.transaction(tx => tx.query("insert into mock_exam_requests values ($1,$2,$3,'x','save','{}')", [bob, crypto.randomUUID(), input.id])), sqlState('42501'));
      assert.equal((await a.data.export(alice)).mockExamRecords[0].id, input.id);
      await other.save(bob, { ...input, id: crypto.randomUUID(), requestId: crypto.randomUUID() });
    });
    await t.test('本人保存・回答開示順・週計画・他人参照拒否を同じ業務SQLで維持する', async () => {
      await a.profile.save(alice, { requestId: crypto.randomUUID(), revision: 0, reports: [], examSubjects: ['bookkeeping'] });
      assert.equal((await b.profile.get(bob)).revision, 0);
      assert.equal((await a.plan.get(alice)).planRecord, null);
      const planInput = { requestId: crypto.randomUUID(), revision: 0, weeklyMinutes: 30, excludedIds: [], adjustmentReason: '' };
      const savedPlan = await a.plan.save(alice, planInput);
      assert.equal(savedPlan.planRecord?.weeklyMinutes, 30);
      assert.deepEqual(await a.plan.save(alice, planInput), savedPlan);
      assert.equal((await b.plan.get(bob)).planRecord, null);
      await assert.rejects(a.cafe.get(alice, bCase.id), /NOT_FOUND/);
      const answer = await a.cafe.submit(alice, aCase.id, { requestId: crypto.randomUUID(), optionId: 'h4r9' });
      assert.equal(answer.result, null);
      assert.equal((await a.data.export(alice)).cafeCases[0].result, null);
      const revealed = await a.cafe.confidence(alice, aCase.id, { requestId: crypto.randomUUID(), confidence: 'normal' });
      assert.equal(revealed.result?.correct, true);
      assert.equal((await a.cafe.history(alice)).length, 1);
    });
    await t.test('SQLを直接発行しても他人のownerへの付替え・他人の親を参照する挿入を拒否する', async () => {
      await assert.rejects(a.database.transaction(tx => tx.query('update confidence_profiles set owner_id=$1', [bob])), sqlState('42501'));
      const otherHash = createHash('sha256').update(`zeirishi-local-owner-v1:${bob}`).digest('hex');
      await assert.rejects(a.database.transaction(tx => tx.query('insert into owner_access(owner_hash) values ($1)', [otherHash])), sqlState('42501'));
      await assert.rejects(a.database.transaction(tx => tx.query("insert into cafe_confidence values ($1,'normal',now()::text)", [bAnswer.attemptId])), sqlState('42501'));
      await assert.rejects(a.database.transaction(tx => tx.query(
        "insert into cafe_attempts values ($1,$2,$3,'test',now()::text,'test','{}')", [crypto.randomUUID(), bCase.id, alice])), sqlState('42501'));
      await assert.rejects(a.database.transaction(tx => tx.query(
        "insert into study_requests values ($1,$2,$3,'start','test','{}')", [alice, crypto.randomUUID(), bStudy.id])), sqlState('42501'));
      const other = await a.database.transaction(tx => tx.query('select * from cafe_instances where id=$1', [bCase.id]));
      assert.equal(other.rows.length, 0);
    });
    await t.test('Alice画面の削除確認をBob認証へ持ち越してもDB取得前に拒否し両者のデータを保全する', async () => {
      let acquisitions = 0;
      const before = await b.data.export(bob);
      const handler = createLearnerDataHandler({
        getDatabase: () => { acquisitions++; return base; },
        config: () => ({ url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'test-only', appOrigin: 'https://coach.example' }),
        context: () => ({ headers: new Headers(), reader: {
          getUser: async () => ({ error: false, user: { id: bob, isAnonymous: false, emailConfirmed: true } }),
          getAccess: async () => ({ userId: bob, status: 'active' }),
        } }),
      });
      const response = await handler(new Request('https://coach.example/api/data', {
        method: 'POST', headers: { origin: 'https://coach.example', 'content-type': 'application/json', 'X-Zeirishi-Learner': alice },
        body: JSON.stringify({ action: 'delete', confirmation: 'DELETE_MY_LEARNING_DATA' }),
      }));
      assert.equal(response.status, 409);
      assert.deepEqual(await response.json(), { error: 'AUTH_IDENTITY_CHANGED' });
      assert.equal(acquisitions, 0);
      const after = await b.data.export(bob);
      assert.deepEqual(after.profile, before.profile);
      assert.deepEqual(after.studySessions, before.studySessions);
      assert.deepEqual(after.cafeCases, before.cafeCases);
      assert.deepEqual(after.weeklyPlan, before.weeklyPlan);
      assert.equal((await a.data.export(alice)).cafeCases.length, 1);
    });
    await t.test('削除は本人だけで、失効・匿名・claims欠落はraw SQLでも見えない', async () => {
      assert.equal((await a.data.export(alice)).masteryEvidence.length, 1);
      assert.equal((await b.data.export(bob)).masteryEvidence.length, 1);
      await a.data.delete(alice);
      for (const table of ['mastery_evidence_requests', 'mastery_evidence_revisions']) {
        assert.equal((await db.query(`SELECT * FROM ${table} WHERE owner_id=$1`, [alice])).rows.length, 0);
        assert.equal((await db.query(`SELECT * FROM ${table} WHERE owner_id=$1`, [bob])).rows.length, 1);
      }
      assert.equal((await b.data.export(bob)).cafeCases.length, 1);
      await assert.rejects(a.profile.get(alice), /OWNER_REVOKED/);
      await db.query("update learner_access set status='revoked',revoked_at=now() where user_id=$1", [bob]);
      await assert.rejects(b.profile.get(bob), /INVITATION_REQUIRED/);
      for (const claims of [{ sub: bob, is_anonymous: false }, { sub: alice, is_anonymous: true }, { sub: alice }, {}]) {
        for (const table of tables) assert.equal((await raw('zeirishi_app', claims, tx => tx.query(`select * from public.${table}`))).rows.length, 0, table);
      }
    });
    await t.test('本人プロフィール・週計画・履歴HTTPから実ロール・RLS・保存・失効拒否まで接続する', async () => {
      const userId = '33333333-3333-4333-8333-333333333333';
      await db.query('insert into auth.users values ($1)', [userId]);
      await db.query("insert into public.learner_access(user_id,status) values ($1,'active')", [userId]);
      const options = { catalog: [], getDatabase: () => base,
        config: () => ({ url: 'https://abcdefghijklmnopqrst.supabase.co', publishableKey: 'test-only', appOrigin: 'https://coach.example' }),
        // Auth is injected; all role/claims/lock/RLS and business SQL below are real.
        context: () => ({ headers: new Headers(), reader: {
          getUser: async () => ({ error: false, user: { id: userId, isAnonymous: false, emailConfirmed: true } }),
          getAccess: async () => ({ userId, status: 'active' }),
        } }),
      };
      const handler = createLearnerProfileHandler(options);
      const planHandler = createLearnerPlanHandler({ ...options, candidates: [] });
      const historyHandler = createLearnerHistoryHandler(options);
      const dataHandler = createLearnerDataHandler(options);
      const mockHandler = createLearnerMockExamHandler(options);
      const evidenceHandler = createLearnerLearningEvidenceHandler(options);
      const evidenceRequest = () => new Request('https://coach.example/api/learning-evidence?subjectId=bookkeeping&examYear=2026&criterionVersion=v1',
        { headers: { 'X-Zeirishi-Learner': userId } });
      const evidenceResponse = await evidenceHandler(evidenceRequest());
      assert.equal(evidenceResponse.status, 200);
      const evidence = await evidenceResponse.json();
      assert.deepEqual(evidence.review, { evidenceCount: 0, correctionCount: 0, items: [] });
      assert.deepEqual(evidence.mastery, []);
      assert.equal((await evidenceHandler(new Request(evidenceRequest(), { method: 'POST', headers: {
        'X-Zeirishi-Learner': userId, origin: 'https://coach.example', 'content-type': 'application/json' }, body: '{}' }))).status, 405);
      const mockInput = { id: crypto.randomUUID(), requestId: crypto.randomUUID(), revision: 0,
        record: { subjectId: 'bookkeeping', examYear: 2026, provider: '本人参考', examId: '模試1', completedOn: '2026-01-01',
          score: 60, maxScore: 100, elapsedMinutes: null, rank: null, unseen: null } };
      const mockRequest = (expected = userId) => new Request('https://coach.example/api/mock-exams', { method: 'POST',
        headers: { 'X-Zeirishi-Learner': expected, origin: 'https://coach.example', 'content-type': 'application/json', cookie: `zc-user=${bob}` }, body: JSON.stringify(mockInput) });
      const mockSaved = await mockHandler(mockRequest());
      assert.equal(mockSaved.status, 200);
      const mockData = await mockSaved.json();
      assert.equal(mockData.developmentOnly, false);
      assert.equal(mockData.item.evidenceQualification, 'self_report_only');
      assert.deepEqual(await (await mockHandler(mockRequest())).json(), mockData);
      assert.equal((await mockHandler(mockRequest(bob))).status, 409);
      const crossSite = mockRequest(); crossSite.headers.set('origin', 'https://other.example');
      assert.equal((await mockHandler(crossSite)).status, 403);
      const otherRecord = (await db.query<{ id: string }>('select id from mock_exam_records where owner_id=$1', [bob])).rows[0];
      assert.ok(otherRecord);
      assert.equal((await mockHandler(new Request(`https://coach.example/api/mock-exams?id=${otherRecord.id}`,
        { headers: { 'X-Zeirishi-Learner': userId } }))).status, 404);
      // Injection is a test fixture, not publication approval of this synthetic material.
      const cafeHandler = createLearnerCafeHandler({ ...options, getMaterial: () => DEVELOPMENT_CAFE_MATERIAL });
      const input = { requestId: crypto.randomUUID(), revision: 0, reports: [], examSubjects: ['bookkeeping'] };
      const request = () => new Request('https://coach.example/api/profile', { method: 'POST',
        headers: { 'X-Zeirishi-Learner': userId, origin: 'https://coach.example', 'content-type': 'application/json', cookie: `zc-user=${bob}` }, body: JSON.stringify(input) });
      const response = await handler(request());
      assert.equal(response.status, 200);
      const saved = await response.json();
      assert.equal(saved.profile.revision, 1);
      assert.deepEqual(await (await handler(request())).json(), saved);
      assert.equal((await db.query('select * from confidence_profiles where owner_id=$1', [userId])).rows.length, 1);
      assert.equal((await db.query('select * from confidence_profiles where owner_id=$1', [bob])).rows.length, 0);
      const planInput = { requestId: crypto.randomUUID(), revision: 0, weeklyMinutes: 90, excludedIds: [], adjustmentReason: '' };
      const planRequest = (input: unknown = planInput, query = '') => new Request(`https://coach.example/api/plan${query}`, { method: 'POST',
        headers: { 'X-Zeirishi-Learner': userId, origin: 'https://coach.example', 'content-type': 'application/json', cookie: `zc-user=${bob}` }, body: JSON.stringify(input) });
      const planned = await planHandler(planRequest());
      assert.equal(planned.status, 200);
      const plan = await planned.json();
      assert.equal(plan.developmentOnly, false);
      assert.deepEqual(plan.candidates, []);
      assert.equal(plan.planRecord.plan.remainingMinutes, 90);
      assert.equal(plan.planRecord.plan.allocatedMinutes, 0);
      assert.equal(plan.planRecord.plan.status, 'inventory-shortage');
      assert.deepEqual(await (await planHandler(planRequest())).json(), plan);
      assert.equal((await planHandler(planRequest({ ...planInput, requestId: crypto.randomUUID() }))).status, 409);
      assert.equal((await planHandler(planRequest(planInput, '?owner=other'))).status, 400);
      assert.equal((await planHandler(planRequest({ ...planInput, requestId: crypto.randomUUID(), revision: 1,
        excludedIds: ['prepaid-expenses'], adjustmentReason: 'synthetic case cannot be used' }))).status, 400);
      assert.equal((await db.query('select * from weekly_plans where owner_id=$1', [bob])).rows.length, 0);
      const cafeRequest = (body: unknown) => new Request('https://coach.example/api/cafe', { method: 'POST',
        headers: { 'X-Zeirishi-Learner': userId, origin: 'https://coach.example', 'content-type': 'application/json', cookie: `zc-user=${bob}` }, body: JSON.stringify(body) });
      const start = { action: 'start', requestId: crypto.randomUUID() };
      const started = await cafeHandler(cafeRequest(start));
      assert.equal(started.status, 200);
      const practice = (await started.json()).session;
      assert.equal((await (await cafeHandler(cafeRequest(start))).json()).session.id, practice.id);
      const submitted = await cafeHandler(cafeRequest({ action: 'submit', caseId: practice.id, requestId: crypto.randomUUID(), optionId: 'h4r9' }));
      assert.equal(submitted.status, 200);
      assert.equal((await submitted.json()).session.result, null);
      const historyRequest = () => new Request('https://coach.example/api/history', { headers: { 'X-Zeirishi-Learner': userId, cookie: `zc-user=${bob}` } });
      const hidden = await historyHandler(historyRequest());
      assert.equal(hidden.status, 200);
      const history = await hidden.json();
      assert.equal(history.items.length, 1);
      assert.equal(history.items[0].caseId, practice.id);
      assert.equal(history.items[0].correct, null);
      assert.equal(history.items[0].evidenceQualification, 'practice_only');
      const exportRequest = () => new Request('https://coach.example/api/data', { headers: { 'X-Zeirishi-Learner': userId, cookie: `zc-user=${bob}` } });
      const exported = await dataHandler(exportRequest());
      assert.equal(exported.status, 200);
      assert.match(exported.headers.get('content-disposition')!, /attachment/);
      const snapshot = await exported.json();
      assert.equal(snapshot.formatVersion, 'zeirishi-learning-data-v1');
      assert.equal(snapshot.developmentOnly, false);
      assert.equal(snapshot.cafeCases.length, 1);
      assert.equal(snapshot.cafeCases[0].result, null);
      const revealed = await cafeHandler(cafeRequest({ action: 'confidence', caseId: practice.id, requestId: crypto.randomUUID(), confidence: null }));
      assert.equal(revealed.status, 200);
      assert.equal((await revealed.json()).session.result.correct, true);
      assert.equal((await (await historyHandler(historyRequest())).json()).items[0].correct, true);
      const deleteRequest = () => new Request('https://coach.example/api/data', { method: 'POST',
        headers: { 'X-Zeirishi-Learner': userId, origin: 'https://coach.example', 'content-type': 'application/json', cookie: `zc-user=${bob}` },
        body: JSON.stringify({ action: 'delete', confirmation: 'DELETE_MY_LEARNING_DATA' }) });
      const deletion = await dataHandler(deleteRequest());
      assert.equal(deletion.status, 200);
      const deleted = await deletion.json();
      assert.equal(deleted.deleted, true);
      assert.equal(deleted.accountDeleted, false);
      assert.equal(deleted.backupsDeleted, false);
      assert.deepEqual(await (await dataHandler(deleteRequest())).json(), deleted);
      for (const table of tables.filter(name => !['owner_access', 'cafe_confidence', 'ai_coach_budgets'].includes(name))) {
        assert.equal((await db.query(`select * from ${table} where owner_id=$1`, [userId])).rows.length, 0, table);
      }
      assert.equal((await db.query('select * from auth.users where id=$1', [userId])).rows.length, 1);
      assert.equal((await db.query("select * from learner_access where user_id=$1 and status='active'", [userId])).rows.length, 1);
      assert.equal((await db.query('select * from cafe_instances where owner_id=$1', [bob])).rows.length, 1);
      const afterDelete = await dataHandler(exportRequest());
      assert.equal(afterDelete.status, 401);
      assert.equal(afterDelete.headers.get('content-disposition'), null);
      assert.equal((await handler(request())).status, 401);
      assert.equal((await historyHandler(historyRequest())).status, 401);
      assert.equal((await mockHandler(mockRequest())).status, 401);
      assert.equal((await evidenceHandler(evidenceRequest())).status, 401);
      assert.equal((await cafeHandler(cafeRequest(start))).status, 401);
      await db.query("update learner_access set status='revoked',revoked_at=now() where user_id=$1", [userId]);
      // Even an earlier active Auth-side check cannot override the fresh transaction lock.
      const revoked = await handler(request());
      assert.equal(revoked.status, 403);
      assert.deepEqual(await revoked.json(), { error: 'INVITATION_REQUIRED' });
      assert.equal((await planHandler(planRequest())).status, 403);
      assert.equal((await historyHandler(historyRequest())).status, 403);
      assert.equal((await mockHandler(mockRequest())).status, 403);
    });
    await t.test('実RLSの再開一覧は本人の有効な未提出案件だけを公開し選択・本文・採点を含めない', async () => {
      const learner = '44444444-4444-4444-8444-444444444444';
      const other = '55555555-5555-4555-8555-555555555555';
      for (const id of [learner, other]) {
        await db.query('insert into auth.users values ($1)', [id]);
        await db.query("insert into learner_access(user_id,status) values ($1,'active')", [id]);
      }
      const bound = await services(learner);
      const otherBound = await services(other);
      let at = new Date('2026-09-08T00:00:00Z');
      const cafe = createCafeServiceOnPreparedDatabase(bound.database, () => at);
      const otherCafe = createCafeServiceOnPreparedDatabase(otherBound.database, () => at);
      const ownCase = await cafe.start(learner, crypto.randomUUID());
      const otherCase = await otherCafe.start(other, crypto.randomUUID());
      await cafe.save(learner, ownCase.id, { requestId: crypto.randomUUID(), revision: 0, optionId: 'h4r9', phase: 'decision' });
      const drafts = await cafe.drafts(learner);
      assert.equal(drafts.length, 1);
      assert.equal(drafts[0].caseId, ownCase.id);
      assert.equal(drafts[0].phase, 'decision');
      assert.deepEqual(Object.keys(drafts[0]).sort(), ['caseId', 'caseVersion', 'expiresAt', 'phase', 'savedAt']);
      await assert.rejects(cafe.drafts(other), sqlState('42501'));
      await assert.rejects(cafe.get(learner, otherCase.id), /NOT_FOUND/);
      assert.equal((await otherCafe.drafts(other))[0].caseId, otherCase.id);
      await cafe.submit(learner, ownCase.id, { requestId: crypto.randomUUID(), optionId: 'h4r9' });
      assert.deepEqual(await cafe.drafts(learner), []);
      const expiring = await cafe.start(learner, crypto.randomUUID());
      at = new Date(expiring.expiresAt);
      assert.deepEqual(await cafe.drafts(learner), []);
      assert.equal((await cafe.get(learner, expiring.id)).status, 'expired');
    });
  } finally { await db.close(); }
});
