import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createMasteryEvidenceService, createMasteryEvidenceReaderOnPreparedDatabase,
  type MasteryEvidenceDocument, type MasteryEvidenceRecord } from '../src/server/mastery-evidence-service';
import type { MasteryMeasurement } from '../src/domain/mastery-assessment';
import { lockOwner } from '../src/server/owner-access';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const at = '2026-09-01T00:00:00.000Z';
const scope = { subjectId: 'bookkeeping' as const, conceptId: 'concept', conceptVersion: 'v1', criterionVersion: 'criterion-v1' };
// Synthetic management declarations only, never real expert/timer verification.
function document(id: string, record: MasteryEvidenceRecord): MasteryEvidenceDocument {
  return { schemaVersion: 'mastery-evidence-v1', ownerId: owner, id, record,
    verification: { verifiedBy: 'fixture-verifier', verifiedAt: '2026-08-01T00:00:00.000Z', sourceReference: 'synthetic-fixture' } };
}
const criterion = () => document('criterion', { kind: 'criterion', ...scope, prepared: true, disclosureHistoryComplete: true });
function measurement(id: string, kind: MasteryMeasurement['evidenceKind'], day: string, patch: Partial<MasteryMeasurement> = {}) {
  return document(id, { kind: 'measurement', measurement: { ...scope, measurementId: id, caseId: id, caseVersion: 'v1', familyId: id,
    occurredAt: `2026-01-${day}T00:00:00.000Z`, evidenceKind: kind, outcome: 'met', score: 8, maxScore: 10, targetScore: 6,
    elapsedMinutes: 5, timeLimitMinutes: 10, hintsUsed: 0, aiAnswerViewed: false, sourceKind: 'formal', reviewStatus: 'approved',
    scoringAuthority: 'reviewed_rules', measurementQuality: 'verified', mixedConceptIds: [], confidence: null,
    confidenceFixedBeforeResult: false, invalidated: false, ...patch } });
}
const save = (document: MasteryEvidenceDocument, revision = 0) => ({ requestId: randomUUID(), revision, document });
const confirmed = () => [criterion(), measurement('explain', 'explanation', '01'), measurement('a1', 'application', '01'),
  measurement('a2', 'application', '02'), measurement('e1', 'exam', '03', { mixedConceptIds: ['concept','other-concept'] }), measurement('e2', 'exam', '05')];

test('reader exposes no management method; exact owner binding and revoked retries fail closed', async () => {
  const db = new PGlite();
  try {
    const service = await createMasteryEvidenceService(db, () => new Date(at));
    const request = save(criterion());
    await service.save(owner, request);
    const reader = createMasteryEvidenceReaderOnPreparedDatabase(db, () => new Date(at));
    assert.equal('save' in reader, false); assert.equal('withdraw' in reader, false);
    assert.deepEqual(await reader.list(other), []);
    assert.deepEqual(await reader.evaluateSubject(other, 'bookkeeping'), []);
    await assert.rejects(service.save(other, request), /INVALID_MASTERY_EVIDENCE/);
    await db.transaction(async tx => {
      const { hash } = await lockOwner(tx, owner);
      await tx.query('UPDATE owner_access SET revoked_at=$1 WHERE owner_hash=$2', [at, hash]);
    });
    await assert.rejects(reader.list(owner), /OWNER_REVOKED/);
    await assert.rejects(reader.evaluateSubject(owner, 'bookkeeping'), /OWNER_REVOKED/);
    await assert.rejects(service.save(owner, request), /OWNER_REVOKED/);
  } finally { await db.close(); }
});

test('corrections append original evidence identity; idempotency/CAS/withdrawal never resurrect earlier success', async () => {
  const db = new PGlite(); let now = at;
  try {
    const service = await createMasteryEvidenceService(db, () => new Date(now));
    for (const doc of confirmed()) await service.save(owner, save(doc));
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping'))[0].status, 'exam_confirmed');
    const corrected = measurement('e2', 'exam', '05', { score: 2, outcome: 'not_met' });
    now = '2026-09-02T00:00:00.000Z';
    const request = save(corrected, 1);
    const result = await service.save(owner, request);
    assert.equal(result.revision, 2);
    assert.equal((await service.save(owner, request)).revision, 2);
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping'))[0].needsRecheck, true);
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping', at))[0].status, 'exam_confirmed');
    await assert.rejects(service.save(owner, { ...request, document: measurement('e2', 'exam', '05') }), /REQUEST_CONFLICT/);
    await assert.rejects(service.save(owner, save(corrected, 1)), /REVISION_CONFLICT/);
    for (const patch of [{ familyId: 'new-family' }, { conceptVersion: 'v2' }, { criterionVersion: 'v2' }, { occurredAt: '2026-01-06T00:00:00.000Z' }]) {
      await assert.rejects(service.save(owner, save(measurement('e2', 'exam', '05', patch), 2)), /IDENTITY_IMMUTABLE/);
    }
    await service.withdraw(owner, { requestId: randomUUID(), id: 'e2', revision: 2, reason: '誤った証拠を撤回' });
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping'))[0].status, 'applicable');
    assert.equal((await service.save(owner, request)).revision, 3);
    await assert.rejects(service.save(owner, save(corrected, 3)), /WITHDRAWN/);
    const history = await service.list(owner);
    const records = history.filter(item => item.id === 'e2');
    assert.deepEqual(records.map(item => item.revision), [1,2,3]);
    assert.equal(records[0].document.record.kind === 'measurement' && records[0].document.record.measurement.score, 8);
    assert.equal(records[2].withdrawn, true);
  } finally { await db.close(); }
});

