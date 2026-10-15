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
