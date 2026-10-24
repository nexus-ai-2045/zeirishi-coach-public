import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOKKEEPING_ALL_QUESTION_DRAFTS as FULL_DRAFTS, BOOKKEEPING_PRACTICE_DRAFTS as FULL_PRACTICE,
  BOOKKEEPING_DIAGNOSTIC_DRAFTS as FULL_DIAGNOSTIC, BOOKKEEPING_EVALUATION_DRAFTS as FULL_EVALUATION, BOOKKEEPING_RETENTION_DRAFTS as FULL_RETENTION,
  BOOKKEEPING_MINI_EXAM_DRAFTS, bookkeepingDiagnosticDraftAdapter,
  publicBookkeepingQuestion, gradeBookkeepingDraft } from '../src/server/bookkeeping-question-drafts';
import { trialQuestionMaterial } from '../src/server/bookkeeping-trial-questions';
import { createDiagnosticEngine } from '../src/domain/diagnostic-session';
import { execFileSync } from 'node:child_process';
import { StudyError } from '../src/domain/types';

const concepts = ['cash-is-not-profit', 'double-entry', 'prepaid-expenses', 'inventory-cost', 'depreciation', 'provisions-estimates'];
const BOOKKEEPING_ALL_QUESTION_DRAFTS = FULL_DRAFTS.filter(item=>concepts.includes(item.question.conceptId));
const BOOKKEEPING_PRACTICE_DRAFTS = FULL_PRACTICE.filter(item=>concepts.includes(item.question.conceptId));
const BOOKKEEPING_DIAGNOSTIC_DRAFTS = FULL_DIAGNOSTIC.filter(item=>concepts.includes(item.question.conceptId));
const BOOKKEEPING_EVALUATION_DRAFTS = FULL_EVALUATION.filter(item=>concepts.includes(item.question.conceptId));
const BOOKKEEPING_RETENTION_DRAFTS = FULL_RETENTION.filter(item=>concepts.includes(item.question.conceptId));
const poolCounts = { practice: 60, diagnostic: 18, evaluation: 6, retention: 12, mini_a: 6, mini_b: 6 };
// Numeric variants within one operation count as one family.
const coverage = {
  'cash-is-not-profit': { practical: ['borrow', 'credit-sale'], mixed: 'cash-profit-bridge', scenes: ['個人商店', '卸売店'] },
  'double-entry': { practical: ['asset-liability', 'asset-exchange'], mixed: 'error-detection', scenes: ['個人商店', 'パン工房'] },
  'prepaid-expenses': { practical: ['annual-months', 'adjust-expense'], mixed: 'asset-first', scenes: ['カフェ', '整備工場'] },
  'inventory-cost': { practical: ['cost-of-sales', 'ownership-cutoff'], mixed: 'gross-profit', scenes: ['雑貨店', '卸売会社'] },
  'depreciation': { practical: ['straight-line', 'partial-year'], mixed: 'journal', scenes: ['製造工房', 'クリーニング店'] },
  'provisions-estimates': { practical: ['recognition', 'warranty-rate'], mixed: 'use-provision', scenes: ['修理店', '家電販売店'] },
};
function rejectAnswerKeys(value: unknown) {
  if (!value || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    assert.ok(!['answer', 'correct', 'earned', 'errorReason', 'explanation', 'misconceptionCandidate'].includes(key), `answer key leaked: ${key}`);
    rejectAnswerKeys(nested);
  }
}

