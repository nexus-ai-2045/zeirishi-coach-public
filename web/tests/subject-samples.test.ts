import test from 'node:test';
import assert from 'node:assert/strict';
import { SUBJECTS } from '../src/domain/onboarding';
import { SUBJECT_SAMPLES, SUBJECT_SAMPLE_BASIS, SUBJECT_SAMPLE_CATALOG, SUBJECT_SAMPLE_MATERIALS, sampleConcept } from '../src/server/subject-samples';
import { BOOKKEEPING_TRIAL_CATALOG, TRIAL_MATERIAL_CHOICES, getBookkeepingTrialPracticeMaterial } from '../src/server/bookkeeping-trial-supply';

const others = SUBJECTS.filter(subject => subject.id !== 'bookkeeping');

test('簿記論以外の10科目に確認問題が3問以上ずつあり、前提（法令の時点）を明記する', () => {
  assert.equal(SUBJECT_SAMPLES.length, 106);
  for (const subject of others) {
    assert.ok(SUBJECT_SAMPLES.filter(item => item.subjectId === subject.id).length >= 3, subject.id);
    assert.match(SUBJECT_SAMPLE_BASIS[subject.id as keyof typeof SUBJECT_SAMPLE_BASIS], /2026年11月時点/);
  }
  assert.equal(new Set(SUBJECT_SAMPLES.map(item => item.id)).size, SUBJECT_SAMPLES.length);
});

test('全体ツリーの★頻出論点には、すべて確認問題が1問以上つながっている', async () => {
  const { SUBJECT_TREES } = await import('../src/server/subject-samples');
  for (const tree of SUBJECT_TREES) {
    const map = SUBJECT_SAMPLE_CATALOG.find(item => item.subjectId === tree.subjectId)!.subjectMap!;
    const withQuestion = new Set(map.links.filter(link => link.kind === 'uses-case').map(link => link.sourceId));
    const missing = map.topics.filter(topic => topic.frequency === 'high')
      .filter(topic => !map.links.some(link => link.kind === 'explains-topic' && link.targetId === topic.topicId && withQuestion.has(link.sourceId)));
    assert.deepEqual(missing.map(topic => topic.label), [], tree.subjectId);
  }
});

test('論点を指す確認問題は、説明文を論点から借り、存在しない論点を指さない', () => {
  for (const item of SUBJECT_SAMPLES.filter(sample => sample.treeTopic)) {
    const concept = sampleConcept(item);
    assert.ok(concept.definition && concept.counterexample && concept.examUse, item.id);
    assert.equal(item.definition, undefined, `${item.id} は説明文を二重に持たない`);
  }
});

test('見本問題は選択肢が重複せず、正解の位置と「正解だけ最長」に偏りがない', () => {
  const positions = new Map<number, number>();
  let longestOnly = 0;
  for (const material of SUBJECT_SAMPLE_MATERIALS) {
    const prompt = material.prompt();
    assert.equal(new Set(prompt.options.map(option => option.label)).size, 4);
    const index = prompt.options.findIndex(option => material.grade(material.caseVersion, option.id).correct);
    assert.equal(prompt.options.filter(option => material.grade(material.caseVersion, option.id).correct).length, 1);
    positions.set(index, (positions.get(index) ?? 0) + 1);
    const lengths = prompt.options.map(option => option.label.length);
    if (lengths[index] === Math.max(...lengths) && lengths.filter(value => value === lengths[index]).length === 1) longestOnly++;
  }
  const total = SUBJECT_SAMPLE_MATERIALS.length;
  assert.ok([...positions.values()].every(count => count <= total * 0.4), JSON.stringify([...positions]));
  assert.ok(longestOnly <= total * 0.1, `正解だけ最長: ${longestOnly} / ${total}`);
});

test('誤答には選んだ選択肢ごとの理由を返し、正式な評価には使わない', () => {
  for (const [index, material] of SUBJECT_SAMPLE_MATERIALS.entries()) {
    const item = SUBJECT_SAMPLES[index];
    for (const option of material.prompt().options) {
      const result = material.grade(material.caseVersion, option.id);
      assert.equal(result.evidenceQualification, 'practice_only');
      if (result.correct) assert.equal(result.misconceptionCandidate, null);
      else assert.ok(item.wrongReasons.includes(result.misconceptionCandidate!));
    }
  }
});

test('試用カタログで各科目を選ぶと見本問題を開始できる', () => {
  assert.equal(SUBJECT_SAMPLE_CATALOG.length, 10);
  assert.equal(BOOKKEEPING_TRIAL_CATALOG.length, 11);
  for (const choice of TRIAL_MATERIAL_CHOICES.filter(choice => choice.subjectId !== 'bookkeeping')) {
    const material = getBookkeepingTrialPracticeMaterial({ concept: { subjectId: choice.subjectId, conceptId: choice.conceptId, conceptVersion: choice.conceptVersion }, materialId: choice.materialId, caseVersion: choice.caseVersion });
    assert.equal(material.caseVersion, choice.caseVersion);
  }
});

