import { createHash } from 'node:crypto';
import type { CafeMaterial } from './cafe-case';
import { StudyError } from '../domain/types';
import { BOOKKEEPING_ALL_QUESTION_DRAFTS, gradeBookkeepingDraft, type BookkeepingDraftQuestion } from './bookkeeping-question-drafts';

/** Server-only adapter: unreviewed drafts stay practice_only even in independent pools. */
export function trialQuestionMaterial(item: BookkeepingDraftQuestion): CafeMaterial {
  const q = item.question;
  const caseVersion = `synthetic-question-${q.id}-${createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0,12)}`;
  const scoringVersion = 'synthetic-bookkeeping-question-choice-v1';
  return {
    caseVersion, scoringVersion,
    concept: { subjectId: q.subjectId, conceptId: q.conceptId, conceptVersion: q.conceptVersion },
    prompt: () => ({ caseId: q.id, caseVersion, conceptId: q.conceptId, familyId: q.familyId,
      developmentOnly: true, title: '簿記の短い演習', consultationTitle: q.prompt.split('（')[0],
      context: '簿記論の原稿を試す短い演習です。専門審査前のため正式な診断・習熟認定には使いません。',
      consultation: q.prompt, task: '条件に合う回答を選び、判断の根拠を説明しましょう。',
      facts: [{ label: '演習の条件', value: q.prompt }], assumption: '架空の条件による原稿試用。評価用の原稿も正式な測定証拠には数えません。',
      options: q.options.map(({ id, label }) => ({ id, label })) }),
    grade: (version, optionId) => {
      if (version !== caseVersion) throw new StudyError('CASE_VERSION_CONFLICT', 409);
      const result = gradeBookkeepingDraft(q.id, optionId);
      return { caseVersion, scoringVersion, optionId, correct: result.correct, earned: result.earned, max: result.max,
        developmentOnly: true, evidenceQualification: 'practice_only', misconceptionCandidate: result.misconceptionCandidate,
        explanation: result.explanation, periods: [], teachBack: 'この判断が成り立つ条件を、自分の言葉で説明してください。',
        followUp: '条件を一つ変えたら、判断はどう変わりますか？', checkpoints: [result.explanation, '条件が変わる場合も確かめる'] };
    },
  };
}
export const BOOKKEEPING_TRIAL_QUESTION_MATERIALS = BOOKKEEPING_ALL_QUESTION_DRAFTS.map(trialQuestionMaterial);
