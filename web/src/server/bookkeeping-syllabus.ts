import { createHash } from 'node:crypto';
import type { MapConcept } from '../domain/subject-map';
import type { SyllabusLesson } from './bookkeeping-syllabus-types';
import first from './bookkeeping-syllabus-a.json' with { type: 'json' };
import second from './bookkeeping-syllabus-b.json' with { type: 'json' };
import extra from './bookkeeping-syllabus-extra.json' with { type: 'json' };

export const BOOKKEEPING_SYLLABUS_LESSONS = [...first, ...second, ...extra] as unknown as readonly SyllabusLesson[];
export const BOOKKEEPING_SYLLABUS_UNITS = [
  ['sales','商品売買'], ['cash','現金預金・債権'], ['fixed','有形固定資産'], ['intangible','無形固定資産・研究開発'],
  ['securities','金融商品'], ['liab','負債・引当金'], ['equity','純資産'], ['other','税効果・外貨・連結'], ['ledger','本支店・製造業・帳簿組織'],
] as const;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,12);
export const syllabusConceptId = (lesson: SyllabusLesson) => `syllabus-${lesson.id}`;
export function syllabusConceptVersionFor(lesson: SyllabusLesson) {
  return `synthetic-syllabus-concept-${hash([lesson.id,lesson.definition,lesson.purpose,lesson.applicability,lesson.counterexample,lesson.misconception,lesson.materialCue,lesson.examUse])}`;
}
export function syllabusConceptVersion(id: string) {
  const lesson = BOOKKEEPING_SYLLABUS_LESSONS.find(item => syllabusConceptId(item) === id);
  if (!lesson) throw new Error('UNKNOWN_SYLLABUS_CONCEPT');
  return syllabusConceptVersionFor(lesson);
}
export const BOOKKEEPING_SYLLABUS_CONCEPTS: readonly MapConcept[] = BOOKKEEPING_SYLLABUS_LESSONS.map(lesson => ({
  conceptId: syllabusConceptId(lesson), conceptVersion: syllabusConceptVersion(syllabusConceptId(lesson)), label: lesson.title,
  definition: lesson.definition, purpose: lesson.purpose, applicability: lesson.applicability, counterexample: lesson.counterexample,
  misconception: lesson.misconception, materialCue: lesson.materialCue, examUse: lesson.examUse,
  status: 'draft', sourceId: 'authored-syllabus', applicableYear: null,
}));
