export async function resolve(specifier, context, next) {
  if (specifier === 'next/image') return { url: 'data:text/javascript,export default function Image(){return null}', shortCircuit: true };
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.css')) return { format: 'module', shortCircuit: true, source: 'export default new Proxy({}, { get: (_, key) => String(key) });' };
  return next(url, context);
}
