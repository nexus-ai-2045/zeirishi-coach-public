import { SUBJECTS, type SubjectId } from './onboarding';
import { strictIsoInstant } from './strict-iso-instant';

export const EXAM_READINESS_VERSION = 'exam-readiness-v1' as const;
export type ExamCriterion = { version: string; year: number; sourceKind: 'official' | 'provider'; sourceUrl: string; targetScore: number };
export type ExamComparisonReview = {
  reviewerId: string; reviewedAt: string; comparisonGroup: string;
  scopeConfirmed: boolean; difficultyConfirmed: boolean; pointsConfirmed: boolean; timeLimitConfirmed: boolean;
};
export type ExamReadinessRecord = {
  id: string; recordVersion: string; subjectId: SubjectId; examYear: number;
  kind: 'external_comprehensive' | 'original_comprehensive' | 'mini' | 'practice' | 'self_report';
  provider: string;
  /** Trusted ingestion must normalize these global canonical IDs across providers; provider is a display label, not an identity namespace. */
  examId: string; familyId: string; completedAt: string;
  score: number; maxScore: number; criterion: ExamCriterion | null; comparisonReview: ExamComparisonReview | null;
  elapsedMinutes: number | null; timeLimitMinutes: number | null;
  timeAllocation: { sectionId: string; minutes: number | null }[];
  rank: { position: number; population: number } | null;
  unseenDeclaration: { claimed: boolean; declaredAt: string } | null;
  freshProblem: boolean | null; freshFamily: boolean | null;
  aiAssisted: boolean | null; hintsUsed: boolean | null;
  measurementQuality: { scoreVerified: boolean; timingVerified: boolean; coverageVerified: boolean };
  unmeasuredRanges: string[];
};
export type ReadinessExclusion = 'not-comprehensive' | 'other-subject' | 'other-year' | 'criterion-missing' | 'criterion-version-mismatch'
  | 'criterion-year-mismatch' | 'expert-review-missing' | 'scope-unconfirmed' | 'difficulty-unconfirmed' | 'points-unconfirmed'
  | 'time-limit-unconfirmed' | 'unseen-unconfirmed' | 'previously-seen-problem' | 'previously-seen-family' | 'problem-novelty-unknown' | 'family-novelty-unknown'
  | 'observed-previous-exam' | 'observed-previous-family'
  | 'ai-assistance-or-unknown' | 'hints-or-unknown' | 'score-unverified' | 'timing-unverified' | 'coverage-unverified'
  | 'time-unknown' | 'time-exceeded' | 'unmeasured-ranges';
