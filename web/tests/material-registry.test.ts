import assert from 'node:assert/strict';
import test from 'node:test';
import { createMaterialRegistry, materialReviewSha256, type MaterialRecord } from '../src/server/material-registry';
import { makeMaterialRecord, attestMaterialRecord } from './helpers/material-fixture';

test('only complete active records produce clone-isolated practice adapters; inactive and empty return none', () => {
  assert.deepEqual(createMaterialRegistry([]), []);
  for (const status of ['draft', 'expert_review', 'approved', 'retired'] as const) {
    const record = makeMaterialRecord(); record.status = status; delete record.expertReview; delete record.activation;
    assert.deepEqual(createMaterialRegistry([record]), []);
  }
  const record = makeMaterialRecord(); const [active] = createMaterialRegistry([record]);
  assert.equal(active.aiInputAllowed, false);
  assert.equal(active.record.materialId, record.materialId);
  const prompt = active.material.prompt(); const option = prompt.options[0].id;
  assert.equal(active.material.grade(record.version, option).evidenceQualification, 'practice_only');
  const result = active.material.grade(record.version, option);
  assert.deepEqual(result.learningNotes, { exceptions: record.document.exceptions, examTranslation: record.document.examTranslation });
  assert.equal(Object.hasOwn(result, 'aiGrounding'), false); assert.equal(Object.hasOwn(result, 'sources'), false);
  assert.equal(Object.hasOwn(result, 'expertReview'), false);
  result.learningNotes!.exceptions.push('changed');
  assert.notDeepEqual(active.material.grade(record.version, option).learningNotes, result.learningNotes);
  assert.throws(() => active.material.grade('another-version', option), /CASE_VERSION_CONFLICT/);
  assert.throws(() => active.material.grade(record.version, 'missing-option'), /INVALID_OPTION/);
  prompt.options[0].label = 'changed'; record.document.prompt.title = 'changed';
  assert.notEqual(active.material.prompt().options[0].label, 'changed'); assert.notEqual(active.material.prompt().title, 'changed');
  assert.ok(Object.isFrozen(active.record.concept)); assert.ok(Object.isFrozen(active.record.document));
});

test('review hash binds all content, rights, metadata and applicability independent of JSON key order', () => {
  const record = makeMaterialRecord(); const hash = materialReviewSha256(record);
  const reordered = Object.fromEntries(Object.entries(record).reverse()) as MaterialRecord;
  assert.equal(materialReviewSha256(reordered), hash);
  for (const mutate of [
    (r: MaterialRecord) => { r.document.prompt.consultation += 'x'; },
    (r: MaterialRecord) => { r.document.exceptions.push('追加例外'); },
    (r: MaterialRecord) => { r.document.examTranslation += 'x'; },
    (r: MaterialRecord) => { r.sources[0].rights.aiInput = 'allowed'; },
    (r: MaterialRecord) => { r.sources[0].permissionNote += 'x'; },
    (r: MaterialRecord) => { r.concept.importance = r.concept.importance === 5 ? 4 : 5; },
    (r: MaterialRecord) => { r.authorId += '-changed'; },
    (r: MaterialRecord) => { r.taxYear = 2026; r.basisDate = '2026-01-01'; },
  ]) {
    const changed = makeMaterialRecord(); mutate(changed);
    assert.notEqual(materialReviewSha256(changed), hash); assert.throws(() => createMaterialRegistry([changed]));
  }
});