test('missing preparation/completeness, unknown version and ambiguous or withdrawn criteria cannot qualify', async () => {
  const db = new PGlite();
  try {
    const service = await createMasteryEvidenceService(db, () => new Date(at));
    assert.deepEqual(await service.evaluateSubject(owner, 'bookkeeping'), []);
    for (const doc of confirmed().slice(1)) await service.save(owner, save(doc));
    assert.equal((await service.evaluate(owner, { ...scope, asOf: at })).status, 'measurement_preparing');
    const incomplete = criterion();
    if (incomplete.record.kind !== 'criterion') throw new Error('fixture');
    incomplete.record.disclosureHistoryComplete = false;
    await service.save(owner, save(incomplete));
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping'))[0].status, 'measurement_preparing');
    await service.save(owner, save(criterion(), 1));
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping'))[0].status, 'exam_confirmed');
    assert.equal((await service.evaluate(owner, { ...scope, criterionVersion: 'unregistered', asOf: at })).status, 'measurement_preparing');
    const alternate = document('criterion-v2', { kind: 'criterion', ...scope, criterionVersion: 'criterion-v2', prepared: true, disclosureHistoryComplete: true });
    await service.save(owner, save(alternate));
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping'))[0].status, 'measurement_preparing');
    await service.withdraw(owner, { requestId: randomUUID(), id: alternate.id, revision: 1, reason: '新版を撤回' });
    const assessment = (await service.evaluateSubject(owner, 'bookkeeping'))[0];
    assert.equal(assessment.status, 'measurement_preparing');
    assert.equal(assessment.criterionVersion, 'criterion-v2');
  } finally { await db.close(); }
});

test('concept-wide disclosures include other concept versions and remain after withdrawal', async () => {
  const db = new PGlite();
  try {
    const service = await createMasteryEvidenceService(db, () => new Date(at));
    for (const doc of confirmed()) await service.save(owner, save(doc));
    const disclosure = document('disclosure', { kind: 'disclosure', subjectId: scope.subjectId, conceptId: scope.conceptId,
      conceptVersion: 'v0', occurredAt: '2026-01-02T12:00:00.000Z' });
    await service.save(owner, save(disclosure));
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping'))[0].status, 'applicable');
    await service.withdraw(owner, { requestId: randomUUID(), id: disclosure.id, revision: 1, reason: '監査用撤回でも閲覧事実は消さない' });
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping'))[0].status, 'applicable');
    await service.save(owner, save(measurement('e3', 'exam', '09', { mixedConceptIds: ['concept','other-concept'] })));
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping'))[0].status, 'exam_confirmed');
  } finally { await db.close(); }
});

test('strict documents and future verification/measurement/asOf are rejected without leaking raw input', async () => {
  const db = new PGlite();
  try {
    const service = await createMasteryEvidenceService(db, () => new Date(at));
    const future = criterion(); future.verification.verifiedAt = '2027-01-01T00:00:00.000Z';
    const cases: unknown[] = [future, { ...criterion(), secret: 'do-not-echo' }, { ...criterion(), record: { ...criterion().record, extra: true } },
      measurement('future', 'exam', '01', { occurredAt: '2027-01-01T00:00:00.000Z' }),
      measurement('invalid', 'exam', '01', { score: 1 }),
      { ...criterion(), verification: { verifiedBy: 'fixture', verifiedAt: '2026-02-30T00:00:00Z', sourceReference: 'fixture' } }];
    for (const doc of cases) await assert.rejects(service.save(owner, save(doc as MasteryEvidenceDocument)), error => error instanceof Error && error.message === 'INVALID_MASTERY_EVIDENCE');
    await assert.rejects(service.evaluate(owner, { ...scope, asOf: '2027-01-01T00:00:00Z' }), /INVALID_MASTERY_EVIDENCE/);
    await assert.rejects(service.evaluateSubject(owner, 'bookkeeping', '2027-01-01T00:00:00Z'), /INVALID_MASTERY_EVIDENCE/);
    assert.deepEqual(await service.list(owner), []);
  } finally { await db.close(); }
});

