import type { SubjectId } from './onboarding';
import { strictIsoInstant } from './strict-iso-instant';

export type MasteryStatus = 'unconfirmed' | 'in_progress' | 'applicable' | 'exam_confirmed' | 'maintained' | 'measurement_preparing';
export type MasteryMeasurement = {
  measurementId: string; subjectId: SubjectId; conceptId: string; conceptVersion: string; criterionVersion: string;
  caseId: string; caseVersion: string; familyId: string; occurredAt: string;
  evidenceKind: 'explanation' | 'application' | 'exam' | 'retention'; outcome: 'met' | 'not_met';
  score: number; maxScore: number; targetScore: number; elapsedMinutes: number | null; timeLimitMinutes: number | null;
  hintsUsed: number; aiAnswerViewed: boolean; sourceKind: 'formal' | 'practice' | 'legacy_unverified' | 'fixture';
  reviewStatus: 'approved' | 'unreviewed' | 'withdrawn'; scoringAuthority: 'reviewed_rules' | 'expert_review' | 'ai' | 'self_reported';
  measurementQuality: 'verified' | 'unverified'; mixedConceptIds: string[];
  confidence: 'low' | 'normal' | 'high' | null; confidenceFixedBeforeResult: boolean;
  invalidated: boolean;
};
/** Trusted, single-owner server projection, never learner-supplied JSON. The caller
 * verifies owner/session/timer, reviewed criteria, current material validity and
 * completeness of this concept's disclosure history. reviewed_rules explanation
 * means a structured principle question; free-text explanation needs expert_review.
 * This function validates facts; it does not grant these authorities.
 */
export type MasteryAssessmentInput = {
  subjectId: SubjectId; conceptId: string; conceptVersion: string;
  criterion: { prepared: boolean; version: string | null }; disclosures: readonly string[];
  measurements: readonly MasteryMeasurement[]; asOf: string;
};
export type MasteryScore = { score: number | null; observedCount: number; coverage: number };
export type MasteryAssessment = {
  status: MasteryStatus; needsRecheck: boolean; subjectId: SubjectId; conceptId: string; conceptVersion: string; criterionVersion: string | null;
  scores: { explanation: MasteryScore; application: MasteryScore; exam: MasteryScore; retention: MasteryScore; calibration: MasteryScore; overall: MasteryScore };
  reasons: string[]; qualifyingMeasurementIds: string[];
};
const kinds = ['explanation', 'application', 'exam', 'retention'] as const;
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
const invalid = (): never => { throw new Error('INVALID_MASTERY_INPUT'); };
const instant = (value: unknown) => typeof value === 'string' ? strictIsoInstant(value, invalid) : invalid();
const validConfidence = (value: unknown) => value === null || ['low', 'normal', 'high'].includes(value as string);
function validateMeasurement(value: MasteryMeasurement) {
  if (!value || typeof value !== 'object' || !identifier(value.measurementId) || !identifier(value.subjectId) || !identifier(value.conceptId)
    || !identifier(value.conceptVersion) || !identifier(value.criterionVersion) || !identifier(value.caseId) || !identifier(value.caseVersion)
    || !identifier(value.familyId) || !instant(value.occurredAt) || !kinds.includes(value.evidenceKind)
    || !['met', 'not_met'].includes(value.outcome) || !Number.isFinite(value.score) || !Number.isFinite(value.maxScore) || value.maxScore <= 0
    || !Number.isFinite(value.targetScore) || value.targetScore <= 0 || value.targetScore > value.maxScore || value.score < 0 || value.score > value.maxScore
    || (value.elapsedMinutes !== null && (!Number.isFinite(value.elapsedMinutes) || value.elapsedMinutes < 0))
    || (value.timeLimitMinutes !== null && (!Number.isFinite(value.timeLimitMinutes) || value.timeLimitMinutes <= 0))
    || !Number.isSafeInteger(value.hintsUsed) || value.hintsUsed < 0 || typeof value.aiAnswerViewed !== 'boolean'
    || !['formal', 'practice', 'legacy_unverified', 'fixture'].includes(value.sourceKind) || !['approved', 'unreviewed', 'withdrawn'].includes(value.reviewStatus)
    || !['reviewed_rules', 'expert_review', 'ai', 'self_reported'].includes(value.scoringAuthority) || !['verified', 'unverified'].includes(value.measurementQuality)
    || !Array.isArray(value.mixedConceptIds) || value.mixedConceptIds.some(item => !identifier(item)) || !validConfidence(value.confidence)
    || typeof value.confidenceFixedBeforeResult !== 'boolean' || typeof value.invalidated !== 'boolean') invalid();
  if ((value.outcome === 'met' && value.score < value.targetScore) || (value.outcome === 'not_met' && value.score >= value.targetScore)) invalid();
}
const day = 86_400_000;
const formal = (m: MasteryMeasurement) => m.sourceKind === 'formal' && m.reviewStatus === 'approved' && m.measurementQuality === 'verified'
  && ['reviewed_rules', 'expert_review'].includes(m.scoringAuthority);
