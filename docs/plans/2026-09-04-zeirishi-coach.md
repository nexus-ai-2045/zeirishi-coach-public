# zeirishi-coach Implementation Plan (rev 2: 棚卸し A1〜7 反映)

> 履歴専用（2026-09-05）：旧CLI実装計画です。以下の正本・承認・公開状態・実装指示は当時の記録であり、現行仕様ではありません。現行の唯一の設計は [統合PRODUCT_SPEC.md](../specs/PRODUCT_SPEC.md)。旧比較表の未決6点は現行設計第23節に採否を反映済みですが、v2のFableレビューと人間の採否判断は未完了です。以下の計画を新規実装へ再実行しないでください。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 税理士試験の合格ライン付近の学習者を「確実に合格」させる Claude Code skill (`/zeirishi-coach`) を、論点 tree + 対話フロー + 計測 script (BKT × 確信度 × 暗記段階の習得度 / 忘却曲線 / 合格確率 (得点+順位) / マクロ計画 / ゲーム報酬) の 3 層で作る。

**Architecture:** `references/subjects/*.json` が科目ごとの論点 tree (単元 → 論点、weight 合計 100)。`scripts/coach.py` は argparse の薄い CLI で、ロジックは `scripts/coach_lib/` の 6 module (subjects / model / state / scheduler / report / dashboard) に分ける。state は repo 外 `~/.zeirishi-coach/<subject>/` (state.json + attempts.jsonl が正本 + timer.json)。問題文の生成・採点・解説は SKILL.md の指示で Claude Code 本体が行い、script は LLM を呼ばない。

**Tech Stack:** Python 3.11+ 標準ライブラリのみ。pytest。Markdown + JSON。

**Spec:** `docs/specs/2026-09-04-zeirishi-coach-design.md` (§7 が rev 2 の追加分)

## Global Constraints

- 標準ライブラリのみ。第三者 package を import しない。Python 3.11 以上。
- 論点 file は JSON。`weight` 合計 100 (`abs(total-100) <= 0.01`)。`exam.pass_percentile` 既定 0.15。
- state root は `$ZEIRISHI_COACH_HOME` または `~/.zeirishi-coach`。`schema_version` は 2。
- 誤答分類は `none / knowledge / procedure / time / misread`。
- 得点 `score` は 0.0〜1.0。`score >= 0.7` を正答扱い (`CORRECT_THRESHOLD = 0.7`)。
- 忘却間隔 `1 → 3 → 7 → 14 → 30 日、以後 ×2`。誤答で 1 日。
- 習得度 `mastery = p × (0.4 + 0.6 × min(1, 正答日数/3)) × memo_factor`。`memo_factor = 0.4 + 0.2 × memo_stage` (理論のみ、計算は 1.0)。
- ランク閾値 `0.4 / 0.7 / 0.9` (未着手 / 見習い / 一人前 / 師範) は mastery に対して適用。
- 直前期 = 本番 30 日前から。目標曲線は直前期開始日に 0.9。
- 日付は `YYYY-MM-DD`、時刻は ISO 8601 (`2026-09-04T10:00:00`)。CLI は `--today` / `--now` で上書きできる。
- Claude API を直接呼ばない。repo root に SKILL.md を置き、そのまま `~/.claude/skills/zeirishi-coach/` として使える構成にする。

## 作業場所 (git)

独立 repo `~/Projects/Documents/.repos/nexus_ai/zeirishi-coach` (GitHub: `nexus-ai-2045/zeirishi-coach`, public)。main 直 push はしない。`feat/<task>` branch で commit し、branch push → PR → CEO が merge。commit の identity は `nexus_ai <273569186+nexus-ai-2045@users.noreply.github.com>` (個人名義を出さない)。

```bash
cd ~/Projects/Documents/.repos/nexus_ai/zeirishi-coach
git switch -c feat/coach-core main
```

- [ ] **Step 1: dir を作る**

```bash
cd ~/Projects/Documents/.repos/nexus_ai/zeirishi-coach
mkdir -p scripts/coach_lib references/subjects tests runtime/claude
touch scripts/coach_lib/__init__.py
```

## File Structure

```text
<repo root>/
  SKILL.md / README.md / manifest.yaml                (Task 9)
  references/question-rubric.md, explanation-style.md (Task 9)
  references/subjects/boki.json                       (Task 1)
  references/subjects/{zaihyo,hojin,shohi,sozoku,shotoku}.json (Task 8)
  runtime/claude/settings-snippet.json                (Task 9)
  scripts/coach.py                                    (Task 7)
  scripts/coach_lib/__init__.py, subjects.py          (Task 1)
  scripts/coach_lib/model.py                          (Task 2)
  scripts/coach_lib/state.py                          (Task 3, 7 で追記)
  scripts/coach_lib/scheduler.py                      (Task 4)
  scripts/coach_lib/report.py                         (Task 5)
  scripts/coach_lib/dashboard.py                      (Task 6)
  tests/conftest.py, test_*.py, smoke_one_week.py     (各 Task, Task 10)
```

依存は一方向: `subjects ← model ← state ← scheduler / report ← dashboard ← coach.py`。

---

### Task 1: scaffold + subjects loader/lint + 簿記論 tree

**Files:**
- Create: `scripts/coach_lib/__init__.py` (空)
- Create: `scripts/coach_lib/subjects.py`
- Create: `references/subjects/boki.json`
- Create: `tests/conftest.py`
- Test: `tests/test_subjects.py`

**Interfaces:**
- Produces: `SUBJECTS_DIR: Path`, `load_subject(subject_id, subjects_dir=SUBJECTS_DIR) -> dict`, `list_subjects(subjects_dir=SUBJECTS_DIR) -> list[str]`, `lint_subject(subject) -> list[str]`, `topic_index(subject) -> dict[str, dict]`, `pass_percentile(subject) -> float` (既定 0.15)

- [ ] **Step 2: conftest.py**

```python
import sys
from pathlib import Path

import pytest

COACH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(COACH_ROOT / "scripts"))


@pytest.fixture
def coach_home(tmp_path, monkeypatch):
    home = tmp_path / "coach-home"
    monkeypatch.setenv("ZEIRISHI_COACH_HOME", str(home))
    return home


@pytest.fixture
def subjects_dir():
    return COACH_ROOT / "references" / "subjects"
```

- [ ] **Step 3: 失敗するテスト `tests/test_subjects.py`**

```python
import pytest

from coach_lib import subjects


def test_load_boki_has_units_and_topics(subjects_dir):
    s = subjects.load_subject("boki", subjects_dir)
    assert s["subject"] == "boki"
    assert s["exam"]["passing_line"] == 60
    assert subjects.pass_percentile(s) == pytest.approx(0.15)
    assert len(s["units"]) >= 5 and len(s["topics"]) >= 25


def test_unknown_subject_raises(subjects_dir):
    with pytest.raises(FileNotFoundError):
        subjects.load_subject("nope", subjects_dir)


def test_list_subjects_contains_boki(subjects_dir):
    assert "boki" in subjects.list_subjects(subjects_dir)


def test_lint_rejects_weight_not_100():
    bad = {"subject": "x", "units": [{"id": "x.u", "name": "u"}],
           "topics": [{"id": "x.u.a", "name": "a", "unit": "x.u", "format": "calc", "weight": 50, "frequency": "high", "prereq": []}]}
    assert any("weight sum" in e for e in subjects.lint_subject(bad))


def test_lint_rejects_duplicate_id_unknown_unit_and_prereq():
    bad = {"subject": "x", "units": [{"id": "x.u", "name": "u"}], "topics": [
        {"id": "x.u.a", "name": "a", "unit": "x.u", "format": "calc", "weight": 50, "frequency": "high", "prereq": ["x.u.zzz"]},
        {"id": "x.u.a", "name": "a2", "unit": "x.nope", "format": "essay", "weight": 50, "frequency": "rare", "prereq": []}]}
    joined = "\n".join(subjects.lint_subject(bad))
    for needle in ["duplicate id: x.u.a", "unknown unit x.nope", "unknown prereq x.u.zzz", "format", "frequency"]:
        assert needle in joined


def test_all_shipped_subjects_pass_lint(subjects_dir):
    for sid in subjects.list_subjects(subjects_dir):
        assert subjects.lint_subject(subjects.load_subject(sid, subjects_dir)) == [], sid


def test_topic_index_maps_id_to_topic(subjects_dir):
    idx = subjects.topic_index(subjects.load_subject("boki", subjects_dir))
    assert idx["boki.fixed.depreciation"]["name"] == "減価償却"
```

- [ ] **Step 4: 失敗確認** `python3 -m pytest tests/test_subjects.py -q` → ModuleNotFoundError

- [ ] **Step 5: `scripts/coach_lib/subjects.py`**

```python
"""科目ごとの論点 tree (references/subjects/<id>.json) の load と lint。"""
from __future__ import annotations

import json
from pathlib import Path

SUBJECTS_DIR = Path(__file__).resolve().parent.parent.parent / "references" / "subjects"
FORMATS = {"calc", "theory"}
FREQUENCIES = {"high", "mid", "low"}
DEFAULT_PASS_PERCENTILE = 0.15


def load_subject(subject_id: str, subjects_dir: Path = SUBJECTS_DIR) -> dict:
    path = Path(subjects_dir) / f"{subject_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"unknown subject: {subject_id} ({path})")
    return json.loads(path.read_text(encoding="utf-8"))


def list_subjects(subjects_dir: Path = SUBJECTS_DIR) -> list[str]:
    return sorted(p.stem for p in Path(subjects_dir).glob("*.json"))


def topic_index(subject: dict) -> dict[str, dict]:
    return {t["id"]: t for t in subject.get("topics", [])}


def pass_percentile(subject: dict) -> float:
    return float(subject.get("exam", {}).get("pass_percentile", DEFAULT_PASS_PERCENTILE))


def lint_subject(subject: dict) -> list[str]:
    errors: list[str] = []
    topics = subject.get("topics", [])
    ids = [t.get("id") for t in topics]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        errors.append(f"duplicate id: {dup}")
    total = sum(float(t.get("weight", 0)) for t in topics)
    if abs(total - 100) > 0.01:
        errors.append(f"weight sum is {total:g}, expected 100")
    units = {u.get("id") for u in subject.get("units", [])}
    id_set = set(ids)
    for t in topics:
        tid = t.get("id", "?")
        if t.get("unit") not in units:
            errors.append(f"{tid}: unknown unit {t.get('unit')}")
        if t.get("format") not in FORMATS:
            errors.append(f"{tid}: format must be one of {sorted(FORMATS)}, got {t.get('format')}")
        if t.get("frequency") not in FREQUENCIES:
            errors.append(f"{tid}: frequency must be one of {sorted(FREQUENCIES)}, got {t.get('frequency')}")
        for p in t.get("prereq", []):
            if p not in id_set:
                errors.append(f"{tid}: unknown prereq {p}")
    return errors
```

- [ ] **Step 6: `references/subjects/boki.json`** (weight 合計 100。`exam` に `pass_percentile` を含める)

```json
{
  "subject": "boki",
  "name": "簿記論",
  "exam": {"minutes": 120, "passing_line": 60, "pass_percentile": 0.15, "format": {"calc": 100, "theory": 0}},
  "units": [
    {"id": "boki.sales", "name": "商品売買"},
    {"id": "boki.cash", "name": "現金預金・債権"},
    {"id": "boki.fixed", "name": "有形固定資産"},
    {"id": "boki.intangible", "name": "無形固定資産・研究開発"},
    {"id": "boki.securities", "name": "金融商品"},
    {"id": "boki.liab", "name": "負債・引当金"},
    {"id": "boki.equity", "name": "純資産"},
    {"id": "boki.other", "name": "税効果・外貨・連結"},
    {"id": "boki.ledger", "name": "本支店・製造業・帳簿組織"}
  ],
  "topics": [
    {"id": "boki.sales.shohin", "name": "商品売買と売上原価 (三分法・分記法・売価還元法)", "unit": "boki.sales", "format": "calc", "weight": 6, "frequency": "high", "prereq": [], "pitfalls": ["仕入割引を売上原価から引く", "売価還元法の原価率に値下げを含め忘れる"]},
    {"id": "boki.sales.henpin", "name": "返品・値引・割戻", "unit": "boki.sales", "format": "calc", "weight": 2, "frequency": "mid", "prereq": ["boki.sales.shohin"], "pitfalls": ["割戻と割引の区別"]},
    {"id": "boki.sales.tokushu", "name": "特殊商品売買 (委託・未着品・割賦)", "unit": "boki.sales", "format": "calc", "weight": 4, "frequency": "mid", "prereq": ["boki.sales.shohin"], "pitfalls": ["委託販売の手数料を売上から控除しない", "積送品の期末振替漏れ"]},
    {"id": "boki.cash.genkin", "name": "現金預金と銀行勘定調整表", "unit": "boki.cash", "format": "calc", "weight": 4, "frequency": "high", "prereq": [], "pitfalls": ["未取付小切手を企業側で修正する"]},
    {"id": "boki.cash.saiken", "name": "債権と貸倒引当金 (一般・懸念・破産更生)", "unit": "boki.cash", "format": "calc", "weight": 5, "frequency": "high", "prereq": [], "pitfalls": ["担保処分見込額の控除忘れ", "差額補充法と洗替法の混同"]},
    {"id": "boki.cash.tegata", "name": "手形・電子記録債権 (割引・裏書・不渡)", "unit": "boki.cash", "format": "calc", "weight": 3, "frequency": "mid", "prereq": [], "pitfalls": ["保証債務の時価計上漏れ"]},
    {"id": "boki.fixed.acquisition", "name": "取得原価と資本的支出・収益的支出", "unit": "boki.fixed", "format": "calc", "weight": 3, "frequency": "mid", "prereq": [], "pitfalls": ["付随費用を費用処理する"]},
    {"id": "boki.fixed.depreciation", "name": "減価償却", "unit": "boki.fixed", "format": "calc", "weight": 6, "frequency": "high", "prereq": ["boki.fixed.acquisition"], "pitfalls": ["期中取得の月割を年割にする", "200%定率法の償却保証額の判定漏れ"]},
    {"id": "boki.fixed.disposal", "name": "除却・売却・買換", "unit": "boki.fixed", "format": "calc", "weight": 3, "frequency": "mid", "prereq": ["boki.fixed.depreciation"], "pitfalls": ["売却時点までの減価償却を忘れる"]},
    {"id": "boki.fixed.impairment", "name": "減損会計", "unit": "boki.fixed", "format": "calc", "weight": 4, "frequency": "high", "prereq": ["boki.fixed.depreciation"], "pitfalls": ["認識の判定 (割引前) と測定 (割引後) の混同", "共用資産の配分"]},
    {"id": "boki.fixed.lease", "name": "リース取引 (借手・貸手)", "unit": "boki.fixed", "format": "calc", "weight": 4, "frequency": "high", "prereq": ["boki.fixed.depreciation"], "pitfalls": ["利息法の期首・期末支払の区別", "見積現金購入価額と現在価値の比較"]},
    {"id": "boki.fixed.aro", "name": "資産除去債務", "unit": "boki.fixed", "format": "calc", "weight": 3, "frequency": "mid", "prereq": ["boki.fixed.depreciation"], "pitfalls": ["時の経過による調整額を減価償却に含める"]},
    {"id": "boki.intangible.software", "name": "ソフトウェア・研究開発費", "unit": "boki.intangible", "format": "calc", "weight": 3, "frequency": "mid", "prereq": [], "pitfalls": ["見込販売数量法の翌期以降の再計算漏れ"]},
    {"id": "boki.intangible.goodwill", "name": "のれん・その他の無形固定資産", "unit": "boki.intangible", "format": "calc", "weight": 2, "frequency": "low", "prereq": [], "pitfalls": ["のれんの償却期間を 20 年超にする"]},
    {"id": "boki.securities.classification", "name": "有価証券の分類と期末評価", "unit": "boki.securities", "format": "calc", "weight": 5, "frequency": "high", "prereq": [], "pitfalls": ["その他有価証券の評価差額の税効果漏れ", "部分純資産直入法の前期戻入"]},
    {"id": "boki.securities.bonds", "name": "満期保有目的債券と償却原価法", "unit": "boki.securities", "format": "calc", "weight": 3, "frequency": "high", "prereq": ["boki.securities.classification"], "pitfalls": ["利息法と定額法の混同", "端数利息の処理"]},
    {"id": "boki.securities.derivatives", "name": "デリバティブとヘッジ会計", "unit": "boki.securities", "format": "calc", "weight": 3, "frequency": "mid", "prereq": ["boki.securities.classification"], "pitfalls": ["繰延ヘッジの税効果"]},
    {"id": "boki.liab.provisions", "name": "引当金 (賞与・修繕・製品保証)", "unit": "boki.liab", "format": "calc", "weight": 3, "frequency": "mid", "prereq": [], "pitfalls": ["支給対象期間の按分ミス"]},
    {"id": "boki.liab.bonds-payable", "name": "社債 (発行・償却原価・買入償還)", "unit": "boki.liab", "format": "calc", "weight": 4, "frequency": "high", "prereq": [], "pitfalls": ["買入償還時の償却原価を償還日まで進めない"]},
    {"id": "boki.liab.retirement", "name": "退職給付会計", "unit": "boki.liab", "format": "calc", "weight": 4, "frequency": "high", "prereq": [], "pitfalls": ["数理計算上の差異の発生年度からの償却", "期待運用収益の符号"]},
    {"id": "boki.equity.stock", "name": "株式発行・剰余金の配当・準備金", "unit": "boki.equity", "format": "calc", "weight": 3, "frequency": "mid", "prereq": [], "pitfalls": ["準備金積立額の上限 (資本金の 1/4) 判定"]},
    {"id": "boki.equity.treasury", "name": "自己株式・新株予約権・ストックオプション", "unit": "boki.equity", "format": "calc", "weight": 3, "frequency": "mid", "prereq": ["boki.equity.stock"], "pitfalls": ["自己株式処分差損の処理順序"]},
    {"id": "boki.other.tax-effect", "name": "税効果会計", "unit": "boki.other", "format": "calc", "weight": 4, "frequency": "high", "prereq": ["boki.cash.saiken", "boki.fixed.depreciation"], "pitfalls": ["永久差異に税効果を認識する", "法定実効税率の変更"]},
    {"id": "boki.other.forex", "name": "外貨建取引・為替予約", "unit": "boki.other", "format": "calc", "weight": 4, "frequency": "high", "prereq": [], "pitfalls": ["振当処理の直々差額と直先差額の区別"]},
    {"id": "boki.other.consolidation", "name": "連結・合併の基礎 (のれん・非支配株主持分)", "unit": "boki.other", "format": "calc", "weight": 3, "frequency": "mid", "prereq": ["boki.intangible.goodwill"], "pitfalls": ["非支配株主持分への利益按分漏れ"]},
    {"id": "boki.ledger.branch", "name": "本支店会計 (内部利益・合併財務諸表)", "unit": "boki.ledger", "format": "calc", "weight": 3, "frequency": "mid", "prereq": [], "pitfalls": ["期首内部利益の戻入忘れ"]},
    {"id": "boki.ledger.cost", "name": "製造業会計・工事契約", "unit": "boki.ledger", "format": "calc", "weight": 3, "frequency": "mid", "prereq": [], "pitfalls": ["工事進行基準の進捗度計算"]},
    {"id": "boki.ledger.errors", "name": "帳簿組織・推定問題・誤謬訂正", "unit": "boki.ledger", "format": "calc", "weight": 3, "frequency": "mid", "prereq": [], "pitfalls": ["二重仕訳の控除漏れ"]}
  ]
}
```

