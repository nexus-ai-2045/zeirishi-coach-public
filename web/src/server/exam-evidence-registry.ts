import { createHash } from 'node:crypto';
import { evaluateExamReadiness, type ExamReadinessRecord } from '../domain/exam-readiness';
import { strictCanonicalJson } from './strict-canonical-json';
import { strictIsoInstant } from '../domain/strict-iso-instant';

export type ExamEvidenceDocument = {
  schemaVersion: 'exam-evidence-v1'; ownerId: string; record: ExamReadinessRecord;
  provenance: { sourceUrl: string; sourceReference: string; importedBy: string; importedAt: string };
  /** Import-document confirmation of owner/provenance/result, NOT the separate
   * exam-comparability expert review stored in record.comparisonReview. */
  attestation: { reviewerId: string; reviewedAt: string; payloadSha256: string };
};
export class ExamEvidenceInputError extends Error {
  constructor() { super('INVALID_EXAM_EVIDENCE'); this.name = 'ExamEvidenceInputError'; }
}
function invalid(): never { throw new ExamEvidenceInputError(); }
function keys(value: unknown, expected: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some(key => !expected.includes(key))) invalid();
}
function uuid(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) invalid();
}
function text(value: unknown) { if (typeof value !== 'string' || !value.trim() || value.length > 2000) invalid(); }
function recordKeys(record: unknown) {
  keys(record, ['id', 'recordVersion', 'subjectId', 'examYear', 'kind', 'provider', 'examId', 'familyId', 'completedAt', 'score', 'maxScore',
    'criterion', 'comparisonReview', 'elapsedMinutes', 'timeLimitMinutes', 'timeAllocation', 'rank', 'unseenDeclaration',
    'freshProblem', 'freshFamily', 'aiAssisted', 'hintsUsed', 'measurementQuality', 'unmeasuredRanges']);
  if (record.criterion !== null) {
    keys(record.criterion, ['version', 'year', 'sourceKind', 'sourceUrl', 'targetScore']);
    text(record.criterion.sourceUrl);
  }
  if (record.comparisonReview !== null) keys(record.comparisonReview, ['reviewerId', 'reviewedAt', 'comparisonGroup', 'scopeConfirmed', 'difficultyConfirmed', 'pointsConfirmed', 'timeLimitConfirmed']);
  if (record.rank !== null) keys(record.rank, ['position', 'population']);
  if (record.unseenDeclaration !== null) keys(record.unseenDeclaration, ['claimed', 'declaredAt']);
  keys(record.measurementQuality, ['scoreVerified', 'timingVerified', 'coverageVerified']);
  if (!Array.isArray(record.timeAllocation)) invalid();
  record.timeAllocation.forEach(section => keys(section, ['sectionId', 'minutes']));
}
/** Computes an integrity digest, not a signature or a human approval. */
export function examEvidencePayloadSha256(document: ExamEvidenceDocument): string {
  const snapshot = JSON.parse(strictCanonicalJson(document, invalid)) as ExamEvidenceDocument;
  keys(snapshot, ['schemaVersion', 'ownerId', 'record', 'provenance', 'attestation']);
  const { attestation: _attestation, ...payload } = snapshot;
  return createHash('sha256').update(strictCanonicalJson(payload, invalid)).digest('hex');
}
/** Only trusted management ingestion may supply attestations. This does not authenticate
 * the importer/reviewer or establish expertise, permission, truth, or eligibility.
 * It grants no database permissions; general learner writes must not use this to
 * authorize INSERT/UPDATE of trusted evidence. */
export function verifyExamEvidenceDocument(value: unknown, options: { expectedOwnerId: string; asOf: string }): ExamEvidenceDocument {
  const document = JSON.parse(strictCanonicalJson(value, invalid)) as ExamEvidenceDocument;
  keys(document, ['schemaVersion', 'ownerId', 'record', 'provenance', 'attestation']);
  if (document.schemaVersion !== 'exam-evidence-v1') invalid();
  uuid(document.ownerId); uuid(options.expectedOwnerId);
  if (document.ownerId.toLowerCase() !== options.expectedOwnerId.toLowerCase()) invalid();
  recordKeys(document.record);
  keys(document.provenance, ['sourceUrl', 'sourceReference', 'importedBy', 'importedAt']);
  keys(document.attestation, ['reviewerId', 'reviewedAt', 'payloadSha256']);
  text(document.provenance.sourceUrl); text(document.provenance.sourceReference); text(document.provenance.importedBy); text(document.attestation.reviewerId);
  let url: URL; try { url = new URL(document.provenance.sourceUrl); } catch { invalid(); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalid();
  if (!/^[0-9a-f]{64}$/.test(document.attestation.payloadSha256) || document.attestation.payloadSha256 !== examEvidencePayloadSha256(document)) invalid();
  const asOf = strictIsoInstant(options.asOf, invalid);
  const completedAt = strictIsoInstant(document.record.completedAt, invalid);
  const importedAt = strictIsoInstant(document.provenance.importedAt, invalid);
  const reviewedAt = strictIsoInstant(document.attestation.reviewedAt, invalid);
  if (importedAt > asOf || reviewedAt > asOf || importedAt < completedAt || reviewedAt < completedAt) invalid();
  try {
    // A valid but incomplete measurement is retained; held is not invalid.
    const record = document.record;
    evaluateExamReadiness({ subjectId: record.subjectId, examYear: record.examYear,
      criterionVersion: record.criterion?.version ?? 'unconfirmed', asOf: options.asOf, records: [record] });
  } catch { invalid(); }
  return document;
}
