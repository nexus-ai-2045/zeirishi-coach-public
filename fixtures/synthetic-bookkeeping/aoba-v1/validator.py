#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""青葉雑貨店の複式簿記練習フィクスチャをオフラインで検査する。

合成・未承認の教材用。専門家監修済みではない。
現行税法、税率、法的助言、公式試験問題は扱わない。
依存パッケージは使わない。ネットワーク通信もしない。

合格条件は仕訳の借方合計＝貸方合計だけでは足りない。
期首残高に期待仕訳を転記した結果が、期待元帳（借方合計・貸方合計・差引）
および残高試算表と一致することを求める。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Sequence, Tuple

ROOT = Path(__file__).resolve().parent
DATE_RE = re.compile(r"^20X6-04-(0[1-9]|[12][0-9]|30)$")
CODE_RE = re.compile(r"^[0-9]{3}$")
ID_RE = re.compile(r"^Q(0[1-9]|1[0-9]|20)$")
REQUIRED_TAGS = (
    "cash",
    "capital",
    "sales_on_credit",
    "purchases",
    "payment",
    "collection",
    "prepaid",
    "accrual",
)
ALLOWED_TAGS = set(REQUIRED_TAGS)
NORMAL_BY_ELEMENT = {
    "asset": "debit",
    "expense": "debit",
    "liability": "credit",
    "equity": "credit",
    "revenue": "credit",
}
OPENING_NOTE = (
    "期首残高は本問だけの与件である。他問の元帳や試算表からは引き継がない。"
    "空配列はその問の開始時点で全勘定がゼロであることを意味する。"
)


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def is_pos_int(value: Any) -> bool:
    return is_int(value) and value > 0


def is_nonneg_int(value: Any) -> bool:
    return is_int(value) and value >= 0


def strict_money_message(label: str, value: Any, positive: bool) -> Optional[str]:
    """bool は int のサブクラスなので、ここで明示的に拒否する。float も変換しない。"""
    if isinstance(value, bool):
        return f"{label}: bool を金額として扱わない（falseを0円にしない） ({value!r})"
    if isinstance(value, float) or not isinstance(value, int):
        kind = "正の整数円" if positive else "非負整数円"
        return f"{label}: 厳密な{kind}でなければならない。floatや文字列は変換しない ({value!r})"
    if positive and value <= 0:
        return f"{label}: 金額は正の整数円でなければならない ({value!r})"
    if not positive and value < 0:
        return f"{label}: 負の金額は不可 ({value!r})"
    return None


def schema_closed_keys(node: Any) -> Optional[set]:
    if not isinstance(node, dict) or node.get("additionalProperties") is not False:
        return None
    props = node.get("properties")
    if not isinstance(props, dict):
        return None
    return set(props.keys())


def closed_keys_from_schema(schema: Mapping[str, Any]) -> Dict[str, set]:
    found: Dict[str, set] = {}
    root_keys = schema_closed_keys(schema)
    if root_keys is not None:
        found["problems_document"] = root_keys
    defs = schema.get("$defs")
    if isinstance(defs, dict):
        for name, node in defs.items():
            keys = schema_closed_keys(node)
            if keys is not None:
                found[name] = keys
    return found


def reject_unknown(
    label: str,
    obj: Any,
    allowed: Optional[set],
    errors: List[str],
) -> bool:
    if not isinstance(obj, dict):
        errors.append(f"{label}: object でなければならない ({type(obj).__name__})")
        return False
    if allowed is None:
        return True
    unknown = False
    for key in obj.keys():
        if key not in allowed:
            errors.append(f"{label}: schemaが許可しないプロパティ {key!r}")
            unknown = True
    return not unknown


def resolve_schema_node(node: Any, root: Mapping[str, Any]) -> Any:
    seen = set()
    while isinstance(node, dict) and isinstance(node.get("$ref"), str):
        ref = node["$ref"]
        if ref in seen or not ref.startswith("#/$defs/"):
            break
        seen.add(ref)
        defs = root.get("$defs")
        name = ref[len("#/$defs/") :]
        if not isinstance(defs, dict) or name not in defs:
            break
        node = defs[name]
    return node


def json_type_ok(value: Any, type_name: str) -> bool:
    if type_name == "object":
        return isinstance(value, dict)
    if type_name == "array":
        return isinstance(value, list)
    if type_name == "string":
        return isinstance(value, str)
    if type_name == "boolean":
        return isinstance(value, bool)
    if type_name == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if type_name == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    return True