test('財務諸表論は全体ツリー（分野→論点）で表示し、旧論点表の全論点を含み、見本問題を論点につなぐ', async () => {
  const { readFileSync } = await import('node:fs');
  const { SUBJECT_TREES } = await import('../src/server/subject-samples');
  const legacy = JSON.parse(readFileSync(new URL('../../references/subjects/zaihyo.json', import.meta.url), 'utf8'));
  const tree = SUBJECT_TREES.find(item => item.subjectId === 'financial-statements')!;
  assert.deepEqual(legacy.topics.map((topic: { id: string }) => topic.id).filter((id: string) => !tree.topics.some(topic => topic.legacyTopics.includes(id))), []);
  const pack = SUBJECT_SAMPLE_CATALOG.find(item => item.subjectId === 'financial-statements')!;
  const map = pack.subjectMap!;
  assert.equal(map.units.length, tree.units.length);
  assert.equal(map.topics.length, tree.topics.length);
  assert.ok(map.topics.every(topic => topic.frequency && topic.summary));
  assert.ok(map.links.filter(link => link.kind === 'prerequisite').length >= tree.topics.length - tree.units.length);
  assert.equal(map.links.filter(link => link.kind === 'uses-case').length, SUBJECT_SAMPLES.filter(item => item.subjectId === 'financial-statements').length);
});

test('税法4科目も全体ツリーで表示し、旧論点表の全論点・具体例・やさしい言葉を含み、見本問題を論点につなぐ', async () => {
  const { readFileSync } = await import('node:fs');
  const { SUBJECT_TREES } = await import('../src/server/subject-samples');
  const files = { 'income-tax': 'shotoku', 'corporation-tax': 'hojin', 'consumption-tax': 'shohi', 'inheritance-tax': 'sozoku' } as const;
  for (const [subjectId, file] of Object.entries(files)) {
    const legacy = JSON.parse(readFileSync(new URL(`../../references/subjects/${file}.json`, import.meta.url), 'utf8'));
    const tree = SUBJECT_TREES.find(item => item.subjectId === subjectId)!;
    assert.ok(tree, subjectId);
    assert.deepEqual(legacy.topics.map((topic: { id: string }) => topic.id).filter((id: string) => !tree.topics.some(topic => topic.legacyTopics.includes(id))), [], subjectId);
    assert.match(tree.note, /2026年11月時点/);
    const map = SUBJECT_SAMPLE_CATALOG.find(item => item.subjectId === subjectId)!.subjectMap!;
    assert.equal(map.topics.length, tree.topics.length);
    assert.ok(map.topics.every(topic => topic.frequency && topic.summary && topic.example), subjectId);
    assert.ok(Object.keys(map.glossary ?? {}).length >= 40, subjectId);
    assert.ok(map.links.filter(link => link.kind === 'prerequisite').length >= tree.topics.length - tree.units.length, subjectId);
    assert.equal(map.links.filter(link => link.kind === 'uses-case').length, SUBJECT_SAMPLES.filter(item => item.subjectId === subjectId).length, subjectId);
  }
});

test('残り5科目（酒税・国税徴収・住民税・事業税・固定資産税）も全体ツリーで表示し、具体例・やさしい言葉を含み、見本問題を論点につなぐ', async () => {
  const { SUBJECT_TREES } = await import('../src/server/subject-samples');
  for (const subjectId of ['liquor-tax', 'national-tax-collection', 'inhabitant-tax', 'enterprise-tax', 'fixed-asset-tax']) {
    const tree = SUBJECT_TREES.find(item => item.subjectId === subjectId)!;
    assert.ok(tree, subjectId);
    assert.match(tree.note, /2026年11月時点/);
    const map = SUBJECT_SAMPLE_CATALOG.find(item => item.subjectId === subjectId)!.subjectMap!;
    assert.ok(map.topics.length >= 10, subjectId);
    assert.equal(map.topics.length, tree.topics.length);
    assert.ok(map.topics.every(topic => topic.frequency && topic.summary && topic.example), subjectId);
    assert.ok(Object.keys(map.glossary ?? {}).length >= 40, subjectId);
    assert.ok(map.links.filter(link => link.kind === 'prerequisite').length >= tree.topics.length - tree.units.length, subjectId);
    assert.equal(map.links.filter(link => link.kind === 'uses-case').length, SUBJECT_SAMPLES.filter(item => item.subjectId === subjectId).length, subjectId);
  }
  assert.equal(SUBJECT_TREES.length, 10);
});

