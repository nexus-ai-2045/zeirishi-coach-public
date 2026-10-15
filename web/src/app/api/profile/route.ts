import { createConfidenceHandler } from '../../../http/confidence-handler';
import { bookkeepingTrialEnabled, BOOKKEEPING_TRIAL_CATALOG, BOOKKEEPING_TRIAL_CHOICES } from '../../../server/bookkeeping-trial-supply';
import { DEVELOPMENT_CATALOG } from '../../../server/development-catalog';
import { DEVELOPMENT_CAFE_MATERIAL } from '../../../server/cafe-case';
import { getConfidenceService } from '../../../server/runtime-services';
import { createLearnerProfileHandler } from '../../../http/learner-profile-handler';
import { getProductionDatabase } from '../../../server/production-database';
import { APPROVED_CATALOG, APPROVED_MATERIAL_CHOICES } from '../../../server/approved-catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const trialPrompt = DEVELOPMENT_CAFE_MATERIAL.prompt();
const trialChoices = DEVELOPMENT_CATALOG.flatMap(pack => pack.concepts.filter(concept => pack.subjectId === 'bookkeeping'
  && concept.conceptId === trialPrompt.conceptId && concept.conceptVersion === DEVELOPMENT_CAFE_MATERIAL.caseVersion)
  .map(concept => ({ subjectId: pack.subjectId, conceptId: concept.conceptId, conceptVersion: concept.conceptVersion,
    materialId: trialPrompt.caseId, caseVersion: DEVELOPMENT_CAFE_MATERIAL.caseVersion, label: trialPrompt.consultationTitle })));
const development = createConfidenceHandler(getConfidenceService, () => process.env.ZEIRISHI_FIXTURE_MODE, DEVELOPMENT_CATALOG, trialChoices);
const expandedDevelopment = createConfidenceHandler(getConfidenceService, () => process.env.ZEIRISHI_FIXTURE_MODE, BOOKKEEPING_TRIAL_CATALOG, BOOKKEEPING_TRIAL_CHOICES);
const production = createLearnerProfileHandler({ getDatabase: getProductionDatabase, catalog: APPROVED_CATALOG, materialChoices: APPROVED_MATERIAL_CHOICES });
function handler(request: Request) {
  // Auth wins routing so enabling both modes is rejected, never downgraded to fixture identity.
  return process.env.ZEIRISHI_SUPABASE_ENABLED === '1' ? production(request) : bookkeepingTrialEnabled() ? expandedDevelopment(request) : development(request);
}
export const GET = handler;
export const POST = handler;
