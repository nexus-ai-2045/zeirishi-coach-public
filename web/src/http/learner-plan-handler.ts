import { StudyError } from '../domain/types';
import type { SubjectPack } from '../domain/onboarding';
import type { PlanCandidate } from '../domain/weekly-plan';
import { createWeeklyPlanServiceOnPreparedDatabase, parseWeeklyPlanSave } from '../server/weekly-plan-service';
import { createLearnerContextHandler } from './learner-context';
import { readBody, validId } from './guard';

type Options = Omit<Parameters<typeof createLearnerContextHandler>[0], 'operation'> & {
  catalog: readonly SubjectPack[]; candidates: readonly PlanCandidate[];
};
export function createLearnerPlanHandler({ catalog, candidates, ...context }: Options) {
  return createLearnerContextHandler({ ...context, operation: async (request, learner) => {
    if ([...new URL(request.url).searchParams].length) throw new StudyError('INVALID_INPUT');
    const service = createWeeklyPlanServiceOnPreparedDatabase(learner.database, catalog, undefined,
      { developmentOnly: false, candidates });
    if (request.method === 'GET') return service.get(learner.userId);
    const input = parseWeeklyPlanSave(await readBody(request));
    if (!validId(input.requestId)) throw new StudyError('INVALID_REQUEST_ID');
    return service.save(learner.userId, input);
  } });
}
