import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { StudyError } from '../src/domain/types';
import { createStudyService } from '../src/server/study-service';
import { createCafeService } from '../src/server/cafe-service';
import { createConfidenceService } from '../src/server/confidence-service';
import { createDataService } from '../src/server/data-service';
import { createWeeklyPlanService } from '../src/server/weekly-plan-service';
import { createMockExamService } from '../src/server/mock-exam-service';
import { DEVELOPMENT_CATALOG } from '../src/server/development-catalog';

const revoked = (error: unknown) => error instanceof StudyError && error.code === 'OWNER_REVOKED' && error.status === 401;
const answer = { insurance: '30000', equipment: '240000', explanation: '本人の説明' };
async function initialize(db: PGlite, now: () => Date) {
  const study = await createStudyService(db, now);
  const cafe = await createCafeService(db, now);
  const confidence = await createConfidenceService(db, [], now);
  const data = await createDataService(db, now);
  const plan = await createWeeklyPlanService(db, DEVELOPMENT_CATALOG, now);
  const mocks = await createMockExamService(db, now);
  return { study, cafe, confidence, data, plan, mocks };
}
type Services = Awaited<ReturnType<typeof initialize>>;
async function populate(services: Services, owner: string) {
  const { study, cafe, confidence } = services;
  await confidence.save(owner, { requestId: 'profile', revision: 0, reports: [], examSubjects: ['bookkeeping'] });
  await services.plan.save(owner, { requestId: 'plan', revision: 0, weeklyMinutes: 60, excludedIds: [], adjustmentReason: '' });
  await services.mocks.save(owner, { id: crypto.randomUUID(), requestId: crypto.randomUUID(), revision: 0,
    record: { subjectId: 'bookkeeping', examYear: 2026, provider: '本人参考', examId: '模試1', completedOn: '2026-01-01',
      score: 60, maxScore: 100, elapsedMinutes: null, rank: null, unseen: null } });
  const legacy = await study.start(owner, 'legacy-start');
  await study.save(owner, legacy.id, { requestId: 'legacy-save', revision: 0, answer: { ...answer, explanation: `${owner}-legacy` } });
  await study.submit(owner, legacy.id, { requestId: 'legacy-submit', answer: { ...answer, explanation: `${owner}-legacy` } });
  const lesson = await cafe.start(owner, 'cafe-start');
  await cafe.submit(owner, lesson.id, { requestId: 'cafe-submit', optionId: 'h4r9' });
  const disclosed = await cafe.confidence(owner, lesson.id, { requestId: 'confidence', confidence: null });
  await cafe.saveProgress(owner, lesson.id, { requestId: 'teach', revision: disclosed.progressRevision,
    phase: 'teach_back', explanation: `${owner}-private-draft` });
  return { legacy, lesson };
}