test('6概念の練習60・診断18・追加評価6・保持12・前後ミニ各6を欠落や重複なく揃える', () => {
  assert.equal(BOOKKEEPING_ALL_QUESTION_DRAFTS.length, 108);
  assert.deepEqual([...new Set(BOOKKEEPING_ALL_QUESTION_DRAFTS.map(item => item.question.conceptId))].sort(), [...concepts].sort());
  assert.equal(new Set(BOOKKEEPING_ALL_QUESTION_DRAFTS.map(item => item.question.id)).size, 108);
  for (const [pool, count] of Object.entries(poolCounts)) {
    const items = BOOKKEEPING_ALL_QUESTION_DRAFTS.filter(item => item.intendedUse === pool);
    assert.equal(items.length, count, pool);
    for (const concept of concepts) assert.equal(items.filter(item => item.question.conceptId === concept).length, count / 6, `${pool}/${concept}`);
    assert.ok(items.every(item => item.question.poolId === `bk-${pool}`));
  }
  assert.equal(BOOKKEEPING_DIAGNOSTIC_DRAFTS.length, 18);
  assert.equal(BOOKKEEPING_EVALUATION_DRAFTS.length, 6);
  assert.equal(BOOKKEEPING_RETENTION_DRAFTS.length, 12);
});

test('練習は各概念3以上のfamily・異なる実務2family・混合形式を含み、数値違いを二重計上しない', () => {
  for (const [concept, itemCoverage] of Object.entries(coverage)) {
    const items = BOOKKEEPING_PRACTICE_DRAFTS.filter(item => item.question.conceptId === concept);
    const families = new Set(items.map(item => item.question.familyId));
    assert.ok(families.size >= 3, concept);
    for (const family of families) assert.equal(items.filter(item => item.question.familyId === family).length, 2, family);
    for (const [index, family] of itemCoverage.practical.entries()) {
      const familyItems = items.filter(item => item.question.familyId === `bk-practice-${concept}-${family}`);
      assert.ok(familyItems.some(item => item.question.prompt.includes(itemCoverage.scenes[index])), `${concept}/${family}`);
    }
    assert.equal(new Set(itemCoverage.practical).size, 2, concept);
    const mixed = items.filter(item => item.question.familyId === `bk-practice-${concept}-${itemCoverage.mixed}`);
    assert.ok(mixed.some(item => item.question.options.some(option => option.earned === 1 && option.label.includes('・'))), `${concept}/calculation-and-reason`);
  }
});

test('開始前・終了時・7日・21日は各概念で別問題と別familyで、練習・診断・追加評価から隔離する', () => {
  for (const concept of concepts) {
    const items = BOOKKEEPING_ALL_QUESTION_DRAFTS.filter(item => item.question.conceptId === concept);
    const before = items.filter(item => item.intendedUse === 'mini_a');
    const after = items.filter(item => item.intendedUse === 'mini_b');
    const seven = items.filter(item => item.intendedUse === 'retention' && item.question.familyId.endsWith('-retain-7-day'));
    const twentyOne = items.filter(item => item.intendedUse === 'retention' && item.question.familyId.endsWith('-retain-21-day'));
    for (const role of [before, after, seven, twentyOne]) assert.equal(role.length, 1, concept);
    assert.equal(before[0].question.purpose, 'before_evaluation');
    assert.equal(after[0].question.purpose, 'after_evaluation');
    const reserved = [...before, ...after, ...seven, ...twentyOne];
    assert.equal(new Set(reserved.map(item => item.question.familyId)).size, 4, concept);
    const otherFamilies = new Set(items.filter(item => ['practice', 'diagnostic', 'evaluation'].includes(item.intendedUse)).map(item => item.question.familyId));
    const skeleton = (prompt: string) => prompt.replace(/[0-9０-９]+/g, '#');
    for (const item of reserved) {
      assert.ok(!otherFamilies.has(item.question.familyId));
      assert.ok(items.every(other => other.question.id === item.question.id || skeleton(other.question.prompt) !== skeleton(item.question.prompt)), item.question.id);
    }
  }
});

