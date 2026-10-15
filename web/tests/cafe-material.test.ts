import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createCafeService, createCafeServiceOnPreparedDatabase } from '../src/server/cafe-service';
import { CAFE_CASE_VERSION, CAFE_SCORING_VERSION, DEVELOPMENT_CAFE_MATERIAL, cafePrompt, gradeCafeChoice, type CafeMaterial } from '../src/server/cafe-case';
import { createMaterialRegistry } from '../src/server/material-registry';
import { makeMaterialRecord } from './helpers/material-fixture';

const owner = '11111111-1111-4111-8111-111111111111';
function alternate(): CafeMaterial {
  return {
    caseVersion: 'test-material-v3', scoringVersion: 'test-score-v3',
    prompt: () => ({ ...cafePrompt(), caseVersion: 'test-material-v3', caseId: 'test-material', title: 'テスト教材', options: [{ id: 'test-yes', label: '選択肢A' }, { id: 'test-no', label: '選択肢B' }] }),
    grade: (version, option) => ({ ...gradeCafeChoice(CAFE_CASE_VERSION, 'h4r9'), caseVersion: version, scoringVersion: 'test-score-v3', optionId: option, correct: option === 'test-yes', earned: option === 'test-yes' ? 1 : 0 }),
  };
}
test('default fixture remains identical and another injected material uses only its version and options', async () => {
  assert.deepEqual(DEVELOPMENT_CAFE_MATERIAL.prompt(), cafePrompt());
  assert.deepEqual(DEVELOPMENT_CAFE_MATERIAL.grade(CAFE_CASE_VERSION, 'h4r9'), gradeCafeChoice(CAFE_CASE_VERSION, 'h4r9'));
  const db = new PGlite();
  try {
    const original = await createCafeService(db);
    const old = await original.start(owner, randomUUID());
    assert.equal(old.caseVersion, CAFE_CASE_VERSION);
    const material = alternate();
    const service = createCafeServiceOnPreparedDatabase(db, undefined, { ...material, prompt: () => ({
      ...material.prompt(), correctOptionId: 'test-yes',
      options: material.prompt().options.map(option => ({ ...option, correct: option.id === 'test-yes', misconception: 'private' })),
      facts: material.prompt().facts.map(fact => ({ ...fact, privateAnswer: 'private' })),
    }) });
    const started = await service.start(owner, randomUUID());
    assert.equal(started.prompt.title, 'テスト教材'); assert.equal(started.caseVersion, 'test-material-v3');
    assert.deepEqual(started.prompt.options.map(option => option.id), ['test-yes', 'test-no']);
    assert.equal(started.result, null);
    assert.equal('correctOptionId' in started.prompt, false);
    assert.deepEqual(Object.keys(started.prompt.options[0]).sort(), ['id', 'label']);
    assert.deepEqual(Object.keys(started.prompt.facts[0]).sort(), ['label', 'value']);
    await assert.rejects(service.submit(owner, started.id, { requestId: randomUUID(), optionId: 'h4r9' }), /INVALID_OPTION/);
    await assert.rejects(service.get(owner, old.id), /CASE_VERSION_CONFLICT/);
    await assert.rejects(service.submit(owner, old.id, { requestId: randomUUID(), optionId: 'test-yes' }), /CASE_VERSION_CONFLICT/);
    const input = { requestId: randomUUID(), optionId: 'test-yes' };
    const submitted = await service.submit(owner, started.id, input);
    assert.equal(submitted.result, null); assert.equal((await service.submit(owner, started.id, input)).result, null);
    assert.equal((await service.history(owner))[0].correct, null);
    const result = await service.confidence(owner, started.id, { requestId: randomUUID(), confidence: null });
    assert.equal(result.result?.correct, true); assert.equal(result.result?.scoringVersion, 'test-score-v3');
    assert.equal(result.result?.evidenceQualification, 'practice_only');
    assert.deepEqual((await service.submit(owner, started.id, input)).result, result.result);
    // History is independent of the currently injected material; reopen still rejects versions.
    assert.equal((await original.history(owner))[0].caseVersion, 'test-material-v3');
    await assert.rejects(original.get(owner, started.id), /CASE_VERSION_CONFLICT/);
    started.prompt.options[0].id = 'tampered';
    assert.equal((await service.get(owner, started.id)).prompt.options[0].id, 'test-yes');
  } finally { await db.close(); }
});

test('invalid material and inconsistent grade cannot persist an attempt', async () => {
  const db = new PGlite();
  try {
    await createCafeService(db);
    const material = alternate();
    assert.throws(() => createCafeServiceOnPreparedDatabase(db, undefined, { ...material, caseVersion: 'mismatch' }), /INVALID_MATERIAL/);
    assert.throws(() => createCafeServiceOnPreparedDatabase(db, undefined, { ...material, prompt: () => ({ ...material.prompt(), options: [{ id: 'x', label: 'A' }, { id: 'x', label: 'B' }] }) }), /INVALID_MATERIAL/);
    for (const mutation of [{ scoringVersion: CAFE_SCORING_VERSION }, { caseVersion: CAFE_CASE_VERSION }, { optionId: 'wrong' }, { earned: Number.NaN }]) {
      const service = createCafeServiceOnPreparedDatabase(db, undefined, { ...material, grade: (version, option) => ({ ...material.grade(version, option), ...mutation }) });
      const item = await service.start(owner, randomUUID());
      await assert.rejects(service.submit(owner, item.id, { requestId: randomUUID(), optionId: 'test-yes' }), /INVALID_MATERIAL_RESULT/);
      assert.equal((await service.get(owner, item.id)).attemptId, null);
    }
  } finally { await db.close(); }
});

test('reviewed learning notes are gated with the saved result and never retrofit old fixture answers', async () => {
  const db = new PGlite();
  try {
    const local = await createCafeService(db);
    const legacy = await local.start(owner, randomUUID());
    await local.submit(owner, legacy.id, { requestId: randomUUID(), optionId: 'h4r9' });
    const legacyResult = await local.confidence(owner, legacy.id, { requestId: randomUUID(), confidence: null });
    assert.equal(Object.hasOwn(legacyResult.result!, 'learningNotes'), false);
    const record = makeMaterialRecord();
    const [{ material }] = createMaterialRegistry([record]);
    const service = createCafeServiceOnPreparedDatabase(db, undefined, material);
    const item = await service.start(owner, randomUUID());
    assert.equal(Object.hasOwn(item.prompt, 'learningNotes'), false);
    const submission = { requestId: randomUUID(), optionId: item.prompt.options[0].id };
    assert.equal((await service.submit(owner, item.id, submission)).result, null);
    assert.equal((await service.get(owner, item.id)).result, null);
    assert.equal((await service.submit(owner, item.id, submission)).result, null);
    const shown = await service.confidence(owner, item.id, { requestId: randomUUID(), confidence: null });
    assert.deepEqual(shown.result!.learningNotes, { exceptions: record.document.exceptions, examTranslation: record.document.examTranslation });
    assert.equal(Object.hasOwn(shown.result!, 'aiGrounding'), false);
    const changedAdapter = { ...material, grade: () => { throw new Error('saved attempts must not be regraded'); } };
    const recreated = createCafeServiceOnPreparedDatabase(db, undefined, changedAdapter);
    assert.deepEqual((await recreated.submit(owner, item.id, submission)).result, shown.result);
    assert.deepEqual((await recreated.get(owner, item.id)).result, shown.result);
    assert.equal(Object.hasOwn((await local.get(owner, legacy.id)).result!, 'learningNotes'), false);
  } finally { await db.close(); }
});
