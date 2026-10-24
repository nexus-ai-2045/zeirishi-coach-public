import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cafePrompt, gradeCafeChoice, CAFE_CASE_VERSION } from '../src/server/cafe-case';

test('相談の公開データは人物・困り事・必要資料と四択だけで正解を開示しない', () => {
  const prompt = cafePrompt();
  assert.equal(prompt.options.length, 4);
  assert.equal(new Set(prompt.options.map(x => x.id)).size, 4);
  assert.equal(prompt.title, '前払費用');
  assert.match(prompt.consultation, /帳簿/);
  assert.match(prompt.consultation, /分からなくて/);
  assert.equal(prompt.facts.length, 3);
  for (const option of prompt.options) {
    assert.deepEqual(Object.keys(option).sort(), ['id', 'label']);
    assert.doesNotMatch(option.id, /used|future|paid|correct/);
  }
  assert.equal('explanation' in prompt, false);
  prompt.facts[0].value = 'changed';
  assert.notEqual(cafePrompt().facts[0].value, 'changed');
});

test('すべての四択にフィードバックがあり、正解は一つ、正式証拠へ昇格しない', () => {
  const results = cafePrompt().options.map(x => gradeCafeChoice(CAFE_CASE_VERSION, x.id));
  assert.equal(results.filter(x => x.correct).length, 1);
  for (const result of results) {
    assert.equal(result.evidenceQualification, 'practice_only');
    assert.equal(result.developmentOnly, true);
    assert.ok(result.explanation.length > 0);
    assert.ok(result.correct || result.misconceptionCandidate);
  }
});

test('期間図の12月〜3月が4か月、総額と当期翌期の配分が一致', () => {
  const result = gradeCafeChoice(CAFE_CASE_VERSION, 'h4r9');
  const current = result.periods.filter(x => x.allocation === '当期の費用');
  assert.deepEqual(current.map(x => x.month), [12, 1, 2, 3]);
  assert.equal(current.reduce((sum, x) => sum + x.amount, 0), 40000);
  assert.equal(result.periods.slice(4).reduce((sum, x) => sum + x.amount, 0), 80000);
  assert.equal(result.periods.reduce((sum, x) => sum + x.amount, 0), 120000);
});

test('旧3か月fixture・位置・金額・不正IDを新問題の答案として受理しない', () => {
  assert.throws(() => gradeCafeChoice('synthetic-v1', 'h4r9'), /CASE_VERSION_CONFLICT/);
  for (const input of [1, '40000', '', null, {}, 'constructor']) {
    assert.throws(() => gradeCafeChoice(CAFE_CASE_VERSION, input), /INVALID_OPTION/);
  }
});
