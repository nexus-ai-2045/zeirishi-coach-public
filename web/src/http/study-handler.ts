import { randomUUID } from 'node:crypto';
import { StudyError } from '../domain/types';
import type { createStudyService } from '../server/study-service';
import { guardRequest, parseInput, readBody, validId } from './guard';
import { jsonResponse as json, readLocalCookie as cookie, setLocalCookie as setCookie } from './local-session';

type Service = Awaited<ReturnType<typeof createStudyService>>;

/** Local pseudonymous cookie only; not production identity or authorization infrastructure. */
export function createStudyHandler(getService: () => Promise<Service>, fixtureMode: () => string | undefined) {
  return async (request: Request) => {
    try {
      guardRequest(request, fixtureMode());
      if (!['GET', 'POST'].includes(request.method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
      const userId = cookie(request, 'zc-user');
      if (request.method === 'GET') {
        const ids = new URL(request.url).searchParams.getAll('sessionId');
        if (ids.length > 1 || (ids.length === 1 && !validId(ids[0]))) throw new StudyError('INVALID_SESSION_ID');
        const sessionId = ids[0] ?? cookie(request, 'zc-session');
        if (!userId) {
          const response = json({ session: null });
          setCookie(response, 'zc-user', randomUUID());
          return response;
        }
        if (!sessionId) return json({ session: null });
        const service = await getService();
        const session = await service.get(userId, sessionId);
        const response = json({ session });
        setCookie(response, 'zc-user', userId);
        setCookie(response, 'zc-session', session.id);
        return response;
      }
      const input = parseInput(await readBody(request));
      if (!userId) throw new StudyError('USER_REQUIRED', 401);
      const service = await getService();
      if (input.action === 'start') {
        const owner = userId;
        const session = await service.start(owner, input.requestId);
        const response = json({ session });
        setCookie(response, 'zc-user', owner);
        setCookie(response, 'zc-session', session.id);
        return response;
      }
      const session = input.action === 'save'
        ? await service.save(userId, input.sessionId, input)
        : await service.submit(userId, input.sessionId, input);
      const response = json({ session });
      setCookie(response, 'zc-user', userId);
      setCookie(response, 'zc-session', session.id);
      return response;
    } catch (error) {
      if (error instanceof StudyError) return json({ error: error.code }, error.status);
      return json({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
