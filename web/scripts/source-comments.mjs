import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parse } = require('next/dist/compiled/babel/parser');

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const generatedFiles = new Set(['web/next-env.d.ts']);
const scriptExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const positionKeys = new Set(['start', 'end', 'loc', 'range', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'tokens']);

function babelPlugins(path) {
  return extname(path) === '.tsx' ? ['typescript', 'jsx'] : extname(path) === '.ts' ? ['typescript'] : ['jsx'];
}

function emptyJsxContainers(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (node.type === 'JSXExpressionContainer' && node.expression?.type === 'JSXEmptyExpression') found.push({ start: node.start, end: node.end, jsx: true });
  for (const [key, value] of Object.entries(node)) {
    if (!positionKeys.has(key)) for (const child of Array.isArray(value) ? value : [value]) emptyJsxContainers(child, found);
  }
  return found;
}

function scriptComments(path, text) {
  const ast = parse(text, { sourceType: 'module', plugins: babelPlugins(path), allowReturnOutsideFunction: true });
  const containers = emptyJsxContainers(ast.program);
  return ast.comments.map(comment => containers.find(box => box.start <= comment.start && comment.end <= box.end) ?? { start: comment.start, end: comment.end })
    .filter((range, index, all) => all.findIndex(other => other.start === range.start) === index);
}

function cssComments(text) {
  const found = [];
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === '\\') index += 1;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      if (end < 0) throw new Error('unterminated CSS comment');
      found.push({ start: index, end: end + 2 });
      index = end + 1;
    }
  }
  return found;
}

export function findComments(path, text) {
  if (generatedFiles.has(path)) return [];
  if (extname(path) === '.css') return cssComments(text);
  if (scriptExtensions.has(extname(path))) return scriptComments(path, text);
  return [];
}

export function stripComments(text, comments) {
  let output = text;
  for (const comment of [...comments].sort((a, b) => b.start - a.start)) {
    const { start, end, jsx } = comment;
    const lineStart = output.lastIndexOf('\n', start - 1) + 1;
    const newline = output.indexOf('\n', end);
    const lineEnd = newline < 0 ? output.length : newline;
    const head = output.slice(lineStart, start);
    const tail = output.slice(end, lineEnd);
    if (!head.trim() && !tail.trim()) output = output.slice(0, lineStart) + output.slice(newline < 0 ? lineEnd : lineEnd + 1);
    else if (jsx) output = output.slice(0, start) + output.slice(end);
    else if (!tail.trim()) output = output.slice(0, lineStart) + head.trimEnd() + output.slice(lineEnd);
    else if (!head.trim()) output = output.slice(0, lineStart) + head + tail.trimStart() + output.slice(lineEnd);
    else output = output.slice(0, lineStart) + head.trimEnd() + ' ' + tail.trimStart() + output.slice(lineEnd);
  }
  return output;
}

function shape(path, text) {
  if (extname(path) === '.css') return text.replace(/\s+/g, ' ').trim();
  const ast = parse(text, { sourceType: 'module', plugins: babelPlugins(path), allowReturnOutsideFunction: true });
  return JSON.stringify(ast.program, (key, value) => {
    if (positionKeys.has(key)) return undefined;
    if (key === 'children' && Array.isArray(value)) return renderedChildren(value);
    return value;
  });
}

function renderedText(value) {
  const lines = value.split(/\r\n|\n|\r/);
  return lines
    .map((line, index) => {
      const left = index === 0 ? line : line.replace(/^[ \t]+/, '');
      return index === lines.length - 1 ? left : left.replace(/[ \t]+$/, '');
    })
    .filter(line => line)
    .join(' ');
}

function renderedChildren(children) {
  const merged = [];
  for (const child of children) {
    if (child?.type === 'JSXExpressionContainer' && child.expression?.type === 'JSXEmptyExpression') continue;
    if (child?.type !== 'JSXText') { merged.push(child); continue; }
    const text = renderedText(child.value);
    if (!text) continue;
    const previous = merged.at(-1);
    if (previous?.type === 'JSXText') previous.value += text;
    else merged.push({ type: 'JSXText', value: text });
  }
  return merged;
}

export function provenStrip(path, text) {
  const comments = findComments(path, text);
  const stripped = stripComments(text, comments);
  const expected = extname(path) === '.css' ? stripComments(text, comments) : text;
  if (shape(path, stripped) !== shape(path, expected)) throw new Error(`${path}: stripping comments changed the program`);
  if (findComments(path, stripped).length) throw new Error(`${path}: comments remain after stripping`);
  return stripped;
}

export function trackedSourceFiles() {
  return execFileSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(path => path && (scriptExtensions.has(extname(path)) || extname(path) === '.css'));
}

export function commentReport() {
  return trackedSourceFiles().flatMap(path => {
    const text = readFileSync(join(repoRoot, path), 'utf8');
    return findComments(path, text).map(({ start, end }) => ({
      path,
      line: text.slice(0, start).split('\n').length,
      text: text.slice(start, end),
    }));
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--write')) {
    for (const path of trackedSourceFiles()) {
      const absolute = join(repoRoot, path);
      const text = readFileSync(absolute, 'utf8');
      let stripped;
      try { stripped = provenStrip(path, text); } catch (error) { throw new Error(error.message.startsWith(path) ? error.message : `${path}: ${error.message}`); }
      if (stripped !== text) writeFileSync(absolute, stripped);
    }
  }
  const remaining = commentReport();
  for (const comment of remaining) console.log(`${comment.path}:${comment.line}: ${comment.text.split('\n')[0]}`);
  if (remaining.length) process.exitCode = 1;
  else console.log('no comments in tracked source files');
}
