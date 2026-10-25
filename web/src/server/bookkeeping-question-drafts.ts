import { createHash } from 'node:crypto';
import { BOOKKEEPING_SYLLABUS_LESSONS, syllabusConceptId, syllabusConceptVersion } from './bookkeeping-syllabus';
import type { DiagnosticQuestion } from '../domain/diagnostic-session';
import { StudyError } from '../domain/types';
export const BOOKKEEPING_DRAFT_VERSION = 'synthetic-bookkeeping-core-v1';
export const bookkeepingConceptVersion = (id: string) => id.startsWith('syllabus-') ? syllabusConceptVersion(id) : id === 'prepaid-expenses' ? 'synthetic-cafe-prepaid-v2' : BOOKKEEPING_DRAFT_VERSION;
export type BookkeepingDraftUse = 'practice' | 'diagnostic' | 'evaluation' | 'retention' | 'mini_a' | 'mini_b';
type Seed = { conceptId: string; family: string; prompt: string; answer: string; wrong: string[]; explanation: string; n: number; purpose?: BookkeepingDraftUse };
export type BookkeepingDraftQuestion = { question: DiagnosticQuestion; explanation: string; qualification: 'practice_only'; expertReview: 'pending'; intendedUse: BookkeepingDraftUse };
const practiceSeeds: Seed[] = [
  {
    "conceptId": "cash-is-not-profit",
    "family": "borrow",
    "prompt": "個人商店の資金調達：銀行から30万円借り入れた。利息はまだ発生していない。利益はどうなる？",
    "answer": "変わらない",
    "wrong": [
      "30万円増える",
      "30万円減る",
      "資本金が30万円増える"
    ],
    "explanation": "借入は返済義務を伴い、収益ではありません。",
    "n": 1
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "borrow",
    "prompt": "個人商店の元本返済：借入金20万円の元本を現金で返した。利益はどうなる？",
    "answer": "変わらない",
    "wrong": [
      "20万円減る",
      "20万円増える",
      "売上が20万円減る"
    ],
    "explanation": "元本返済は現金と負債の減少で、費用ではありません。",
    "n": 2
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "credit-sale",
    "prompt": "卸売店の掛販売：商品を5万円で掛販売した。代金は来月受取。売上の認識は？",
    "answer": "販売時に5万円",
    "wrong": [
      "入金時まで0円",
      "入金時に10万円",
      "借入金5万円"
    ],
    "explanation": "販売による対価の権利と現金の受取時点を区別します。原価は別に対応させます。",
    "n": 3
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "credit-sale",
    "prompt": "卸売店の債権回収：前月の掛売上8万円を回収した。当月の新しい売上は？",
    "answer": "0円",
    "wrong": [
      "8万円",
      "16万円",
      "マイナス8万円"
    ],
    "explanation": "売掛金の回収を売上として二重計上しません。",
    "n": 4
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "cash-profit-bridge",
    "prompt": "当月売上10万円、当月費用6万円、借入入金20万円。利益は？",
    "answer": "4万円",
    "wrong": [
      "24万円",
      "30万円",
      "14万円"
    ],
    "explanation": "利益は収益10万円から費用6万円を差し引きます。借入は除きます。",
    "n": 5
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "cash-profit-bridge",
    "prompt": "当月利益3万円、売掛金の増加2万円。他の差異なし。営業取引による現金増加と理由の正しい組合せは？",
    "answer": "1万円・未回収分2万円は現金になっていない",
    "wrong": [
      "3万円・利益は必ず現金増加に等しい",
      "5万円・売掛金増加分を現金へ足す",
      "2万円・売掛金だけが利益である"
    ],
    "explanation": "現金増加は3−2＝1万円。未回収の売掛金増加は、利益に含まれても現金にはまだなっていません。",
    "n": 6
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "capital-flow",
    "prompt": "個人事業主が事業に自己資金10万円を入れた。収益か？",
    "answer": "収益ではなく元入れ",
    "wrong": [
      "売上10万円",
      "雑収入10万円",
      "費用10万円"
    ],
    "explanation": "所有者との資本取引を通常の損益取引から分けます。",
    "n": 7
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "capital-flow",
    "prompt": "個人事業主が生活費として事業現金2万円を引き出した。費用か？",
    "answer": "事業の費用ではない",
    "wrong": [
      "給与費2万円",
      "雑費2万円",
      "売上控除2万円"
    ],
    "explanation": "生活費への引出しを事業費用と混同しません。",
    "n": 8
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "customer-advance",
    "prompt": "商品を引き渡す前に予約金4万円を受け取った。約束は未履行。処理は？",
    "answer": "前受金として負債を計上",
    "wrong": [
      "売上4万円",
      "利益4万円",
      "費用4万円"
    ],
    "explanation": "入金しても未履行の義務が残る場合は売上としません。",
    "n": 9
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "customer-advance",
    "prompt": "前月に受けた予約金4万円に対応する商品を当月引き渡した。売上は？",
    "answer": "当月4万円",
    "wrong": [
      "当月0円",
      "当月8万円",
      "負債4万円を追加"
    ],
    "explanation": "引渡しで履行し、前受金を売上へ振り替えます。",
    "n": 10
  },
  {
    "conceptId": "double-entry",
    "family": "asset-liability",
    "prompt": "個人商店の運転資金：現金で10万円借りた。正しい仕訳は？",
    "answer": "現金10万円／借入金10万円",
    "wrong": [
      "借入金10万円／現金10万円",
      "現金10万円／売上10万円",
      "費用10万円／借入金10万円"
    ],
    "explanation": "資産の増加は借方、負債の増加は貸方です。",
    "n": 1
  },
  {
    "conceptId": "double-entry",
    "family": "asset-liability",
    "prompt": "個人商店の元本返済：借入元本5万円を現金で返済。正しい仕訳は？",
    "answer": "借入金5万円／現金5万円",
    "wrong": [
      "現金5万円／借入金5万円",
      "支払利息5万円／現金5万円",
      "借入金5万円／売上5万円"
    ],
    "explanation": "負債減少と資産減少を対応させます。利息は別です。",
    "n": 2
  },
  {
    "conceptId": "double-entry",
    "family": "asset-exchange",
    "prompt": "パン工房の設備購入：長期使用する備品8万円を現金購入。全額を固定資産として計上する前提で、購入時の仕訳は？",
    "answer": "備品8万円／現金8万円",
    "wrong": [
      "現金8万円／備品8万円",
      "消耗品費8万円／売上8万円",
      "備品8万円／借入金8万円"
    ],
    "explanation": "長期利用する備品という前提で、資産同士の交換を記録します。",
    "n": 3
  },
  {
    "conceptId": "double-entry",
    "family": "asset-exchange",
    "prompt": "サービス店の請求回収：売掛金3万円を普通預金で回収。仕訳は？",
    "answer": "普通預金3万円／売掛金3万円",
    "wrong": [
      "普通預金3万円／売上3万円",
      "売掛金3万円／普通預金3万円",
      "現金3万円／借入金3万円"
    ],
    "explanation": "資産の形が売掛金から預金へ変わります。",
    "n": 4
  },
  {
    "conceptId": "double-entry",
    "family": "expense-liability",
    "prompt": "当月の通信費2万円が未払い。決算仕訳は？",
    "answer": "通信費2万円／未払費用2万円",
    "wrong": [
      "未払費用2万円／通信費2万円",
      "現金2万円／通信費2万円",
      "仕訳しない"
    ],
    "explanation": "当期のサービスに対応する費用と支払義務を記録します。",
    "n": 5
  },
  {
    "conceptId": "double-entry",
    "family": "expense-liability",
    "prompt": "前期計上済み未払費用2万円を預金で払った。仕訳は？",
    "answer": "未払費用2万円／普通預金2万円",
    "wrong": [
      "通信費2万円／普通預金2万円",
      "普通預金2万円／未払費用2万円",
      "売上2万円／普通預金2万円"
    ],
    "explanation": "支払時に費用を二重計上しません。",
    "n": 6
  },
  {
    "conceptId": "double-entry",
    "family": "equation",
    "prompt": "資産100万円、負債40万円。純資産は？",
    "answer": "60万円",
    "wrong": [
      "140万円",
      "40万円",
      "100万円"
    ],
    "explanation": "資産＝負債＋純資産です。",
    "n": 7
  },
  {
    "conceptId": "double-entry",
    "family": "equation",
    "prompt": "純資産60万円、負債30万円。資産は？",
    "answer": "90万円",
    "wrong": [
      "30万円",
      "60万円",
      "マイナス30万円"
    ],
    "explanation": "資産は負債と純資産の合計です。",
    "n": 8
  },
  {
    "conceptId": "double-entry",
    "family": "error-detection",
    "prompt": "貸借が一致する試算表なら、すべての仕訳が正しい？",
    "answer": "一致だけでは正しさを保証しない",
    "wrong": [
      "必ず正しい",
      "売上だけは必ず正しい",
      "漏れは必ず発見できる"
    ],
    "explanation": "取引全体の記録漏れや同額の科目誤りでも貸借は一致します。",
    "n": 9
  },
  {
    "conceptId": "double-entry",
    "family": "error-detection",
    "prompt": "現金で備品5万円を購入したが、備品5万円／売上5万円と記帳した。誤った貸方だけを訂正する仕訳と理由は？",
    "answer": "売上5万円／現金5万円・誤った売上を消し現金減少を記録",
    "wrong": [
      "現金5万円／売上5万円・元の仕訳をもう一度記録",
      "備品5万円／現金5万円・備品をさらに追加する",
      "訂正不要・貸借が一致すれば正しい"
    ],
    "explanation": "元の備品計上は残し、売上5万円を借方で取り消し、現金5万円を貸方で減らします。貸借一致と取引事実の正しさは別です。",
    "n": 10
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "annual-months",
    "prompt": "カフェの店舗保険：12月1日から1年間の保険料12万円を支払。3月31日決算。月割りの当期費用は？",
    "answer": "4万円",
    "wrong": [
      "12万円",
      "8万円",
      "0円"
    ],
    "explanation": "当期12〜3月の4か月。12万円÷12×4＝4万円です。",
    "n": 1
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "annual-months",
    "prompt": "カフェの店舗保険：10月1日から1年間の保険料24万円を支払。3月31日決算。月割りの前払額は？",
    "answer": "12万円",
    "wrong": [
      "24万円",
      "6万円",
      "0円"
    ],
    "explanation": "翌期4〜9月の6か月。24万円÷12×6＝12万円です。",
    "n": 2
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "adjust-expense",
    "prompt": "整備工場の契約保険：年額12万円全額を保険料に記帳。当期費用4万円。決算仕訳は？",
    "answer": "前払費用8万円／保険料8万円",
    "wrong": [
      "保険料8万円／前払費用8万円",
      "現金8万円／保険料8万円",
      "前払費用4万円／現金4万円"
    ],
    "explanation": "翌期対応8万円を費用から資産へ振り替えます。",
    "n": 3
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "adjust-expense",
    "prompt": "整備工場の契約保険：年額18万円全額を保険料に記帳。当期費用6万円。費用から除く額は？",
    "answer": "12万円",
    "wrong": [
      "18万円",
      "6万円",
      "0円"
    ],
    "explanation": "支払18万円のうち未使用12万円を資産へ残します。",
    "n": 4
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "asset-first",
    "prompt": "年額12万円全額を前払費用に記帳。当期4か月分の決算仕訳は？",
    "answer": "保険料4万円／前払費用4万円",
    "wrong": [
      "前払費用4万円／保険料4万円",
      "保険料8万円／現金8万円",
      "仕訳しない"
    ],
    "explanation": "資産から使用済み4か月分を費用へ振り替えます。",
    "n": 5
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "asset-first",
    "prompt": "9万円全額を前払費用に記帳し当期に3万円分を使用した。決算仕訳と期末残高の組合せは？",
    "answer": "費用3万円／前払費用3万円・残高6万円",
    "wrong": [
      "前払費用3万円／費用3万円・残高12万円",
      "費用6万円／前払費用6万円・残高3万円",
      "仕訳しない・残高9万円"
    ],
    "explanation": "当期利用分3万円を資産から費用へ移し、9−3＝6万円を翌期分として残します。",
    "n": 6
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "period-boundary",
    "prompt": "4月1日から翌3月31日の保険12万円。3月31日決算。未使用分は？",
    "answer": "0円",
    "wrong": [
      "12万円",
      "1万円",
      "11万円"
    ],
    "explanation": "すべて当期にサービスを受けたため期末前払額はありません。",
    "n": 7
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "period-boundary",
    "prompt": "翌4月開始の1年契約を3月に12万円支払。3月末の当期費用は？",
    "answer": "0円",
    "wrong": [
      "12万円",
      "1万円",
      "11万円"
    ],
    "explanation": "サービス開始前の支払で当期分はありません。",
    "n": 8
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "exception-scope",
    "prompt": "会計の月割問題で、短期前払費用の税務特例を自動適用してよい？",
    "answer": "問題条件の会計処理に従う",
    "wrong": [
      "必ず全額費用",
      "必ず全額資産",
      "税務特例が会計に優先する"
    ],
    "explanation": "税務特例と会計上の期間対応を分け、設問の前提を読みます。",
    "n": 9
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "exception-scope",
    "prompt": "保険の支払日だけ分かった。前払費用を確定できる？",
    "answer": "契約期間と決算日の確認が必要",
    "wrong": [
      "常に全額前払",
      "常に全額当期費用",
      "支払日で月数が確定する"
    ],
    "explanation": "費用の期間対応にはサービス期間と期末が必要です。",
    "n": 10
  },
  {
    "conceptId": "inventory-cost",
    "family": "cost-of-sales",
    "prompt": "雑貨店の商品販売：期首商品20万円、当期仕入80万円、期末商品30万円。売上原価は？",
    "answer": "70万円",
    "wrong": [
      "100万円",
      "130万円",
      "50万円"
    ],
    "explanation": "期首20＋仕入80−期末30＝70万円。評価損等はない前提です。",
    "n": 1
  },
  {
    "conceptId": "inventory-cost",
    "family": "cost-of-sales",
    "prompt": "雑貨店の商品販売：期首商品0円、仕入50万円、期末商品10万円。売上原価は？",
    "answer": "40万円",
    "wrong": [
      "50万円",
      "60万円",
      "10万円"
    ],
    "explanation": "未販売分10万円を仕入から除きます。",
    "n": 2
  },
  {
    "conceptId": "inventory-cost",
    "family": "gross-profit",
    "prompt": "売上100万円、売上原価70万円。売上総利益は？",
    "answer": "30万円",
    "wrong": [
      "170万円",
      "70万円",
      "100万円"
    ],
    "explanation": "売上から対応する売上原価を差し引きます。",
    "n": 3
  },
  {
    "conceptId": "inventory-cost",
    "family": "gross-profit",
    "prompt": "売上60万円、売上原価45万円、販売費5万円。売上総利益と販売費の扱いの組合せは？",
    "answer": "15万円・販売費は売上総利益からは控除しない",
    "wrong": [
      "10万円・販売費も売上原価に含める",
      "20万円・販売費を利益へ加算する",
      "45万円・売上原価がそのまま利益になる"
    ],
    "explanation": "売上総利益は60−45＝15万円。販売費を控除した10万円とは区別します。",
    "n": 4
  },
  {
    "conceptId": "inventory-cost",
    "family": "ownership-cutoff",
    "prompt": "卸売会社の外部保管：自社所有の商品を外部倉庫に保管。期末在庫へ含める？",
    "answer": "含める",
    "wrong": [
      "所在が社外なので除く",
      "販売済みとする",
      "倉庫代だけ含める"
    ],
    "explanation": "場所だけでなく所有・取引条件を確認します。",
    "n": 5
  },
  {
    "conceptId": "inventory-cost",
    "family": "ownership-cutoff",
    "prompt": "卸売会社の委託販売：他社から預かった委託販売商品。未販売。自社の在庫か？",
    "answer": "自社在庫には含めない",
    "wrong": [
      "必ず含める",
      "半額だけ含める",
      "現金とする"
    ],
    "explanation": "他社所有の商品を自社の資産へ混ぜません。",
    "n": 6
  },
  {
    "conceptId": "inventory-cost",
    "family": "valuation",
    "prompt": "棚卸資産の取得原価10万円、正味売却価額8万円。通常販売目的で収益性低下。評価額は？",
    "answer": "8万円",
    "wrong": [
      "10万円",
      "18万円",
      "2万円"
    ],
    "explanation": "収益性低下の前提で帳簿価額を正味売却価額まで切り下げます。",
    "n": 7
  },
  {
    "conceptId": "inventory-cost",
    "family": "valuation",
    "prompt": "取得原価10万円、正味売却価額12万円。通常販売目的の評価額は？",
    "answer": "10万円",
    "wrong": [
      "12万円",
      "22万円",
      "2万円"
    ],
    "explanation": "原価より高い正味売却価額へ通常は評価益を計上しません。",
    "n": 8
  },
  {
    "conceptId": "inventory-cost",
    "family": "purchase-scope",
    "prompt": "商品代10万円、購入運賃1万円。取得原価に含める前提なら合計は？",
    "answer": "11万円",
    "wrong": [
      "10万円",
      "9万円",
      "1万円"
    ],
    "explanation": "購入に直接要した付随費用を取得原価へ含める条件です。",
    "n": 9
  },
  {
    "conceptId": "inventory-cost",
    "family": "purchase-scope",
    "prompt": "販売後の顧客への配送費1万円。商品取得原価へ含める？",
    "answer": "販売費として区別する",
    "wrong": [
      "必ず在庫に加算",
      "仕入値引とする",
      "利益に直接加算"
    ],
    "explanation": "取得のための費用と販売のための費用を区別します。",
    "n": 10
  },
  {
    "conceptId": "depreciation",
    "family": "straight-line",
    "prompt": "製造工房の設備：取得原価60万円、残存価額0円、耐用年数5年。定額法の年額は？",
    "answer": "12万円",
    "wrong": [
      "60万円",
      "5万円",
      "30万円"
    ],
    "explanation": "償却対象60万円を5年へ配分します。",
    "n": 1
  },
  {
    "conceptId": "depreciation",
    "family": "straight-line",
    "prompt": "製造工房の設備：取得原価100万円、残存価額10万円、耐用年数5年。定額法の年額は？",
    "answer": "18万円",
    "wrong": [
      "20万円",
      "22万円",
      "10万円"
    ],
    "explanation": "償却対象額は100−10＝90万円です。",
    "n": 2
  },
  {
    "conceptId": "depreciation",
    "family": "partial-year",
    "prompt": "クリーニング店の新規設備：年額12万円、10月1日使用開始、3月31日決算。月割償却額は？",
    "answer": "6万円",
    "wrong": [
      "12万円",
      "3万円",
      "0円"
    ],
    "explanation": "10〜3月の6か月、12万円×6/12です。",
    "n": 3
  },
  {
    "conceptId": "depreciation",
    "family": "partial-year",
    "prompt": "クリーニング店の新規設備：年額24万円、1月1日使用開始、3月31日決算。月割償却額は？",
    "answer": "6万円",
    "wrong": [
      "24万円",
      "18万円",
      "3万円"
    ],
    "explanation": "1〜3月の3か月を配分します。",
    "n": 4
  },
  {
    "conceptId": "depreciation",
    "family": "accumulated",
    "prompt": "備品原価60万円、減価償却累計額24万円。帳簿価額は？",
    "answer": "36万円",
    "wrong": [
      "60万円",
      "84万円",
      "24万円"
    ],
    "explanation": "原価から累計額を差し引きます。",
    "n": 5
  },
  {
    "conceptId": "depreciation",
    "family": "accumulated",
    "prompt": "備品原価80万円、期首累計額30万円、当期償却10万円。期末帳簿価額は？",
    "answer": "40万円",
    "wrong": [
      "50万円",
      "70万円",
      "120万円"
    ],
    "explanation": "期末累計額40万円を原価80万円から差し引きます。",
    "n": 6
  },
  {
    "conceptId": "depreciation",
    "family": "noncash-cost",
    "prompt": "減価償却費を計上する時、必ず同額の現金支出がある？",
    "answer": "現金支出を伴わない費用計上",
    "wrong": [
      "必ずある",
      "借入入金がある",
      "売上入金がある"
    ],
    "explanation": "取得時の支出と利用期間への費用配分は別です。",
    "n": 7
  },
  {
    "conceptId": "depreciation",
    "family": "noncash-cost",
    "prompt": "土地を通常の定額法で毎年償却する？",
    "answer": "通常は減価償却しない",
    "wrong": [
      "必ず5年で償却",
      "必ず1年で償却",
      "現金残高で償却する"
    ],
    "explanation": "通常の土地は時間経過による減価償却対象資産と区別します。",
    "n": 8
  },
  {
    "conceptId": "depreciation",
    "family": "journal",
    "prompt": "間接法で償却費3万円を計上。仕訳は？",
    "answer": "減価償却費3万円／減価償却累計額3万円",
    "wrong": [
      "備品3万円／現金3万円",
      "累計額3万円／減価償却費3万円",
      "現金3万円／減価償却費3万円"
    ],
    "explanation": "間接法は原価を残し、累計額を貸方へ計上します。",
    "n": 9
  },
  {
    "conceptId": "depreciation",
    "family": "journal",
    "prompt": "期末までの減価償却計上後の帳簿価額20万円の備品を18万円で売却。差額とその理由は？",
    "answer": "売却損2万円・対価が帳簿価額を下回る",
    "wrong": [
      "売却益2万円・帳簿価額が対価を上回る",
      "償却費18万円・売却額をそのまま配分する",
      "売上総利益20万円・備品売却は商品販売である"
    ],
    "explanation": "売却時の帳簿価額20万円と対価18万円を比較し、18−20＝−2万円を売却損とします。",
    "n": 10
  },
  {
    "conceptId": "provisions-estimates",
    "family": "recognition",
    "prompt": "修理店の販売保証：当期販売の保証義務。将来修理費発生の可能性が高く合理的に見積可能。どう考える？",
    "answer": "当期負担の見積額を引当計上",
    "wrong": [
      "支払うまで何も記録しない",
      "売上へ加算",
      "現金を直ちに減らす"
    ],
    "explanation": "当期以前の事象による将来費用で、条件を満たす場合の引当です。",
    "n": 1
  },
  {
    "conceptId": "provisions-estimates",
    "family": "recognition",
    "prompt": "修理店の広告計画：来期の広告キャンペーンを社内で予定しただけ。現在の義務なし。引当金は？",
    "answer": "予定だけでは計上しない",
    "wrong": [
      "予算全額を計上",
      "半額を計上",
      "売上として計上"
    ],
    "explanation": "単なる将来支出計画を当期の引当金にしません。",
    "n": 2
  },
  {
    "conceptId": "provisions-estimates",
    "family": "warranty-rate",
    "prompt": "家電販売店の製品保証：当期保証対象売上100万円、合理的見積率2%。期首引当なし。見積額は？",
    "answer": "2万円",
    "wrong": [
      "100万円",
      "20万円",
      "0円"
    ],
    "explanation": "100万円×2%＝2万円。2%は架空の設問条件で、実務の率や専門確認済みの率を意味しません。",
    "n": 3
  },
  {
    "conceptId": "provisions-estimates",
    "family": "warranty-rate",
    "prompt": "家電販売店の製品保証：当期保証対象売上200万円、合理的見積率3%。期首引当なし。見積額は？",
    "answer": "6万円",
    "wrong": [
      "3万円",
      "60万円",
      "200万円"
    ],
    "explanation": "売上200万円×3%＝6万円です。",
    "n": 4
  },
  {
    "conceptId": "provisions-estimates",
    "family": "balance-adjust",
    "prompt": "必要な期末引当金5万円、修正前残高2万円。追加繰入額は？",
    "answer": "3万円",
    "wrong": [
      "5万円",
      "7万円",
      "2万円"
    ],
    "explanation": "目標残高5万円まで不足3万円を繰り入れます。",
    "n": 5
  },
  {
    "conceptId": "provisions-estimates",
    "family": "balance-adjust",
    "prompt": "必要な期末引当金4万円、修正前残高6万円。差額調整は？",
    "answer": "2万円を戻し入れる",
    "wrong": [
      "4万円を繰り入れる",
      "10万円を繰り入れる",
      "6万円を戻し入れる"
    ],
    "explanation": "過大残高2万円を減らすという前提です。",
    "n": 6
  },
  {
    "conceptId": "provisions-estimates",
    "family": "use-provision",
    "prompt": "保証修理に1万円支払い、既存引当金の対象に一致。処理は？",
    "answer": "引当金1万円／現金1万円",
    "wrong": [
      "修理費1万円／引当金1万円",
      "現金1万円／売上1万円",
      "引当金を増やす"
    ],
    "explanation": "計上済み引当金を使用し、費用の二重計上を避けます。",
    "n": 7
  },
  {
    "conceptId": "provisions-estimates",
    "family": "use-provision",
    "prompt": "保証引当金6万円から対象修理費5万円を支払い、期末必要額を4万円と再見積もりした。追加繰入額と理由は？",
    "answer": "3万円・支払後残高1万円を必要額4万円へ補う",
    "wrong": [
      "4万円・支払後残高を無視する",
      "1万円・支払後残高だけを費用にする",
      "2万円を戻入・支払前残高6万円と比較する"
    ],
    "explanation": "対象修理支払後は6−5＝1万円。必要額4万円との差3万円を繰り入れます。新情報の再見積りと実際支払を別々に記録します。",
    "n": 8
  },
  {
    "conceptId": "provisions-estimates",
    "family": "specific-versus-estimate",
    "prompt": "受領済み請求書で当期サービス代2万円が確定、未払い。通常の区分は？",
    "answer": "未払費用などの確定債務",
    "wrong": [
      "必ず保証引当金",
      "前払費用",
      "売上"
    ],
    "explanation": "確定支払義務と将来費用の見積りを区別します。",
    "n": 9
  },
  {
    "conceptId": "provisions-estimates",
    "family": "specific-versus-estimate",
    "prompt": "保証対象販売をしておらず、発生根拠もない。念のため引当してよい？",
    "answer": "根拠なく任意に計上しない",
    "wrong": [
      "利益が多ければよい",
      "毎年同額ならよい",
      "現金が多ければよい"
    ],
    "explanation": "引当計上の条件・根拠・見積りを確認します。",
    "n": 10
  }
];
const independentSeeds: Seed[] = [
  {
    "conceptId": "cash-is-not-profit",
    "family": "explain",
    "prompt": "借入と売上を区別する根拠は？",
    "answer": "返済義務か販売対価か",
    "wrong": [
      "入金額の大小",
      "銀行名",
      "現金の色"
    ],
    "explanation": "取引の性質で判断します。",
    "n": 1,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "reverse",
    "prompt": "現金は増えたが利益は変わらない取引は？",
    "answer": "借入金の受取",
    "wrong": [
      "商品販売の利益",
      "受取利息",
      "役務売上"
    ],
    "explanation": "負債も同時に増加します。",
    "n": 2,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "transfer",
    "prompt": "売上債権が発生し現金受取前。利益と現金は一致する？",
    "answer": "通常は一致しない",
    "wrong": [
      "必ず一致",
      "利益は常に0",
      "現金は必ず負になる"
    ],
    "explanation": "収益認識と入金時期の差です。",
    "n": 3,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "cash-accrual-reconciliation",
    "prompt": "営業取引の現金収入12万円・現金支出7万円。当期の未収売上2万円と未払費用1万円が発生。期首債権債務0、他の差異なし。当期利益は？",
    "answer": "6万円",
    "wrong": [
      "5万円",
      "8万円",
      "4万円"
    ],
    "explanation": "当期収益12＋2＝14万円、当期費用7＋1＝8万円。利益は6万円で、現金増加5万円とは異なります。",
    "n": 4,
    "purpose": "evaluation"
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "retain-7-day",
    "prompt": "7日後確認：取引後、現金が4万円増えたが、当期利益は6万円増えた。借入・元本返済・他の資産負債の増減なし。差を説明する売上債権の変化は？",
    "answer": "売上債権が2万円増加",
    "wrong": [
      "売上債権が2万円減少",
      "売上債権が10万円増加",
      "利益の記帳が必ず不正"
    ],
    "explanation": "利益6万円のうち現金化した額は4万円なので、未回収の売上債権が2万円増えたと考えます。",
    "n": 5,
    "purpose": "retention"
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "before-funding-classification",
    "prompt": "当月、銀行借入5万円と、提供済みサービスの未収対価20万円が発生した。借入を売上に含める案と未収を売上から除く案を退ける根拠は？",
    "answer": "借入は返済義務、未収対価は当月の履行済み収益",
    "wrong": [
      "どちらも入金していないので売上0円",
      "借入5万円だけが入金したので売上5万円",
      "未収対価20万円は翌月に履行する義務"
    ],
    "explanation": "借入は資金調達による負債。提供済みサービスは当月の収益で、未収という回収状態とは区別します。",
    "n": 6,
    "purpose": "mini_a"
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "after-profit-reconciliation",
    "prompt": "帳簿の当月利益10万円には、来月提供するサービスの予約金4万円を売上とした誤りと、計上済み売掛金の回収2万円を再度売上とした誤りがある。他は正しい。訂正後利益は？",
    "answer": "4万円",
    "wrong": [
      "10万円",
      "6万円",
      "8万円"
    ],
    "explanation": "未履行予約金4万円と二重売上2万円を取り消し、10−4−2＝4万円。現金受取だけでは当月の収益を決めません。",
    "n": 7,
    "purpose": "mini_b"
  },
  {
    "conceptId": "double-entry",
    "family": "explain",
    "prompt": "複式簿記で借方・貸方とは？",
    "answer": "帳簿の左右の区分",
    "wrong": [
      "善悪の区分",
      "現金の有無",
      "税金の種類"
    ],
    "explanation": "勘定種類と増減に応じて左右を使います。",
    "n": 1,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "double-entry",
    "family": "reverse",
    "prompt": "貸方に借入金が増えたとき、借方に現金が増える取引は？",
    "answer": "現金借入",
    "wrong": [
      "借入返済",
      "現金売上",
      "備品売却"
    ],
    "explanation": "資産と負債が増加します。",
    "n": 2,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "double-entry",
    "family": "transfer",
    "prompt": "備品を後払い購入する仕訳は？",
    "answer": "備品／未払金",
    "wrong": [
      "現金／備品",
      "費用／売上",
      "借入金／備品"
    ],
    "explanation": "資産と確定債務を計上します。",
    "n": 3,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "double-entry",
    "family": "omitted-accrual-audit",
    "prompt": "当期通信費2万円の未払計上が漏れているが、試算表の貸借は一致している。訂正で利益・負債はどう変わる？",
    "answer": "利益2万円減・負債2万円増",
    "wrong": [
      "利益変化なし・負債変化なし",
      "利益2万円増・負債2万円減",
      "利益2万円減・資産2万円減"
    ],
    "explanation": "通信費2万円／未払費用2万円を追加します。貸借が一致していても取引全体の記録漏れはあり得ます。",
    "n": 4,
    "purpose": "evaluation"
  },
  {
    "conceptId": "double-entry",
    "family": "retain-7-day",
    "prompt": "7日後確認：現金は2万円減少、借入金は5万円減少、他の負債と純資産は変化なし。他の資産を売掛金だけとしたとき、その増減は？",
    "answer": "売掛金が3万円減少",
    "wrong": [
      "売掛金が3万円増加",
      "売掛金が7万円減少",
      "売掛金は変化なし"
    ],
    "explanation": "資産合計は負債と同額5万円減少。現金2万円減少との差3万円は売掛金減少です。",
    "n": 5,
    "purpose": "retention"
  },
  {
    "conceptId": "double-entry",
    "family": "before-compound-journal",
    "prompt": "備品9万円を購入し現金4万円を払い、残額は翌月払い。全額固定資産計上の前提で正しい複合仕訳は？",
    "answer": "備品9万円／現金4万円・未払金5万円",
    "wrong": [
      "備品9万円／現金9万円",
      "備品4万円・未払金5万円／現金9万円",
      "現金4万円・未払金5万円／備品9万円"
    ],
    "explanation": "備品9万円の取得を借方へ、実際の現金減少4万円と未払義務5万円を貸方へ。左右とも9万円で一致します。",
    "n": 6,
    "purpose": "mini_a"
  },
  {
    "conceptId": "double-entry",
    "family": "after-journal-to-statements",
    "prompt": "掛でサービス売上6万円を計上し、そのうち2万円を普通預金で回収した。他の取引なし。この2取引後の資産増加と利益増加は？",
    "answer": "資産6万円・利益6万円",
    "wrong": [
      "資産8万円・利益8万円",
      "資産2万円・利益2万円",
      "資産4万円・利益6万円"
    ],
    "explanation": "売掛金は6−2＝4万円、預金は2万円増え、資産増加は6万円。回収を売上として二重計上しないので利益増加も6万円です。",
    "n": 7,
    "purpose": "mini_b"
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "explain",
    "prompt": "先払額を期間配分する主な理由は？",
    "answer": "便益を受けた期へ費用を対応",
    "wrong": [
      "現金を多く見せる",
      "税金を必ず減らす",
      "支払額を倍にする"
    ],
    "explanation": "期間の成果に対応させます。",
    "n": 1,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "reverse",
    "prompt": "前払費用が期末に残ることは何を示す？",
    "answer": "未使用の将来便益がある",
    "wrong": [
      "現金未払い",
      "当期損失確定",
      "収益受取済み"
    ],
    "explanation": "支払済みで未使用のサービスです。",
    "n": 2,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "transfer",
    "prompt": "4月末に今月分家賃のみ支払。今月に全額利用。前払額は？",
    "answer": "0円",
    "wrong": [
      "全額",
      "半額",
      "支払額の2倍"
    ],
    "explanation": "未使用期間がありません。",
    "n": 3,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "reverse-contract-value",
    "prompt": "均等月割りの1年保険契約。決算まで4か月分のサービスを利用し当期費用は6万円、全額支払済み。他の保険なし。契約年額と期末前払額は？",
    "answer": "年額18万円・前払12万円",
    "wrong": [
      "年額6万円・前払0円",
      "年額24万円・前払18万円",
      "年額12万円・前払6万円"
    ],
    "explanation": "月額6÷4＝1.5万円、年額1.5×12＝18万円。未使用8か月分1.5×8＝12万円です。",
    "n": 4,
    "purpose": "evaluation"
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "retain-7-day",
    "prompt": "7日後確認：前期末前払費用8万円を当期に全額利用。帳簿で当期費用8万円／現金8万円と誤記したが、実際の当期支払はない。費用計上を残して訂正する仕訳は？",
    "answer": "現金8万円／前払費用8万円",
    "wrong": [
      "費用8万円／前払費用8万円",
      "前払費用8万円／現金8万円",
      "現金8万円／費用8万円"
    ],
    "explanation": "費用計上は正しいので残します。誤って減らした現金を戻し、利用済み前払費用を減らします。",
    "n": 5,
    "purpose": "retention"
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "before-two-contracts",
    "prompt": "3月31日決算。年額12万円の保険は前年7月1日開始、年額24万円の保守契約は当年1月1日開始。ともに1年間、均等月割り、全額支払済み。2契約合計の期末前払額は？",
    "answer": "21万円",
    "wrong": [
      "15万円",
      "36万円",
      "9万円"
    ],
    "explanation": "保険の翌期4〜6月は12÷12×3＝3万円。保守の翌期4〜12月は24÷12×9＝18万円。前払額合計は21万円です。",
    "n": 6,
    "purpose": "mini_a"
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "after-misstated-statements",
    "prompt": "1月1日から1年間の保険料36万円を全額費用とした。3月31日決算、均等月割り。訂正前利益10万円・資産50万円。他の誤りなし。訂正後の利益・資産は？",
    "answer": "利益37万円・資産77万円",
    "wrong": [
      "利益19万円・資産59万円",
      "利益−17万円・資産23万円",
      "利益10万円・資産50万円"
    ],
    "explanation": "未使用の翌期9か月分36÷12×9＝27万円を前払費用へ。費用が27万円減り利益は37万円、資産は27万円増えて77万円です。",
    "n": 7,
    "purpose": "mini_b"
  },
  {
    "conceptId": "inventory-cost",
    "family": "explain",
    "prompt": "未販売の商品原価を期末資産へ残す理由は？",
    "answer": "未販売分の原価を将来の販売時まで資産に残す",
    "wrong": [
      "現金受取前だから",
      "税率が高いから",
      "売上を増やすため"
    ],
    "explanation": "販売済み分と未販売分を区別します。",
    "n": 1,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "inventory-cost",
    "family": "reverse",
    "prompt": "仕入合計より売上原価が少ない原因になり得るのは？",
    "answer": "未販売在庫が増加",
    "wrong": [
      "在庫が減少だけ",
      "借入増加",
      "資本金増加"
    ],
    "explanation": "期末に残った原価を費用から除きます。",
    "n": 2,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "inventory-cost",
    "family": "transfer",
    "prompt": "期末棚卸で他社所有の預り品を発見。対応は？",
    "answer": "自社在庫から除く",
    "wrong": [
      "自社資産に含める",
      "売上に含める",
      "現金に含める"
    ],
    "explanation": "所有・取引条件を確認します。",
    "n": 3,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "inventory-cost",
    "family": "sales-cutoff-cost",
    "prompt": "商品原価6万円・売価10万円で当期末に出荷。引渡しは翌期で、契約上引渡しまで自社所有、履行による売上認識も引渡し時点とする。当期売上と期末在庫原価は？",
    "answer": "当期売上0円・在庫6万円",
    "wrong": [
      "当期売上10万円・在庫0円",
      "当期売上0円・在庫0円",
      "当期売上6万円・在庫10万円"
    ],
    "explanation": "出荷日だけで売上や原価を確定しません。指定条件では当期末は自社所有の未販売商品なので原価6万円を資産に残します。",
    "n": 4,
    "purpose": "evaluation"
  },
  {
    "conceptId": "inventory-cost",
    "family": "retain-7-day",
    "prompt": "7日後確認：期末在庫10万円を翌期に全て販売した。翌期に新規仕入なし、評価損・減耗なし。前年の支払済み仕入だから翌期売上原価を0円にする案は正しい？",
    "answer": "誤り・翌期に販売した原価10万円を費用にする",
    "wrong": [
      "正しい・支払は前年だから翌期原価0円",
      "誤り・前年と翌年で10万円ずつ費用にする",
      "正しい・在庫は永久に資産に残す"
    ],
    "explanation": "支払日ではなく販売との対応で費用化します。期首10＋仕入0−期末0＝翌期原価10万円です。",
    "n": 5,
    "purpose": "retention"
  },
  {
    "conceptId": "inventory-cost",
    "family": "before-ownership-reconciliation",
    "prompt": "倉庫の棚卸表の原価合計25万円には他社所有の預り品4万円が混入し、自社所有の外部倉庫の商品7万円が漏れている。評価損等なし。訂正後の自社期末在庫は？",
    "answer": "28万円",
    "wrong": [
      "25万円",
      "32万円",
      "14万円"
    ],
    "explanation": "預り品4万円を除き、自社所有の外部保管商品7万円を加え、25−4＋7＝28万円。保管場所だけでは判断しません。",
    "n": 6,
    "purpose": "mini_a"
  },
  {
    "conceptId": "inventory-cost",
    "family": "after-reverse-purchases",
    "prompt": "期首在庫15万円、期末在庫25万円、売上90万円、売上総利益25万円。評価損・減耗・付随費用なし。当期の返品等控除後の純仕入額は？",
    "answer": "75万円",
    "wrong": [
      "65万円",
      "55万円",
      "100万円"
    ],
    "explanation": "売上原価は90−25＝65万円。65＝期首15＋純仕入−期末25から、純仕入65−15＋25＝75万円です。",
    "n": 7,
    "purpose": "mini_b"
  },
  {
    "conceptId": "depreciation",
    "family": "explain",
    "prompt": "減価償却の目的として適切なのは？",
    "answer": "取得原価を利用期間へ費用配分",
    "wrong": [
      "時価を毎日測る",
      "返済額を記録",
      "売上を増やす"
    ],
    "explanation": "取得時点と利用期間の費用を分けます。",
    "n": 1,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "depreciation",
    "family": "reverse",
    "prompt": "原価から累計償却額を引いた数値は？",
    "answer": "帳簿価額",
    "wrong": [
      "時価の保証",
      "現金残高",
      "売上高"
    ],
    "explanation": "帳簿価額と時価を同一視しません。",
    "n": 2,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "depreciation",
    "family": "transfer",
    "prompt": "同じ年額でも期中使用開始で当期額が少なくなる理由は？",
    "answer": "当期使用月数が少ない",
    "wrong": [
      "現金が不足",
      "売上が低い",
      "借入が増えた"
    ],
    "explanation": "月割という問題前提によります。",
    "n": 3,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "depreciation",
    "family": "reverse-useful-life",
    "prompt": "固定資産原価100万円、残存10万円、定額法。1年間を通じて使用した年の償却費は18万円。耐用年数と1年目末の帳簿価額は？",
    "answer": "耐用年数5年・帳簿価額82万円",
    "wrong": [
      "耐用年数5年・帳簿価額72万円",
      "耐用年数6年・帳簿価額82万円",
      "耐用年数5年・帳簿価額18万円"
    ],
    "explanation": "償却対象100−10＝90万円を年額18万円で配分するので5年。1年目末の帳簿価額は原価100−償却18＝82万円です。",
    "n": 4,
    "purpose": "evaluation"
  },
  {
    "conceptId": "depreciation",
    "family": "retain-7-day",
    "prompt": "7日後確認：備品取得時に全額固定資産計上。当期の月割償却費を6万円計上し忘れた。現金取引は全て正しい。訂正が利益・資産・現金に与える影響は？",
    "answer": "利益6万円減・資産6万円減・現金変化なし",
    "wrong": [
      "利益6万円減・資産変化なし・現金6万円減",
      "利益6万円増・資産6万円増・現金変化なし",
      "利益変化なし・資産6万円減・現金6万円減"
    ],
    "explanation": "未計上の償却費を費用化すると利益が6万円減り、帳簿価額も6万円減ります。償却仕訳で現金は動きません。",
    "n": 5,
    "purpose": "retention"
  },
  {
    "conceptId": "depreciation",
    "family": "before-availability-timing",
    "prompt": "備品72万円を4月に購入し、7月1日に使用開始した。3月31日決算、残存0円、6年定額法、使用開始月から月割り。取得代金は支払済み。他の費用なし。当期の償却費は？",
    "answer": "9万円",
    "wrong": [
      "12万円",
      "72万円",
      "3万円"
    ],
    "explanation": "年額72÷6＝12万円。使用開始7月〜3月の9か月分は12×9/12＝9万円。購入・支払時点と利用開始時点を区別します。",
    "n": 6,
    "purpose": "mini_a"
  },
  {
    "conceptId": "depreciation",
    "family": "after-disposal-with-current-charge",
    "prompt": "備品原価90万円、期首累計償却36万円。当期の売却日までの未記帳償却費6万円を先に計上し、50万円で売却した。売却損益は？",
    "answer": "売却益2万円",
    "wrong": [
      "売却損4万円",
      "売却益8万円",
      "売却損40万円"
    ],
    "explanation": "売却時累計額は36＋6＝42万円、帳簿価額90−42＝48万円。対価50万円との差2万円は売却益です。",
    "n": 7,
    "purpose": "mini_b"
  },
  {
    "conceptId": "provisions-estimates",
    "family": "explain",
    "prompt": "引当金を計上するために必要な判断は？",
    "answer": "発生根拠・可能性・合理的見積り",
    "wrong": [
      "現金の多さのみ",
      "利益の多さのみ",
      "予算額だけ"
    ],
    "explanation": "任意の利益調整と区別します。",
    "n": 1,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "provisions-estimates",
    "family": "reverse",
    "prompt": "請求額確定済みの支払義務と、保証修理の将来見積りは同じ？",
    "answer": "確定債務と見積りを区別",
    "wrong": [
      "必ず同じ引当金",
      "どちらも資産",
      "どちらも売上"
    ],
    "explanation": "費用発生と金額確定の状態を区別します。",
    "n": 2,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "provisions-estimates",
    "family": "transfer",
    "prompt": "新情報で合理的な保証率が変わった。対応は？",
    "answer": "根拠を確認し見積りを見直す",
    "wrong": [
      "旧率を永久固定",
      "必ず不正とする",
      "現金を増やす"
    ],
    "explanation": "見積りは更新根拠を記録します。",
    "n": 3,
    "purpose": "diagnostic"
  },
  {
    "conceptId": "provisions-estimates",
    "family": "estimate-versus-finalized-debt",
    "prompt": "当期受領済みの請求書2万円は支払額が確定し未払い。当期販売製品の保証修理費3万円は発生可能性が高く合理的見積可能で当期負担。いずれも未計上。決算の区分は？",
    "answer": "確定債務2万円・保証引当金3万円",
    "wrong": [
      "保証引当金5万円・確定債務0円",
      "確定債務5万円・保証引当金0円",
      "前払費用5万円・負債0円"
    ],
    "explanation": "確定した未払代金と将来支出の合理的見積りは別の負債として区分します。双方の当期対応費用合計は5万円です。",
    "n": 4,
    "purpose": "evaluation"
  },
  {
    "conceptId": "provisions-estimates",
    "family": "retain-7-day",
    "prompt": "7日後確認：前期末保証引当金6万円。当期に対象修理費5万円を支払った。追加繰入・戻入の前、正しい引当残高と支払時の新たな費用は？",
    "answer": "残高1万円・新たな費用0円",
    "wrong": [
      "残高6万円・新たな費用5万円",
      "残高11万円・新たな費用5万円",
      "残高0円・新たな費用6万円"
    ],
    "explanation": "支払は保証引当金5万円／現金5万円で、残高6−5＝1万円。前期の引当対象に一致するので支払時に費用を重複計上しません。",
    "n": 5,
    "purpose": "retention"
  },
  {
    "conceptId": "provisions-estimates",
    "family": "before-cost-scope",
    "prompt": "当期販売済み製品の保証修理費6万円は発生可能性が高く合理的見積可能で当期負担とする。来期新製品の広告予算2万円は計画だけで現在の義務も当期発生原因もない。引当対象と当期費用は？",
    "answer": "保証修理だけ・6万円",
    "wrong": [
      "保証修理と広告・8万円",
      "広告だけ・2万円",
      "いずれも支払前なので0円"
    ],
    "explanation": "当期販売に起因し条件を満たす保証修理見積6万円を引き当てます。広告予算は将来計画だけなので当期引当対象にしません。",
    "n": 6,
    "purpose": "mini_a"
  },
  {
    "conceptId": "provisions-estimates",
    "family": "after-reverse-rate",
    "prompt": "保証引当金は修正前残高3万円、当期追加繰入4万円で必要残高へ達する。その必要残高は期末の未履行保証対象売上350万円に同一率を乗じる前提。合理的見積率は？",
    "answer": "2%",
    "wrong": [
      "1%",
      "4%",
      "7%"
    ],
    "explanation": "必要残高は3＋4＝7万円。7÷350＝0.02なので2%。架空の設問条件で、実務の適正率を示しません。",
    "n": 7,
    "purpose": "mini_b"
  },
  {
    "conceptId": "cash-is-not-profit",
    "family": "retain-21-day",
    "prompt": "21日後確認：予約金9万円は受取済み。当期中に約束の3分の1のサービスを提供した。対価は提供割合に均等配分し、当期対応原価は1万円。他の収益費用なし。当期利益と期末前受金は？",
    "answer": "利益2万円・前受金6万円",
    "wrong": [
      "利益8万円・前受金0円",
      "利益3万円・前受金6万円",
      "利益−1万円・前受金9万円"
    ],
    "explanation": "履行済み売上9×1/3＝3万円、利益3−1＝2万円。未履行の6万円は前受金として残します。",
    "n": 8,
    "purpose": "retention"
  },
  {
    "conceptId": "double-entry",
    "family": "retain-21-day",
    "prompt": "21日後確認：現金8万円で仕入れた商品を資産に計上し、その半分を10万円で掛販売した。原価は販売時に費用計上。他の取引なし。2取引後の資産純増と純資産純増は？",
    "answer": "いずれも6万円",
    "wrong": [
      "資産14万円・純資産10万円",
      "いずれも10万円",
      "資産2万円・純資産6万円"
    ],
    "explanation": "現金−8、商品＋4、売掛金＋10なので資産純増6万円。売上10−原価4＝利益6万円で純資産も6万円増えます。",
    "n": 8,
    "purpose": "retention"
  },
  {
    "conceptId": "prepaid-expenses",
    "family": "retain-21-day",
    "prompt": "21日後確認：期首前払費用6万円を当期に全て利用。当期中に新たな保険料12万円を払い、そのうち4万円分は翌期に利用する。他の契約なし。当期費用合計と期末前払額は？",
    "answer": "当期費用14万円・期末前払4万円",
    "wrong": [
      "当期費用12万円・期末前払4万円",
      "当期費用18万円・期末前払0円",
      "当期費用8万円・期末前払10万円"
    ],
    "explanation": "前期から繰り越した当期利用6万円と、新契約当期利用12−4＝8万円で当期費用14万円。未使用4万円を期末資産へ残します。",
    "n": 8,
    "purpose": "retention"
  },
  {
    "conceptId": "inventory-cost",
    "family": "retain-21-day",
    "prompt": "21日後確認：期首商品12万円、仕入50万円、仕入返品5万円、販売用商品の期末原価17万円。評価損・減耗・付随費用なし。期末表には別途他社所有の預り品3万円もある。売上原価は？",
    "answer": "40万円",
    "wrong": [
      "43万円",
      "45万円",
      "37万円"
    ],
    "explanation": "純仕入は50−5＝45万円。預り品は自社在庫へ加えず、12＋45−17＝40万円。返品・所有区分を先に整理します。",
    "n": 8,
    "purpose": "retention"
  },
  {
    "conceptId": "depreciation",
    "family": "retain-21-day",
    "prompt": "21日後確認：2台の備品を間接法で償却。1台目は原価60万円・期首累計24万円・当期償却12万円、2台目は原価30万円・期首累計0円・当期償却3万円。売却・減損なし。合計期末帳簿価額は？",
    "answer": "51万円",
    "wrong": [
      "75万円",
      "66万円",
      "90万円"
    ],
    "explanation": "1台目60−24−12＝24万円、2台目30−0−3＝27万円、合計51万円。原価と期首・当期償却を資産別に対応させます。",
    "n": 8,
    "purpose": "retention"
  },
  {
    "conceptId": "provisions-estimates",
    "family": "retain-21-day",
    "prompt": "21日後確認：保証引当金の期首残高5万円、対象修理支払3万円。当期繰入前に、販売済み2製品群の必要残高を各2万円・4万円と合理的に見積もった。両群に同じ引当金を使う。追加繰入額は？",
    "answer": "4万円",
    "wrong": [
      "6万円",
      "1万円",
      "9万円"
    ],
    "explanation": "支払後残高5−3＝2万円、製品群合計の必要額2＋4＝6万円。追加繰入は6−2＝4万円です。",
    "n": 8,
    "purpose": "retention"
  }
];