- [ ] **Step 7: 通す** `python3 -m pytest tests/test_subjects.py -q` → 7 passed

- [ ] **Step 8: Commit**

```bash
git add scripts/coach_lib/__init__.py scripts/coach_lib/subjects.py references/subjects/boki.json tests/conftest.py tests/test_subjects.py
git commit -m "feat: 論点 tree loader/lint と簿記論 tree を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: model.py (BKT / 部分点ブレンド / 確信度・暗記段階つき習得度 / Elo / SM-2 / 減衰 / 合格確率 (得点+順位) / 目標曲線)

**Files:**
- Create: `scripts/coach_lib/model.py`
- Test: `tests/test_model.py`

**Interfaces (Produces):**
- `bkt_update(p, correct: bool, p_learn, p_guess, p_slip) -> float`
- `bkt_blend(p, score: float, p_learn, p_guess, p_slip) -> float` (`p + score*(up-p) + (1-score)*(down-p)`)
- `expected_correct(p, p_guess, p_slip) -> float`
- `elo_adjusted_learn(p_learn, elo) -> float`, `elo_update(elo, correct, p_expected) -> float`
- `next_interval(reps, correct) -> (interval_days, new_reps)`
- `decay(p, overdue_days, floor) -> float`
- `confidence(correct_days: int) -> float`, `memo_factor(stage: int, fmt: str) -> float`, `mastery(p, correct_days, fmt, memo_stage) -> float`
- `rank(m: float) -> str`
- `expected_score(topic_m: dict[str,float], weights, offset=0.0) -> float`
- `score_sd(speed, mock_scores: list[float]) -> float`
- `pass_probability(expected, sd, passing_line) -> float`
- `rank_probability(percentile: float, pass_percentile: float, sd: float = 0.08) -> float`
- `blend_probability(score_prob: float, rank_prob: float | None) -> float`
- `target_at(start_prob, day_index: int, days_until_final: int, target=0.9) -> float`
- `initial_params(frequency, fmt, level) -> dict`, `level_from_mock(score) -> int`
- 定数: `INTERVALS`, `DECAY_HALF_LIFE_DAYS=21`, `ELO_K=0.05`, `BASE_SD=8.0`, `RANK_THRESHOLDS=(0.4,0.7,0.9)`, `CONFIDENCE_DAYS=3`, `MEMO_STAGES=3`, `CORRECT_THRESHOLD=0.7`, `RANK_SD=0.08`, `TARGET_PROB=0.9`

- [ ] **Step 1: 失敗するテスト `tests/test_model.py`**

```python
import math

import pytest

from coach_lib import model

P = dict(p_learn=0.2, p_guess=0.1, p_slip=0.1)


@pytest.mark.parametrize("p", [0.1, 0.3, 0.5, 0.7, 0.9])
def test_bkt_correct_raises_and_wrong_lowers(p):
    up, down = model.bkt_update(p, True, **P), model.bkt_update(p, False, **P)
    assert 0.0 <= down < p < up <= 1.0


def test_bkt_blend_interpolates():
    p = 0.5
    assert model.bkt_blend(p, 1.0, **P) == pytest.approx(model.bkt_update(p, True, **P))
    assert model.bkt_blend(p, 0.0, **P) == pytest.approx(model.bkt_update(p, False, **P))
    mid = model.bkt_blend(p, 0.5, **P)
    assert model.bkt_update(p, False, **P) < mid < model.bkt_update(p, True, **P)


def test_expected_correct():
    assert model.expected_correct(0.5, 0.1, 0.1) == pytest.approx(0.5)


def test_elo():
    assert model.elo_adjusted_learn(0.2, 0.0) == pytest.approx(0.2)
    assert model.elo_adjusted_learn(0.2, 1.0) > 0.2 > model.elo_adjusted_learn(0.2, -1.0)
    assert model.elo_update(0.0, True, 0.3) > 0.0 > model.elo_update(0.0, False, 0.7)


def test_sm2_interval_table():
    reps, seen = 0, []
    for _ in range(7):
        interval, reps = model.next_interval(reps, True)
        seen.append(interval)
    assert seen == [1, 3, 7, 14, 30, 60, 120]
    assert model.next_interval(5, False) == (1, 0)


def test_decay():
    assert model.decay(0.8, 0, floor=0.1) == 0.8
    assert model.decay(0.8, model.DECAY_HALF_LIFE_DAYS, floor=0.1) == pytest.approx(0.1 + 0.35)
    assert model.decay(0.8, 10_000, floor=0.1) == pytest.approx(0.1, abs=1e-6)


def test_confidence_and_memo_factor():
    assert model.confidence(0) == 0.0 and model.confidence(1) == pytest.approx(1 / 3)
    assert model.confidence(3) == 1.0 == model.confidence(9)
    assert model.memo_factor(0, "calc") == 1.0
    assert model.memo_factor(0, "theory") == pytest.approx(0.4)
    assert model.memo_factor(3, "theory") == pytest.approx(1.0)


def test_mastery_requires_spaced_successes_and_memorization():
    assert model.mastery(0.92, 1, "calc", 0) < model.RANK_THRESHOLDS[1]      # 1 日正答では一人前にならない
    assert model.mastery(0.92, 3, "calc", 0) >= model.RANK_THRESHOLDS[2]     # 3 日正答で師範圏
    assert model.mastery(0.92, 3, "theory", 0) < model.mastery(0.92, 3, "theory", 3)
    assert model.mastery(0.92, 3, "theory", 3) == pytest.approx(0.92)


def test_rank_thresholds():
    assert [model.rank(x) for x in (0.39, 0.4, 0.69, 0.7, 0.9)] == ["未着手", "見習い", "見習い", "一人前", "師範"]


def test_expected_score_and_pass_probability():
    w = {"a": 60.0, "b": 40.0}
    assert model.expected_score({"a": 0.3, "b": 0.3}, w) == pytest.approx(30.0)
    assert model.expected_score({"a": 0.5, "b": 0.5}, w, offset=5.0) == pytest.approx(55.0)
    sd = model.score_sd(1.0, [])
    assert model.pass_probability(30, sd, 60) < model.pass_probability(60, sd, 60) == pytest.approx(0.5) < model.pass_probability(90, sd, 60)
    assert model.score_sd(0.5, []) > model.BASE_SD == model.score_sd(1.0, [])
    assert model.score_sd(1.0, [40, 70]) > model.score_sd(1.0, [55, 55])


def test_rank_probability_and_blend():
    assert model.rank_probability(0.15, 0.15) == pytest.approx(0.5)
    assert model.rank_probability(0.05, 0.15) > 0.9 > 0.1 > model.rank_probability(0.40, 0.15)
    assert model.blend_probability(0.4, None) == 0.4
    assert model.blend_probability(0.4, 0.8) == pytest.approx(0.6)


def test_target_curve_reaches_target_at_final_phase_then_flat():
    assert model.target_at(0.3, 0, 60) == pytest.approx(0.3)
    assert model.target_at(0.3, 30, 60) == pytest.approx(0.6)
    assert model.target_at(0.3, 60, 60) == pytest.approx(0.9)
    assert model.target_at(0.3, 90, 60) == pytest.approx(0.9)
    assert model.target_at(0.95, 10, 60) == pytest.approx(0.95)   # 既に目標超えなら維持
    assert model.target_at(0.3, 5, 0) == pytest.approx(0.9)       # 直前期に入っていれば目標


def test_initial_params_and_level():
    hi, lo = model.initial_params("high", "calc", 3), model.initial_params("low", "calc", 3)
    assert hi["p"] > lo["p"] and hi["p_learn"] > lo["p_learn"]
    assert model.initial_params("high", "theory", 3)["p_guess"] > hi["p_guess"]
    assert model.initial_params("high", "calc", 5)["p"] > hi["p"] > model.initial_params("high", "calc", 1)["p"]
    assert model.level_from_mock(0) == 1 and model.level_from_mock(60) == 3 and model.level_from_mock(100) == 5
```

- [ ] **Step 2: 失敗確認** `python3 -m pytest tests/test_model.py -q` → ModuleNotFoundError

- [ ] **Step 3: `scripts/coach_lib/model.py`**

```python
"""学習モデル (純粋関数のみ)。"""
from __future__ import annotations

import math
import statistics

INTERVALS = [1, 3, 7, 14, 30]
DECAY_HALF_LIFE_DAYS = 21
ELO_K = 0.05
BASE_SD = 8.0
RANK_THRESHOLDS = (0.4, 0.7, 0.9)
RANK_NAMES = ("未着手", "見習い", "一人前", "師範")
CONFIDENCE_DAYS = 3
MEMO_STAGES = 3
CORRECT_THRESHOLD = 0.7
RANK_SD = 0.08
TARGET_PROB = 0.9

_P_INIT = {"high": 0.5, "mid": 0.4, "low": 0.3}
_P_LEARN = {"high": 0.25, "mid": 0.2, "low": 0.15}
_P_GUESS = {"calc": 0.1, "theory": 0.2}
_P_SLIP = 0.1


def bkt_update(p, correct, p_learn, p_guess, p_slip):
    if correct:
        num = p * (1 - p_slip)
        post = num / (num + (1 - p) * p_guess)
    else:
        num = p * p_slip
        post = num / (num + (1 - p) * (1 - p_guess))
    return min(1.0, post + (1 - post) * p_learn)


def bkt_blend(p, score, p_learn, p_guess, p_slip):
    up = bkt_update(p, True, p_learn, p_guess, p_slip)
    down = bkt_update(p, False, p_learn, p_guess, p_slip)
    return p + score * (up - p) + (1 - score) * (down - p)


def expected_correct(p, p_guess, p_slip):
    return p * (1 - p_slip) + (1 - p) * p_guess


def elo_adjusted_learn(p_learn, elo):
    logit = math.log(p_learn / (1 - p_learn)) + elo
    return 1 / (1 + math.exp(-logit))


def elo_update(elo, correct, p_expected):
    return elo + ELO_K * ((1.0 if correct else 0.0) - p_expected)


def next_interval(reps, correct):
    if not correct:
        return 1, 0
    if reps < len(INTERVALS):
        return INTERVALS[reps], reps + 1
    return INTERVALS[-1] * 2 ** (reps - len(INTERVALS) + 1), reps + 1


def decay(p, overdue_days, floor):
    if overdue_days <= 0:
        return p
    return floor + (p - floor) * 0.5 ** (overdue_days / DECAY_HALF_LIFE_DAYS)


def confidence(correct_days):
    return min(1.0, correct_days / CONFIDENCE_DAYS)


def memo_factor(stage, fmt):
    if fmt != "theory":
        return 1.0
    return 0.4 + 0.2 * min(MEMO_STAGES, max(0, stage))


def mastery(p, correct_days, fmt, memo_stage):
    return p * (0.4 + 0.6 * confidence(correct_days)) * memo_factor(memo_stage, fmt)


def rank(m):
    for threshold, name in zip(reversed(RANK_THRESHOLDS), reversed(RANK_NAMES[1:])):
        if m >= threshold:
            return name
    return RANK_NAMES[0]


def expected_score(topic_m, weights, offset=0.0):
    return sum(topic_m.get(t, 0.0) * w for t, w in weights.items()) + offset


def score_sd(speed, mock_scores):
    sd = BASE_SD + BASE_SD * (1 - speed)
    if len(mock_scores) >= 2:
        sd = math.sqrt(sd**2 + statistics.pvariance(mock_scores))
    return sd


def _norm_cdf(z):
    return 0.5 * (1 + math.erf(z / math.sqrt(2)))


def pass_probability(expected, sd, passing_line):
    return 1 - _norm_cdf((passing_line - expected) / sd)


def rank_probability(percentile, pass_percentile, sd=RANK_SD):
    return _norm_cdf((pass_percentile - percentile) / sd)


def blend_probability(score_prob, rank_prob):
    return score_prob if rank_prob is None else (score_prob + rank_prob) / 2


def target_at(start_prob, day_index, days_until_final, target=TARGET_PROB):
    if start_prob >= target:
        return start_prob
    if days_until_final <= 0 or day_index >= days_until_final:
        return target
    return start_prob + (target - start_prob) * day_index / days_until_final


def initial_params(frequency, fmt, level):
    p = _P_INIT[frequency] + (level - 3) * 0.08
    return {"p": min(0.95, max(0.05, p)), "p_learn": _P_LEARN[frequency],
            "p_guess": _P_GUESS[fmt], "p_slip": _P_SLIP}


def level_from_mock(score):
    return min(5, max(1, round(score / 20)))
```

- [ ] **Step 4: 通す** `python3 -m pytest tests/test_model.py -q` → 17 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/coach_lib/model.py tests/test_model.py
git commit -m "feat: 学習モデル (BKT/確信度/暗記段階/順位較正/目標曲線) を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: state.py (init + profile + plan / load / save / 減衰 / timer / record + 報酬)

**Files:**
- Create: `scripts/coach_lib/state.py`
- Test: `tests/test_state.py`

**Interfaces (Produces):**
- `today_iso() -> str`, `now_iso() -> str`, `days_between(a, b) -> int`, `add_days(d, n) -> str`
- `state_root() -> Path`, `state_dir(subject_id) -> Path`
- `init_state(subject, exam_date, level=None, mock_score=None, today=None, profile=None) -> dict` (`init_args` を保存)
- `load_state(subject_id) -> dict` / `save_state(st) -> Path`
- `append_log(st, row) -> None` (`attempts.jsonl`。row は `kind: "attempt" | "mock"`)
- `weights_of(subject) -> dict[str, float]`
- `topic_mastery(st, subject, topic_id) -> float`
- `compute_scores(st, subject) -> (expected, sd, pass_prob)` (順位ブレンド込み)
- `snapshot_history(st, subject, today, minutes_delta=0.0) -> dict`
- `apply_decay(st, subject, today) -> int`
- `build_plan(st, subject, today) -> dict` (`{"created", "final_phase_start", "milestones": [{"unit","name","target_date","weight"}], "target_curve": [{"date","pass_prob"}]}`)
- `target_prob_today(st, today) -> float`
- `start_timer(subject_id, topic_id, now) -> Path`, `read_timer(subject_id) -> dict | None`, `clear_timer(subject_id) -> None`, `elapsed_seconds(timer, now) -> int`
- `record_attempt(st, subject, topic_id, score: float, seconds, error_class, difficulty, today, memo_stage=None) -> dict` (報酬: `xp, combo, fading_bonus, revenge, new_titles, rank_before, rank_after, mastery_before, mastery_after, correct`)
- 定数 `SCHEMA_VERSION=2`, `ERROR_CLASSES`, `XP_CORRECT=10`, `XP_WRONG=3`, `XP_REVENGE=5`, `FINAL_PHASE_DAYS=30`, `TITLE_FIRST/MASTER/VETERAN/STREAK/TIME`

topic entry: `{p, p_learn, p_guess, p_slip, interval_days, reps, due, last_seen, attempts, correct, wrong, correct_days: [], memo_stage: 0}`

- [ ] **Step 1: 失敗するテスト `tests/test_state.py`**

```python
import json

import pytest

from coach_lib import model, state, subjects

TODAY = "2026-09-04"
DEP = "boki.fixed.depreciation"


@pytest.fixture
def boki(subjects_dir):
    return subjects.load_subject("boki", subjects_dir)


@pytest.fixture
def st(boki, coach_home):
    s = state.init_state(boki, exam_date="2027-08-05", level=3, today=TODAY,
                         profile={"weekly_hours": 10, "school": "TAC", "note": "減価償却が苦手"})
    state.save_state(s)
    return s


def test_init_creates_topics_profile_plan_history(st, boki, coach_home):
    assert st["schema_version"] == state.SCHEMA_VERSION
    assert set(st["topics"]) == {t["id"] for t in boki["topics"]}
    assert st["topics"][DEP]["p"] == pytest.approx(0.5)
    assert st["topics"][DEP]["correct_days"] == [] and st["topics"][DEP]["memo_stage"] == 0
    assert st["profile"]["weekly_hours"] == 10
    assert st["init_args"]["level"] == 3
    assert st["history"][0]["date"] == TODAY and 0 < st["history"][0]["pass_prob"] < 1
    assert (coach_home / "boki" / "state.json").exists()


def test_plan_milestones_cover_all_units_before_final_phase(st, boki):
    plan = st["plan"]
    assert plan["final_phase_start"] == "2027-07-06"
    assert [m["unit"] for m in plan["milestones"]] and len(plan["milestones"]) == len(boki["units"])
    dates = [m["target_date"] for m in plan["milestones"]]
    assert dates == sorted(dates) and dates[-1] <= plan["final_phase_start"]
    assert plan["milestones"][0]["weight"] >= plan["milestones"][-1]["weight"]
    assert plan["target_curve"][0]["date"] == TODAY
    assert plan["target_curve"][-1]["pass_prob"] == pytest.approx(0.9)
    assert state.target_prob_today(st, TODAY) == pytest.approx(st["history"][0]["pass_prob"])
    assert state.target_prob_today(st, "2027-07-20") == pytest.approx(0.9)


def test_init_with_mock_score_sets_level(boki, coach_home):
    s = state.init_state(boki, exam_date="2027-08-05", mock_score=100, today=TODAY)
    assert s["topics"][DEP]["p"] > 0.5


def test_load_roundtrip_and_missing(st, coach_home):
    assert state.load_state("boki")["topics"] == st["topics"]
    with pytest.raises(FileNotFoundError):
        state.load_state("zaihyo")


