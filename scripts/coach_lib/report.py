"""report: 合格確率・目標との差・単元別習得度・学習効率・ゲーム状態。"""
from __future__ import annotations

from . import model
from . import state as state_mod

BOSS_THRESHOLD, WEAKEST_N, HISTORY_TAIL, ON_TRACK_TOLERANCE = 0.7, 5, 14, 0.02


def level_for_xp(xp: int) -> int:
    return xp // 100 + 1


def build_report(st, subject, today) -> dict:
    state_mod.apply_decay(st, subject, today)
    # 忘却を適用した後の値を history に記録する: dashboard の実績線が、直近の attempt/mock
    # の日付で止まったまま (減衰前の高い確率) にならないようにする
    # (PR #1 レビュー指摘 report.py:16)。
    state_mod.snapshot_history(st, subject, today)
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

    recent = [h for h in st["history"] if 0 <= state_mod.days_between(h["date"], today) < 7]
    minutes_7d = sum(h["minutes"] for h in recent)
    efficiency = None
    if recent and minutes_7d > 0:
        # recent[0]["mastery_avg_start"] は「その日の学習が始まる前」の mastery_avg
        # (state.snapshot_history が行を新規作成する時に記録する)。同日 1 問だけの場合でも
        # 正しく増分が取れる。旧データ (mastery_avg_start が無い state.json) は従来どおり
        # recent[0]["mastery_avg"] を起点にする。
        base = recent[0].get("mastery_avg_start", recent[0]["mastery_avg"])
        efficiency = round((recent[-1]["mastery_avg"] - base) / minutes_7d, 5)

    target = state_mod.target_prob_today(st, today)
    return {"subject": st["subject"], "subject_name": subject["name"], "date": today, "exam_date": st["exam_date"],
            "days_to_exam": days_to_exam, "final_phase": 0 <= days_to_exam <= state_mod.FINAL_PHASE_DAYS,
            # pass_prob / target_pass_prob は round しない: 学習初期は 1e-7 台まで小さくなり得るため、
            # 4 桁丸めだと「0 より大きい」という不変条件 (state.snapshot_history と同じ理由) が壊れる。
            "pass_prob": prob, "target_pass_prob": target,
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
