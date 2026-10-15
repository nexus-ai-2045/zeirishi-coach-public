import 'node:crypto';
import type { MapConcept } from '../domain/subject-map';
import { StudyError } from '../domain/types';
import type { CafeMaterial, CafePrompt } from './cafe-case';
import { bookkeepingConceptVersion } from './bookkeeping-question-drafts';

const authoredDraft = { status: 'draft' as const, sourceId: 'authored-local', applicableYear: null };

/** Original local drafts. Neither these concepts nor their cases have expert approval. */
export const BOOKKEEPING_CORE_CONCEPTS: MapConcept[] = [
  {
    conceptId: 'cash-is-not-profit', conceptVersion: bookkeepingConceptVersion('cash-is-not-profit'), label: 'お金と利益は別',
    definition: '現金の増減と、収益から費用を引いた利益の増減を分けて考える。',
    purpose: '入金や支払だけを見て、儲けや赤字を決めないため。',
    applicability: '借入、元本返済、掛売上の回収、固定資産の購入など。',
    counterexample: '現金売上しかなく、費用もすべて同じ期間に支払われる条件では、両者の増減が一致することもある。',
    misconception: '借入の入金を売上にし、設備購入の支払をすべて費用にする。',
    materialCue: '入出金の相手、返済義務、取得した資産、収益・費用の期間を確かめる。',
    examUse: '取引ごとに資産・負債・収益・費用への影響を分け、利益を計算する。', ...authoredDraft,
  },
  {
    conceptId: 'double-entry', conceptVersion: bookkeepingConceptVersion('double-entry'), label: '取引には二つの面がある',
    definition: '取引による各勘定の変化を借方と貸方に記録し、金額の合計を一致させる。',
    purpose: '資金の動きとその理由を、同じ取引の記録で結び付けるため。',
    applicability: '借入、現金による設備購入、商品販売、決算整理などの仕訳。',
    counterexample: '単なる未承諾の見積書は、それだけで資産取得や支払義務の仕訳を生じさせない。',
    misconception: '借方は常に増加、貸方は常に減少だと思う。',
    materialCue: '現金と借入金、設備と現金など、変化した勘定とその種類を一組ずつ確認する。',
    examUse: '資産・負債・純資産・収益・費用の増減から借方・貸方を判断する。', ...authoredDraft,
  },
  {
    conceptId: 'prepaid-expenses', conceptVersion: bookkeepingConceptVersion('prepaid-expenses'), label: '支払日と費用の期間は別',
    definition: '継続するサービスの対価を先に払った場合、まだ受けていないサービスの分を資産として残す。',
    purpose: '当期に受けたサービスの分だけを当期の費用にするため。',
    applicability: '保険料や家賃など、契約期間が決算日をまたぐ継続的な役務。',
    counterexample: '商品納品前の代金は、継続的な役務の前払費用とは区別して前払金などを検討する。',
    misconception: '先払いした金額をすべて支払年度の費用にする。',
    materialCue: '契約の開始日・終了日、決算日、支払額、すでに計上した費用を照合する。',
    examUse: '期間配分と、費用から前払費用へ振り替える決算整理仕訳を求める。', ...authoredDraft,
  },
  {
    conceptId: 'inventory-cost', conceptVersion: bookkeepingConceptVersion('inventory-cost'), label: '売れた商品の分を原価にする',
    definition: '販売した商品に対応する原価を費用とし、未販売の商品を期末在庫として残す。',
    purpose: '仕入額をそのまま費用にせず、売上に対応した粗利益を把握するため。',
    applicability: '商品売買で、期首在庫・当期仕入・期末在庫が確かめられる場合。',
    counterexample: '在庫の減耗や値下がりがある場合は、単純な数量と取得原価の配分だけで処理を終えない。',
    misconception: '期末在庫も含めて当期仕入の全額を売上原価にする。',
    materialCue: '仕入帳、実地棚卸表、単価、所有権、期末前後の納品と返品を確認する。',
    examUse: '期首商品＋当期純仕入－期末商品から売上原価を求め、売上総利益を計算する。', ...authoredDraft,
  },
  {
    conceptId: 'depreciation', conceptVersion: bookkeepingConceptVersion('depreciation'), label: '設備の原価を使う期間へ配分する',
    definition: '使い続ける設備の取得原価を、見積もった耐用期間にわたって規則的に費用へ配分する。',
    purpose: '購入時の支払だけに費用を集中させず、設備を使う各期に対応させるため。',
    applicability: '使用開始日、取得原価、残存価額、耐用年数、償却方法が分かる償却対象資産。',
    counterexample: '土地は通常の減価償却対象ではなく、減損や時価の変化とも別に考える。',
    misconception: '減価償却を時価への値下げと考え、売却時までの当期償却を忘れる。',
    materialCue: '固定資産台帳、使用開始日、売却日、償却方法、過年度累計額を確認する。',
    examUse: '月割り償却、減価償却累計額、帳簿価額、固定資産売却損益を順に計算する。', ...authoredDraft,
  },
  {
    conceptId: 'provisions-estimates', conceptVersion: bookkeepingConceptVersion('provisions-estimates'), label: '将来費用を条件と根拠で見積もる',
    definition: '当期以前の事象に基づく特定の将来費用・損失を、発生可能性と合理的な見積りを確かめて当期負担分として計上する。',
    purpose: '支払が先でも当期に対応する負担を把握し、根拠のない積立てを避けるため。',
    applicability: '仕様どおりの品質を保証する製品保証など、計上要件と見積り根拠を満たす場合。',
    counterexample: '来年の広告を実施したいという予定だけでは、当期の引当金にはしない。単独販売の保証サービスは別の処理を検討する。',
    misconception: 'まだ支払っていなければ費用はなく、不安な金額なら自由に引当ててよいと思う。',
    materialCue: '保証契約、対象販売数、過去の修理率と単価、直近の不具合、既存引当残高を確かめる。',
    examUse: '引当金の要件を説明し、必要期末残高と既存残高から繰入額を求める。', ...authoredDraft,
  },
];

