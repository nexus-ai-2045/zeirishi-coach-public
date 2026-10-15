import { access, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { MATERIAL_RECORDS } from '../src/server/approved-catalog';
import { BOOKKEEPING_TRIAL_MAP } from '../src/server/bookkeeping-trial-supply';
import { BOOKKEEPING_ALL_QUESTION_DRAFTS } from '../src/server/bookkeeping-question-drafts';
import { materialReviewSha256 } from '../src/server/material-registry';
import { BOOKKEEPING_SYLLABUS_LESSONS } from '../src/server/bookkeeping-syllabus';
import { strictCanonicalJson } from '../src/server/strict-canonical-json';

const retained = async (path:string) => createHash('sha256').update(await readFile(resolve(process.cwd(),'..',path))).digest('hex');
const sourceDefinitions = [
  {id:'nta-scope',url:'https://www.nta.go.jp/taxes/zeirishi/zeirishishiken/shikenkekka/pdf/76_01.pdf',kind:'official_exam_guide',path:'docs/materials/sources/nta-2026-exam-guide.pdf',evidence_ref:'1ページの科目範囲。2026年度の案内で、将来年度の適用根拠ではない。'},
  {id:'nta-points',url:'https://www.nta.go.jp/taxes/zeirishi/zeirishishiken/point2026/pdf/01.pdf',kind:'official_exam_points',path:'docs/materials/sources/nta-2026-bookkeeping-points.pdf',evidence_ref:'全2ページの出題ポイント。問題本文・正答の転載ではない。'},
  {id:'asbj-index',url:'https://www.asb-j.jp/jp/accounting_standards.html',kind:'webpage_index',path:'docs/materials/sources/asbj-standards-index-20261007.html',evidence_ref:'基準一覧の公表状況。全基準本文や適用年度の審査は含めない。'},
  {id:'asbj-lease-34',url:'https://www.asb-j.jp/jp/wp-content/uploads/sites/4/lease_20250423_01.pdf',kind:'official_standard',path:'docs/materials/sources/asbj-lease-34.pdf',evidence_ref:'リース34の定義・認識・期間・償却の条項を部分確認。本文全体・年度適用の専門審査ではない。'},
  {id:'asbj-lease-13',url:'https://www.asb-j.jp/jp/wp-content/uploads/sites/4/Lease_55.pdf',kind:'official_standard',path:'docs/materials/sources/asbj-lease-13.pdf',evidence_ref:'リース13の利息・表示の条項を部分確認。本文全体・年度適用の専門審査ではない。'},
  {id:'asbj-asset-retirement-18',url:'https://www.asb-j.jp/jp/wp-content/uploads/sites/4/lease_20240913_08.pdf',kind:'official_standard',path:'docs/materials/sources/asbj-asset-retirement-18.pdf',evidence_ref:'資産除去債務の見積変更・表示を部分確認。本文全体・年度適用の専門審査ではない。'},
  {id:'asbj-financial-instruments-10',url:'https://www.asb-j.jp/jp/wp-content/uploads/sites/4/zeikouka_20260707_17.pdf',kind:'official_standard',path:'docs/materials/sources/asbj-financial-instruments-10.pdf',evidence_ref:'金融商品15–19・30–31項等を部分確認。本文全体・年度適用の専門審査ではない。'},
  {id:'asbj-retirement-26',url:'https://www.asb-j.jp/jp/wp-content/uploads/sites/4/zeikouka_20260707_20.pdf',kind:'official_standard',path:'docs/materials/sources/asbj-retirement-26.pdf',evidence_ref:'退職給付13–15項と個別財務諸表の条件を部分確認。本文全体・年度適用の専門審査ではない。'},
  {id:'asbj-business-combinations',url:'https://www.asb-j.jp/jp/wp-content/uploads/sites/4/kouhatsujisyou20260109_12.pdf',kind:'official_standard',path:'docs/materials/sources/asbj-business-combinations.pdf',evidence_ref:'企業結合28–33項を部分確認。本文全体・年度適用の専門審査ではない。'},
  {id:'asbj-treasury-stock',url:'https://www.asb-j.jp/jp/wp-content/uploads/sites/4/kichu_20251016_13.pdf',kind:'official_standard',path:'docs/materials/sources/asbj-treasury-stock.pdf',evidence_ref:'自己株式11–14項を部分確認。本文全体・年度適用の専門審査ではない。'},
  {id:'asbj-revenue-guidance',url:'https://www.asb-j.jp/jp/wp-content/uploads/sites/4/kichu_20251016_26.pdf',kind:'official_standard',path:'docs/materials/sources/asbj-revenue-guidance.pdf',evidence_ref:'収益認識適用指針14–18項を部分確認。本文全体・年度適用の専門審査ではない。'},
  {id:'legacy-tree',url:'references/subjects/boki.json',kind:'internal_topic_tree',path:'references/subjects/boki.json',evidence_ref:'既存9単元28論点の編集候補。重要度・頻度や個人状態を取り込まない。'},
];
const sourcePolicy = process.argv.find(argument => argument.startsWith('--source-policy='))?.split('=')[1] ?? 'public-url-only';
if (!['retained', 'public-url-only'].includes(sourcePolicy)) throw new Error('INVALID_SOURCE_POLICY');
const previousPacket = JSON.parse(await readFile(resolve(process.cwd(), '../docs/materials/bookkeeping-review-packet.json'), 'utf8')) as { sources: { id: string; url: string; status: string; observationSha256?: string; retention: { sha256?: string } }[] };
const researchSources = await Promise.all(sourceDefinitions.map(async source => {
  const localPath = resolve(process.cwd(), '..', source.path);
  let exists = true;
  try { await access(localPath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    exists = false;
  }
  if (exists) return { ...source, status: 'observed', observedAt: '2026-10-07',
    retention: { decision: source.id === 'legacy-tree' ? 'reused' : 'saved',
      reason: '保存済み資料を再利用し、実ファイルのSHA-256を読戻しました。専門審査済みを意味しません。',
      retrieval_ref: source.url, path: source.path, sha256: await retained(source.path) } };
  if (sourcePolicy !== 'public-url-only' || !source.path.startsWith('docs/materials/sources/') || !source.url.startsWith('https://')) {
    throw new Error(`REQUIRED_SOURCE_UNAVAILABLE:${source.id}`);
  }
  const previous = previousPacket.sources.find(item => item.id === source.id && item.url === source.url && item.status === 'observed');
  const observationSha256 = previous?.observationSha256 ?? previous?.retention.sha256;
  if (!observationSha256 || !/^[a-f0-9]{64}$/.test(observationSha256)) throw new Error(`PREVIOUS_OBSERVATION_REQUIRED:${source.id}`);
  const { path: _path, ...reference } = source;
  return { ...reference, status: 'observed', observedAt: '2026-10-07', observationSha256,
    observation_scope: '元の非公開保存庫で部分確認した記録を引き継ぐ。公開コピーで本文を再取得した意味ではない。',
    retention: { decision: 'url_only',
      reason: '原本は非公開資料庫で保全済み。公開ソースの再配布には不要で、権利の未確認な第三者本文を同梱せず公式URLで参照する。',
      retrieval_ref: source.url } };
}));

// Review snapshot of canonical drafts, never an approval or learner-facing projection.
const packet = {
  formatVersion: 'bookkeeping-review-draft-v1', sourcePolicy, preparedAt: new Date().toISOString(), status: 'unreviewed',
  notice: '専門審査・利用条件・適用年度・出荷承認は未確定。正答を含む開発・レビュー用ソースであり、学習者APIの回答前投影には含めない。',
  map: BOOKKEEPING_TRIAL_MAP,
  coverage: BOOKKEEPING_SYLLABUS_LESSONS.map(lesson=>({legacyTopicId:lesson.legacyTopicId,topicId:`topic-syllabus-${lesson.id}`,
    conceptId:`syllabus-${lesson.id}`,coveredSkills:lesson.coveredSkills,remainingSkills:lesson.remainingSkills,status:'draft'})),
  sources:researchSources,
  deliverable:{kind:'curriculum_coverage_review',requested_coverage:'full',actual_coverage:'partial',source_ids:['nta-scope','nta-points','legacy-tree','asbj-index']},
  claims:[
    {status:'fact',text:'2026年度の公式範囲は記帳・帳簿組織、商業簿記と工業簿記を含み、原価計算を除く。',source_ids:['nta-scope']},
    {status:'fact',text:'2026年度出題ポイントには本支店、固定資産、帳簿推定、直接法CF、OCI組替が含まれる。',source_ids:['nta-points']},
    {status:'fact',text:'旧9単元28論点は内部の編集候補であり、公式の全範囲分類ではない。',source_ids:['legacy-tree']},
    {status:'unknown',text:'全出題範囲の網羅、将来年度への適用、全問題の専門的な正答・採点は未審査。',source_ids:['nta-scope','asbj-index']},
  ],
  next_actions:[{owner:'専門レビュー担当（未指定）',action:'原稿と出典・適用年度・不足処理を確認し、専門審査する。',acceptance:'教材ごとの正答・利用条件・範囲と承認ハッシュが確定する。',evidence:'本パケットと既存教材登録の審査記録'}],
  publication:'disabled',
  retention_check:'required',
  mapSha256: createHash('sha256').update(strictCanonicalJson(BOOKKEEPING_TRIAL_MAP, () => { throw new Error('INVALID_MAP'); })).digest('hex'),
  materials: MATERIAL_RECORDS.map(record => ({ ...record, applicableYear: record.taxYear ?? null,
    intendedUse: BOOKKEEPING_ALL_QUESTION_DRAFTS.find(item => item.question.id === record.materialId)?.intendedUse ?? 'case',
    reviewSha256: materialReviewSha256(record) })),
};
await writeFile(resolve(process.cwd(), '../docs/materials/bookkeeping-review-packet.json'), JSON.stringify(packet, null, 2) + '\n');
process.stdout.write(JSON.stringify({ status: packet.status, concepts: packet.map.concepts.length, materials: packet.materials.length }) + '\n');
