import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from '../src/app/api/practice/route';
import { getDevelopmentDatabase } from '../src/server/runtime-services';

test('a first practice request bootstraps ownership and still rejects revoked owners', async () => {
  const originalCwd = process.cwd();
  const keys = ['ZEIRISHI_FIXTURE_MODE', 'ZEIRISHI_BOOKKEEPING_MVP', 'ZEIRISHI_SUPABASE_ENABLED'] as const;
  const previous = keys.map(key => process.env[key]);
  const folder = await mkdtemp(join(tmpdir(), 'zc-practice-first-'));
  try {
    process.chdir(folder);
    process.env.ZEIRISHI_FIXTURE_MODE = '1';
    process.env.ZEIRISHI_BOOKKEEPING_MVP = '1';
    process.env.ZEIRISHI_SUPABASE_ENABLED = '0';
    const request = () => new Request('http://localhost:3210/api/practice', { headers: { host: 'localhost:3210', cookie: 'zc-user=e2496306-a86a-4b49-ae2c-41a0ada230f9' } });
    const first = await GET(request());
    assert.equal(first.status, 200);
    const result = await first.json();
    assert.ok(result.items.length > 0);
    assert.ok(result.items.every((item: object) => !('answer' in item) && !('explanation' in item)));
    const db = await getDevelopmentDatabase();
    await db.exec("UPDATE owner_access SET revoked_at='2026-10-16T00:00:00Z'");
    const revoked = await GET(request());
    assert.equal(revoked.status, 401);
    assert.deepEqual(await revoked.json(), { error: 'OWNER_REVOKED' });
  } finally {
    await (await getDevelopmentDatabase()).close();
    process.chdir(originalCwd);
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    await rm(folder, { recursive: true, force: true });
  }
});
