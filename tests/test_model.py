import math

import pytest

from coach_lib import model

P = dict(p_learn=0.2, p_guess=0.1, p_slip=0.1)


@pytest.mark.parametrize("p", [0.3, 0.5, 0.7, 0.9])
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
    assert model.pass_probability(30, sd, 60) < model.pass_probability(60, sd, 60)
    assert model.pass_probability(60, sd, 60) == pytest.approx(0.5)
    assert model.pass_probability(60, sd, 60) < model.pass_probability(90, sd, 60)
    assert model.score_sd(0.5, []) > model.BASE_SD
    assert model.BASE_SD == model.score_sd(1.0, [])
    assert model.score_sd(1.0, [40, 70]) > model.score_sd(1.0, [55, 55])


def test_rank_probability_and_blend():
    assert model.rank_probability(0.15, 0.15) == pytest.approx(0.5)
    assert model.rank_probability(0.05, 0.15) > 0.85 > 0.1 > model.rank_probability(0.40, 0.15)
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
