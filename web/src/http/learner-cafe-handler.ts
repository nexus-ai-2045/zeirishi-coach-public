import { StudyError } from '../domain/types';
import type { CafeMaterial } from '../server/cafe-case';
import { createCafeServiceOnPreparedDatabase, readOwnedCafeVersion } from '../server/cafe-service';
import type { ConceptRef } from '../domain/onboarding';
import { createLearnerContextHandler } from './learner-context';
import { executeCafeAction, parseCafeAction, readCafeId } from './cafe-handler';
import { readBody } from './guard';

type Options = Omit<Parameters<typeof createLearnerContextHandler>[0], 'operation'> & { getMaterial: (selection?: { concept?: ConceptRef; materialId?: string; caseVersion?: string }) => CafeMaterial };
export function createLearnerCafeHandler({ getMaterial, ...context }: Options) {
  return createLearnerContextHandler({ ...context, operation: async (request, learner) => {
    const id = request.method === 'GET' ? readCafeId(request) : null;
    if (request.method === 'POST' && [...new URL(request.url).searchParams].length) throw new StudyError('INVALID_INPUT');
    const input = request.method === 'POST' ? parseCafeAction(await readBody(request)) : null;
    const concept = input?.action === 'start' ? input.concept as ConceptRef | undefined : undefined;
    const caseVersion = input?.action === 'start' ? undefined : await readOwnedCafeVersion(learner.database, learner.userId, id ?? input!.caseId as string);
    const materialId = input?.action === 'start' ? input.materialId as string | undefined : undefined;
    const material = getMaterial(concept ? { concept, ...(materialId ? { materialId } : {}) } : caseVersion ? { caseVersion } : undefined);
    if (caseVersion && material.caseVersion !== caseVersion) throw new StudyError('CASE_VERSION_CONFLICT', 409);
    if (concept && (material.concept
      ? material.concept.subjectId !== concept.subjectId || material.concept.conceptId !== concept.conceptId || material.concept.conceptVersion !== concept.conceptVersion
      : material.caseVersion !== concept.conceptVersion || material.prompt().conceptId !== concept.conceptId)) throw new StudyError('MATERIAL_NOT_AVAILABLE', 503);
    if (materialId && material.prompt().caseId !== materialId) throw new StudyError('MATERIAL_NOT_AVAILABLE', 503);
    if (input?.action === 'start' && input.caseVersion && material.caseVersion !== input.caseVersion) throw new StudyError('CASE_VERSION_CONFLICT', 409);
    const service = createCafeServiceOnPreparedDatabase(learner.database, undefined, material);
    const session = input ? await executeCafeAction(service, learner.userId, input) : await service.get(learner.userId, id!);
    return { session, developmentOnly: false };
  } });
}
