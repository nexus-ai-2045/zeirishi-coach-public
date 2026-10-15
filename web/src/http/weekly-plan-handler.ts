import { StudyError } from '../domain/types';
import { parseWeeklyPlanSave, type createWeeklyPlanService } from '../server/weekly-plan-service';
import { guardRequest, readBody, validId } from './guard';
import { jsonResponse, readLocalCookie, setLocalCookie } from './local-session';

type Service = Awaited<ReturnType<typeof createWeeklyPlanService>>;
export function createWeeklyPlanHandler(getService: () => Promise<Service>, fixtureMode: () => string | undefined) {
  return async (request: Request) => {
    try {
      guardRequest(request, fixtureMode());
      if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
      if ([...new URL(request.url).searchParams].length) throw new StudyError('INVALID_INPUT');
      const owner = readLocalCookie(request, 'zc-user');
      if (!owner) throw new StudyError('USER_REQUIRED', 401);
      let result;
      if (request.method === 'GET') result = await (await getService()).get(owner);
      else {
        const input = parseWeeklyPlanSave(await readBody(request));
        if (!validId(input.requestId)) throw new StudyError('INVALID_REQUEST_ID');
        result = await (await getService()).save(owner, input);
      }
      const response = jsonResponse(result);
      setLocalCookie(response, 'zc-user', owner);
      return response;
    } catch (error) {
      return error instanceof StudyError ? jsonResponse({ error: error.code }, error.status)
        : jsonResponse({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
