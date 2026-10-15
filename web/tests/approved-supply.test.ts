import test from 'node:test';
import assert from 'node:assert/strict';
import { APPROVED_CAFE_MATERIALS, APPROVED_CATALOG, APPROVED_PLAN_CANDIDATES,
  APPROVED_MATERIAL_CHOICES, MATERIAL_RECORDS, createApprovedSupply, getApprovedCafeMaterial } from '../src/server/approved-catalog';
import { StudyError } from '../src/domain/types';
import { attestMaterialRecord, makeMaterialRecord } from './helpers/material-fixture';

// These are isolated integration fixtures, not proof of real expert review or legal permission.
const registryError = (error: unknown) => error instanceof StudyError
  && error.code === 'INVALID_MATERIAL_REGISTRY' && error.status === 503;

test('現物の承認済み供給は0件で、相談取得も準備中として拒否する', () => {
  assert.equal(MATERIAL_RECORDS.filter(record => record.status === 'active').length, 0);
  assert.ok(MATERIAL_RECORDS.every(record => record.status === 'draft' && !record.expertReview && !record.activation));
  assert.deepEqual(APPROVED_CATALOG, []);
  assert.deepEqual(APPROVED_PLAN_CANDIDATES, []);
  assert.deepEqual(APPROVED_CAFE_MATERIALS, []);
  assert.deepEqual(APPROVED_MATERIAL_CHOICES, []);
  assert.throws(() => getApprovedCafeMaterial(), error => error instanceof StudyError
    && error.code === 'MATERIAL_NOT_AVAILABLE' && error.status === 503);
  const empty = createApprovedSupply([]);
  assert.deepEqual([empty.catalog, empty.candidates, empty.materials], [[], [], []]);
});

test('draft・審査中・approved・retiredはactiveでない限りどの供給先にも載せない', () => {
  for (const status of ['draft', 'expert_review', 'approved', 'retired'] as const) {
    const record = makeMaterialRecord();
    record.status = status;
    const empty = createApprovedSupply([record]);
    assert.deepEqual([empty.catalog, empty.candidates, empty.materials], [[], [], []], status);
  }
});

test('架空active1件から教材一覧・週計画・相談へ同一のID・版・概念を投影し練習扱いを維持する', () => {
  const record = makeMaterialRecord();
  const supply = createApprovedSupply([record]);
  assert.equal(supply.catalog.length, 1);
  assert.equal(supply.candidates.length, 1);
  assert.equal(supply.materials.length, 1);
  const pack = supply.catalog[0];
  const candidate = supply.candidates[0];
  const material = supply.materials[0];
  assert.equal(pack.subjectId, record.subjectId);
  assert.equal(pack.version, record.version);
  assert.equal(pack.active, true);
  assert.deepEqual(pack.concepts, [record.concept]);
  assert.equal(candidate.id, record.materialId);
  assert.equal(candidate.subjectId, record.subjectId);
  assert.equal(candidate.conceptId, record.concept.conceptId);
  assert.equal(candidate.conceptVersion, record.version);
  assert.equal(candidate.qualification, 'practice');
  assert.equal(candidate.unseen, false);
  assert.equal(candidate.bucket, 'new');
  assert.equal(candidate.priority.observedExamScoreRatio, null);
  assert.equal(candidate.priority.reviewStatus, 'unknown');
  assert.equal(material.caseVersion, record.version);
  assert.deepEqual(material.concept, { subjectId: record.subjectId, conceptId: record.concept.conceptId, conceptVersion: record.concept.conceptVersion });
  assert.equal(material.scoringVersion, record.document.scoringVersion);
  const prompt = material.prompt();
  assert.equal(prompt.caseId, record.materialId);
  assert.equal(prompt.caseVersion, record.version);
  assert.equal(prompt.conceptId, candidate.conceptId);
  assert.equal(prompt.familyId, candidate.familyId);
  for (const option of prompt.options) {
    const result = material.grade(record.version, option.id);
    assert.equal(result.caseVersion, record.version);
    assert.equal(result.scoringVersion, material.scoringVersion);
    assert.equal(result.evidenceQualification, 'practice_only');
  }
});

test('審査後の本文変更・審査hash不一致・出荷hash不一致は供給を全体拒否する', () => {
  const changed = makeMaterialRecord();
  changed.document.prompt.consultation += ' 審査後の変更';
  assert.throws(() => createApprovedSupply([changed]), registryError);
  const reviewMismatch = makeMaterialRecord();
  reviewMismatch.expertReview!.documentSha256 = '0'.repeat(64);
  assert.throws(() => createApprovedSupply([reviewMismatch]), registryError);
  const activationMismatch = makeMaterialRecord();
  activationMismatch.activation!.documentSha256 = '0'.repeat(64);
  assert.throws(() => createApprovedSupply([activationMismatch]), registryError);
});

