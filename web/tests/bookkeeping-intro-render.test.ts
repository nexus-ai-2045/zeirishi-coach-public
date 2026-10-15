import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BOOKKEEPING_TRIAL_CHOICES, BOOKKEEPING_TRIAL_MAP } from '../src/server/bookkeeping-trial-supply';
import { DEVELOPMENT_BOOKKEEPING_MAP } from '../src/server/development-subject-map';
import { DEVELOPMENT_CAFE_MATERIAL } from '../src/server/cafe-case';

register(new URL('./helpers/ui-module-stubs.mjs', import.meta.url));
const { BookkeepingIntro } = await import('../src/components/BookkeepingIntro');

const INTRO = ['cash-is-not-profit', 'double-entry', 'prepaid-expenses'];
const cafe = DEVELOPMENT_CAFE_MATERIAL.prompt();
const developmentChoices = [{ subjectId: 'bookkeeping', conceptId: cafe.conceptId, conceptVersion: DEVELOPMENT_CAFE_MATERIAL.caseVersion,
  materialId: cafe.caseId, caseVersion: DEVELOPMENT_CAFE_MATERIAL.caseVersion, label: cafe.consultationTitle }];
const onStart = () => {};
const render = (props: object) => renderToStaticMarkup(createElement(BookkeepingIntro, props));
const trial = (extra: object = {}) => ({ subjectMap: BOOKKEEPING_TRIAL_MAP, availableCases: BOOKKEEPING_TRIAL_CHOICES, onStart, ...extra });
const development = (extra: object = {}) => ({ subjectMap: DEVELOPMENT_BOOKKEEPING_MAP, availableCases: developmentChoices, onStart, ...extra });
const count = (html: string, needle: string) => html.split(needle).length - 1;

test('trial pack: the introduction offers the cafe consultation although the map version differs from the concept version', () => {
  const html = render(trial());
  assert.ok(html.includes('aria-label="次の相談ケース"'));
  assert.equal(count(html, '>この考え方を相談で試す →<'), 1);
  assert.ok(html.includes('この考え方を使う試用ケース'));
});

test('trial pack: a topic outside the three introduction concepts shows its own concept and consultation, never another concept or a false "preparing"', () => {
  const outside = BOOKKEEPING_TRIAL_MAP.topics.filter(topic => !INTRO.includes(topic.topicId.replace(/^topic-/, '')));
  assert.equal(outside.length, 33);
  for (const topic of outside) {
    const conceptId = topic.topicId.replace(/^topic-/, '');
    const concept = BOOKKEEPING_TRIAL_MAP.concepts.find(item => item.conceptId === conceptId)!;
    const choice = BOOKKEEPING_TRIAL_CHOICES.find(item => item.conceptId === conceptId)!;
    const html = render(trial({ initialTopicId: topic.topicId }));
    assert.ok(html.includes('aria-label="論点につながる考え方の説明"'), topic.topicId);
    assert.ok(html.includes(`<h3>${concept.label}</h3>`), topic.topicId);
    assert.ok(html.includes(`「${choice.label}」を相談で試す →`), topic.topicId);
    assert.ok(html.includes(`${concept.label}（相談教材あり）`), topic.topicId);
    assert.ok(!html.includes('aria-label="選んだ概念の説明"'), topic.topicId);
    assert.ok(!html.includes('下の説明は「'), topic.topicId);
    assert.ok(!html.includes('aria-label="次の相談ケース"'), topic.topicId);
    assert.ok(!html.includes('（教材準備中）'), topic.topicId);
    assert.ok(!html.includes('相談教材は準備中'), topic.topicId);
  }
});

test('trial pack: an introduction concept topic keeps the introduction explanation, and double-entry (no consultation) offers none', () => {
  const doubleEntry = render(trial({ initialTopicId: 'topic-double-entry' }));
  assert.ok(doubleEntry.includes('下の説明は「取引には二つの面がある」の考え方です。'));
  assert.ok(doubleEntry.includes('aria-label="選んだ概念の説明"'));
  assert.ok(!doubleEntry.includes('aria-label="論点につながる考え方の説明"'));
  assert.equal(count(doubleEntry, '相談で試す →'), 0);
  const prepaid = render(trial({ initialTopicId: 'topic-prepaid-expenses' }));
  assert.ok(prepaid.includes('下の説明は「支払日と費用の期間は別」の考え方です。'));
  assert.equal(count(prepaid, '>この考え方を相談で試す →<'), 1);
});

test('trial pack: a consultation the supply no longer matches is not offered and is honestly reported as preparing', () => {
  const stale = BOOKKEEPING_TRIAL_CHOICES.map(choice => ({ ...choice, caseVersion: 'stale-case-version' }));
  const html = render(trial({ availableCases: stale, initialTopicId: 'topic-inventory-cost' }));
  assert.equal(count(html, '相談で試す →'), 0);
  assert.ok(html.includes('相談教材は準備中です。'));
  assert.ok(html.includes('（教材準備中）'));
  assert.ok(!render(trial({ availableCases: stale })).includes('>この考え方を相談で試す →<'));
});

test('without a start handler the consultation is reported but no start control is created', () => {
  const html = render(trial({ onStart: undefined, initialTopicId: 'topic-inventory-cost' }));
  assert.equal(count(html, '相談で試す →'), 0);
  assert.ok(html.includes('相談教材があります。学習地図から開始できます。'));
  assert.ok(html.includes('（相談教材あり）'));
});

test('development pack: behaviour is unchanged for the introduction concepts and the unconnected topic', () => {
  const html = render(development());
  assert.equal(count(html, '>この考え方を相談で試す →<'), 1);
  assert.ok(html.includes('aria-label="次の相談ケース"'));
  const shared = render(development({ initialTopicId: 'period-expense' }));
  assert.ok(shared.includes('下の説明は「お金と利益は別」の考え方です。'));
  assert.ok(!shared.includes('aria-label="論点につながる考え方の説明"'));
  assert.equal(count(shared, '>この考え方を相談で試す →<'), 0);
  const unconnected = render(development({ initialTopicId: 'unconnected-topic' }));
  assert.ok(unconnected.includes('対応する考え方と教材は確認中です。'));
  assert.ok(!unconnected.includes('aria-label="選んだ概念の説明"'));
  assert.ok(!unconnected.includes('aria-label="論点につながる考え方の説明"'));
  assert.equal(count(unconnected, '相談で試す →'), 0);
});
