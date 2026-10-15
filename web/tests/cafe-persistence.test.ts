import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createCafeService } from '../src/server/cafe-service';

test('cafe explanation survives database close/reopen without changing the submitted answer', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'zeirishi-cafe-test-'));
  let db: PGlite | undefined;
  try {
    const owner = randomUUID();
    db = new PGlite(directory);
    let service = await createCafeService(db);
    const started = await service.start(owner, randomUUID());
    const submitted = await service.submit(owner, started.id, { requestId: randomUUID(), optionId: 'h4r9' });
    assert.equal(submitted.result, null);
    const confirmed = await service.confidence(owner, started.id, { requestId: randomUUID(), confidence: null });
    const explanation = '支払った日ではなく、サービスを受ける期間で分けます。';
    const saved = await service.saveProgress(owner, started.id, { requestId: randomUUID(),
      revision: confirmed.progressRevision, phase: 'teach_back', explanation });
    await assert.rejects(service.saveProgress(owner, started.id, { requestId: randomUUID(),
      revision: saved.progressRevision, phase: 'teach_back', explanation: 'x'.repeat(2001) }),
    { message: 'INVALID_EXPLANATION' });
    await db.close();
    db = new PGlite(directory);
    service = await createCafeService(db);
    const restored = await service.get(owner, started.id);
    assert.equal(restored.explanation, explanation);
    assert.equal(restored.phase, 'teach_back');
    assert.equal(restored.attemptId, submitted.attemptId);
    assert.equal(restored.result?.correct, true);
    assert.equal(restored.progressRevision, saved.progressRevision);
  } finally {
    await db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
