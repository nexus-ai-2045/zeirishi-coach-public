import { parseSubjectId, type SubjectId } from './onboarding';

export type MapReviewStatus = 'draft' | 'expert_review' | 'approved' | 'active';
export type MapUnit = { unitId: string; label: string; order: number; status: MapReviewStatus; sourceId: string; applicableYear: number | null };
export type MapTopic = { topicId: string; unitId: string; label: string; summary: string; order: number; status: MapReviewStatus; sourceId: string; applicableYear: number | null };
export type MapConcept = {
  conceptId: string; conceptVersion: string; label: string; definition: string; purpose: string;
  applicability: string; counterexample: string; misconception: string; materialCue: string; examUse: string;
  status: MapReviewStatus; sourceId: string; applicableYear: number | null;
};
export type MapLink = {
  kind: 'prerequisite' | 'explains-topic' | 'uses-case' | 'exam-question';
  sourceId: string; sourceVersion: string; targetId: string; targetVersion: string;
  role?: 'primary' | 'secondary'; basis: string; status: MapReviewStatus;
};
export type SubjectMapPack = {
  subjectId: SubjectId; version: string; status: MapReviewStatus;
  /** Explicit legacy subject namespace only. Legacy topic IDs require reviewed one-by-one mapping. */
  legacySubjectId?: 'boki';
  units: MapUnit[]; topics: MapTopic[]; concepts: MapConcept[]; links: MapLink[];
};

export class SubjectMapError extends Error {
  constructor() { super('INVALID_SUBJECT_MAP'); this.name = 'SubjectMapError'; }
}
function invalid(): never { throw new SubjectMapError(); }
function id(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) invalid();
}
function text(value: unknown): asserts value is string { if (typeof value !== 'string' || !value.trim()) invalid(); }
function status(value: unknown): asserts value is MapReviewStatus {
  if (!['draft', 'expert_review', 'approved', 'active'].includes(value as string)) invalid();
}
function year(value: unknown) { if (value !== null && (!Number.isInteger(value) || (value as number) < 1900 || (value as number) > 2200)) invalid(); }
function unique<K>(items: readonly K[], key: (item: K) => string): Map<string, K> {
  const entries = new Map<string, K>();
  for (const item of items) { const value = key(item); if (entries.has(value)) invalid(); entries.set(value, item); }
  return entries;
}

/** Only the subject namespace is mapped. boki.* unit/topic IDs are not silently converted. */
export function mapLegacySubjectId(value: string): SubjectId {
  if (value !== 'boki') invalid();
  return 'bookkeeping';
}

export type SubjectMapValidation = {
  published?: boolean;
  /** From the existing reviewed material registry, keyed by subject, primary concept and material version. */
  approvedMaterials?: ReadonlySet<string>;
  /** From an independently reviewed question inventory, with the same scoped key. */
  approvedQuestions?: ReadonlySet<string>;
};

export function subjectMapTargetKey(subjectId: SubjectId, conceptId: string, conceptVersion: string, targetId: string, targetVersion: string): string {
  return JSON.stringify([subjectId, conceptId, conceptVersion, targetId, targetVersion]);
}

