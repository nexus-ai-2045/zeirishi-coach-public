import { StudyError } from '../domain/types';
import { createAiCoachServiceOnPreparedDatabase, parseAiCoachRequest } from '../server/ai-coach-service';
import { guardRequest, readBody, validId } from './guard';
import { jsonResponse, readLocalCookie } from './local-session';
import { createLearnerContextHandler } from './learner-context';

async function input(request: Request) {
  if (request.method !== 'POST') throw new StudyError('METHOD_NOT_ALLOWED', 405);
  if (new URL(request.url).searchParams.size) throw new StudyError('INVALID_INPUT');
  const body = await readBody(request);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StudyError('INVALID_INPUT');
  const { caseId, ...rest } = body as Record<string, unknown>;
  if (typeof caseId !== 'string' || !validId(caseId)) throw new StudyError('INVALID_INPUT');
  return { caseId, request: parseAiCoachRequest(rest) };
}
export function createAiCoachHandler(getService: () => Promise<ReturnType<typeof createAiCoachServiceOnPreparedDatabase>>, fixtureMode: () => string | undefined) {
  return async (request: Request) => {
    try {
      guardRequest(request, fixtureMode());
      const owner = readLocalCookie(request, 'zc-user');
      if (!owner) throw new StudyError('USER_REQUIRED', 401);
      const parsed = await input(request);
      return jsonResponse(await (await getService()).request(owner, parsed.caseId, parsed.request));
    } catch (error) { return error instanceof StudyError ? jsonResponse({ error: error.code }, error.status) : jsonResponse({ error: 'AI_UNAVAILABLE' }, 503); }
  };
}
export function createLearnerAiCoachHandler(options: Omit<Parameters<typeof createLearnerContextHandler>[0], 'operation'>) {
  return createLearnerContextHandler({ ...options, operation: async (request, learner) => {
    const parsed = await input(request);
    // No provider is enabled here. Contract, pricing and quality approval are separate gates.
    return createAiCoachServiceOnPreparedDatabase(learner.database).request(learner.userId, parsed.caseId, parsed.request);
  } });
}