def check_schema_instance(
    label: str,
    instance: Any,
    node: Any,
    root: Mapping[str, Any],
    errors: List[str],
) -> None:
    """schemaの type / required / additionalProperties だけを再帰検査する。bool は integer にしない。"""
    node = resolve_schema_node(node, root)
    if not isinstance(node, dict):
        return
    type_name = node.get("type")
    if isinstance(type_name, str) and not json_type_ok(instance, type_name):
        errors.append(
            f"{label}: schemaの型 {type_name} ではない（boolはintegerにしない） ({type(instance).__name__})"
        )
        return
    enum = node.get("enum")
    if isinstance(enum, list) and instance not in enum:
        errors.append(f"{label}: schemaのenumにない ({instance!r})")
        return
    if type_name == "object":
        if not isinstance(instance, dict):
            return
        props = node.get("properties") if isinstance(node.get("properties"), dict) else {}
        if node.get("additionalProperties") is False:
            for key in instance:
                if key not in props:
                    errors.append(f"{label}: schemaが許可しないプロパティ {key!r}")
        required = node.get("required") if isinstance(node.get("required"), list) else []
        for key in required:
            if key not in instance:
                errors.append(f"{label}: schemaの必須プロパティ {key} がない")
        for key, sub in props.items():
            if key in instance:
                check_schema_instance(f"{label}.{key}", instance[key], sub, root, errors)
        return
    if type_name == "array":
        if not isinstance(instance, list):
            return
        items = node.get("items")
        if isinstance(items, dict):
            for index, item in enumerate(instance, start=1):
                check_schema_instance(f"{label}[{index}]", item, items, root, errors)


def validation_failure(errors: List[str]) -> Dict[str, Any]:
    return {
        "ok": False,
        "errors": errors,
        "posted_ledger": [],
        "posted_trial_balance": None,
        "trial_balance_internally_equal": False,
    }


def side_totals(rows: Sequence[Mapping[str, Any]]) -> Tuple[int, int]:
    debit = 0
    credit = 0
    for row in rows:
        amount = row["amount"]
        if row["side"] == "debit":
            debit += amount
        elif row["side"] == "credit":
            credit += amount
    return debit, credit


def index_accounts(chart: Mapping[str, Any]) -> Dict[str, Mapping[str, Any]]:
    found: Dict[str, Mapping[str, Any]] = {}
    for account in chart["accounts"]:
        if isinstance(account, dict) and isinstance(account.get("code"), str):
            found[account["code"]] = account
    return found


def build_ledger(
    accounts: Mapping[str, Mapping[str, Any]],
    opening: Sequence[Mapping[str, Any]],
    entries: Sequence[Mapping[str, Any]],
) -> List[Dict[str, Any]]:
    """期首を片側の合計へ載せ、仕訳を加算して元帳行を作る。"""
    totals: Dict[str, List[int]] = {}

    def touch(code: str) -> None:
        if code not in accounts:
            raise KeyError(code)
        totals.setdefault(code, [0, 0])

    for row in opening:
        code = row["account_code"]
        touch(code)
        if row["side"] == "debit":
            totals[code][0] += row["amount"]
        else:
            totals[code][1] += row["amount"]

    for entry in entries:
        for line in entry["lines"]:
            code = line["account_code"]
            touch(code)
            if line["side"] == "debit":
                totals[code][0] += line["amount"]
            else:
                totals[code][1] += line["amount"]

    ledger: List[Dict[str, Any]] = []
    for code in sorted(totals):
        debit_total, credit_total = totals[code]
        if debit_total > credit_total:
            balance_side = "debit"
            balance = debit_total - credit_total
        elif credit_total > debit_total:
            balance_side = "credit"
            balance = credit_total - debit_total
        else:
            balance_side = "zero"
            balance = 0
        ledger.append(
            {
                "account_code": code,
                "account_name": accounts[code]["name"],
                "debit_total": debit_total,
                "credit_total": credit_total,
                "balance_side": balance_side,
                "balance": balance,
            }
        )
    return ledger


