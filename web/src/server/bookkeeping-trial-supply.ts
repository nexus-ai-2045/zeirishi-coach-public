import { DEVELOPMENT_CAFE_MATERIAL, type CafeMaterial } from './cafe-case';
import { BOOKKEEPING_CASE_DRAFTS, BOOKKEEPING_CORE_CONCEPTS } from './bookkeeping-case-drafts';
import { BOOKKEEPING_TRIAL_QUESTION_MATERIALS } from './bookkeeping-trial-questions';
import { BOOKKEEPING_ALL_QUESTION_DRAFTS } from './bookkeeping-question-drafts';
import { BOOKKEEPING_SYLLABUS_LESSONS, BOOKKEEPING_SYLLABUS_CONCEPTS, BOOKKEEPING_SYLLABUS_UNITS } from './bookkeeping-syllabus';
import { BOOKKEEPING_SYLLABUS_CASES } from './bookkeeping-syllabus-materials';
import { validateSubjectMap, type MapLink } from '../domain/subject-map';
import type { ConceptRef, SubjectPack } from '../domain/onboarding';
import type { PlanCandidate } from '../domain/weekly-plan';
import { StudyError } from '../domain/types';
export const BOOKKEEPING_ALL_CONCEPTS = [...BOOKKEEPING_CORE_CONCEPTS, ...BOOKKEEPING_SYLLABUS_CONCEPTS];
export const BOOKKEEPING_TRIAL_CASES = [DEVELOPMENT_CAFE_MATERIAL, ...BOOKKEEPING_CASE_DRAFTS, ...BOOKKEEPING_SYLLABUS_CASES];
export const BOOKKEEPING_TRIAL_MATERIALS = [...BOOKKEEPING_TRIAL_CASES, ...BOOKKEEPING_TRIAL_QUESTION_MATERIALS];
export const BOOKKEEPING_TRIAL_VERSION = 'synthetic-bookkeeping-pack-v2';
const base = { status: 'draft' as const, sourceId: 'authored-local', applicableYear: null };
const units = [['foundations','記録・利益・期間配分の基礎'], ...BOOKKEEPING_SYLLABUS_UNITS];
const locations: Record<string, string> = { 'cash-is-not-profit':'foundations','double-entry':'foundations','prepaid-expenses':'foundations','inventory-cost':'sales',depreciation:'fixed','provisions-estimates':'liab' };
const topics = [...BOOKKEEPING_CORE_CONCEPTS.map((concept, order) => ({ topicId: `topic-${concept.conceptId}`, unitId: locations[concept.conceptId], label: concept.label, summary: concept.definition, order, ...base })),
  ...BOOKKEEPING_SYLLABUS_LESSONS.map((lesson,order)=>({topicId:`topic-syllabus-${lesson.id}`,unitId:lesson.unitId,label:lesson.title,summary:lesson.definition,order:order+6,...base}))];
const links: MapLink[] = BOOKKEEPING_ALL_CONCEPTS.map(concept => ({ kind: 'explains-topic', sourceId: concept.conceptId, sourceVersion: concept.conceptVersion, targetId: `topic-${concept.conceptId}`, targetVersion: BOOKKEEPING_TRIAL_VERSION, basis:'原稿の編集上の対応。専門審査待ち。', status:'draft' }));
for (const [sourceId,targetId] of [['cash-is-not-profit','double-entry'],['cash-is-not-profit','prepaid-expenses'],['double-entry','inventory-cost'],['prepaid-expenses','depreciation'],['prepaid-expenses','provisions-estimates']]) {
  const source=BOOKKEEPING_CORE_CONCEPTS.find(item=>item.conceptId===sourceId)!;
  const target=BOOKKEEPING_CORE_CONCEPTS.find(item=>item.conceptId===targetId)!;
  links.push({kind:'prerequisite',sourceId,sourceVersion:source.conceptVersion,targetId,targetVersion:target.conceptVersion,basis:'先の考え方を知ると理解しやすいという原稿上の関係。履修の強制や習熟認定ではなく、専門審査待ち。',status:'draft'});
}
for (const lesson of BOOKKEEPING_SYLLABUS_LESSONS) {
  const target=BOOKKEEPING_ALL_CONCEPTS.find(item=>item.conceptId===`syllabus-${lesson.id}`)!;
  for (const id of lesson.prerequisiteConceptIds) {
    const source=BOOKKEEPING_CORE_CONCEPTS.find(item=>item.conceptId===id);
    if (!source) throw new Error('INVALID_SYLLABUS_PREREQUISITE');
    links.push({kind:'prerequisite',sourceId:id,sourceVersion:source.conceptVersion,targetId:target.conceptId,targetVersion:target.conceptVersion,
      basis:'教材原稿に明示した基礎との対応。旧treeの頻度・重要度・習熟を変換せず、専門審査待ち。',status:'draft'});
  }
}
for (const material of BOOKKEEPING_TRIAL_CASES) {
  const prompt = material.prompt(); const concept = BOOKKEEPING_ALL_CONCEPTS.find(item => item.conceptId === prompt.conceptId)!;
  links.push({ kind:'uses-case', sourceId:concept.conceptId, sourceVersion:concept.conceptVersion, targetId:prompt.caseId, targetVersion:material.caseVersion, role:'primary', basis:'原稿試用案件の主概念。専門審査待ち。', status:'draft' });
}
for (const item of BOOKKEEPING_ALL_QUESTION_DRAFTS.filter(item=>['practice','retention'].includes(item.intendedUse))) {
  const material=BOOKKEEPING_TRIAL_QUESTION_MATERIALS.find(material=>material.prompt().caseId===item.question.id)!;
  links.push({kind:'uses-case',sourceId:item.question.conceptId,sourceVersion:item.question.conceptVersion,targetId:item.question.id,targetVersion:material.caseVersion,role:'primary',basis:'原稿の練習問題と概念の対応。正式な評価・習熟ではない。',status:'draft'});
}
export const BOOKKEEPING_TRIAL_MAP = validateSubjectMap({ subjectId:'bookkeeping', version:BOOKKEEPING_TRIAL_VERSION, status:'draft', units:units.map(([unitId,label], order) => ({ unitId,label,order,...base })), topics, concepts:BOOKKEEPING_ALL_CONCEPTS, links });
export const BOOKKEEPING_TRIAL_CATALOG: readonly SubjectPack[] = [{ subjectId:'bookkeeping',version:BOOKKEEPING_TRIAL_VERSION,active:true,subjectMap:BOOKKEEPING_TRIAL_MAP,
  concepts:BOOKKEEPING_ALL_CONCEPTS.map(item => ({subjectId:'bookkeeping',conceptId:item.conceptId,conceptVersion:item.conceptVersion,label:item.label,importance:3,durationMinutes:5,unseenQuestionCount:0})) }];