// Fixed server-only answer positions are assigned once during authoring, independently
// of the public ID. Never randomize them at runtime: saved answers bind to this version.
const draftAnswerPositions: Readonly<Record<string, number>> = {
  "bk-practice-cash-is-not-profit-1": 3,
  "bk-practice-cash-is-not-profit-2": 0,
  "bk-practice-cash-is-not-profit-3": 2,
  "bk-practice-cash-is-not-profit-4": 0,
  "bk-practice-cash-is-not-profit-5": 1,
  "bk-practice-cash-is-not-profit-6": 3,
  "bk-practice-cash-is-not-profit-7": 3,
  "bk-practice-cash-is-not-profit-8": 0,
  "bk-practice-cash-is-not-profit-9": 0,
  "bk-practice-cash-is-not-profit-10": 1,
  "bk-practice-double-entry-1": 2,
  "bk-practice-double-entry-2": 3,
  "bk-practice-double-entry-3": 1,
  "bk-practice-double-entry-4": 1,
  "bk-practice-double-entry-5": 3,
  "bk-practice-double-entry-6": 0,
  "bk-practice-double-entry-7": 0,
  "bk-practice-double-entry-8": 2,
  "bk-practice-double-entry-9": 1,
  "bk-practice-double-entry-10": 0,
  "bk-practice-prepaid-expenses-1": 1,
  "bk-practice-prepaid-expenses-2": 2,
  "bk-practice-prepaid-expenses-3": 1,
  "bk-practice-prepaid-expenses-4": 0,
  "bk-practice-prepaid-expenses-5": 2,
  "bk-practice-prepaid-expenses-6": 2,
  "bk-practice-prepaid-expenses-7": 0,
  "bk-practice-prepaid-expenses-8": 0,
  "bk-practice-prepaid-expenses-9": 0,
  "bk-practice-prepaid-expenses-10": 2,
  "bk-practice-inventory-cost-1": 1,
  "bk-practice-inventory-cost-2": 1,
  "bk-practice-inventory-cost-3": 3,
  "bk-practice-inventory-cost-4": 3,
  "bk-practice-inventory-cost-5": 3,
  "bk-practice-inventory-cost-6": 3,
  "bk-practice-inventory-cost-7": 3,
  "bk-practice-inventory-cost-8": 3,
  "bk-practice-inventory-cost-9": 3,
  "bk-practice-inventory-cost-10": 2,
  "bk-practice-depreciation-1": 2,
  "bk-practice-depreciation-2": 0,
  "bk-practice-depreciation-3": 2,
  "bk-practice-depreciation-4": 0,
  "bk-practice-depreciation-5": 2,
  "bk-practice-depreciation-6": 0,
  "bk-practice-depreciation-7": 0,
  "bk-practice-depreciation-8": 2,
  "bk-practice-depreciation-9": 3,
  "bk-practice-depreciation-10": 1,
  "bk-practice-provisions-estimates-1": 0,
  "bk-practice-provisions-estimates-2": 1,
  "bk-practice-provisions-estimates-3": 0,
  "bk-practice-provisions-estimates-4": 2,
  "bk-practice-provisions-estimates-5": 1,
  "bk-practice-provisions-estimates-6": 3,
  "bk-practice-provisions-estimates-7": 0,
  "bk-practice-provisions-estimates-8": 2,
  "bk-practice-provisions-estimates-9": 1,
  "bk-practice-provisions-estimates-10": 2,
  "bk-diagnostic-cash-is-not-profit-1": 0,
  "bk-diagnostic-cash-is-not-profit-2": 2,
  "bk-diagnostic-cash-is-not-profit-3": 3,
  "bk-evaluation-cash-is-not-profit-4": 2,
  "bk-retention-cash-is-not-profit-5": 0,
  "bk-mini_a-cash-is-not-profit-6": 2,
  "bk-mini_b-cash-is-not-profit-7": 1,
  "bk-diagnostic-double-entry-1": 0,
  "bk-diagnostic-double-entry-2": 3,
  "bk-diagnostic-double-entry-3": 0,
  "bk-evaluation-double-entry-4": 3,
  "bk-retention-double-entry-5": 3,
  "bk-mini_a-double-entry-6": 1,
  "bk-mini_b-double-entry-7": 0,
  "bk-diagnostic-prepaid-expenses-1": 0,
  "bk-diagnostic-prepaid-expenses-2": 2,
  "bk-diagnostic-prepaid-expenses-3": 1,
  "bk-evaluation-prepaid-expenses-4": 1,
  "bk-retention-prepaid-expenses-5": 0,
  "bk-mini_a-prepaid-expenses-6": 2,
  "bk-mini_b-prepaid-expenses-7": 0,
  "bk-diagnostic-inventory-cost-1": 2,
  "bk-diagnostic-inventory-cost-2": 1,
  "bk-diagnostic-inventory-cost-3": 2,
  "bk-evaluation-inventory-cost-4": 3,
  "bk-retention-inventory-cost-5": 2,
  "bk-mini_a-inventory-cost-6": 3,
  "bk-mini_b-inventory-cost-7": 2,
  "bk-diagnostic-depreciation-1": 1,
  "bk-diagnostic-depreciation-2": 1,
  "bk-diagnostic-depreciation-3": 1,
  "bk-evaluation-depreciation-4": 0,
  "bk-retention-depreciation-5": 3,
  "bk-mini_a-depreciation-6": 0,
  "bk-mini_b-depreciation-7": 3,
  "bk-diagnostic-provisions-estimates-1": 0,
  "bk-diagnostic-provisions-estimates-2": 2,
  "bk-diagnostic-provisions-estimates-3": 1,
  "bk-evaluation-provisions-estimates-4": 1,
  "bk-retention-provisions-estimates-5": 2,
  "bk-mini_a-provisions-estimates-6": 3,
  "bk-mini_b-provisions-estimates-7": 0,
  "bk-retention-cash-is-not-profit-8": 3,
  "bk-retention-double-entry-8": 3,
  "bk-retention-prepaid-expenses-8": 1,
  "bk-retention-inventory-cost-8": 2,
  "bk-retention-depreciation-8": 3,
  "bk-retention-provisions-estimates-8": 0
};

