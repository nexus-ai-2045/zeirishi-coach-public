import { createHash } from 'node:crypto';
import { SUBJECTS, type Concept, type SubjectId } from '../domain/onboarding';
import { StudyError } from '../domain/types';
import type { CafeMaterial, CafePrompt, CafeResult } from './cafe-case';
import { strictCanonicalJson } from './strict-canonical-json';

export type MaterialRights = Record<'acquisition' | 'storage' | 'reproduction' | 'modification' | 'redistribution' | 'aiInput', 'allowed' | 'denied' | 'unknown'>;
export type MaterialSource = { sourceId: string; termsUrl: string; checkedAt: string; attribution: string; permissionNote: string; rights: MaterialRights };
export type CafeMaterialDocument = {
  prompt: CafePrompt; scoringVersion: string; results: Record<string, CafeResult>;
  exceptions: string[]; aiGrounding: { sourceId: string; text: string }[]; examTranslation: string;
};
export type MaterialRecord = {
  materialId: string; version: string; subjectId: SubjectId; concept: Concept; authorId: string;
  document: CafeMaterialDocument; sources: MaterialSource[]; taxYear?: number; basisDate?: string;
  status: 'draft' | 'expert_review' | 'approved' | 'active' | 'retired';
  expertReview?: { reviewerId: string; documentSha256: string; reviewedAt: string };
  activation?: { documentSha256: string; approvedBy: string; approvedAt: string };
};
export type ActiveMaterial = { record: MaterialRecord; material: CafeMaterial; aiInputAllowed: boolean };
const uses = ['acquisition', 'storage', 'reproduction', 'modification', 'redistribution', 'aiInput'] as const;
function invalid(): never { throw new StudyError('INVALID_MATERIAL_REGISTRY', 503); }
function text(value: unknown): asserts value is string { if (typeof value !== 'string' || !value.trim()) invalid(); }
function id(value: unknown) { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) invalid(); }
function day(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) invalid();
}
function instant(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) invalid();
  if (new Date(value).toISOString() !== (value.length === 20 ? value.slice(0, -1) + '.000Z' : value)) invalid();
}
function keys(value: object, allowed: readonly string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) invalid(); }
function freezeJson<T>(value: T): T {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeJson); Object.freeze(value); }
  return value;
}
/** Strict canonical JSON: reject functions, getters, custom objects, cycles, holes and non-finite values. */
function canonical(value: unknown): string { return strictCanonicalJson(value, invalid); }

