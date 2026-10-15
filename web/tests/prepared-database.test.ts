import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createStudyService, createStudyServiceOnPreparedDatabase } from '../src/server/study-service';
import { createCafeService, createCafeServiceOnPreparedDatabase } from '../src/server/cafe-service';
import { createConfidenceService, createConfidenceServiceOnPreparedDatabase } from '../src/server/confidence-service';
import { createWeeklyPlanService, createWeeklyPlanServiceOnPreparedDatabase } from '../src/server/weekly-plan-service';
import { createDataServiceOnPreparedDatabase } from '../src/server/data-service';
import { initializeMockExamSchema, createMockExamServiceOnPreparedDatabase } from '../src/server/mock-exam-service';
import { DEVELOPMENT_CATALOG } from '../src/server/development-catalog';
import type { TransactionDatabase } from '../src/server/database';
import { initializeExamEvidenceSchema } from '../src/server/exam-evidence-service';
import { initializeReviewSchema, createReviewServiceOnPreparedDatabase } from '../src/server/review-service';
import { initializeMasteryEvidenceSchema, createMasteryEvidenceReaderOnPreparedDatabase } from '../src/server/mastery-evidence-service';
import { AI_COACH_SCHEMA } from '../src/server/ai-coach-service';
import { initializeDiagnosticSchema } from '../src/server/diagnostic-service';

test('prepared services reuse learning SQL without schema mutation and preserve owner separation', async () => {
  const local = new PGlite();
  await local.waitReady;
  try {
    // Only development bootstrap prepares this isolated database. No external migration.
    await createStudyService(local);
    await createCafeService(local);
    await createConfidenceService(local, DEVELOPMENT_CATALOG);
    await createWeeklyPlanService(local, DEVELOPMENT_CATALOG);
    await initializeMockExamSchema(local);
    await initializeExamEvidenceSchema(local);
    await initializeReviewSchema(local);
    await initializeMasteryEvidenceSchema(local);
    await local.exec(AI_COACH_SCHEMA);
    await initializeDiagnosticSchema(local);
    const statements: string[] = [];
    const prepared: TransactionDatabase = {
      transaction: operation => local.transaction(tx => operation({
        query: async <Row>(sql: string, params?: unknown[]) => {
          statements.push(sql);
          assert.doesNotMatch(sql, /\b(CREATE|ALTER|DROP|TRUNCATE)\b/i);
          return tx.query<Row>(sql, params);
        },
      })),
    };
    const profile = createConfidenceServiceOnPreparedDatabase(prepared, DEVELOPMENT_CATALOG);
    const study = createStudyServiceOnPreparedDatabase(prepared);
    const cafe = createCafeServiceOnPreparedDatabase(prepared);
    const plan = createWeeklyPlanServiceOnPreparedDatabase(prepared, DEVELOPMENT_CATALOG);
    const data = createDataServiceOnPreparedDatabase(prepared);
    const mocks = createMockExamServiceOnPreparedDatabase(prepared);
    const alice = 'prepared-alice'; const bob = 'prepared-bob';
    assert.deepEqual(await createReviewServiceOnPreparedDatabase(prepared).get(alice), { items: [], evidenceCount: 0, correctionCount: 0 });
    assert.deepEqual(await createMasteryEvidenceReaderOnPreparedDatabase(prepared).evaluateSubject(alice, 'bookkeeping'), []);
    await profile.save(alice, { requestId: crypto.randomUUID(), revision: 0, reports: [], examSubjects: ['bookkeeping'] });
    assert.deepEqual((await profile.get(alice)).examSubjects, ['bookkeeping']);
    assert.equal((await profile.get(bob)).revision, 0);
    await study.start(alice, crypto.randomUUID());
    await cafe.start(alice, crypto.randomUUID());
    assert.equal((await plan.get(alice)).planRecord, null);
    const record = { subjectId: 'bookkeeping' as const, examYear: 2026, provider: '本人参考記録', examId: '第1回',
      completedOn: '2026-01-01', score: 60, maxScore: 100, elapsedMinutes: null, rank: null, unseen: null };
    const own = await mocks.save(alice, { id: crypto.randomUUID(), requestId: crypto.randomUUID(), revision: 0, record });
    const other = await mocks.save(bob, { id: crypto.randomUUID(), requestId: crypto.randomUUID(), revision: 0, record });
    await assert.rejects(mocks.get(bob, own.id), /NOT_FOUND/);
    const snapshot = await data.export(alice);
    assert.equal(snapshot.studySessions.length, 1);
    assert.equal(snapshot.cafeCases.length, 1);
    assert.deepEqual(snapshot.masteryEvidence, []);
    assert.deepEqual(snapshot.mockExamRecords, [own]);
    assert.deepEqual((await data.export(bob)).mockExamRecords, [other]);
    assert.equal((await data.export(bob)).cafeCases.length, 0);
    await data.delete(alice);
    await assert.rejects(() => profile.get(alice), /OWNER_REVOKED/);
    await assert.rejects(mocks.list(alice), /OWNER_REVOKED/);
    assert.deepEqual(await mocks.list(bob), [other]);
    for (const table of ['mock_exam_requests', 'mock_exam_records']) {
      assert.equal((await local.query(`SELECT * FROM ${table} WHERE owner_id=$1`, [alice])).rows.length, 0);
      assert.equal((await local.query(`SELECT * FROM ${table} WHERE owner_id=$1`, [bob])).rows.length, 1);
    }
    assert.equal((await profile.get(bob)).revision, 0);
    assert.ok(statements.length > 20);
  } finally { await local.close(); }
});
