import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createConfidenceService } from '../src/server/confidence-service';
import { createWeeklyPlanService, parseWeeklyPlanSave } from '../src/server/weekly-plan-service';
import { DEVELOPMENT_CATALOG } from '../src/server/development-catalog';

const save = (requestId = 'first', revision = 0) => ({ requestId, revision, weeklyMinutes: 60, excludedIds: [], adjustmentReason: '' });
test('週計画はowner/profile版/CAS/再送と本人受験予定を束縛し、実在練習在庫だけを使う', async () => {
  const db = new PGlite();
  let at = new Date('2026-09-07T00:00:00Z');
  try {
    const profile = await createConfidenceService(db, DEVELOPMENT_CATALOG);
    const service = await createWeeklyPlanService(db, DEVELOPMENT_CATALOG, () => at);
    const initial = await service.get('alice');
    assert.equal(initial.planRecord, null);
    assert.equal(initial.stale, false);
    assert.equal(initial.candidates.length, 1);
    const empty = await service.save('alice', save());
    assert.equal(empty.planRecord?.plan.status, 'subjects-unset');
    assert.deepEqual(await service.save('alice', save()), empty);
    assert.equal((await service.get('bob')).planRecord, null);
    await profile.save('alice', { requestId: 'exams', revision: 0, reports: [], examSubjects: ['bookkeeping', 'income-tax'] });
    assert.equal((await service.get('alice')).stale, true);
    const replayAfterProfile = await service.save('alice', save());
    assert.deepEqual(replayAfterProfile.planRecord, empty.planRecord);
    assert.equal(replayAfterProfile.stale, true);
    const planned = await service.save('alice', save('second', 1));
    assert.equal(planned.stale, false);
    assert.equal(planned.planRecord?.profileRevision, 1);
    assert.equal(planned.planRecord?.plan.weekStart, '2026-09-07');
    assert.equal(planned.planRecord?.plan.sessions.length, 1);
    assert.equal(planned.planRecord?.plan.allocatedMinutes, 5);
    assert.equal(planned.planRecord?.plan.remainingMinutes, 55);
    assert.deepEqual(planned.planRecord?.plan.unavailableSubjects, ['income-tax']);
    const session = planned.planRecord!.plan.sessions[0];
    assert.equal(session.id, 'prepaid-expenses');
    assert.equal(session.qualification, 'practice');
    assert.equal(session.bucket, 'new');
    assert.equal(session.unseen, false);
    assert.equal(session.priority.observedExamScoreRatio, null);
    assert.equal(session.priority.reviewStatus, 'unknown');
    await assert.rejects(service.save('alice', save('stale', 1)), /REVISION_CONFLICT/);
    await assert.rejects(service.save('alice', { ...save('second', 1), weeklyMinutes: 61 }), /REQUEST_CONFLICT/);
    await assert.rejects(service.save('alice', { ...save('invalid', 2), excludedIds: ['unknown'], adjustmentReason: '除外' }), /UNKNOWN_PLAN_CANDIDATE/);
    const excluded = await service.save('alice', { ...save('exclude', 2), excludedIds: ['prepaid-expenses'], adjustmentReason: '今週は別教材で復習する' });
    assert.equal(excluded.planRecord?.plan.sessions.length, 0);
    assert.equal(excluded.candidates.length, 1);
    assert.equal(excluded.planRecord?.adjustmentReason, '今週は別教材で復習する');
    const current = await service.get('alice');
    assert.deepEqual(current, excluded);
    const olderSameWeek = await service.save('alice', save('second', 1));
    assert.deepEqual(olderSameWeek.planRecord, planned.planRecord);
    assert.equal(olderSameWeek.stale, true);
    const withdrawn = await createWeeklyPlanService(db, [], () => at);
    assert.equal((await withdrawn.get('alice')).stale, true);
    const replacedCatalog = DEVELOPMENT_CATALOG.map(pack => ({ ...pack,
      concepts: pack.concepts.map(concept => ({ ...concept, conceptVersion: 'replacement-version' })) }));
    const replaced = await createWeeklyPlanService(db, replacedCatalog, () => at);
    assert.equal((await replaced.get('alice')).stale, true);
    at = new Date('2026-09-13T14:59:59Z');
    assert.equal((await service.get('alice')).stale, false);
    at = new Date('2026-09-13T15:00:00Z');
    assert.equal((await service.get('alice')).stale, true);
    assert.deepEqual((await service.save('alice', save('second', 1))).planRecord, planned.planRecord);
    const nextWeek = await service.save('alice', save('new-week', 3));
    assert.equal(nextWeek.planRecord?.plan.weekStart, '2026-09-14');
    assert.equal(nextWeek.stale, false);
    const concurrent = await Promise.allSettled([service.save('alice', save('race-a', 4)), service.save('alice', save('race-b', 4))]);
    assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(concurrent.filter(item => item.status === 'rejected').length, 1);
    const refreshed = await createWeeklyPlanService(db, DEVELOPMENT_CATALOG, () => at);
    assert.deepEqual(await refreshed.get('alice'), await service.get('alice'));
    await profile.save('bob', { requestId: 'none', revision: 0, reports: [], examSubjects: [] });
    assert.equal((await service.save('bob', save())).planRecord?.plan.status, 'no-subjects');
  } finally { await db.close(); }
});

