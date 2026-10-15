import { StudyError, validateAnswer } from '../domain/types';

const hosts = new Set(['localhost:3210', '127.0.0.1:3210']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validId(value: string | undefined): value is string { return !!value && uuid.test(value); }

/** Host checks are defense in depth, not authentication. Bind the server to loopback. */
export function guardRequest(request: Request, fixtureMode: string | undefined) {
  if (fixtureMode !== '1') throw new StudyError('FIXTURE_DISABLED', 503);
  const host = request.headers.get('host');
  if (!host || !hosts.has(host)) throw new StudyError('HOST_REJECTED', 403);
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new StudyError('ORIGIN_REJECTED', 403);
  if (request.method === 'POST') {
    if (request.headers.get('origin') !== `http://${host}`) throw new StudyError('ORIGIN_REJECTED', 403);
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')) {
      throw new StudyError('JSON_REQUIRED', 415);
    }
  }
}

export async function readBody(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new StudyError('INVALID_JSON');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16 * 1024) { await reader.cancel(); throw new StudyError('BODY_TOO_LARGE', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new StudyError('INVALID_JSON'); }
}

export function parseInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StudyError('INVALID_INPUT');
  const input = value as Record<string, unknown>;
  if (typeof input.requestId !== 'string' || !validId(input.requestId)) throw new StudyError('INVALID_REQUEST_ID');
  const allowed = input.action === 'start' ? ['action', 'requestId']
    : input.action === 'save' ? ['action', 'requestId', 'sessionId', 'revision', 'answer']
    : input.action === 'submit' ? ['action', 'requestId', 'sessionId', 'answer'] : [];
  if (!allowed.length || Object.keys(input).some(key => !allowed.includes(key))) throw new StudyError('INVALID_INPUT');
  if (input.action === 'start') return { action: 'start' as const, requestId: input.requestId };
  if (typeof input.sessionId !== 'string' || !validId(input.sessionId)) throw new StudyError('INVALID_SESSION_ID');
  const answer = validateAnswer(input.answer, input.action === 'submit');
  if (input.action === 'save') {
    if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0) throw new StudyError('INVALID_REVISION');
    return { action: 'save' as const, requestId: input.requestId, sessionId: input.sessionId, revision: input.revision as number, answer };
  }
  return { action: 'submit' as const, requestId: input.requestId, sessionId: input.sessionId, answer };
}
