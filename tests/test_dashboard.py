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
