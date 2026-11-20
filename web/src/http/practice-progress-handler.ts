import { StudyError } from '../domain/types';
import type { createCafeService } from '../server/cafe-service';
import type { createReviewCardService } from '../server/review-card-service';
import { guardRequest, readBody, validId } from './guard';
import { jsonResponse, readLocalCookie, setLocalCookie } from './local-session';

type Service = Awaited<ReturnType<typeof createCafeService>>;
type Cards = Awaited<ReturnType<typeof createReviewCardService>>;
const key = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value);
/** Parses one review-card check: { requestId, subjectId, topicId, remembered } and nothing else. */
export function parseReviewCheck(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StudyError('INVALID_INPUT');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(name => !['requestId', 'subjectId', 'topicId', 'remembered'].includes(name))
    || typeof input.requestId !== 'string' || !validId(input.requestId) || !key(input.subjectId) || !key(input.topicId)
    || typeof input.remembered !== 'boolean') throw new StudyError('INVALID_INPUT');
  return { requestId: input.requestId, subjectId: input.subjectId, topicId: input.topicId, remembered: input.remembered };
}
/**
 * GET: the local learner's answered check questions and review-card checks, so the learning map can
 * colour each topic. POST: records one review-card check. Practice records only, never mastery evidence.
 */
export function createPracticeProgressHandler(getService: () => Promise<Service>, getCards: () => Promise<Cards>, fixtureMode: () => string | undefined) {
  return async (request: Request) => {
    try {
      guardRequest(request, fixtureMode());
      const owner = readLocalCookie(request, 'zc-user');
      if (request.method === 'GET') {
        if ([...new URL(request.url).searchParams].length) throw new StudyError('INVALID_INPUT');
        if (!owner) return jsonResponse({ records: [], checks: [], developmentOnly: true });
        const [service, cards] = await Promise.all([getService(), getCards()]);
        const [records, checks] = await Promise.all([service.practiceRecords(owner), cards.checks(owner)]);
        const response = jsonResponse({ records, checks, developmentOnly: true });
        setLocalCookie(response, 'zc-user', owner);
        return response;
      }
      if (request.method !== 'POST') throw new StudyError('METHOD_NOT_ALLOWED', 405);
      if (!owner) throw new StudyError('USER_REQUIRED', 401);
      const result = await (await getCards()).record(owner, parseReviewCheck(await readBody(request)));
      const response = jsonResponse(result);
      setLocalCookie(response, 'zc-user', owner);
      return response;
    } catch (error) {
      return error instanceof StudyError ? jsonResponse({ error: error.code }, error.status)
        : jsonResponse({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