export type ExamReadinessInput = { subjectId: SubjectId; examYear: number; criterionVersion: string; asOf: string; records: readonly ExamReadinessRecord[] };
export type ExamReadinessResult = {
  version: typeof EXAM_READINESS_VERSION; subjectId: SubjectId; examYear: number; criterionVersion: string;
  status: 'held' | 'below_target' | 'target_met_twice';
  selectedIds: string[]; holdReasons: string[];
  records: { id: string; selected: boolean; eligible: boolean; targetDifference: number | null;
    elapsedMinutes: number | null; timeLimitMinutes: number | null; remainingMinutes: number | null;
    timeAllocation: ExamReadinessRecord['timeAllocation']; timeAllocationMeasured: boolean; unmeasuredRanges: string[]; exclusionReasons: ReadinessExclusion[] }[];
};
export class ExamReadinessInputError extends Error { constructor() { super('INVALID_EXAM_READINESS_INPUT'); this.name = 'ExamReadinessInputError'; } }
function invalid(): never { throw new ExamReadinessInputError(); }
function identifier(value: unknown) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) invalid(); }
function text(value: unknown) { if (typeof value !== 'string' || !value.trim() || value.length > 2000) invalid(); }
function year(value: unknown) { if (!Number.isInteger(value) || (value as number) < 1900 || (value as number) > 2200) invalid(); }
function subject(value: unknown) { if (!SUBJECTS.some(item => item.id === value)) invalid(); }
function bool(value: unknown, nullable = false) { if (typeof value !== 'boolean' && !(nullable && value === null)) invalid(); }
function object(value: unknown): asserts value is Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(); }
function minutes(value: unknown, positive = false) { if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < (positive ? Number.MIN_VALUE : 0))) invalid(); }
function instant(value: unknown): number { return strictIsoInstant(value, invalid); }
function validateRecord(record: ExamReadinessRecord, asOf: number) {
  object(record);
  for (const value of [record.id, record.recordVersion, record.examId, record.familyId]) identifier(value);
  text(record.provider); subject(record.subjectId); year(record.examYear);
  if (!['external_comprehensive', 'original_comprehensive', 'mini', 'practice', 'self_report'].includes(record.kind)) invalid();
  const completedAt = instant(record.completedAt); if (completedAt > asOf) invalid();
  if (!Number.isFinite(record.score) || !Number.isFinite(record.maxScore) || record.maxScore <= 0 || record.score < 0 || record.score > record.maxScore) invalid();
  minutes(record.elapsedMinutes); minutes(record.timeLimitMinutes, true);
  if (!Array.isArray(record.timeAllocation) || record.timeAllocation.length > 1000) invalid();
  const sections = new Set<string>(); let allocated = 0;
  for (const section of record.timeAllocation) { object(section); identifier(section.sectionId); if (sections.has(section.sectionId)) invalid(); sections.add(section.sectionId); minutes(section.minutes); allocated += section.minutes ?? 0; }
  if (record.elapsedMinutes !== null && allocated > record.elapsedMinutes) invalid();
  if (record.rank !== null) {
    object(record.rank);
    if (!Number.isSafeInteger(record.rank.position) || !Number.isSafeInteger(record.rank.population)
      || record.rank.position < 1 || record.rank.population < 1 || record.rank.position > record.rank.population) invalid();
  }
  object(record.measurementQuality);
  for (const value of [record.measurementQuality.scoreVerified, record.measurementQuality.timingVerified, record.measurementQuality.coverageVerified]) bool(value);
  for (const value of [record.aiAssisted, record.hintsUsed, record.freshProblem, record.freshFamily]) bool(value, true);
  if (!Array.isArray(record.unmeasuredRanges) || record.unmeasuredRanges.length > 1000) invalid(); record.unmeasuredRanges.forEach(text);
  if (new Set(record.unmeasuredRanges).size !== record.unmeasuredRanges.length) invalid();
  if (record.unseenDeclaration !== null) {
    object(record.unseenDeclaration); bool(record.unseenDeclaration.claimed);
    if (instant(record.unseenDeclaration.declaredAt) > asOf) invalid();
  }
  if (record.criterion !== null) {
    object(record.criterion); const criterion = record.criterion;
    identifier(criterion.version); year(criterion.year);
    if (!['official', 'provider'].includes(criterion.sourceKind) || !Number.isFinite(criterion.targetScore) || criterion.targetScore < 0 || criterion.targetScore > record.maxScore) invalid();
    if (typeof criterion.sourceUrl !== 'string') invalid();
    let url: URL; try { url = new URL(criterion.sourceUrl); } catch { invalid(); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalid();
  }
  if (record.comparisonReview !== null) {
    object(record.comparisonReview); const review = record.comparisonReview;
    identifier(review.reviewerId); identifier(review.comparisonGroup); if (instant(review.reviewedAt) > asOf) invalid();
    for (const value of [review.scopeConfirmed, review.difficultyConfirmed, review.pointsConfirmed, review.timeLimitConfirmed]) bool(value);
  }
}

/** Pure display assessment of trusted, server-bound evidence, not validation of client assertions or a pass probability. */
export function evaluateExamReadiness(input: ExamReadinessInput): ExamReadinessResult {
  if (!input || typeof input !== 'object') invalid();
  subject(input.subjectId); year(input.examYear); identifier(input.criterionVersion); const asOf = instant(input.asOf);
  if (!Array.isArray(input.records) || input.records.length > 10000) invalid();
  const evidence: readonly ExamReadinessRecord[] = input.records;
  const ids = new Set<string>();
  for (const record of evidence) { validateRecord(record, asOf); if (ids.has(record.id)) invalid(); ids.add(record.id); }
  const comprehensive = (record: ExamReadinessRecord) => ['external_comprehensive', 'original_comprehensive'].includes(record.kind);
  // Choose before qualification/scoring. A new failed/unknown measurement cannot be hidden by old high scores.
  const selected = evidence.filter(record => record.subjectId === input.subjectId && record.examYear === input.examYear && comprehensive(record))
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, 2);
  const selectedIds = selected.map(record => record.id);
  type Seen = { at: number; count: number };
  const exams = new Map<string, Seen>(), families = new Map<string, Seen>();
  const key = (record: ExamReadinessRecord, value: string) => JSON.stringify([record.subjectId, value]);
  const collect = (map: Map<string, Seen>, id: string, at: number) => {
    const existing = map.get(id);
    if (!existing || at < existing.at) map.set(id, { at, count: 1 });
    else if (at === existing.at) existing.count++;
  };
  for (const record of evidence) { const at = Date.parse(record.completedAt); collect(exams, key(record, record.examId), at); collect(families, key(record, record.familyId), at); }
  const observed = (seen: Seen, at: number) => seen.at < at || (seen.at === at && seen.count > 1);
  const records = evidence.map(record => {
    const reasons: ReadinessExclusion[] = [];
    if (!comprehensive(record)) reasons.push('not-comprehensive');
    if (record.subjectId !== input.subjectId) reasons.push('other-subject');
    if (record.examYear !== input.examYear) reasons.push('other-year');
    if (!record.criterion) reasons.push('criterion-missing');
    else { if (record.criterion.version !== input.criterionVersion) reasons.push('criterion-version-mismatch'); if (record.criterion.year !== input.examYear) reasons.push('criterion-year-mismatch'); }
    const review = record.comparisonReview;
    if (!review) reasons.push('expert-review-missing');
    else {
      if (!review.scopeConfirmed) reasons.push('scope-unconfirmed'); if (!review.difficultyConfirmed) reasons.push('difficulty-unconfirmed');
      if (!review.pointsConfirmed) reasons.push('points-unconfirmed'); if (!review.timeLimitConfirmed) reasons.push('time-limit-unconfirmed');
    }
    if (record.unseenDeclaration?.claimed !== true) reasons.push('unseen-unconfirmed');
    if (record.freshProblem !== true) reasons.push(record.freshProblem === null ? 'problem-novelty-unknown' : 'previously-seen-problem');
    if (record.freshFamily !== true) reasons.push(record.freshFamily === null ? 'family-novelty-unknown' : 'previously-seen-family');
    const at = Date.parse(record.completedAt);
    if (observed(exams.get(key(record, record.examId))!, at)) reasons.push('observed-previous-exam');
    if (observed(families.get(key(record, record.familyId))!, at)) reasons.push('observed-previous-family');
    if (record.aiAssisted !== false) reasons.push('ai-assistance-or-unknown'); if (record.hintsUsed !== false) reasons.push('hints-or-unknown');
    if (!record.measurementQuality.scoreVerified) reasons.push('score-unverified'); if (!record.measurementQuality.timingVerified) reasons.push('timing-unverified');
    if (!record.measurementQuality.coverageVerified) reasons.push('coverage-unverified');
    if (record.elapsedMinutes === null || record.timeLimitMinutes === null) reasons.push('time-unknown');
    else if (record.elapsedMinutes > record.timeLimitMinutes) reasons.push('time-exceeded');
    if (record.unmeasuredRanges.length) reasons.push('unmeasured-ranges');
    return { id: record.id, selected: selectedIds.includes(record.id), eligible: reasons.length === 0,
      targetDifference: record.criterion ? record.score - record.criterion.targetScore : null,
      elapsedMinutes: record.elapsedMinutes, timeLimitMinutes: record.timeLimitMinutes,
      remainingMinutes: record.elapsedMinutes !== null && record.timeLimitMinutes !== null ? record.timeLimitMinutes - record.elapsedMinutes : null,
      timeAllocation: record.timeAllocation.map(section => ({ ...section })), timeAllocationMeasured: record.timeAllocation.length > 0 && record.timeAllocation.every(section => section.minutes !== null),
      unmeasuredRanges: [...record.unmeasuredRanges], exclusionReasons: reasons };
  });
  const holdReasons: string[] = [];
  const definitions = evidence.filter(record => record.subjectId === input.subjectId && record.examYear === input.examYear && record.criterion?.version === input.criterionVersion)
    .map(record => { const criterion = record.criterion!; return JSON.stringify([criterion.version, criterion.year, criterion.sourceKind, criterion.sourceUrl, criterion.targetScore]); });
  if (new Set(definitions).size > 1) holdReasons.push('criterion-definition-conflict');
  if (selected.length < 2) holdReasons.push('two-comprehensive-exams-required');
  if (records.some(record => record.selected && !record.eligible)) holdReasons.push('latest-measurement-ineligible');
  if (selected.length === 2) {
    const [latest, previous] = selected;
    if (latest.examId === previous.examId) holdReasons.push('same-exam');
    if (latest.familyId === previous.familyId) holdReasons.push('same-family');
    if (!latest.comparisonReview || !previous.comparisonReview || latest.comparisonReview.comparisonGroup !== previous.comparisonReview.comparisonGroup) holdReasons.push('not-comparable');
    if (latest.criterion?.sourceKind !== previous.criterion?.sourceKind) holdReasons.push('criterion-source-kind-mismatch');
  }
  return { version: EXAM_READINESS_VERSION, subjectId: input.subjectId, examYear: input.examYear, criterionVersion: input.criterionVersion,
    status: holdReasons.length ? 'held' : selected.every(record => record.score >= record.criterion!.targetScore) ? 'target_met_twice' : 'below_target',
    selectedIds, holdReasons, records };
}
