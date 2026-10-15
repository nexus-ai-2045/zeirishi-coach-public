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
TITLE_TIME_STREAK = 5  # docs/specs §2.4: time 分類が 5 回連続ゼロ
MOCK_SCORE_MIN, MOCK_SCORE_MAX = 0.0, 100.0


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
    # 棚卸し §7.6「順位がある直近模試がある時のみ」: 直近模試 (mock_scores の最後) に
    # 順位が無ければ、古い模試の順位較正を引きずらない (PR #1 レビュー指摘 state.py:113)。
    last_mock = st["mock_scores"][-1] if st["mock_scores"] else None
    rank_prob = (model.rank_probability(last_mock["percentile"], pass_percentile(subject))
                 if last_mock and last_mock.get("percentile") is not None else None)
    return expected, sd, model.blend_probability(score_prob, rank_prob)


def snapshot_history(st, subject, today, minutes_delta=0.0) -> dict:
    expected, _sd, prob = compute_scores(st, subject)
    m_avg = sum(topic_mastery(st, subject, tid) for tid in st["topics"]) / max(1, len(st["topics"]))
    if st["history"] and st["history"][-1]["date"] == today:
        row = st["history"][-1]
    else:
        # mastery_avg_start: この日の学習が始まる前の mastery_avg。前の行が無ければ (=初回)
        # 現在値をそのまま使う (まだ何も学習していない状態を表すため、これが正しい起点になる)。
        # 以後、同日内の snapshot_history 呼び出しは上の分岐 (行の in-place 更新) を通るので
        # ここで一度書いた値は当日中は上書きされない。
        start = st["history"][-1]["mastery_avg"] if st["history"] else round(m_avg, 4)
        row = {"date": today, "minutes": 0.0, "mastery_avg_start": start}
        st["history"].append(row)
    # pass_prob は round(...,4) しない: 学習初期は 1e-7 台まで小さくなり得るため、
    # 4 桁丸めだと「0 より大きい」という不変条件 (棚卸し §7.6 の合格確率は連続値) が壊れる。
    row.update({"pass_prob": prob, "expected": round(expected, 2), "mastery_avg": round(m_avg, 4)})
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
    return {"created": today, "start_prob": start_prob, "final_phase_start": final_start,
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
              (TITLE_TIME, st["attempts_since_time_error"] >= TITLE_TIME_STREAK)]
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
    if seconds < 0:
        raise ValueError(f"seconds must be >= 0, got {seconds}")
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


# ---------- mock / rebuild ----------

MOCK_CALIBRATION_WINDOW = 3


def record_mock(st, subject, score, minutes, today, rank=None, of=None) -> dict:
    if not MOCK_SCORE_MIN <= float(score) <= MOCK_SCORE_MAX:
        raise ValueError(f"score must be {MOCK_SCORE_MIN}-{MOCK_SCORE_MAX}, got {score}")
    if (rank is None) != (of is None):
        raise ValueError("rank and of must be given together")
    if rank is not None:
        if of <= 0:
            raise ValueError(f"of must be > 0, got {of}")
        if not 1 <= rank <= of:
            raise ValueError(f"rank must be 1..of ({of}), got {rank}")
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
    _update_streak(st, today)
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