export const BOOKKEEPING_TRIAL_CHOICES = BOOKKEEPING_TRIAL_CASES.map(material => {
  const prompt = material.prompt(); const concept = BOOKKEEPING_ALL_CONCEPTS.find(item => item.conceptId === prompt.conceptId)!;
  return { subjectId:'bookkeeping' as const,conceptId:concept.conceptId,conceptVersion:concept.conceptVersion, materialId:prompt.caseId,caseVersion:material.caseVersion,label:prompt.consultationTitle };
});
export const BOOKKEEPING_TRIAL_PLAN: readonly PlanCandidate[] = BOOKKEEPING_TRIAL_CHOICES.map(choice => ({...choice,id:choice.materialId,familyId:BOOKKEEPING_TRIAL_CASES.find(item => item.caseVersion === choice.caseVersion)!.prompt().familyId,minutes:5,bucket:'new',qualification:'practice',unseen:false,differentFormat:false,sourceTrust:1,
  priority:{importance:3,observedExamScoreRatio:null,reviewStatus:'unknown',recentMisconceptions:[],lockedDirectSuccessors:0,observedMinutes:null,designedMinutes:5}}));
export function getBookkeepingTrialMaterial(input: { concept?: ConceptRef; materialId?: string; caseVersion?: string } = {}): CafeMaterial {
  if (!input.concept && !input.materialId && !input.caseVersion) return DEVELOPMENT_CAFE_MATERIAL;
  const matches = BOOKKEEPING_TRIAL_MATERIALS.filter(material => {
    const prompt = material.prompt(); const ref = material.concept ?? {subjectId:'bookkeeping',conceptId:prompt.conceptId,conceptVersion:material.caseVersion};
    return (!input.concept || (ref.subjectId===input.concept.subjectId && ref.conceptId===input.concept.conceptId && ref.conceptVersion===input.concept.conceptVersion)) && (!input.materialId || prompt.caseId===input.materialId) && (!input.caseVersion || material.caseVersion===input.caseVersion);
  });
  if (matches.length !== 1) throw new StudyError(matches.length ? 'MATERIAL_SELECTION_REQUIRED' : 'MATERIAL_NOT_AVAILABLE', matches.length ? 400 : 503);
  return matches[0];
}
export const bookkeepingTrialEnabled = () => process.env.ZEIRISHI_FIXTURE_MODE === '1' && process.env.ZEIRISHI_BOOKKEEPING_MVP === '1' && process.env.ZEIRISHI_SUPABASE_ENABLED !== '1';
/** Starting ordinary practice must not reveal or consume independent assessment pools. */
export function getBookkeepingTrialPracticeMaterial(input: Parameters<typeof getBookkeepingTrialMaterial>[0] = {}) {
  const material = getBookkeepingTrialMaterial(input);
  const question = BOOKKEEPING_ALL_QUESTION_DRAFTS.find(item => item.question.id === material.prompt().caseId);
  if (question && !['practice', 'retention'].includes(question.intendedUse)) throw new StudyError('MATERIAL_NOT_AVAILABLE', 503);
  return material;
}
