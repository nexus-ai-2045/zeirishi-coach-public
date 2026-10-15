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


def test_force_reinit_clears_attempts_log(capsys, coach_home, subjects_dir):
    """PR #1 レビュー指摘 (coach.py:63): init --force は state.json だけでなく
    attempts.jsonl / timer も初期化しないと、rebuild が捨てたはずの旧セッションを
    再生してしまう。"""
    run(capsys, "init", "boki", "--exam-date", "2027-08-05", "--today", TODAY)
    run(capsys, "record", "boki", "--topic", "boki.sales.shohin", "--correct", "yes", "--seconds", "60",
        "--error-class", "none", "--difficulty", "3", "--today", TODAY)
    run(capsys, "init", "boki", "--exam-date", "2027-08-05", "--today", TODAY, "--force")
    log_path = coach_home / "boki" / "attempts.jsonl"
    assert not log_path.exists() or log_path.read_text(encoding="utf-8").strip() == ""
    run(capsys, "record", "boki", "--topic", "boki.sales.shohin", "--correct", "yes", "--seconds", "60",
        "--error-class", "none", "--difficulty", "3", "--today", TODAY)
    boki = subjects.load_subject("boki", subjects_dir)
    rebuilt = state.rebuild_state(boki)
    assert rebuilt["attempts_total"] == 1


def test_record_rejects_timer_for_different_topic(capsys, coach_home):
    """PR #1 レビュー指摘 (coach.py:96): 別 topic で start した timer を record に流用しない。"""
    run(capsys, "init", "boki", "--exam-date", "2027-08-05", "--today", TODAY)
    run(capsys, "start", "boki", "--topic", "boki.sales.shohin", "--now", "2026-09-04T10:00:00")
    code, out = run(capsys, "record", "boki", "--topic", "boki.fixed.depreciation", "--correct", "yes",
                    "--error-class", "none", "--difficulty", "3", "--today", TODAY, "--now", "2026-09-04T10:03:00")
    assert code == 1 and "timer" in out
    assert state.read_timer("boki") is not None  # 別 topic の record 失敗で消えない


def test_plan_rebuild_applies_decay_first(capsys, coach_home, subjects_dir):
    """PR #1 レビュー指摘 (coach.py:140): plan --rebuild の前に減衰を適用する。"""
    boki = subjects.load_subject("boki", subjects_dir)
    run(capsys, "init", "boki", "--exam-date", "2027-08-05", "--today", TODAY)
    run(capsys, "record", "boki", "--topic", "boki.sales.shohin", "--correct", "yes", "--seconds", "60",
        "--error-class", "none", "--difficulty", "3", "--today", TODAY)
    p_before = state.load_state("boki")["topics"]["boki.sales.shohin"]["p"]
    future = state.add_days(TODAY, 60)
    code, out = run(capsys, "plan", "boki", "--rebuild", "--today", future)
    assert code == 0
    st_after = state.load_state("boki")
    assert st_after["topics"]["boki.sales.shohin"]["p"] < p_before
    assert st_after["last_decay_date"] == future


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


def test_invalid_forced_init_preserves_saved_state_logs_and_timer(capsys, coach_home):
    assert run(capsys, "init", "boki", "--exam-date", "2027-08-05", "--today", TODAY)[0] == 0
    assert run(capsys, "record", "boki", "--topic", "boki.sales.shohin", "--correct", "yes", "--seconds", "60", "--error-class", "none", "--difficulty", "3", "--today", TODAY)[0] == 0
    state.start_timer("boki", "boki.sales.shohin", "2026-09-04T10:00:00")
    folder = coach_home / "boki"
    before = {file.name: file.read_bytes() for file in folder.iterdir() if file.is_file()}
    code, _ = run(capsys, "init", "boki", "--exam-date", "not-a-date", "--today", TODAY, "--force")
    assert code != 0
    assert {file.name: file.read_bytes() for file in folder.iterdir() if file.is_file()} == before


def test_negative_mock_duration_does_not_persist(capsys, coach_home):
    assert run(capsys, "init", "boki", "--exam-date", "2027-08-05", "--today", TODAY)[0] == 0
    folder = coach_home / "boki"
    before = {file.name: file.read_bytes() for file in folder.iterdir() if file.is_file()}
    code, _ = run(capsys, "mock", "boki", "--score", "50", "--minutes", "-30", "--today", TODAY)
    assert code != 0
    assert {file.name: file.read_bytes() for file in folder.iterdir() if file.is_file()} == before