test('本人exportは機械receipt/他owner/未開示正誤を含めず、期限切れ下書きを先に消去する', async () => {
  const db = new PGlite();
  let at = new Date('2026-09-08T00:00:00Z');
  try {
    const services = await initialize(db, () => at);
    const alice = await populate(services, 'alice');
    await populate(services, 'bob');
    const hidden = await services.cafe.start('alice', 'hidden-start');
    await services.cafe.submit('alice', hidden.id, { requestId: 'hidden-submit', optionId: 'h4r9' });
    const legacyDraft = await services.study.start('alice', 'draft-start');
    await services.study.save('alice', legacyDraft.id, { requestId: 'draft-save', revision: 0,
      answer: { ...answer, explanation: 'expire-this-unsubmitted-draft' } });
    const exported = await services.data.export('alice');
    assert.equal(exported.formatVersion, 'zeirishi-local-data-v1');
    assert.equal(exported.developmentOnly, true);
    assert.equal(exported.mockExamRecords.length, 1);
    assert.equal(exported.mockExamRecords[0].evidenceQualification, 'self_report_only');
    assert.match(exported.notice, /バックアップからの削除は未検証/);
    assert.deepEqual(exported.profile.examSubjects, ['bookkeeping']);
    assert.equal(exported.weeklyPlan?.plan.sessions.length, 1);
    assert.equal(exported.weeklyPlan?.profileRevision, 1);
    assert.equal(exported.studySessions.length, 2);
    assert.equal(exported.cafeCases.length, 2);
    assert.equal(exported.cafeCases.find(item => item.id === alice.lesson.id)?.explanation, 'alice-private-draft');
    assert.equal(exported.cafeCases.find(item => item.id === alice.lesson.id)?.result?.correct, true);
    const hiddenExport = exported.cafeCases.find(item => item.id === hidden.id)!;
    assert.equal(hiddenExport.confidenceFixed, false);
    assert.equal(hiddenExport.result, null);
    assert.equal(hiddenExport.optionId, 'h4r9');
    const serialized = JSON.stringify(exported);
    assert.equal(serialized.includes('bob'), false);
    for (const internal of ['owner_id', 'owner_hash', 'request_id', 'fingerprint', 'cafe_requests', 'confidence_requests']) {
      assert.equal(serialized.includes(internal), false, internal);
    }
    const bobBefore = await services.data.export('bob');
    assert.equal(bobBefore.cafeCases[0].explanation, 'bob-private-draft');
    at = new Date('2026-09-16T00:00:00Z');
    const expired = await services.data.export('alice');
    assert.equal(expired.cafeCases.find(item => item.id === alice.lesson.id)?.explanation, '');
    assert.equal(expired.cafeCases.find(item => item.id === hidden.id)?.result, null);
    assert.equal(expired.studySessions.find(item => item.id === legacyDraft.id)?.answer, null);
    assert.equal(JSON.stringify(expired).includes('expire-this-unsubmitted-draft'), false);
    assert.equal(JSON.stringify(expired).includes('alice-private-draft'), false);
    assert.equal(expired.studySessions.find(item => item.id === alice.legacy.id)?.answer?.explanation, 'alice-legacy');
    assert.equal((await db.query('SELECT 1 FROM cafe_progress WHERE owner_id=$1', ['alice'])).rows.length, 0);
  } finally { await db.close(); }
});

