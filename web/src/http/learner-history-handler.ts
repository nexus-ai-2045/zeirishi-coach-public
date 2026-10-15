import { createCafeServiceOnPreparedDatabase } from '../server/cafe-service';
import { createLearnerContextHandler } from './learner-context';
import { validateHistoryRequest } from './history-handler';

type Options = Omit<Parameters<typeof createLearnerContextHandler>[0], 'operation'>;

/** Read-only history projection; online identity does not qualify synthetic answers for assessment. */
export function createLearnerHistoryHandler(options: Options) {
  return createLearnerContextHandler({ ...options, operation: async (request, learner) => {
    validateHistoryRequest(request);
    const service = createCafeServiceOnPreparedDatabase(learner.database);
    const [items, drafts] = await Promise.all([service.history(learner.userId), service.drafts(learner.userId)]);
    return { items, drafts, limit: 20, developmentOnly: false };
  } });
}
