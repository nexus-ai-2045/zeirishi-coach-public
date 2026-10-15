"""今日のメニュー: 復習期限到来 → 低習得度×高配点 → 中間帯の挑戦。論点混在で並べる。"""
from __future__ import annotations

from . import model
from . import state as state_mod
from .subjects import topic_index

WEAK_PREREQ_THRESHOLD = 0.4
CHALLENGE_RANGE = (0.4, 0.7)
CHALLENGE_COUNT = 2


def difficulty_for(m: float) -> int:
    return 2 if m < 0.4 else 3 if m < 0.7 else 4 if m < 0.9 else 5


def budget_seconds(topic: dict) -> int:
    return 300 if topic["format"] == "theory" else 60 * (2 + int(topic["weight"]) // 2)


def interleave(items: list[dict]) -> list[dict]:
    pool, out = list(items), []
    while pool:
        prev = out[-1]["unit"] if out else None
        pick = next((i for i in pool if i["unit"] != prev), pool[0])
        pool.remove(pick)
        out.append(pick)
    return out


def _item(st, subject, topic, today, reason) -> dict:
    ts = st["topics"][topic["id"]]
    units = {u["id"]: u["name"] for u in subject["units"]}
    m = state_mod.topic_mastery(st, subject, topic["id"])
    fading = bool(ts["due"]) and state_mod.days_between(today, ts["due"]) <= 1
    theory = topic["format"] == "theory"
    return {"topic": topic["id"], "name": topic["name"], "unit": topic["unit"],
            "unit_name": units.get(topic["unit"], topic["unit"]), "format": topic["format"],
            "difficulty": difficulty_for(m), "budget_seconds": budget_seconds(topic),
            "fading": fading, "xp_multiplier": 2 if fading else 1, "reason": reason,
            "mastery": round(m, 3), "memo_stage": ts["memo_stage"],
            "memo_target": min(model.MEMO_STAGES, ts["memo_stage"] + 1) if theory else None,
            "pitfalls": topic.get("pitfalls", [])}


def _priority(st, subject, topic) -> float:
    return float(topic["weight"]) * (1 - state_mod.topic_mastery(st, subject, topic["id"]))


def build_menu(st, subject, today, n=10) -> dict:
    state_mod.apply_decay(st, subject, today)
    idx, topics, chosen = topic_index(subject), subject["topics"], set()

    due = [t for t in topics if st["topics"][t["id"]]["due"] and state_mod.days_between(today, st["topics"][t["id"]]["due"]) <= 1]
    due.sort(key=lambda t: -_priority(st, subject, t))
    review = []
    for t in due[:max(1, n // 2)]:
        review.append(_item(st, subject, t, today, "復習期限"))
        chosen.add(t["id"])

    challenge = []
    if n >= 6:
        mids = [t for t in topics if t["id"] not in chosen
                and CHALLENGE_RANGE[0] <= state_mod.topic_mastery(st, subject, t["id"]) < CHALLENGE_RANGE[1]]
        mids.sort(key=lambda t: -float(t["weight"]))
        for t in mids[:CHALLENGE_COUNT]:
            challenge.append(_item(st, subject, t, today, "配点が重く伸びしろがある"))
            chosen.add(t["id"])

    weak, remaining = [], n - len(review) - len(challenge)
    for t in sorted((t for t in topics if t["id"] not in chosen), key=lambda t: -_priority(st, subject, t)):
        if len(weak) >= remaining:
            break
        weak_pre = [p for p in t.get("prereq", []) if p not in chosen
                    and state_mod.topic_mastery(st, subject, p) < WEAK_PREREQ_THRESHOLD]
        if weak_pre:
            pre = min(weak_pre, key=lambda p: state_mod.topic_mastery(st, subject, p))
            weak.append(_item(st, subject, idx[pre], today, f"{t['name']} の前提"))
            chosen.add(pre)
            if len(weak) >= remaining:
                break
        weak.append(_item(st, subject, t, today, "習得度が低く配点が重い"))
        chosen.add(t["id"])

    items = interleave(review + weak + challenge)
    return {"date": today, "n": len(items),
            "quests": [{"name": "復習", "items": review}, {"name": "弱点", "items": weak}, {"name": "挑戦", "items": challenge}],
            "items": items}


def diagnostic_menu(st, subject, today) -> dict:
    items = []
    for unit in subject["units"]:
        best = max((t for t in subject["topics"] if t["unit"] == unit["id"]), key=lambda t: float(t["weight"]))
        items.append(_item(st, subject, best, today, f"{unit['name']} の代表論点"))
    items = interleave(items)
    return {"date": today, "n": len(items), "quests": [{"name": "診断", "items": items}], "items": items}