test('同科目の複数概念は決定的な単一packへまとめ、開始時は教材選択を要求する', () => {
  const first = makeMaterialRecord();
  const second = makeMaterialRecord();
  second.materialId = 'test-only-second-material';
  second.version = 'test-only-v2';
  second.concept.conceptVersion = second.version;
  second.document.prompt.caseVersion = second.version;
  second.document.prompt.consultationTitle = '別の相談者の相談';
  for (const result of Object.values(second.document.results)) result.caseVersion = second.version;
  second.document.prompt.caseId = second.materialId;
  second.concept.conceptId = 'test-only-second-concept';
  second.document.prompt.conceptId = second.concept.conceptId;
  attestMaterialRecord(second);
  const supply = createApprovedSupply([first, second]);
  assert.equal(supply.catalog.length, 1); assert.equal(supply.catalog[0].concepts.length, 2);
  assert.equal(supply.catalog[0].version, createApprovedSupply([second, first]).catalog[0].version);
  assert.throws(() => supply.getMaterial(), /MATERIAL_SELECTION_REQUIRED/);
  assert.equal(supply.getMaterial({ concept: second.concept }).caseVersion, second.version);
  assert.equal(supply.getMaterial({ caseVersion: first.version }).caseVersion, first.version);
  assert.throws(() => supply.getMaterial({ concept: { ...first.concept, subjectId: 'income-tax' } }), /MATERIAL_NOT_AVAILABLE/);
  assert.throws(() => supply.getMaterial({ caseVersion: 'missing' }), /MATERIAL_NOT_AVAILABLE/);
  const repeatedId = structuredClone(second);
  repeatedId.materialId = first.materialId; repeatedId.document.prompt.caseId = first.materialId;
  attestMaterialRecord(repeatedId);
  assert.throws(() => createApprovedSupply([first, repeatedId]), /INVALID_MATERIAL_REGISTRY/);
  const retired = structuredClone(first); retired.status = 'retired';
  assert.equal(createApprovedSupply([retired, repeatedId]).materials.length, 1);
  first.status = 'retired';
  second.version = first.version; second.concept.conceptVersion = first.version; second.document.prompt.caseVersion = first.version;
  for (const result of Object.values(second.document.results)) result.caseVersion = first.version;
  attestMaterialRecord(second);
  assert.throws(() => createApprovedSupply([first, second]), /INVALID_MATERIAL_REGISTRY/);
});

test('同じ概念版に複数ケースを束ね、公開候補と旧単件選択を保ちながら明示選択で取得する', () => {
  const first = makeMaterialRecord();
  const second = makeMaterialRecord();
  second.materialId = 'test-only-same-concept-case-2';
  second.version = 'test-only-case-version-2';
  second.document.prompt.caseId = second.materialId;
  second.document.prompt.caseVersion = second.version;
  second.document.prompt.consultationTitle = '別の相談者の相談';
  for (const result of Object.values(second.document.results)) result.caseVersion = second.version;
  // conceptVersion remains the shared stable concept revision.
  attestMaterialRecord(second);

  const supply = createApprovedSupply([first, second]);
  assert.equal(supply.catalog[0].concepts.length, 1);
  assert.deepEqual(supply.catalog[0].concepts[0], first.concept);
  assert.equal(supply.candidates.length, 2);
  assert.deepEqual(supply.candidates.map(item => item.id), [first.materialId, second.materialId].sort());
  assert.deepEqual(supply.candidates.map(item => [item.id, item.caseVersion]), [
    [first.materialId, first.version], [second.materialId, second.version],
  ].sort((a, b) => a[0].localeCompare(b[0], 'en')));
  assert.deepEqual(supply.materialChoices.map(({ materialId, caseVersion, subjectId, conceptId, conceptVersion }) =>
    [materialId, caseVersion, subjectId, conceptId, conceptVersion]), [
      [first.materialId, first.version, first.subjectId, first.concept.conceptId, first.concept.conceptVersion],
      [second.materialId, second.version, second.subjectId, second.concept.conceptId, second.concept.conceptVersion],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'en')));
  assert.deepEqual(supply.materialChoices.map(choice => choice.label), [first.document.prompt.consultationTitle, second.document.prompt.consultationTitle]);
  assert.deepEqual(Object.keys(supply.materialChoices[0]).sort(), ['caseVersion', 'conceptId', 'conceptVersion', 'label', 'materialId', 'subjectId']);
  assert.throws(() => supply.getMaterial({ concept: first.concept }), error => error instanceof StudyError
    && error.code === 'MATERIAL_SELECTION_REQUIRED' && error.status === 400);
  assert.equal(supply.getMaterial({ concept: first.concept, materialId: second.materialId, caseVersion: second.version }).caseVersion, second.version);
  assert.equal(supply.getMaterial({ materialId: second.materialId }).caseVersion, second.version);
  assert.equal(supply.getMaterial({ caseVersion: second.version }).caseVersion, second.version);
  assert.throws(() => supply.getMaterial({ concept: first.concept, materialId: second.materialId, caseVersion: first.version }), error => error instanceof StudyError
    && error.code === 'MATERIAL_NOT_AVAILABLE' && error.status === 503);

  const changedMetadata = structuredClone(second);
  changedMetadata.concept.label += '変更';
  attestMaterialRecord(changedMetadata);
  assert.throws(() => createApprovedSupply([first, changedMetadata]), registryError);
});

test('審査対象の原則・例外説明も厳格に検証し、審査後の変更を拒否する', () => {
  const record=makeMaterialRecord();
  record.document.exceptions=['架空テストの条件に限定。']; record.document.examTranslation='架空テストの試験形式。';
  for(const result of Object.values(record.document.results)) result.learningNotes={exceptions:['架空テストの条件に限定。'],examTranslation:'架空テストの試験形式。'};
  attestMaterialRecord(record);
  assert.equal(createApprovedSupply([record]).materials[0].grade(record.version,'h4r9').learningNotes?.exceptions[0],'架空テストの条件に限定。');
  record.document.results.h4r9.learningNotes!.examTranslation='審査後の変更';
  assert.throws(()=>createApprovedSupply([record]),registryError);
  record.document.results.h4r9.learningNotes!.exceptions=['']; attestMaterialRecord(record);
  assert.throws(()=>createApprovedSupply([record]),registryError);
});
