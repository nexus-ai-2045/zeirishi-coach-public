import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PART_MAX_BYTES, readReviewPacketText, splitReviewPacket, writeReviewPacketText } from './review-packet-parts.ts';

test('断片は上限以下で、つなぐと元のバイト列に戻る', () => {
  const data = Buffer.from('{\n  "a": "日本語の行",\n  "b": [1, 2, 3]\n}\n', 'utf8');
  const parts = splitReviewPacket(data, 16);
  assert.ok(parts.length > 1);
  assert.ok(parts.every(part => part.length <= 16 || !part.subarray(0, -1).includes(0x0a)));
  assert.deepEqual(Buffer.concat(parts), data);
});

test('書いて読み戻すと同じ文字列になり、断片が変わると止まる', async () => {
  const root = mkdtempSync(join(tmpdir(), 'review-packet-'));
  try {
    const text = JSON.stringify({ rows: Array.from({ length: 3 }, (_, i) => ({ i, text: '問題'.repeat(10) })) }, null, 2) + '\n';
    const manifest = await writeReviewPacketText(root, text);
    assert.equal(await readReviewPacketText(root), text);
    assert.equal(manifest.sha256, createHash('sha256').update(text).digest('hex'));
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(root, 'docs/materials/bookkeeping-review-packet', manifest.parts[0].path), 'x');
    await assert.rejects(readReviewPacketText(root), /REVIEW_PACKET_PART_MISMATCH/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('リポの断片をつなぐと manifest の SHA-256 と一致し、各断片は上限以下', async () => {
  const root = resolve('..');
  const text = await readReviewPacketText(root);
  const manifest = JSON.parse(readFileSync(join(root, 'docs/materials/bookkeeping-review-packet/manifest.json'), 'utf8'));
  assert.equal(createHash('sha256').update(text).digest('hex'), manifest.sha256);
  assert.ok(manifest.parts.every(part => part.bytes <= PART_MAX_BYTES));
  assert.equal(JSON.parse(text).materials.length, 526);
});
