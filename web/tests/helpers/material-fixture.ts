import { cafePrompt, gradeCafeChoice, CAFE_CASE_VERSION } from '../../src/server/cafe-case';
import { materialReviewSha256, type MaterialRecord } from '../../src/server/material-registry';

/**
 * 架空の審査記録を持つテスト専用データ。実在の専門家審査・利用許諾・出荷承認ではない。
 * 公開教材レジストリへ転記しない。通信も行わない。
 */
export function makeMaterialRecord(): MaterialRecord {
  const prompt = { ...cafePrompt(), caseId: 'test-only-material', caseVersion: 'test-only-v1', developmentOnly: false };
  const record: MaterialRecord = {
    materialId: prompt.caseId, version: prompt.caseVersion, subjectId: 'bookkeeping', authorId: 'test-only-author',
    concept: { subjectId: 'bookkeeping', conceptId: prompt.conceptId, conceptVersion: prompt.caseVersion,
      label: 'テスト専用の前払費用', importance: 3, durationMinutes: 10, unseenQuestionCount: 0 },
    document: { prompt, scoringVersion: 'test-only-scoring-v1',
      results: Object.fromEntries(prompt.options.map(option => [option.id, {
        ...gradeCafeChoice(CAFE_CASE_VERSION, option.id), caseVersion: prompt.caseVersion,
        scoringVersion: 'test-only-scoring-v1', developmentOnly: false,
      }])),
      exceptions: ['テスト専用。実教材として利用しない。'], aiGrounding: [],
      examTranslation: 'テスト専用の試験との対応説明。実試験の適合確認ではない。',
    },
    sources: [{ sourceId: 'test-only-source', termsUrl: 'https://example.test/test-only-rights',
      checkedAt: '2026-09-08', attribution: '架空テスト資料', permissionNote: '架空の許諾記録。実利用の許諾ではない。',
      rights: { acquisition: 'allowed', storage: 'allowed', reproduction: 'allowed',
        modification: 'allowed', redistribution: 'allowed', aiInput: 'denied' } }],
    status: 'active',
  };
  return attestMaterialRecord(record);
}

/** 架空記録の署名対象が変わるテストだけで使用する。現実の承認を発行しない。 */
export function attestMaterialRecord(record: MaterialRecord): MaterialRecord {
  const hash = materialReviewSha256(record);
  record.expertReview = { reviewerId: 'test-only-independent-reviewer', documentSha256: hash, reviewedAt: '2026-09-08T00:00:00.000Z' };
  record.activation = { approvedBy: 'test-only-operator', documentSha256: hash, approvedAt: '2026-09-08T00:01:00.000Z' };
  return record;
}
