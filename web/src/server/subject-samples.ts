import { createHash } from 'node:crypto';
import type { CafeMaterial } from './cafe-case';
import { StudyError } from '../domain/types';
import { SUBJECTS, type SubjectId, type SubjectPack } from '../domain/onboarding';
import { validateSubjectMap, type MapConcept, type MapLink } from '../domain/subject-map';
import samples from './subject-samples.json' with { type: 'json' };
import financialStatementsTree from './subject-trees/financial-statements.json' with { type: 'json' };
import incomeTaxTree from './subject-trees/income-tax.json' with { type: 'json' };
import corporationTaxTree from './subject-trees/corporation-tax.json' with { type: 'json' };
import consumptionTaxTree from './subject-trees/consumption-tax.json' with { type: 'json' };
import inheritanceTaxTree from './subject-trees/inheritance-tax.json' with { type: 'json' };

/**
 * Sample questions for subjects other than bookkeeping: three per subject, so the screens can be
 * checked before writing the rest. AI-authored drafts, not expert-reviewed; practice only.
 */
export type SubjectSample = {
  id: string; subjectId: Exclude<SubjectId, 'bookkeeping'>; topic: string | null; title: string;
  definition: string; purpose: string; applicability: string; counterexample: string; misconception: string; examUse: string;
  prompt: string; answer: string; wrong: [string, string, string]; wrongReasons: [string, string, string]; explanation: string;
};
export const SUBJECT_SAMPLE_BASIS = samples.basis as Record<Exclude<SubjectId, 'bookkeeping'>, string>;
export const SUBJECT_SAMPLES = samples.items as SubjectSample[];
export const SUBJECT_SAMPLE_SUBJECTS = SUBJECTS.filter(subject => subject.id !== 'bookkeeping');

type ConceptFields = { definition: string; purpose: string; applicability: string; counterexample: string; misconception: string; materialCue: string; examUse: string };
/** Whole-subject tree: field → topic, one concept per topic, with prerequisite links. AI-authored, not expert-reviewed. */
export type SubjectTree = {
  subjectId: Exclude<SubjectId, 'bookkeeping'>; version: string; note: string;
  units: { unitId: string; label: string }[];
  topics: { key: string; unitId: string; label: string; summary: string; frequency: 'high' | 'mid' | 'low'; legacyTopics: string[]; concept: ConceptFields; sampleId: string | null; example?: string }[];
  glossary?: Record<string, string>;
  prerequisites: { from: string; to: string }[];
};
export const SUBJECT_TREES = [financialStatementsTree, incomeTaxTree, corporationTaxTree, consumptionTaxTree, inheritanceTaxTree] as SubjectTree[];
const treeFor = (subjectId: SubjectId) => SUBJECT_TREES.find(tree => tree.subjectId === subjectId);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
const label = (subjectId: SubjectId) => SUBJECTS.find(subject => subject.id === subjectId)!.label;
const treeConceptId = (key: string) => `tree-${key}`;
const treeConceptVersion = (topic: SubjectTree['topics'][number]) => `synthetic-tree-concept-${hash([topic.key, topic.label, topic.concept])}`;
const treeTopicOf = (item: SubjectSample) => treeFor(item.subjectId)?.topics.find(topic => topic.sampleId === item.id);
export const sampleConceptId = (item: SubjectSample) => { const topic = treeTopicOf(item); return topic ? treeConceptId(topic.key) : `sample-${item.id}`; };
const conceptVersion = (item: SubjectSample) => { const topic = treeTopicOf(item); return topic ? treeConceptVersion(topic)
  : `synthetic-sample-concept-${hash([item.id, item.definition, item.purpose, item.applicability, item.counterexample, item.misconception, item.examUse])}`; };

/** Deterministic option order so the correct answer is not always first. */
function options(item: SubjectSample) {
  const all = [{ text: item.answer, wrongIndex: -1 }, ...item.wrong.map((text, wrongIndex) => ({ text, wrongIndex }))];
  const shift = parseInt(hash(item.id).slice(0, 2), 16) % 4;
  return [...all.slice(shift), ...all.slice(0, shift)].map(option => ({ ...option, id: `o${hash([item.id, option.text]).slice(0, 6)}` }));
}

