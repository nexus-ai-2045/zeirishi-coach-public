import test from 'node:test';
import assert from 'node:assert/strict';
import { examEvidencePayloadSha256, verifyExamEvidenceDocument, type ExamEvidenceDocument } from '../src/server/exam-evidence-registry';
import { evaluateExamReadiness } from '../src/domain/exam-readiness';

const owner = '11111111-1111-4111-8111-111111111111';
const options = { expectedOwnerId: owner, asOf: '2026-09-08T00:00:00Z' };
// Entirely fictional test data. These attestations are not human approval.
function fixture(): ExamEvidenceDocument {
  const document: ExamEvidenceDocument = { schemaVersion: 'exam-evidence-v1', ownerId: owner,
    record: { id: 'test-1', recordVersion: 'test-v1', subjectId: 'bookkeeping', examYear: 2026,
      kind: 'external_comprehensive', provider: '架空テスト提供元', examId: 'test-exam-1', familyId: 'test-family-1',
      completedAt: '2026-09-01T00:00:00Z', score: 65, maxScore: 100, criterion: null, comparisonReview: null,
      elapsedMinutes: null, timeLimitMinutes: null, timeAllocation: [], rank: null, unseenDeclaration: null,
      freshProblem: null, freshFamily: null, aiAssisted: null, hintsUsed: null,
      measurementQuality: { scoreVerified: false, timingVerified: false, coverageVerified: false }, unmeasuredRanges: ['未測定'] },
    provenance: { sourceUrl: 'https://example.test/results', sourceReference: '架空結果1', importedBy: 'test-operator', importedAt: '2026-09-02T00:00:00Z' },
    attestation: { reviewerId: 'test-operator', reviewedAt: '2026-09-03T00:00:00Z', payloadSha256: '' } };
  document.attestation.payloadSha256 = examEvidencePayloadSha256(document);
  return document;
}
function rehash(document: ExamEvidenceDocument) { document.attestation.payloadSha256 = examEvidencePayloadSha256(document); return document; }
test('取込確認と専門比較確認を分け、不完全測定を受理してheldのまま保持する', () => {
  const input = fixture(), verified = verifyExamEvidenceDocument(input, options);
  assert.deepEqual(verified, input);
  assert.notEqual(verified.record, input.record);
  assert.equal(verified.record.comparisonReview, null);
  const result = evaluateExamReadiness({ subjectId: verified.record.subjectId, examYear: 2026,
    criterionVersion: 'unconfirmed', asOf: options.asOf, records: [verified.record] });
  assert.equal(result.status, 'held');
  assert.ok(result.records[0].exclusionReasons.includes('expert-review-missing'));
  verified.record.score = 0;
  assert.equal(input.record.score, 65);
});
test('hashはkey順に依存せず本人・記録・出所を束縛し、取込attestationは別責務でhash外', () => {
  const input = fixture();
  const reordered = Object.fromEntries(Object.entries(input).reverse()) as ExamEvidenceDocument;
  assert.equal(examEvidencePayloadSha256(reordered), input.attestation.payloadSha256);
  input.attestation.reviewerId = 'another-test-operator';
  assert.equal(examEvidencePayloadSha256(input), input.attestation.payloadSha256);
  for (const change of [(doc: ExamEvidenceDocument) => { doc.ownerId = '22222222-2222-4222-8222-222222222222'; },
    (doc: ExamEvidenceDocument) => { doc.record.score = 99; },
    (doc: ExamEvidenceDocument) => { doc.provenance.sourceReference = '差替'; }]) {
    const mutated = fixture(); change(mutated);
    assert.throws(() => verifyExamEvidenceDocument(mutated, options), /INVALID_EXAM_EVIDENCE/);
  }
  assert.throws(() => verifyExamEvidenceDocument(input, { ...options, expectedOwnerId: '22222222-2222-4222-8222-222222222222' }), /INVALID_EXAM_EVIDENCE/);
});
test('再hashしても不正型・unknownfield・不正日時・未来日・得点逸脱は拒否する', () => {
  for (const change of [(doc: ExamEvidenceDocument) => { doc.ownerId = 'bad'; },
    (doc: ExamEvidenceDocument) => { doc.record.score = 101; },
    (doc: ExamEvidenceDocument) => { doc.provenance.importedAt = '2026-02-30T00:00:00Z'; },
    (doc: ExamEvidenceDocument) => { doc.attestation.reviewedAt = '2026-09-09T00:00:00Z'; },
    (doc: ExamEvidenceDocument) => { doc.record.completedAt = '2026-09-09T00:00:00Z'; },
    (doc: ExamEvidenceDocument) => { doc.provenance.sourceUrl = 'https://user:password@example.test/'; },
    (doc: ExamEvidenceDocument) => { Object.assign(doc.record.measurementQuality, { override: true }); },
    (doc: ExamEvidenceDocument) => { Object.assign(doc.record, { approved: true }); },
    (doc: ExamEvidenceDocument) => { Object.assign(doc.provenance, { rightsApproved: true }); }]) {
    const mutated = fixture(); change(mutated);
    assert.throws(() => verifyExamEvidenceDocument(rehash(mutated), options), /INVALID_EXAM_EVIDENCE/);
  }
  const offset = fixture(); offset.provenance.importedAt = '2026-09-02T09:00:00+09:00';
  assert.equal(verifyExamEvidenceDocument(rehash(offset), options).provenance.importedAt, offset.provenance.importedAt);
});
test('JSON外の関数・accessor・循環・穴・非有限値・独自prototypeを拒否する', () => {
  for (const value of [undefined, () => 1, new Date(), NaN, Infinity, new Array(1), Object.create({ inherited: true })]) {
    const input = fixture(); Object.assign(input.record, { unexpected: value });
    assert.throws(() => examEvidencePayloadSha256(input), /INVALID_EXAM_EVIDENCE/);
  }
  const cyclic = fixture(); Object.assign(cyclic, { cycle: cyclic });
  assert.throws(() => examEvidencePayloadSha256(cyclic), /INVALID_EXAM_EVIDENCE/);
  const getter = fixture(); Object.defineProperty(getter.record, 'danger', { get() { throw new Error('must not execute'); }, enumerable: true });
  assert.throws(() => examEvidencePayloadSha256(getter), /INVALID_EXAM_EVIDENCE/);
});
test('結果取込確認は受験以降、試験比較の専門確認は受験前でもよい', () => {
  for (const field of ['importedAt', 'reviewedAt']) {
    const input = fixture();
    if (field === 'importedAt') input.provenance.importedAt = '2026-08-31T00:00:00Z';
    else input.attestation.reviewedAt = '2026-08-31T00:00:00Z';
    assert.throws(() => verifyExamEvidenceDocument(rehash(input), options), /INVALID_EXAM_EVIDENCE/);
  }
  const input = fixture();
  input.record.comparisonReview = { reviewerId: 'test-expert', reviewedAt: '2026-08-01T00:00:00Z', comparisonGroup: 'test-group',
    scopeConfirmed: true, difficultyConfirmed: true, pointsConfirmed: true, timeLimitConfirmed: true };
  input.attestation.reviewedAt = input.record.completedAt;
  assert.deepEqual(verifyExamEvidenceDocument(rehash(input), options), input);
});
test('hashが合ってもURLの配列から文字列への暗黙変換を許容しない', () => {
  const provenance = fixture();
  Object.assign(provenance.provenance, { sourceUrl: ['https://example.test/source'] });
  assert.throws(() => verifyExamEvidenceDocument(rehash(provenance), options), /INVALID_EXAM_EVIDENCE/);
  const criterion = fixture();
  criterion.record.criterion = { version: 'test-v1', year: 2026, sourceKind: 'provider', sourceUrl: 'https://example.test/criterion', targetScore: 60 };
  Object.assign(criterion.record.criterion, { sourceUrl: ['https://example.test/criterion'] });
  assert.throws(() => verifyExamEvidenceDocument(rehash(criterion), options), /INVALID_EXAM_EVIDENCE/);
});
