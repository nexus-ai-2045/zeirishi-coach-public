# 設計統合 (Codex 案 × Claude 案) — 2026-09-05

> 履歴専用（2026-09-05）：旧6点比較表です。以下の正本・承認・公開状態・実装指示は当時の記録であり、現行仕様ではありません。現行の唯一の設計は [統合PRODUCT_SPEC.md](PRODUCT_SPEC.md)。旧比較表の未決6点は現行設計第23節に採否を反映済みですが、v2のFableレビューと人間の採否判断は未完了です。以下の計画を新規実装へ再実行しないでください。

- 目的: 同じ製品に 2 つの設計がある状態を 1 つにする。正本は本 repo (zeirishi-coach) の spec。
- 入力:
  - Codex 案: `docs/specs/2026-09-04-codex-product-spec.md` (原本 nexus_ai `products/zeirishi-quest/docs/PRODUCT_SPEC.md` の写し) + 動く縦切り試作 (React、仕訳バトル、決定的採点、100 問レビュー済み問題バンク構想)
  - Claude 案: `docs/specs/2026-09-04-zeirishi-coach-design.md` v1 + 実装 (Claude Code skill、論点 tree 6 科目、BKT 習得度、合格確率、CLI、PR #1)
- 学習者の実態 (2026-09-03 Discord): 受験 10 年、点数は上がり続け、昨年は 1 点足りず。**「最後の数点」を確実に取る設計が要る。**

## 一致していること (そのまま採用)

- 北極星は本試験の合格可能性。滞在時間・タップ数は指標にしない
- 1 問 → 確定 → 採点 → 誤りの分類 → 忘却リスクが高まる時点で再出題
- AI は正誤の最終判定・出典生成・学習履歴の正本を持たない
- 学習履歴の正本は構造化データ (Codex: SQLite+MCP / Claude: attempts.jsonl)。会話履歴を正本にしない
- 誤答は罰ではなく弱点発見。ライフ・エネルギー・ガチャ・通貨は使わない
- 本試験モード (制限時間・ノーヒント) と講師モード (ヒント・問いかけ) を分ける

## 食い違い (CEO が決める 6 点。太字が私の推奨)

| # | 論点 | Codex 案 | Claude 案 | 統合案 (推奨) |
|---|---|---|---|---|
| 1 | 問題の出どころ | 人間レビュー済みの問題バンク (100 問から)。AI 生成問題は混ぜない | 論点 tree に沿って毎回 AI 生成。保存しない | **二層にする。計算 (仕訳・総合) はレビュー済みバンクが正本で決定的採点。理論と「数字を変えた類題」は AI 生成で、記録に `source: generated` を付け、習得度への反映は本試験準備率には数えず補助に留める** |
| 2 | 指標の見せ方 | 「初見・時間内・ノーヒント正答率」= 本試験準備率。根拠のない合格確率は表示しない | 期待得点と模試順位から合格確率を推定して常時表示 | **主表示は本試験準備率 (Codex 定義)。合格確率は模試を 1 回以上入れて較正できた後だけ、根拠 (模試日・得点・順位) を添えて表示。それまでは非表示** |
| 3 | 報酬設計 | EXP は時間内・ノーヒント正答だけ。ストリーク圧を掛けない | XP・コンボ・連続日数の称号・忘却警告ボーナス | **報酬は「検証できる学習成果」だけに付ける: 時間内ノーヒント正答、忘却期限内の想起 (保持の証拠)、誤答論点の克服。連続日数は表示するが報酬にしない。コンボは廃止** |
| 4 | 記録の器 | SQLite + ローカル MCP server | JSON (state.json / attempts.jsonl) + CLI | **今は JSON + CLI (動いている)。attempts.jsonl を正本の形式として固定し、MCP は「同じ jsonl を読む薄い層」として後で足す。SQLite 化は 1 万件を超えてから** |
| 5 | UI | Web の仕訳バトル (React、レトロ RPG) | Claude Code の対話 | **両方。計算演習 (仕訳・総合) は Web の本試験モード、理論暗記・解説・計画は Claude Code。両者は同じ論点 id と同じ attempts.jsonl を使う (Web は local API 経由で書く)** |
| 6 | 置き場 | nexus_ai `products/zeirishi-quest/` | 独立 repo zeirishi-coach | **zeirishi-coach に統合 (`web/` に試作を移す)。論点 tree・採点規則・記録形式が 1 repo に揃う。nexus_ai 側は pointer だけ残す** |

## 統合後の構成 (推奨案が通った場合)

```text
zeirishi-coach/
  references/subjects/*.json     論点 tree (両 UI 共通の id)
  references/questions/*.json    レビュー済み問題バンク (Codex の questions.js を移し、出典・版・誤概念タグを付ける)
  scripts/coach.py               CLI (記録・メニュー・report・dashboard)。attempts.jsonl が正本
  SKILL.md                        Claude Code の対話 (理論・解説・計画)
  web/                            仕訳バトル (React)。local API で coach.py の record を呼ぶ
```

## 進め方

1. CEO が上の 6 点を決める (推奨のままなら「全部推奨」で足りる)
2. Claude: spec v2 を書く (本 file の決定を §0〜§7 に溶かし込み、v1 と Codex 案は履歴として残す)
3. Codex: 試作を `web/` へ移し、問題バンクを JSON 化 (出典・版・誤概念タグ)、採点を CLI の record に接続
4. 両者: 論点 id と attempts.jsonl の形式を「契約」として test で固定する (どちらが壊しても落ちる)
5. 友達に zip で渡して 2 週間。指標は本試験準備率と模試得点