/** Validates a read-only projection; it does not create mastery evidence or approve source content. */
export function validateSubjectMap(pack: SubjectMapPack, options: SubjectMapValidation = {}): SubjectMapPack {
  if (!pack || typeof pack !== 'object') invalid();
  try { parseSubjectId(pack.subjectId); } catch { invalid(); }
  id(pack.version); status(pack.status);
  if (pack.legacySubjectId !== undefined && (mapLegacySubjectId(pack.legacySubjectId) !== pack.subjectId)) invalid();
  if (![pack.units, pack.topics, pack.concepts, pack.links].every(Array.isArray)) invalid();
  if (options.published && (pack.status !== 'active' || pack.version.startsWith('synthetic-'))) invalid();

  const units = unique(pack.units, unit => { id(unit.unitId); text(unit.label); id(unit.sourceId); status(unit.status); year(unit.applicableYear);
    if (!Number.isInteger(unit.order) || unit.order < 0) invalid(); return unit.unitId; });
  const topics = unique(pack.topics, topic => { id(topic.topicId); id(topic.unitId); text(topic.label); text(topic.summary);
    id(topic.sourceId); status(topic.status); year(topic.applicableYear);
    if (!Number.isInteger(topic.order) || topic.order < 0 || !units.has(topic.unitId)) invalid(); return topic.topicId; });
  const concepts = unique(pack.concepts, concept => { id(concept.conceptId); id(concept.conceptVersion);
    for (const value of [concept.label, concept.definition, concept.purpose, concept.applicability, concept.counterexample,
      concept.misconception, concept.materialCue, concept.examUse]) text(value);
    id(concept.sourceId); status(concept.status); year(concept.applicableYear); return concept.conceptId; });
  if (options.published && ([...pack.units, ...pack.topics, ...pack.concepts].some(node =>
    node.status !== 'active' || node.sourceId.startsWith('synthetic-'))
    || pack.concepts.some(concept => concept.conceptVersion.startsWith('synthetic-')))) invalid();

  const links = unique(pack.links, link => {
    if (!['prerequisite', 'explains-topic', 'uses-case', 'exam-question'].includes(link.kind)) invalid();
    id(link.sourceId); id(link.sourceVersion); id(link.targetId); id(link.targetVersion); text(link.basis); status(link.status);
    const source = concepts.get(link.sourceId);
    if (!source || source.conceptVersion !== link.sourceVersion) invalid();
    if (link.kind === 'prerequisite') {
      const target = concepts.get(link.targetId);
      if (!target || target.conceptVersion !== link.targetVersion || link.role !== undefined) invalid();
    } else if (link.kind === 'explains-topic') {
      if (!topics.has(link.targetId) || link.targetVersion !== pack.version || link.role !== undefined) invalid();
    } else {
      if (!['primary', 'secondary'].includes(link.role as string)) invalid();
      if (options.published) {
        const inventory = link.kind === 'uses-case' ? options.approvedMaterials : options.approvedQuestions;
        if (link.role === 'primary' && !inventory?.has(subjectMapTargetKey(pack.subjectId, link.sourceId, link.sourceVersion, link.targetId, link.targetVersion))) invalid();
      }
    }
    if (options.published && (link.status !== 'active' || link.targetVersion.startsWith('synthetic-'))) invalid();
    return [link.kind, link.sourceId, link.sourceVersion, link.targetId, link.targetVersion].join('/');
  });

  const primary = new Map<string, number>();
  const referenced = new Set<string>();
  for (const link of links.values()) {
    if (link.kind !== 'uses-case' && link.kind !== 'exam-question') continue;
    const key = `${link.kind}/${link.targetId}/${link.targetVersion}`;
    referenced.add(key);
    if (link.role === 'primary') primary.set(key, (primary.get(key) ?? 0) + 1);
  }
  if ([...referenced].some(key => primary.get(key) !== 1)) invalid();

  const successors = new Map<string, string[]>();
  for (const link of links.values()) if (link.kind === 'prerequisite') {
    successors.set(link.sourceId, [...successors.get(link.sourceId) ?? [], link.targetId]);
  }
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (node: string) => {
    if (visiting.has(node)) invalid();
    if (visited.has(node)) return;
    visiting.add(node);
    for (const next of successors.get(node) ?? []) visit(next);
    visiting.delete(node); visited.add(node);
  };
  for (const node of concepts.keys()) visit(node);
  return pack;
}

export function conceptTopics(pack: SubjectMapPack, conceptId: string): MapTopic[] {
  return pack.links.filter(link => link.kind === 'explains-topic' && link.sourceId === conceptId)
    .map(link => pack.topics.find(topic => topic.topicId === link.targetId))
    .filter((topic): topic is MapTopic => topic !== undefined)
    .sort((a, b) => a.order - b.order || a.topicId.localeCompare(b.topicId));
}
export function topicConcepts(pack: SubjectMapPack, topicId: string): MapConcept[] {
  return pack.links.filter(link => link.kind === 'explains-topic' && link.targetId === topicId)
    .map(link => pack.concepts.find(concept => concept.conceptId === link.sourceId))
    .filter((concept): concept is MapConcept => concept !== undefined);
}