export function sampleMaterial(item: SubjectSample): CafeMaterial {
  const caseVersion = `synthetic-sample-${item.id}-${hash(item)}`;
  const scoringVersion = 'synthetic-sample-choice-v1';
  const choices = options(item);
  const basis = SUBJECT_SAMPLE_BASIS[item.subjectId];
  return {
    caseVersion, scoringVersion,
    concept: { subjectId: item.subjectId, conceptId: sampleConceptId(item), conceptVersion: conceptVersion(item) },
    prompt: () => ({ caseId: `sample-${item.id}`, caseVersion, conceptId: sampleConceptId(item), familyId: `sample-${item.id}`,
      developmentOnly: true, title: item.title, consultationTitle: item.title,
      context: `${label(item.subjectId)}の見本問題です（AI作成・専門家の確認前）。${basis}`,
      consultation: item.prompt, task: '最も適切な選択肢を選び、判断の根拠を説明しましょう。',
      facts: [{ label: '問題の前提', value: basis }], assumption: '見本として作成した原稿です。正式な診断・習熟認定には使いません。',
      options: choices.map(({ id, text }) => ({ id, label: text })) }),
    grade: (version, optionId) => {
      if (version !== caseVersion) throw new StudyError('CASE_VERSION_CONFLICT', 409);
      const selected = choices.find(option => option.id === optionId);
      if (!selected) throw new StudyError('INVALID_OPTION');
      const correct = selected.wrongIndex === -1;
      return { caseVersion, scoringVersion, optionId: selected.id, correct, earned: correct ? 1 : 0, max: 1,
        developmentOnly: true, evidenceQualification: 'practice_only' as const,
        misconceptionCandidate: correct ? null : item.wrongReasons[selected.wrongIndex],
        explanation: item.explanation, periods: [], teachBack: 'この判断が成り立つ条件を、自分の言葉で説明してください。',
        followUp: '条件を一つ変えたら、判断はどう変わりますか？', checkpoints: [item.explanation, '条件が変わる場合も確かめる'],
        learningNotes: { exceptions: [item.counterexample], examTranslation: item.examUse } };
    },
  };
}

export const SUBJECT_SAMPLE_MATERIALS = SUBJECT_SAMPLES.map(sampleMaterial);
const base = { status: 'draft' as const, sourceId: 'authored-sample', applicableYear: null };

function treePack(tree: SubjectTree): SubjectPack {
  const version = tree.version;
  const concepts: MapConcept[] = tree.topics.map(topic => ({ conceptId: treeConceptId(topic.key), conceptVersion: treeConceptVersion(topic), label: topic.label, ...topic.concept, ...base }));
  const byKey = new Map(tree.topics.map((topic, index) => [topic.key, concepts[index]]));
  const links: MapLink[] = tree.topics.map((topic, index) => ({ kind: 'explains-topic' as const, sourceId: concepts[index].conceptId, sourceVersion: concepts[index].conceptVersion,
    targetId: `topic-${topic.key}`, targetVersion: version, basis: '全体ツリーの論点と考え方の対応。専門審査待ち。', status: 'draft' as const }));
  for (const { from, to } of tree.prerequisites) {
    const source = byKey.get(from)!, target = byKey.get(to)!;
    links.push({ kind: 'prerequisite', sourceId: source.conceptId, sourceVersion: source.conceptVersion, targetId: target.conceptId, targetVersion: target.conceptVersion,
      basis: '先に知ると理解しやすいという原稿上の関係。順番の強制ではなく、専門審査待ち。', status: 'draft' });
  }
  for (const [index, item] of SUBJECT_SAMPLES.entries()) {
    const topic = item.subjectId === tree.subjectId ? treeTopicOf(item) : undefined;
    if (!topic) continue;
    const material = SUBJECT_SAMPLE_MATERIALS[index], concept = byKey.get(topic.key)!;
    links.push({ kind: 'uses-case', sourceId: concept.conceptId, sourceVersion: concept.conceptVersion, targetId: material.prompt().caseId, targetVersion: material.caseVersion,
      role: 'primary', basis: '見本問題の主概念。正式な評価・習熟ではない。', status: 'draft' });
  }
  const subjectMap = validateSubjectMap({ subjectId: tree.subjectId, version, status: 'draft',
    units: tree.units.map((unit, order) => ({ ...unit, order, ...base })),
    topics: tree.topics.map((topic, order) => ({ topicId: `topic-${topic.key}`, unitId: topic.unitId, label: topic.label, summary: topic.summary, order, frequency: topic.frequency, ...(topic.example ? { example: topic.example } : {}), ...base })),
    concepts, links, ...(tree.glossary ? { glossary: tree.glossary } : {}) });
  return { subjectId: tree.subjectId, version, active: true, subjectMap,
    concepts: concepts.map(concept => ({ subjectId: tree.subjectId, conceptId: concept.conceptId, conceptVersion: concept.conceptVersion, label: concept.label, importance: 3, durationMinutes: 5, unseenQuestionCount: 0 })) };
}