def build_trial_balance(ledger: Sequence[Mapping[str, Any]]) -> Dict[str, Any]:
    """残高試算表。差引ゼロの勘定は行に含めない。"""
    rows: List[Dict[str, Any]] = []
    total_debit = 0
    total_credit = 0
    for row in ledger:
        if row["balance"] == 0 or row["balance_side"] == "zero":
            continue
        debit = row["balance"] if row["balance_side"] == "debit" else 0
        credit = row["balance"] if row["balance_side"] == "credit" else 0
        total_debit += debit
        total_credit += credit
        rows.append(
            {
                "account_code": row["account_code"],
                "account_name": row["account_name"],
                "debit": debit,
                "credit": credit,
            }
        )
    return {
        "rows": rows,
        "total_debit": total_debit,
        "total_credit": total_credit,
    }


def ledger_map(ledger: Sequence[Mapping[str, Any]]) -> Dict[str, Mapping[str, Any]]:
    return {row["account_code"]: row for row in ledger}


def normalize_lines(entry: Mapping[str, Any]) -> List[Tuple[str, str, int]]:
    return sorted(
        (line["account_code"], line["side"], line["amount"]) for line in entry["lines"]
    )


def check_disclaimer(label: str, disclaimer: Mapping[str, Any], errors: List[str]) -> None:
    if not isinstance(disclaimer, dict):
        errors.append(f"{label}: disclaimer が object ではない")
        return
    expected_flags = {
        "synthetic": True,
        "unapproved_teaching_material": True,
        "expert_reviewed": False,
        "official_exam_reprint": False,
        "tax_or_legal_advice": False,
    }
    for key, expected in expected_flags.items():
        if disclaimer.get(key) is not expected:
            errors.append(f"{label}: disclaimer.{key} は {expected!r} でなければならない")
    statement = disclaimer.get("statement_ja")
    if not isinstance(statement, str) or len(statement) < 40:
        errors.append(f"{label}: disclaimer.statement_ja が不足している")
    if isinstance(statement, str) and "監修" not in statement:
        errors.append(f"{label}: disclaimer に未監修である旨がない")


def check_account_row(account: Mapping[str, Any], errors: List[str]) -> None:
    code = account.get("code")
    if not isinstance(code, str) or not CODE_RE.fullmatch(code):
        errors.append(f"勘定科目コードが3桁でない: {code!r}")
        return
    element = account.get("element")
    normal = account.get("normal_side")
    if NORMAL_BY_ELEMENT.get(element) != normal:
        errors.append(f"{code}: element と normal_side が対応しない")
    statement = account.get("statement")
    if element in ("asset", "liability", "equity") and statement != "balance_sheet":
        errors.append(f"{code}: 貸借対照表科目ではない")
    if element in ("revenue", "expense") and statement != "income_statement":
        errors.append(f"{code}: 損益科目ではない")
    if not isinstance(account.get("name"), str) or not account["name"]:
        errors.append(f"{code}: 名称がない")


def check_money_row(label: str, row: Any, errors: List[str]) -> bool:
    if not isinstance(row, dict):
        errors.append(f"{label}: object でなければならない ({type(row).__name__})")
        return False
    ok = True
    code = row.get("account_code")
    if not isinstance(code, str) or CODE_RE.fullmatch(code) is None:
        errors.append(f"{label}: 勘定コードが不正 {code!r}")
        ok = False
    if row.get("side") not in ("debit", "credit"):
        errors.append(f"{label}: side が debit/credit ではない")
        ok = False
    message = strict_money_message(f"{label} の金額", row.get("amount"), positive=True)
    if message:
        errors.append(message)
        ok = False
    return ok


def check_problem_shape(problem: Mapping[str, Any], errors: List[str]) -> str:
    problem_id = problem.get("id")
    label = problem_id if isinstance(problem_id, str) else "?"
    if not isinstance(problem_id, str) or not ID_RE.fullmatch(problem_id):
        errors.append(f"問題IDが Q01〜Q20 ではない: {problem_id!r}")
    if problem.get("continuity") != "independent":
        errors.append(f"{label}: continuity は independent のみ")
    if problem.get("opening_note_ja") != OPENING_NOTE:
        errors.append(f"{label}: opening_note_ja が規定文と異なる")
    prompt = problem.get("prompt_ja")
    if not isinstance(prompt, str) or "青葉雑貨店" not in prompt or "独立" not in prompt:
        errors.append(f"{label}: 問題文に店名と独立性の明示がない")
    if isinstance(prompt, str) and "20X6" not in prompt:
        errors.append(f"{label}: 問題文に架空日付 20X6 がない")
    explanation = problem.get("explanation_ja")
    if not isinstance(explanation, str) or len(explanation) < 20:
        errors.append(f"{label}: explanation_ja が短すぎる")
    tags = problem.get("tags")
    if not isinstance(tags, list) or not tags:
        errors.append(f"{label}: tags が空、または配列ではない")
    elif any(not isinstance(tag, str) for tag in tags):
        errors.append(f"{label}: tags の要素は集合化する前に文字列でなければならない")
    elif len(tags) != len(set(tags)):
        errors.append(f"{label}: tags が重複している")
    elif any(tag not in ALLOWED_TAGS for tag in tags):
        errors.append(f"{label}: 未知の tag がある")
    for key in ("title", "stage"):
        if not isinstance(problem.get(key), str) or not problem[key]:
            errors.append(f"{label}: {key} がない")
    return label


