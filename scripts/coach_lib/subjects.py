"""科目ごとの論点 tree (references/subjects/<id>.json) の load と lint。"""
from __future__ import annotations

import json
from pathlib import Path

SUBJECTS_DIR = Path(__file__).resolve().parent.parent.parent / "references" / "subjects"
FORMATS = {"calc", "theory"}
FREQUENCIES = {"high", "mid", "low"}
DEFAULT_PASS_PERCENTILE = 0.15


def load_subject(subject_id: str, subjects_dir: Path = SUBJECTS_DIR) -> dict:
    path = Path(subjects_dir) / f"{subject_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"unknown subject: {subject_id} ({path})")
    return json.loads(path.read_text(encoding="utf-8"))


def list_subjects(subjects_dir: Path = SUBJECTS_DIR) -> list[str]:
    return sorted(p.stem for p in Path(subjects_dir).glob("*.json"))


def topic_index(subject: dict) -> dict[str, dict]:
    return {t["id"]: t for t in subject.get("topics", [])}


def pass_percentile(subject: dict) -> float:
    return float(subject.get("exam", {}).get("pass_percentile", DEFAULT_PASS_PERCENTILE))


def lint_subject(subject: dict) -> list[str]:
    errors: list[str] = []
    topics = subject.get("topics", [])
    ids = [t.get("id") for t in topics]
    for dup in sorted({i for i in ids if ids.count(i) > 1}):
        errors.append(f"duplicate id: {dup}")
    total = sum(float(t.get("weight", 0)) for t in topics)
    if abs(total - 100) > 0.01:
        errors.append(f"weight sum is {total:g}, expected 100")
    units = {u.get("id") for u in subject.get("units", [])}
    id_set = set(ids)
    for t in topics:
        tid = t.get("id", "?")
        if t.get("unit") not in units:
            errors.append(f"{tid}: unknown unit {t.get('unit')}")
        if t.get("format") not in FORMATS:
            errors.append(f"{tid}: format must be one of {sorted(FORMATS)}, got {t.get('format')}")
        if t.get("frequency") not in FREQUENCIES:
            errors.append(f"{tid}: frequency must be one of {sorted(FREQUENCIES)}, got {t.get('frequency')}")
        for p in t.get("prereq", []):
            if p not in id_set:
                errors.append(f"{tid}: unknown prereq {p}")
    return errors