type DraftOption = { id: string; label: string; misconception: string | null };
type CaseDraft = {
  caseId: string; conceptId: string; familyId: string; title: string; consultationTitle: string;
  context: string; consultation: string; task: string; facts: CafePrompt['facts']; assumption: string;
  options: DraftOption[]; correctOptionId: string; explanation: string; teachBack: string;
  followUp: string; checkpoints: string[]; exceptions: string[]; examTranslation: string;
};

function draftMaterial(draft: CaseDraft): CafeMaterial {
  const caseVersion = `synthetic-${draft.caseId}-v1`;
  const scoringVersion = `synthetic-${draft.caseId}-choice-v1`;
  if (draft.options.length !== 4 || new Set(draft.options.map(option => option.id)).size !== 4
    || draft.options.filter(option => option.id === draft.correctOptionId).length !== 1) {
    throw new Error('INVALID_BOOKKEEPING_CASE_DRAFT');
  }
  return {
    caseVersion, scoringVersion,
    concept: { subjectId: 'bookkeeping', conceptId: draft.conceptId, conceptVersion: bookkeepingConceptVersion(draft.conceptId) },
    prompt: () => ({
      caseId: draft.caseId, caseVersion, conceptId: draft.conceptId, familyId: draft.familyId,
      developmentOnly: true, title: draft.title, consultationTitle: draft.consultationTitle,
      context: draft.context, consultation: draft.consultation, task: draft.task,
      facts: draft.facts.map(fact => ({ ...fact })),
      assumption: `${draft.assumption} 架空の開発用原稿・専門審査待ち。正式な評価や実際の申告判断には使いません。`,
      options: draft.options.map(({ id, label }) => ({ id, label })),
    }),
    grade: (version, optionId) => {
      if (version !== caseVersion) throw new StudyError('CASE_VERSION_CONFLICT', 409);
      const selected = draft.options.find(option => option.id === optionId);
      if (!selected) throw new StudyError('INVALID_OPTION');
      const correct = selected.id === draft.correctOptionId;
      return {
        caseVersion, scoringVersion, optionId: selected.id, correct, earned: correct ? 1 : 0, max: 1,
        developmentOnly: true, evidenceQualification: 'practice_only', misconceptionCandidate: selected.misconception,
        explanation: draft.explanation, periods: [], teachBack: draft.teachBack, followUp: draft.followUp,
        checkpoints: [...draft.checkpoints],
        learningNotes: { exceptions: [...draft.exceptions], examTranslation: draft.examTranslation },
      };
    },
  };
}

