# zeirishi-coach 設計 (税理士試験 合格確定コーチ skill)

> 履歴専用（2026-09-05）：旧Claudeコーチ設計v1です。以下の正本・承認・公開状態・実装指示は当時の記録であり、現行仕様ではありません。現行の唯一の設計は [統合PRODUCT_SPEC.md](PRODUCT_SPEC.md)。旧比較表の未決6点は現行設計第23節に採否を反映済みですが、v2のFableレビューと人間の採否判断は未完了です。以下の計画を新規実装へ再実行しないでください。

- 日付: 2026-09-04
- 状態: **設計 v1 完了 (2026-09-05)**。§0〜§7 が正本。§7.10 の 5 件は仮決め (CEO が変えたら差し替える)。実装 Task 1〜10 は PR #1
- 正本の置き場: 独立 repo `nexus-ai-2045/zeirishi-coach` (public)。旧: nexus_ai `products/zeirishi-quest/coach/` から 2026-09-05 に分離
- 根拠にした一次情報: 間隔想起練習の meta-analysis (Maye 2026, SMD 0.78) / interleaving RCT (Rohrer 2019, 61% vs 38%) / BKT + Elo 個人化 (Yudelson 2021)

## 0. 目的と前提

- 学習者は CEO の友達 1 人。合格ライン付近にいる人の合格を「確実にする」ための skill。
- 友達も Claude Code を使う。skill を `~/.claude/skills/zeirishi-coach/` に置き、`/zeirishi-coach` で起動する。
- 科目は選択制。初期 6 科目: 簿記論 / 財務諸表論 / 法人税法 / 消費税法 / 相続税法 / 所得税法。
- 本番は既定で 2027 年 8 月 (第 77 回)。初回起動時に上書きできる。
- 問題は保存しない。論点 tree に沿って Claude がその場で生成する。友達が手元に置いた教材 PDF は読んでよいが、同梱しない。
- KPI: 主 = 合格確率の推定値、副 = 学習効率 (習得度の増分 / 学習時間)。学習曲線を dashboard で追う。
- Claude API の直接呼び出しはしない。生成・解説・採点は Claude Code 本体が行い、script は計測だけを担う。

## 1. 知識層: 論点 tree と問題生成

### 1.1 論点 tree

`references/subjects/<subject>.json`。1 科目 1 file (PyYAML に依存しないため JSON)。

```json
{
  "subject": "boki",
  "name": "簿記論",
  "exam": {"minutes": 120, "passing_line": 60, "format": {"calc": 100, "theory": 0}},
  "units": [{"id": "boki.fixed", "name": "有形固定資産"}],
  "topics": [
    {
      "id": "boki.fixed.depreciation",
      "name": "減価償却",
      "unit": "boki.fixed",
      "format": "calc",
      "weight": 6,
      "frequency": "high",
      "prereq": ["boki.fixed.acquisition"],
      "pitfalls": ["期中取得の月割を年割にする", "残存価額ゼロと備忘価額 1 円の混同"]
    }
  ]
}
```

- 深さは 3 段 (科目 → 単元 `units` → 論点 `topics`)。診断インタビューは単元ごとに出題し、演習は論点ごとに出題する。
- `weight` の合計は 100 になるように lint する (`scripts/coach.py lint`)。`passing_line` は 100 点満点中の値。
- 初版は各科目 25〜40 論点。CEO と友達の指摘で育てる。

### 1.2 問題生成 rubric (`references/question-rubric.md`)

- 入力: 論点 id、難度 (1〜5)、形式 (calc/theory)、制限時間の目安、直近の誤答分類。
- 出力: 問題文 / 解答例 / 採点基準 (部分点の配分) / 仕込んだ典型ミス 1 つ / 想定解答時間。
- 制約: 本試験の言い回しに寄せる。計算問題は数字を毎回変える。理論問題は「条文・基準の趣旨を自分の言葉で」型と「一文暗記」型を混在させる。
- 演習は必ず論点混在 (interleaving)。同じ論点が 2 問続かないよう script が順序を決める。

### 1.3 読み砕き解説 (`references/explanation-style.md`)

3 段固定。

1. 中学生に話す言葉で「何が起きているか」 (比喩 1 つまで)
2. 根拠 (条文番号・会計基準の項番)。友達の教材 PDF があればその言い回しに揃える
3. 本試験での問われ方と、今回の誤答分類に対する次の一手

## 2. 対話層: SKILL.md のフロー

`/zeirishi-coach [subject] [--dashboard | --mock | --status]`

### 2.1 初回 (state が無い)

