import { StudyError } from '../domain/types';
import { guardRequest, readBody } from './guard';
import { jsonResponse, readLocalCookie, setLocalCookie } from './local-session';

type Service = {
  export(owner: string): Promise<unknown>;
  delete(owner: string): Promise<{ deleted: true; developmentOnly: boolean; notice: string }>;
};
export function validateDataQuery(request: Request) {
  if ([...new URL(request.url).searchParams].length) throw new StudyError('INVALID_INPUT');
}
export function parseDataDeletion(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new StudyError('INVALID_INPUT');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !['action', 'confirmation'].includes(key))
    || input.action !== 'delete' || input.confirmation !== 'DELETE_MY_LEARNING_DATA') throw new StudyError('CONFIRMATION_REQUIRED');
}
export function createDataHandler(getService: () => Promise<Service>, fixtureMode: () => string | undefined) {
  return async (request: Request) => {
    try {
      guardRequest(request, fixtureMode());
      if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
      validateDataQuery(request);
      const owner = readLocalCookie(request, 'zc-user');
      if (request.method === 'GET') {
        if (!owner) throw new StudyError('USER_REQUIRED', 401);
        const response = jsonResponse(await (await getService()).export(owner));
        response.headers.set('Content-Disposition', 'attachment; filename="zeirishi-learning-data.json"');
        setLocalCookie(response, 'zc-user', owner);
        return response;
      }
      parseDataDeletion(await readBody(request));
      // A missing cookie cannot prove which data was deleted. Never turn missing identity into success.
      if (!owner) throw new StudyError('USER_REQUIRED', 401);
      const result = await (await getService()).delete(owner);
      const response = jsonResponse(result);
      for (const name of ['zc-user', 'zc-session']) response.headers.append('Set-Cookie',
        `${name}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return response;
    } catch (error) {
      return error instanceof StudyError ? jsonResponse({ error: error.code }, error.status)
        : jsonResponse({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
