// Subject names: https://www.nta.go.jp/taxes/zeirishi/zeirishishiken/gaiyo/gaiyou.htm
import type { SubjectMapPack } from './subject-map';
export const SUBJECTS = [
  { id: 'bookkeeping', label: '簿記論' },
  { id: 'financial-statements', label: '財務諸表論' },
  { id: 'income-tax', label: '所得税法' },
  { id: 'corporation-tax', label: '法人税法' },
  { id: 'inheritance-tax', label: '相続税法' },
  { id: 'consumption-tax', label: '消費税法' },
  { id: 'liquor-tax', label: '酒税法' },
  { id: 'national-tax-collection', label: '国税徴収法' },
  { id: 'inhabitant-tax', label: '住民税' },
  { id: 'enterprise-tax', label: '事業税' },
  { id: 'fixed-asset-tax', label: '固定資産税' },
] as const;

export type SubjectId = typeof SUBJECTS[number]['id'];
export type SelfConfidence = 'explained' | 'uncertain' | 'unlearned' | null;
export type ConceptRef = { subjectId: SubjectId; conceptId: string; conceptVersion: string };
export type ConfidenceReport = ConceptRef & { selfConfidence: SelfConfidence };
export type Concept = ConceptRef & {
  label: string;
  importance: number;
  durationMinutes: number;
  unseenQuestionCount: number;
};
export type SubjectPack = {
  subjectId: SubjectId;
  version: string;
  // True only after the caller's material-publication gate. Not an approval mechanism.
  active: boolean;
  concepts: readonly Concept[];
  /** Optional, version-matched projection of this pack; never a second approval source. */
  subjectMap?: SubjectMapPack;
};
export type InitialRecommendation = {
  concept: Concept;
  packVersion: string;
  selfConfidence: Exclude<SelfConfidence, 'explained'>;
  reason: string;
  basis: 'self-report' | 'unselected';
};

export class OnboardingInputError extends Error {
  constructor() { super('INVALID_ONBOARDING_INPUT'); this.name = 'OnboardingInputError'; }
}
function invalid(): never { throw new OnboardingInputError(); }
function identifier(value: unknown): string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value) ? value : invalid();
}
export function parseSubjectId(value: unknown): SubjectId {
  return SUBJECTS.some(subject => subject.id === value) ? value as SubjectId : invalid();
}
/** Planned exam subjects, independent of today's lesson and self-confidence. */
export function parseExamSubjects(value: unknown): SubjectId[] | null {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > SUBJECTS.length) invalid();
  const subjects = Array.from(value, parseSubjectId);
  if (new Set(subjects).size !== subjects.length) invalid();
  return subjects.sort();
}
export function parseSelfConfidence(value: unknown): SelfConfidence {
  return value === null || value === 'explained' || value === 'uncertain' || value === 'unlearned' ? value : invalid();
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}
export function parseConceptRef(value: unknown): ConceptRef {
  const input = record(value);
  return { subjectId: parseSubjectId(input.subjectId), conceptId: identifier(input.conceptId), conceptVersion: identifier(input.conceptVersion) };
}
export function parseConfidenceReport(value: unknown): ConfidenceReport {
  const input = record(value);
  if (Object.keys(input).some(key => !['subjectId', 'conceptId', 'conceptVersion', 'selfConfidence'].includes(key))) invalid();
  return { ...parseConceptRef(input), selfConfidence: parseSelfConfidence(input.selfConfidence) };
}
export const validateConfidenceReport = parseConfidenceReport;
function key(ref: ConceptRef): string { return JSON.stringify([ref.subjectId, ref.conceptId, ref.conceptVersion]); }

/** One active pack per subject; never infer active status from inventory or version text. */
function activeConcepts(packs: readonly SubjectPack[], subjectId: SubjectId): { concept: Concept; packVersion: string }[] {
  parseSubjectId(subjectId);
  if (!Array.isArray(packs)) invalid();
  const matches = packs.filter(pack => pack.subjectId === subjectId && pack.active === true);
  if (matches.length > 1) invalid();
  const pack = matches[0];
  if (!pack) return [];
  identifier(pack.version);
  if (!Array.isArray(pack.concepts)) invalid();
  const ids = new Set<string>();
  return pack.concepts.map((concept: Concept) => {
    parseConceptRef(concept);
    if (concept.subjectId !== subjectId || ids.has(concept.conceptId)
      || typeof concept.label !== 'string' || !concept.label.trim()
      || !Number.isInteger(concept.importance) || concept.importance < 1 || concept.importance > 5
      || !Number.isFinite(concept.durationMinutes) || concept.durationMinutes <= 0
      || !Number.isSafeInteger(concept.unseenQuestionCount) || concept.unseenQuestionCount < 0) invalid();
    ids.add(concept.conceptId);
    return { concept: { ...concept }, packVersion: pack.version };
  });
}

/** Initial, unmeasured selection only. This returns no mastery or attempt evidence. */
export function initialRecommendations(packs: readonly SubjectPack[], reports: readonly ConfidenceReport[], subjectId: SubjectId): InitialRecommendation[] {
  if (!Array.isArray(reports)) invalid();
  const confidence = new Map<string, SelfConfidence>();
  for (const raw of reports) {
    const report = parseConfidenceReport(raw);
    if (confidence.has(key(report))) invalid();
    confidence.set(key(report), report.selfConfidence);
  }
  const candidates: InitialRecommendation[] = [];
  for (const { concept, packVersion } of activeConcepts(packs, subjectId)) {
    const selfConfidence = confidence.get(key(concept)) ?? null;
    if (selfConfidence === 'explained') continue;
    candidates.push({ concept, packVersion, selfConfidence,
      basis: selfConfidence === null ? 'unselected' : 'self-report',
      reason: selfConfidence === 'uncertain' ? '自分で「少し怪しい」を選んだため'
        : selfConfidence === 'unlearned' ? '自分で「未学習」を選んだため' : 'まだ自信を選択していないため',
    });
  }
  const rank = (value: SelfConfidence) => value === 'uncertain' ? 0 : value === 'unlearned' ? 1 : 2;
  return candidates.sort((a, b) => rank(a.selfConfidence) - rank(b.selfConfidence)
    || b.concept.importance - a.concept.importance
    || a.concept.durationMinutes - b.concept.durationMinutes
    || (a.concept.conceptId < b.concept.conceptId ? -1 : a.concept.conceptId > b.concept.conceptId ? 1 : 0)).slice(0, 3);
}

/** Direct selection is independent of confidence and prerequisite mastery. */
export function directSelection(packs: readonly SubjectPack[], reference: ConceptRef): Concept | null {
  const ref = parseConceptRef(reference);
  return activeConcepts(packs, ref.subjectId).find(item => key(item.concept) === key(ref))?.concept ?? null;
}
export function shortCheckAvailability(packs: readonly SubjectPack[], reference: ConceptRef):
  { available: true; questionCount: number; estimatedMinutes: 2 }
  | { available: false; reason: 'material-unavailable' | 'unseen-inventory-empty' } {
  const concept = directSelection(packs, reference);
  if (!concept) return { available: false, reason: 'material-unavailable' };
  if (concept.unseenQuestionCount === 0) return { available: false, reason: 'unseen-inventory-empty' };
  return { available: true, questionCount: Math.min(3, concept.unseenQuestionCount), estimatedMinutes: 2 };
}