1. 科目選択 (複数可。以後は 1 科目ずつ進める)
2. 本番日、直近の模試得点 (無ければ自己申告レベル 1〜5)
3. 診断インタビュー: 単元ごとに 1 問、約 15 問、計算と理論を混在。`coach.py record` で全件記録
4. 結果: 単元別の習得度、合格確率の初期推定、明日からのメニュー

### 2.2 2 回目以降

1. `coach.py next <subject>` が「今日のメニュー」を JSON で返す (復習期限到来 + 低習得度×高配点、10 問前後、論点混在、3 クエストに分割)
2. 各問: 出題 → 解答 → 採点 → 誤答なら 3 段解説 → 誤答分類を 1 つ選ぶ (`knowledge / procedure / time / misread`) → `coach.py record`
3. 終了: `coach.py report` を表示 (習得度の変化、合格確率、XP、ストリーク、次回予告)

### 2.3 直前期 (`--mock`、または本番 30 日前から自動提案)

- 2 時間の本番形式模試。script は時間配分と「捨て問判定」の正否を記録する。
- 模試得点を state に入れ、合格確率のキャリブレーションに使う。

### 2.4 ゲーム性 (CEO 追加要望 2026-09-04)

すべてターミナル対話で成立させる。Phaser 画面は作らない。

| 仕組み | 実装 | 合格率との接続 |
|---|---|---|
| XP / レベル | 正答・復習消化・連続日数で XP。`state.json` の `xp` | 行動量の可視化 |
| 論点ランク | 未着手 → 見習い → 一人前 → 師範。BKT 習得度の閾値 (0.4 / 0.7 / 0.9) | 習得度そのもの |
| デイリークエスト | `next` が返す 3 クエスト (復習 / 弱点 / 挑戦) | メニュー消化率 |
| 忘却警告 | 復習期限 24h 以内の論点を「消えかけている記憶」と表示し、期限内正答は XP 2 倍 | 忘却曲線に報酬を直結 |
| コンボ | 混在演習の連続正答、過去誤答論点の正答で加点 | interleaving の継続 |
| ボス戦 | 単元の締めと模試。配点比重が高いほど強い。撃破で合格確率が動く | 配点の重い論点へ誘導 |
| 称号 | 例: 「捨て問の目利き」(time 分類が 5 回連続ゼロ) | 本番で効く行動へ報酬 |

報酬の表示は `report` の出力に含め、SKILL.md が演出 (短い一言) を添える。演出で解説を薄めない。

## 3. 計測層: `scripts/coach.py`

標準ライブラリのみ。Python 3.11 以上。

### 3.1 サブコマンド

| コマンド | 役割 |
|---|---|
| `init <subject> --exam-date --level/--mock-score` | state 作成 |
| `next <subject> [--n 10]` | 今日のメニュー (JSON) |
| `record <subject> --topic (--score 0..1 | --correct yes/no) [--seconds] --error-class --difficulty [--memo-stage]` | 1 問の記録。BKT / 復習日 / XP を更新。`--seconds` 省略時は timer の差分 |
| `report <subject>` | 習得度・合格確率・学習効率・ゲーム状態 (JSON と人間向け text) |
| `dashboard <subject>` | 学習曲線・論点ヒートマップ・合格確率推移の HTML を `~/.zeirishi-coach/<subject>/dashboard.html` に出す |
| `mock <subject> --score [--minutes] [--rank N --of M]` | 模試結果の記録とキャリブレーション (得点 + 順位) |
| `start <subject> --topic` | 解答時間の計測開始 (record が差分を使う) |
| `plan <subject> [--rebuild]` | マクロ計画 (単元ごとの期限、目標曲線) の表示 / 引き直し |
| `status` | 全科目の合格確率と目標差。複数科目の時は `recommended` (最も低い科目) を出す |
| `rebuild <subject>` | `attempts.jsonl` (正本) から state.json を再生 |
| `lint` | 論点 json の整合 (weight 合計、prereq 参照、id 重複) |

### 3.2 state

- `~/.zeirishi-coach/<subject>/state.json`: 論点ごとの BKT 4 パラメータと現在習得度、次回復習日、間隔、個人 Elo 補正、速度パラメータ、XP、ストリーク、称号、模試履歴
- `~/.zeirishi-coach/<subject>/attempts.jsonl`: 1 問 1 行の追記ログ (再計算の正本)
- repo 外に置く。友達の学習データは共有されない。

### 3.3 モデル

