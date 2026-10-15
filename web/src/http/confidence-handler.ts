import { randomUUID } from 'node:crypto';
import { SUBJECTS, OnboardingInputError, initialRecommendations, parseSubjectId, parseExamSubjects, validateConfidenceReport, type SubjectPack } from '../domain/onboarding';
import { validateSubjectMap } from '../domain/subject-map';
import { StudyError } from '../domain/types';
import type { ConfidenceProfile, createConfidenceService } from '../server/confidence-service';
import { guardRequest, readBody, validId } from './guard';
import { jsonResponse, readLocalCookie, setLocalCookie } from './local-session';

type Service = Awaited<ReturnType<typeof createConfidenceService>>;
type MaterialChoice = { subjectId: string; conceptId: string; conceptVersion: string; materialId: string; caseVersion: string; label: string };
export function parseProfileSave(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StudyError('INVALID_INPUT');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => !['requestId', 'revision', 'reports', 'examSubjects'].includes(key))) throw new StudyError('INVALID_INPUT');
  if (typeof input.requestId !== 'string' || !validId(input.requestId)) throw new StudyError('INVALID_REQUEST_ID');
  if (!Number.isSafeInteger(input.revision) || (input.revision as number) < 0) throw new StudyError('INVALID_REVISION');
  if (!Array.isArray(input.reports) || input.reports.length > 300) throw new StudyError('INVALID_REPORTS');
  return { requestId: input.requestId, revision: input.revision as number, reports: input.reports.map(validateConfidenceReport),
    ...(Object.hasOwn(input, 'examSubjects') ? { examSubjects: parseExamSubjects(input.examSubjects) } : {}),
  };
}

export function parseProfileSubject(request: Request) {
  const params = new URL(request.url).searchParams;
  if ([...params.keys()].some(key => key !== 'subjectId') || (request.method !== 'GET' && [...params].length)) throw new StudyError('INVALID_INPUT');
  const ids = params.getAll('subjectId');
  if (ids.length > 1) throw new StudyError('INVALID_SUBJECT_ID');
  return parseSubjectId(ids[0] ?? 'bookkeeping');
}

export function profilePayload(profile: ConfidenceProfile, subjectId: ReturnType<typeof parseSubjectId>, catalog: readonly SubjectPack[], developmentOnly: boolean,
  approvedMaterials: ReadonlySet<string> = new Set()) {
  // The editor resubmits the whole profile, including subjects not currently visible.
  // Retired versions must not poison that save or silently acquire a new version's confidence.
  const editableProfile = { ...profile, reports: profile.reports.filter(report => catalog.some(pack => pack.active &&
    pack.subjectId === report.subjectId && pack.concepts.some(concept => concept.conceptId === report.conceptId && concept.conceptVersion === report.conceptVersion))) };
  const matchingPacks = catalog.filter(pack => pack.active && pack.subjectId === subjectId);
  if (matchingPacks.length > 1) throw new StudyError('INVALID_SUBJECT_MAP', 503);
  const pack = matchingPacks[0];
  if (pack?.subjectMap && (pack.subjectMap.subjectId !== pack.subjectId || pack.subjectMap.version !== pack.version))
    throw new StudyError('INVALID_SUBJECT_MAP', 503);
  let subjectMap = null;
  if (pack?.subjectMap) {
    try { subjectMap = validateSubjectMap(pack.subjectMap, { published: !developmentOnly, approvedMaterials }); }
    catch { throw new StudyError('INVALID_SUBJECT_MAP', 503); }
  }
  return { profile: editableProfile, subjectId, developmentOnly,
    subjectMap,
    subjects: SUBJECTS.map(subject => ({ ...subject, available: catalog.some(pack => pack.subjectId === subject.id && pack.active === true && pack.concepts.length > 0) })),
    concepts: catalog.filter(pack => pack.subjectId === subjectId && pack.active).flatMap(pack => pack.concepts),
    materialNotice: developmentOnly ? '開発用の合成教材です。専門レビュー・出荷承認済みの教材ではありません。'
      : 'オンラインの本人用プロフィールです。教材一覧は、この環境で提供される教材のみです。科目の登録は教材の提供や合格判定を意味しません。',
    recommendations: initialRecommendations(catalog, profile.reports, subjectId),
  };
}

/** Loopback development profile only. No production identity, mastery or AI connection. */
export function createConfidenceHandler(getService: () => Promise<Service>, fixtureMode: () => string | undefined, catalog: readonly SubjectPack[],
  materialChoices: readonly MaterialChoice[] = []) {
  return async (request: Request) => {
    try {
      guardRequest(request, fixtureMode());
      if (!['GET', 'POST'].includes(request.method)) return jsonResponse({ error: 'METHOD_NOT_ALLOWED' }, 405);
      const subjectId = parseProfileSubject(request);
      const owner = readLocalCookie(request, 'zc-user');
      if (request.method === 'GET') {
        const profile = owner ? await (await getService()).get(owner) : { revision: 0, updatedAt: null, reports: [], examSubjects: null };
        const response = jsonResponse({ ...profilePayload(profile, subjectId, catalog, true),
          materialChoices: materialChoices.filter(choice => choice.subjectId === subjectId) });
        setLocalCookie(response, 'zc-user', owner ?? randomUUID());
        return response;
      }
      if (!owner) throw new StudyError('USER_REQUIRED', 401);
      const input = parseProfileSave(await readBody(request));
      const profile = await (await getService()).save(owner, input);
      const response = jsonResponse({ profile, developmentOnly: true });
      setLocalCookie(response, 'zc-user', owner);
      return response;
    } catch (error) {
      if (error instanceof StudyError) return jsonResponse({ error: error.code }, error.status);
      if (error instanceof OnboardingInputError) return jsonResponse({ error: 'INVALID_ONBOARDING_INPUT' }, 400);
      return jsonResponse({ error: 'INTERNAL_ERROR' }, 500);
    }
  };
}
