import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conceptTopics, mapLegacySubjectId, subjectMapTargetKey, topicConcepts, validateSubjectMap, type SubjectMapPack } from '../src/domain/subject-map';
import { DEVELOPMENT_SUBJECT_MAP } from '../src/server/development-subject-map';

const copy = (): SubjectMapPack => structuredClone(DEVELOPMENT_SUBJECT_MAP);
const approved = () => {
  const pack = copy();
  pack.status = 'active';
  pack.version = 'reviewed-pack-v1';
  pack.units.forEach(node => { node.status = 'active'; node.sourceId = 'reviewed-source'; });
  pack.topics.forEach(node => { node.status = 'active'; node.sourceId = 'reviewed-source'; });
  pack.concepts.forEach(node => { node.status = 'active'; node.sourceId = 'reviewed-source'; node.conceptVersion = pack.version; });
  pack.links.forEach(link => { link.status = 'active'; link.sourceVersion = pack.version;
    link.targetVersion = link.kind === 'uses-case' ? 'reviewed-case-v1' : pack.version; });
  return pack;
};

test('legacy subject alias is explicit and unknown aliases fail', () => {
  assert.equal(mapLegacySubjectId('boki'), 'bookkeeping');
  assert.throws(() => mapLegacySubjectId('boki.sales'));
});

test('local fixture supports many-to-many links without inventing missing links', () => {
  const pack = validateSubjectMap(copy());
  assert.equal(pack.subjectId, 'bookkeeping');
  assert.deepEqual(conceptTopics(pack, 'prepaid-expenses').map(topic => topic.topicId), ['period-expense', 'prepaid-assets']);
  assert.deepEqual(topicConcepts(pack, 'period-expense').map(concept => concept.conceptId), ['cash-is-not-profit', 'prepaid-expenses']);
  assert.deepEqual(topicConcepts(pack, 'unconnected-topic'), []);
  assert.equal(pack.concepts.some(concept => 'mastery' in concept), false);
});

test('invalid IDs, missing references, version mismatch and prerequisite cycles fail closed', () => {
  const invalidId = copy(); invalidId.topics[0].topicId = 'bad id';
  assert.throws(() => validateSubjectMap(invalidId));
  const missing = copy(); missing.links[0].targetId = 'missing';
  assert.throws(() => validateSubjectMap(missing));
  const mismatch = copy(); mismatch.links[0].targetVersion = 'wrong';
  assert.throws(() => validateSubjectMap(mismatch));
  const cycle = copy();
  cycle.links.push({ kind: 'prerequisite', sourceId: 'prepaid-expenses', sourceVersion: cycle.version,
    targetId: 'cash-is-not-profit', targetVersion: cycle.version, basis: 'synthetic', status: 'draft' });
  assert.throws(() => validateSubjectMap(cycle));
});

test('published projection rejects unreviewed links and unapproved case references', () => {
  const key = subjectMapTargetKey('bookkeeping', 'prepaid-expenses', 'reviewed-pack-v1', 'cafe-prepaid', 'reviewed-case-v1');
  const draft = copy();
  assert.throws(() => validateSubjectMap(draft, { published: true, approvedMaterials: new Set([key]) }));
  const pack = approved();
  const unreviewedLink = approved(); unreviewedLink.links[0].status = 'expert_review';
  assert.throws(() => validateSubjectMap(unreviewedLink, { published: true, approvedMaterials: new Set([key]) }));
  assert.throws(() => validateSubjectMap(pack, { published: true, approvedMaterials: new Set() }));
  assert.throws(() => validateSubjectMap(pack, { published: true, approvedMaterials: new Set([
    subjectMapTargetKey('income-tax', 'prepaid-expenses', 'reviewed-pack-v1', 'cafe-prepaid', 'reviewed-case-v1')]) }));
  assert.throws(() => validateSubjectMap(pack, { published: true, approvedMaterials: new Set([
    subjectMapTargetKey('bookkeeping', 'double-entry', 'reviewed-pack-v1', 'cafe-prepaid', 'reviewed-case-v1')]) }));
  const checked = validateSubjectMap(pack, { published: true, approvedMaterials: new Set([key]) });
  assert.equal(checked.version, pack.version);
});

test('case and question relations require exactly one primary concept', () => {
  const pack = copy();
  const caseLink = pack.links.find(link => link.kind === 'uses-case');
  assert.ok(caseLink);
  caseLink.role = 'secondary';
  assert.throws(() => validateSubjectMap(pack));
  caseLink.role = 'primary';
  pack.links.push({ ...caseLink, sourceId: 'double-entry', role: 'primary' });
  assert.throws(() => validateSubjectMap(pack));
});
