import { StudyError } from '../domain/types';
import type { createCafeService } from '../server/cafe-service';
import { guardRequest } from './guard';
import { jsonResponse, readLocalCookie, setLocalCookie } from './local-session';

type Service = Awaited<ReturnType<typeof createCafeService>>;
export function validateHistoryRequest(request: Request) {
  if (request.method !== 'GET') throw new StudyError('METHOD_NOT_ALLOWED', 405);
  if ([...new URL(request.url).searchParams].length) throw new StudyError('INVALID_INPUT');
}
export function createHistoryHandler(getService: () => Promise<Service>, fixtureMode: () => string | undefined) {
  return async (request: Request) => {
    try {
      guardRequest(request, fixtureMode());
      validateHistoryRequest(request);
      const owner = readLocalCookie(request, 'zc-user');
      if (!owner) throw new StudyError('USER_REQUIRED', 401);
      const service = await getService();
      const [items, drafts] = await Promise.all([service.history(owner), service.drafts(owner)]);
      const response = jsonResponse({ items, drafts,
        limit: 20, developmentOnly: true });
      setLocalCookie(response, 'zc-user', owner);
      return response;
    } catch (error) {
      return error instanceof StudyError ? jsonResponse({ error: error.code }, error.status)
        : jsonResponse({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