test('12分ミニ2組は各6概念で重複せず、難度比較や総合模試の承認を捏造しない', () => {
  assert.equal(BOOKKEEPING_MINI_EXAM_DRAFTS.length, 2);
  const allIds: string[] = [];
  for (const exam of BOOKKEEPING_MINI_EXAM_DRAFTS) {
    assert.equal(exam.timeLimitMinutes, 12);
    assert.equal(exam.comparable, false);
    assert.equal(exam.comprehensive, false);
    assert.equal(exam.status, 'draft');
    assert.equal(exam.review, null);
    assert.equal(exam.qualification, 'practice_only');
    assert.equal(exam.questionIds.length, 6);
    const questions = exam.questionIds.map(id => BOOKKEEPING_ALL_QUESTION_DRAFTS.find(item => item.question.id === id)!);
    assert.ok(questions.every(Boolean));
    assert.deepEqual(questions.map(item => item.question.conceptId).sort(), [...concepts].sort());
    allIds.push(...exam.questionIds);
  }
  assert.equal(new Set(allIds).size, 12);
});

test('全原稿は専門審査前で一意の正答を持ち、採点後もpractice_onlyから昇格しない', () => {
  for (const item of BOOKKEEPING_ALL_QUESTION_DRAFTS) {
    const q = item.question;
    assert.equal(q.status, 'draft');
    assert.equal(q.review, null);
    assert.equal(item.qualification, 'practice_only');
    assert.equal(item.expertReview, 'pending');
    assert.equal(new Set(q.options.map(option => option.label)).size, 4, q.id);
    assert.equal(q.options.filter(option => option.earned === q.maxScore).length, 1, q.id);
    assert.ok(q.options.every(option => option.earned === 0 || option.earned === 1));
    assert.ok(item.explanation.trim());
    for (const option of q.options) {
      const result = gradeBookkeepingDraft(q.id, option.id);
      assert.equal(result.correct, option.earned === 1);
      assert.equal(result.evidenceQualification, 'practice_only');
      assert.equal(result.expertReview, 'pending');
      assert.equal(result.misconceptionCandidate === null, result.correct);
    }
  }
  assert.throws(() => gradeBookkeepingDraft('missing-question', 'o1'), error => error instanceof StudyError && error.code === 'INVALID_OPTION');
  assert.throws(() => gradeBookkeepingDraft(BOOKKEEPING_ALL_QUESTION_DRAFTS[0].question.id, 'missing-option'), error => error instanceof StudyError && error.code === 'INVALID_OPTION');
});

test('公開projectionとケースadapterの出題前データに正答・得点・誤答理由・解説を含めない', () => {
  for (const item of BOOKKEEPING_ALL_QUESTION_DRAFTS) {
    const projected = publicBookkeepingQuestion(item);
    rejectAnswerKeys(projected);
    assert.equal(projected.qualification, 'practice_only');
    for (const option of projected.options) assert.deepEqual(Object.keys(option).sort(), ['id', 'label']);
    const material = trialQuestionMaterial(item);
    rejectAnswerKeys(material.prompt());
    assert.equal(material.prompt().developmentOnly, true);
  }
  const item = BOOKKEEPING_ALL_QUESTION_DRAFTS[0];
  const projected = publicBookkeepingQuestion(item);
  projected.options[0].label = 'クライアント側変更';
  assert.notEqual(item.question.options[0].label, projected.options[0].label);
});

test('未審査の診断原稿を正式診断engineに渡しても出題されない', () => {
  const engine = createDiagnosticEngine(bookkeepingDiagnosticDraftAdapter());
  const at = '2026-10-05T00:00:00.000Z';
  const seed = { id: 'unreviewed-inventory', mode: 'short' as const, subjectId: 'bookkeeping' as const,
    conceptId: concepts[0], createdAt: at, seenFamilies: [] };
  const session = engine.transition(engine.start(seed), { type: 'present', requestId: 'first', at, seenFamilies: [] });
  const view = engine.view(session, at);
  assert.equal(view.status, 'unavailable');
  assert.equal(view.currentQuestion, null);
  assert.equal(view.attempts.length, 0);
});

