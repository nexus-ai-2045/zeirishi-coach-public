"""7 日ぶんの学習を CLI で再現し、合格確率が動くこと・目標曲線・dashboard を確認する。
使い方: ZEIRISHI_COACH_HOME=$TMPDIR/coach-smoke python3 tests/smoke_one_week.py
"""
import json
import os
import random
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

COACH = Path(__file__).resolve().parent.parent / "scripts" / "coach.py"
SUBJECT, START = "zaihyo", date(2026, 9, 4)


def run(*args):
    return subprocess.run([sys.executable, str(COACH), *args], capture_output=True, text=True, check=True).stdout


def main():
    assert os.environ.get("ZEIRISHI_COACH_HOME"), "set ZEIRISHI_COACH_HOME to a temp dir"
    random.seed(7)
    run("init", SUBJECT, "--exam-date", "2027-08-05", "--level", "3", "--weekly-hours", "10", "--today", START.isoformat(), "--force")
    probs = []
    for day in range(7):
        today = (START + timedelta(days=day)).isoformat()
        menu = json.loads(run("next", SUBJECT, "--n", "8", "--today", today))
        for item in menu["items"]:
            score = round(random.choice([0.0, 0.3, 0.6, 0.8, 1.0, 1.0]), 1)
            cls = "none" if score >= 0.7 else random.choice(["knowledge", "procedure", "time", "misread"])
            args = ["record", SUBJECT, "--topic", item["topic"], "--score", str(score), "--seconds",
                    str(random.randint(90, item["budget_seconds"] + 120)), "--error-class", cls,
                    "--difficulty", str(item["difficulty"]), "--today", today]
            if item["memo_target"] is not None:
                args += ["--memo-stage", str(item["memo_target"])]
            run(*args)
        r = json.loads(run("report", SUBJECT, "--json", "--today", today))
        probs.append(r["pass_prob"])
        print(f"{today} pass={r['pass_prob']:.3f} target={r['target_pass_prob']:.3f} on_track={r['on_track']} xp={r['xp']} streak={r['streak_days']} titles={r['titles']}")
    last = (START + timedelta(days=6)).isoformat()
    run("mock", SUBJECT, "--score", "58", "--minutes", "125", "--rank", "120", "--of", "1000", "--today", last)
    path = run("dashboard", SUBJECT, "--today", last).strip()
    print("dashboard:", path)
    assert Path(path).exists() and len(set(probs)) > 1
    print(run("report", SUBJECT, "--today", last))
    print(run("status", "--today", last))


if __name__ == "__main__":
    main()
