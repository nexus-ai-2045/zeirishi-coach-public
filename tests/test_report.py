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
    # state.snapshot_history は同日内なら history[-1] を in-place で上書きするが、その日の行を
    # 新規作成する時点で「学習前」の mastery_avg を mastery_avg_start として記録している (init_state
    # 時点で 1 回 snapshot_history が呼ばれ、その時はまだ何も解いていないため)。よって同日 1 問でも
    # 増分が復元でき、efficiency_7d は 0 より大きくなる。
    assert r["minutes_7d"] == pytest.approx(10.0) and r["efficiency_7d"] > 0

    state.record_attempt(st, boki, "boki.fixed.depreciation", 1.0, 600, "none", 3, "2026-09-05")
    r2 = report.build_report(st, boki, "2026-09-05")
    # 2 日目以降は history に別の日の行が増えるため、当日の増分が計測できる。
    assert r2["minutes_7d"] == pytest.approx(20.0) and r2["efficiency_7d"] > 0


def test_efficiency_window_excludes_eighth_day(st, boki):
    """PR #1 レビュー指摘 (report.py:38): 7 日前ちょうどの実績は暦日 7 日 (8 日分) を
    数えてしまうので除外する。"""
    state.record_attempt(st, boki, "boki.sales.shohin", 1.0, 600, "none", 3, TODAY)
    later = state.add_days(TODAY, 7)
    r = report.build_report(st, boki, later)
    recent_dates = [h["date"] for h in st["history"] if 0 <= state.days_between(h["date"], later) <= 7]
    assert TODAY in recent_dates  # 素朴な <=7 判定なら含まれてしまう日
    assert r["minutes_7d"] == pytest.approx(0.0)
    assert r["efficiency_7d"] is None


def test_report_snapshots_decayed_value_for_dashboard(st, boki):
    """PR #1 レビュー指摘 (report.py:16): dashboard 描画前に減衰を history へ記録する。"""
    state.record_attempt(st, boki, "boki.sales.shohin", 1.0, 100, "none", 3, TODAY)
    later = state.add_days(TODAY, 30)
    r = report.build_report(st, boki, later)
    assert st["history"][-1]["date"] == later
    assert st["history"][-1]["pass_prob"] == pytest.approx(r["pass_prob"])


def test_weakest_and_format(st, boki):
    st["topics"]["boki.fixed.depreciation"]["p"] = 0.05
    r = report.build_report(st, boki, TODAY)
    assert r["weakest"][0]["topic"] == "boki.fixed.depreciation" and r["weakest"][0]["rank"] == "未着手"
    text = report.format_report(r)
    for needle in ["合格確率", "簿記論", "335", "Lv.1", "目標", "次のボス"]:
        assert needle in text
    assert report.level_for_xp(99) == 1 and report.level_for_xp(100) == 2
