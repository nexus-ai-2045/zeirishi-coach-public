import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createCafeService, createCafeServiceOnPreparedDatabase } from '../src/server/cafe-service';

test('draft list exposes only owned unsubmitted active pointers and never extends expiry', async () => {
  const db = new PGlite(); let at = new Date('2026-09-08T00:00:00Z');
  try {
    const service = await createCafeService(db, () => at); const alice = randomUUID(), bob = randomUUID();
    const first = await service.start(alice, randomUUID());
    const other = await service.start(bob, randomUUID());
    const second = await service.start(alice, randomUUID());
    at = new Date('2026-09-08T01:00:00Z');
    const saved = await service.save(alice, second.id, { requestId: randomUUID(), revision: 0, optionId: 'h4r9', phase: 'decision' });
    const drafts = await service.drafts(alice);
    assert.deepEqual(drafts.map(item => item.caseId), [second.id, first.id]);
    assert.deepEqual(Object.keys(drafts[0]).sort(), ['caseId', 'caseVersion', 'expiresAt', 'phase', 'savedAt']);
    assert.equal(drafts[0].phase, 'decision'); assert.equal(drafts[0].expiresAt, saved.expiresAt);
    assert.equal(JSON.stringify(drafts).includes(other.id), false); assert.equal(JSON.stringify(drafts).includes('h4r9'), false);
    at = new Date('2026-09-09T00:00:00Z');
    assert.deepEqual(await service.drafts(alice), drafts);
    assert.equal((await service.get(alice, second.id)).expiresAt, saved.expiresAt);
    // Recreating a prepared service does not depend on an in-memory resume pointer.
    assert.deepEqual(await createCafeServiceOnPreparedDatabase(db, () => at).drafts(alice), drafts);
    await service.submit(alice, second.id, { requestId: randomUUID(), optionId: 'h4r9' });
    assert.deepEqual((await service.drafts(alice)).map(item => item.caseId), [first.id]);
    at = new Date(first.expiresAt);
    assert.deepEqual(await service.drafts(alice), []);
  } finally { await db.close(); }
});

test('draft list is capped at 20 with deterministic ties and newer starts precede older saved drafts', async () => {
  const db = new PGlite();
  try {
    let at = new Date('2026-09-08T00:00:00Z');
    const service = await createCafeService(db, () => at); const owner = randomUUID(); const ids: string[] = [];
    for (let index = 0; index < 23; index++) ids.push((await service.start(owner, randomUUID())).id);
    const first = await service.drafts(owner); assert.equal(first.length, 20);
    assert.deepEqual(first.map(item => item.caseId), ids.sort().reverse().slice(0, 20));
    assert.deepEqual(await service.drafts(owner), first);
    assert.ok(first.every(item => item.savedAt === null && item.phase === 'consultation'));
    at = new Date('2026-09-08T01:00:00Z');
    await service.save(owner, ids[0], { requestId: randomUUID(), revision: 0, optionId: 'h4r9', phase: 'decision' });
    at = new Date('2026-09-08T02:00:00Z');
    const newest = await service.start(owner, randomUUID());
    assert.deepEqual((await service.drafts(owner)).slice(0, 2).map(item => item.caseId), [newest.id, ids[0]]);
  } finally { await db.close(); }
});