- 習得度: 論点ごとの BKT (`p_init / p_learn / p_guess / p_slip`)。初期値は `frequency` と難度から決める定数表。個人 Elo 補正 1 つを全論点の事後更新に乗せる (Yudelson 2021 の単一パラメータ方式)。
- 誤答分類 `time` は BKT を更新せず速度パラメータだけ下げる。`misread` は BKT 更新を半分にする。
- 忘却: SM-2 系。正答で間隔を伸ばし (1 → 3 → 7 → 14 → 30 日、以後 ×2)、誤答で 1 日に戻す。復習期限を過ぎた論点は習得度を日数に応じて減衰させる。
- 合格確率: 期待得点 = Σ(習得度 × weight)。分散 = 速度パラメータ由来 + 直近模試の実測分散。`P(得点 ≥ passing_line)` を正規近似で出す。模試得点が入ったら、期待得点と実測の差で全体を平行移動する。
- 学習効率: 直近 7 日の `Σ習得度増分 / Σ学習分数`。

### 3.4 テスト (`tests/`、pytest)

- BKT 更新の単調性: 正答で上がる、誤答で下がる、`time` 分類では動かない
- 復習間隔の遷移表
- 合格確率の単調性と 0〜1 の範囲
- `next` が同一論点を連続させないこと、復習期限到来を優先すること
- `lint` が weight 合計 100 以外を拒否すること
- 各科目 json が lint を通ること

## 4. 配置と配布

```text
<repo root>/
  SKILL.md
  manifest.yaml
  references/
    question-rubric.md
    explanation-style.md
    subjects/{boki,zaihyo,hojin,shohi,sozoku,shotoku}.json
  scripts/coach.py            (CLI 入口)
  scripts/coach_lib/{subjects,model,state,scheduler,report,dashboard}.py
  tests/test_*.py
  runtime/claude/   (Claude Code 固有の frontmatter があれば)
```

- nexus_ai 側の web スキャフォールド (`products/zeirishi-quest/`) は別物として残す。
- 友達への配布: zip または GitHub 公開 repo。公開 push は別途 CEO 承認。
- 友達側の手順: フォルダを `~/.claude/skills/zeirishi-coach/` に置く → `/zeirishi-coach` を打つ。

## 5. やらないこと

- Phaser / Web ゲーム画面、Web ホスティング
- 複数ユーザー同期、サーバー
- 予備校教材の同梱、過去問本文の同梱
- Claude API の直接呼び出し

## 6. 完了条件

