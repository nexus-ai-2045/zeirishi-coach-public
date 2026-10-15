# 簿記論の問題原稿在庫

2026年10月7日の拡張後は36概念・全468問（練習240、診断108、独立評価36、保持72、ミニ12）。追加30論点の内訳と不足処理は [追加教材のレビュー範囲](bookkeeping-syllabus-review.md) を参照。以下は基礎6概念108問についての詳細記録を保持する。

## 現在の判定

架空原稿は108問。内訳は練習60、診断18、追加評価6、7日後保持6、21日後保持6、開始前ミニ6、終了時ミニ6。これはローカルで試す原稿在庫であり、専門審査済み問題や正式な学習証拠の在庫ではない。

全原稿は `status: draft`、`review: null`、`expertReview: pending`、`qualification: practice_only` を維持する。ミニ2組は各12分・6概念で、`comparable: false`、`comprehensive: false`。前後の難度・範囲の比較可能性は未審査であり、得点差だけで改善や科目全体の合格準備度を判定しない。

原稿の正本は [問題原稿の正本](../../web/src/server/bookkeeping-question-drafts.ts)。在庫表はそのレビュー用の説明で、独自の承認台帳ではない。製品の在庫条件は [製品仕様の第16・22.6節](../specs/PRODUCT_SPEC.md)、審査・権利・有効化の手順は [教材を審査・登録する手順](../plans/material-review-workflow.md) を参照する。

## 概念と用途の割当て

下表の`ID`は各概念について1問ずつを指す。開始前・終了時の専用評価枠に開始前・終了時のミニを使い、同じ問題を追加の独立問題として二重計上しない。追加評価6問はそれとは別の問題である。

| 概念`ID` | 練習 | 診断 | 追加評価 | 開始前（開始前ミニ） | 終了時（終了時ミニ） | 7日後保持 | 21日後保持 |
|---|---:|---:|---|---|---|---|---|
| `cash-is-not-profit` | 10 | 3 | `bk-evaluation-cash-is-not-profit-4` | `bk-mini_a-cash-is-not-profit-6` | `bk-mini_b-cash-is-not-profit-7` | `bk-retention-cash-is-not-profit-5` | `bk-retention-cash-is-not-profit-8` |
| `double-entry` | 10 | 3 | `bk-evaluation-double-entry-4` | `bk-mini_a-double-entry-6` | `bk-mini_b-double-entry-7` | `bk-retention-double-entry-5` | `bk-retention-double-entry-8` |
| `prepaid-expenses` | 10 | 3 | `bk-evaluation-prepaid-expenses-4` | `bk-mini_a-prepaid-expenses-6` | `bk-mini_b-prepaid-expenses-7` | `bk-retention-prepaid-expenses-5` | `bk-retention-prepaid-expenses-8` |
| `inventory-cost` | 10 | 3 | `bk-evaluation-inventory-cost-4` | `bk-mini_a-inventory-cost-6` | `bk-mini_b-inventory-cost-7` | `bk-retention-inventory-cost-5` | `bk-retention-inventory-cost-8` |
| `depreciation` | 10 | 3 | `bk-evaluation-depreciation-4` | `bk-mini_a-depreciation-6` | `bk-mini_b-depreciation-7` | `bk-retention-depreciation-5` | `bk-retention-depreciation-8` |
| `provisions-estimates` | 10 | 3 | `bk-evaluation-provisions-estimates-4` | `bk-mini_a-provisions-estimates-6` | `bk-mini_b-provisions-estimates-7` | `bk-retention-provisions-estimates-5` | `bk-retention-provisions-estimates-8` |

練習`ID`は `bk-practice-{conceptId}-1`〜`-10`、診断`ID`は `bk-diagnostic-{conceptId}-1`〜`-3`。診断の問題ファミリーは概念ごとに `explain`、`reverse`、`transfer` の3つ。全問4択で、説明を読むだけでなく条件に合う答えを選ぶ原稿である。

原稿の用途は `practice / diagnostic / evaluation / retention / mini_a / mini_b` の6値。公開の練習取得は `practice / retention` だけに限定し、診断・独立評価・前後ミニを練習経由で取得・採点しない。診断とミニは専用の保存済みセッションでだけ出題する。7日・21日は別`pool`を増やさず、同じ `retention` `pool`内の問題ファミリー末尾 `retain-7-day` と `retain-21-day` で区別する。経過日数や未見条件を満たす実運用を、問題ファミリー名だけで保証した扱いにはしない。

## 練習の問題ファミリーと形式