def check_recorded_amounts(
    label: str,
    obj: Any,
    fields: Sequence[str],
    errors: List[str],
    positive: bool,
) -> bool:
    if not isinstance(obj, dict):
        errors.append(f"{label}: object でなければならない ({type(obj).__name__})")
        return False
    ok = True
    for field in fields:
        if field not in obj:
            errors.append(f"{label}: {field} がない")
            ok = False
            continue
        message = strict_money_message(f"{label}.{field}", obj[field], positive=positive)
        if message:
            errors.append(message)
            ok = False
    return ok


def check_balanced_document(
    label: str,
    accounts: Mapping[str, Mapping[str, Any]],
    problem: Mapping[str, Any],
    errors: List[str],
    closed: Mapping[str, set],
) -> None:
    postable = True
    opening = problem.get("opening_balances")
    entries = problem.get("expected_entries")
    if not isinstance(opening, list):
        errors.append(f"{label}: opening_balances は配列でなければならない")
        opening = []
        postable = False
    if not isinstance(entries, list) or not entries:
        errors.append(f"{label}: expected_entries は1件以上の配列でなければならない")
        entries = []
        postable = False
    seen_open = set()
    for index, row in enumerate(opening, start=1):
        row_label = f"{label} 期首{index}"
        if not reject_unknown(row_label, row, closed.get("opening_balance"), errors):
            postable = False
            continue
        if not check_money_row(row_label, row, errors):
            postable = False
            continue
        code = row.get("account_code")
        if code in seen_open:
            errors.append(f"{label}: 期首残高の勘定 {code} が重複")
            postable = False
        seen_open.add(code)
        if code not in accounts:
            errors.append(f"{label}: 期首の未知の勘定 {code}")
            postable = False
    if postable and opening:
        open_debit, open_credit = side_totals(opening)
        if open_debit != open_credit:
            errors.append(f"{label}: 期首残高が不一致 借方{open_debit} 貸方{open_credit}")
            postable = False

    previous_date = ""
    for index, entry in enumerate(entries, start=1):
        entry_label = f"{label} 仕訳{index}"
        if not reject_unknown(entry_label, entry, closed.get("journal_entry"), errors):
            postable = False
            continue
        entry_no = entry.get("entry_no")
        if not is_pos_int(entry_no):
            errors.append(
                f"{entry_label}: entry_no は厳密な正の整数でなければならない ({entry_no!r})"
            )
            postable = False
        date = entry.get("date")
        if not isinstance(date, str) or DATE_RE.fullmatch(date) is None:
            errors.append(f"{entry_label}: 日付が架空の 20X6-04 ではない ({date!r})")
            postable = False
        elif previous_date and date < previous_date:
            errors.append(f"{label}: 日付が逆行している {previous_date} > {date}")
            postable = False
        if isinstance(date, str):
            previous_date = date
        memo = entry.get("memo")
        if not isinstance(memo, str) or not memo:
            errors.append(f"{entry_label}: memo がない")
            postable = False
        lines = entry.get("lines")
        if not isinstance(lines, list) or len(lines) != 2:
            errors.append(f"{entry_label}: 単純仕訳（2行）ではない")
            postable = False
            continue
        line_ok = True
        for line_index, line in enumerate(lines, start=1):
            line_label = f"{entry_label} 行{line_index}"
            if not reject_unknown(line_label, line, closed.get("journal_line"), errors):
                line_ok = False
                postable = False
                continue
            if not check_money_row(line_label, line, errors):
                line_ok = False
                postable = False
                continue
            if line.get("account_code") not in accounts:
                errors.append(f"{line_label}: 未知の勘定 {line.get('account_code')}")
                line_ok = False
                postable = False
        if not line_ok:
            continue
        sides = [line.get("side") for line in lines]
        if sides.count("debit") != 1 or sides.count("credit") != 1:
            errors.append(f"{entry_label}: 借方1・貸方1ではない")
            postable = False
            continue
        debit, credit = side_totals(lines)
        if debit != credit:
            errors.append(f"{entry_label}: 貸借が不一致 {debit} != {credit}")
            postable = False

    if postable and entries:
        numbers = [entry.get("entry_no") for entry in entries]
        if numbers != list(range(1, len(entries) + 1)):
            errors.append(f"{label}: entry_no は 1 からの連番でなければならない")
            postable = False

    ledger_types_ok = True
    expected_ledger = problem.get("expected_ledger")
    if not isinstance(expected_ledger, list) or not expected_ledger:
        errors.append(f"{label}: expected_ledger は配列でなければならない")
        ledger_types_ok = False
        expected_ledger = []
    for index, row in enumerate(expected_ledger, start=1):
        row_label = f"{label} 元帳{index}"
        if not reject_unknown(row_label, row, closed.get("ledger_row"), errors):
            ledger_types_ok = False
            continue
        if not check_recorded_amounts(
            row_label,
            row,
            ("debit_total", "credit_total", "balance"),
            errors,
            positive=False,
        ):
            ledger_types_ok = False
        if row.get("balance_side") not in ("debit", "credit", "zero"):
            errors.append(f"{row_label}: balance_side が不正 ({row.get('balance_side')!r})")
            ledger_types_ok = False

    tb_types_ok = True
    expected_tb = problem.get("expected_trial_balance")
    if not reject_unknown(f"{label} 試算表", expected_tb, closed.get("trial_balance"), errors):
        tb_types_ok = False
        expected_tb = {}
    elif not check_recorded_amounts(
        f"{label} 試算表",
        expected_tb,
        ("total_debit", "total_credit"),
        errors,
        positive=False,
    ):
        tb_types_ok = False
    rows = expected_tb.get("rows") if isinstance(expected_tb, dict) else None
    if not isinstance(rows, list):
        errors.append(f"{label}: 試算表の rows は配列でなければならない")
        tb_types_ok = False
        rows = []
    for index, row in enumerate(rows, start=1):
        row_label = f"{label} 試算表行{index}"
        if not reject_unknown(row_label, row, closed.get("trial_balance_row"), errors):
            tb_types_ok = False
            continue
        if not check_recorded_amounts(
            row_label, row, ("debit", "credit"), errors, positive=False
        ):
            tb_types_ok = False

    if not postable:
        errors.append(f"{label}: 金額または仕訳の形が不正なため転記しない")
        return

    try:
        posted = build_ledger(accounts, opening, entries)
    except (KeyError, TypeError, IndexError) as exc:
        errors.append(f"{label}: 転記できない ({exc})")
        return

    for row in posted:
        account = accounts[row["account_code"]]
        if row["balance_side"] not in ("zero", account["normal_side"]):
            errors.append(
                f"{label}: {row['account_code']} が正常残高側と逆 ({row['balance_side']})"
            )
        if row["balance_side"] == "zero" and row["balance"] != 0:
            errors.append(f"{label}: ゼロ残高の金額がゼロでない")
        if row["balance_side"] == "debit" and row["balance"] != row["debit_total"] - row["credit_total"]:
            errors.append(f"{label}: 借方残高の計算が合わない")
        if row["balance_side"] == "credit" and row["balance"] != row["credit_total"] - row["debit_total"]:
            errors.append(f"{label}: 貸方残高の計算が合わない")

    if ledger_types_ok and posted != expected_ledger:
        errors.append(f"{label}: 転記結果が expected_ledger と一致しない")

    posted_tb = build_trial_balance(posted)
    if posted_tb["total_debit"] != posted_tb["total_credit"]:
        errors.append(
            f"{label}: 転記後の試算表が不一致 "
            f"{posted_tb['total_debit']} != {posted_tb['total_credit']}"
        )
    row_debit = sum(row["debit"] for row in posted_tb["rows"])
    row_credit = sum(row["credit"] for row in posted_tb["rows"])
    if (row_debit, row_credit) != (posted_tb["total_debit"], posted_tb["total_credit"]):
        errors.append(f"{label}: 試算表の合計が行の合計と一致しない")
    for row in posted_tb["rows"]:
        if row["debit"] and row["credit"]:
            errors.append(f"{label}: 試算表が両建てになっている {row['account_code']}")
        if row["debit"] == 0 and row["credit"] == 0:
            errors.append(f"{label}: ゼロ残高が試算表に残っている")
    if tb_types_ok and posted_tb != expected_tb:
        errors.append(f"{label}: 転記結果が expected_trial_balance と一致しない")

    zero_codes = {row["account_code"] for row in posted if row["balance"] == 0}
    tb_codes = {row["account_code"] for row in posted_tb["rows"]}
    if zero_codes & tb_codes:
        errors.append(f"{label}: 残高ゼロの勘定が試算表にある")