test('自己申告を試験点にしない・予算0を尊重・入力を厳密検査', async () => {
  const db = new PGlite();
  try {
    const profile = await createConfidenceService(db, DEVELOPMENT_CATALOG);
    const service = await createWeeklyPlanService(db, DEVELOPMENT_CATALOG);
    const concept = DEVELOPMENT_CATALOG[0].concepts[0];
    await profile.save('alice', { requestId: 'confident', revision: 0, examSubjects: ['bookkeeping'], reports: [{
      subjectId: concept.subjectId, conceptId: concept.conceptId, conceptVersion: concept.conceptVersion, selfConfidence: 'explained',
    }] });
    const planned = await service.save('alice', save());
    assert.equal(planned.planRecord?.plan.sessions.length, 0);
    assert.equal(planned.candidates[0].priority.observedExamScoreRatio, null);
    assert.deepEqual(planned.autoSkippedIds, ['prepaid-expenses']);
    assert.deepEqual(planned.planRecord?.excludedIds, []);
    assert.equal(planned.candidates.length, 1);
    await profile.save('alice', { requestId: 'reset-confidence', revision: 1, reports: [] });
    assert.equal((await service.get('alice')).stale, true);
    const zero = await service.save('alice', { ...save('zero', 1), weeklyMinutes: 0 });
    assert.deepEqual(zero.autoSkippedIds, []);
    assert.equal(zero.planRecord?.plan.allocatedMinutes, 0);
    assert.equal(zero.planRecord?.plan.sessions.length, 0);
    assert.deepEqual(zero.planRecord?.plan.deferredSubjects, ['bookkeeping']);
    for (const patch of [{ weeklyMinutes: -1 }, { weeklyMinutes: 10081 }, { weeklyMinutes: 1.5 }, { weeklyMinutes: '60' },
      { revision: -1 }, { excludedIds: ['prepaid-expenses'] }, { excludedIds: ['x', 'x'], adjustmentReason: 'test' },
      { excludedIds: [null] }, { excludedIds: Array(1) }, { adjustmentReason: 'x'.repeat(501) }, { requestId: '' }, { ownerId: 'bob' }]) {
      assert.throws(() => parseWeeklyPlanSave({ ...save(), ...patch }));
    }
    assert.equal(parseWeeklyPlanSave({ ...save(), weeklyMinutes: 10080 }).weeklyMinutes, 10080);
    assert.throws(() => parseWeeklyPlanSave({ ...save(), excludedIds: ['x'], adjustmentReason: '   ' }), /ADJUSTMENT_REASON_REQUIRED/);
  } finally { await db.close(); }
});
