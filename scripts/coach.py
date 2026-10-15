#!/usr/bin/env python3
"""zeirishi-coach CLI。ロジックは coach_lib/。ここは引数解釈と入出力だけ。"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from coach_lib import dashboard, report, scheduler, state, subjects  # noqa: E402


def _out(data):
    print(json.dumps(data, ensure_ascii=False, indent=2))


def _load(subject_id):
    return subjects.load_subject(subject_id), state.load_state(subject_id)


def cmd_subjects(_a):
    _out([{"id": sid, "name": subjects.load_subject(sid)["name"]} for sid in subjects.list_subjects()])
    return 0


def cmd_lint(_a):
    bad = 0
    for sid in subjects.list_subjects():
        errors = subjects.lint_subject(subjects.load_subject(sid))
        print(("NG " if errors else "OK ") + sid)
        for e in errors:
            print(f"  - {e}")
        bad += bool(errors)
    return 1 if bad else 0


def cmd_status(a):
    today = a.today or state.today_iso()
    rows = []
    for sid in subjects.list_subjects():
        try:
            subject, st = _load(sid)
        except FileNotFoundError:
            continue
        r = report.build_report(st, subject, today)
        rows.append({"id": sid, "name": subject["name"], "pass_prob": r["pass_prob"], "target_pass_prob": r["target_pass_prob"],
                     "on_track": r["on_track"], "fading_count": r["fading_count"], "days_to_exam": r["days_to_exam"]})
    rows.sort(key=lambda x: x["pass_prob"])
    _out({"date": today, "subjects": rows, "recommended": rows[0]["id"] if rows else None})
    return 0


def cmd_init(a):
    subject = subjects.load_subject(a.subject)
    path = state.state_dir(a.subject) / "state.json"
    if path.exists() and not a.force:
        print(f"state already exists: {path} (use --force to overwrite)")
        return 1
    if path.exists() and a.force:
        # attempts.jsonl は rebuild の正本 (docs/specs §3.2)。捨てたはずの旧セッションを
        # 残すと、再初期化後の記録と混ざって再生される (PR #1 レビュー指摘 coach.py:63)。
        for name in ("attempts.jsonl", "timer.json"):
            p = state.state_dir(a.subject) / name
            if p.exists():
                p.unlink()
    profile = {k: v for k, v in {"weekly_hours": a.weekly_hours, "school": a.school, "note": a.note}.items() if v is not None}
    st = state.init_state(subject, exam_date=a.exam_date, level=a.level, mock_score=a.mock_score, today=a.today, profile=profile)
    state.save_state(st)
    _out({"subject": st["subject"], "exam_date": st["exam_date"], "topics": len(st["topics"]),
          "pass_prob": st["history"][-1]["pass_prob"], "final_phase_start": st["plan"]["final_phase_start"], "state": str(path)})
    return 0


def cmd_next(a):
    subject, st = _load(a.subject)
    today = a.today or state.today_iso()
    menu = scheduler.diagnostic_menu(st, subject, today) if a.diagnostic else scheduler.build_menu(st, subject, today, n=a.n)
    state.save_state(st)
    _out(menu)
    return 0


def cmd_start(a):
    state.load_state(a.subject)
    path = state.start_timer(a.subject, a.topic, a.now or state.now_iso())
    _out({"topic": a.topic, "started_at": state.read_timer(a.subject)["started_at"], "timer": str(path)})
    return 0


def cmd_record(a):
    subject, st = _load(a.subject)
    today = a.today or state.today_iso()
    score = a.score if a.score is not None else (1.0 if a.correct == "yes" else 0.0)
    seconds = a.seconds
    if seconds is None:
        timer = state.read_timer(a.subject)
        if not timer:
            print("no --seconds and no running timer: run `coach.py start` first or pass --seconds")
            return 1
        if timer["topic"] != a.topic:
            print(f"running timer is for topic {timer['topic']!r}, not {a.topic!r}: "
                  "run `coach.py start --topic` for this topic or pass --seconds")
            return 1
        seconds = state.elapsed_seconds(timer, a.now or state.now_iso())
    reward = state.record_attempt(st, subject, a.topic, score, seconds, a.error_class, a.difficulty, today, memo_stage=a.memo_stage)
    state.clear_timer(a.subject)
    state.save_state(st)
    expected, _sd, prob = state.compute_scores(st, subject)
    # pass_prob は round しない: state.snapshot_history / report.build_report と同じ理由で、
    # 学習初期は 1e-7 台まで小さくなり得るため 4 桁丸めだと「0 より大きい」不変条件が壊れる。
    _out({"reward": reward, "seconds": seconds, "score": score, "pass_prob": prob,
          "expected_score": round(expected, 1), "xp_total": st["xp"], "streak_days": st["streak"]["days"], "combo": st["combo"]})
    return 0


def cmd_report(a):
    subject, st = _load(a.subject)
    r = report.build_report(st, subject, a.today or state.today_iso())
    state.save_state(st)
    _out(r) if a.json else print(report.format_report(r))
    return 0


def cmd_dashboard(a):
    subject, st = _load(a.subject)
    r = report.build_report(st, subject, a.today or state.today_iso())
    path = dashboard.write_dashboard(r, st, subject)
    state.save_state(st)
    print(str(path))
    return 0


def cmd_mock(a):
    subject, st = _load(a.subject)
    if (a.rank is None) != (a.of is None):
        print("--rank and --of must be given together")
        return 1
    result = state.record_mock(st, subject, a.score, a.minutes, a.today or state.today_iso(), rank=a.rank, of=a.of)
    state.save_state(st)
    _out(result)
    return 0


def cmd_plan(a):
    subject, st = _load(a.subject)
    if a.rebuild:
        today = a.today or state.today_iso()
        # 直前の学習日から間が空いていると忘却が反映されないまま計画を引き直してしまう
        # (PR #1 レビュー指摘 coach.py:140)。
        state.apply_decay(st, subject, today)
        st["plan"] = state.build_plan(st, subject, today)
        state.save_state(st)
    _out(st["plan"])
    return 0


def cmd_rebuild(a):
    subject = subjects.load_subject(a.subject)
    path = state.state_dir(a.subject) / "state.json"
    rebuilt = state.rebuild_state(subject)
    shutil.copyfile(path, path.with_suffix(".json.bak"))
    state.save_state(rebuilt)
    _out({"rebuilt": str(path), "backup": str(path.with_suffix(".json.bak")), "attempts_total": rebuilt["attempts_total"]})
    return 0


def build_parser():
    p = argparse.ArgumentParser(prog="coach.py", description="税理士試験 学習コーチ (計測 CLI)")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("subjects").set_defaults(fn=cmd_subjects)
    sub.add_parser("lint").set_defaults(fn=cmd_lint)
    sp = sub.add_parser("status"); sp.add_argument("--today"); sp.set_defaults(fn=cmd_status)

    def common(sp):
        sp.add_argument("subject")
        sp.add_argument("--today", help="YYYY-MM-DD (テスト・再現用)")
        return sp

    sp = common(sub.add_parser("init"))
    sp.add_argument("--exam-date", required=True)
    sp.add_argument("--level", type=int, choices=range(1, 6))
    sp.add_argument("--mock-score", type=float)
    sp.add_argument("--weekly-hours", type=int)
    sp.add_argument("--school")
    sp.add_argument("--note")
    sp.add_argument("--force", action="store_true")
    sp.set_defaults(fn=cmd_init)

    sp = common(sub.add_parser("next"))
    sp.add_argument("--n", type=int, default=10)
    sp.add_argument("--diagnostic", action="store_true")
    sp.set_defaults(fn=cmd_next)

    sp = common(sub.add_parser("start"))
    sp.add_argument("--topic", required=True)
    sp.add_argument("--now")
    sp.set_defaults(fn=cmd_start)

    sp = common(sub.add_parser("record"))
    sp.add_argument("--topic", required=True)
    g = sp.add_mutually_exclusive_group(required=True)
    g.add_argument("--correct", choices=["yes", "no"])
    g.add_argument("--score", type=float)
    sp.add_argument("--seconds", type=int)
    sp.add_argument("--error-class", required=True, choices=list(state.ERROR_CLASSES))
    sp.add_argument("--difficulty", type=int, required=True, choices=range(1, 6))
    sp.add_argument("--memo-stage", type=int, choices=range(0, 4))
    sp.add_argument("--now")
    sp.set_defaults(fn=cmd_record)

    sp = common(sub.add_parser("report")); sp.add_argument("--json", action="store_true"); sp.set_defaults(fn=cmd_report)
    common(sub.add_parser("dashboard")).set_defaults(fn=cmd_dashboard)

    sp = common(sub.add_parser("mock"))
    sp.add_argument("--score", type=float, required=True)
    sp.add_argument("--minutes", type=int)
    sp.add_argument("--rank", type=int)
    sp.add_argument("--of", type=int)
    sp.set_defaults(fn=cmd_mock)

    sp = common(sub.add_parser("plan")); sp.add_argument("--rebuild", action="store_true"); sp.set_defaults(fn=cmd_plan)
    sp = sub.add_parser("rebuild"); sp.add_argument("subject"); sp.set_defaults(fn=cmd_rebuild)
    return p


def main(argv=None) -> int:
    parser = build_parser()
    try:
        args = parser.parse_args(argv)
    except SystemExit as exc:
        return int(exc.code or 0)
    try:
        return args.fn(args)
    except (FileNotFoundError, ValueError, KeyError) as exc:
        print(str(exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