test('full history is not capped at 20 and competing corrections serialize on owner lock', async () => {
  const db = new PGlite();
  try {
    const service = await createMasteryEvidenceService(db, () => new Date(at));
    await service.save(owner, save(criterion()));
    for (let i = 0; i < 23; i++) await service.save(owner, save(measurement('practice-' + i, 'application', '01', { sourceKind: 'practice' })));
    assert.equal((await service.list(owner)).length, 24);
    const changed = criterion(); if (changed.record.kind !== 'criterion') throw new Error('fixture'); changed.record.prepared = false;
    const results = await Promise.allSettled([1,2].map(() => service.save(owner, save(changed, 1))));
    assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter(item => item.status === 'rejected' && /REVISION_CONFLICT/.test(String(item.reason))).length, 1);
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping'))[0].status, 'measurement_preparing');
  } finally { await db.close(); }
});

test('criterion rollover keeps the active first registration and measurement-only concepts are preparing', async () => {
  const db = new PGlite();
  try {
    const service = await createMasteryEvidenceService(db, () => new Date(at));
    const oldCriterion = criterion();
    await service.save(owner, save(oldCriterion));
    const newer = document('criterion-v2', { kind: 'criterion', ...scope, criterionVersion: 'criterion-v2', prepared: true, disclosureHistoryComplete: true });
    await service.save(owner, save(newer));
    await service.withdraw(owner, { requestId: randomUUID(), id: oldCriterion.id, revision: 1, reason: '旧版を終了' });
    const result = await service.evaluateSubject(owner, 'bookkeeping');
    assert.equal(result[0].criterionVersion, 'criterion-v2');
    assert.notEqual(result[0].status, 'measurement_preparing');
    const measurementOnly = measurement('measurement-only', 'application', '01', { conceptId: 'other-concept', conceptVersion: 'v1' });
    await service.save(owner, save(measurementOnly));
    const other = (await service.evaluateSubject(owner, 'bookkeeping')).find(item => item.conceptId === 'other-concept');
    assert.equal(other?.status, 'measurement_preparing');
    await service.save(owner, save(measurement('measurement-only-v2', 'application', '02', { conceptId: 'other-concept', conceptVersion: 'v2' })));
    const latest = (await service.evaluateSubject(owner, 'bookkeeping')).find(item => item.conceptId === 'other-concept');
    assert.equal(latest?.conceptVersion, 'v2');
    assert.equal(latest?.status, 'measurement_preparing');
  } finally { await db.close(); }
});

test('management can invalidate an erroneous disclosure without erasing durable disclosure history', async () => {
  const db = new PGlite(); let now = at;
  try {
    const service = await createMasteryEvidenceService(db, () => new Date(now));
    for (const doc of confirmed()) await service.save(owner, save(doc));
    const disclosure = document('bad-disclosure', { kind: 'disclosure', subjectId: scope.subjectId, conceptId: scope.conceptId,
      conceptVersion: scope.conceptVersion, occurredAt: '2026-01-02T12:00:00.000Z' });
    await service.save(owner, save(disclosure));
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping'))[0].status, 'applicable');
    const invalidation = document('disclosure-fix', { kind: 'disclosure_invalidation', targetId: disclosure.id,
      subjectId: scope.subjectId, conceptId: scope.conceptId, conceptVersion: scope.conceptVersion,
      occurredAt: '2026-01-02T21:00:00+09:00', reason: '誤登録を訂正' });
    for (const patch of [{ targetId: 'missing' }, { targetId: 'criterion' }, { conceptId: 'wrong' },
      { conceptVersion: 'v2' }, { occurredAt: '2026-01-02T13:00:00.000Z' }]) {
      const bad = { ...invalidation, record: { ...invalidation.record, ...patch } } as MasteryEvidenceDocument;
      await assert.rejects(service.save(owner, save(bad)), /INVALID_MASTERY_EVIDENCE/);
    }
    await assert.rejects(service.save(other, save({ ...invalidation, ownerId: other })), /INVALID_MASTERY_EVIDENCE/);
    now = '2026-09-02T00:00:00.000Z';
    await service.save(owner, save(invalidation));
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping'))[0].status, 'exam_confirmed');
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping', at))[0].status, 'applicable');
    assert.equal((await service.list(owner).then(items => items.filter(item => item.id === invalidation.id))).at(-1)?.withdrawn, false);
    now = '2026-09-03T00:00:00.000Z';
    await service.withdraw(owner, { requestId: randomUUID(), id: invalidation.id, revision: 1, reason: '訂正を撤回' });
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping'))[0].status, 'applicable');
    assert.equal((await service.evaluateSubject(owner, 'bookkeeping', '2026-09-02T00:00:00.000Z'))[0].status, 'exam_confirmed');
    assert.deepEqual((await service.list(owner)).filter(item => item.id === disclosure.id).map(item => item.document), [disclosure]);
    assert.equal((await service.list(owner).then(items => items.filter(item => item.id === invalidation.id))).at(-1)?.withdrawn, true);
    await assert.rejects(service.save(owner, save(document('bad-fix', { kind: 'disclosure_invalidation', targetId: 'missing',
      subjectId: scope.subjectId, conceptId: scope.conceptId, conceptVersion: scope.conceptVersion,
      occurredAt: '2026-01-01T00:00:00.000Z', reason: '対象なし' }))), /INVALID_MASTERY_EVIDENCE/);
  } finally { await db.close(); }
});
