import json
import re

from conftest import COACH_ROOT


def _read(rel):
    return (COACH_ROOT / rel).read_text(encoding="utf-8")


def test_skill_frontmatter_and_commands():
    text = _read("SKILL.md")
    assert text.startswith("---\nname: zeirishi-coach\n") and "description:" in text.split("---")[1]
    for needle in ["coach.py init", "coach.py next", "coach.py start", "coach.py record", "coach.py report", "coach.py dashboard",
                   "coach.py mock", "coach.py status", "coach.py plan", "--diagnostic", "--error-class", "--score", "--memo-stage",
                   "--rank", "knowledge", "procedure", "time", "misread", "references/question-rubric.md",
                   "references/explanation-style.md", "references/subjects/", "小問", "キーワード", "骨子", "全文"]:
        assert needle in text, needle


def test_rubric_and_style_sections():
    rubric = _read("references/question-rubric.md")
    for s in ["入力", "出力", "採点基準", "典型ミス", "論点混在", "小問", "memo_target", "本番形式"]:
        assert s in rubric, s
    style = _read("references/explanation-style.md")
    for s in ["中学生", "根拠", "本試験", "次の一手", "e-Gov", "要確認"]:
        assert s in style, s


def test_manifest_files_exist():
    for rel in re.findall(r"^\s+- (\S+)$", _read("manifest.yaml"), flags=re.M):
        assert (COACH_ROOT / rel).exists(), rel


def test_settings_snippet_allows_coach():
    snippet = json.loads(_read("runtime/claude/settings-snippet.json"))
    allow = snippet["permissions"]["allow"]
    assert any("coach.py" in a for a in allow)
    assert "settings-snippet" in _read("docs/plans/development-reference.md")
    assert "docs/plans/development-reference.md" in _read("README.md")


def test_review_packet_external_sources_are_url_references():
    packet = json.loads(_read("docs/materials/bookkeeping-review-packet.json"))
    external = [source for source in packet["sources"] if source["url"].startswith("https://")]
    assert len(external) == 11
    for source in external:
        assert source["retention"]["decision"] == "url_only", source["id"]
        assert "path" not in source["retention"], source["id"]
        assert re.fullmatch(r"[a-f0-9]{64}", source["observationSha256"]), source["id"]
    assert not list((COACH_ROOT / "docs/materials/sources").glob("*.pdf"))
    assert not list((COACH_ROOT / "docs/materials/sources").glob("*.html"))