function draft(seed: Seed): BookkeepingDraftQuestion {
  const use = seed.purpose ?? 'practice';
  const purpose = use === 'diagnostic' ? 'diagnostic' : use === 'retention' || use === 'mini_b' || use === 'evaluation' ? 'after_evaluation' : use === 'practice' ? 'practice' : 'before_evaluation';
  const questionId = `bk-${use}-${seed.conceptId}-${seed.n}`;
  const position = draftAnswerPositions[questionId];
  if (!Number.isInteger(position) || position < 0 || position > 3) throw new StudyError('INVALID_DRAFT_ANSWER_KEY', 503);
  const answers = [...seed.wrong]; answers.splice(position, 0, seed.answer);
  return { question: { subjectId: 'bookkeeping', conceptId: seed.conceptId, conceptVersion: bookkeepingConceptVersion(seed.conceptId),
    id: questionId, version: BOOKKEEPING_DRAFT_VERSION,
    familyId: `bk-${use}-${seed.conceptId}-${seed.family}`, poolId: `bk-${use}`, poolVersion: BOOKKEEPING_DRAFT_VERSION,
    purpose, stage: use === 'diagnostic' ? (seed.n === 1 ? 'anchor' : seed.n === 2 ? 'boundary' : 'transfer') : 'transfer',
    status: 'draft', review: null, prompt: `${seed.prompt}（架空の原稿試用。専門審査前。単位指定がない数値は万円。税務特例・消費税・端数処理は扱わない。）`, maxScore: 1, targetScore: 1,
    options: answers.map((label, index) => ({ id: `o${index+1}`, label, earned: index === position ? 1 : 0, errorReason: index === position ? null : seed.explanation })) },
    explanation: seed.explanation, qualification: 'practice_only', expertReview: 'pending', intendedUse: use };
}
const syllabusQuestions: BookkeepingDraftQuestion[] = BOOKKEEPING_SYLLABUS_LESSONS.flatMap(lesson => lesson.exercises.map((seed,index) => {
  const use = seed.use;
  const conceptId = syllabusConceptId(lesson);
  const id = `bk-${use}-${conceptId}-${index+1}`;
  const digest = createHash('sha256').update(JSON.stringify([id,seed,'answer-layout-v2'])).digest('hex');
  // Only the first 12 hex digits are public. Keep answer placement outside that projection.
  const position = Number.parseInt(digest.slice(12,14),16)%4;
  const answers = [...seed.wrong]; answers.splice(position,0,seed.answer);
  if (answers.length !== 4 || new Set(answers).size !== 4) throw new Error('INVALID_SYLLABUS_QUESTION');
  return {question:{subjectId:'bookkeeping',conceptId,conceptVersion:syllabusConceptVersion(conceptId),id,
    version:`synthetic-syllabus-question-${digest.slice(0,12)}`,familyId:`bk-${use}-${conceptId}-${seed.family}`,
    poolId:`bk-${use}`,poolVersion:'synthetic-bookkeeping-syllabus-v2',purpose:use==='diagnostic'?'diagnostic':use==='practice'?'practice':'after_evaluation',
    stage:use==='diagnostic'&&seed.family==='anchor'?'anchor':use==='diagnostic'&&seed.family==='boundary'?'boundary':'transfer',
    status:'draft',review:null,prompt:`${seed.prompt}（架空の原稿試用・専門審査前。問題に示す処理条件を使い、税務特例は扱いません。）`,
    maxScore:1,targetScore:1,options:answers.map((label,i)=>({id:`o${i+1}`,label,earned:i===position?1:0,errorReason:i===position?null:seed.wrongReasons?.[i<position?i:i-1]??seed.explanation}))},
    explanation:seed.explanation,qualification:'practice_only',expertReview:'pending',intendedUse:use};
}));
export const BOOKKEEPING_CORE_PRACTICE_DRAFTS: readonly BookkeepingDraftQuestion[] = practiceSeeds.map(draft);
export const BOOKKEEPING_CORE_INDEPENDENT_DRAFTS: readonly BookkeepingDraftQuestion[] = independentSeeds.map(draft);
export const BOOKKEEPING_PRACTICE_DRAFTS = [...BOOKKEEPING_CORE_PRACTICE_DRAFTS,...syllabusQuestions.filter(item=>item.intendedUse==='practice')];
export const BOOKKEEPING_INDEPENDENT_DRAFTS = [...BOOKKEEPING_CORE_INDEPENDENT_DRAFTS,...syllabusQuestions.filter(item=>item.intendedUse!=='practice')];
export const BOOKKEEPING_ALL_QUESTION_DRAFTS = [...BOOKKEEPING_PRACTICE_DRAFTS, ...BOOKKEEPING_INDEPENDENT_DRAFTS];
export const BOOKKEEPING_DIAGNOSTIC_DRAFTS = BOOKKEEPING_INDEPENDENT_DRAFTS.filter(item => item.intendedUse === 'diagnostic');
export const BOOKKEEPING_EVALUATION_DRAFTS = BOOKKEEPING_INDEPENDENT_DRAFTS.filter(item => item.intendedUse === 'evaluation');
export const BOOKKEEPING_RETENTION_DRAFTS = BOOKKEEPING_INDEPENDENT_DRAFTS.filter(item => item.intendedUse === 'retention');
export const BOOKKEEPING_MINI_EXAM_DRAFTS = ['mini_a', 'mini_b'].map(id => ({ id: `bk-${id}`, version: BOOKKEEPING_DRAFT_VERSION,
  status: 'draft' as const, review: null, qualification: 'practice_only' as const, timeLimitMinutes: 12,
  comprehensive: false, comparable: false, questionIds: BOOKKEEPING_INDEPENDENT_DRAFTS.filter(item => item.intendedUse === id).map(item => item.question.id),
  notice: '6概念だけのミニ演習です。総合模試・合格ライン判定ではありません。専門審査前。' }));
