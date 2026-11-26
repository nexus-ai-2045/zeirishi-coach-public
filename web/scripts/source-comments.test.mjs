import assert from 'node:assert/strict';
import test from 'node:test';
import { commentReport, findComments, provenStrip } from './source-comments.mjs';

test('tracked web, test, and style sources carry no comments', () => {
  assert.deepEqual(commentReport().map(comment => `${comment.path}:${comment.line}`), []);
});

test('stripping removes line, trailing, block, JSX, and CSS comments without changing the program', () => {
  const source = [
    'const a = 1; // trailing',
    '// whole line',
    'const b = /* inline */ 2;',
    'export const view = <p>{/* jsx */}http://example.com</p>;',
    "const url = 'https://example.com/*not a comment*/';",
    'try { a; } catch { /* ignored */ }',
    '',
  ].join('\n');
  const stripped = provenStrip('sample.tsx', source);
  assert.deepEqual(findComments('sample.tsx', stripped), []);
  assert.match(stripped, /https:\/\/example\.com\/\*not a comment\*\//);
  assert.match(stripped, /<p>http:\/\/example\.com<\/p>/);
  assert.equal(provenStrip('sample.css', 'a { color: red; } /* note */\n'), 'a { color: red; }\n');
});
