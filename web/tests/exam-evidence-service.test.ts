import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createExamEvidenceService, createExamEvidenceReaderOnPreparedDatabase } from '../src/server/exam-evidence-service';
import { examEvidencePayloadSha256, type ExamEvidenceDocument } from '../src/server/exam-evidence-registry';
import { lockOwner } from '../src/server/owner-access';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const assessment = { subjectId: 'bookkeeping' as const, examYear: 2026, criterionVersion: 'fixture-v1', asOf: '2026-09-09T00:00:00Z' };
// Synthetic fixtures only: not a record of real expert approval.
function fixture(id: string, completedAt: string, patch: Partial<ExamEvidenceDocument['record']> = {}): ExamEvidenceDocument {
  const document: ExamEvidenceDocument = { schemaVersion: 'exam-evidence-v1', ownerId: owner,
    record: { id, recordVersion: 'fixture-v1', subjectId: 'bookkeeping', examYear: 2026,
      kind: 'external_comprehensive', provider: '架空テスト', examId: `exam-${id}`, familyId: `family-${id}`, completedAt,
      score: 70, maxScore: 100, criterion: { version: 'fixture-v1', year: 2026, sourceKind: 'provider', sourceUrl: 'https://example.test/criterion', targetScore: 60 },
      comparisonReview: { reviewerId: 'fixture-reviewer', reviewedAt: '2026-01-01T00:00:00Z', comparisonGroup: 'fixture', scopeConfirmed: true, difficultyConfirmed: true, pointsConfirmed: true, timeLimitConfirmed: true },
      elapsedMinutes: 100, timeLimitMinutes: 120, timeAllocation: [{ sectionId: 'all', minutes: 100 }], rank: null,
      unseenDeclaration: { claimed: true, declaredAt: completedAt }, freshProblem: true, freshFamily: true,
      aiAssisted: false, hintsUsed: false, measurementQuality: { scoreVerified: true, timingVerified: true, coverageVerified: true }, unmeasuredRanges: [], ...patch },
    provenance: { sourceUrl: 'https://example.test/result', sourceReference: id, importedBy: 'fixture-operator', importedAt: '2026-09-07T00:00:00Z' },
    attestation: { reviewerId: 'fixture-operator', reviewedAt: '2026-09-07T00:00:00Z', payloadSha256: '' } };
  return rehash(document);
}
function rehash(document: ExamEvidenceDocument) { document.attestation.payloadSha256 = examEvidencePayloadSha256(document); return document; }

test('append-only correction, CAS/retry, withdrawal preserve latest selection and historical asOf', async () => {
  const db = new PGlite(); let at = '2026-09-07T00:00:00Z';
  try {
    const service = await createExamEvidenceService(db, () => new Date(at));
    for (const [id, day] of [['a', '01'], ['b', '02'], ['c', '03']]) await service.save(owner, { requestId: randomUUID(), revision: 0, document: fixture(id, `2026-09-${day}T00:00:00Z`) });
    assert.equal((await service.evaluate(owner, { ...assessment, asOf: at })).status, 'target_met_twice');
    at = '2026-09-08T00:00:00Z';
    const corrected = fixture('c', '2026-09-03T00:00:00Z', { score: 40 });
    const request = { requestId: randomUUID(), revision: 1, document: corrected };
    await service.save(owner, request);
    assert.equal((await service.evaluate(owner, { ...assessment, asOf: at })).status, 'below_target');
    assert.equal((await service.evaluate(owner, { ...assessment, asOf: '2026-09-07T12:00:00Z' })).status, 'target_met_twice');
    await assert.rejects(service.save(owner, { ...request, requestId: randomUUID() }), /REVISION_CONFLICT/);
    at = assessment.asOf;
    await service.withdraw(owner, { requestId: randomUUID(), id: 'c', revision: 2, reason: '架空撤回' });
    assert.equal((await service.save(owner, request)).revision, 3);
    const result = await service.evaluate(owner, assessment);
    assert.equal(result.status, 'held'); assert.deepEqual(result.selectedIds, ['c', 'b']);
    assert.ok(result.holdReasons.includes('evidence-withdrawn'));
    const history = await service.list(owner);
    assert.equal(history.length, 5); assert.equal(history.find(item => item.id === 'c' && item.revision === 1)?.document.record.score, 70);
    await assert.rejects(service.save(owner, { requestId: randomUUID(), revision: 3, document: corrected }), /WITHDRAWN/);
    await assert.rejects(service.evaluate(owner, { ...assessment, asOf: '2026-09-10T00:00:00Z' }), /INVALID_EXAM_EVIDENCE/);
  } finally { await db.close(); }
});

