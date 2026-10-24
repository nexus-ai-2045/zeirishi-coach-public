import type { Answer, SessionView } from '../domain/types';

/** Synthetic development fixture only; never an approved subject pack. Keep server-side. */
export function gradeFixture(answer: Answer, at: Date): NonNullable<SessionView['result']> {
  const dueAt = new Date(at.getTime() + 86_400_000).toISOString();
  const definitions = [
    { key: 'insurance' as const, conceptId: 'fixture-period-expense', label: '前払保険料の期間配分', expected: 30000 },
    { key: 'equipment' as const, conceptId: 'fixture-depreciation', label: '備品の減価償却', expected: 60000 },
  ];
  const items = definitions.map(item => {
    const correct = Number(answer[item.key].replace(/[\s,]/g, '')) === item.expected;
    return { conceptId: item.conceptId, label: item.label, earned: correct ? 5 : 0, max: 5,
      feedback: correct ? 'この概念の計算を確認できました。翌日にもう一度確認します。' : `計算を再確認しましょう。この開発用問題の金額は${item.expected.toLocaleString('ja-JP')}円です。翌日に復習します。`, dueAt };
  });
  return { earned: items.reduce((sum, item) => sum + item.earned, 0), max: 10, items };
}
