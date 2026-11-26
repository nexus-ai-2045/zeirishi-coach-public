from __future__ import annotations

import ast
import io
import re
import subprocess
import sys
import tokenize
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SQL_COMMENT = re.compile(r"'(?:[^']|'')*'|--[^\n]*|/\*.*?\*/", re.S)


def tracked(suffixes: tuple[str, ...]) -> list[Path]:
    names = subprocess.run(["git", "ls-files", "-z"], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    return [ROOT / name for name in names.split("\0") if name.endswith(suffixes)]


def python_comments(text: str) -> list[tuple[int, int, int]]:
    found = []
    for token in tokenize.generate_tokens(io.StringIO(text).readline):
        if token.type == tokenize.COMMENT and not (token.start == (1, 0) and token.string.startswith("#!")):
            found.append((token.start[0], token.start[1], token.end[1]))
    return found


def python_docstrings(text: str) -> list[ast.Expr]:
    owners = (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)
    return [
        node.body[0]
        for node in ast.walk(ast.parse(text))
        if isinstance(node, owners)
        and node.body
        and isinstance(node.body[0], ast.Expr)
        and isinstance(node.body[0].value, ast.Constant)
        and isinstance(node.body[0].value.value, str)
    ]


def without_docstrings(tree: ast.AST) -> str:
    for node in ast.walk(tree):
        body = getattr(node, "body", None)
        if isinstance(body, list) and body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
            node.body = body[1:] or [ast.Pass()]
    return ast.dump(tree)


def strip_python(text: str) -> str:
    lines = text.splitlines(keepends=True)
    drop = {row for doc in python_docstrings(text) for row in range(doc.lineno - 1, doc.end_lineno)}
    for row, start, end in reversed(python_comments(text)):
        line = lines[row - 1]
        head = line[:start].rstrip()
        if head:
            lines[row - 1] = head + line[end:]
        else:
            drop.add(row - 1)
    stripped = "".join(line for index, line in enumerate(lines) if index not in drop).lstrip("\n")
    if without_docstrings(ast.parse(stripped)) != without_docstrings(ast.parse(text)):
        raise ValueError("stripping comments changed the program")
    return stripped


def sql_comments(text: str) -> list[str]:
    return [match.group(0) for match in SQL_COMMENT.finditer(text) if not match.group(0).startswith("'")]


def shell_comments(text: str) -> list[str]:
    return [line for index, line in enumerate(text.splitlines()) if line.lstrip().startswith("#") and not (index == 0 and line.startswith("#!"))]


def report() -> list[str]:
    found = []
    for path in tracked((".py",)):
        text = path.read_text(encoding="utf-8")
        found += [f"{path.relative_to(ROOT)}:{row}: comment" for row, _, _ in python_comments(text)]
        found += [f"{path.relative_to(ROOT)}:{doc.lineno}: docstring" for doc in python_docstrings(text)]
    for path in tracked((".sql",)):
        found += [f"{path.relative_to(ROOT)}: {comment.splitlines()[0]}" for comment in sql_comments(path.read_text(encoding="utf-8"))]
    for path in tracked((".sh",)):
        found += [f"{path.relative_to(ROOT)}: {line}" for line in shell_comments(path.read_text(encoding="utf-8"))]
    return found


def main(argv: list[str]) -> int:
    if "--write" in argv:
        for path in tracked((".py",)):
            text = path.read_text(encoding="utf-8")
            stripped = strip_python(text)
            if stripped != text:
                path.write_text(stripped, encoding="utf-8")
    remaining = report()
    print("\n".join(remaining) if remaining else "no comments in tracked Python, SQL, or shell files")
    return 1 if remaining else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
