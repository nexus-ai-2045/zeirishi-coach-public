import type { SubjectPack } from '../domain/onboarding';
import { DEVELOPMENT_BOOKKEEPING_MAP } from './development-subject-map';

/** Only injected behind the loopback + fixture flag gate. Not a publication-approved catalog. */
export const DEVELOPMENT_CATALOG: readonly SubjectPack[] = [{
  subjectId: 'bookkeeping', version: 'synthetic-cafe-prepaid-v2', active: true,
  subjectMap: DEVELOPMENT_BOOKKEEPING_MAP,
  concepts: [{ subjectId: 'bookkeeping', conceptId: 'prepaid-expenses', conceptVersion: 'synthetic-cafe-prepaid-v2',
    label: '前払費用（開発用教材）', importance: 3, durationMinutes: 5, unseenQuestionCount: 0 }],
}];
