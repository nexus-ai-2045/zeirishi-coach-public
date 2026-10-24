import { StudyError } from '../domain/types';
import { parseMockExamSave, type createMockExamService } from '../server/mock-exam-service';
import { guardRequest, readBody, validId } from './guard';
import { jsonResponse, readLocalCookie, setLocalCookie } from './local-session';

export function validateMockExamRequest(request: Request) {
  if (!['GET', 'POST'].includes(request.method)) throw new StudyError('METHOD_NOT_ALLOWED', 405);
  const query = new URL(request.url).searchParams;
  if (!query.size) return null;
  if (request.method !== 'GET' || query.size !== 1 || !validId(query.get('id') ?? undefined)) throw new StudyError('INVALID_INPUT');
  return query.get('id')!;
}
export function createMockExamHandler(getService: () => Promise<Awaited<ReturnType<typeof createMockExamService>>>, fixtureMode: () => string | undefined) {
  return async (request: Request) => {
    try {
      guardRequest(request, fixtureMode()); const id = validateMockExamRequest(request);
      const owner = readLocalCookie(request, 'zc-user');
      if (!owner) throw new StudyError('USER_REQUIRED', 401);
      const input = request.method === 'POST' ? parseMockExamSave(await readBody(request)) : null;
      const service = await getService();
      const response = jsonResponse(input ? { item: await service.save(owner, input), developmentOnly: true }
        : id ? { item: await service.get(owner, id), developmentOnly: true }
        : { items: await service.list(owner), limit: 20, developmentOnly: true });
      setLocalCookie(response, 'zc-user', owner); return response;
    } catch (error) {
      return error instanceof StudyError ? jsonResponse({ error: error.code }, error.status)
        : jsonResponse({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