/** Attestation hashes bind content AND rights, identity, metadata and tax applicability. */
export function materialReviewSha256(record: MaterialRecord): string {
  canonical(record); // Reject non-JSON data even in fields excluded from the review payload.
  return createHash('sha256').update(canonical({ materialId: record.materialId, version: record.version, subjectId: record.subjectId,
    concept: record.concept, authorId: record.authorId, document: record.document, sources: record.sources,
    taxYear: record.taxYear ?? null, basisDate: record.basisDate ?? null })).digest('hex');
}
function validateDocument(record: MaterialRecord) {
  const { document: doc } = record;
  keys(doc, ['prompt', 'scoringVersion', 'results', 'exceptions', 'aiGrounding', 'examTranslation']);
  const prompt = doc.prompt;
  keys(prompt, ['caseId', 'caseVersion', 'conceptId', 'familyId', 'developmentOnly', 'title', 'consultationTitle', 'context', 'consultation', 'task', 'facts', 'assumption', 'options']);
  id(doc.scoringVersion); id(prompt.caseId); id(prompt.familyId);
  // Reserved development-version namespace, not a substitute for expert review.
  if (record.version.startsWith('synthetic-') || doc.scoringVersion.startsWith('synthetic-')) invalid();
  if (prompt.caseId !== record.materialId || prompt.caseVersion !== record.version || prompt.conceptId !== record.concept.conceptId || prompt.developmentOnly !== false) invalid();
  for (const value of [prompt.title, prompt.consultationTitle, prompt.context, prompt.consultation, prompt.task, prompt.assumption, doc.examTranslation]) text(value);
  if (prompt.consultationTitle.length > 200) invalid();
  if (!Array.isArray(prompt.facts) || !prompt.facts.length) invalid();
  for (const fact of prompt.facts) { keys(fact, ['label', 'value']); text(fact.label); text(fact.value); }
  if (!Array.isArray(prompt.options) || prompt.options.length !== 4) invalid();
  const optionIds = new Set<string>();
  for (const option of prompt.options) { keys(option, ['id', 'label']); id(option.id); text(option.label); if (optionIds.has(option.id)) invalid(); optionIds.add(option.id); }
  if (!doc.results || Object.keys(doc.results).length !== 4 || Object.keys(doc.results).some(key => !optionIds.has(key))) invalid();
  let correct = 0;
  for (const [optionId, result] of Object.entries(doc.results)) {
    keys(result, ['caseVersion', 'scoringVersion', 'optionId', 'correct', 'earned', 'max', 'developmentOnly', 'evidenceQualification', 'misconceptionCandidate', 'explanation', 'periods', 'teachBack', 'followUp', 'checkpoints', 'learningNotes']);
    if (result.learningNotes !== undefined) {
      if (!result.learningNotes || typeof result.learningNotes !== 'object' || Array.isArray(result.learningNotes)) invalid();
      keys(result.learningNotes, ['exceptions', 'examTranslation']);
      if (!Array.isArray(result.learningNotes.exceptions)) invalid();
      result.learningNotes.exceptions.forEach(text);
      text(result.learningNotes.examTranslation);
      if (canonical(result.learningNotes.exceptions) !== canonical(doc.exceptions) || result.learningNotes.examTranslation !== doc.examTranslation) invalid();
    }
    if (result.caseVersion !== record.version || result.optionId !== optionId || result.scoringVersion !== doc.scoringVersion
      || result.developmentOnly !== false || result.evidenceQualification !== 'practice_only' || typeof result.correct !== 'boolean'
      || result.max !== 1 || result.earned !== (result.correct ? 1 : 0)) invalid();
    if (result.correct) correct++;
    for (const value of [result.explanation, result.teachBack, result.followUp]) text(value);
    if (!result.correct || result.misconceptionCandidate !== null) text(result.misconceptionCandidate);
    if (!Array.isArray(result.checkpoints) || !result.checkpoints.length || !Array.isArray(result.periods)) invalid();
    result.checkpoints.forEach(text);
    for (const period of result.periods) { keys(period, ['month', 'allocation', 'amount']); text(period.allocation); if (!Number.isInteger(period.month) || period.month < 1 || period.month > 12 || !Number.isFinite(period.amount) || period.amount < 0) invalid(); }
  }
  if (correct !== 1 || !Array.isArray(doc.exceptions) || !Array.isArray(doc.aiGrounding)) invalid();
  doc.exceptions.forEach(text);
  for (const ground of doc.aiGrounding) { keys(ground, ['sourceId', 'text']); text(ground.text); if (!record.sources.some(source => source.sourceId === ground.sourceId)) invalid(); }
}

