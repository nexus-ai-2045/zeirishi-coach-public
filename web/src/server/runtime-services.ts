import { PGlite } from '@electric-sql/pglite';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { StudyError } from '../domain/types';
import { createStudyService } from './study-service';
import { createConfidenceService } from './confidence-service';
import { DEVELOPMENT_CATALOG } from './development-catalog';
import { bookkeepingTrialEnabled, BOOKKEEPING_TRIAL_CATALOG, BOOKKEEPING_TRIAL_PLAN, getBookkeepingTrialMaterial, getBookkeepingTrialPracticeMaterial } from './bookkeeping-trial-supply';
import type { ConceptRef } from '../domain/onboarding';
import { createCafeServiceOnPreparedDatabase, readOwnedCafeVersion, createCafeService } from './cafe-service';
import { createDataService } from './data-service';
import { createWeeklyPlanServiceOnPreparedDatabase, createWeeklyPlanService } from './weekly-plan-service';
import { createMockExamService } from './mock-exam-service';
import { initializeExamEvidenceSchema } from './exam-evidence-service';
import { initializeReviewSchema } from './review-service';
import { initializeMasteryEvidenceSchema } from './mastery-evidence-service';
import { AI_COACH_SCHEMA, createAiCoachServiceOnPreparedDatabase } from './ai-coach-service';
import { DEVELOPMENT_CAFE_MATERIAL } from './cafe-case';
const getBookkeepingLegacyMaterial = (version:string) => { if (version !== DEVELOPMENT_CAFE_MATERIAL.caseVersion) throw new StudyError('CASE_VERSION_CONFLICT',409); return DEVELOPMENT_CAFE_MATERIAL; };
import { createLocalClaudeCoachProvider } from './local-cli-coach';
import { initializeDiagnosticSchema, createDiagnosticServiceOnPreparedDatabase } from './diagnostic-service';
import { bookkeepingDiagnosticDraftAdapter } from './bookkeeping-question-drafts';