問題ファミリーの完全`ID`は `bk-practice-{conceptId}-{下表のfamily}`。同じ問題ファミリーの2問は数値や問い方が違っても1問題ファミリーとして数える。各概念5問題ファミリー・10問なので、練習の固有問題ファミリーは計30で、最低18枠を満たす原稿候補である。

| 概念 | 5つの練習問題ファミリー | 原理の確認 | 異なる実務場面を含む2問題ファミリー | 混合形式の問題 |
|---|---|---|---|---|
| 現金と利益の違い | `borrow` / `credit-sale` / `cash-profit-bridge` / `capital-flow` / `customer-advance` | 返済義務、損益と資金移動、履行と入金の区別 | 個人商店の資金調達 `borrow`、卸売店の掛販売・回収 `credit-sale` | `-6`：利益から現金増加への計算と未回収の理由を一組で選ぶ |
| 複式簿記 | `asset-liability` / `asset-exchange` / `expense-liability` / `equation` / `error-detection` | 貸借の増減、資産＝負債＋純資産、貸借一致の限界 | 個人商店の借入・返済 `asset-liability`、パン工房の設備購入・サービス店の回収 `asset-exchange` | `-10`：誤仕訳の訂正と訂正理由を一組で選ぶ |
| 前払費用 | `annual-months` / `adjust-expense` / `asset-first` / `period-boundary` / `exception-scope` | 利用期間への費用対応、資産先行と費用先行の区別 | カフェの店舗保険 `annual-months`、整備工場の契約保険の決算訂正 `adjust-expense` | `-6`：利用分の決算仕訳と期末資産残高を一組で選ぶ |
| 棚卸資産と売上原価 | `cost-of-sales` / `gross-profit` / `ownership-cutoff` / `valuation` / `purchase-scope` | 未販売分の資産性、所有・取引条件、費用区分 | 雑貨店の商品販売 `cost-of-sales`、卸売会社の外部保管・委託販売 `ownership-cutoff` | `-4`：売上総利益の計算と販売費の区分を一組で選ぶ |
| 減価償却 | `straight-line` / `partial-year` / `accumulated` / `noncash-cost` / `journal` | 利用期間への原価配分、帳簿価額と時価、非現金費用 | 製造工房の設備 `straight-line`、クリーニング店の期中導入設備 `partial-year` | `-10`：売却損益の計算と帳簿価額との比較理由を一組で選ぶ |
| 引当金と見積り | `recognition` / `warranty-rate` / `balance-adjust` / `use-provision` / `specific-versus-estimate` | 発生根拠・当期負担・可能性・合理的見積り、確定債務との区別 | 修理店の保証義務 `recognition`、家電販売店の製品保証 `warranty-rate` | `-8`：対象修理の支払後残高と新見積りを突合し追加繰入額・理由を選ぶ |

異なる業種名だけで問題ファミリーを増やしてはいない。上の実務2問題ファミリーは資金調達と掛販売、資産負債取引と資産交換、期間配分と記帳訂正、原価計算と所有確認、通年配分と期中使用開始、計上条件判断と合理的率による見積りという異なる操作を扱う。混合形式6枠は練習60問の一部であり、独立した6問を上乗せしない。原理確認と実務場面も同じ問題に重なり得る。

## 評価と保持の問題ファミリー

評価問題ファミリーの完全`ID`は `bk-mini_a-{conceptId}-{開始前family}`、`bk-mini_b-{conceptId}-{終了時family}`。追加評価は `bk-evaluation-{conceptId}-{追加family}`。保持は `bk-retention-{conceptId}-retain-7-day` と `bk-retention-{conceptId}-retain-21-day`。

