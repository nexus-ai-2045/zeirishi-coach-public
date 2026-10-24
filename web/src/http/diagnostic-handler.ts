import { StudyError } from '../domain/types';
import { createDiagnosticServiceOnPreparedDatabase, parseDiagnosticInput, type DiagnosticInput, type createDiagnosticService, type DiagnosticRecord } from '../server/diagnostic-service';
import { createLearnerContextHandler } from './learner-context';
import { guardRequest, readBody } from './guard';
import { jsonResponse, readLocalCookie } from './local-session';
type Service = Awaited<ReturnType<typeof createDiagnosticService>>;
type Parsed = { kind: 'list' } | { kind: 'get'; id: string } | { kind: 'save'; input: DiagnosticInput };
async function parse(request: Request): Promise<Parsed> {
  if (!['GET','POST'].includes(request.method)) throw new StudyError('METHOD_NOT_ALLOWED',405);
  const query = new URL(request.url).searchParams;
  if (request.method === 'POST') {
    if (query.size) throw new StudyError('INVALID_INPUT');
    return { kind: 'save', input: parseDiagnosticInput(await readBody(request)) };
  }
  if (!query.size) return { kind: 'list' };
  if (query.size !== 1 || !query.has('id') || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(query.get('id')!)) throw new StudyError('INVALID_INPUT');
  return { kind: 'get', id: query.get('id')! };
}
async function execute(parsed: Parsed, service: Service, owner: string): Promise<{ item: DiagnosticRecord } | { items: DiagnosticRecord[] }> {
  if (parsed.kind === 'list') return { items: await service.list(owner) };
  if (parsed.kind === 'get') return { item: await service.get(owner, parsed.id) };
  return { item: await service.save(owner, parsed.input) };
}
export function createDiagnosticHandler(getService: () => Promise<Service>, fixtureMode: () => string | undefined) {
  return async (request: Request) => {
    try {
      guardRequest(request, fixtureMode());
      const owner = readLocalCookie(request,'zc-user');
      if (!owner) throw new StudyError('USER_REQUIRED',401);
      const parsed = await parse(request);
      return jsonResponse({ ...await execute(parsed, await getService(), owner), developmentOnly: true });
    } catch (error) { return error instanceof StudyError ? jsonResponse({error:error.code},error.status) : jsonResponse({error:'DIAGNOSTIC_UNAVAILABLE'},503); }
  };
}
export function createLearnerDiagnosticHandler(options: Omit<Parameters<typeof createLearnerContextHandler>[0], 'operation'>) {
  return createLearnerContextHandler({ ...options, operation: async (request, learner) => ({
    ...await execute(await parse(request), createDiagnosticServiceOnPreparedDatabase(learner.database), learner.userId), developmentOnly: false,
  }) });
}