const inTime = (m: MasteryMeasurement) => m.elapsedMinutes !== null && m.timeLimitMinutes !== null && m.elapsedMinutes <= m.timeLimitMinutes;
// Never choose arbitrary IDs at the five-record boundary. Omit an ambiguous
// timestamp group and retain only strictly newer evidence, with actual coverage.
function recentFive(values: MasteryMeasurement[], metric: (item: MasteryMeasurement) => number, onTie: () => void) {
  const sorted = [...values].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || metric(a) - metric(b));
  let end = 0;
  while (end < sorted.length && end < 5) {
    let next = end + 1;
    while (next < sorted.length && Date.parse(sorted[next].occurredAt) === Date.parse(sorted[end].occurredAt)) next++;
    if (next > 5) { onTie(); break; }
    end = next;
  }
  return sorted.slice(0, end);
}
function score(values: MasteryMeasurement[], kind: typeof kinds[number], onTie: () => void): MasteryScore {
  const recent = recentFive(values.filter(item => item.evidenceKind === kind), item => item.score / item.maxScore, onTie);
  if (!recent.length) return { score: null, observedCount: 0, coverage: 0 };
  return { score: recent.reduce((sum, item) => sum + (item.score / item.maxScore) * 100, 0) / recent.length,
    observedCount: recent.length, coverage: recent.length / 5 };
}
function calibration(values: MasteryMeasurement[], onTie: () => void): MasteryScore {
  const p = (value: MasteryMeasurement) => value.confidence === 'low' ? .25 : value.confidence === 'normal' ? .5 : .75;
  const metric = (item: MasteryMeasurement) => 1 - Math.abs(p(item) - (item.outcome === 'met' ? 1 : 0));
  const recent = recentFive(values.filter(item => item.confidenceFixedBeforeResult && item.confidence !== null), metric, onTie);
  if (!recent.length) return { score: null, observedCount: 0, coverage: 0 };
  return { score: recent.reduce((sum, item) => sum + metric(item) * 100, 0) / recent.length,
    observedCount: recent.length, coverage: recent.length / 5 };
}
export function assessMastery(input: MasteryAssessmentInput): MasteryAssessment {
  if (!input || !Array.isArray(input.measurements) || input.measurements.length > 10000 || !identifier(input.subjectId)
    || !identifier(input.conceptId) || !identifier(input.conceptVersion) || !input.criterion || typeof input.criterion.prepared !== 'boolean'
    || (input.criterion.version !== null && !identifier(input.criterion.version)) || !Array.isArray(input.disclosures)
    || input.disclosures.length > 10000 || input.disclosures.some(disclosure => !instant(disclosure)) || !instant(input.asOf)) invalid();
  const at = Date.parse(input.asOf), seen = new Map<string, MasteryMeasurement>();
  for (const measurement of input.measurements) {
    validateMeasurement(measurement);
    if (measurement.subjectId !== input.subjectId || measurement.conceptId !== input.conceptId || measurement.conceptVersion !== input.conceptVersion
      || measurement.criterionVersion !== input.criterion.version) continue;
    const prior = seen.get(measurement.measurementId);
    if (prior && JSON.stringify(prior) !== JSON.stringify(measurement)) invalid();
    if (!prior && Date.parse(measurement.occurredAt) <= at) seen.set(measurement.measurementId, measurement);
  }
  // A registered version alone does not make its criterion ready for assessment.
  const values = (input.criterion.prepared && input.criterion.version !== null ? [...seen.values()] : [])
    .sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.measurementId.localeCompare(b.measurementId));
  const scorable = values.filter(item => !item.invalidated && item.sourceKind === 'formal' && item.reviewStatus === 'approved' && item.measurementQuality === 'verified'
    && ['reviewed_rules', 'expert_review'].includes(item.scoringAuthority));
  let scoreTiesExcluded = false;
  const onScoreTie = () => { scoreTiesExcluded = true; };
  const scores: MasteryAssessment['scores'] = { explanation: score(scorable, 'explanation', onScoreTie), application: score(scorable, 'application', onScoreTie), exam: score(scorable, 'exam', onScoreTie), retention: score(scorable, 'retention', onScoreTie), calibration: calibration(scorable, onScoreTie), overall: { score: null, observedCount: 0, coverage: 0 } };
  const weighted = ([['explanation', 25], ['application', 25], ['exam', 30], ['retention', 15], ['calibration', 5]] as const)
    .filter(([kind]) => scores[kind].score !== null);
  const weight = weighted.reduce((sum, [, value]) => sum + value, 0);
  scores.overall = { score: weight ? weighted.reduce((sum, [kind, value]) => sum + scores[kind].score! * value, 0) / weight : null,
    observedCount: weighted.reduce((sum, [kind]) => sum + scores[kind].observedCount, 0),
    coverage: weighted.reduce((sum, [kind, value]) => sum + scores[kind].coverage * value, 0) / 100 };
  const formalValues = values.filter(item => formal(item) && !item.invalidated);
  const disclosures = input.disclosures.map(Date.parse).filter(time => time <= at).sort((a, b) => a - b);
  let disclosureIndex = 0, lastDisclosure: number | null = null, disclosureExcluded = false;
  let explanation = false, examConfirmed = false, maintained = false, pairFound = false;
  let timeFamilyPairFound = false, mixedExamFound = false;
  const recovery = new Set<MasteryMeasurement['evidenceKind']>();
  let lastEvidence: MasteryMeasurement[] = [];
  const applicationCases = new Set<string>(), recoveryCases = new Set<string>();
  const qualifyingMeasurementIds: string[] = [];
  // In time order, only the earliest two distinct families are needed to find
  // a different-family predecessor. Keep a separate pair for mixed questions.
  const earliest: MasteryMeasurement[] = [], earliestMixed: MasteryMeasurement[] = [];
  const remember = (list: MasteryMeasurement[], item: MasteryMeasurement) => {
    if (list.length < 2 && !list.some(prior => prior.familyId === item.familyId)) list.push(item);
  };
  const batches = new Map<number, MasteryMeasurement[]>();
  for (const item of formalValues) {
    const time = Date.parse(item.occurredAt);
    const batch = batches.get(time) ?? [];
    batch.push(item); batches.set(time, batch);
  }
  for (const [time, batch] of batches) {
    while (disclosureIndex < disclosures.length && disclosures[disclosureIndex] <= time) lastDisclosure = disclosures[disclosureIndex++];
    const events = batch.map(item => {
      const timed = item.evidenceKind === 'exam' || item.evidenceKind === 'retention';
      const timeExceeded = timed && item.elapsedMinutes !== null && item.timeLimitMinutes !== null && item.elapsedMinutes > item.timeLimitMinutes;
      const failed = item.outcome === 'not_met' || timeExceeded;
      const met = item.outcome === 'met' && !item.aiAnswerViewed && item.hintsUsed === 0 && (!timed || inTime(item));
      const independentTimed = !timed || lastDisclosure === null || time - lastDisclosure >= 2 * day;
      if (met && !independentTimed) disclosureExcluded = true;
      return { item, failed, qualifies: met && independentTimed };
    });
    const clockEvents = events.filter(event => event.failed || event.qualifies);
    // Ties have no temporal order. Require every possible latest predecessor
    // to be a different problem, and no concurrent clock-advancing non-retention.
    const retentionEstablished = examConfirmed && lastEvidence.length > 0 && clockEvents.length > 0
      && [...recovery].every(kind => kind === 'retention')
      && clockEvents.every(event => event.qualifies && event.item.evidenceKind === 'retention'
        && lastEvidence.every(prior => time - Date.parse(prior.occurredAt) >= 21 * day
          && event.item.caseId !== prior.caseId && event.item.familyId !== prior.familyId));
    if (clockEvents.length) maintained = retentionEstablished;
    // Process failures last so a simultaneous success cannot recover them.
    for (const { item, failed, qualifies } of [...events.filter(event => !event.failed), ...events.filter(event => event.failed)]) {
      if (failed) {
        recovery.add(item.evidenceKind); maintained = false;
        if (item.evidenceKind === 'application') recoveryCases.clear();
        if (item.evidenceKind === 'exam') {
          earliest.length = 0; earliestMixed.length = 0;
          timeFamilyPairFound = false; mixedExamFound = false;
        }
      }
      if (qualifies) {
        qualifyingMeasurementIds.push(item.measurementId);
        if (item.evidenceKind === 'explanation') {
          explanation = true;
          recovery.delete('explanation');
        }
        if (item.evidenceKind === 'application') {
          applicationCases.add(item.caseId);
          if (recovery.has('application')) { recoveryCases.add(item.caseId); if (recoveryCases.size >= 2) recovery.delete('application'); }
        }
        if (item.evidenceKind === 'exam') {
          const mixed = item.mixedConceptIds.includes(input.conceptId) && new Set(item.mixedConceptIds).size >= 2;
          mixedExamFound ||= mixed;
          timeFamilyPairFound ||= earliest.some(prior => prior.familyId !== item.familyId && time - Date.parse(prior.occurredAt) >= 2 * day);
          const pair = (mixed ? earliest : earliestMixed).some(prior => prior.familyId !== item.familyId && time - Date.parse(prior.occurredAt) >= 2 * day);
          if (pair) { pairFound = true; recovery.delete('exam'); }
          remember(earliest, item);
          if (mixed) remember(earliestMixed, item);
        }
      }
    }
    if (retentionEstablished) recovery.delete('retention');
    if (explanation && applicationCases.size >= 2 && pairFound) examConfirmed = true;
    // Preserve all possible latest problems, not whichever ID happened to sort last.
    if (clockEvents.length) lastEvidence = clockEvents.map(event => event.item);
  }
  let needsRecheck = recovery.size > 0;
  let status: MasteryStatus = maintained ? 'maintained' : examConfirmed ? 'exam_confirmed' : applicationCases.size >= 2 ? 'applicable' : scorable.length ? 'in_progress' : 'unconfirmed';
  const reasons: string[] = [];
  if (!input.criterion.prepared || input.criterion.version === null) {
    status = 'measurement_preparing'; needsRecheck = false;
    reasons.push('概念別の専門レビュー済み基準が未準備です。');
  } else {
    if (!scorable.length) reasons.push('有効な正式測定がありません。');
    if (scoreTiesExcluded) reasons.push('同時刻で直近5件の範囲を確定できない証拠は参考集計から除外しました。');
    if (!explanation) reasons.push('原理説明の構造化問題または人間レビュー済み説明の基準達成が未確認です。');
    if (applicationCases.size < 2) reasons.push('異なる2実務ケースのノーヒント測定が不足しています。');
    if (!timeFamilyPairFound) reasons.push('48時間以上離れた異なる問題ファミリーの正式測定が不足しています。');
    if (!mixedExamFound) reasons.push('対象概念と別概念を含む混合問題の正式測定が不足しています。');
    if (timeFamilyPairFound && mixedExamFound && !pairFound) reasons.push('48時間・別ファミリー・混合問題を同じペアで満たす測定が不足しています。');
    if (disclosureExcluded) reasons.push('解説・答案開示から48時間未満の試験・保持証拠を除外しました。');
    if (examConfirmed && !maintained) reasons.push('最後の適格証拠から21日後の保持確認がありません。');
    if (needsRecheck) reasons.push('未達となった正式測定の再確認がまだ完了していません。');
  }
  return { status, needsRecheck, subjectId: input.subjectId, conceptId: input.conceptId, conceptVersion: input.conceptVersion,
    criterionVersion: input.criterion.version, scores, reasons, qualifyingMeasurementIds };
}
