import { OnboardingInputError, type SubjectPack, type ConceptRef } from '../domain/onboarding';
import { subjectMapTargetKey } from '../domain/subject-map';
import { StudyError } from '../domain/types';
import { createConfidenceServiceOnPreparedDatabase } from '../server/confidence-service';
import { createLearnerContextHandler } from './learner-context';
import { parseProfileSave, parseProfileSubject, profilePayload } from './confidence-handler';
import { readBody } from './guard';

type MaterialChoice = ConceptRef & { materialId: string; caseVersion: string; label: string };
type Options = Omit<Parameters<typeof createLearnerContextHandler>[0], 'operation'> & { catalog: readonly SubjectPack[]; materialChoices?: readonly MaterialChoice[] };

/** No route or catalog defaults. Authenticated request-scoped service over an already prepared database. */
export function createLearnerProfileHandler({ catalog, materialChoices = [], ...context }: Options) {
  return createLearnerContextHandler({ ...context, operation: async (request, learner) => {
    try {
      const subjectId = parseProfileSubject(request);
      const service = createConfidenceServiceOnPreparedDatabase(learner.database, catalog);
      if (request.method === 'GET') return {
        ...profilePayload(await service.get(learner.userId), subjectId, catalog, false,
          new Set(materialChoices.map(choice => subjectMapTargetKey(choice.subjectId, choice.conceptId, choice.conceptVersion,
            choice.materialId, choice.caseVersion)))),
        materialChoices: materialChoices.filter(choice => choice.subjectId === subjectId).map(choice => ({
          subjectId: choice.subjectId, conceptId: choice.conceptId, conceptVersion: choice.conceptVersion,
          materialId: choice.materialId, caseVersion: choice.caseVersion, label: choice.label,
        })),
      };
      const profile = await service.save(learner.userId, parseProfileSave(await readBody(request)));
      return { profile, developmentOnly: false };
    } catch (error) {
      if (error instanceof OnboardingInputError) throw new StudyError('INVALID_ONBOARDING_INPUT', 400);
      throw error;
    }
  } });
}
