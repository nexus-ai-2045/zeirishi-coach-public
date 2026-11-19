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