| 概念`ID` | 開始前問題ファミリーと課題 | 終了時問題ファミリーと課題 | 追加評価問題ファミリーと課題 | 7日後の課題 | 21日後の課題 |
|---|---|---|---|---|---|
| `cash-is-not-profit` | `before-funding-classification`：借入と履行済み未収サービスの分類 | `after-profit-reconciliation`：予約金・二重売上の誤記訂正 | `cash-accrual-reconciliation`：現金収支・未収・未払から利益へ調整 | 利益と現金増加の差から売上債権変化を逆算 | 部分履行の売上・利益・前受残高を同時に判断 |
| `double-entry` | `before-compound-journal`：設備を一部現金・一部後払いで取得する複合仕訳 | `after-journal-to-statements`：掛売上と部分回収から資産・利益へ接続 | `omitted-accrual-audit`：貸借一致でも漏れ得る未払費用の訂正 | 負債減少と現金減少から他資産の変化を逆算 | 仕入・掛販売・原価認識の複数仕訳から資産・純資産純増へ接続 |
| `prepaid-expenses` | `before-two-contracts`：異なる開始日の2契約を期間配分 | `after-misstated-statements`：未使用分の訂正が利益・資産へ与える影響 | `reverse-contract-value`：利用月数と費用から契約総額を逆算 | 前払費用利用時の誤った現金減少だけを訂正 | 期首繰越と新契約を合算し費用・期末資産へ配分 |
| `inventory-cost` | `before-ownership-reconciliation`：預り品混入と外部保管品漏れを訂正 | `after-reverse-purchases`：売上総利益と在庫から純仕入を逆算 | `sales-cutoff-cost`：出荷・引渡し条件から売上と期末所有を判定 | 前期末在庫の翌期販売と原価認識の対応 | 仕入返品・他社預り品を整理した売上原価計算 |
| `depreciation` | `before-availability-timing`：購入月と使用開始月を分けた償却 | `after-disposal-with-current-charge`：売却までの当期償却を反映した処分損益 | `reverse-useful-life`：年額から耐用年数を逆算し帳簿価額へ接続 | 未計上償却の訂正が利益・資産・現金へ与える影響 | 異なる2資産の原価・期首累計・当期償却を突合 |
| `provisions-estimates` | `before-cost-scope`：保証義務と広告計画の計上対象区分 | `after-reverse-rate`：追加繰入と残高から見積率を逆算 | `estimate-versus-finalized-debt`：確定請求と将来保証見積りを区分 | 対象修理支払後の残高と新たな費用の有無 | 修理支払後残高と複数製品群の必要額を突合 |

別問題ファミリー・別`ID`とするだけでなく、数値替えに留まらない課題へ変更した。ただし、未見性は本人の過去の出題・解説開示との照合が必要で、難度や概念測定の妥当性、48時間・7日・21日の経過条件は専門審査と実運用検証を待つ。練習用教材変換機構でこれらの原稿を試した結果は、用途名にかかわらず `practice_only` である。

## 検算・出典・専門審査の残務

原稿読戻しでは、全108問の正答・他の選択肢・単位・期間・元本と利息・売上総利益と販売費・使用開始と購入時点・当期償却と累計・確定債務と見積債務を確認した。固定資産計上を前提とする小額備品にはその条件を明記し、税務上の即時費用化を自動適用しない。保証率は架空の設問条件であり「専門確認された率」とは記載しない。

2026-10-05に参照先を確認した一次資料は次の2つ。これは原稿の専門承認、利用許諾、全文再配布や`AI`入力の許可の確認ではない。

| 参照先 | 今回の確認範囲 | 残る専門判断・権利確認 |
|---|---|---|
| [国税庁「試験日程・試験科目について」](https://www.nta.go.jp/taxes/zeirishi/zeirishishiken/qa/qa01.htm) | 簿記論の公式出題範囲の入口 | 6概念・各問題ファミリーの出題範囲との対応、当年度の原則・例外、試験全体の未収載領域。範囲ページは正答の承認根拠にはしない |
| [企業会計基準委員会「企業会計基準第9号 棚卸資産の評価に関する会計基準」](https://www.asb-j.jp/jp/accounting_standards_system/details.html?topics_id=24) | 通常販売目的の収益性低下による簿価切下げの考え方 | 通常販売目的以外・滞留品・原価差額・戻入等を今回の単純化から除く妥当性、原稿各問との対応、適用する基準版、取得・保存・転載・改変・再配布・`AI`入力の用途別可否 |

上の2資料だけで、複式簿記、収益の期間帰属、前払費用、償却、引当金の基準適用まで確認済みとは扱わない。専門家が対象企業・基準版・原則と例外を特定し、各問の正答と誤答理由を独立に審査する必要がある。出典別の権利欄・著者と別の専門レビュー・内容内容ハッシュ・出荷承認を実際の記録で揃えるまで、承認済み教材一覧への登録や提供は行わない。

## 機械検査

[問題在庫の検査](../../web/tests/bookkeeping-inventory.test.ts) は総数と用途別・概念別の不足、問題ファミリー重複、実務2問題ファミリーと混合形式、前後と7/21保持の分離、4択の一意性、計算の独立照合、出題前公開用表示の正答情報漏れ、公開`ID`末尾からの正答位置推測、未審査診断の不出題を検査する。正答位置は作成時に一度決めた非公開表へ固定し、実行時には乱数で変えない。

実行は `cd web && ./node_modules/.bin/tsx --test tests/bookkeeping-inventory.test.ts`。合格しても、専門審査・利用権・教材有効化・本番接続・人間レビュー・公開承認が完了した証拠にはならない。
