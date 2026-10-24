import { createHash } from 'node:crypto';
import { StudyError } from '../domain/types';
import type { CafeMaterial } from './cafe-case';
import { BOOKKEEPING_SYLLABUS_LESSONS, syllabusConceptId, syllabusConceptVersionFor } from './bookkeeping-syllabus';

import type { SyllabusLesson } from './bookkeeping-syllabus-types';

export function syllabusCaseMaterial(lesson: SyllabusLesson): CafeMaterial {
  const content = lesson.case;
  const caseId = `syllabus-case-${lesson.id}`;
  const conceptVersion = syllabusConceptVersionFor(lesson);
  const digest = createHash('sha256').update(JSON.stringify([content,conceptVersion,lesson.title,lesson.misconception])).digest('hex');
  const caseVersion = `synthetic-${caseId}-${digest.slice(0,12)}`;
  const scoringVersion = 'synthetic-syllabus-case-choice-v1';
  const conceptId = syllabusConceptId(lesson);
  const answers = [...content.wrong]; const correctIndex = Number.parseInt(digest.slice(12,14),16)%4;
  answers.splice(correctIndex,0,content.answer);
  const options = answers.map((label,index) => ({id:`o${index+1}`,label}));
  if (options.length !== 4 || new Set(answers).size !== 4) throw new Error('INVALID_SYLLABUS_CASE');
  return {
    caseVersion, scoringVersion, concept: {subjectId:'bookkeeping',conceptId,conceptVersion},
    prompt: () => ({caseId,caseVersion,conceptId,familyId:`syllabus-case-${lesson.id}`,developmentOnly:true,
      title:lesson.title,consultationTitle:content.title,context:content.context,consultation:content.consultation,task:content.task,
      facts:content.facts.map(fact=>({...fact})), assumption:`${content.assumption} 架空の原稿試用・専門審査前。税務申告や正式な習熟判定には使いません。`,options:options.map(option=>({...option}))}),
    grade: (version,optionId) => {
      if (version!==caseVersion) throw new StudyError('CASE_VERSION_CONFLICT',409);
      const selected=options.find(option=>option.id===optionId); if (!selected) throw new StudyError('INVALID_OPTION');
      const correct=options[correctIndex].id===optionId;
      return {caseVersion,scoringVersion,optionId,correct,earned:correct?1:0,max:1,developmentOnly:true,evidenceQualification:'practice_only',
        misconceptionCandidate:correct?null:lesson.misconception,explanation:content.explanation,periods:[],teachBack:content.teachBack,
        followUp:content.followUp,checkpoints:[...content.checkpoints],learningNotes:{exceptions:[...content.exceptions],examTranslation:content.examTranslation}};
    },
  };
}
export const BOOKKEEPING_SYLLABUS_CASES: readonly CafeMaterial[] = BOOKKEEPING_SYLLABUS_LESSONS.map(syllabusCaseMaterial);
