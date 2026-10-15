/** Strict JSON normalization shared by review payloads. Caller owns the domain error. */
export function strictCanonicalJson(value: unknown, invalid: () => never, parents = new Set<object>(), depth = 0): string {
  if (depth > 40) invalid();
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid(); return JSON.stringify(value); }
  if (typeof value !== 'object' || parents.has(value)) invalid();
  if (Object.getOwnPropertySymbols(value).length) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.values(descriptors).some(item => item.get || item.set)) invalid();
  const next = new Set(parents); next.add(value);
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length || Object.keys(value).some((key, index) => key !== String(index))) invalid();
    return '[' + value.map(item => strictCanonicalJson(item, invalid, next, depth + 1)).join(',') + ']';
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid();
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + strictCanonicalJson((value as Record<string, unknown>)[key], invalid, next, depth + 1)).join(',') + '}';
}