test('未成立の改正（1%法案）は、現行の本文を変えずに「成立した場合」の版を論点に持ち、不正な形は弾く', async () => {
  const { validateSubjectMap } = await import('../src/domain/subject-map');
  const map = SUBJECT_SAMPLE_CATALOG.find(item => item.subjectId === 'consumption-tax')!.subjectMap!;
  const topic = map.topics.find(item => item.topicId === 'topic-tax-base')!;
  assert.match(topic.summary, /食料品や新聞は8%/);
  assert.match(topic.pendingReform!.status, /未確定/);
  assert.match(topic.pendingReform!.ifEnacted.summary!, /1%/);
  assert.match(topic.pendingReform!.ifEnacted.definition!, /2027年4月1日から2029年3月31日/);
  const withReform = (pendingReform: unknown) => ({ ...map, topics: map.topics.map(item => item === topic ? { ...item, pendingReform } : item) });
  assert.throws(() => validateSubjectMap(withReform({ title: '法案', status: '審議中', ifEnacted: {} }) as never));
  assert.throws(() => validateSubjectMap(withReform({ title: '法案', status: '審議中', ifEnacted: { rate: '1%' } }) as never));
  assert.doesNotThrow(() => validateSubjectMap(withReform({ title: '法案', status: '審議中', ifEnacted: { summary: '1%' } }) as never));
});

test('1%法案の成否は pending-reforms.json の outcome 1か所で切り替わり、成立・不成立のどちらでも教材と問題が矛盾しない', async () => {
  const { REFORMS } = await import('../src/server/pending-reforms');
  const { resolveTrees, resolveSamples } = await import('../src/server/subject-samples');
  assert.equal(REFORMS['food-rate-1pct'].outcome, 'pending', 'いまは未成立');
  const taxBase = (outcome: 'pending' | 'enacted' | 'rejected') =>
    resolveTrees({ 'food-rate-1pct': outcome }).find(tree => tree.subjectId === 'consumption-tax')!.topics.find(topic => topic.key === 'tax-base')!;
  const question = (outcome: 'pending' | 'enacted' | 'rejected') => resolveSamples({ 'food-rate-1pct': outcome }).find(item => item.id === 'shohi-reduced-rate')!;

  // 審議中：本文は現行法、画面で切り替えられる版を持つ。問題は現行法。
  assert.ok(taxBase('pending').pendingReform);
  assert.match(taxBase('pending').summary, /食料品や新聞は8%/);
  assert.equal(question('pending').answer, 'スーパーで買って持ち帰るお弁当');

  // 成立：本文が1%の内容に置き換わり、切り替えは消える。問題の正解は新聞に変わる。
  const enacted = taxBase('enacted');
  assert.equal(enacted.pendingReform, undefined);
  assert.match(enacted.summary, /2年間だけ1%/);
  assert.match(enacted.concept.definition, /2027年4月1日から2029年3月31日/);
  assert.match(enacted.concept.applicability, /100\/101/, '計算手順も1%の割り戻しを含む');
  assert.match(enacted.concept.counterexample, /1%の特例の対象外/);
  assert.equal(enacted.concept.purpose, taxBase('pending').concept.purpose, '書き換えない項目は残る');
  const glossary = resolveTrees({ 'food-rate-1pct': 'enacted' }).find(tree => tree.subjectId === 'consumption-tax')!.glossary ?? {};
  assert.doesNotMatch(Object.values(glossary).join(' '), /食料品[^。]*8%/, '用語の言い換えが成立版と矛盾しない');
  const enactedQuestion = question('enacted');
  assert.match(enactedQuestion.answer, /新聞/);
  assert.ok(enactedQuestion.wrong.includes('スーパーで買って持ち帰るお弁当'));
  assert.equal(enactedQuestion.wrongReasons.length, 3);

  // 不成立：本文は現行法のまま、「審議中」の一文だけ消える。問題は現行法。
  const rejected = taxBase('rejected');
  assert.equal(rejected.pendingReform, undefined);
  assert.match(rejected.summary, /食料品や新聞は8%/);
  assert.doesNotMatch(rejected.concept.definition, /審議|1%/);
  assert.equal(question('rejected').answer, 'スーパーで買って持ち帰るお弁当');

  // どの結果でも、問題は存在する論点を指し、選択肢は重複しない。
  for (const outcome of ['pending', 'enacted', 'rejected'] as const) {
    const item = question(outcome);
    assert.equal(new Set([item.answer, ...item.wrong]).size, 4, outcome);
    assert.equal(item.treeTopic, 'tax-base');
  }
});
