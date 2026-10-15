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
    # design (docs/specs §2.4): 称号「捨て問の目利き」は time 分類が 5 回連続ゼロで成立する。
    # 論点を分散させて回す (次回復習日の指数バックオフを避けるため。state.py 側の interval
    # 計算には手を入れない、テスト側の都合)。
    other_topics = [t["id"] for t in boki["topics"] if t["id"] != "boki.cash.genkin"]
    for i in range(state.TITLE_TIME_STREAK):
        topic = other_topics[i % len(other_topics)]
        state.record_attempt(st, boki, topic, 1.0, 100, "none", 3, "2026-09-07")
    assert state.TITLE_TIME in st["titles"]


def test_title_time_streak_does_not_require_prior_time_error(boki, coach_home):
    """PR #1 レビュー指摘 (state.py:224): 一度も time 誤答をしていない学習者も
    5 回連続で time 以外の解答をすれば称号を得られる (docs/specs §2.4 に「前提として
    time 誤答が必要」という記述は無い)。"""
    s = state.init_state(boki, exam_date="2027-08-05", level=3, today=TODAY)
    topics = [t["id"] for t in boki["topics"]]
    for i in range(state.TITLE_TIME_STREAK):
        state.record_attempt(s, boki, topics[i % len(topics)], 1.0, 100, "none", 3, TODAY)
    assert s["time_errors_total"] == 0
    assert state.TITLE_TIME in s["titles"]


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


def test_history_row_records_mastery_avg_start(st, boki):
    start = st["history"][0]["mastery_avg_start"]
    assert start == pytest.approx(st["history"][0]["mastery_avg"])
    state.record_attempt(st, boki, DEP, 1.0, 100, "none", 3, TODAY)
    # 同日内の 2 回目以降の snapshot_history は行を in-place 更新するが、mastery_avg_start は
    # その日の学習開始前の値のまま変わらない。
    assert st["history"][-1]["mastery_avg_start"] == pytest.approx(start)
    assert st["history"][-1]["mastery_avg"] > start


def test_rank_calibration_dropped_after_score_only_mock(st, boki):
    """PR #1 レビュー指摘 (state.py:113): 直近模試に順位が無ければ、古い順位較正を
    引きずらない (docs/specs §7.6「順位がある直近模試がある時のみ」)。"""
    state.record_mock(st, boki, 90, 120, TODAY, rank=1, of=1000)
    _, _, prob_with_rank = state.compute_scores(st, boki)
    state.record_mock(st, boki, 10, 120, "2026-09-05", rank=None, of=None)
    expected, sd, prob_after = state.compute_scores(st, boki)
    score_only_prob = model.pass_probability(expected, sd, boki["exam"]["passing_line"])
    assert prob_after == pytest.approx(score_only_prob)
    assert prob_after < prob_with_rank


def test_mock_validates_score_and_rank(st, boki):
    with pytest.raises(ValueError):
        state.record_mock(st, boki, 600, 120, TODAY)
    with pytest.raises(ValueError):
        state.record_mock(st, boki, -5, 120, TODAY)
    with pytest.raises(ValueError):
        state.record_mock(st, boki, 50, 120, TODAY, rank=0, of=100)
    with pytest.raises(ValueError):
        state.record_mock(st, boki, 50, 120, TODAY, rank=10, of=0)
    with pytest.raises(ValueError):
        state.record_mock(st, boki, 50, 120, TODAY, rank=101, of=100)


def test_mock_updates_streak(st, boki):
    """PR #1 レビュー指摘 (state.py:309): 模試も学習日として streak に数える。"""
    assert st["streak"]["days"] == 0
    state.record_mock(st, boki, 55, 120, TODAY)
    assert st["streak"] == {"days": 1, "last_study_date": TODAY}
    state.record_mock(st, boki, 60, 120, "2026-09-05")
    assert st["streak"]["days"] == 2


def test_negative_seconds_rejected(st, boki):
    """PR #1 レビュー指摘 (state.py:285): 負の所要時間を拒否する。"""
    with pytest.raises(ValueError):
        state.record_attempt(st, boki, DEP, 1.0, -60, "none", 3, TODAY)


def test_log_and_history(st, boki, coach_home):
    state.record_attempt(st, boki, "boki.sales.shohin", 1.0, 120, "none", 3, TODAY)
    rows = [json.loads(l) for l in (coach_home / "boki" / "attempts.jsonl").read_text(encoding="utf-8").splitlines()]
    assert rows[-1]["kind"] == "attempt" and rows[-1]["topic"] == "boki.sales.shohin" and rows[-1]["score"] == 1.0
    assert st["history"][-1]["minutes"] == pytest.approx(2.0)
    assert state.days_between("2026-09-04", "2026-09-06") == 2


@pytest.mark.parametrize("minutes", [-1, float("nan"), float("inf"), float("-inf")])
def test_mock_invalid_duration_rejected_before_state_or_log_mutation(st, boki, coach_home, minutes):
    import copy
    before = copy.deepcopy(st)
    files = {str(file.relative_to(coach_home)): file.read_bytes() for file in coach_home.rglob("*") if file.is_file()}
    with pytest.raises(ValueError):
        state.record_mock(st, boki, 50, minutes, TODAY)
    assert st == before
    assert {str(file.relative_to(coach_home)): file.read_bytes() for file in coach_home.rglob("*") if file.is_file()} == files