/** Four original synthetic consultations, separate from the existing annual-insurance case. */
export const BOOKKEEPING_CASE_DRAFTS: CafeMaterial[] = [
  {
    caseId: 'bakery-equipment', conceptId: 'cash-is-not-profit', familyId: 'synthetic-bakery-borrow-equipment',
    title: '借入と設備購入', consultationTitle: 'パン屋の入金は、そのまま儲け？',
    context: 'パン屋の店主が、新しいオーブンの代金と銀行からの入金を同じ日の帳簿へ記録しています。',
    consultation: '銀行から60万円が入り、オーブン代48万円を払いました。差額12万円が今日の利益ですか？ まず返済義務や設備の使い始めも確認した方がいいのでしょうか。',
    task: 'この2取引による現金の増加額と利益の増加額を選び、店主に理由を説明してください。',
    facts: [
      { label: '銀行との契約', value: '借入元本600,000円。全額を本日現金で受け取り、返済義務がある。' },
      { label: 'オーブン', value: '購入・引渡し480,000円、現金で全額支払済み。継続使用する設備で、使用開始は翌月。' },
      { label: '今回の対象', value: '上の2取引のみ。売上、利息、手数料、減価償却費は今回発生しない。' },
    ],
    assumption: '設備を取得原価で資産計上する会計の練習です。消費税と税務上の少額資産の特例は扱いません。',
    options: [
      { id: 'b3k7', label: '現金＋120,000円、利益＋120,000円', misconception: '現金の差額を利益と同じものにした可能性があります。' },
      { id: 'm8t2', label: '現金＋120,000円、利益の増加0円', misconception: null },
      { id: 'q5d9', label: '現金＋600,000円、利益＋600,000円', misconception: '借入を売上として扱い、設備の支払を忘れた可能性があります。' },
      { id: 'v4n6', label: '現金＋120,000円、利益−480,000円', misconception: '設備購入の全額を購入日の費用にした可能性があります。' },
    ], correctOptionId: 'm8t2',
    explanation: '現金は600,000−480,000＝120,000円増えます。借入は現金と借入金を600,000円ずつ増やし、購入は現金480,000円を設備480,000円へ置き換えます。今回の2取引には収益・費用がないため、利益の増加は0円です。追加確認では借用書、納品書、使用開始日を照合します。',
    teachBack: '「12万円残ったこと」と「12万円儲かったこと」の違いを、2つの仕訳を使って店主へ説明してください。',
    followUp: '翌月に設備を使い始めたら、どの費用を確認すればよいですか？ 利息や設置費があった場合に必要な資料も挙げてください。',
    checkpoints: ['借入は返済義務を伴い売上ではない', '借方現金／貸方借入金、借方設備／貸方現金で各金額を一致させる', '使用開始日と付随費用を追加確認する'],
    exceptions: ['実際には使用開始後の償却、利息、取得付随費用などを別に検討する。'],
    examTranslation: '取引による資産・負債・損益の増減と、借入・固定資産取得の仕訳に接続する。',
  },
  {
    caseId: 'shop-inventory', conceptId: 'inventory-cost', familyId: 'synthetic-shop-cost-of-sales',
    title: '商品在庫と売上原価', consultationTitle: '雑貨店の売れ残りも、今年の費用？',
    context: '雑貨店の店主が、仕入帳と期末の棚卸表を見ながら今年の粗利益を確かめています。',
    consultation: '今年は40万円仕入れて、売上が70万円でした。利益は30万円ですか？ 去年からの商品と、年末に残った商品も数えたので、この資料も見てもらえますか。',
    task: '当期の売上原価と売上総利益を選び、棚卸表で追加確認したい点を説明してください。',
    facts: [
      { label: '期首商品', value: '取得原価100,000円。' },
      { label: '当期純仕入', value: '400,000円。返品、値引き、仕入付随費用を整理済み。' },
      { label: '期末商品', value: '自店所有の商品を実地確認し、取得原価120,000円と評価。減耗・評価損はない。' },
      { label: '当期純売上', value: '700,000円。返品と値引きを整理済み。' },
    ],
    assumption: '商品売買の原価配分の練習です。消費税、販管費、収益性低下、製造原価は扱いません。粗利益と最終利益を区別します。',
    options: [
      { id: 'c4p8', label: '売上原価400,000円、売上総利益300,000円', misconception: '当期仕入だけを原価にした可能性があります。' },
      { id: 'f7s3', label: '売上原価500,000円、売上総利益200,000円', misconception: '期末の未販売商品も当期の原価にした可能性があります。' },
      { id: 'n2h6', label: '売上原価380,000円、売上総利益320,000円', misconception: null },
      { id: 'w9r5', label: '売上原価620,000円、売上総利益80,000円', misconception: '期末在庫を差し引かず加えた可能性があります。' },
    ], correctOptionId: 'n2h6',
    explanation: '販売できる商品原価は100,000＋400,000＝500,000円です。未販売の120,000円を残すので、売上原価は500,000−120,000＝380,000円、売上総利益は700,000−380,000＝320,000円です。確認する資料は棚卸数量と単価、商品の所有権、期末前後の納品・返品です。販管費などを引く前の粗利益であり、最終利益ではありません。',
    teachBack: '売れ残った12万円を今年の売上原価から外す理由と、32万円が粗利益であることを店主へ説明してください。',
    followUp: '棚卸表に他店から預かった商品があったら、どの資料を追加で確認しますか？ 傷んだ商品がある場合も同じ評価でよいでしょうか。',
    checkpoints: ['期首商品＋当期純仕入−期末商品で原価を求める', '期末在庫は数量・単価・所有権を照合する', '売上総利益と最終利益を分ける'],
    exceptions: ['減耗や正味売却価額の下落、委託品、未着品があれば別の確認と処理が必要。'],
    examTranslation: '三分法の決算整理と、売上原価・期末商品・売上総利益の計算に接続する。',
  },
  {
    caseId: 'workshop-depreciation', conceptId: 'depreciation', familyId: 'synthetic-workshop-disposal-depreciation',
    title: '設備の償却と売却', consultationTitle: '工房の機械を売ったら、差額が全部損失？',
    context: '工房の店主が、前期の途中に購入した機械を当期の途中で売却し、固定資産台帳を整理しています。',
    consultation: '60万円の機械を45万円で売りました。15万円の損失ですか？ 前期にも少し償却したので、売るまでの分をどう整理すればよいか確認したいです。',
    task: '当期の減価償却費と固定資産売却損を選び、売却時の帳簿価額を説明してください。',
    facts: [
      { label: '会計期間', value: '毎期4月1日〜翌年3月31日。' },
      { label: '取得と使用開始', value: '前期10月1日、600,000円で取得し同日使用開始。' },
      { label: '会計上の償却条件', value: '定額法、耐用年数5年、残存価額0円。使用した月数で月割りする。' },
      { label: '前期末の記録', value: '前期10月〜3月の6か月分60,000円を償却済み。' },
      { label: '当期の売却', value: '当期9月30日、450,000円で売却。当期4月〜9月の6か月分を償却してから売却処理。売却費用なし。' },
    ],
    assumption: '指定した会計上の見積りと月割りによる練習です。税法上の耐用年数・償却率、消費税、減損、見積り変更は扱いません。',
    options: [
      { id: 'd8m4', label: '当期減価償却費60,000円、売却損30,000円', misconception: null },
      { id: 'j3t7', label: '当期減価償却費0円、売却損90,000円', misconception: '売却までの当期償却を省略した可能性があります。' },
      { id: 'p6b2', label: '当期減価償却費120,000円、売却損0円（売却益30,000円）', misconception: '当期の使用6か月を1年とした可能性があります。' },
      { id: 'x5q9', label: '当期減価償却費60,000円、売却損150,000円', misconception: '累計額を差し引かず取得原価と売却代金を比べた可能性があります。' },
    ], correctOptionId: 'd8m4',
    explanation: '年額は600,000÷5＝120,000円。当期の使用は6か月なので120,000×6÷12＝60,000円です。前期60,000円と合わせた累計額は120,000円、売却時の帳簿価額は600,000−120,000＝480,000円。売却代金450,000円との差30,000円が売却損です。当期償却60,000円と売却損30,000円を分けます。日付と前期累計額は台帳で確認します。',
    teachBack: '取得原価から売却代金を直接引かない理由を、前期・当期の償却と帳簿価額を使って説明してください。',
    followUp: '取得日と使い始めた日が違う場合、どの資料を確認しますか？ 売却の手数料があった場合も同じ売却損になりますか。',
    checkpoints: ['使用開始日と売却日から6か月を確かめる', '前期60,000円＋当期60,000円で累計額を求める', '帳簿価額480,000円と売却代金450,000円を比較する'],
    exceptions: ['税務の償却ルールをこの指定条件と同一視しない。減損や売却費用があれば別に検討する。'],
    examTranslation: '期中取得と期中売却における月割り償却、固定資産除却・売却仕訳に接続する。',
  },
  {
    caseId: 'repair-provision', conceptId: 'provisions-estimates', familyId: 'synthetic-product-warranty-estimate',
    title: '製品保証と将来費用', consultationTitle: '保証修理は来年払いなら、今年は費用なし？',
    context: '小型家電を販売する店の店主が、当期販売分について翌期に必要となる保証修理の資料を整理しています。',
    consultation: '来年、保証で直す商品が出そうですが、まだ支払っていません。今年の費用にする必要がありますか？ 去年までの修理実績はあるので、契約や対象台数も確かめたいです。',
    task: '条件を確認したうえで、当期末の製品保証引当金と当期の繰入費用を選んでください。',
    facts: [
      { label: '保証の契約', value: '販売時に付く1年間の品質保証のみ。合意した仕様に適合しない不具合を修理する。追加サービスはなく、保証を単独購入できない。' },
      { label: '対象販売数', value: '当期販売した1,000台。期末に保証が残り、見積り対象の修理は翌期に発生する。' },
      { label: '見積り根拠', value: '同種製品の継続した実績から対象全体の修理費用発生の可能性は高い。合理的な予測は修理率3％、1台あたり費用2,000円。品質や単価の変化はない。' },
      { label: '既存の残高', value: '製品保証引当金0円。当期に対象分の修理費用・引当金繰入は計上していない。' },
    ],
    assumption: '対象全体の合理的な見積りを指定した会計の練習です。消費税、税務上の損金算入、保証サービスの売上配分は扱いません。',
    options: [
      { id: 'a7h3', label: '引当金0円、繰入費用0円', misconception: '将来払いという理由だけで当期の負担を除いた可能性があります。' },
      { id: 'g2n8', label: '引当金2,000,000円、繰入費用2,000,000円', misconception: '対象の全台が修理されると見積もった可能性があります。' },
      { id: 'k9s4', label: '引当金30,000円、繰入費用30,000円', misconception: '修理見込台数と費用単価を結び付けていない可能性があります。' },
      { id: 'r6v5', label: '引当金60,000円、繰入費用60,000円', misconception: null },
    ], correctOptionId: 'r6v5',
    explanation: '対象の当期販売に基づく将来保証費用で、対象全体の発生可能性が高く、実績から合理的に見積もれるという条件を確認します。1,000台×3％＝30台、30台×2,000円＝60,000円。期末に必要な引当金は60,000円で、既存残高0円との差60,000円を当期の繰入費用とします。販売記録、保証内容、修理実績、最新の品質情報を追加確認し、条件が崩れれば見積りを見直します。',
    teachBack: 'まだ払っていない6万円を今年の費用にする根拠と、自由な積立てとは違うことを店主へ説明してください。',
    followUp: '今年の製品で不具合が急増したら、3％のままでよいですか？ 有料の延長保証だった場合、最初にどの契約条件を確認しますか。',
    checkpoints: ['当期販売に起因する将来の特定費用であることを確認する', '対象全体の発生可能性と修理率・単価の根拠を確認する', '期末必要額60,000円から既存残高0円を差し引く'],
    exceptions: ['単独購入できる保証や追加サービスを含む保証では、別の履行義務と取引価格配分を検討する。', '過去の率だけで決めず、対象製品・品質・費用単価の変化を確認する。'],
    examTranslation: '引当金の計上要件、製品保証引当金の見積り、既存残高との差額による繰入仕訳に接続する。',
  },
].map(draftMaterial);