- 設計: §0〜§7 に未決が無い (仮決めは §7.10 に表で明示) — **2026-09-05 達成**
- `python3 scripts/coach.py lint` が 6 科目で通る — 達成 (PR #1)
- pytest 全緑 — 達成 (73 passed, PR #1)
- 1 週間分の smoke で合格確率・称号・dashboard が動く — 達成 (plan の Evidence)
- Claude Code で `/zeirishi-coach` を起動し、診断 → 演習 → report → dashboard が 1 周回る (transcript を evidence にする) — 未達。skill の配置承認後

## 7. 棚卸し反映 (2026-09-04 CEO 承認: A 1〜7 を全部入れる)

### 7.1 習得度の定義 (BKT 単独をやめる)

- `mastery = p × (0.4 + 0.6 × confidence) × memo_factor`
  - `p`: BKT の知識確率
  - `confidence = min(1, 正答した日数 (distinct) / 3)`。間隔をあけて 3 日正答して初めて満額
  - `memo_factor`: 理論論点のみ。暗記段階 0〜3 に対して `0.4 + 0.2 × stage`。計算論点は 1.0
- ランク・期待得点・ボス判定・ヒートマップはすべて `mastery` を使う。`p` は内部値。

### 7.2 理論暗記の 3 段階

- 理論論点に `memo_stage` (0 未着手 / 1 キーワード列挙 / 2 骨子再生 / 3 全文再生) を持つ。
- メニューの理論 item は `memo_target = min(3, stage + 1)` を持ち、rubric はその段階の問い方 (キーワード → 骨子 → 全文) で出題する。
- `record --memo-stage N` で、得点 0.7 以上なら `memo_stage = max(現在, N)`。

### 7.3 計算問題の小問分割と部分点

- 計算問題は小問 3〜5 個に分けて出題する (1 item = 1 論点、小問はその論点内)。
- `record` は `--score 0.0〜1.0` (部分点) を受ける。`--correct yes|no` は 1.0 / 0.0 の省略形。
- `score >= 0.7` を正答扱い (忘却間隔・コンボ・ストリーク)。BKT は `p + score×(p_up − p) + (1 − score)×(p_down − p)` で線形ブレンド。

### 7.4 時間の実測

- `coach.py start <subject> --topic ID` が `timer.json` に開始時刻を書く。`record` で `--seconds` を省略すると timer との差分を使い、timer を消す。
- `--now` (ISO datetime) で上書きできる (テスト・再現用)。

### 7.5 マクロ学習計画

- `init` 時に `plan` を作る: 直前期開始日 = 本番 30 日前。単元を weight 降順に並べ、直前期開始日までの日数を weight 比で配分して「この日までにボス撃破」の milestone を置く。
- 目標曲線: 今日の合格確率から直前期開始日に 0.9 へ線形、以後 0.9 で平坦。週 1 点で `plan.target_curve` に持つ。
- `report` に `target_pass_prob_today` / `on_track` / `next_milestone` を出す。dashboard は目標曲線を点線で重ねる。
- `coach.py plan <subject> --rebuild` で現在地から引き直せる。

### 7.6 模試の順位による較正

- `mock --rank N --of M` で順位を受け、`percentile = N / M` を保存する。
- 科目 JSON の `exam.pass_percentile` (既定 0.15) を使い、順位ベースの合格確率 = `P(percentile ≤ pass_percentile)` を正規近似 (sd 0.08) で出す。
- 最終的な合格確率 = 得点ベースと順位ベースの平均 (順位がある直近模試がある時のみ)。

### 7.7 友達側の permission

- `runtime/claude/settings-snippet.json` に `Bash(python3 *zeirishi-coach/scripts/coach.py *)` の allow を置き、README に貼り方を書く。

### 7.8 実装中に入れるもの (B)

- 解説の根拠に e-Gov 法令検索 URL を添える規約 (rubric / style)。
- `attempts.jsonl` を正本とする `rebuild` (init 引数 + ログ再生) と `schema_version`。
- 初回インタビュー項目 (`profile`: 学習歴・予備校・週の可処分時間・苦手単元)。
- 複数科目の配分: `coach.py status` が全科目の合格確率を並べ、SKILL.md は「最も低い科目を先に」の規則で回す。
- 論点 weight の CE ループ: README に「配点ずれの指摘 → JSON 修正 → lint」の手順。

### 7.9 後回し (C)

- リマインド (cron / カレンダー) / 科目追加 (国税徴収法・住民税・事業税・固定資産税・酒税) / export・import / 問題の golden set 人手レビュー / 制度 fact (第 77 回日程・交際費 1 万円改正・生前贈与加算 7 年) の一次ソース裏取り。pitfalls に書いた改正事項は **未確認** として扱い、SKILL.md が「本番年度の法令で確認」と添える。

### 7.10 仮決め (2026-09-05 棚卸しの 5 件。CEO が変えるまでこれで運用)

| # | 論点 | 仮決め | 理由 |
|---|---|---|---|
| 1 | 効果測定の運用 | 友達が週 1 回 `report` で「合格確率 vs 目標」を見る。模試は月 1 回以上 `mock` に入れる。CEO が見たい時は友達が `dashboard.html` を送る (同期の仕組みは作らない) | 1 人用。共有基盤を作るより、on_track の 1 行で足りる |
| 2 | 生成問題の質 | golden set は作らない。最初の 2 週間は、友達が「この問題は変」と言った時に Claude が rubric の該当条件を直す (rubric が育つ) | 問題を保存しない設計なので、直す先は rubric |
| 3 | 配布 | zip で渡す (GitHub 不要)。友達が GitHub を使うなら collaborator 招待に切り替える | 友達の GitHub の有無が未確認 |
| 4 | 理論「全文」の正本 | 友達が手元に置く予備校の理論集を正本にする。暗記段階 3 (全文再生) は Claude が採点せず、友達が理論集と照らして自己採点し `--memo-stage 3` を付ける。Claude は骨子 (段階 2) までを採点する | LLM が条文全文を再生すると誤りが混ざる。全文の正誤は原本でしか判定できない |
| 5 | 2 科目の時間配分 | `status` の合格確率が低い科目に週の学習時間の 6 割、もう一方に 4 割。直前期 (30 日前〜) は本番日が近い科目を優先 | 単純な規則で十分。細かい最適化は効果が測れない |

### 7.11 実装で分かった性質 (Task 2)

- 標準 BKT の誤答更新は、事前確率が約 0.22 未満だと学習遷移項 (`p_learn`) が勝って p がわずかに上がる。実害は無い (未着手帯の中での動き) が、テストの単調性は p ≥ 0.3 で固定した。
- 順位ベースの合格確率は sd 0.08 の正規近似で、上位 5% で約 0.89。閾値の書き方に注意。