def check_fixture(root: Optional[Path] = None) -> List[str]:
    base = root or ROOT
    errors: List[str] = []
    paths = {
        "assumptions": base / "assumptions.json",
        "chart": base / "chart_of_accounts.json",
        "problems": base / "problems.json",
        "schema": base / "schema.json",
    }
    loaded: Dict[str, Any] = {}
    for name, path in paths.items():
        if not path.is_file():
            errors.append(f"ファイルがない: {path.name}")
            continue
        try:
            loaded[name] = load_json(path)
        except json.JSONDecodeError as exc:
            errors.append(f"{path.name}: JSONとして読めない ({exc})")
    if len(loaded) != 4:
        return errors

    assumptions = loaded["assumptions"]
    chart = loaded["chart"]
    problems_doc = loaded["problems"]
    schema = loaded["schema"]
    if not all(isinstance(doc, dict) for doc in (assumptions, chart, problems_doc, schema)):
        errors.append("JSONのルートは object でなければならない")
        return errors

    closed = closed_keys_from_schema(schema)
    defs = schema.get("$defs") if isinstance(schema.get("$defs"), dict) else {}
    check_schema_instance("problems.json", problems_doc, schema, schema, errors)
    if "chart_document" in defs:
        check_schema_instance("chart_of_accounts.json", chart, defs["chart_document"], schema, errors)
    if "assumptions_document" in defs:
        check_schema_instance("assumptions.json", assumptions, defs["assumptions_document"], schema, errors)
    reject_unknown("problems.json", problems_doc, closed.get("problems_document"), errors)
    reject_unknown("assumptions.json", assumptions, closed.get("assumptions_document"), errors)
    reject_unknown("chart_of_accounts.json", chart, closed.get("chart_document"), errors)

    if assumptions.get("document") != "assumptions":
        errors.append("assumptions.json の document が assumptions ではない")
    if chart.get("document") != "chart_of_accounts":
        errors.append("chart_of_accounts.json の document が不正")
    if problems_doc.get("document") != "problems":
        errors.append("problems.json の document が problems ではない")
    for doc in (assumptions, chart, problems_doc):
        if doc.get("fixture_name") != "aoba-zakkaten-boki-practice":
            errors.append("fixture_name が一致しない")
    for label, doc in (
        ("assumptions", assumptions),
        ("chart", chart),
        ("problems", problems_doc),
    ):
        reject_unknown(
            f"{label} disclaimer",
            doc.get("disclaimer"),
            closed.get("disclaimer"),
            errors,
        )
        check_disclaimer(label, doc.get("disclaimer"), errors)

    continuity = assumptions.get("continuity")
    if (
        not isinstance(continuity, dict)
        or continuity.get("model") != "independent_problems_shared_setting"
    ):
        errors.append("仮定ファイルの継続モデルが独立問題ではない")
    method = assumptions.get("bookkeeping")
    if not isinstance(method, dict):
        errors.append("bookkeeping が object ではない")
        method = {}
    if method.get("merchandise_method") != "sanbunho_purchases_and_sales_only":
        errors.append("仕入の仮定（三分法の仕入・売上のみ）が明示されていない")
    if method.get("prepaid_method") != "expense_method_explicit_amount":
        errors.append("前払の仮定（費用処理法・金額指定）が明示されていない")
    if method.get("journal_form") != "simple_one_debit_one_credit":
        errors.append("単純仕訳の仮定が明示されていない")
    entity = assumptions.get("entity")
    if not isinstance(entity, dict) or entity.get("real_world_counterpart") is not False:
        errors.append("架空であることのフラグがない")

    if schema.get("title") != "青葉雑貨店 複式簿記練習フィクスチャ（合成・未承認）":
        errors.append("schema.json の title が規定と異なる")
    if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
        errors.append("schema.json の $schema が規定と異なる")
    properties = schema.get("properties")
    problem_props = properties.get("problems") if isinstance(properties, dict) else None
    if not isinstance(problem_props, dict) or problem_props.get("minItems") != 20 or problem_props.get("maxItems") != 20:
        errors.append("schema が20問ちょうどを要求していない")

    if problems_doc.get("continuity_model") != "independent_problems_shared_setting":
        errors.append("problems.json の継続モデルが不正")
    if problems_doc.get("currency") != "JPY" or problems_doc.get("amount_rule") != "integer_yen":
        errors.append("通貨または整数円の指定が不正")
    if problems_doc.get("fixture_version") != "1.0.0":
        errors.append("fixture_version が 1.0.0 ではない")
    if problems_doc.get("problem_count") != 20:
        errors.append("problem_count が 20 ではない")

    raw_accounts = chart.get("accounts")
    if not isinstance(raw_accounts, list) or not raw_accounts:
        errors.append("勘定科目表が空")
        return errors
    codes: List[str] = []
    accounts_comparable = True
    for account in raw_accounts:
        if not isinstance(account, dict):
            errors.append(f"勘定科目が object ではない ({type(account).__name__})")
            accounts_comparable = False
            continue
        reject_unknown(f"勘定{account.get('code')}", account, closed.get("account"), errors)
        check_account_row(account, errors)
        code = account.get("code")
        if not isinstance(code, str):
            errors.append(f"勘定科目コードが文字列ではない ({type(code).__name__})")
            accounts_comparable = False
            continue
        codes.append(code)
    if not accounts_comparable:
        return errors
    if len(codes) != len(set(codes)):
        errors.append("勘定科目コードが重複している")
    if codes != sorted(codes):
        errors.append("勘定科目がコード順ではない")
    accounts = index_accounts(chart)

    problems = problems_doc.get("problems")
    if not isinstance(problems, list):
        errors.append("problems が配列ではない")
        return errors
    if len(problems) != 20 or problems_doc.get("problem_count") != len(problems):
        errors.append(f"問題数が20ではない ({len(problems)})")

    covered = set()
    ids = []
    for problem in problems:
        if not isinstance(problem, dict):
            errors.append(f"問題が object ではない ({type(problem).__name__})")
            ids.append(None)
            continue
        reject_unknown(str(problem.get("id")), problem, closed.get("problem"), errors)
        label = check_problem_shape(problem, errors)
        ids.append(problem.get("id"))
        tags = problem.get("tags")
        if isinstance(tags, list):
            covered.update(tag for tag in tags if isinstance(tag, str))
        check_balanced_document(label, accounts, problem, errors, closed)
    if ids != [f"Q{number:02d}" for number in range(1, 21)]:
        errors.append(f"問題IDの並びが Q01〜Q20 ではない: {ids}")
    missing = [tag for tag in REQUIRED_TAGS if tag not in covered]
    if missing:
        errors.append("カバーされていない論点: " + ", ".join(missing))
    return errors