type Study = Awaited<ReturnType<typeof createStudyService>>;
type Confidence = Awaited<ReturnType<typeof createConfidenceService>>;
type Cafe = Awaited<ReturnType<typeof createCafeService>>;
type Data = Awaited<ReturnType<typeof createDataService>>;
type Plan = Awaited<ReturnType<typeof createWeeklyPlanService>>;
const runtimeGlobal = globalThis as typeof globalThis & {
  zeirishiStudyService?: unknown;
  zeirishiDatabaseV2?: Promise<PGlite>;
  zeirishiStudyV2?: Promise<Study>;
  zeirishiConfidenceV2?: Promise<Confidence>;
  zeirishiCafeV2?: Promise<Cafe>;
  zeirishiStudyV3?: Promise<Study>;
  zeirishiConfidenceV3?: Promise<Confidence>;
  zeirishiCafeV3?: Promise<Cafe>;
  zeirishiDataV3?: Promise<Data>;
  zeirishiDataV4?: Promise<Data>;
  zeirishiDataV5?: Promise<Data>;
  zeirishiDataV7?: Promise<Data>;
  zeirishiDataV8?: Promise<Data>;
  zeirishiEvidenceDatabaseV2?: Promise<PGlite>;
  zeirishiEvidenceDatabaseV3?: Promise<PGlite>;
  zeirishiMockExamsV1?: Promise<Awaited<ReturnType<typeof createMockExamService>>>;
  zeirishiPlanV1?: Promise<Plan>;
};
/** All adapters share one file-backed connection. An old hot-reloaded process must restart. */
export function getDevelopmentDatabase(): Promise<PGlite> {
  if (process.env.ZEIRISHI_FIXTURE_MODE !== '1') throw new StudyError('FIXTURE_DISABLED', 503);
  if (runtimeGlobal.zeirishiStudyService || runtimeGlobal.zeirishiStudyV2 || runtimeGlobal.zeirishiConfidenceV2 || runtimeGlobal.zeirishiCafeV2 || runtimeGlobal.zeirishiDataV3 || runtimeGlobal.zeirishiDataV4 || runtimeGlobal.zeirishiDataV7 || runtimeGlobal.zeirishiEvidenceDatabaseV2)
    throw new StudyError('LOCAL_SERVER_RESTART_REQUIRED', 503);
  return runtimeGlobal.zeirishiDatabaseV2 ??= (async () => {
    const path = join(process.cwd(), '.local-data', 'study');
    await mkdir(path, { recursive: true });
    const db = new PGlite(path);
    try { await db.waitReady; return db; }
    catch (error) { await db.close().catch(() => undefined); throw error; }
  })().catch(error => { delete runtimeGlobal.zeirishiDatabaseV2; throw error; });
}
export function getStudyService(): Promise<Study> {
  return runtimeGlobal.zeirishiStudyV3 ??= getDevelopmentDatabase().then(async db => {
    const service = await createStudyService(db);
    await service.purgeExpired();
    return service;
  }).catch(error => { delete runtimeGlobal.zeirishiStudyV3; throw error; });
}
export function getConfidenceService(): Promise<Confidence> {
  return runtimeGlobal.zeirishiConfidenceV3 ??= getDevelopmentDatabase()
    .then(db => createConfidenceService(db, bookkeepingTrialEnabled() ? BOOKKEEPING_TRIAL_CATALOG : DEVELOPMENT_CATALOG))
    .catch(error => { delete runtimeGlobal.zeirishiConfidenceV3; throw error; });
}
export function getCafeService(): Promise<Cafe> {
  return runtimeGlobal.zeirishiCafeV3 ??= getDevelopmentDatabase().then(db => createCafeService(db))
    .catch(error => { delete runtimeGlobal.zeirishiCafeV3; throw error; });
}
export function getDataService(): Promise<Data> {
  return runtimeGlobal.zeirishiDataV8 ??= getDevelopmentDatabase().then(async db => {
    await Promise.all([getStudyService(), getConfidenceService(), getCafeService(), getWeeklyPlanService(), getMockExamService()]);
    return createDataService(db);
  }).catch(error => { delete runtimeGlobal.zeirishiDataV8; throw error; });
}
export function getLearningEvidenceDatabase(): Promise<PGlite> {
  return runtimeGlobal.zeirishiEvidenceDatabaseV3 ??= getDevelopmentDatabase().then(async db => {
    await getCafeService();
    await initializeExamEvidenceSchema(db);
    await initializeReviewSchema(db);
    await initializeMasteryEvidenceSchema(db);
    await initializeDiagnosticSchema(db);
    await db.exec(AI_COACH_SCHEMA);
    return db;
  }).catch(error => { delete runtimeGlobal.zeirishiEvidenceDatabaseV3; throw error; });
}
export async function getAiCoachService() {
  const provider = process.env.ZEIRISHI_FIXTURE_MODE === '1' && process.env.ZEIRISHI_LOCAL_CLI_PROVIDER === 'claude'
    ? createLocalClaudeCoachProvider(undefined, version => bookkeepingTrialEnabled() ? getBookkeepingTrialMaterial({caseVersion:version}) : getBookkeepingLegacyMaterial(version)) : undefined;
  return createAiCoachServiceOnPreparedDatabase(await getLearningEvidenceDatabase(), { provider });
}
export async function getDiagnosticService() {
  const db = await getLearningEvidenceDatabase();
  return bookkeepingTrialEnabled()
    ? createDiagnosticServiceOnPreparedDatabase(db, bookkeepingDiagnosticDraftAdapter(), () => new Date(), { practiceOnly: true })
    : createDiagnosticServiceOnPreparedDatabase(db);
}
export function getMockExamService() {
  return runtimeGlobal.zeirishiMockExamsV1 ??= getDevelopmentDatabase().then(db => createMockExamService(db))
    .catch(error => { delete runtimeGlobal.zeirishiMockExamsV1; throw error; });
}
export function getWeeklyPlanService(): Promise<Plan> {
  return runtimeGlobal.zeirishiPlanV1 ??= getDevelopmentDatabase().then(async db => {
    await getConfidenceService();
    const catalog = bookkeepingTrialEnabled() ? BOOKKEEPING_TRIAL_CATALOG : DEVELOPMENT_CATALOG;
    const service = await createWeeklyPlanService(db, catalog);
    return bookkeepingTrialEnabled() ? createWeeklyPlanServiceOnPreparedDatabase(db, catalog, () => new Date(), { developmentOnly:true, candidates:BOOKKEEPING_TRIAL_PLAN }) : service;
  }).catch(error => { delete runtimeGlobal.zeirishiPlanV1; throw error; });
}

export async function resolveDevelopmentCafeService(owner: string, input: {caseId?:string;concept?:ConceptRef;materialId?:string;caseVersion?:string}) {
  if (!bookkeepingTrialEnabled()) throw new StudyError('FIXTURE_DISABLED',503);
  await getCafeService();
  const db = await getDevelopmentDatabase();
  const selection = input.caseId ? {caseVersion:await readOwnedCafeVersion(db,owner,input.caseId)} : input;
  return createCafeServiceOnPreparedDatabase(db, () => new Date(), input.caseId ? getBookkeepingTrialMaterial(selection) : getBookkeepingTrialPracticeMaterial(selection));
}
