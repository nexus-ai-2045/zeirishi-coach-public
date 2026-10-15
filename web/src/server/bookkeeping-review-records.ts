import type { MaterialRecord, MaterialSource } from './material-registry';
import { BOOKKEEPING_TRIAL_MATERIALS, BOOKKEEPING_TRIAL_CATALOG } from './bookkeeping-trial-supply';
const sources: MaterialSource[] = [
  ['asbj-principles','81','企業会計原則・同注解'], ['asbj-inventory','24','棚卸資産の評価基準'], ['asbj-revenue','14','収益認識適用指針'],
].map(([sourceId,topic,attribution]) => ({sourceId,termsUrl:`https://www.asb-j.jp/jp/accounting_standards_system/details.html?topics_id=${topic}`,checkedAt:'2026-10-05',attribution,permissionNote:'参考資料本文を確認。教材の専門審査と利用条件の照合は未完了。',rights:{acquisition:'unknown',storage:'unknown',reproduction:'unknown',modification:'unknown',redistribution:'unknown',aiInput:'unknown'}}));
const syllabusSources: MaterialSource[] = [{sourceId:'nta-bookkeeping-scope-2026',termsUrl:'https://www.nta.go.jp/taxes/zeirishi/zeirishishiken/shikenkekka/pdf/76_01.pdf',
  checkedAt:'2026-10-07',attribution:'国税庁・第76回税理士試験受験案内（範囲のみ）',permissionNote:'会計処理の正答根拠ではなく、科目の範囲の確認。専門審査・転載利用条件は未確定。',
  rights:{acquisition:'unknown',storage:'unknown',reproduction:'unknown',modification:'unknown',redistribution:'unknown',aiInput:'unknown'}},
  {sourceId:'asbj-standards-index-2026',termsUrl:'https://www.asb-j.jp/jp/accounting_standards.html',checkedAt:'2026-10-07',
  attribution:'企業会計基準委員会・基準一覧（原稿の参照入口）',permissionNote:'一覧の公表状況を確認した。全基準本文の適用年度・採点根拠・利用条件の専門確認は未完了。',
  rights:{acquisition:'unknown',storage:'unknown',reproduction:'unknown',modification:'unknown',redistribution:'unknown',aiInput:'unknown'}}];
/** Registry review candidates only. Draft status cannot be used as supply or approval. */
export const BOOKKEEPING_MATERIAL_RECORD_DRAFTS: readonly MaterialRecord[] = BOOKKEEPING_TRIAL_MATERIALS.map(material => {
  const prompt=material.prompt(); const correct=prompt.options.map(option=>material.grade(material.caseVersion,option.id)).find(result=>result.correct)!;
  return {materialId:prompt.caseId,version:material.caseVersion,subjectId:'bookkeeping',authorId:'codex-draft',status:'draft',
    concept:BOOKKEEPING_TRIAL_CATALOG[0].concepts.find(concept=>concept.conceptId===prompt.conceptId)!,
    sources:prompt.conceptId.startsWith('syllabus-') ? syllabusSources : sources.filter(source => source.sourceId === 'asbj-principles' || (prompt.conceptId === 'inventory-cost' && source.sourceId === 'asbj-inventory') || (prompt.conceptId === 'provisions-estimates' && source.sourceId === 'asbj-revenue')),
    document:{prompt,scoringVersion:material.scoringVersion,results:Object.fromEntries(prompt.options.map(option=>[option.id,material.grade(material.caseVersion,option.id)])),exceptions:correct.learningNotes?.exceptions ?? [],aiGrounding:[],examTranslation:correct.learningNotes?.examTranslation ?? BOOKKEEPING_TRIAL_CATALOG[0].subjectMap?.concepts.find(concept=>concept.conceptId===prompt.conceptId)?.examUse ?? '資料の条件から仕訳と計算を確かめる。'}};
});
