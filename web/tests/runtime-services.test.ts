import test from 'node:test';
import assert from 'node:assert/strict';
import { getCafeService, getConfidenceService, getStudyService, getDataService, getWeeklyPlanService, getMockExamService } from '../src/server/runtime-services';

test('old cached services cannot bypass revocation after a hot reload', () => {
  const runtime = globalThis as unknown as Record<string, unknown>;
  const originalMode = process.env.ZEIRISHI_FIXTURE_MODE;
  const oldKeys = ['zeirishiStudyService', 'zeirishiStudyV2', 'zeirishiConfidenceV2', 'zeirishiCafeV2', 'zeirishiDataV3', 'zeirishiDataV4', 'zeirishiDataV7', 'zeirishiEvidenceDatabaseV2'];
  const previous = oldKeys.map(key => runtime[key]);
  try {
    process.env.ZEIRISHI_FIXTURE_MODE = '1';
    for (const key of oldKeys) {
      runtime[key] = { stale: true };
      for (const get of [getCafeService, getConfidenceService, getStudyService, getDataService, getWeeklyPlanService, getMockExamService]) {
        assert.throws(get, { message: 'LOCAL_SERVER_RESTART_REQUIRED' });
      }
      delete runtime[key];
    }
    assert.equal(runtime.zeirishiDatabaseV2, undefined);
  } finally {
    oldKeys.forEach((key, index) => { if (previous[index] === undefined) delete runtime[key]; else runtime[key] = previous[index]; });
    if (originalMode === undefined) delete process.env.ZEIRISHI_FIXTURE_MODE;
    else process.env.ZEIRISHI_FIXTURE_MODE = originalMode;
  }
});
