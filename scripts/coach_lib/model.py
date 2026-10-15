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
