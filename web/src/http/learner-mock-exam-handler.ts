import { createMockExamServiceOnPreparedDatabase, parseMockExamSave } from '../server/mock-exam-service';
import { createLearnerContextHandler, type LearnerJson } from './learner-context';
import { validateMockExamRequest } from './mock-exam-handler';
import { readBody } from './guard';

export function createLearnerMockExamHandler(options: Omit<Parameters<typeof createLearnerContextHandler>[0], 'operation'>) {
  return createLearnerContextHandler({ ...options, operation: async (request, learner): Promise<LearnerJson> => {
    const id = validateMockExamRequest(request);
    const service = createMockExamServiceOnPreparedDatabase(learner.database);
    if (id) return { item: await service.get(learner.userId, id), developmentOnly: false };
    if (request.method === 'GET') return { items: await service.list(learner.userId), limit: 20, developmentOnly: false };
    return { item: await service.save(learner.userId, parseMockExamSave(await readBody(request))), developmentOnly: false };
  } });
}