export function publicBookkeepingQuestion(item: BookkeepingDraftQuestion) {
  const q = item.question;
  return { id: q.id, version: q.version, subjectId: q.subjectId, conceptId: q.conceptId, conceptVersion: q.conceptVersion,
    familyId: q.familyId, prompt: q.prompt, options: q.options.map(({ id, label }) => ({ id, label })),
    qualification: item.qualification, expertReview: item.expertReview, intendedUse: item.intendedUse };
}
export function gradeBookkeepingDraft(questionId: string, answerId: string) {
  const item = BOOKKEEPING_ALL_QUESTION_DRAFTS.find(item => item.question.id === questionId);
  const answer = item?.question.options.find(option => option.id === answerId);
  if (!item || !answer) throw new StudyError('INVALID_OPTION');
  return { questionId, questionVersion: item.question.version, answerId, correct: answer.earned >= item.question.targetScore,
    earned: answer.earned, max: item.question.maxScore, explanation: item.explanation,
    misconceptionCandidate: answer.errorReason, evidenceQualification: 'practice_only' as const, expertReview: 'pending' as const };
}
export function bookkeepingDiagnosticDraftAdapter(): readonly DiagnosticQuestion[] {
  return BOOKKEEPING_DIAGNOSTIC_DRAFTS.map(item => item.question);
}