test('削除は模試参考記録を含む本人データを一括消去し、再送安定・旧識別子失効・他owner保全を守る', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zeirishi-data-service-'));
  let db = new PGlite(directory);
  try {
    const now = () => new Date('2026-09-08T00:00:00Z');
    const services = await initialize(db, now);
    const alice = await populate(services, 'alice');
    await populate(services, 'bob');
    const bobBefore = await services.data.export('bob');
    const deleted = await services.data.delete('alice');
    assert.equal(deleted.deleted, true);
    assert.deepEqual(await services.data.delete('alice'), deleted);
    assert.deepEqual(await services.data.export('bob'), bobBefore);
    for (const table of ['study_sessions', 'study_requests', 'study_attempts', 'cafe_instances', 'cafe_requests',
      'cafe_attempts', 'cafe_progress', 'confidence_profiles', 'confidence_requests', 'weekly_plans', 'weekly_plan_requests', 'mock_exam_records', 'mock_exam_requests']) {
      assert.equal((await db.query(`SELECT 1 FROM ${table} WHERE owner_id=$1`, ['alice'])).rows.length, 0, table);
      assert.ok((await db.query(`SELECT 1 FROM ${table} WHERE owner_id=$1`, ['bob'])).rows.length > 0, table);
    }
    assert.equal((await db.query('SELECT 1 FROM cafe_confidence')).rows.length, 1);
    const tombstones = (await db.query<{ owner_hash: string; revoked_at: string | null }>('SELECT * FROM owner_access')).rows;
    assert.equal(tombstones.filter(row => row.revoked_at !== null).length, 1);
    assert.ok(tombstones.every(row => /^[a-f0-9]{64}$/.test(row.owner_hash)));
    const attempts = [
      () => services.study.start('alice', 'legacy-start'),
      () => services.study.start('alice', 'fresh-start'),
      () => services.study.get('alice', alice.legacy.id),
      () => services.study.save('alice', alice.legacy.id, { requestId: 'legacy-save', revision: 0, answer }),
      () => services.study.submit('alice', alice.legacy.id, { requestId: 'legacy-submit', answer }),
      () => services.cafe.start('alice', 'cafe-start'),
      () => services.cafe.start('alice', 'fresh-cafe'),
      () => services.cafe.get('alice', alice.lesson.id),
      () => services.cafe.history('alice'),
      () => services.cafe.save('alice', alice.lesson.id, { requestId: 'save', revision: 0, optionId: 'h4r9', phase: 'decision' as const }),
      () => services.cafe.submit('alice', alice.lesson.id, { requestId: 'cafe-submit', optionId: 'h4r9' }),
      () => services.cafe.confidence('alice', alice.lesson.id, { requestId: 'confidence', confidence: null }),
      () => services.cafe.saveProgress('alice', alice.lesson.id, { requestId: 'teach', revision: 1, phase: 'teach_back' as const, explanation: 'must-not-return' }),
      () => services.cafe.complete('alice', alice.lesson.id, { requestId: 'complete' }),
      () => services.confidence.get('alice'),
      () => services.confidence.save('alice', { requestId: 'profile', revision: 0, reports: [], examSubjects: ['bookkeeping'] }),
      () => services.data.export('alice'),
      () => services.plan.get('alice'),
      () => services.plan.save('alice', { requestId: 'plan', revision: 0, weeklyMinutes: 60, excludedIds: [], adjustmentReason: '' }),
    ];
    for (const attempt of attempts) await assert.rejects(attempt(), revoked);
    assert.deepEqual(await services.data.delete('alice'), deleted);
    await db.close();
    db = new PGlite(directory);
    const restarted = await initialize(db, now);
    await assert.rejects(restarted.cafe.start('alice', 'after-restart'), revoked);
    await assert.rejects(restarted.confidence.get('alice'), revoked);
    await assert.rejects(restarted.study.start('alice', 'after-restart'), revoked);
    await assert.rejects(restarted.plan.get('alice'), revoked);
    assert.deepEqual(await restarted.data.delete('alice'), deleted);
    assert.equal((await restarted.cafe.start('new-cookie-owner', 'new-start')).status, 'active');
    assert.deepEqual(await restarted.data.export('bob'), bobBefore);
  } finally { await db.close(); await rm(directory, { recursive: true, force: true }); }
});

test('削除と作成・保存の競合は両順序で直列化され、削除後にデータを復活させない', async () => {
  const db = new PGlite();
  try {
    const services = await initialize(db, () => new Date('2026-09-08T00:00:00Z'));
    const after = await Promise.allSettled([
      services.data.delete('delete-first'),
      services.cafe.start('delete-first', 'racing-start'),
      services.study.start('delete-first', 'racing-start'),
      services.confidence.save('delete-first', { requestId: 'racing-save', revision: 0, reports: [] }),
    ]);
    assert.equal(after[0].status, 'fulfilled');
    for (const item of after.slice(1)) {
      assert.equal(item.status, 'rejected');
      if (item.status === 'rejected') assert.ok(revoked(item.reason));
    }
    const before = await Promise.allSettled([
      services.cafe.start('save-first', 'racing-start'),
      services.study.start('save-first', 'racing-start'),
      services.confidence.save('save-first', { requestId: 'racing-save', revision: 0, reports: [] }),
      services.data.delete('save-first'),
    ]);
    assert.ok(before.every(item => item.status === 'fulfilled'));
    for (const owner of ['delete-first', 'save-first']) {
      for (const table of ['cafe_instances', 'study_sessions', 'confidence_profiles']) {
        assert.equal((await db.query(`SELECT 1 FROM ${table} WHERE owner_id=$1`, [owner])).rows.length, 0);
      }
      await assert.rejects(services.data.export(owner), revoked);
    }
  } finally { await db.close(); }
});
