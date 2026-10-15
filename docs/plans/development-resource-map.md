# 開発資源とフィードバックの使い分け

## CI結果回収の正本（2026-09-13）

所有者は税理士コーチ本部。目的は、完了報告で別commitのCIや未回収結果を成功根拠にしないこと。
既存の `.github/workflows/ci.yml` がテスト実行と結果回収の入口で、
`scripts/ci_result.py` はこの製品の `cli` / `web` jobの結果だけを集約する。
GitHub Actionsの `needs`・`always()`・job summaryを再利用し、別の実行基盤・進捗台帳は作らない。

入力はGitHubのjob結果、検証SHA、run ID、attempt、repository。
出力はログ上のJSON、run summary、終了コード。両job成功かつ実行識別子が揃うときだけ `pass`。
失敗は `fail`、取消・skip・欠測・不正入力は `unknown` とし、両者とも非0終了とする。
この回収job自体の未実行・取消・結果欠落も未確認であり、summaryの不在を成功扱いしない。
結果はrepository CIに限定し、教材・実AI・実Auth/DB・実運用の検収は `unverified` を維持する。

変更反映経路はこのrepoのPR → CI実行 → 結果回収jobのログ/summary照合 → main統合。
報告時は対象SHA・run URL・各job結果を参照し、PR更新前の成功を更新後へ持ち越さない。
採用済みの失敗・未確認拒否条件は `tests/test_ci_result.py` が既存pytest入口で検査する。
branch protectionで必須checkになっているか、他repoへの配布や全環境での稼働は別途確認が必要。

