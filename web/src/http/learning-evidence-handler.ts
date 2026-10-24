import { SUBJECTS, type SubjectId } from '../domain/onboarding';
import { StudyError } from '../domain/types';
import type { TransactionDatabase } from '../server/database';
import { createExamEvidenceReaderOnPreparedDatabase } from '../server/exam-evidence-service';
import { createReviewServiceOnPreparedDatabase } from '../server/review-service';
import { createMasteryEvidenceReaderOnPreparedDatabase } from '../server/mastery-evidence-service';
import { guardRequest } from './guard';
import { jsonResponse, readLocalCookie } from './local-session';
import { createLearnerContextHandler } from './learner-context';

export function parseEvidenceQuery(request: Request) {
  if (request.method !== 'GET') throw new StudyError('METHOD_NOT_ALLOWED', 405);
  const query = new URL(request.url).searchParams;
  if (query.size !== 3 || [...query.keys()].some(key => !['subjectId', 'examYear', 'criterionVersion'].includes(key))) throw new StudyError('INVALID_INPUT');
  const subjectId = query.get('subjectId') as SubjectId;
  const year = query.get('examYear') ?? '';
  const criterionVersion = query.get('criterionVersion') ?? '';
  if (!SUBJECTS.some(subject => subject.id === subjectId) || !/^\d{4}$/.test(year) || Number(year) < 1900 || Number(year) > 2200
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(criterionVersion)) throw new StudyError('INVALID_INPUT');
  return { subjectId, examYear: Number(year), criterionVersion };
}
async function read(request: Request, db: TransactionDatabase, owner: string) {
  const query = parseEvidenceQuery(request);
  const assessment = await createExamEvidenceReaderOnPreparedDatabase(db).evaluate(owner, { ...query, asOf: new Date().toISOString() });
  const review = await createReviewServiceOnPreparedDatabase(db).get(owner);
  const mastery = await createMasteryEvidenceReaderOnPreparedDatabase(db).evaluateSubject(owner, query.subjectId);
  // Do not expose complete evidence payloads, administrative attestations or revision logs.
  return { assessment, mastery: mastery.map(item => ({ subjectId: item.subjectId, conceptId: item.conceptId,
    conceptVersion: item.conceptVersion, criterionVersion: item.criterionVersion, status: item.status,
    needsRecheck: item.needsRecheck, reasons: item.reasons })), review: { evidenceCount: review.evidenceCount, correctionCount: review.correctionCount,
    items: review.items.map(item => ({ subjectId: item.subjectId, conceptId: item.conceptId, conceptVersion: item.conceptVersion,
      nextReviewAt: item.nextReviewAt, scheduledFor: item.scheduledFor, examAdjusted: item.examAdjusted })) } };
}
export function createLearningEvidenceHandler(getDatabase: () => Promise<TransactionDatabase>, fixtureMode: () => string | undefined) {
  return async (request: Request) => {
    try {
      guardRequest(request, fixtureMode()); parseEvidenceQuery(request);
      const owner = readLocalCookie(request, 'zc-user');
      if (!owner) throw new StudyError('USER_REQUIRED', 401);
      return jsonResponse(await read(request, await getDatabase(), owner));
    } catch (error) { return error instanceof StudyError ? jsonResponse({ error: error.code }, error.status) : jsonResponse({ error: 'LEARNING_UNAVAILABLE' }, 503); }
  };
}
export function createLearnerLearningEvidenceHandler(options: Omit<Parameters<typeof createLearnerContextHandler>[0], 'operation'>) {
  return createLearnerContextHandler({ ...options, operation: (request, learner) => read(request, learner.database, learner.userId) });
}
