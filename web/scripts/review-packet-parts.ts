import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// 専門レビュー用パケットは大きいので、中身を変えずに行の境目で断片に分けて置く。
// 断片を manifest.json の順につなぐと、元の JSON とバイト単位で一致する。
export const REVIEW_PACKET_DIR = 'docs/materials/bookkeeping-review-packet';
export const PART_MAX_BYTES = 1_000_000;

type Part = { path: string; bytes: number; sha256: string };
type Manifest = { formatVersion: 'split-text-v1'; joinedName: string; bytes: number; sha256: string; parts: Part[] };

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

export function splitReviewPacket(data: Buffer, maxBytes = PART_MAX_BYTES): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  let end = 0;
  while (end < data.length) {
    const newline = data.indexOf(0x0a, end);
    const lineEnd = newline === -1 ? data.length : newline + 1;
    if (end > start && lineEnd - start > maxBytes) { parts.push(data.subarray(start, end)); start = end; }
    end = lineEnd;
  }
  if (end > start) parts.push(data.subarray(start, end));
  return parts;
}

export async function readReviewPacketText(root: string): Promise<string> {
  const dir = join(root, REVIEW_PACKET_DIR);
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Manifest;
  if (manifest.formatVersion !== 'split-text-v1') throw new Error('REVIEW_PACKET_FORMAT');
  const parts = await Promise.all(manifest.parts.map(async part => {
    const data = await readFile(join(dir, part.path));
    if (data.length !== part.bytes || sha256(data) !== part.sha256) throw new Error(`REVIEW_PACKET_PART_MISMATCH:${part.path}`);
    return data;
  }));
  const joined = Buffer.concat(parts);
  if (joined.length !== manifest.bytes || sha256(joined) !== manifest.sha256) throw new Error('REVIEW_PACKET_MISMATCH');
  return joined.toString('utf8');
}

export async function writeReviewPacketText(root: string, text: string): Promise<Manifest> {
  const dir = join(root, REVIEW_PACKET_DIR);
  const data = Buffer.from(text, 'utf8');
  const parts = splitReviewPacket(data).map((part, index) => ({ part, path: `part-${String(index + 1).padStart(2, '0')}.txt` }));
  await mkdir(dir, { recursive: true });
  for (const { part, path } of parts) await writeFile(join(dir, path), part);
  const manifest: Manifest = { formatVersion: 'split-text-v1', joinedName: 'bookkeeping-review-packet.json', bytes: data.length, sha256: sha256(data),
    parts: parts.map(({ part, path }) => ({ path, bytes: part.length, sha256: sha256(part) })) };
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