関連する共有SSOT登録の責務は [SSOTレジストリの正本保証](codex://threads/01a05f39-5add-7810-bcc7-134ef88cdb47)
の本文で確認した。この製品のCI結果集約とは入出力・責務が異なるため統合しない。
共通基盤への変更依頼・引継ぎは今回発行していない。

本部の継続実行・委任の回収・アーカイブ判定は [EXECUTION_SCOPE](EXECUTION_SCOPE.md) の責務を維持する。
CIは次の実装を起動するオーケストレーターではなく、CI成功で全体残務0や自動継続を宣言しない。
本タスクの全体残務は [ロードマップ](2026-09-06-web-mvp-roadmap.md) に残り、アーカイブ条件を満たしていない。

### 今回の再発防止の実装

今回繰り返された「検証jobの実行・対象SHAへの束縛・結果回収を別々に扱う」問題は、既存の回収入口を正本のまま使い、入口契約のテストを追加して防ぐ。`.github/workflows/ci.yml` の `verification` job が `always()` で `cli`/`web` の結果を受け取り、`scripts/ci_result.py` を対象runの識別子とともに呼ぶことを [`tests/test_ci_workflow_contract.py`](../../tests/test_ci_workflow_contract.py) が検査する。回収結果が `pass` でも `product_acceptance` は `unverified` のまま、教材・実AI・実Auth/DB・実運用の完了へ昇格させない。

このテストは新しい台帳・別ハーネス・常駐監視を作らず、既存CIの弱体化（`always()`、`needs`、対象SHA束縛、未確認分離の削除）だけをfail-fastで検知する。ローカルテスト成功はGitHub Actionsの実行証拠ではないため、配送後は対象SHAのCI summaryを別途回収する。

確認日: 2026-09-09。製品コード・要件・進捗の正本はこのリポジトリ。管理基盤を製品へ複製しない。この文書は今回の利用判断であり、各基盤の仕様・稼働証明を置き換えない。

## 必要な層と戻り先

| 層 | 確認すること | 今回の証拠・修正 | 未完了と戻り先 |
|---|---|---|---|
| 製品 | 学習者が迷わず理解・復習へ進めるか | ユーザー指摘を設計v7・入口・4択・説明へ反映 | 承認教材、実学習効果は未検証。PRODUCT_SPECと教材審査へ戻す |
| 実装 | 保存・権限・再送・診断が契約を守るか | 分担→統合レビュー→単体/隔離DB・E2E。問題は該当コードへ修正 | 実Auth/DB/AIは別検収。実装者と対応テストへ戻す |
| 配送 | 他環境でも再現し、安全に差分を運べるか | 別ディレクトリの再ビルド、依存監査、秘密情報検査、ローカルコミット | GitHub CI・保護設定・公開判断。PREFLIGHTへ戻す |
| 作業管理 | 担当の成果が本務へ戻っているか | ファイル所有を分離、主担当だけが採否・統合・commit。調査のみを実装完了としない | 停滞時は担当・依存・実行経路を見直す。ロードマップへ戻す |

テスト件数やエージェント数を成果目標にしない。局所合格から製品完成や運用保証を推定しない。並行数は独立性と実行枠に合わせ、同一対象の重複調査を避ける。

## 既存リポジトリの適用判断

各リンク先のREADMEまたはローカル正本を確認した。「参照」は実行成功を意味しない。

| 資源 | 今回の扱い | 使う条件・境界 |
|---|---|---|
| [nexus_ai](https://github.com/nexus-ai-2045/nexus_ai) | 管理側の安全境界を参照 | privateな会話・横断管理を製品リポへコピーしない。このリポジトリのpublic化対象ではない |
| [nexus-management-os](https://github.com/nexus-ai-2045/nexus-management-os) | 司令塔・分担・回収の責務を参照。実行基盤への登録は未確認 | 複数プロジェクトの担当・残務を集約する時。製品進捗正本を二重化しない |
| [ai-round-table](https://github.com/nexus-ai-2045/ai-round-table) | 外部AIレビュー時の既存経路。今回の実装では未起動 | Claude等の独立レビューが必要な時だけ。通常のサブエージェント分担とは別。回答JSON・議事録・成果物の採否を分離 |
| [capability-atlas](https://github.com/nexus-ai-2045/capability-atlas) | 発見・導入・接続・実測の区別を参照。ハーネス未実行 | 新しい能力を採用する時。README上のサンプル表示を実環境の能力としない |
| [toc-engine](https://github.com/nexus-ai-2045/toc-engine) | 今回は未使用 | WIP・滞留の実測データが揃った時に制約を分析。架空の測定値で起動しない |
| [zunda-voice-bot](https://github.com/nexus-ai-2045/zunda-voice-bot) | 対象外 | Discord音声Botは税理士Webアプリや本部通知の必須依存ではない。送信・常駐を起動しない |
| [nexus-activity-log](https://github.com/nexus-ai-2045/nexus-activity-log) | 今回は未使用 | 開発活動を広報草稿へ集約する時。学習者データやrawチャットを流さず、公開とは別判断 |
| [runtime-process-guard](https://github.com/nexus-ai-2045/runtime-process-guard) | 起動前検査・実行負荷の既存候補として確認。今回のCLI呼出しは未実施 | 重複起動・資源圧迫を調べる時。未導入のガードを有効としない。独自監視デーモンは作らない |
| [note-publishing-suite](https://github.com/nexus-ai-2045/note-publishing-suite) | 対象外 | note記事の制作・告知段階でのみ利用。ソース公開やアプリ実装のゲートとして使わない |
| [fractal-decision-ecosystem](https://github.com/nexus-ai-2045/fractal-decision-ecosystem) | fde-root-routerと正本を参照 | 目標・担当・証拠・戻り先を分ける。全基盤の改修を本務の前提にしない。runtime強制は未検証 |
| [engineering-brain](https://github.com/nexus-ai-2045/engineering-brain) | engineering-autopilot正本を読み、導入済みCLIのrouteとcloseoutを実行 | 標準Pythonのソース直実行は依存不足。導入済みCLIは起動成功。closeoutは既存PythonのPATHを当該プロセスだけ指定して再実行し、CLI検査成功。生成物内の個人pathで公開判定はblocked。Git公開候補と配備生成物の検査範囲を分ける必要がある |
| [repo-preflight](https://github.com/nexus-ai-2045/repo-preflight) | 実行済み | README、公開候補、履歴、配送前の検査。機械passと公開承認を分離 |

## 意図的に行わないこと

- 使用数を増やすためだけのインストール、常駐、レビュー往復、新規チャット作成。
- 他の基盤リポジトリの一括改修や、管理用privateリポジトリの公開。
- 「ソース公開できる」と「友人へ提供できる」を同じ完了状態にすること。

次の行動と残務の正本は [ロードマップ](2026-09-06-web-mvp-roadmap.md)、公開判断の正本は [PREFLIGHT](../../PREFLIGHT.md)。基盤側の不具合はその所有リポジトリへ返す候補として扱い、製品実装の手を止めない。

追加実測: ソースのみの検査用worktreeではengineering-brain closeoutが成功した。ただし同CLIは未解決merge競合中にもoverall=okを返したため、Gitの未解決競合とclean状態はrepo-preflightとGitで別検査する。これはengineering-brain側へ返す修正候補であり、製品側に同CLIの実装コピーは作らない。外部issue起票や基盤コード修正はこの一周では行っていない。
