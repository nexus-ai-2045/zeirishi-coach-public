import { topicConcepts, type MapConcept, type SubjectMapPack } from './subject-map';

export type CaseChoice = { subjectId: string; conceptId: string; conceptVersion: string; materialId: string; caseVersion: string; label: string };

export function availableCasesForConcept(pack: SubjectMapPack | null | undefined, choices: readonly CaseChoice[], conceptId: string): CaseChoice[] {
  const concept = pack?.concepts.find(item => item.conceptId === conceptId);
  if (!pack || !concept) return [];
  return choices.filter(choice => choice.subjectId === pack.subjectId && choice.conceptId === concept.conceptId && choice.conceptVersion === concept.conceptVersion
    && pack.links.some(link => link.kind === 'uses-case' && link.role === 'primary' && link.sourceId === concept.conceptId && link.sourceVersion === concept.conceptVersion
      && link.targetId === choice.materialId && link.targetVersion === choice.caseVersion));
}

export type TopicConcepts = { unconnected: boolean; introConceptId: string | null; otherConcepts: MapConcept[] };

export function resolveTopicConcepts(pack: SubjectMapPack, topicId: string, introConceptIds: readonly string[]): TopicConcepts {
  const concepts = topicConcepts(pack, topicId);
  return {
    unconnected: concepts.length === 0,
    introConceptId: concepts.find(item => introConceptIds.includes(item.conceptId))?.conceptId ?? null,
    otherConcepts: concepts.filter(item => !introConceptIds.includes(item.conceptId)),
  };
}

export function startableCaseCount(pack: SubjectMapPack | null | undefined, choices: readonly CaseChoice[] | undefined, subjectId: string): number {
  const cases = (choices ?? []).filter(choice => choice.subjectId === subjectId && availableCasesForConcept(pack, [choice], choice.conceptId).length === 1);
  return new Set(cases.map(choice => `${choice.materialId}/${choice.caseVersion}`)).size;
}

export function caseCountNotice(subjectLabel: string, count: number): string {
  return count > 0 ? `現在、相談できる${subjectLabel}のケースは${count}件です。` : `現在、相談できる${subjectLabel}のケースはありません。`;
}
