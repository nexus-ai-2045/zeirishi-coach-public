import { readFileSync } from 'node:fs';

const expected = readFileSync(new URL('../../.nvmrc', import.meta.url), 'utf8').trim();
if (process.versions.node !== expected) {
  throw new Error(`Node.js ${expected} が必要です。現在は ${process.versions.node} です。.nvmrc に合わせて実行してください。`);
}
