import { StudyError } from '../domain/types';
import type { ConceptRef } from '../domain/onboarding';

/** Synthetic content, not an approved pack. Never import this module into client components. */
export const CAFE_CASE_VERSION = 'synthetic-cafe-prepaid-v2';
export const CAFE_SCORING_VERSION = 'synthetic-cafe-choice-v1';
const choices = [
  { id: 'c7m2', label: '120,000円', misconception: '支払った金額と当期の費用を同じものと考えた可能性があります。' },
  { id: 'h4r9', label: '40,000円', misconception: null },
  { id: 'p8n3', label: '80,000円', misconception: '当期4か月と翌期8か月を逆に数えた可能性があります。' },
  { id: 's2w6', label: '0円', misconception: '翌期分があるため、当期分も含めて除外した可能性があります。' },
] as const;
export type CafeOptionId = typeof choices[number]['id'];

export function cafePrompt() {
  return {
    caseId: 'cafe-prepaid', caseVersion: CAFE_CASE_VERSION,
    conceptId: 'prepaid-expenses', familyId: 'synthetic-cafe-annual-insurance',
    developmentOnly: true, title: '前払費用', consultationTitle: 'カフェの年間保険料をどう処理する？',
    context: 'カフェを経営する佐藤さんは、3月末の決算に向けて経費の記録を整理しています。',
    consultation: '12月に、お店の火災保険を1年分まとめて12万円払いました。帳簿には全部「保険料」で入れてあります。このまま今年の費用にしていいですか？ 来年の分も入っている気がして、どこを直せばいいか分からなくて……',
    task: '当期の保険料はいくらになるか、資料をもとに判断してください。',
    facts: [
      { label: '契約期間', value: '12月1日〜翌年11月30日' },
      { label: '支払額', value: '120,000円' },
      { label: '決算日', value: '3月31日' },
    ],
    assumption: '月割りで配分する会計の練習です。税務上の特例は扱いません。開発用教材・専門審査前。',
    // Public projection deliberately omits correctness, weights and explanations.
    options: choices.map(({ id, label }) => ({ id, label })),
  };
}

/** Caller must load the version from the owned instance, not trust a client-supplied version. */
export function gradeCafeChoice(caseVersion: string, optionId: unknown) {
  if (caseVersion !== CAFE_CASE_VERSION) throw new StudyError('CASE_VERSION_CONFLICT', 409);
  const selected = choices.find(option => option.id === optionId);
  if (!selected) throw new StudyError('INVALID_OPTION');
  return {
    caseVersion, scoringVersion: CAFE_SCORING_VERSION, optionId: selected.id,
    correct: selected.id === 'h4r9', earned: selected.id === 'h4r9' ? 1 : 0, max: 1,
    developmentOnly: true, evidenceQualification: 'practice_only' as const,
    misconceptionCandidate: selected.misconception,
    explanation: '支払った時期と、サービスを受ける期間は別です。月あたり120,000÷12＝10,000円。当期の12〜3月は4か月で40,000円、残り80,000円は翌期以降のサービスに対応する前払費用です。',
    periods: Array.from({ length: 12 }, (_, index) => ({
      month: ((index + 11) % 12) + 1,
      allocation: index < 4 ? '当期の費用' : '翌期以降の前払費用',
      amount: 10000,
    })),
    teachBack: '佐藤さんに、なぜ12万円すべてが今年の費用ではないのか説明してみましょう。',
    followUp: 'まだ使っていない8か月分は、払ってしまったのに帳簿に残るんですか？',
    checkpoints: ['支払日と費用になる期間は別', '当期4か月・翌期8か月', '翌期分は前払費用'],
  };
}

/** Public shape excludes answer keys; material approval remains a separate supply boundary. */
export type CafePrompt = Omit<ReturnType<typeof cafePrompt>, 'caseVersion' | 'options'> & {
  caseVersion: string; options: Array<{ id: string; label: string }>;
};
export type CafeResult = Omit<ReturnType<typeof gradeCafeChoice>, 'scoringVersion' | 'optionId' | 'misconceptionCandidate'> & {
  scoringVersion: string; optionId: string; misconceptionCandidate: string | null;
  learningNotes?: { exceptions: string[]; examTranslation: string };
};
export type CafeMaterial = {
  caseVersion: string; scoringVersion: string;
  /** Stable learning-concept identity, independent of this case's version. */
  concept?: ConceptRef;
  prompt: () => CafePrompt;
  grade: (caseVersion: string, optionId: string) => CafeResult;
};
export const DEVELOPMENT_CAFE_MATERIAL: CafeMaterial = {
  caseVersion: CAFE_CASE_VERSION, scoringVersion: CAFE_SCORING_VERSION,
  prompt: cafePrompt, grade: gradeCafeChoice,
};