function samplePack(subjectId: Exclude<SubjectId, 'bookkeeping'>): SubjectPack | null {
  const tree = treeFor(subjectId);
  if (tree) return treePack(tree);
  const items = SUBJECT_SAMPLES.filter(item => item.subjectId === subjectId);
  if (!items.length) return null;
  const version = `synthetic-sample-${subjectId}-v1`;
  const concepts: MapConcept[] = items.map(item => ({ conceptId: sampleConceptId(item), conceptVersion: conceptVersion(item), label: item.title,
    definition: item.definition, purpose: item.purpose, applicability: item.applicability, counterexample: item.counterexample,
    misconception: item.misconception, materialCue: item.prompt, examUse: item.examUse, ...base }));
  const links: MapLink[] = items.flatMap((item, index) => {
    const material = SUBJECT_SAMPLE_MATERIALS[SUBJECT_SAMPLES.indexOf(item)];
    return [
      { kind: 'explains-topic' as const, sourceId: concepts[index].conceptId, sourceVersion: concepts[index].conceptVersion, targetId: `topic-${item.id}`, targetVersion: version, basis: '見本問題と論点の対応。専門審査待ち。', status: 'draft' as const },
      { kind: 'uses-case' as const, sourceId: concepts[index].conceptId, sourceVersion: concepts[index].conceptVersion, targetId: material.prompt().caseId, targetVersion: material.caseVersion, role: 'primary' as const, basis: '見本問題の主概念。正式な評価・習熟ではない。', status: 'draft' as const },
    ];
  });
  const subjectMap = validateSubjectMap({ subjectId, version, status: 'draft',
    units: [{ unitId: 'samples', label: '見本問題（AI作成・確認前）', order: 0, ...base }],
    topics: items.map((item, order) => ({ topicId: `topic-${item.id}`, unitId: 'samples', label: item.title, summary: item.definition, order, ...base })),
    concepts, links });
  return { subjectId, version, active: true, subjectMap,
    concepts: concepts.map(concept => ({ subjectId, conceptId: concept.conceptId, conceptVersion: concept.conceptVersion, label: concept.label, importance: 3, durationMinutes: 5, unseenQuestionCount: 0 })) };
}

export const SUBJECT_SAMPLE_CATALOG: readonly SubjectPack[] = SUBJECT_SAMPLE_SUBJECTS.map(subject => samplePack(subject.id as Exclude<SubjectId, 'bookkeeping'>)).filter(pack => pack !== null);
export const SUBJECT_SAMPLE_CHOICES = SUBJECT_SAMPLE_MATERIALS.map(material => {
  const prompt = material.prompt();
  return { subjectId: material.concept!.subjectId, conceptId: material.concept!.conceptId, conceptVersion: material.concept!.conceptVersion,
    materialId: prompt.caseId, caseVersion: material.caseVersion, label: prompt.consultationTitle };
});