test('複合計算・逆算・決算訂正の正答を独立した計算で照合する', () => {
  const audited = [
    ['bk-mini_b-cash-is-not-profit-7', `${10 - 4 - 2}万円`],
    ['bk-evaluation-cash-is-not-profit-4', `${12 + 2 - 7 - 1}万円`],
    ['bk-mini_a-prepaid-expenses-6', `${12 / 12 * 3 + 24 / 12 * 9}万円`],
    ['bk-mini_b-prepaid-expenses-7', `利益${10 + 36 / 12 * 9}万円・資産${50 + 36 / 12 * 9}万円`],
    ['bk-evaluation-prepaid-expenses-4', `年額${6 / 4 * 12}万円・前払${6 / 4 * 8}万円`],
    ['bk-mini_a-inventory-cost-6', `${25 - 4 + 7}万円`],
    ['bk-mini_b-inventory-cost-7', `${90 - 25 - 15 + 25}万円`],
    ['bk-mini_a-depreciation-6', `${72 / 6 * 9 / 12}万円`],
    ['bk-mini_b-depreciation-7', `売却益${50 - (90 - 36 - 6)}万円`],
    ['bk-evaluation-depreciation-4', `耐用年数${(100 - 10) / 18}年・帳簿価額${100 - 18}万円`],
    ['bk-mini_b-provisions-estimates-7', `${(3 + 4) / 350 * 100}%`],
    ['bk-retention-cash-is-not-profit-8', `利益${9 / 3 - 1}万円・前受金${9 - 9 / 3}万円`],
    ['bk-retention-double-entry-8', `いずれも${-8 + 8 / 2 + 10}万円`],
    ['bk-retention-prepaid-expenses-8', `当期費用${6 + 12 - 4}万円・期末前払4万円`],
    ['bk-retention-inventory-cost-8', `${12 + 50 - 5 - 17}万円`],
    ['bk-retention-depreciation-8', `${60 - 24 - 12 + 30 - 3}万円`],
    ['bk-retention-provisions-estimates-8', `${2 + 4 - (5 - 3)}万円`],
  ];
  for (const [id, answer] of audited) {
    const item = BOOKKEEPING_ALL_QUESTION_DRAFTS.find(item => item.question.id === id)!;
    assert.ok(item, id);
    const correct = item.question.options.filter(option => gradeBookkeepingDraft(id, option.id).correct);
    assert.deepEqual(correct.map(option => option.label), [answer], id);
  }
});

test('公開IDの連番だけで正答位置を逆算できない', () => {
  const bySuffix = new Map<string, Set<number>>();
  for (const item of BOOKKEEPING_ALL_QUESTION_DRAFTS) {
    const q = item.question;
    const suffix = q.id.split('-').at(-1)!;
    const key = `${item.intendedUse}:${suffix}`;
    const position = q.options.findIndex(option => option.earned === 1);
    const positions = bySuffix.get(key) ?? new Set<number>();
    positions.add(position); bySuffix.set(key, positions);
    const correctId = q.options[position].id;
    assert.equal(gradeBookkeepingDraft(q.id, correctId).correct, true);
  }
  for (const [key, positions] of bySuffix) assert.ok(positions.size > 1, `public suffix predicts the answer: ${key}`);
  assert.ok(BOOKKEEPING_ALL_QUESTION_DRAFTS.some(item => {
    const n = Number(item.question.id.split('-').at(-1));
    return item.question.options.findIndex(option => option.earned === 1) !== (n - 1) % 4;
  }), 'the old public-ID position rule must not return');
});


test('サーバー再起動相当の別processでも同じ版の正答IDは変わらない', () => {
  const code = `import { BOOKKEEPING_ALL_QUESTION_DRAFTS } from './src/server/bookkeeping-question-drafts.ts';
    process.stdout.write(JSON.stringify(BOOKKEEPING_ALL_QUESTION_DRAFTS.map(item => [item.question.id,
      item.question.options.find(option => option.earned === 1).id])));`;
  const read = () => execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 10000,
  });
  assert.equal(read(), read());
});