def grade_attempt(
    problem: Mapping[str, Any],
    accounts: Mapping[str, Mapping[str, Any]],
    attempt_entries: Sequence[Mapping[str, Any]],
) -> Dict[str, Any]:
    """学習者の仕訳を、期待仕訳と期待元帳・試算表の両方で採点する。

    金額は厳密な正の整数円だけを受け付ける。float や bool は変換しない。
    Python では bool が int のサブクラスなので、entry_no=True は 1 として扱わない。
    schema が許可したプロパティ以外は不合格。不正な形は例外にせず errors で返す。
    memo の文言差だけでは落とさない。借方合計＝貸方合計だけでは合格にしない。
    """
    errors: List[str] = []
    try:
        schema = load_json(ROOT / "schema.json")
        closed = closed_keys_from_schema(schema) if isinstance(schema, dict) else {}
    except (OSError, json.JSONDecodeError) as exc:
        return validation_failure([f"schemaを読めない: {exc}"])
    entry_keys = closed.get("journal_entry")
    line_keys = closed.get("journal_line")
    if not entry_keys or not line_keys:
        return validation_failure(["schemaの仕訳定義を読めない"])

    if not isinstance(attempt_entries, list):
        return validation_failure(
            [f"回答の仕訳は配列でなければならない ({type(attempt_entries).__name__})"]
        )

    for index, entry in enumerate(attempt_entries, start=1):
        label = f"回答仕訳{index}"
        if not reject_unknown(label, entry, entry_keys, errors):
            continue
        entry_no = entry.get("entry_no")
        if not is_pos_int(entry_no):
            errors.append(
                f"{label}: entry_no は厳密な正の整数でなければならない ({entry_no!r})"
            )
        date = entry.get("date")
        if not isinstance(date, str) or DATE_RE.fullmatch(date) is None:
            errors.append(f"{label}: 日付が不正 ({date!r})")
        memo = entry.get("memo")
        if not isinstance(memo, str) or memo == "":
            errors.append(f"{label}: memo は空でない文字列でなければならない")
        lines = entry.get("lines")
        if not isinstance(lines, list):
            errors.append(f"{label}: lines は配列でなければならない")
            continue
        if len(lines) != 2:
            errors.append(f"{label}: 単純仕訳（2行）ではない")
        for line_index, line in enumerate(lines, start=1):
            line_label = f"{label} 行{line_index}"
            if not reject_unknown(line_label, line, line_keys, errors):
                continue
            check_money_row(line_label, line, errors)

    if errors:
        return validation_failure(errors)

    if not isinstance(problem, dict):
        return validation_failure(["問題が object ではない"])
    expected = problem.get("expected_entries")
    opening = problem.get("opening_balances")
    if not isinstance(expected, list) or not isinstance(opening, list):
        return validation_failure(["期待仕訳または期首残高の形が不正"])

    if len(attempt_entries) != len(expected):
        errors.append(f"仕訳数が違う: 回答{len(attempt_entries)} 期待{len(expected)}")
    comparable = min(len(attempt_entries), len(expected))
    for index in range(comparable):
        got = attempt_entries[index]
        want = expected[index]
        if not isinstance(want, dict):
            errors.append(f"期待仕訳{index + 1} の形が不正")
            continue
        if got.get("entry_no") != want.get("entry_no") or got.get("date") != want.get("date"):
            errors.append(f"仕訳{want.get('entry_no')}: 番号または日付が違う")
        if normalize_lines(got) != normalize_lines(want):
            errors.append(
                f"仕訳{want.get('entry_no')}: 借方・貸方の勘定または金額が違う "
                f"回答{normalize_lines(got)} 期待{normalize_lines(want)}"
            )
        debit, credit = side_totals(got["lines"])
        if debit != credit:
            errors.append(f"仕訳{want.get('entry_no')}: 回答の貸借が不一致")

    try:
        posted = build_ledger(accounts, opening, attempt_entries)
        posted_tb = build_trial_balance(posted)
    except (KeyError, TypeError) as exc:
        return validation_failure(errors + [f"転記できない: {exc}"])

    if posted != problem.get("expected_ledger"):
        errors.append("転記後の元帳が期待元帳と一致しない")
    if posted_tb != problem.get("expected_trial_balance"):
        errors.append("転記後の残高試算表が期待試算表と一致しない")
    balanced = posted_tb["total_debit"] == posted_tb["total_credit"]
    if not balanced:
        errors.append("回答の試算表が貸借不一致")
    return {
        "ok": not errors,
        "errors": errors,
        "posted_ledger": posted,
        "posted_trial_balance": posted_tb,
        "trial_balance_internally_equal": balanced,
    }


def report(root: Optional[Path] = None) -> Dict[str, Any]:
    errors = check_fixture(root)
    return {
        "ok": not errors,
        "error_count": len(errors),
        "errors": errors,
        "checked": [
            "disclaimer_not_expert_reviewed",
            "independent_problems",
            "opening_balance_equality",
            "journal_debit_equals_credit",
            "posted_ledger",
            "posted_trial_balance",
            "zero_balance_omitted_from_trial_balance",
        ],
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="簿記練習フィクスチャの整合検査")
    parser.add_argument(
        "command",
        nargs="?",
        default="check",
        choices=("check",),
        help="check: 期待仕訳を期首へ転記し、期待元帳・試算表と照合する",
    )
    parser.add_argument("--json", action="store_true", help="結果をJSONで出す")
    args = parser.parse_args(argv)
    if args.command != "check":
        print("未対応のコマンド", file=sys.stderr)
        return 2
    result = report(ROOT)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    elif result["ok"]:
        print("OK 20問: 期首+仕訳の転記が期待元帳と残高試算表に一致")
    else:
        print(f"NG {result['error_count']}件", file=sys.stderr)
        for item in result["errors"]:
            print(f"- {item}", file=sys.stderr)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