test('active needs separate reviewer, matching approval, rights per purpose and exact tax dates', () => {
  for (const mutate of [
    (r: MaterialRecord) => { delete r.expertReview; },
    (r: MaterialRecord) => { delete r.activation; },
    (r: MaterialRecord) => { r.expertReview!.reviewerId = r.authorId; },
    (r: MaterialRecord) => { r.expertReview!.documentSha256 = '0'.repeat(64); },
    (r: MaterialRecord) => { r.activation!.approvedAt = '2000-01-01T00:00:00Z'; },
    (r: MaterialRecord) => { r.expertReview!.reviewedAt = '2026-02-30T00:00:00Z'; },
  ]) { const r = makeMaterialRecord(); mutate(r); assert.throws(() => createMaterialRegistry([r])); }
  for (const use of ['acquisition', 'storage', 'reproduction', 'modification', 'redistribution'] as const) {
    for (const permission of ['unknown', 'denied'] as const) {
      const r = makeMaterialRecord(); r.sources[0].rights[use] = permission; attestMaterialRecord(r);
      assert.throws(() => createMaterialRegistry([r]));
    }
  }
  const aiUnknown = makeMaterialRecord(); aiUnknown.sources[0].rights.aiInput = 'unknown'; attestMaterialRecord(aiUnknown);
  assert.equal(createMaterialRegistry([aiUnknown])[0].aiInputAllowed, false);
  const tax = makeMaterialRecord(); tax.subjectId = 'income-tax'; tax.concept.subjectId = tax.subjectId; attestMaterialRecord(tax);
  assert.throws(() => createMaterialRegistry([tax]));
  tax.taxYear = 2026; tax.basisDate = '2026-02-30'; attestMaterialRecord(tax); assert.throws(() => createMaterialRegistry([tax]));
  tax.basisDate = '2026-01-01'; attestMaterialRecord(tax); assert.equal(createMaterialRegistry([tax]).length, 1);
});

test('four complete practice choices, no fixture and exact grade versions are required', () => {
  for (const mutate of [
    (r: MaterialRecord) => { r.document.prompt.developmentOnly = true; },
    (r: MaterialRecord) => { r.document.results[r.document.prompt.options[0].id].learningNotes = { exceptions: ['別の正本'], examTranslation: '原稿側への二重保存は禁止' }; },
    (r: MaterialRecord) => { r.document.prompt.caseId = 'other-material'; },
    (r: MaterialRecord) => { r.document.prompt.options.pop(); },
    (r: MaterialRecord) => { r.document.prompt.options[1].id = r.document.prompt.options[0].id; },
    (r: MaterialRecord) => { delete r.document.results[r.document.prompt.options[0].id]; },
    (r: MaterialRecord) => { r.document.results[r.document.prompt.options[0].id].scoringVersion = 'wrong'; },
    (r: MaterialRecord) => { r.document.results[r.document.prompt.options[0].id].caseVersion = 'wrong'; },
    (r: MaterialRecord) => { r.document.results[r.document.prompt.options[0].id].optionId = 'wrong'; },
    (r: MaterialRecord) => { r.concept.unseenQuestionCount = 1; },
    (r: MaterialRecord) => { r.concept.conceptVersion = ''; },
    (r: MaterialRecord) => { r.concept.durationMinutes = 1.5; },
    (r: MaterialRecord) => { r.concept.durationMinutes = 10081; },
    (r: MaterialRecord) => { r.concept.label = '長'.repeat(201); },
    (r: MaterialRecord) => { r.document.prompt.consultationTitle = '長'.repeat(201); },
    (r: MaterialRecord) => { Object.values(r.document.results).find(result => !result.correct)!.misconceptionCandidate = null; },
    (r: MaterialRecord) => { r.document.scoringVersion = 'synthetic-cafe-choice-v1'; for (const result of Object.values(r.document.results)) result.scoringVersion = r.document.scoringVersion; },
    (r: MaterialRecord) => { r.version = 'synthetic-cafe-prepaid-v2'; r.concept.conceptVersion = r.version; r.document.prompt.caseVersion = r.version; for (const result of Object.values(r.document.results)) result.caseVersion = r.version; },
  ]) { const r = makeMaterialRecord(); mutate(r); attestMaterialRecord(r); assert.throws(() => createMaterialRegistry([r])); }
  const duplicate = makeMaterialRecord(); assert.throws(() => createMaterialRegistry([duplicate, duplicate]));
});

test('functions, cycles, custom JSON coercion and non-finite data cannot be attested', () => {
  for (const value of [() => true, Number.NaN, undefined, new Date(), { toJSON: () => 'safe' }]) {
    const record = makeMaterialRecord(); (record.document as unknown as Record<string, unknown>).extra = value;
    assert.throws(() => materialReviewSha256(record));
  }
  const cyclic = makeMaterialRecord(); (cyclic.document as unknown as Record<string, unknown>).cycle = cyclic;
  assert.throws(() => materialReviewSha256(cyclic));
});
