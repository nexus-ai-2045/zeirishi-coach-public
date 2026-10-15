import sys
from pathlib import Path

import pytest

COACH_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(COACH_ROOT / "scripts"))


@pytest.fixture
def coach_home(tmp_path, monkeypatch):
    home = tmp_path / "coach-home"
    monkeypatch.setenv("ZEIRISHI_COACH_HOME", str(home))
    return home


@pytest.fixture
def subjects_dir():
    return COACH_ROOT / "references" / "subjects"