/** These records express human review; code verifies matching evidence, not the reviewer's identity or honesty. */
export function createMaterialRegistry(records: readonly MaterialRecord[]): readonly ActiveMaterial[] {
  if (!Array.isArray(records)) invalid();
  const snapshot = JSON.parse(canonical(records)) as MaterialRecord[];
  const seen = new Set<string>(); const activeConcepts = new Map<string, Concept>(); const activeIds = new Set<string>(); const versions = new Set<string>(); const active: ActiveMaterial[] = [];
  for (const record of snapshot) {
    keys(record, ['materialId', 'version', 'subjectId', 'concept', 'authorId', 'document', 'sources', 'taxYear', 'basisDate', 'status', 'expertReview', 'activation']);
    id(record.materialId); id(record.version); id(record.authorId);
    if (!SUBJECTS.some(subject => subject.id === record.subjectId) || !['draft', 'expert_review', 'approved', 'active', 'retired'].includes(record.status)) invalid();
    const identity = record.materialId + '/' + record.version;
    if (seen.has(identity)) invalid(); seen.add(identity);
    // Persisted cases are keyed by version alone: never recycle even a retired version.
    if (versions.has(record.version)) invalid(); versions.add(record.version);
    // Unfinished drafts may carry incomplete approval/content; never expose them as live material.
    if (record.status !== 'active') continue;
    if (activeIds.has(record.materialId)) invalid(); activeIds.add(record.materialId);
    const concept = record.concept;
    keys(concept, ['subjectId', 'conceptId', 'conceptVersion', 'label', 'importance', 'durationMinutes', 'unseenQuestionCount']);
    id(concept.conceptId); id(concept.conceptVersion); text(concept.label); if (concept.label.length > 200) invalid();
    if (concept.subjectId !== record.subjectId || concept.unseenQuestionCount !== 0
      || !Number.isInteger(concept.importance) || concept.importance < 1 || concept.importance > 5
      || !Number.isInteger(concept.durationMinutes) || concept.durationMinutes < 1 || concept.durationMinutes > 10080) invalid();
    const conceptKey = record.subjectId + '/' + concept.conceptId;
    const existingConcept = activeConcepts.get(conceptKey);
    if (existingConcept && canonical(existingConcept) !== canonical(concept)) invalid();
    activeConcepts.set(conceptKey, concept);
    if (!Array.isArray(record.sources) || !record.sources.length) invalid();
    const sourceIds = new Set<string>();
    for (const source of record.sources) {
      keys(source, ['sourceId', 'termsUrl', 'checkedAt', 'attribution', 'permissionNote', 'rights']);
      id(source.sourceId); if (sourceIds.has(source.sourceId)) invalid(); sourceIds.add(source.sourceId);
      day(source.checkedAt); text(source.attribution); text(source.permissionNote);
      let url: URL; try { url = new URL(source.termsUrl); } catch { invalid(); }
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalid();
      keys(source.rights, uses);
      for (const use of uses) if (!['allowed', 'denied', 'unknown'].includes(source.rights[use]) || (use !== 'aiInput' && source.rights[use] !== 'allowed')) invalid();
    }
    if (!['bookkeeping', 'financial-statements'].includes(record.subjectId)) {
      if (!Number.isInteger(record.taxYear) || record.taxYear! < 1900 || record.taxYear! > 2200) invalid();
      day(record.basisDate);
    } else { if (record.basisDate !== undefined) day(record.basisDate); if (record.taxYear !== undefined && (!Number.isInteger(record.taxYear) || record.taxYear < 1900 || record.taxYear > 2200)) invalid(); }
    validateDocument(record);
    const hash = materialReviewSha256(record);
    const review = record.expertReview, activation = record.activation;
    if (!review || !activation) invalid();
    keys(review, ['reviewerId', 'documentSha256', 'reviewedAt']); keys(activation, ['documentSha256', 'approvedBy', 'approvedAt']);
    id(review.reviewerId); id(activation.approvedBy); instant(review.reviewedAt); instant(activation.approvedAt);
    if (review.reviewerId === record.authorId || review.documentSha256 !== hash || activation.documentSha256 !== hash
      || Date.parse(activation.approvedAt) < Date.parse(review.reviewedAt)) invalid();
    const doc = structuredClone(record.document);
    const material: CafeMaterial = { caseVersion: record.version, scoringVersion: doc.scoringVersion,
      concept: { subjectId: record.subjectId, conceptId: concept.conceptId, conceptVersion: concept.conceptVersion },
      prompt: () => structuredClone(doc.prompt),
      grade: (version, optionId) => {
        if (version !== doc.prompt.caseVersion) throw new StudyError('CASE_VERSION_CONFLICT', 409);
        if (!Object.hasOwn(doc.results, optionId)) throw new StudyError('INVALID_OPTION');
        return { ...structuredClone(doc.results[optionId]), learningNotes: {
          exceptions: structuredClone(doc.exceptions), examTranslation: doc.examTranslation,
        } };
      } };
    active.push(Object.freeze({ record: freezeJson(record), material: Object.freeze(material), aiInputAllowed: record.sources.every(source => source.rights.aiInput === 'allowed') }));
  }
  return Object.freeze(active);
}
