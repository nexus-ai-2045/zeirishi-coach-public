import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import source_comments


def test_tracked_python_sql_and_shell_carry_no_comments():
    assert source_comments.report() == []


def test_strip_keeps_program_and_shebang():
    source = '#!/usr/bin/env python3\n"""doc"""\nx = 1  # note\n\n\ndef f():\n    """doc"""\n    # note\n    return "# not a comment"\n'
    stripped = source_comments.strip_python(source)
    assert stripped.startswith("#!/usr/bin/env python3\n")
    assert source_comments.python_comments(stripped) == []
    assert source_comments.python_docstrings(stripped) == []
    assert '"# not a comment"' in stripped


def test_check_command_passes_on_the_repository():
    result = subprocess.run([sys.executable, "scripts/source_comments.py"], cwd=ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stdout
