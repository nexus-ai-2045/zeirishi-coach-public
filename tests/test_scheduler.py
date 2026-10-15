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


def test_interleave_no_adjacent_units_in_menu(subjects_dir, coach_home):
    boki = subjects.load_subject("boki", subjects_dir)
    st = state.init_state(boki, "2027-08-05", 3, today=TODAY)
    menu = scheduler.build_menu(st, boki, TODAY, n=10)
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
