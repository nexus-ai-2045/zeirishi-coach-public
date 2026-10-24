import { createDataServiceOnPreparedDatabase } from '../server/data-service';
import { createLearnerContextHandler } from './learner-context';
import { parseDataDeletion, validateDataQuery } from './data-handler';
import { readBody } from './guard';

type Options = Omit<Parameters<typeof createLearnerContextHandler>[0], 'operation'>;
export function createLearnerDataHandler(options: Options) {
  const handler = createLearnerContextHandler({ ...options, operation: async (request, learner) => {
    validateDataQuery(request);
    const service = createDataServiceOnPreparedDatabase(learner.database, undefined, 'online');
    if (request.method === 'GET') return service.export(learner.userId);
    parseDataDeletion(await readBody(request));
    // Learning-data deletion does not sign out or delete the authentication account.
    return service.delete(learner.userId);
  } });
  return async (request: Request) => {
    const response = await handler(request);
    if (request.method === 'GET' && response.ok) response.headers.set('Content-Disposition', 'attachment; filename="zeirishi-learning-data.json"');
    return response;
  };
}
