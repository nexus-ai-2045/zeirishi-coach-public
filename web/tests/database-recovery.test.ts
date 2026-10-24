import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createCafeService, createCafeServiceOnPreparedDatabase } from '../src/server/cafe-service';
import { createMaterialRegistry } from '../src/server/material-registry';
import { createMasteryEvidenceService, createMasteryEvidenceServiceOnPreparedDatabase,
  createMasteryEvidenceReaderOnPreparedDatabase, type MasteryEvidenceDocument } from '../src/server/mastery-evidence-service';
import { lockOwner } from '../src/server/owner-access';
import { makeMaterialRecord } from './helpers/material-fixture';

const now = () => new Date('2026-09-10T00:00:00.000Z');
const owner = '11111111-1111-4111-8111-111111111111';
const revokedOwner = '22222222-2222-4222-8222-222222222222';
const otherOwner = '33333333-3333-4333-8333-333333333333';

// Only rows created inside this synthetic in-memory drill are inspected. No user export
// is imported, no local learner directory is opened, and no external database is contacted.
async function allRows(db: PGlite) {
  const tables = (await db.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows;
  const result: Record<string, unknown[]> = {};
  for (const { tablename } of tables) {
    assert.match(tablename, /^[a-z_]+$/);
    result[tablename] = (await db.query(`SELECT to_jsonb(t) AS row FROM "${tablename}" t ORDER BY to_jsonb(t)::text`)).rows;
  }
  return result;
}
async function revoke(db: PGlite, learner: string) {
  await db.transaction(async tx => {
    const { hash } = await lockOwner(tx, learner);
    await tx.query('UPDATE owner_access SET revoked_at=$1 WHERE owner_hash=$2', [now().toISOString(), hash]);
  });
}

test('合成DB snapshotを空インスタンスへ復旧し答案・版・正式証拠履歴・既存失効を保存時点で再現する', async () => {
  let source: PGlite | undefined = new PGlite();
  let restored: PGlite | undefined;
  try {
    // Reuse the existing explicitly synthetic material and service schema initializers.
    const record = makeMaterialRecord();
    const [{ material }] = createMaterialRegistry([record]);
    await createCafeService(source, now);
    const cafe = createCafeServiceOnPreparedDatabase(source, now, material);
    const start = await cafe.start(owner, randomUUID());
    const submission = { requestId: randomUUID(), optionId: 'h4r9' };
    await cafe.submit(owner, start.id, submission);
    const confirmed = await cafe.confidence(owner, start.id, { requestId: randomUUID(), confidence: 'normal' });
    const saved = await cafe.saveProgress(owner, start.id, { requestId: randomUUID(), revision: confirmed.progressRevision,
      phase: 'teach_back', explanation: '復旧ドリル専用の合成答案。前払費用を期間で配分する。' });
    const revokedCase = await cafe.start(revokedOwner, randomUUID());

    const management = await createMasteryEvidenceService(source, now);
    const scope = { subjectId: record.subjectId, conceptId: record.concept.conceptId,
      conceptVersion: record.concept.conceptVersion, criterionVersion: 'drill-only-criterion-v1' };
    const document: MasteryEvidenceDocument = { schemaVersion: 'mastery-evidence-v1', ownerId: owner, id: 'drill-criterion',
      record: { kind: 'criterion', ...scope, prepared: true, disclosureHistoryComplete: true },
      verification: { verifiedBy: 'drill-only-verifier', verifiedAt: '2026-09-09T00:00:00.000Z', sourceReference: 'synthetic-recovery-drill' } };
    await management.save(owner, { requestId: randomUUID(), revision: 0, document });
    // These are fabricated trusted-input fixtures, not a promotion of the cafe answer
    // or a claim that an expert has reviewed real learning evidence.
    const evidence: MasteryEvidenceDocument = { ...document, id: 'drill-evidence', record: { kind: 'measurement', measurement: {
      ...scope, measurementId: 'drill-evidence', caseId: 'drill-structured-check', caseVersion: 'drill-check-v1', familyId: 'drill-family',
      occurredAt: '2026-09-08T00:00:00.000Z', evidenceKind: 'explanation', outcome: 'met', score: 8, maxScore: 10, targetScore: 6,
      elapsedMinutes: 5, timeLimitMinutes: 10, hintsUsed: 0, aiAnswerViewed: false, sourceKind: 'formal', reviewStatus: 'approved',
      scoringAuthority: 'reviewed_rules', measurementQuality: 'verified', mixedConceptIds: [], confidence: null,
      confidenceFixedBeforeResult: false, invalidated: false,
    } } };
    const firstRequest = { requestId: randomUUID(), revision: 0, document: evidence };
    await management.save(owner, firstRequest);
    const correction = structuredClone(evidence);
    assert.equal(correction.record.kind, 'measurement');
    if (correction.record.kind !== 'measurement') throw new Error('Invalid drill fixture');
    correction.record.measurement.score = 7;
    const correctionRequest = { requestId: randomUUID(), revision: 1, document: correction };
    await management.save(owner, correctionRequest);
    const revokedCriterion = { ...document, ownerId: revokedOwner };
    const revokedRequest = { requestId: randomUUID(), revision: 0, document: revokedCriterion };
    await management.save(revokedOwner, revokedRequest);
    await revoke(source, revokedOwner);
    await assert.rejects(cafe.get(revokedOwner, revokedCase.id), /OWNER_REVOKED/);

    const expectedHistory = await management.list(owner);
    assert.deepEqual(expectedHistory.filter(item => item.id === evidence.id).map(item => item.revision), [1, 2]);
    const expectedAssessment = await management.evaluateSubject(owner, record.subjectId);
    const expectedRows = await allRows(source);
    // Installed PGlite dumpDataDir/loadDataDir APIs: native DB image, not export JSON.
    const snapshot = await source.dumpDataDir();
    assert.ok(snapshot.size > 0);

    // Deliberately demonstrate the gap: later edits/revocations are absent from this image.
    // A production recovery needs a separate post-snapshot deletion/revocation procedure.
    await cafe.saveProgress(owner, start.id, { requestId: randomUUID(), revision: saved.progressRevision,
      phase: 'teach_back', explanation: 'スナップショット後の合成更新。復旧対象には含まれない。' });
    await revoke(source, owner);
    await assert.rejects(cafe.get(owner, start.id), /OWNER_REVOKED/);
    await source.close(); source = undefined;

    // New in-memory database, with no schema bootstrap or reseeding after load.
    restored = new PGlite({ loadDataDir: snapshot });
    await restored.waitReady;
    assert.deepEqual(await allRows(restored), expectedRows);
    const restoredCafe = createCafeServiceOnPreparedDatabase(restored, now, material);
    const reader = createMasteryEvidenceReaderOnPreparedDatabase(restored, now);
    const restoredManagement = createMasteryEvidenceServiceOnPreparedDatabase(restored, now);
    const restoredAnswer = await restoredCafe.get(owner, start.id);
    assert.deepEqual(restoredAnswer, saved);
    assert.equal(restoredAnswer.caseVersion, record.version);
    assert.equal(restoredAnswer.result?.scoringVersion, record.document.scoringVersion);
    assert.equal(restoredAnswer.attemptId, saved.attemptId);
    assert.deepEqual(await reader.list(owner), expectedHistory);
    assert.deepEqual(await reader.evaluateSubject(owner, record.subjectId), expectedAssessment);
    assert.equal((await restoredManagement.save(owner, correctionRequest)).revision, 2); // Receipt also survived.
    assert.deepEqual(await reader.list(owner), expectedHistory);

    await assert.rejects(restoredCafe.get(otherOwner, start.id), /NOT_FOUND/);
    assert.deepEqual(await reader.list(otherOwner), []);
    assert.deepEqual(await reader.evaluateSubject(otherOwner, record.subjectId), []);
    await assert.rejects(restoredManagement.save(otherOwner, firstRequest), /INVALID_MASTERY_EVIDENCE/);
    await assert.rejects(restoredCafe.get(revokedOwner, revokedCase.id), /OWNER_REVOKED/);
    await assert.rejects(reader.list(revokedOwner), /OWNER_REVOKED/);
    await assert.rejects(reader.evaluateSubject(revokedOwner, record.subjectId), /OWNER_REVOKED/);
    await assert.rejects(restoredManagement.save(revokedOwner, revokedRequest), /OWNER_REVOKED/);
    await assert.rejects(restoredCafe.start(revokedOwner, randomUUID()), /OWNER_REVOKED/);
  } finally {
    await restored?.close();
    await source?.close();
  }
});
