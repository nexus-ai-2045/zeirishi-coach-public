import { StudyError } from '../domain/types';
import type { createCafeService } from '../server/cafe-service';
import { guardRequest, readBody, validId } from './guard';
import { jsonResponse as json, readLocalCookie, setLocalCookie } from './local-session';
import { OnboardingInputError, parseConceptRef, type ConceptRef } from '../domain/onboarding';
import { DEVELOPMENT_CAFE_MATERIAL } from '../server/cafe-case';

type Service = Awaited<ReturnType<typeof createCafeService>>;
const materialKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
export function parseCafeAction(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StudyError('INVALID_INPUT');
  const input = value as Record<string, unknown>;
  const action = input.action;
  const actionKeys: Record<string, string[]> = {
    start: ['concept', 'materialId', 'caseVersion'], save: ['revision', 'optionId', 'phase'], submit: ['optionId'],
    confidence: ['confidence'], progress: ['revision', 'phase', 'explanation'], complete: [],
  };
  if (typeof action !== 'string' || !Object.hasOwn(actionKeys, action)) throw new StudyError('INVALID_ACTION');
  const allowed = ['action', 'requestId', ...(action === 'start' ? [] : ['caseId']), ...actionKeys[action]];
  if (Object.keys(input).some(key => !allowed.includes(key)) || typeof input.requestId !== 'string' || !validId(input.requestId)) throw new StudyError('INVALID_INPUT');
  if (action !== 'start' && (typeof input.caseId !== 'string' || !validId(input.caseId))) throw new StudyError('INVALID_CASE_ID');
  if (action === 'start' && Object.hasOwn(input, 'materialId')
    && (!materialKey(input.materialId) || !input.concept)) throw new StudyError('INVALID_MATERIAL_SELECTION');
  if (action === 'start' && Object.hasOwn(input, 'caseVersion')
    && (!materialKey(input.caseVersion) || !input.materialId)) throw new StudyError('INVALID_MATERIAL_SELECTION');
  if (action === 'start' && Object.hasOwn(input, 'concept')) {
    try {
      if (!input.concept || typeof input.concept !== 'object' || Array.isArray(input.concept)
        || Object.keys(input.concept).some(key => !['subjectId', 'conceptId', 'conceptVersion'].includes(key))) throw new StudyError('INVALID_CONCEPT');
      input.concept = parseConceptRef(input.concept);
    } catch (error) { if (error instanceof OnboardingInputError) throw new StudyError('INVALID_CONCEPT'); throw error; }
  }
  if (action === 'save' || action === 'progress') {
    if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0) throw new StudyError('INVALID_REVISION');
  }
  if (action === 'save' || action === 'submit') {
    if (!(action === 'save' && input.optionId === null) &&
      (typeof input.optionId !== 'string' || input.optionId.length > 128)) throw new StudyError('INVALID_OPTION');
  }
  if (action === 'save' && !['consultation', 'decision'].includes(input.phase as string)) throw new StudyError('INVALID_PHASE');
  if (action === 'progress' && (!['feedback', 'teach_back', 'reflection'].includes(input.phase as string)
    || typeof input.explanation !== 'string' || input.explanation.length > 2000)) throw new StudyError('INVALID_PROGRESS');
  if (action === 'confidence' && input.confidence !== null && !['low', 'normal', 'high'].includes(input.confidence as string)) throw new StudyError('INVALID_CONFIDENCE');
  return input;
}

export function readCafeId(request: Request) {
  const params = new URL(request.url).searchParams;
  const ids = params.getAll('caseId');
  if ([...params.keys()].some(key => key !== 'caseId') || ids.length !== 1 || !validId(ids[0])) throw new StudyError('INVALID_CASE_ID');
  return ids[0];
}
export async function executeCafeAction(service: Service, owner: string, input: ReturnType<typeof parseCafeAction>) {
  const requestId = input.requestId as string;
  const caseId = input.caseId as string;
  switch (input.action) {
    case 'start': return service.start(owner, requestId, { bindMaterialVersion: !!input.concept || !!input.materialId });
    case 'save': return service.save(owner, caseId, { requestId, revision: input.revision as number,
      optionId: input.optionId as string | null, phase: input.phase as 'consultation' | 'decision' });
    case 'submit': return service.submit(owner, caseId, { requestId, optionId: input.optionId as string });
    case 'confidence': return service.confidence(owner, caseId, { requestId, confidence: input.confidence as 'low' | 'normal' | 'high' | null });
    case 'progress': return service.saveProgress(owner, caseId, { requestId, revision: input.revision as number,
      phase: input.phase as 'feedback' | 'teach_back' | 'reflection', explanation: input.explanation as string });
    case 'complete': return service.complete(owner, caseId, { requestId });
    default: throw new StudyError('INVALID_ACTION');
  }
}

export function createCafeHandler(getService: () => Promise<Service>, fixtureMode: () => string | undefined, resolveService?: (owner: string, input: { caseId?: string; concept?: ConceptRef; materialId?: string; caseVersion?: string }) => Promise<Service>) {
  return async (request: Request) => {
    try {
      guardRequest(request, fixtureMode());
      if (!['GET', 'POST'].includes(request.method)) return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
      const owner = readLocalCookie(request, 'zc-user');
      if (!owner) throw new StudyError('USER_REQUIRED', 401);
      if (request.method === 'GET') {
        const id = readCafeId(request);
        const service = resolveService ? await resolveService(owner, { caseId: id }) : await getService();
        const response = json({ session: await service.get(owner, id), developmentOnly: true });
        setLocalCookie(response, 'zc-user', owner);
        return response;
      }
      if ([...new URL(request.url).searchParams].length) throw new StudyError('INVALID_INPUT');
      const input = parseCafeAction(await readBody(request));
      if (!resolveService && input.action === 'start' && input.materialId && input.materialId !== DEVELOPMENT_CAFE_MATERIAL.prompt().caseId)
        throw new StudyError('MATERIAL_NOT_AVAILABLE', 503);
      if (!resolveService && input.action === 'start' && input.caseVersion && input.caseVersion !== DEVELOPMENT_CAFE_MATERIAL.caseVersion)
        throw new StudyError('CASE_VERSION_CONFLICT', 409);
      if (!resolveService && input.action === 'start' && input.concept) {
        const ref = input.concept as ConceptRef, prompt = DEVELOPMENT_CAFE_MATERIAL.prompt();
        if (ref.subjectId !== 'bookkeeping' || ref.conceptId !== prompt.conceptId || ref.conceptVersion !== prompt.caseVersion) throw new StudyError('MATERIAL_NOT_AVAILABLE', 503);
      }
      const service = resolveService ? await resolveService(owner, input.action === 'start'
        ? { concept: input.concept as ConceptRef | undefined, materialId: input.materialId as string | undefined, caseVersion: input.caseVersion as string | undefined }
        : { caseId: input.caseId as string }) : await getService();
      const session = await executeCafeAction(service, owner, input);
      const response = json({ session, developmentOnly: true });
      setLocalCookie(response, 'zc-user', owner);
      return response;
    } catch (error) {
      return error instanceof StudyError ? json({ error: error.code }, error.status) : json({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