def test_record_correct_updates_topic_and_rewards(st, boki):
    r = state.record_attempt(st, boki, DEP, 1.0, 240, "none", 3, TODAY)
    t = st["topics"][DEP]
    assert r["correct"] is True and t["p"] > 0.5
    assert t["due"] == "2026-09-05" and t["reps"] == 1 and t["correct"] == 1
    assert t["correct_days"] == [TODAY]
    assert r["xp"] >= state.XP_CORRECT and st["xp"] == r["xp"]
    assert r["mastery_after"] < model.RANK_THRESHOLDS[1]   # 1 日正答では見習い止まり
    assert st["streak"] == {"days": 1, "last_study_date": TODAY}


def test_partial_score_blends_and_threshold(st, boki):
    p0 = st["topics"][DEP]["p"]
    r = state.record_attempt(st, boki, DEP, 0.5, 240, "procedure", 3, TODAY)
    assert r["correct"] is False
    assert st["topics"][DEP]["p"] == pytest.approx(model.bkt_blend(p0, 0.5, 0.25, 0.1, 0.1))
    r2 = state.record_attempt(st, boki, DEP, 0.7, 240, "none", 3, TODAY)
    assert r2["correct"] is True


def test_correct_days_are_distinct_and_mastery_grows_over_days(st, boki):
    for d in ["2026-09-04", "2026-09-04", "2026-09-05", "2026-09-08"]:
        r = state.record_attempt(st, boki, DEP, 1.0, 100, "none", 3, d)
    assert st["topics"][DEP]["correct_days"] == ["2026-09-04", "2026-09-05", "2026-09-08"]
    assert r["mastery_after"] >= model.RANK_THRESHOLDS[2]


def test_memo_stage_only_rises_on_pass(st, boki):
    boki_theory = {**boki, "topics": [{**t, "format": "theory"} if t["id"] == DEP else t for t in boki["topics"]]}
    state.record_attempt(st, boki_theory, DEP, 0.5, 100, "knowledge", 3, TODAY, memo_stage=2)
    assert st["topics"][DEP]["memo_stage"] == 0
    state.record_attempt(st, boki_theory, DEP, 0.9, 100, "none", 3, TODAY, memo_stage=2)
    assert st["topics"][DEP]["memo_stage"] == 2
    state.record_attempt(st, boki_theory, DEP, 0.9, 100, "none", 3, TODAY, memo_stage=1)
    assert st["topics"][DEP]["memo_stage"] == 2
    assert state.topic_mastery(st, boki_theory, DEP) < state.topic_mastery(st, boki, DEP)


def test_wrong_lowers_p_and_resets_interval(st, boki):
    state.record_attempt(st, boki, DEP, 1.0, 200, "none", 3, TODAY)
    state.record_attempt(st, boki, DEP, 1.0, 200, "none", 3, TODAY)
    p_before = st["topics"][DEP]["p"]
    state.record_attempt(st, boki, DEP, 0.0, 200, "knowledge", 3, TODAY)
    t = st["topics"][DEP]
    assert t["p"] < p_before and t["reps"] == 0 and t["interval_days"] == 1
    assert st["combo"] == 0


def test_time_error_does_not_touch_p_but_lowers_speed(st, boki):
    p_before = st["topics"][DEP]["p"]
    state.record_attempt(st, boki, DEP, 0.0, 900, "time", 3, TODAY)
    assert st["topics"][DEP]["p"] == pytest.approx(p_before)
    assert st["speed"] < 1.0 and st["time_errors_total"] == 1


def test_misread_applies_half_update(st, boki):
    p0 = st["topics"][DEP]["p"]
    full = model.bkt_blend(p0, 0.0, 0.25, 0.1, 0.1)
    state.record_attempt(st, boki, DEP, 0.0, 200, "misread", 3, TODAY)
    assert st["topics"][DEP]["p"] == pytest.approx(p0 + (full - p0) / 2)


def test_invalid_inputs_rejected(st, boki):
    with pytest.raises(ValueError):
        state.record_attempt(st, boki, DEP, 0.0, 10, "lazy", 3, TODAY)
    with pytest.raises(ValueError):
        state.record_attempt(st, boki, DEP, 1.5, 10, "none", 3, TODAY)
    with pytest.raises(KeyError):
        state.record_attempt(st, boki, "boki.nope", 1.0, 10, "none", 3, TODAY)


def test_combo_revenge_fading(st, boki):
    r1 = state.record_attempt(st, boki, "boki.sales.shohin", 1.0, 100, "none", 3, TODAY)
    r2 = state.record_attempt(st, boki, "boki.cash.genkin", 1.0, 100, "none", 3, TODAY)
    assert r2["combo"] == 2 and r2["xp"] > r1["xp"]
    state.record_attempt(st, boki, "boki.fixed.lease", 0.0, 100, "knowledge", 3, TODAY)
    r4 = state.record_attempt(st, boki, "boki.fixed.lease", 1.0, 100, "none", 3, "2026-09-05")
    assert r4["revenge"] and r4["fading_bonus"] and r4["xp"] >= 2 * state.XP_CORRECT


def test_streak(st, boki):
    for d in ["2026-09-04", "2026-09-05"]:
        state.record_attempt(st, boki, "boki.sales.shohin", 1.0, 100, "none", 3, d)
    assert st["streak"]["days"] == 2
    state.record_attempt(st, boki, "boki.sales.shohin", 1.0, 100, "none", 3, "2026-09-09")
    assert st["streak"]["days"] == 1


def test_titles(st, boki):
    r = state.record_attempt(st, boki, "boki.sales.shohin", 1.0, 100, "none", 3, TODAY)
    assert state.TITLE_FIRST in r["new_titles"]
    for d in ["2026-09-05", "2026-09-06", "2026-09-07"]:
        state.record_attempt(st, boki, "boki.sales.shohin", 1.0, 100, "none", 3, d)
    assert state.TITLE_MASTER in st["titles"]
    state.record_attempt(st, boki, "boki.cash.genkin", 0.0, 900, "time", 3, "2026-09-07")
    for _ in range(25):
        state.record_attempt(st, boki, "boki.cash.genkin", 1.0, 100, "none", 3, "2026-09-07")
    assert state.TITLE_TIME in st["titles"]


def test_apply_decay_once_per_overdue_period(st, boki):
    state.record_attempt(st, boki, "boki.sales.shohin", 1.0, 100, "none", 3, TODAY)
    p_due, p_other = st["topics"]["boki.sales.shohin"]["p"], st["topics"]["boki.cash.genkin"]["p"]
    assert state.apply_decay(st, boki, "2026-09-26") == 1
    assert st["topics"]["boki.sales.shohin"]["p"] < p_due
    assert st["topics"]["boki.cash.genkin"]["p"] == pytest.approx(p_other)
    p1 = st["topics"]["boki.sales.shohin"]["p"]
    assert state.apply_decay(st, boki, "2026-09-26") == 0
    assert st["topics"]["boki.sales.shohin"]["p"] == pytest.approx(p1)


def test_timer(coach_home):
    assert state.read_timer("boki") is None
    state.start_timer("boki", DEP, "2026-09-04T10:00:00")
    timer = state.read_timer("boki")
    assert timer["topic"] == DEP
    assert state.elapsed_seconds(timer, "2026-09-04T10:04:30") == 270
    state.clear_timer("boki")
    assert state.read_timer("boki") is None