test('identity correction cannot erase encounters; evaluation includes more than 20 and other-year evidence', async () => {
  const db = new PGlite();
  try {
    const service = await createExamEvidenceService(db, () => new Date(assessment.asOf));
    const original = fixture('encounter', '2026-01-01T00:00:00Z', { kind: 'practice', examYear: 2025, familyId: 'repeated' });
    await service.save(owner, { requestId: randomUUID(), revision: 0, document: original });
    for (const patch of [{ id: 'replacement' }, { subjectId: 'income-tax' }, { examYear: 2026 }, { examId: 'new-exam' }, { familyId: 'new-family' }, { completedAt: '2026-01-02T00:00:00Z' }, { kind: 'external_comprehensive' }]) {
      const changed = structuredClone(original); Object.assign(changed.record, patch);
      await assert.rejects(service.save(owner, { requestId: randomUUID(), revision: 1, document: rehash(changed) }));
    }
    for (let index = 0; index < 21; index++) await service.save(owner, { requestId: randomUUID(), revision: 0,
      document: fixture(`practice-${index}`, '2026-02-01T00:00:00Z', { kind: 'practice' }) });
    await service.save(owner, { requestId: randomUUID(), revision: 0, document: fixture('latest', '2026-09-02T00:00:00Z', { familyId: 'repeated' }) });
    await service.save(owner, { requestId: randomUUID(), revision: 0, document: fixture('previous', '2026-09-01T00:00:00Z') });
    const result = await service.evaluate(owner, assessment);
    assert.equal(result.records.length, 24); assert.equal(result.status, 'held');
    assert.ok(result.records.find(item => item.id === 'latest')?.exclusionReasons.includes('observed-previous-family'));
  } finally { await db.close(); }
});

test('reader has no write capability, owner mismatch and revoked retries are rejected', async () => {
  const db = new PGlite();
  try {
    const service = await createExamEvidenceService(db, () => new Date(assessment.asOf));
    const request = { requestId: randomUUID(), revision: 0, document: fixture('a', '2026-09-01T00:00:00Z') };
    await service.save(owner, request);
    const changed = fixture('a', '2026-09-01T00:00:00Z', { score: 40 });
    await assert.rejects(service.save(owner, { ...request, document: changed }), /REQUEST_CONFLICT/);
    const competing = await Promise.allSettled([1, 2].map(() => service.save(owner, { requestId: randomUUID(), revision: 1, document: changed })));
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(competing.filter(result => result.status === 'rejected' && /REVISION_CONFLICT/.test(String(result.reason))).length, 1);
    const reader = createExamEvidenceReaderOnPreparedDatabase({ transaction: callback => db.transaction(callback) });
    assert.equal('save' in reader, false); assert.deepEqual(await reader.list(other), []);
    await assert.rejects(service.save(other, request), /INVALID_EXAM_EVIDENCE/);
    await db.transaction(async tx => { const { hash } = await lockOwner(tx, owner); await tx.query('UPDATE owner_access SET revoked_at=$1 WHERE owner_hash=$2', [assessment.asOf, hash]); });
    await assert.rejects(reader.list(owner), /OWNER_REVOKED/);
    await assert.rejects(service.save(owner, request), /OWNER_REVOKED/);
    await assert.rejects(service.evaluate(owner, assessment), /OWNER_REVOKED/);
  } finally { await db.close(); }
});