def test_log_and_history(st, boki, coach_home):
    state.record_attempt(st, boki, "boki.sales.shohin", 1.0, 120, "none", 3, TODAY)
    rows = [json.loads(l) for l in (coach_home / "boki" / "attempts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert rows[-1]["kind"] == "attempt" and rows[-1]["topic"] == "boki.sales.shohin" and rows[-1]["score"] == 1.0
    assert st["history"][-1]["minutes"] == pytest.approx(2.0)
    assert state.days_between("2026-09-04", "2026-09-06") == 2
```

- [ ] **Step 2: 失敗確認** `python3 -m pytest tests/test_state.py -q` → ModuleNotFoundError

- [ ] **Step 3: `scripts/coach_lib/state.py`**

```python
"""学習 state の永続化、マクロ計画、timer、1 問ごとの更新 (BKT・忘却・XP・称号)。"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta
from pathlib import Path

from . import model
from .subjects import pass_percentile, topic_index

SCHEMA_VERSION = 2
ERROR_CLASSES = ("none", "knowledge", "procedure", "time", "misread")
XP_CORRECT, XP_WRONG, XP_REVENGE = 10, 3, 5
COMBO_STEP, COMBO_CAP = 2, 10
SPEED_PENALTY, SPEED_RECOVERY, SPEED_MIN = 0.05, 0.01, 0.5
FINAL_PHASE_DAYS = 30
TITLE_FIRST, TITLE_MASTER, TITLE_VETERAN, TITLE_STREAK, TITLE_TIME = "初陣", "師範への道", "百戦錬磨", "皆勤", "捨て問の目利き"


def today_iso() -> str:
    return date.today().isoformat()


def now_iso() -> str:
    return datetime.now().replace(microsecond=0).isoformat()


def days_between(a: str, b: str) -> int:
    return (date.fromisoformat(b) - date.fromisoformat(a)).days


def add_days(d: str, n: int) -> str:
    return (date.fromisoformat(d) + timedelta(days=n)).isoformat()


def state_root() -> Path:
    return Path(os.environ.get("ZEIRISHI_COACH_HOME", Path.home() / ".zeirishi-coach"))


def state_dir(subject_id: str) -> Path:
    return state_root() / subject_id


# ---------- init / persist ----------

def init_state(subject, exam_date, level=None, mock_score=None, today=None, profile=None) -> dict:
    today = today or today_iso()
    if level is None:
        level = model.level_from_mock(mock_score) if mock_score is not None else 3
    topics = {}
    for t in subject["topics"]:
        topics[t["id"]] = {**model.initial_params(t["frequency"], t["format"], level),
                           "interval_days": 0, "reps": 0, "due": None, "last_seen": None,
                           "attempts": 0, "correct": 0, "wrong": 0, "correct_days": [], "memo_stage": 0}
    st = {
        "schema_version": SCHEMA_VERSION, "subject": subject["subject"], "exam_date": exam_date,
        "created": today, "init_args": {"exam_date": exam_date, "level": level, "mock_score": mock_score, "today": today},
        "profile": dict(profile or {}), "elo": 0.0, "speed": 1.0, "xp": 0, "combo": 0,
        "streak": {"days": 0, "last_study_date": None}, "titles": [], "mock_scores": [],
        "calibration_offset": 0.0, "attempts_total": 0, "time_errors_total": 0,
        "attempts_since_time_error": 0, "last_decay_date": today, "topics": topics, "history": [], "plan": None,
    }
    if mock_score is not None:
        st["mock_scores"].append({"date": today, "score": float(mock_score), "minutes": None,
                                  "expected_at": None, "percentile": None})
    snapshot_history(st, subject, today)
    st["plan"] = build_plan(st, subject, today)
    return st


def load_state(subject_id: str) -> dict:
    path = state_dir(subject_id) / "state.json"
    if not path.exists():
        raise FileNotFoundError(f"no state for {subject_id}: run `coach.py init {subject_id}` first")
    return json.loads(path.read_text(encoding="utf-8"))


def save_state(st: dict) -> Path:
    d = state_dir(st["subject"])
    d.mkdir(parents=True, exist_ok=True)
    path = d / "state.json"
    path.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def append_log(st: dict, row: dict) -> None:
    d = state_dir(st["subject"])
    d.mkdir(parents=True, exist_ok=True)
    with (d / "attempts.jsonl").open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


# ---------- scores ----------

def weights_of(subject: dict) -> dict[str, float]:
    return {t["id"]: float(t["weight"]) for t in subject["topics"]}


def topic_mastery(st: dict, subject: dict, topic_id: str) -> float:
    t = st["topics"][topic_id]
    fmt = topic_index(subject)[topic_id]["format"]
    return model.mastery(t["p"], len(t["correct_days"]), fmt, t["memo_stage"])


def compute_scores(st: dict, subject: dict) -> tuple[float, float, float]:
    weights = weights_of(subject)
    topic_m = {tid: topic_mastery(st, subject, tid) for tid in weights}
    expected = model.expected_score(topic_m, weights, st["calibration_offset"])
    sd = model.score_sd(st["speed"], [m["score"] for m in st["mock_scores"]])
    score_prob = model.pass_probability(expected, sd, subject["exam"]["passing_line"])
    ranked = [m for m in st["mock_scores"] if m.get("percentile") is not None]
    rank_prob = model.rank_probability(ranked[-1]["percentile"], pass_percentile(subject)) if ranked else None
    return expected, sd, model.blend_probability(score_prob, rank_prob)


def snapshot_history(st, subject, today, minutes_delta=0.0) -> dict:
    expected, _sd, prob = compute_scores(st, subject)
    m_avg = sum(topic_mastery(st, subject, tid) for tid in st["topics"]) / max(1, len(st["topics"]))
    if st["history"] and st["history"][-1]["date"] == today:
        row = st["history"][-1]
    else:
        row = {"date": today, "minutes": 0.0}
        st["history"].append(row)
    row.update({"pass_prob": round(prob, 4), "expected": round(expected, 2), "mastery_avg": round(m_avg, 4)})
    row["minutes"] = round(row["minutes"] + minutes_delta, 2)
    return row


def apply_decay(st, subject, today) -> int:
    last = st.get("last_decay_date") or today
    if days_between(last, today) <= 0:
        return 0
    changed = 0
    for t in st["topics"].values():
        if not t["due"]:
            continue
        delta = max(0, days_between(t["due"], today)) - max(0, days_between(t["due"], last))
        if delta > 0:
            t["p"] = model.decay(t["p"], delta, floor=t["p_guess"])
            changed += 1
    st["last_decay_date"] = today
    return changed


# ---------- macro plan ----------

def build_plan(st, subject, today) -> dict:
    final_start = add_days(st["exam_date"], -FINAL_PHASE_DAYS)
    days_until_final = max(0, days_between(today, final_start))
    units = sorted(subject["units"], key=lambda u: -sum(float(t["weight"]) for t in subject["topics"] if t["unit"] == u["id"]))
    total_w = sum(float(t["weight"]) for t in subject["topics"]) or 1.0
    milestones, cursor = [], 0.0
    for u in units:
        w = sum(float(t["weight"]) for t in subject["topics"] if t["unit"] == u["id"])
        cursor += w
        milestones.append({"unit": u["id"], "name": u["name"], "weight": w,
                           "target_date": add_days(today, int(round(days_until_final * cursor / total_w)))})
    start_prob = compute_scores(st, subject)[2]
    curve = [{"date": add_days(today, d), "pass_prob": round(model.target_at(start_prob, d, days_until_final), 4)}
             for d in range(0, days_until_final + 1, 7)]
    if not curve or curve[-1]["date"] != final_start:
        curve.append({"date": final_start, "pass_prob": round(model.target_at(start_prob, days_until_final, days_until_final), 4)})
    return {"created": today, "start_prob": round(start_prob, 4), "final_phase_start": final_start,
            "milestones": milestones, "target_curve": curve}


def target_prob_today(st, today) -> float:
    plan = st["plan"]
    days_until_final = max(0, days_between(plan["created"], plan["final_phase_start"]))
    return model.target_at(plan["start_prob"], days_between(plan["created"], today), days_until_final)


# ---------- timer ----------

def _timer_path(subject_id: str) -> Path:
    return state_dir(subject_id) / "timer.json"


def start_timer(subject_id, topic_id, now) -> Path:
    p = _timer_path(subject_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"topic": topic_id, "started_at": now}), encoding="utf-8")
    return p


def read_timer(subject_id):
    p = _timer_path(subject_id)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def clear_timer(subject_id) -> None:
    p = _timer_path(subject_id)
    if p.exists():
        p.unlink()


def elapsed_seconds(timer, now) -> int:
    return int((datetime.fromisoformat(now) - datetime.fromisoformat(timer["started_at"])).total_seconds())


# ---------- record ----------

def _update_streak(st, today):
    last = st["streak"]["last_study_date"]
    if last == today:
        return
    st["streak"]["days"] = st["streak"]["days"] + 1 if last and days_between(last, today) == 1 else 1
    st["streak"]["last_study_date"] = today


def _grant_titles(st, mastery_after):
    checks = [(TITLE_FIRST, st["attempts_total"] >= 1),
              (TITLE_MASTER, mastery_after >= model.RANK_THRESHOLDS[2]),
              (TITLE_VETERAN, st["attempts_total"] >= 100),
              (TITLE_STREAK, st["streak"]["days"] >= 7),
              (TITLE_TIME, st["time_errors_total"] >= 1 and st["attempts_since_time_error"] >= 25)]
    new = [title for title, ok in checks if ok and title not in st["titles"]]
    st["titles"].extend(new)
    return new


def record_attempt(st, subject, topic_id, score, seconds, error_class, difficulty, today, memo_stage=None) -> dict:
    if error_class not in ERROR_CLASSES:
        raise ValueError(f"error_class must be one of {ERROR_CLASSES}, got {error_class}")
    if not 0.0 <= float(score) <= 1.0:
        raise ValueError(f"score must be 0.0-1.0, got {score}")
    if topic_id not in st["topics"]:
        raise KeyError(f"unknown topic {topic_id}")
    apply_decay(st, subject, today)
    t = st["topics"][topic_id]
    correct = float(score) >= model.CORRECT_THRESHOLD
    p_before, m_before = t["p"], topic_mastery(st, subject, topic_id)
    fading = bool(t["due"]) and days_between(today, t["due"]) <= 1
    had_wrong = t["wrong"] > 0

    if error_class == "time":
        st["speed"] = max(SPEED_MIN, st["speed"] - SPEED_PENALTY)
        st["time_errors_total"] += 1
        st["attempts_since_time_error"] = 0
    else:
        p_learn = model.elo_adjusted_learn(t["p_learn"], st["elo"])
        full = model.bkt_blend(t["p"], float(score), p_learn, t["p_guess"], t["p_slip"])
        t["p"] = t["p"] + (full - t["p"]) / 2 if error_class == "misread" else full
        if error_class != "misread":
            st["elo"] = model.elo_update(st["elo"], correct, model.expected_correct(p_before, t["p_guess"], t["p_slip"]))
        st["attempts_since_time_error"] += 1
        if correct:
            st["speed"] = min(1.0, st["speed"] + SPEED_RECOVERY)

    t["interval_days"], t["reps"] = model.next_interval(t["reps"], correct)
    t["due"], t["last_seen"] = add_days(today, t["interval_days"]), today
    t["attempts"] += 1
    t["correct" if correct else "wrong"] += 1
    if correct and today not in t["correct_days"]:
        t["correct_days"].append(today)
    if correct and memo_stage is not None:
        t["memo_stage"] = max(t["memo_stage"], min(model.MEMO_STAGES, int(memo_stage)))
    st["attempts_total"] += 1
    _update_streak(st, today)

    st["combo"] = st["combo"] + 1 if correct else 0
    revenge, fading_bonus = correct and had_wrong, correct and fading
    xp = int((XP_CORRECT if correct else XP_WRONG) * (1 + 0.2 * (difficulty - 3)))
    if correct:
        xp += min(COMBO_CAP, COMBO_STEP * (st["combo"] - 1))
    if revenge:
        xp += XP_REVENGE
    if fading_bonus:
        xp *= 2
    st["xp"] += xp
    m_after = topic_mastery(st, subject, topic_id)
    new_titles = _grant_titles(st, m_after)

    append_log(st, {"kind": "attempt", "date": today, "topic": topic_id, "score": float(score), "correct": correct,
                    "seconds": seconds, "error_class": error_class, "difficulty": difficulty,
                    "memo_stage": memo_stage, "p_before": round(p_before, 4), "p_after": round(t["p"], 4), "xp": xp})
    snapshot_history(st, subject, today, minutes_delta=seconds / 60)
    return {"xp": xp, "combo": st["combo"], "fading_bonus": fading_bonus, "revenge": revenge,
            "new_titles": new_titles, "rank_before": model.rank(m_before), "rank_after": model.rank(m_after),
            "mastery_before": round(m_before, 4), "mastery_after": round(m_after, 4), "correct": correct}
```

- [ ] **Step 4: 通す** `python3 -m pytest tests/test_state.py -q` → 19 passed。`test_plan_milestones…` の `final_phase_start` は 2027-08-05 の 30 日前 = 2027-07-06。

- [ ] **Step 5: Commit**

```bash
git add scripts/coach_lib/state.py tests/test_state.py
git commit -m "feat: state (init/plan/timer/record/報酬) を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: scheduler.py (今日のメニュー / 3 クエスト / 論点混在 / 暗記段階)

**Files:**
- Create: `scripts/coach_lib/scheduler.py`
- Test: `tests/test_scheduler.py`

**Interfaces:**
- Consumes: `state.apply_decay`, `state.days_between`, `state.topic_mastery`, `subjects.topic_index`
- Produces:
  - `build_menu(st, subject, today, n=10) -> dict` = `{"date", "n", "quests": [{"name": "復習"|"弱点"|"挑戦", "items": [...]}], "items": [混在順]}`
  - item = `{topic, name, unit, unit_name, format, difficulty (2..5), budget_seconds, fading, xp_multiplier, reason, mastery, memo_stage, memo_target (理論のみ、計算は None), pitfalls}`
  - `difficulty_for(m: float) -> int`, `budget_seconds(topic) -> int`, `interleave(items) -> list`, `diagnostic_menu(st, subject, today) -> dict` (単元ごとに weight 最大の論点、quest 名 `診断`)

- [ ] **Step 1: 失敗するテスト `tests/test_scheduler.py`**

```python
import pytest

from coach_lib import scheduler, state, subjects

TODAY = "2026-09-04"


@pytest.fixture
def boki(subjects_dir):
    return subjects.load_subject("boki", subjects_dir)


@pytest.fixture
def zaihyo(subjects_dir):
    return subjects.load_subject("zaihyo", subjects_dir)


@pytest.fixture
def st(boki, coach_home):
    return state.init_state(boki, exam_date="2027-08-05", level=3, today=TODAY)


def test_menu_shape(st, boki):
    menu = scheduler.build_menu(st, boki, TODAY, n=10)
    assert len(menu["items"]) == 10
    assert [q["name"] for q in menu["quests"]] == ["復習", "弱点", "挑戦"]
    ids = [i["topic"] for i in menu["items"]]
    assert len(ids) == len(set(ids)) and sum(len(q["items"]) for q in menu["quests"]) == 10
    assert all(i["memo_target"] is None for i in menu["items"])   # 簿記論は計算のみ


def test_due_topics_first_and_fading(st, boki):
    state.record_attempt(st, boki, "boki.equity.treasury", 1.0, 100, "none", 3, "2026-09-01")
    state.record_attempt(st, boki, "boki.intangible.goodwill", 1.0, 100, "none", 3, "2026-09-03")
    review = scheduler.build_menu(st, boki, TODAY, n=10)["quests"][0]["items"]
    assert {i["topic"] for i in review} == {"boki.equity.treasury", "boki.intangible.goodwill"}
    assert all(i["fading"] and i["xp_multiplier"] == 2 for i in review)


def test_weak_prefers_high_weight_low_mastery(st, boki):
    st["topics"]["boki.fixed.depreciation"]["p"] = 0.05
    st["topics"]["boki.fixed.acquisition"]["p"] = 0.9
    st["topics"]["boki.fixed.acquisition"]["correct_days"] = ["2026-09-01", "2026-09-02", "2026-09-03"]
    weak_ids = [i["topic"] for i in scheduler.build_menu(st, boki, TODAY, n=6)["quests"][1]["items"]]
    assert weak_ids[0] == "boki.fixed.depreciation"


def test_weak_prereq_substituted(st, boki):
    st["topics"]["boki.fixed.depreciation"]["p"] = 0.05
    st["topics"]["boki.fixed.acquisition"]["p"] = 0.1
    menu = scheduler.build_menu(st, boki, TODAY, n=4)
    item = next(i for i in menu["items"] if i["topic"] == "boki.fixed.acquisition")
    assert "前提" in item["reason"]


def test_challenge_picks_mid_mastery_high_weight(st, boki):
    for t in st["topics"].values():
        t["p"], t["correct_days"] = 0.2, []
    for tid in ("boki.sales.shohin", "boki.fixed.depreciation"):
        st["topics"][tid]["p"] = 0.8
        st["topics"][tid]["correct_days"] = ["2026-09-01", "2026-09-02"]     # mastery = 0.8*(0.4+0.4) = 0.64
    challenge = {i["topic"] for i in scheduler.build_menu(st, boki, TODAY, n=10)["quests"][2]["items"]}
    assert challenge == {"boki.sales.shohin", "boki.fixed.depreciation"}


def test_interleave():
    items = [{"topic": f"t{i}", "unit": "u1"} for i in range(3)] + [{"topic": f"s{i}", "unit": "u2"} for i in range(3)]
    out = scheduler.interleave(items)
    assert sorted(i["topic"] for i in out) == sorted(i["topic"] for i in items)
    assert all(a["unit"] != b["unit"] for a, b in zip(out, out[1:]))
    menu = scheduler.build_menu(state.init_state(subjects.load_subject("boki"), "2027-08-05", 3, today=TODAY), subjects.load_subject("boki"), TODAY, n=10)
    assert sum(1 for a, b in zip(menu["items"], menu["items"][1:]) if a["unit"] == b["unit"]) == 0


def test_theory_items_carry_memo_target(zaihyo, coach_home):
    st = state.init_state(zaihyo, exam_date="2027-08-05", level=3, today=TODAY)
    st["topics"]["zaihyo.theory.revenue"]["memo_stage"] = 2
    menu = scheduler.build_menu(st, zaihyo, TODAY, n=12)
    theory = [i for i in menu["items"] if i["format"] == "theory"]
    assert theory and all(i["memo_target"] == min(3, i["memo_stage"] + 1) for i in theory)
    rev = next((i for i in menu["items"] if i["topic"] == "zaihyo.theory.revenue"), None)
    assert rev is None or rev["memo_target"] == 3


def test_difficulty_and_budget():
    assert [scheduler.difficulty_for(x) for x in (0.1, 0.5, 0.8, 0.95)] == [2, 3, 4, 5]
    assert scheduler.budget_seconds({"format": "calc", "weight": 6}) == 300
    assert scheduler.budget_seconds({"format": "theory", "weight": 6}) == 300
    assert scheduler.budget_seconds({"format": "calc", "weight": 2}) == 180


def test_diagnostic_menu(st, boki):
    menu = scheduler.diagnostic_menu(st, boki, TODAY)
    units = [i["unit"] for i in menu["items"]]
    assert len(units) == len(set(units)) == len(boki["units"]) and menu["quests"][0]["name"] == "診断"
```

`test_theory_items_carry_memo_target` は Task 8 の zaihyo.json が要る。Task 4 の時点では `pytest -k "not theory_items"` で通し、Task 8 完了後に全部通す。

- [ ] **Step 2: 失敗確認** → ModuleNotFoundError

- [ ] **Step 3: `scripts/coach_lib/scheduler.py`**

```python
"""今日のメニュー: 復習期限到来 → 低習得度×高配点 → 中間帯の挑戦。論点混在で並べる。"""
from __future__ import annotations

from . import model
from . import state as state_mod
from .subjects import topic_index

WEAK_PREREQ_THRESHOLD = 0.4
CHALLENGE_RANGE = (0.4, 0.7)
CHALLENGE_COUNT = 2


def difficulty_for(m: float) -> int:
    return 2 if m < 0.4 else 3 if m < 0.7 else 4 if m < 0.9 else 5


def budget_seconds(topic: dict) -> int:
    return 300 if topic["format"] == "theory" else 60 * (2 + int(topic["weight"]) // 2)


def interleave(items: list[dict]) -> list[dict]:
    pool, out = list(items), []
    while pool:
        prev = out[-1]["unit"] if out else None
        pick = next((i for i in pool if i["unit"] != prev), pool[0])
        pool.remove(pick)
        out.append(pick)
    return out


def _item(st, subject, topic, today, reason) -> dict:
    ts = st["topics"][topic["id"]]
    units = {u["id"]: u["name"] for u in subject["units"]}
    m = state_mod.topic_mastery(st, subject, topic["id"])
    fading = bool(ts["due"]) and state_mod.days_between(today, ts["due"]) <= 1
    theory = topic["format"] == "theory"
    return {"topic": topic["id"], "name": topic["name"], "unit": topic["unit"],
            "unit_name": units.get(topic["unit"], topic["unit"]), "format": topic["format"],
            "difficulty": difficulty_for(m), "budget_seconds": budget_seconds(topic),
            "fading": fading, "xp_multiplier": 2 if fading else 1, "reason": reason,
            "mastery": round(m, 3), "memo_stage": ts["memo_stage"],
            "memo_target": min(model.MEMO_STAGES, ts["memo_stage"] + 1) if theory else None,
            "pitfalls": topic.get("pitfalls", [])}


def _priority(st, subject, topic) -> float:
    return float(topic["weight"]) * (1 - state_mod.topic_mastery(st, subject, topic["id"]))


def build_menu(st, subject, today, n=10) -> dict:
    state_mod.apply_decay(st, subject, today)
    idx, topics, chosen = topic_index(subject), subject["topics"], set()

    due = [t for t in topics if st["topics"][t["id"]]["due"] and state_mod.days_between(today, st["topics"][t["id"]]["due"]) <= 1]
    due.sort(key=lambda t: -_priority(st, subject, t))
    review = []
    for t in due[:max(1, n // 2)]:
        review.append(_item(st, subject, t, today, "復習期限"))
        chosen.add(t["id"])

    challenge = []
    if n >= 6:
        mids = [t for t in topics if t["id"] not in chosen
                and CHALLENGE_RANGE[0] <= state_mod.topic_mastery(st, subject, t["id"]) < CHALLENGE_RANGE[1]]
        mids.sort(key=lambda t: -float(t["weight"]))
        for t in mids[:CHALLENGE_COUNT]:
            challenge.append(_item(st, subject, t, today, "配点が重く伸びしろがある"))
            chosen.add(t["id"])

    weak, remaining = [], n - len(review) - len(challenge)
    for t in sorted((t for t in topics if t["id"] not in chosen), key=lambda t: -_priority(st, subject, t)):
        if len(weak) >= remaining:
            break
        weak_pre = [p for p in t.get("prereq", []) if p not in chosen
                    and state_mod.topic_mastery(st, subject, p) < WEAK_PREREQ_THRESHOLD]
        if weak_pre:
            pre = min(weak_pre, key=lambda p: state_mod.topic_mastery(st, subject, p))
            weak.append(_item(st, subject, idx[pre], today, f"{t['name']} の前提"))
            chosen.add(pre)
            if len(weak) >= remaining:
                break
        weak.append(_item(st, subject, t, today, "習得度が低く配点が重い"))
        chosen.add(t["id"])

    items = interleave(review + weak + challenge)
    return {"date": today, "n": len(items),
            "quests": [{"name": "復習", "items": review}, {"name": "弱点", "items": weak}, {"name": "挑戦", "items": challenge}],
            "items": items}


def diagnostic_menu(st, subject, today) -> dict:
    items = []
    for unit in subject["units"]:
        best = max((t for t in subject["topics"] if t["unit"] == unit["id"]), key=lambda t: float(t["weight"]))
        items.append(_item(st, subject, best, today, f"{unit['name']} の代表論点"))
    items = interleave(items)
    return {"date": today, "n": len(items), "quests": [{"name": "診断", "items": items}], "items": items}
```

- [ ] **Step 4: 通す** `python3 -m pytest tests/test_scheduler.py -q -k "not theory_items"` → 8 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/coach_lib/scheduler.py tests/test_scheduler.py
git commit -m "feat: 今日のメニュー (復習/弱点/挑戦, 論点混在, 暗記段階) を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: report.py (合格確率 / 目標との差 / 単元別 / 学習効率 / ゲーム状態)

**Files:**
- Create: `scripts/coach_lib/report.py`
- Test: `tests/test_report.py`

**Interfaces:**
- Consumes: `state.compute_scores / apply_decay / days_between / topic_mastery / target_prob_today / FINAL_PHASE_DAYS`, `model.rank`
- Produces:
  - `build_report(st, subject, today) -> dict` keys: `subject, subject_name, date, exam_date, days_to_exam, final_phase, pass_prob, target_pass_prob, on_track, next_milestone ({unit,name,target_date,mastery} | None), expected_score, sd, passing_line, mastery_avg, units: [{id,name,mastery,weight,boss_cleared}], weakest (5), fading_count, efficiency_7d, minutes_7d, xp, level, streak_days, titles, bosses_cleared, mock_scores, history_tail (14)`
  - `format_report(report) -> str`, `level_for_xp(xp) -> int`

- [ ] **Step 1: 失敗するテスト `tests/test_report.py`**

```python
import pytest

from coach_lib import report, state, subjects

TODAY = "2026-09-04"


@pytest.fixture
def boki(subjects_dir):
    return subjects.load_subject("boki", subjects_dir)


@pytest.fixture
def st(boki, coach_home):
    return state.init_state(boki, exam_date="2027-08-05", level=3, today=TODAY)


def test_core_fields(st, boki):
    r = report.build_report(st, boki, TODAY)
    assert r["subject_name"] == "簿記論" and r["days_to_exam"] == 335 and r["final_phase"] is False
    assert 0 < r["pass_prob"] < 1 and r["passing_line"] == 60
    assert r["target_pass_prob"] == pytest.approx(r["pass_prob"], abs=1e-3) and r["on_track"] is True
    assert r["next_milestone"]["unit"] == st["plan"]["milestones"][0]["unit"]
    assert len(r["units"]) == len(boki["units"]) and sum(u["weight"] for u in r["units"]) == pytest.approx(100)
    assert len(r["weakest"]) == 5 and r["level"] == 1 and r["xp"] == 0


def test_off_track_when_behind_target(st, boki):
    r = report.build_report(st, boki, "2027-03-01")
    assert r["target_pass_prob"] > r["pass_prob"] and r["on_track"] is False


def test_final_phase_flag(st, boki):
    r = report.build_report(st, boki, "2027-07-10")
    assert r["final_phase"] is True and r["days_to_exam"] == 26


def test_boss_cleared_and_next_milestone_moves(st, boki):
    first = st["plan"]["milestones"][0]["unit"]
    for t in boki["topics"]:
        if t["unit"] == first:
            st["topics"][t["id"]]["p"] = 0.95
            st["topics"][t["id"]]["correct_days"] = ["2026-09-01", "2026-09-02", "2026-09-03"]
    r = report.build_report(st, boki, TODAY)
    assert next(u for u in r["units"] if u["id"] == first)["boss_cleared"] is True
    assert r["next_milestone"]["unit"] == st["plan"]["milestones"][1]["unit"]
    assert len(r["bosses_cleared"]) == 1


def test_efficiency(st, boki):
    assert report.build_report(st, boki, TODAY)["efficiency_7d"] is None
    state.record_attempt(st, boki, "boki.sales.shohin", 1.0, 600, "none", 3, TODAY)
    r = report.build_report(st, boki, TODAY)
    assert r["minutes_7d"] == pytest.approx(10.0) and r["efficiency_7d"] > 0


def test_weakest_and_format(st, boki):
    st["topics"]["boki.fixed.depreciation"]["p"] = 0.05
    r = report.build_report(st, boki, TODAY)
    assert r["weakest"][0]["topic"] == "boki.fixed.depreciation" and r["weakest"][0]["rank"] == "未着手"
    text = report.format_report(r)
    for needle in ["合格確率", "簿記論", "335", "Lv.1", "目標", "次のボス"]:
        assert needle in text
    assert report.level_for_xp(99) == 1 and report.level_for_xp(100) == 2
```

- [ ] **Step 2: 失敗確認** → ModuleNotFoundError

- [ ] **Step 3: `scripts/coach_lib/report.py`**

```python
"""report: 合格確率・目標との差・単元別習得度・学習効率・ゲーム状態。"""
from __future__ import annotations

from . import model
from . import state as state_mod

BOSS_THRESHOLD, WEAKEST_N, HISTORY_TAIL, ON_TRACK_TOLERANCE = 0.7, 5, 14, 0.02


def level_for_xp(xp: int) -> int:
    return xp // 100 + 1


def build_report(st, subject, today) -> dict:
    state_mod.apply_decay(st, subject, today)
    expected, sd, prob = state_mod.compute_scores(st, subject)
    days_to_exam = state_mod.days_between(today, st["exam_date"])
    mastery = {tid: state_mod.topic_mastery(st, subject, tid) for tid in st["topics"]}

    units = []
    for u in subject["units"]:
        ts = [t for t in subject["topics"] if t["unit"] == u["id"]]
        w = sum(float(t["weight"]) for t in ts)
        um = sum(mastery[t["id"]] * float(t["weight"]) for t in ts) / w if w else 0.0
        units.append({"id": u["id"], "name": u["name"], "mastery": round(um, 3), "weight": w,
                      "boss_cleared": all(mastery[t["id"]] >= BOSS_THRESHOLD for t in ts)})
    cleared = {u["id"] for u in units if u["boss_cleared"]}
    next_ms = next((m for m in st["plan"]["milestones"] if m["unit"] not in cleared), None)
    if next_ms:
        next_ms = {**next_ms, "mastery": next(u["mastery"] for u in units if u["id"] == next_ms["unit"])}

    ranked = sorted(subject["topics"], key=lambda t: -float(t["weight"]) * (1 - mastery[t["id"]]))
    weakest = [{"topic": t["id"], "name": t["name"], "mastery": round(mastery[t["id"]], 3),
                "weight": float(t["weight"]), "rank": model.rank(mastery[t["id"]])} for t in ranked[:WEAKEST_N]]
    fading = sum(1 for t in st["topics"].values() if t["due"] and state_mod.days_between(today, t["due"]) <= 1)

    recent = [h for h in st["history"] if 0 <= state_mod.days_between(h["date"], today) <= 7]
    minutes_7d = sum(h["minutes"] for h in recent)
    efficiency = None
    if recent and minutes_7d > 0:
        base = st["history"][0]["mastery_avg"] if len(recent) == 1 else recent[0]["mastery_avg"]
        efficiency = round((recent[-1]["mastery_avg"] - base) / minutes_7d, 5)

    target = state_mod.target_prob_today(st, today)
    return {"subject": st["subject"], "subject_name": subject["name"], "date": today, "exam_date": st["exam_date"],
            "days_to_exam": days_to_exam, "final_phase": 0 <= days_to_exam <= state_mod.FINAL_PHASE_DAYS,
            "pass_prob": round(prob, 4), "target_pass_prob": round(target, 4),
            "on_track": prob + ON_TRACK_TOLERANCE >= target, "next_milestone": next_ms,
            "expected_score": round(expected, 1), "sd": round(sd, 2), "passing_line": subject["exam"]["passing_line"],
            "mastery_avg": round(sum(mastery.values()) / max(1, len(mastery)), 3), "units": units, "weakest": weakest,
            "fading_count": fading, "efficiency_7d": efficiency, "minutes_7d": round(minutes_7d, 1),
            "xp": st["xp"], "level": level_for_xp(st["xp"]), "streak_days": st["streak"]["days"],
            "titles": list(st["titles"]), "bosses_cleared": [u["name"] for u in units if u["boss_cleared"]],
            "mock_scores": list(st["mock_scores"]), "history_tail": st["history"][-HISTORY_TAIL:]}


def format_report(r: dict) -> str:
    track = "順調" if r["on_track"] else "目標より遅れ"
    lines = [f"== {r['subject_name']} 進捗 ({r['date']}) ==",
             f"本番まで {r['days_to_exam']} 日" + (" [直前期モード]" if r["final_phase"] else ""),
             f"合格確率 {r['pass_prob'] * 100:.0f}% / 目標 {r['target_pass_prob'] * 100:.0f}% ({track})  期待得点 {r['expected_score']} / 合格ライン {r['passing_line']} (ぶれ ±{r['sd']})",
             f"Lv.{r['level']}  XP {r['xp']}  連続 {r['streak_days']} 日  消えかけ論点 {r['fading_count']}"]
    if r["next_milestone"]:
        m = r["next_milestone"]
        lines.append(f"次のボス: {m['name']} (期限 {m['target_date']}, 現在 {m['mastery'] * 100:.0f}%)")
    if r["titles"]:
        lines.append("称号: " + " / ".join(r["titles"]))
    if r["bosses_cleared"]:
        lines.append("撃破済みボス: " + " / ".join(r["bosses_cleared"]))
    if r["efficiency_7d"] is not None:
        lines.append(f"直近 7 日: {r['minutes_7d']} 分, 効率 {r['efficiency_7d']:+.4f} 習得度/分")
    lines.append("-- 単元別 --")
    for u in r["units"]:
        lines.append(f"  {u['name']:<20} {u['mastery'] * 100:3.0f}% {'#' * int(u['mastery'] * 10)}{' (撃破)' if u['boss_cleared'] else ''}")
    lines.append("-- 伸びしろ上位 --")
    for w in r["weakest"]:
        lines.append(f"  [{w['rank']}] {w['name']} (配点 {w['weight']:g}, 習得 {w['mastery'] * 100:.0f}%)")
    return "\n".join(lines)
```

- [ ] **Step 4: 通す** `python3 -m pytest tests/test_report.py -q` → 6 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/coach_lib/report.py tests/test_report.py
git commit -m "feat: report (合格確率/目標差/単元別/効率) を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: dashboard.py (合格確率 実績 vs 目標 / ヒートマップ / tile)

**Files:**
- Create: `scripts/coach_lib/dashboard.py`
- Test: `tests/test_dashboard.py`

**Interfaces:**
- Produces: `render_dashboard(report, st, subject) -> str` (自己完結 HTML、外部リソース・JS なし)、`write_dashboard(report, st, subject) -> Path`、`polyline_points(values, width, height) -> str`

- [ ] **Step 1: 失敗するテスト `tests/test_dashboard.py`**

```python
import pytest

from coach_lib import dashboard, report, state, subjects

TODAY = "2026-09-04"


@pytest.fixture
def boki(subjects_dir):
    return subjects.load_subject("boki", subjects_dir)


@pytest.fixture
def st(boki, coach_home):
    s = state.init_state(boki, exam_date="2027-08-05", level=3, today="2026-09-01")
    state.record_attempt(s, boki, "boki.sales.shohin", 1.0, 300, "none", 3, "2026-09-02")
    state.record_attempt(s, boki, "boki.fixed.depreciation", 0.0, 300, "knowledge", 3, "2026-09-03")
    return s


def test_render(st, boki):
    html = dashboard.render_dashboard(report.build_report(st, boki, TODAY), st, boki)
    assert html.count("<polyline") == 2 and "stroke-dasharray" in html     # 実績 + 目標 (点線)
    assert "簿記論" in html and "合格確率" in html and "次のボス" in html
    for t in boki["topics"]:
        assert t["name"] in html
    assert "http://" not in html and "https://" not in html and "<script" not in html


def test_write(st, boki, coach_home):
    path = dashboard.write_dashboard(report.build_report(st, boki, TODAY), st, boki)
    assert path == coach_home / "boki" / "dashboard.html"
    assert path.read_text(encoding="utf-8").startswith("<!doctype html>")


def test_polyline_points():
    assert dashboard.polyline_points([0.0, 0.5, 1.0], 100, 50) == "0,50 50,25 100,0"
    assert dashboard.polyline_points([0.3], 100, 50) == "0,35"
```

- [ ] **Step 2: 失敗確認** → ModuleNotFoundError

- [ ] **Step 3: `scripts/coach_lib/dashboard.py`**

```python
"""学習 dashboard (自己完結 HTML)。"""
from __future__ import annotations

import html
from pathlib import Path

from . import model
from . import state as state_mod

CSS = """
:root{--bg:#f7f5ef;--ink:#1f2a37;--muted:#6b7280;--card:#fff;--line:#e5e1d8;--m0:#e8e5de;--m1:#f6c98b;--m2:#8fcf9f;--m3:#2f9e63;--accent:#2b5c8a;--target:#b45309}
@media (prefers-color-scheme: dark){:root{--bg:#141820;--ink:#e8eaf0;--muted:#9aa3b2;--card:#1d2330;--line:#2c3442;--m0:#2c3442}}
body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,"Hiragino Sans",sans-serif;padding:24px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;color:var(--muted)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.tile{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.tile b{display:block;font-size:24px}.tile span{font-size:12px;color:var(--muted)}
.unit{margin:10px 0}.unit .name{font-size:13px;margin-bottom:4px}.grid{display:flex;flex-wrap:wrap;gap:4px}
.cell{width:110px;font-size:11px;padding:6px;border-radius:6px;background:var(--m0)}
.r1{background:var(--m1)}.r2{background:var(--m2)}.r3{background:var(--m3);color:#fff}
.chart{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px;overflow-x:auto}
.titles span{display:inline-block;margin:2px 6px 2px 0;padding:2px 8px;border:1px solid var(--line);border-radius:999px;font-size:12px}
"""


def polyline_points(values, width, height) -> str:
    if not values:
        return ""
    if len(values) == 1:
        return f"0,{round(height - values[0] * height):g}"
    step = width / (len(values) - 1)
    return " ".join(f"{round(i * step):g},{round(height - v * height):g}" for i, v in enumerate(values))


def _rank_class(m: float) -> str:
    return {"未着手": "", "見習い": "r1", "一人前": "r2", "師範": "r3"}[model.rank(m)]


def render_dashboard(report, st, subject) -> str:
    e = html.escape
    hist = st["history"]
    actual = [h["pass_prob"] for h in hist]
    target = [state_mod.target_prob_today(st, h["date"]) for h in hist]
    w, h = max(300, 40 * len(actual)), 120
    chart = (f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="合格確率の推移">'
             f'<polyline fill="none" stroke="var(--target)" stroke-width="2" stroke-dasharray="6 4" points="{polyline_points(target, w, h)}"/>'
             f'<polyline fill="none" stroke="var(--accent)" stroke-width="2" points="{polyline_points(actual, w, h)}"/></svg>'
             f'<div style="font-size:12px;color:var(--muted)">実線 = 実績 / 点線 = 目標  {e(hist[0]["date"])} → {e(hist[-1]["date"])}</div>')
    tiles = [(f"{report['pass_prob'] * 100:.0f}%", f"合格確率 (目標 {report['target_pass_prob'] * 100:.0f}%)"),
             (f"{report['expected_score']:g}", f"期待得点 / {report['passing_line']}"),
             (str(report["days_to_exam"]), "本番まで (日)"), (f"Lv.{report['level']}", f"XP {report['xp']}"),
             (str(report["streak_days"]), "連続学習日数"), (str(report["fading_count"]), "消えかけ論点")]
    tiles_html = "".join(f'<div class="tile"><b>{e(v)}</b><span>{e(k)}</span></div>' for v, k in tiles)
    ms = report["next_milestone"]
    boss = f'次のボス: {e(ms["name"])} (期限 {e(ms["target_date"])}, 現在 {ms["mastery"] * 100:.0f}%)' if ms else "次のボス: 全単元撃破"
    units_html = []
    for u in subject["units"]:
        cells = []
        for t in subject["topics"]:
            if t["unit"] != u["id"]:
                continue
            m = state_mod.topic_mastery(st, subject, t["id"])
            cells.append(f'<div class="cell {_rank_class(m)}" title="{e(t["id"])}">{e(t["name"])}<br>{m * 100:.0f}% / 配点 {float(t["weight"]):g}</div>')
        ru = next(x for x in report["units"] if x["id"] == u["id"])
        units_html.append(f'<div class="unit"><div class="name">{e(u["name"])} {ru["mastery"] * 100:.0f}%{" (撃破)" if ru["boss_cleared"] else ""}</div><div class="grid">{"".join(cells)}</div></div>')
    titles = "".join(f"<span>{e(t)}</span>" for t in report["titles"]) or '<span style="color:var(--muted)">まだなし</span>'
    weakest = "".join(f'<li>[{e(x["rank"])}] {e(x["name"])} (配点 {x["weight"]:g}, 習得 {x["mastery"] * 100:.0f}%)</li>' for x in report["weakest"])
    return f"""<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{e(subject["name"])} 学習ダッシュボード</title><style>{CSS}</style></head>
<body>
<h1>{e(subject["name"])} 学習ダッシュボード</h1>
<div style="color:var(--muted);font-size:13px">{e(report["date"])} 時点 / 本番 {e(report["exam_date"])} / {boss}</div>
<h2>今の状態</h2><div class="tiles">{tiles_html}</div>
<h2>合格確率の推移</h2><div class="chart">{chart}</div>
<h2>論点ヒートマップ (色 = ランク: 未着手 / 見習い / 一人前 / 師範)</h2>{"".join(units_html)}
<h2>伸びしろ上位</h2><ol>{weakest}</ol>
<h2>称号</h2><div class="titles">{titles}</div>
</body></html>
"""


def write_dashboard(report, st, subject) -> Path:
    d = state_mod.state_dir(st["subject"])
    d.mkdir(parents=True, exist_ok=True)
    path = d / "dashboard.html"
    path.write_text(render_dashboard(report, st, subject), encoding="utf-8")
    return path
```

- [ ] **Step 4: 通す** → 3 passed

- [ ] **Step 5: Commit**

```bash
git add scripts/coach_lib/dashboard.py tests/test_dashboard.py
git commit -m "feat: 学習ダッシュボード HTML (実績/目標曲線) を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: mock (順位較正) / rebuild / status / CLI (coach.py)

**Files:**
- Modify: `scripts/coach_lib/state.py` (末尾に `record_mock`, `rebuild_state` を追加)
- Create: `scripts/coach.py`
- Test: `tests/test_cli.py`

**Interfaces (Produces):**
- `state.record_mock(st, subject, score, minutes, today, rank=None, of=None) -> {"calibration_offset", "speed", "expected_at", "percentile"}`
- `state.rebuild_state(subject) -> dict` (`state.json` を `init_args` + `attempts.jsonl` から再生して返す。保存はしない)
- CLI `python3 scripts/coach.py <cmd>`:
  - `subjects` / `lint` / `status` (全科目の pass_prob を JSON で並べ、`recommended` に最小の科目)
  - `init <subject> --exam-date YYYY-MM-DD [--level 1-5 | --mock-score N] [--weekly-hours N] [--school S] [--note S] [--today] [--force]`
  - `next <subject> [--n 10] [--diagnostic] [--today]`
  - `start <subject> --topic ID [--now ISO]`
  - `record <subject> --topic ID (--correct yes|no | --score 0..1) [--seconds N] --error-class CLS --difficulty 1-5 [--memo-stage 0-3] [--today] [--now ISO]` (`--seconds` 省略時は timer から)
  - `report <subject> [--json] [--today]` / `dashboard <subject> [--today]`
  - `mock <subject> --score N [--minutes N] [--rank N --of M] [--today]`
  - `plan <subject> [--rebuild] [--today]` (plan を JSON で表示。`--rebuild` で引き直して保存)
  - `rebuild <subject>` (ログから再生して state.json を書き直す。旧 state は `state.json.bak` に退避)
  - `main(argv=None) -> int`

- [ ] **Step 1: 失敗するテスト `tests/test_cli.py`**

```python
import json

import pytest

import coach
from coach_lib import state, subjects

TODAY = "2026-09-04"


def run(capsys, *argv):
    code = coach.main(list(argv))
    return code, capsys.readouterr().out


def test_subjects_and_lint(capsys):
    code, out = run(capsys, "subjects")
    assert code == 0 and {"id": "boki", "name": "簿記論"} in json.loads(out)
    code, out = run(capsys, "lint")
    assert code == 0 and "OK boki" in out


def test_roundtrip(capsys, coach_home):
    code, out = run(capsys, "init", "boki", "--exam-date", "2027-08-05", "--level", "3", "--weekly-hours", "10",
                    "--school", "TAC", "--note", "減価償却が苦手", "--today", TODAY)
    assert code == 0 and json.loads(out)["subject"] == "boki"
    assert state.load_state("boki")["profile"] == {"weekly_hours": 10, "school": "TAC", "note": "減価償却が苦手"}
    code, out = run(capsys, "init", "boki", "--exam-date", "2027-08-05", "--today", TODAY)
    assert code == 1 and "exists" in out

    code, out = run(capsys, "next", "boki", "--n", "6", "--today", TODAY)
    menu = json.loads(out)
    assert code == 0 and len(menu["items"]) == 6
    topic = menu["items"][0]["topic"]

    code, out = run(capsys, "start", "boki", "--topic", topic, "--now", "2026-09-04T10:00:00")
    assert code == 0 and state.read_timer("boki")["topic"] == topic
    code, out = run(capsys, "record", "boki", "--topic", topic, "--correct", "yes", "--error-class", "none",
                    "--difficulty", "3", "--today", TODAY, "--now", "2026-09-04T10:03:00")
    data = json.loads(out)
    assert code == 0 and data["seconds"] == 180 and data["reward"]["xp"] >= 10 and 0 < data["pass_prob"] < 1
    assert state.read_timer("boki") is None

    code, out = run(capsys, "record", "boki", "--topic", topic, "--score", "0.5", "--seconds", "100",
                    "--error-class", "procedure", "--difficulty", "3", "--today", TODAY)
    assert code == 0 and json.loads(out)["reward"]["correct"] is False

    code, out = run(capsys, "report", "boki", "--today", TODAY)
    assert code == 0 and "合格確率" in out and "目標" in out
    code, out = run(capsys, "report", "boki", "--json", "--today", TODAY)
    assert json.loads(out)["xp"] == state.load_state("boki")["xp"]
    code, out = run(capsys, "dashboard", "boki", "--today", TODAY)
    assert code == 0 and (coach_home / "boki" / "dashboard.html").exists()
    code, out = run(capsys, "next", "boki", "--diagnostic", "--today", TODAY)
    assert json.loads(out)["quests"][0]["name"] == "診断"
    code, out = run(capsys, "plan", "boki", "--today", TODAY)
    assert code == 0 and json.loads(out)["final_phase_start"] == "2027-07-06"
    code, out = run(capsys, "status", "--today", TODAY)
    st = json.loads(out)
    assert st["recommended"] == "boki" and st["subjects"][0]["pass_prob"] > 0


def test_record_without_seconds_and_timer_fails(capsys, coach_home):
    run(capsys, "init", "boki", "--exam-date", "2027-08-05", "--today", TODAY)
    code, out = run(capsys, "record", "boki", "--topic", "boki.sales.shohin", "--correct", "no",
                    "--error-class", "knowledge", "--difficulty", "3", "--today", TODAY)
    assert code == 1 and "seconds" in out


def test_bad_error_class_exit_2(capsys, coach_home):
    run(capsys, "init", "boki", "--exam-date", "2027-08-05", "--today", TODAY)
    code, _ = run(capsys, "record", "boki", "--topic", "boki.sales.shohin", "--correct", "no", "--seconds", "10",
                  "--error-class", "lazy", "--difficulty", "3", "--today", TODAY)
    assert code == 2


def test_missing_state_hint(capsys, coach_home):
    code, out = run(capsys, "report", "boki", "--today", TODAY)
    assert code == 1 and "init" in out


def test_mock_calibrates_offset_speed_and_rank(capsys, coach_home, subjects_dir):
    boki = subjects.load_subject("boki", subjects_dir)
    st = state.init_state(boki, exam_date="2027-08-05", level=3, today=TODAY)
    state.save_state(st)
    expected_before, _, prob_before = state.compute_scores(st, boki)
    code, out = run(capsys, "mock", "boki", "--score", str(expected_before + 10), "--minutes", "130",
                    "--rank", "30", "--of", "1000", "--today", TODAY)
    data = json.loads(out)
    assert code == 0 and data["calibration_offset"] == pytest.approx(10.0, abs=0.01)
    assert data["speed"] < 1.0 and data["percentile"] == pytest.approx(0.03)
    st2 = state.load_state("boki")
    expected_after, _, prob_after = state.compute_scores(st2, boki)
    assert expected_after == pytest.approx(expected_before + 10, abs=0.01)
    assert prob_after > prob_before      # 上位 3% の順位が効く


def test_rebuild_reproduces_state(capsys, coach_home, subjects_dir):
    boki = subjects.load_subject("boki", subjects_dir)
    run(capsys, "init", "boki", "--exam-date", "2027-08-05", "--level", "3", "--today", TODAY)
    for d, sc in [("2026-09-04", "1"), ("2026-09-05", "0"), ("2026-09-06", "0.8")]:
        run(capsys, "record", "boki", "--topic", "boki.sales.shohin", "--score", sc, "--seconds", "60",
            "--error-class", "none" if sc != "0" else "knowledge", "--difficulty", "3", "--today", d)
    run(capsys, "mock", "boki", "--score", "55", "--today", "2026-09-06")
    before = state.load_state("boki")
    rebuilt = state.rebuild_state(boki)
    assert rebuilt["topics"] == before["topics"] and rebuilt["xp"] == before["xp"]
    assert rebuilt["calibration_offset"] == pytest.approx(before["calibration_offset"])
    code, out = run(capsys, "rebuild", "boki")
    assert code == 0 and (coach_home / "boki" / "state.json.bak").exists()
```

- [ ] **Step 2: 失敗確認** → ModuleNotFoundError (`coach`)

- [ ] **Step 3: `scripts/coach_lib/state.py` の末尾に追記**

```python
# ---------- mock / rebuild ----------

MOCK_CALIBRATION_WINDOW = 3


def record_mock(st, subject, score, minutes, today, rank=None, of=None) -> dict:
    apply_decay(st, subject, today)
    st["calibration_offset"] = 0.0
    expected_raw = compute_scores(st, subject)[0]
    percentile = (rank / of) if (rank is not None and of) else None
    st["mock_scores"].append({"date": today, "score": float(score), "minutes": minutes,
                              "expected_at": round(expected_raw, 2), "percentile": percentile})
    recent = [m for m in st["mock_scores"] if m["expected_at"] is not None][-MOCK_CALIBRATION_WINDOW:]
    if recent:
        st["calibration_offset"] = round(sum(m["score"] - m["expected_at"] for m in recent) / len(recent), 3)
    if minutes is not None and minutes > subject["exam"]["minutes"]:
        st["speed"] = max(SPEED_MIN, st["speed"] - SPEED_PENALTY)
    append_log(st, {"kind": "mock", "date": today, "score": float(score), "minutes": minutes, "rank": rank, "of": of})
    snapshot_history(st, subject, today, minutes_delta=float(minutes or 0))
    return {"calibration_offset": st["calibration_offset"], "speed": st["speed"],
            "expected_at": round(expected_raw, 2), "percentile": percentile}


def rebuild_state(subject) -> dict:
    """attempts.jsonl (正本) を init_args から再生する。ログ追記を止めるため一時 root に書く。"""
    sid = subject["subject"]
    current = load_state(sid)
    log_path = state_dir(sid) / "attempts.jsonl"
    rows = [json.loads(l) for l in log_path.read_text(encoding="utf-8").splitlines() if l.strip()] if log_path.exists() else []
    a = current["init_args"]
    real_root = os.environ.get("ZEIRISHI_COACH_HOME")
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        os.environ["ZEIRISHI_COACH_HOME"] = tmp
        try:
            st = init_state(subject, a["exam_date"], level=a["level"], mock_score=a["mock_score"], today=a["today"],
                            profile=current.get("profile"))
            for r in rows:
                if r["kind"] == "attempt":
                    record_attempt(st, subject, r["topic"], r["score"], r["seconds"], r["error_class"],
                                   r["difficulty"], r["date"], memo_stage=r.get("memo_stage"))
                elif r["kind"] == "mock":
                    record_mock(st, subject, r["score"], r["minutes"], r["date"], rank=r.get("rank"), of=r.get("of"))
        finally:
            if real_root is None:
                os.environ.pop("ZEIRISHI_COACH_HOME", None)
            else:
                os.environ["ZEIRISHI_COACH_HOME"] = real_root
    st["plan"] = current.get("plan") or st["plan"]
    return st
```

- [ ] **Step 4: `scripts/coach.py`**

```python
#!/usr/bin/env python3
"""zeirishi-coach CLI。ロジックは coach_lib/。ここは引数解釈と入出力だけ。"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from coach_lib import dashboard, report, scheduler, state, subjects  # noqa: E402


def _out(data):
    print(json.dumps(data, ensure_ascii=False, indent=2))


def _load(subject_id):
    return subjects.load_subject(subject_id), state.load_state(subject_id)


def cmd_subjects(_a):
    _out([{"id": sid, "name": subjects.load_subject(sid)["name"]} for sid in subjects.list_subjects()])
    return 0


def cmd_lint(_a):
    bad = 0
    for sid in subjects.list_subjects():
        errors = subjects.lint_subject(subjects.load_subject(sid))
        print(("NG " if errors else "OK ") + sid)
        for e in errors:
            print(f"  - {e}")
        bad += bool(errors)
    return 1 if bad else 0


def cmd_status(a):
    today = a.today or state.today_iso()
    rows = []
    for sid in subjects.list_subjects():
        try:
            subject, st = _load(sid)
        except FileNotFoundError:
            continue
        r = report.build_report(st, subject, today)
        rows.append({"id": sid, "name": subject["name"], "pass_prob": r["pass_prob"], "target_pass_prob": r["target_pass_prob"],
                     "on_track": r["on_track"], "fading_count": r["fading_count"], "days_to_exam": r["days_to_exam"]})
    rows.sort(key=lambda x: x["pass_prob"])
    _out({"date": today, "subjects": rows, "recommended": rows[0]["id"] if rows else None})
    return 0


def cmd_init(a):
    subject = subjects.load_subject(a.subject)
    path = state.state_dir(a.subject) / "state.json"
    if path.exists() and not a.force:
        print(f"state already exists: {path} (use --force to overwrite)")
        return 1
    profile = {k: v for k, v in {"weekly_hours": a.weekly_hours, "school": a.school, "note": a.note}.items() if v is not None}
    st = state.init_state(subject, exam_date=a.exam_date, level=a.level, mock_score=a.mock_score, today=a.today, profile=profile)
    state.save_state(st)
    _out({"subject": st["subject"], "exam_date": st["exam_date"], "topics": len(st["topics"]),
          "pass_prob": st["history"][-1]["pass_prob"], "final_phase_start": st["plan"]["final_phase_start"], "state": str(path)})
    return 0


def cmd_next(a):
    subject, st = _load(a.subject)
    today = a.today or state.today_iso()
    menu = scheduler.diagnostic_menu(st, subject, today) if a.diagnostic else scheduler.build_menu(st, subject, today, n=a.n)
    state.save_state(st)
    _out(menu)
    return 0


def cmd_start(a):
    state.load_state(a.subject)
    path = state.start_timer(a.subject, a.topic, a.now or state.now_iso())
    _out({"topic": a.topic, "started_at": state.read_timer(a.subject)["started_at"], "timer": str(path)})
    return 0


def cmd_record(a):
    subject, st = _load(a.subject)
    today = a.today or state.today_iso()
    score = a.score if a.score is not None else (1.0 if a.correct == "yes" else 0.0)
    seconds = a.seconds
    if seconds is None:
        timer = state.read_timer(a.subject)
        if not timer:
            print("no --seconds and no running timer: run `coach.py start` first or pass --seconds")
            return 1
        seconds = state.elapsed_seconds(timer, a.now or state.now_iso())
    reward = state.record_attempt(st, subject, a.topic, score, seconds, a.error_class, a.difficulty, today, memo_stage=a.memo_stage)
    state.clear_timer(a.subject)
    state.save_state(st)
    expected, _sd, prob = state.compute_scores(st, subject)
    _out({"reward": reward, "seconds": seconds, "score": score, "pass_prob": round(prob, 4),
          "expected_score": round(expected, 1), "xp_total": st["xp"], "streak_days": st["streak"]["days"], "combo": st["combo"]})
    return 0


def cmd_report(a):
    subject, st = _load(a.subject)
    r = report.build_report(st, subject, a.today or state.today_iso())
    state.save_state(st)
    _out(r) if a.json else print(report.format_report(r))
    return 0


def cmd_dashboard(a):
    subject, st = _load(a.subject)
    r = report.build_report(st, subject, a.today or state.today_iso())
    path = dashboard.write_dashboard(r, st, subject)
    state.save_state(st)
    print(str(path))
    return 0


def cmd_mock(a):
    subject, st = _load(a.subject)
    if (a.rank is None) != (a.of is None):
        print("--rank and --of must be given together")
        return 1
    result = state.record_mock(st, subject, a.score, a.minutes, a.today or state.today_iso(), rank=a.rank, of=a.of)
    state.save_state(st)
    _out(result)
    return 0


def cmd_plan(a):
    subject, st = _load(a.subject)
    if a.rebuild:
        st["plan"] = state.build_plan(st, subject, a.today or state.today_iso())
        state.save_state(st)
    _out(st["plan"])
    return 0


def cmd_rebuild(a):
    subject = subjects.load_subject(a.subject)
    path = state.state_dir(a.subject) / "state.json"
    rebuilt = state.rebuild_state(subject)
    shutil.copyfile(path, path.with_suffix(".json.bak"))
    state.save_state(rebuilt)
    _out({"rebuilt": str(path), "backup": str(path.with_suffix(".json.bak")), "attempts_total": rebuilt["attempts_total"]})
    return 0


def build_parser():
    p = argparse.ArgumentParser(prog="coach.py", description="税理士試験 学習コーチ (計測 CLI)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("subjects").set_defaults(fn=cmd_subjects)
    sub.add_parser("lint").set_defaults(fn=cmd_lint)
    sp = sub.add_parser("status"); sp.add_argument("--today"); sp.set_defaults(fn=cmd_status)

    def common(sp):
        sp.add_argument("subject")
        sp.add_argument("--today", help="YYYY-MM-DD (テスト・再現用)")
        return sp

    sp = common(sub.add_parser("init"))
    sp.add_argument("--exam-date", required=True)
    sp.add_argument("--level", type=int, choices=range(1, 6))
    sp.add_argument("--mock-score", type=float)
    sp.add_argument("--weekly-hours", type=int)
    sp.add_argument("--school")
    sp.add_argument("--note")
    sp.add_argument("--force", action="store_true")
    sp.set_defaults(fn=cmd_init)

    sp = common(sub.add_parser("next"))
    sp.add_argument("--n", type=int, default=10)
    sp.add_argument("--diagnostic", action="store_true")
    sp.set_defaults(fn=cmd_next)

    sp = common(sub.add_parser("start"))
    sp.add_argument("--topic", required=True)
    sp.add_argument("--now")
    sp.set_defaults(fn=cmd_start)

    sp = common(sub.add_parser("record"))
    sp.add_argument("--topic", required=True)
    g = sp.add_mutually_exclusive_group(required=True)
    g.add_argument("--correct", choices=["yes", "no"])
    g.add_argument("--score", type=float)
    sp.add_argument("--seconds", type=int)
    sp.add_argument("--error-class", required=True, choices=list(state.ERROR_CLASSES))
    sp.add_argument("--difficulty", type=int, required=True, choices=range(1, 6))
    sp.add_argument("--memo-stage", type=int, choices=range(0, 4))
    sp.add_argument("--now")
    sp.set_defaults(fn=cmd_record)

    sp = common(sub.add_parser("report")); sp.add_argument("--json", action="store_true"); sp.set_defaults(fn=cmd_report)
    common(sub.add_parser("dashboard")).set_defaults(fn=cmd_dashboard)

    sp = common(sub.add_parser("mock"))
    sp.add_argument("--score", type=float, required=True)
    sp.add_argument("--minutes", type=int)
    sp.add_argument("--rank", type=int)
    sp.add_argument("--of", type=int)
    sp.set_defaults(fn=cmd_mock)

    sp = common(sub.add_parser("plan")); sp.add_argument("--rebuild", action="store_true"); sp.set_defaults(fn=cmd_plan)
    sp = sub.add_parser("rebuild"); sp.add_argument("subject"); sp.set_defaults(fn=cmd_rebuild)
    return p


def main(argv=None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return int(exc.code or 0)
    try:
        return args.fn(args)
    except (FileNotFoundError, ValueError, KeyError) as exc:
        print(str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 5: 通す** `python3 -m pytest -q -k "not theory_items"` → 全 file 緑 (subjects 7 / model 17 / state 19 / scheduler 8 / report 6 / dashboard 3 / cli 7)

- [ ] **Step 6: 手動 smoke**

```bash
export ZEIRISHI_COACH_HOME=$TMPDIR/coach-smoke
python3 scripts/coach.py init boki --exam-date 2027-08-05 --level 3
python3 scripts/coach.py next boki --n 5 | head -40
python3 scripts/coach.py start boki --topic boki.fixed.depreciation
python3 scripts/coach.py record boki --topic boki.fixed.depreciation --score 0.4 --error-class procedure --difficulty 3
python3 scripts/coach.py report boki
python3 scripts/coach.py status
```

- [ ] **Step 7: Commit**

```bash
git add scripts/coach.py scripts/coach_lib/state.py tests/test_cli.py
git commit -m "feat: CLI (init/next/start/record/report/dashboard/mock/plan/status/rebuild) を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: 残り 5 科目の論点 tree

**Files:**
- Create: `references/subjects/{zaihyo,hojin,shohi,sozoku,shotoku}.json`
- Modify: `tests/test_subjects.py` (末尾に 1 テスト追加)

各 JSON は Task 1 と同じ schema。`exam` は `{"minutes": 120, "passing_line": 60, "pass_percentile": 0.15, "format": {"calc": 50, "theory": 50}}`。`pitfalls` は各 1 つ以上 (表の右列)。**pitfalls 中の改正事項 (交際費 1 万円、生前贈与加算 7 年 など) は一次ソース未確認**。JSON の `"_note"` に `"改正事項は本番年度の法令で要確認"` を入れる (lint は無視する)。

- [ ] **Step 1: テスト追加 (`tests/test_subjects.py` 末尾)**

```python
def test_six_subjects_shipped_with_theory_calc_split(subjects_dir):
    ids = subjects.list_subjects(subjects_dir)
    assert ids == ["boki", "hojin", "shohi", "shotoku", "sozoku", "zaihyo"]
    for sid in ids:
        s = subjects.load_subject(sid, subjects_dir)
        fmt = s["exam"]["format"]
        assert fmt["calc"] + fmt["theory"] == 100
        by_fmt = {"calc": 0.0, "theory": 0.0}
        for t in s["topics"]:
            by_fmt[t["format"]] += float(t["weight"])
            assert t["pitfalls"], t["id"]
        assert by_fmt["calc"] == pytest.approx(fmt["calc"]) and by_fmt["theory"] == pytest.approx(fmt["theory"])
```

- [ ] **Step 2: 失敗確認** → `ids == ['boki']`

- [ ] **Step 3: 5 科目を書く** (id / name / unit / format / weight / frequency / pitfall。理論 50 + 計算 50)

**zaihyo.json** 財務諸表論。units: `zaihyo.theory-basis` 理論・基礎概念 / `zaihyo.theory-assets` 理論・資産負債 / `zaihyo.theory-pl` 理論・損益と表示 / `zaihyo.calc-close` 計算・決算整理 / `zaihyo.calc-present` 計算・表示

| id | name | unit | fmt | w | freq | pitfall |
|---|---|---|---|---|---|---|
| zaihyo.theory.framework | 概念フレームワーク・会計公準 | theory-basis | theory | 5 | high | 資産の定義を「財産」と書く |
| zaihyo.theory.principles | 企業会計原則・一般原則 | theory-basis | theory | 5 | high | 保守主義と過度の保守主義の区別 |
| zaihyo.theory.revenue | 収益認識基準 (5 ステップ) | theory-pl | theory | 6 | high | 履行義務の充足時点を引渡しと決めつける |
| zaihyo.theory.inventory | 棚卸資産の評価 | theory-assets | theory | 4 | high | 正味売却価額と再調達原価の使い分け |
| zaihyo.theory.fixed-assets | 固定資産・減価償却・減損の理論 | theory-assets | theory | 5 | high | 減損の兆候と認識の区別 |
| zaihyo.theory.lease | リース会計の理論 | theory-assets | theory | 3 | mid | ファイナンス・リースの判定基準 |
| zaihyo.theory.securities | 金融商品会計 | theory-assets | theory | 5 | high | その他有価証券の評価差額を損益にする |
| zaihyo.theory.retirement | 退職給付会計の理論 | theory-assets | theory | 3 | mid | 未認識項目の扱い (個別と連結) |
| zaihyo.theory.tax-effect | 税効果会計の理論 | theory-pl | theory | 4 | high | 資産負債法と繰延法の混同 |
| zaihyo.theory.equity | 純資産・自己株式 | theory-pl | theory | 3 | mid | 自己株式を資産計上する |
| zaihyo.theory.forex | 外貨換算会計 | theory-assets | theory | 2 | low | 換算差額の処理先 |
| zaihyo.theory.consolidation | 連結財務諸表・企業結合 | theory-pl | theory | 3 | mid | のれんの非償却と書く |
| zaihyo.theory.cashflow | キャッシュ・フロー計算書 | theory-pl | theory | 2 | low | 利息の表示区分 |
| zaihyo.calc.inventory | 商品・棚卸資産の期末評価 | calc-close | calc | 5 | high | 評価損の戻入 |
| zaihyo.calc.receivables | 債権・貸倒引当金 | calc-close | calc | 4 | high | 破産更生債権の担保控除 |
| zaihyo.calc.securities | 有価証券の評価と表示 | calc-close | calc | 6 | high | 1 年基準による流動固定分類 |
| zaihyo.calc.fixed | 固定資産・減損・リースの計算 | calc-close | calc | 7 | high | 減損損失の配分 |
| zaihyo.calc.provisions | 引当金・退職給付・社債 | calc-close | calc | 6 | high | 社債発行費の償却 |
| zaihyo.calc.tax | 法人税等・税効果の計算 | calc-close | calc | 5 | high | 法人税等調整額の符号 |
| zaihyo.calc.equity | 純資産・株主資本等変動計算書 | calc-present | calc | 5 | high | 配当に伴う準備金積立 |
| zaihyo.calc.presentation | 表示区分・注記・1 年基準 | calc-present | calc | 6 | high | 長期前払費用の区分 |
| zaihyo.calc.forex | 外貨建取引の計算 | calc-close | calc | 3 | mid | 決算時レートの適用範囲 |
| zaihyo.calc.misc | 収益認識の計算・その他 | calc-present | calc | 3 | mid | 変動対価の見積り |

**hojin.json** 法人税法。units: `hojin.theory-income` 理論・所得計算 / `hojin.theory-items` 理論・各論 / `hojin.theory-system` 理論・制度と手続 / `hojin.calc-adjust` 計算・申告調整 / `hojin.calc-tax` 計算・税額

| id | name | unit | fmt | w | freq | pitfall |
|---|---|---|---|---|---|---|
| hojin.theory.income-concept | 所得金額の計算通則・別段の定め | theory-income | theory | 5 | high | 公正処理基準と別段の定めの優先関係 |
| hojin.theory.revenue-timing | 益金の額・収益計上時期 | theory-income | theory | 5 | high | 引渡基準と検収基準の混同 |
| hojin.theory.expense-timing | 損金の額・債務確定主義 | theory-income | theory | 5 | high | 債務確定の 3 要件の書き漏れ |
| hojin.theory.depreciation | 減価償却・繰延資産の理論 | theory-items | theory | 5 | high | 損金経理要件の書き漏れ |
| hojin.theory.entertainment | 交際費等・寄附金 | theory-items | theory | 5 | high | 飲食費の除外基準額 (改正あり、要確認) |
| hojin.theory.bad-debt | 貸倒損失・貸倒引当金 | theory-items | theory | 4 | high | 法律上の貸倒と事実上の貸倒の区別 |
| hojin.theory.compensation | 役員給与 | theory-items | theory | 5 | high | 定期同額給与の改定時期 |
| hojin.theory.group | グループ法人税制・組織再編 | theory-system | theory | 4 | mid | 完全支配関係の判定 |
| hojin.theory.foreign | 外国税額控除・国際課税 | theory-system | theory | 3 | low | 控除限度額の計算式 |
| hojin.theory.loss | 欠損金の繰越・繰戻 | theory-system | theory | 3 | mid | 中小法人の控除限度 |
| hojin.theory.procedure | 申告・納付・更正 | theory-system | theory | 3 | mid | 確定申告期限の延長要件 |
| hojin.theory.tax-credit | 税額控除の理論 | theory-system | theory | 3 | mid | 所得税額控除と外国税額控除の順序 |
| hojin.calc.depreciation | 減価償却の限度額計算 | calc-adjust | calc | 7 | high | 償却超過額の翌期認容 |
| hojin.calc.entertainment | 交際費・寄附金の限度額 | calc-adjust | calc | 6 | high | 寄附金の損金算入限度額の計算式 |
| hojin.calc.compensation | 役員給与・退職給与の計算 | calc-adjust | calc | 5 | high | 使用人兼務役員の判定 |
| hojin.calc.bad-debt | 貸倒引当金の繰入限度額 | calc-adjust | calc | 5 | high | 実質的に債権とみられない金額 |
| hojin.calc.dividends | 受取配当等の益金不算入 | calc-adjust | calc | 5 | high | 株式区分ごとの不算入割合 |
| hojin.calc.securities | 有価証券・評価損益 | calc-adjust | calc | 4 | mid | 売買目的有価証券の洗替 |
| hojin.calc.tax-expense | 租税公課・納税充当金 | calc-adjust | calc | 5 | high | 事業税の損金算入時期 |
| hojin.calc.deferred | 繰延資産・前払費用 | calc-adjust | calc | 3 | mid | 短期前払費用の特例要件 |
| hojin.calc.loss | 欠損金・所得金額の計算 | calc-tax | calc | 4 | mid | 控除順序 (古い年度から) |
| hojin.calc.tax-amount | 税額計算・税額控除・留保金課税 | calc-tax | calc | 6 | high | 軽減税率の適用範囲 (800 万円) |

**shohi.json** 消費税法。units: `shohi.theory-scope` 理論・課税の対象 / `shohi.theory-credit` 理論・仕入税額控除と制度 / `shohi.theory-proc` 理論・手続 / `shohi.calc-class` 計算・取引分類 / `shohi.calc-credit` 計算・仕入税額控除と納付

| id | name | unit | fmt | w | freq | pitfall |
|---|---|---|---|---|---|---|
| shohi.theory.scope | 課税の対象・国内取引の判定 | theory-scope | theory | 6 | high | 内外判定の基準 (資産の所在地・役務提供地) |
| shohi.theory.exempt | 非課税・免税・不課税の区分 | theory-scope | theory | 6 | high | 非課税と免税を同じ扱いにする |
| shohi.theory.timing | 資産の譲渡等の時期 | theory-scope | theory | 4 | mid | 割賦販売の特例 |
| shohi.theory.tax-base | 課税標準・軽減税率 | theory-scope | theory | 4 | high | 一体資産の判定 |
| shohi.theory.input-credit | 仕入税額控除の要件・インボイス | theory-credit | theory | 8 | high | 帳簿と請求書の保存要件の書き漏れ |
| shohi.theory.small-business | 納税義務の免除・特定期間・新設法人 | theory-credit | theory | 6 | high | 特定期間の判定 (課税売上高と給与) |
| shohi.theory.simplified | 簡易課税制度 | theory-credit | theory | 4 | high | 届出の効力発生時期 |
| shohi.theory.adjustment | 調整対象固定資産・棚卸資産の調整 | theory-credit | theory | 4 | mid | 3 年縛りの要件 |
| shohi.theory.procedure | 申告・納付・届出 | theory-proc | theory | 4 | mid | 中間申告の回数判定 |
| shohi.theory.cross-border | 輸出免税・国境を越える役務提供 | theory-proc | theory | 4 | mid | リバースチャージの対象 |
| shohi.calc.classification | 取引分類 (課税・非課税・免税・不課税) | calc-class | calc | 10 | high | 土地の貸付の期間判定 |
| shohi.calc.tax-base | 課税標準額・売上対価の返還 | calc-class | calc | 6 | high | 税込金額の割戻し (110 分の 100) |
| shohi.calc.ratio | 課税売上割合の計算 | calc-class | calc | 6 | high | 有価証券の譲渡は 5% |
| shohi.calc.individual | 個別対応方式・一括比例配分方式 | calc-credit | calc | 10 | high | 共通対応の按分漏れ |
| shohi.calc.adjustment | 仕入税額控除の調整 (棚卸資産・固定資産) | calc-credit | calc | 6 | mid | 課税売上割合の著しい変動の判定 |
| shohi.calc.simplified | 簡易課税のみなし仕入率 | calc-credit | calc | 5 | mid | 75% ルールの適用 |
| shohi.calc.final | 納付税額・中間申告・地方消費税 | calc-credit | calc | 7 | high | 地方消費税を 22/78 で計算 |

**sozoku.json** 相続税法。units: `sozoku.theory-scope` 理論・課税財産 / `sozoku.theory-special` 理論・特例と贈与 / `sozoku.theory-proc` 理論・手続と評価 / `sozoku.calc-tax` 計算・税額 / `sozoku.calc-valuation` 計算・財産評価

| id | name | unit | fmt | w | freq | pitfall |
|---|---|---|---|---|---|---|
| sozoku.theory.taxpayer | 納税義務者・課税財産の範囲 | theory-scope | theory | 5 | high | 居住無制限と非居住無制限の区別 |
| sozoku.theory.deemed | みなし相続財産 (生命保険・退職金) | theory-scope | theory | 5 | high | 非課税限度額の計算対象 |
| sozoku.theory.non-taxable | 非課税財産・債務控除 | theory-scope | theory | 4 | mid | 葬式費用の範囲 (香典返しは不可) |
| sozoku.theory.gift-add | 生前贈与加算・相続時精算課税 | theory-special | theory | 6 | high | 加算期間 (改正あり、要確認) |
| sozoku.theory.spouse | 配偶者の税額軽減・各種税額控除 | theory-special | theory | 5 | high | 未分割の場合の適用可否 |
| sozoku.theory.small-land | 小規模宅地等の特例 | theory-special | theory | 6 | high | 家なき子要件 |
| sozoku.theory.gift-tax | 贈与税の課税・配偶者控除・非課税 | theory-special | theory | 6 | high | 教育資金一括贈与の残額課税 |
| sozoku.theory.business-succession | 事業承継税制・納税猶予 | theory-proc | theory | 4 | mid | 特例措置の期限 |
| sozoku.theory.procedure | 申告・納付・延納物納 | theory-proc | theory | 4 | mid | 物納の順位 |
| sozoku.theory.valuation-theory | 財産評価基本通達の考え方 | theory-proc | theory | 5 | mid | 時価の意義 |
| sozoku.calc.heirs | 法定相続人・相続分・基礎控除 | calc-tax | calc | 6 | high | 養子の数の制限 |
| sozoku.calc.total-tax | 相続税の総額・各人の算出税額 | calc-tax | calc | 8 | high | 2 割加算の対象者 |
| sozoku.calc.land | 宅地の評価 (路線価・倍率・画地調整) | calc-valuation | calc | 9 | high | 奥行価格補正率の適用漏れ |
| sozoku.calc.small-land | 小規模宅地等の減額計算 | calc-valuation | calc | 6 | high | 限度面積の調整計算 |
| sozoku.calc.stock | 取引相場のない株式の評価 | calc-valuation | calc | 8 | high | 会社規模の判定 |
| sozoku.calc.other-assets | 預貯金・生命保険・上場株式・その他 | calc-valuation | calc | 4 | mid | 上場株式の 4 つの価額の最低値 |
| sozoku.calc.credits | 税額控除 (配偶者・未成年・障害者・相次相続) | calc-tax | calc | 5 | high | 控除の順序 |
| sozoku.calc.gift | 贈与税額の計算・精算課税 | calc-tax | calc | 4 | mid | 特例税率と一般税率の按分 |

**shotoku.json** 所得税法。units: `shotoku.theory-scope` 理論・課税の範囲 / `shotoku.theory-income` 理論・各種所得 / `shotoku.theory-proc` 理論・控除と手続 / `shotoku.calc-income` 計算・各種所得 / `shotoku.calc-tax` 計算・課税標準と税額

| id | name | unit | fmt | w | freq | pitfall |
|---|---|---|---|---|---|---|
| shotoku.theory.taxpayer | 納税義務者・課税所得の範囲 | theory-scope | theory | 4 | mid | 非永住者の課税範囲 |
| shotoku.theory.income-types | 各種所得の区分の考え方 | theory-scope | theory | 6 | high | 事業所得と雑所得の区分基準 |
| shotoku.theory.business | 事業所得・必要経費・家事関連費 | theory-income | theory | 6 | high | 家事関連費の必要経費算入要件 |
| shotoku.theory.salary-retirement | 給与所得・退職所得 | theory-income | theory | 4 | high | 短期退職手当等の 2 分の 1 不適用 |
| shotoku.theory.capital-gains | 譲渡所得・株式等の譲渡 | theory-income | theory | 6 | high | 総合課税と分離課税の区分 |
| shotoku.theory.real-estate | 不動産所得・損益通算 | theory-income | theory | 4 | mid | 土地取得の負債利子の通算制限 |
| shotoku.theory.deductions | 所得控除の理論 | theory-proc | theory | 5 | high | 扶養親族の合計所得要件 |
| shotoku.theory.tax-credits | 税額控除・住宅ローン控除 | theory-proc | theory | 4 | mid | 配当控除の適用除外 |
| shotoku.theory.withholding | 源泉徴収・年末調整 | theory-proc | theory | 4 | mid | 年末調整の対象外となる人 |
| shotoku.theory.blue-return | 青色申告・記帳・申告手続 | theory-proc | theory | 4 | high | 65 万円控除の電子申告要件 |
| shotoku.theory.timing | 収入金額の計上時期 | theory-scope | theory | 3 | mid | 給与の支給日と計算期間 |
| shotoku.calc.business | 事業所得の計算 (減価償却・専従者) | calc-income | calc | 8 | high | 専従者給与の要件 (6 か月超) |
| shotoku.calc.salary-retirement | 給与・退職所得の計算 | calc-income | calc | 5 | high | 給与所得控除の上限 |
| shotoku.calc.capital-gains | 譲渡所得 (総合・分離・特例) | calc-income | calc | 8 | high | 3,000 万円控除と軽減税率の併用 |
| shotoku.calc.real-estate-interest | 不動産・利子・配当所得 | calc-income | calc | 5 | mid | 配当所得の負債利子控除 |
| shotoku.calc.misc-temporary | 雑所得・一時所得・山林所得 | calc-income | calc | 4 | mid | 一時所得の 2 分の 1 は総所得で |
| shotoku.calc.aggregation | 損益通算・繰越控除・課税標準 | calc-tax | calc | 6 | high | 損益通算の順序 |
| shotoku.calc.deductions | 所得控除の計算 | calc-tax | calc | 6 | high | 医療費控除の 10 万円と 5% |
| shotoku.calc.tax-amount | 税額計算・税額控除・申告納税額 | calc-tax | calc | 8 | high | 復興特別所得税の計算漏れ |

`prereq` は次だけ: `zaihyo.calc.fixed → [zaihyo.theory.fixed-assets]`, `hojin.calc.depreciation → [hojin.theory.depreciation]`, `hojin.calc.entertainment → [hojin.theory.entertainment]`, `shohi.calc.ratio → [shohi.calc.classification]`, `shohi.calc.individual → [shohi.calc.ratio, shohi.calc.classification]`, `sozoku.calc.total-tax → [sozoku.calc.heirs]`, `sozoku.calc.small-land → [sozoku.calc.land]`, `shotoku.calc.aggregation → [shotoku.calc.business, shotoku.calc.capital-gains]`, `shotoku.calc.tax-amount → [shotoku.calc.aggregation, shotoku.calc.deductions]`。他は `[]`。

- [ ] **Step 4: 通す** `python3 scripts/coach.py lint && python3 -m pytest -q` → OK 6 行、全緑 (`theory_items` のテストもここで通る)

- [ ] **Step 5: Commit**

```bash
git add references/subjects/ tests/test_subjects.py
git commit -m "feat: 財表/法人/消費/相続/所得の論点 tree を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: SKILL.md / rubric / 解説 style / manifest / README / permission snippet

**Files:**
- Create: `SKILL.md`, `README.md`, `manifest.yaml`, `references/question-rubric.md`, `references/explanation-style.md`, `runtime/claude/settings-snippet.json`
- Test: `tests/test_skill_docs.py`

- [ ] **Step 1: 失敗するテスト `tests/test_skill_docs.py`**

```python
import json
import re

from conftest import COACH_ROOT


def _read(rel):
    return (COACH_ROOT / rel).read_text(encoding="utf-8")


def test_skill_frontmatter_and_commands():
    text = _read("SKILL.md")
    assert text.startswith("---\nname: zeirishi-coach\n") and "description:" in text.split("---")[1]
    for needle in ["coach.py init", "coach.py next", "coach.py start", "coach.py record", "coach.py report", "coach.py dashboard",
                   "coach.py mock", "coach.py status", "coach.py plan", "--diagnostic", "--error-class", "--score", "--memo-stage",
                   "--rank", "knowledge", "procedure", "time", "misread", "references/question-rubric.md",
                   "references/explanation-style.md", "references/subjects/", "小問", "キーワード", "骨子", "全文"]:
        assert needle in text, needle


def test_rubric_and_style_sections():
    rubric = _read("references/question-rubric.md")
    for s in ["入力", "出力", "採点基準", "典型ミス", "論点混在", "小問", "memo_target", "本番形式"]:
        assert s in rubric, s
    style = _read("references/explanation-style.md")
    for s in ["中学生", "根拠", "本試験", "次の一手", "e-Gov", "要確認"]:
        assert s in style, s


def test_manifest_files_exist():
    for rel in re.findall(r"^\s+- (\S+)$", _read("manifest.yaml"), flags=re.M):
        assert (COACH_ROOT / rel).exists(), rel


def test_settings_snippet_allows_coach():
    snippet = json.loads(_read("runtime/claude/settings-snippet.json"))
    allow = snippet["permissions"]["allow"]
    assert any("coach.py" in a for a in allow)
    assert "settings-snippet" in _read("README.md")
```

- [ ] **Step 2: 失敗確認** → FileNotFoundError

- [ ] **Step 3: `SKILL.md`**

````markdown
---
name: zeirishi-coach
description: 税理士試験の合格ライン付近の学習者を確実に合格させる学習コーチ。「税理士の勉強」「簿記論やる」「今日のメニュー」「模試の結果を入れる」「合格確率見せて」「/zeirishi-coach」で起動。科目選択 → 診断 → 毎日の演習 (復習/弱点/挑戦、論点混在) → 読み砕き解説 → 合格確率・目標曲線・学習効率の計測。問題は論点 tree に沿ってこの場で生成する。
---

# zeirishi-coach

あなたは税理士試験の専属コーチ。目的は **学習者の合格確率を最大化する** こと。楽しさ (XP・ランク・ボス) は手段で、解説の質と復習の設計が本体。

## 使うもの

- 計測 CLI: `python3 <このskillのdir>/scripts/coach.py` (以下 `coach.py`)。記録・メニュー・合格確率・目標はすべてこれが正本。自分で暗算しない。
- 論点 tree: `references/subjects/<subject>.json`。問題は必ずこの中の論点 id に紐づける。
- 問題の作り方: `references/question-rubric.md` / 解説の書き方: `references/explanation-style.md`
- 学習者が手元に置いた教材 PDF / メモ (あれば): 言い回しをそれに揃える。同梱・転載はしない。

skill の dir はこの SKILL.md の場所。Bash で `coach.py` を呼ぶ時は絶対パスにする。

## 起動時の分岐

1. `coach.py status` で科目ごとの状況を見る。科目が引数で指定されていればそれ、複数科目があり指定が無ければ `recommended` (合格確率が最も低い科目) を提案する。
2. state が無い科目 → **初回フロー**。ある科目 → `coach.py report <subject> --json` の `final_phase` が true なら **直前期フロー**、それ以外は **通常フロー**。
3. 学習者が「模試の結果」「ダッシュボード」「状況だけ」「計画を見たい」と言ったら、該当コマンド (`mock` / `dashboard` / `report` / `plan`) だけ実行して終わる。

## 初回フロー

1. `coach.py subjects` で科目一覧を出し、選んでもらう (複数なら 1 科目ずつ init する)。
2. 短いインタビュー (5 問まで): 本番日 (既定 2027-08-05 頃) / 直近の模試得点 (無ければ自己申告レベル 1〜5) / 週の可処分時間 / 予備校・教材 / 苦手な単元。
3. `coach.py init <subject> --exam-date YYYY-MM-DD (--level N | --mock-score N) --weekly-hours H --school S --note "苦手: ..."`
4. 診断: `coach.py next <subject> --diagnostic` の items を順に出題 (単元ごとに 1 問)。各問は「1 問の回し方」に従う。
5. `coach.py report <subject>` を見せ、単元別の現在地・目標曲線・「次のボス」を 3 行で言う。

## 通常フロー

1. `coach.py next <subject>` の `quests` (復習 / 弱点 / 挑戦) をクエストとして見せる。`fading: true` は「消えかけている記憶。今日中に思い出せれば XP 2 倍」と伝える。
2. `items` の順 (論点混在) に 1 問ずつ出す。順番を変えない。
3. 途中で疲れたら中断してよい。記録済みの分は残る。
4. 終了時に `coach.py report <subject>`。合格確率と目標の差、ランクアップ、新称号、撃破ボス、次のボスの期限を短く。
5. 望めば `coach.py dashboard <subject>` で HTML を作り path を伝える。

## 直前期フロー (本番 30 日前〜)

- 週 1 回の本番形式模試を提案する。rubric の「本番形式」で 2 時間分を生成し、得点・所要時間・(予備校模試なら順位) を `coach.py mock <subject> --score N --minutes M [--rank N --of M]` で記録する。
- 捨て問判定の練習: 各大問に「解く / 後回し / 捨て」を先に宣言させ、宣言と結果のずれを解説で扱う。
- `time` 分類が続くなら、知識より時間配分の練習に切り替える。

## 1 問の回し方

1. item (`topic / format / difficulty / budget_seconds / pitfalls / memo_stage / memo_target`) を rubric に渡して問題を生成する。
   - 計算: 小問 3〜5 個に分ける。理論: `memo_target` の段階 (1 キーワード列挙 / 2 骨子 / 3 全文再生) で問う。
2. `coach.py start <subject> --topic <id>` を打ってから問題文と目安時間を見せる。解答例は見せない。
3. 学習者の解答を採点基準で採点し、`score` (0.0〜1.0、小問の合計) を決める。
4. **score 0.7 以上** → 一言 (褒め + 本試験での問われ方 1 行)。**未満** → `explanation-style.md` の 3 段解説 → 誤答分類を選ばせる (`knowledge` 知らなかった / `procedure` 手順ミス / `time` 時間切れ・捨てるべきだった / `misread` 読み違い)。
5. 記録 (必ず 1 問ごと):
   `coach.py record <subject> --topic <id> --score <0..1> --error-class <none|knowledge|procedure|time|misread> --difficulty <item の difficulty> [--memo-stage <達成した段階>]`
   (`--seconds` は省略して timer に任せる。学習者が「実際は N 分かかった」と言ったら `--seconds` で上書き)
6. 返ってきた `reward` を 1 行で演出する (例: 「+24 XP、コンボ 3、減価償却が 見習い → 一人前」)。新称号があれば名前と条件を言う。

## 守ること

- 数値 (習得度・合格確率・XP・目標) は必ず `coach.py` の出力を使う。推測で言わない。
- 法令・基準の根拠は条文番号・項番まで書き、e-Gov 法令検索の URL を添える。曖昧なら「要確認」と明示する。改正が絡む論点は「本番年度の法令で確認」と添える。pitfalls の改正事項は未確認扱い。
- 問題文に予備校教材や過去問の本文を転載しない。
- 解説の演出で内容を薄めない。楽しさは reward の 1 行に閉じる。
- 学習者の記録 (`~/.zeirishi-coach/`) を外に送らない。
- 複数科目: 1 セッション 1 科目。次の科目は `status` の `recommended` に従う。
````

- [ ] **Step 4: `references/question-rubric.md`**

```markdown
# 問題生成 rubric

## 入力

`coach.py next` の item: `topic`, `name`, `format` (calc/theory), `difficulty` (2〜5), `budget_seconds`, `pitfalls`, `reason`, `memo_stage`, `memo_target`。直近の誤答分類があればそれも。

## 出力 (内部に用意し、学習者には問題文と目安時間だけ見せる)

1. 問題文: 本試験の言い回し。計算は資料形式 (前提 → 資料 → 問) で **小問 3〜5 個** に分ける。理論は `memo_target` に応じて:
   - 1 キーワード列挙: 「この制度の要件・効果をキーワードで 5 つ挙げよ」
   - 2 骨子再生: 「見出し + 各 1 文で構成を再現せよ」
   - 3 全文再生: 「趣旨と要件を条文に沿って 300 字で書け」
   計算・理論とも、正誤 + 理由型を時々混ぜる。
2. 解答例: 計算は小問ごとに途中式。理論は段階に応じた模範解答。
3. 採点基準: 満点 1.0。小問ごとの配点 (例: 0.2 / 0.3 / 0.3 / 0.2)。合計を `score` として record に渡す。
4. 典型ミス: `pitfalls` から 1 つ選び、それを踏むと間違える条件を仕込む。どれを仕込んだかを内部メモに残す。
5. 想定解答時間: `budget_seconds` を目安に。

## 難度

| difficulty | 内容 |
|---|---|
| 2 | 基本形。1 論点・1 手順 |
| 3 | 本試験の標準。条件が 2 つ絡む |
| 4 | 応用。他論点との複合、資料の読み替え |
| 5 | 難問。捨て問判定の練習を兼ねる。解けなくても `time` を選んでよいと先に言う |

## 制約

- 数字は毎回変える。同じ問題を出さない。
- 演習は論点混在で出す。`items` の順序を守る。同じ論点を 2 問続けない。
- 改正が絡む論点は「本番年度の法令による」と注記する。根拠を書く時は e-Gov 法令検索の URL を添える (例: `https://laws.e-gov.go.jp/law/340AC0000000034` 法人税法)。
- 予備校教材・過去問本文を転載しない。過去問は「出題傾向」としてだけ参照する。

## 本番形式 (直前期の模試)

- 科目の `exam.minutes` と `exam.format` に合わせ、理論と計算を本番の配点比で組む。
- 大問 2〜3 つ。難度 3 を中心に、難度 5 を 1 つ混ぜる (捨て問の練習)。
- 開始前に「解く / 後回し / 捨て」を大問ごとに宣言させる。
- 終了後、得点 (100 点換算) と所要時間、順位があればそれも `coach.py mock` に入れる。
```

- [ ] **Step 5: `references/explanation-style.md`**

```markdown
# 読み砕き解説 (3 段固定)

score 0.7 未満のたびに、この 3 段を順に書く。合計 300〜500 字。

## 1. 中学生に話す言葉で

- 何が起きている取引・制度なのかを、専門用語なしで 2〜3 文。比喩は 1 つまで。
- 学習者が手元に教材を置いていれば、その教材の言い回し・図の呼び名に揃える。

## 2. 根拠

- 条文番号 (法人税法 22 条 3 項、消費税法 30 条 1 項 など) または会計基準の項番 (企業会計基準第 29 号 35 項 など)。
- e-Gov 法令検索の URL を 1 つ添える (`https://laws.e-gov.go.jp/`)。会計基準は ASBJ の基準名で示す。
- 根拠が曖昧なら「要確認」と明示する。作らない。改正が絡むなら「本番年度の法令で確認」と添える。

## 3. 本試験でどう問われるか + 次の一手

- この論点が本試験でどんな形 (資料の置き方・ひっかけ) で出るかを 1〜2 文。
- 誤答分類ごとの次の一手:
  - `knowledge`: 覚え方を 1 つ (対比・語呂・図)。次回は同じ論点を別の数字で出すと予告。理論なら暗記段階を 1 つ戻して練習。
  - `procedure`: 手順を番号付きで 3〜5 行。「どこで止まったか」を指摘。
  - `time`: 解かない判断が正しかったかを言う。捨て問の見分け方 (資料量・配点・難度) を 1 行。
  - `misread`: 読み落とした条件を引用し、問題文のどこに目印を付けるかを言う。

## 禁止

- 「簡単です」「基本です」など評価語。
- 3 段を超える長文。詳しく知りたいと言われたら別途。
- 演出 (XP・称号) を解説の中に混ぜる。演出は record の後の 1 行に閉じる。
```

- [ ] **Step 6: `manifest.yaml` / `runtime/claude/settings-snippet.json` / `README.md`**

`manifest.yaml`:

```yaml
name: zeirishi-coach
version: 0.2.0
description: 税理士試験 合格確定コーチ (Claude Code skill)
runtime:
  claude-code:
    install_path: ~/.claude/skills/zeirishi-coach
    entry: SKILL.md
    requires:
      - python3 (3.11+)
files:
  - SKILL.md
  - README.md
  - references/question-rubric.md
  - references/explanation-style.md
  - references/subjects/boki.json
  - references/subjects/zaihyo.json
  - references/subjects/hojin.json
  - references/subjects/shohi.json
  - references/subjects/sozoku.json
  - references/subjects/shotoku.json
  - runtime/claude/settings-snippet.json
  - scripts/coach.py
  - scripts/coach_lib/__init__.py
  - scripts/coach_lib/subjects.py
  - scripts/coach_lib/model.py
  - scripts/coach_lib/state.py
  - scripts/coach_lib/scheduler.py
  - scripts/coach_lib/report.py
  - scripts/coach_lib/dashboard.py
state_dir: ~/.zeirishi-coach
```

`runtime/claude/settings-snippet.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(python3 */zeirishi-coach/scripts/coach.py *)",
      "Bash(python3 ~/.claude/skills/zeirishi-coach/scripts/coach.py *)"
    ]
  }
}
```

`README.md`:

```markdown
# zeirishi-coach

税理士試験の合格ライン付近の人を「確実に合格」させる Claude Code 用コーチ skill。
問題はその場で生成、記録は手元 (`~/.zeirishi-coach/`) にだけ残る。

## 入れ方 (Claude Code)

1. この repo を `~/.claude/skills/zeirishi-coach/` に置く (clone か zip 展開。フォルダ名はそのまま)。
2. 毎問の記録で許可プロンプトが出ないように、`runtime/claude/settings-snippet.json` の `permissions.allow` を
   `~/.claude/settings.json` の `permissions.allow` に追記する。
3. Claude Code で `/zeirishi-coach` と打つ。科目を選ぶところから始まる。

必要なもの: Python 3.11 以上。追加 package なし。

## 毎日の流れ

`/zeirishi-coach` → 今日のメニュー (復習 / 弱点 / 挑戦) → 1 問ずつ解く → 解説 → 終わりに合格確率と目標の差、次のボス。

## 論点や配点がずれていると感じたら

`references/subjects/<科目>.json` の `weight` や `pitfalls` を直して `python3 scripts/coach.py lint`。
直した内容は issue か PR で共有すると次の人に効く。改正事項は本番年度の法令で確認する。

## 開発

```bash
python3 -m pytest -q && python3 scripts/coach.py lint
```
```

- [ ] **Step 7: 通す** `python3 -m pytest -q` → 全緑

- [ ] **Step 8: Commit**

```bash
git add SKILL.md README.md manifest.yaml references/question-rubric.md references/explanation-style.md runtime/claude/settings-snippet.json tests/test_skill_docs.py
git commit -m "feat: SKILL.md (対話フロー) と rubric/解説 style/manifest/permission snippet を追加

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: 1 週間 smoke (evidence) と push

**Files:**
- Create: `tests/smoke_one_week.py` (pytest 対象外の再現 script)
- Modify: `docs/plans/2026-09-04-zeirishi-coach.md` (Evidence 節)

- [ ] **Step 1: `tests/smoke_one_week.py`**

```python
"""7 日ぶんの学習を CLI で再現し、合格確率が動くこと・目標曲線・dashboard を確認する。
使い方: ZEIRISHI_COACH_HOME=$TMPDIR/coach-smoke python3 tests/smoke_one_week.py
"""
import json
import os
import random
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

COACH = Path(__file__).resolve().parent.parent / "scripts" / "coach.py"
SUBJECT, START = "zaihyo", date(2026, 9, 4)


def run(*args):
    return subprocess.run([sys.executable, str(COACH), *args], capture_output=True, text=True, check=True).stdout


def main():
    assert os.environ.get("ZEIRISHI_COACH_HOME"), "set ZEIRISHI_COACH_HOME to a temp dir"
    random.seed(7)
    run("init", SUBJECT, "--exam-date", "2027-08-05", "--level", "3", "--weekly-hours", "10", "--today", START.isoformat(), "--force")
    probs = []
    for day in range(7):
        today = (START + timedelta(days=day)).isoformat()
        menu = json.loads(run("next", SUBJECT, "--n", "8", "--today", today))
        for item in menu["items"]:
            score = round(random.choice([0.0, 0.3, 0.6, 0.8, 1.0, 1.0]), 1)
            cls = "none" if score >= 0.7 else random.choice(["knowledge", "procedure", "time", "misread"])
            args = ["record", SUBJECT, "--topic", item["topic"], "--score", str(score), "--seconds",
                    str(random.randint(90, item["budget_seconds"] + 120)), "--error-class", cls,
                    "--difficulty", str(item["difficulty"]), "--today", today]
            if item["memo_target"] is not None:
                args += ["--memo-stage", str(item["memo_target"])]
            run(*args)
        r = json.loads(run("report", SUBJECT, "--json", "--today", today))
        probs.append(r["pass_prob"])
        print(f"{today} pass={r['pass_prob']:.3f} target={r['target_pass_prob']:.3f} on_track={r['on_track']} xp={r['xp']} streak={r['streak_days']} titles={r['titles']}")
    last = (START + timedelta(days=6)).isoformat()
    run("mock", SUBJECT, "--score", "58", "--minutes", "125", "--rank", "120", "--of", "1000", "--today", last)
    path = run("dashboard", SUBJECT, "--today", last).strip()
    print("dashboard:", path)
    assert Path(path).exists() and len(set(probs)) > 1
    print(run("report", SUBJECT, "--today", last))
    print(run("status", "--today", last))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 実行** `ZEIRISHI_COACH_HOME=$TMPDIR/coach-smoke python3 tests/smoke_one_week.py` → 7 行の日次 log (理論論点の memo_stage が上がる)、7 日目に `皆勤`、dashboard path、report、status。

- [ ] **Step 3: dashboard を Browser pane で開き screenshot** (`file://$TMPDIR/coach-smoke/zaihyo/dashboard.html`)。確認: tile 6 枚、実線 + 点線の 2 本、ヒートマップの色、ダークモードの可読性。

- [ ] **Step 4: Claude Code で skill を 1 周** (診断 3 問 → 演習 3 問 → report → dashboard)。`~/.claude/skills/` への配置は CEO 承認後。結果は Evidence 節に要約。

- [ ] **Step 5: Evidence を plan 末尾に追記して commit、push は CEO 確認後**

```markdown
## Evidence (実行後に記入)
- pytest: N passed (日付) / lint: 6 科目 OK
- smoke_one_week: pass_prob の推移 / 称号 / mock 後の pass_prob
- dashboard screenshot: path
- Claude Code 1 周: 科目 / 問数 / 気づいた不具合
```

---

## Self-Review

- **Spec coverage**: §1 → Task 1, 8, 9。§2.1〜2.3 → Task 9 + Task 4 (`--diagnostic`) + Task 7 (`mock`, `status`)。§2.4 ゲーム性 → Task 3 (XP / コンボ / 称号 / fading ×2), Task 4 (クエスト), Task 5 (ボス / レベル)。§3 → Task 2, 3, 7。§4 配置 → Task 9 (manifest / README / snippet)。§7.1 習得度 → Task 2 `mastery` + Task 3 `topic_mastery`。§7.2 暗記段階 → Task 3 (`memo_stage`), Task 4 (`memo_target`), Task 9 (rubric)。§7.3 小問・部分点 → Task 2 `bkt_blend`, Task 3 `score`, Task 7 `--score`, Task 9。§7.4 timer → Task 3, 7 (`start`)。§7.5 マクロ計画 → Task 3 `build_plan`, Task 5 (`target / on_track / next_milestone`), Task 6 (点線), Task 7 (`plan`)。§7.6 順位較正 → Task 2 `rank_probability`, Task 7 (`--rank --of`)。§7.7 permission → Task 9。§7.8 B: e-Gov (Task 9), rebuild + schema_version (Task 3, 7), profile (Task 3, 7, 9), 複数科目 `status` (Task 7, 9), weight CE ループ (README)。§7.9 C は spec の後回しに列挙済み、Task 8 で `_note` を入れる。
- **Placeholder scan**: なし。
- **Type consistency**: `record_attempt(st, subject, topic_id, score, seconds, error_class, difficulty, today, memo_stage=None)` を Task 3 で定義し、Task 4/5/6/7/10 の呼び出しと一致。`compute_scores` (Task 3) を Task 5/7 が使用。`topic_mastery` (Task 3) を Task 4/5/6 が使用。`build_plan` / `target_prob_today` (Task 3) を Task 5/6/7 が使用。item keys (`topic/unit/fading/xp_multiplier/difficulty/budget_seconds/memo_stage/memo_target`) を Task 7/10 が参照。`record_mock(..., rank=None, of=None)` を Task 7 で定義、`rebuild_state` が同じ引数で再生。

## Evidence (2026-09-05 実行)

- pytest: 73 passed (`python3 -m pytest tests -q`) / `coach.py lint`: 6 科目 OK
- smoke_one_week (財務諸表論、8 問/日 × 7 日、正答率 ~65% の乱数、7 日目に模試 58 点・順位 120/1000):
  pass_prob 0.000 → 0.007 (4 日目) → 0.060 → 0.091 → 0.197 (7 日目) → 模試較正後 0.531。
  称号: 初陣 / 皆勤 (7 日連続) / 師範への道。撃破ボス: 理論・基礎概念。学習効率 +0.0009 習得度/分
- dashboard: `~/.zeirishi-coach/<subject>/dashboard.html` を生成 (実績 + 目標曲線の 2 本、ヒートマップ、tile 6 枚)
- 計画書からの差分は各 Task の commit message と spec §7.11 に記録 (テスト側の誤り 7 件、state の pass_prob 丸め、同日の mastery_avg_start)
- Claude Code 上での 1 周 (2026-09-05、一時 home で自己テスト): skill を `~/.claude/skills/zeirishi-coach` に置き `/zeirishi-coach boki` で起動 → status (state なし) → init (level 4, 週 12h, 苦手メモ) → 診断 3 問 (商品売買 0.6 knowledge / 貸倒引当金 1.0 / 減価償却 0.3 procedure) → 通常メニュー (復習 3・弱点 3・挑戦 0) → 演習 1 問 (減価償却 1.0、復習期限内で XP 2 倍 = 26) → report (期待得点 23.1、次のボス 有形固定資産 2026-11-14、称号 初陣) → dashboard 生成。気づき: 序盤は挑戦クエストが空 (SKILL.md に「今日は無し」の扱いを追記)
