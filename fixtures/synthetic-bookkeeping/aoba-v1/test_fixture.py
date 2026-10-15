#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""標準ライブラリだけのオフライン検査。

validator.build_ledger とは別に、借方合計・貸方合計を辞書へ足す実装でも照合する。
Q20 などは金額の加減をテスト内に直書きし、転記関数の写し忘れを見つける。
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import validator

ROOT = Path(__file__).resolve().parent

HAND_TOTALS = {
    "Q01": 600000,
    "Q02": 600000,
    "Q03": 248000,
    "Q04": 300000,
    "Q05": 304000,
    "Q06": 222000,
    "Q07": 195000,
    "Q08": 150000,
    "Q09": 125000,
    "Q10": 220000,
    "Q11": 130000,
    "Q12": 420000,
    "Q13": 400000,
    "Q14": 400000,
    "Q15": 250000,
    "Q16": 124000,
    "Q17": 570000,
    "Q18": 233000,
    "Q19": 152000,
    "Q20": 523000,
}


def alt_post(opening, entries):
    """validator.build_ledger とは別の足し算。戻り値は code -> (debit_total, credit_total)。"""
    debit = {}
    credit = {}

    def add(code, side, amount):
        bucket = debit if side == "debit" else credit
        bucket[code] = bucket.get(code, 0) + amount
        debit.setdefault(code, 0)
        credit.setdefault(code, 0)

    for row in opening:
        add(row["account_code"], row["side"], row["amount"])
    for item in entries:
        for line in item["lines"]:
            add(line["account_code"], line["side"], line["amount"])
    return debit, credit


class FixtureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.errors = validator.check_fixture(ROOT)
        cls.doc = validator.load_json(ROOT / "problems.json")
        cls.chart = validator.load_json(ROOT / "chart_of_accounts.json")
        cls.accounts = validator.index_accounts(cls.chart)
        cls.by_id = {problem["id"]: problem for problem in cls.doc["problems"]}

    def test_validator_reports_no_errors(self):
        self.assertEqual(self.errors, [])

    def test_cli_check_exits_zero(self):
        completed = subprocess.run(
            [sys.executable, str(ROOT / "validator.py"), "check", "--json"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        payload = json.loads(completed.stdout)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["error_count"], 0)
        self.assertIn("posted_ledger", payload["checked"])
        self.assertIn("posted_trial_balance", payload["checked"])

    def test_disclaimer_and_independence(self):
        self.assertIs(self.doc["disclaimer"]["expert_reviewed"], False)
        self.assertIs(self.doc["disclaimer"]["synthetic"], True)
        self.assertEqual(self.doc["continuity_model"], "independent_problems_shared_setting")
        self.assertEqual(len(self.by_id), 20)
        for problem in self.doc["problems"]:
            self.assertEqual(problem["continuity"], "independent")
            self.assertIn("引き継がない", problem["opening_note_ja"])

    def test_topic_coverage(self):
        covered = set()
        for problem in self.doc["problems"]:
            covered.update(problem["tags"])
        self.assertTrue(set(validator.REQUIRED_TAGS) <= covered)

    def test_alternate_poster_matches_answer_key(self):
        for problem in self.doc["problems"]:
            debit, credit = alt_post(problem["opening_balances"], problem["expected_entries"])
            self.assertEqual(set(debit), {row["account_code"] for row in problem["expected_ledger"]})
            for row in problem["expected_ledger"]:
                code = row["account_code"]
                self.assertEqual(row["debit_total"], debit[code], problem["id"] + " " + code)
                self.assertEqual(row["credit_total"], credit[code], problem["id"] + " " + code)
                if debit[code] > credit[code]:
                    self.assertEqual(row["balance_side"], "debit")
                    self.assertEqual(row["balance"], debit[code] - credit[code])
                elif credit[code] > debit[code]:
                    self.assertEqual(row["balance_side"], "credit")
                    self.assertEqual(row["balance"], credit[code] - debit[code])
                else:
                    self.assertEqual(row["balance_side"], "zero")
                    self.assertEqual(row["balance"], 0)
            trial = problem["expected_trial_balance"]
            self.assertEqual(trial["total_debit"], trial["total_credit"])
            self.assertEqual(trial["total_debit"], HAND_TOTALS[problem["id"]])
            for row in trial["rows"]:
                self.assertGreater(row["debit"] + row["credit"], 0)
                self.assertFalse(row["debit"] and row["credit"])

    def test_q08_zero_payable_stays_on_ledger_only(self):
        problem = self.by_id["Q08"]
        ledger = {row["account_code"]: row for row in problem["expected_ledger"]}
        self.assertEqual(ledger["201"]["balance"], 0)
        self.assertEqual(ledger["101"]["balance"], 90000)
        self.assertEqual(ledger["501"]["balance"], 60000)
        codes = [row["account_code"] for row in problem["expected_trial_balance"]["rows"]]
        self.assertNotIn("201", codes)
        self.assertEqual(problem["expected_trial_balance"]["total_debit"], 150000)

    def test_q14_prepaid_split_without_proration(self):
        ledger = {row["account_code"]: row for row in self.by_id["Q14"]["expected_ledger"]}
        self.assertEqual(ledger["101"]["balance"], 310000)
        self.assertEqual(ledger["131"]["debit_total"], 60000)
        self.assertEqual(ledger["131"]["balance"], 60000)
        self.assertEqual(ledger["521"]["debit_total"], 90000)
        self.assertEqual(ledger["521"]["credit_total"], 60000)
        self.assertEqual(ledger["521"]["balance"], 30000)

    def test_q16_and_q19_clear_prior_deferrals(self):
        prepaid = {row["account_code"]: row for row in self.by_id["Q16"]["expected_ledger"]}
        self.assertEqual(prepaid["131"]["balance"], 0)
        self.assertEqual(prepaid["521"]["balance"], 24000)
        self.assertEqual(prepaid["101"]["balance"], 100000)
        accrued = {row["account_code"]: row for row in self.by_id["Q19"]["expected_ledger"]}
        self.assertEqual(accrued["211"]["balance"], 0)
        self.assertEqual(accrued["101"]["balance"], 152000)
        self.assertNotIn("511", accrued)

    def test_q20_hand_rollforward(self):
        cash = 200000 + 55000 - 6000 - 10000
        bank = 150000 + 25000 - 30000
        receivable = 40000 + 35000 - 25000
        prepaid = 20000 - 20000
        payable = 30000 + 45000 - 30000
        accrued = 10000 + 18000 - 10000
        self.assertEqual(
            (cash, bank, receivable, prepaid, payable, accrued),
            (239000, 145000, 50000, 0, 45000, 18000),
        )
        sales = 55000 + 35000
        purchases = 45000
        supplies = 6000
        insurance = 20000
        salary = 18000
        capital = 370000
        debit = cash + bank + receivable + purchases + supplies + insurance + salary
        credit = payable + accrued + capital + sales
        self.assertEqual(debit, 523000)
        self.assertEqual(credit, 523000)
        ledger = {row["account_code"]: row for row in self.by_id["Q20"]["expected_ledger"]}
        self.assertEqual(ledger["101"]["debit_total"], 200000 + 55000)
        self.assertEqual(ledger["101"]["credit_total"], 6000 + 10000)
        self.assertEqual(ledger["101"]["balance"], cash)
        self.assertEqual(ledger["102"]["debit_total"], 150000 + 25000)
        self.assertEqual(ledger["102"]["credit_total"], 30000)
        self.assertEqual(ledger["111"]["debit_total"], 40000 + 35000)
        self.assertEqual(ledger["111"]["credit_total"], 25000)
        self.assertEqual(ledger["201"]["credit_total"], 30000 + 45000)
        self.assertEqual(ledger["201"]["debit_total"], 30000)
        self.assertEqual(ledger["211"]["credit_total"], 10000 + 18000)
        self.assertEqual(ledger["211"]["debit_total"], 10000)
        self.assertEqual(ledger["131"]["balance_side"], "zero")
        self.assertEqual(ledger["401"]["balance"], sales)
        self.assertEqual(ledger["501"]["balance"], purchases)
        self.assertEqual(ledger["511"]["balance"], salary)
        self.assertEqual(ledger["541"]["balance"], insurance)
        self.assertEqual(ledger["551"]["balance"], supplies)
        self.assertEqual(self.by_id["Q20"]["expected_trial_balance"]["total_credit"], 523000)
        tb_codes = [row["account_code"] for row in self.by_id["Q20"]["expected_trial_balance"]["rows"]]
        self.assertNotIn("131", tb_codes)

    def test_perfect_attempts_pass_only_when_ledger_matches(self):
        for problem in self.doc["problems"]:
            graded = validator.grade_attempt(
                problem, self.accounts, problem["expected_entries"]
            )
            self.assertTrue(graded["ok"], graded["errors"])
            self.assertTrue(graded["trial_balance_internally_equal"])

    def test_balanced_wrong_amount_still_fails_q02(self):
        wrong = [
            {
                "entry_no": 1,
                "date": "20X6-04-02",
                "memo": "金額を取り違えた",
                "lines": [
                    {"account_code": "551", "side": "debit", "amount": 10000},
                    {"account_code": "101", "side": "credit", "amount": 10000},
                ],
            }
        ]
        graded = validator.grade_attempt(self.by_id["Q02"], self.accounts, wrong)
        self.assertFalse(graded["ok"])
        self.assertTrue(graded["trial_balance_internally_equal"])
        self.assertEqual(graded["posted_trial_balance"]["total_debit"], 600000)
        self.assertNotEqual(graded["posted_ledger"], self.by_id["Q02"]["expected_ledger"])
        self.assertTrue(any("元帳" in item for item in graded["errors"]))

    def test_q19_double_counted_salary_balances_but_fails(self):
        wrong = [
            {
                "entry_no": 1,
                "date": "20X6-04-23",
                "memo": "支払時に給料を再度計上してしまう誤り",
                "lines": [
                    {"account_code": "511", "side": "debit", "amount": 28000},
                    {"account_code": "101", "side": "credit", "amount": 28000},
                ],
            }
        ]
        graded = validator.grade_attempt(self.by_id["Q19"], self.accounts, wrong)
        self.assertFalse(graded["ok"])
        self.assertTrue(graded["trial_balance_internally_equal"])
        self.assertEqual(graded["posted_trial_balance"]["total_debit"], 180000)
        names = {row["account_code"]: row["balance"] for row in graded["posted_ledger"]}
        self.assertEqual(names["511"], 28000)
        self.assertEqual(names["211"], 28000)
        self.assertNotEqual(graded["posted_trial_balance"], self.by_id["Q19"]["expected_trial_balance"])

    def test_unbalanced_entry_is_not_accepted(self):
        wrong = [
            {
                "entry_no": 1,
                "date": "20X6-04-02",
                "memo": "貸借が合っていない",
                "lines": [
                    {"account_code": "551", "side": "debit", "amount": 15000},
                    {"account_code": "101", "side": "credit", "amount": 14000},
                ],
            }
        ]
        graded = validator.grade_attempt(self.by_id["Q02"], self.accounts, wrong)
        self.assertFalse(graded["ok"])
        self.assertFalse(graded["trial_balance_internally_equal"])
        self.assertTrue(any("不一致" in item for item in graded["errors"]))

    def test_schema_requires_twenty_and_ledger_fields(self):
        schema = validator.load_json(ROOT / "schema.json")
        self.assertEqual(schema["properties"]["problems"]["minItems"], 20)
        self.assertEqual(schema["properties"]["problems"]["maxItems"], 20)
        ledger_props = schema["$defs"]["ledger_row"]["properties"]
        self.assertIn("debit_total", ledger_props)
        self.assertIn("credit_total", ledger_props)
        self.assertIn("balance_side", ledger_props)
        self.assertEqual(schema["$defs"]["problem"]["properties"]["continuity"]["const"], "independent")
        self.assertIs(schema["$defs"]["disclaimer"]["properties"]["expert_reviewed"]["const"], False)

    def mutated_problem_errors(self, mutate):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            for name in (
                "assumptions.json",
                "chart_of_accounts.json",
                "problems.json",
                "schema.json",
            ):
                shutil.copy(ROOT / name, base / name)
            document = json.loads((base / "problems.json").read_text(encoding="utf-8"))
            mutate(document)
            (base / "problems.json").write_text(
                json.dumps(document, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            return validator.check_fixture(base)

    def mutated_file_errors(self, filename, mutate):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            for name in (
                "assumptions.json",
                "chart_of_accounts.json",
                "problems.json",
                "schema.json",
            ):
                shutil.copy(ROOT / name, base / name)
            document = json.loads((base / filename).read_text(encoding="utf-8"))
            mutate(document)
            (base / filename).write_text(
                json.dumps(document, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            return validator.check_fixture(base)

    def test_tags_object_is_validation_error_not_typeerror(self):
        errors = self.mutated_problem_errors(
            lambda document: document["problems"][0].__setitem__("tags", [{}])
        )
        self.assertTrue(any("tags" in item for item in errors))

    def test_null_account_is_validation_error_not_typeerror(self):
        errors = self.mutated_file_errors(
            "chart_of_accounts.json",
            lambda document: document["accounts"].__setitem__(0, None),
        )
        self.assertTrue(any("object" in item for item in errors))

    def test_account_code_list_is_validation_error_not_typeerror(self):
        errors = self.mutated_file_errors(
            "chart_of_accounts.json",
            lambda document: document["accounts"][0].__setitem__("code", []),
        )
        self.assertTrue(any("code" in item for item in errors))

    def test_missing_description_ja_is_rejected(self):
        errors = self.mutated_file_errors(
            "chart_of_accounts.json",
            lambda document: document["accounts"][0].__delitem__("description_ja"),
        )
        self.assertTrue(any("description_ja" in item and "必須" in item for item in errors))

    def test_missing_assumptions_currency_is_rejected(self):
        errors = self.mutated_file_errors(
            "assumptions.json",
            lambda document: document.__delitem__("currency"),
        )
        self.assertTrue(any("currency" in item and "必須" in item for item in errors))

    def test_grade_rejects_float_amount_without_coercion(self):
        wrong = [
            {
                "entry_no": 1,
                "date": "20X6-04-02",
                "memo": "float金額",
                "lines": [
                    {"account_code": "551", "side": "debit", "amount": 15000.0},
                    {"account_code": "101", "side": "credit", "amount": 15000.0},
                ],
            }
        ]
        graded = validator.grade_attempt(self.by_id["Q02"], self.accounts, wrong)
        self.assertFalse(graded["ok"])
        self.assertEqual(graded["posted_ledger"], [])
        self.assertIsNone(graded["posted_trial_balance"])
        self.assertFalse(graded["trial_balance_internally_equal"])
        self.assertTrue(any("15000.0" in item and "変換しない" in item for item in graded["errors"]))

    def test_grade_rejects_bool_entry_no(self):
        attempt = json.loads(json.dumps(self.by_id["Q01"]["expected_entries"]))
        attempt[0]["entry_no"] = True
        self.assertEqual(True, 1)
        graded = validator.grade_attempt(self.by_id["Q01"], self.accounts, attempt)
        self.assertFalse(graded["ok"])
        self.assertEqual(graded["posted_ledger"], [])
        self.assertTrue(any("entry_no" in item and "True" in item for item in graded["errors"]))

    def test_grade_rejects_unknown_key_missing_and_wrong_types(self):
        unknown = json.loads(json.dumps(self.by_id["Q01"]["expected_entries"]))
        unknown[0]["note"] = "schema外"
        graded = validator.grade_attempt(self.by_id["Q01"], self.accounts, unknown)
        self.assertFalse(graded["ok"])
        self.assertEqual(graded["posted_ledger"], [])
        self.assertTrue(any("note" in item for item in graded["errors"]))

        cases = [
            {},
            {"entry_no": 1, "date": "20X6-04-01", "memo": "欠落", "lines": [
                {"account_code": "101", "side": "debit"},
                {"account_code": "301", "side": "credit", "amount": 600000},
            ]},
            {"entry_no": 1, "date": "20X6-04-01", "memo": "文字列金額", "lines": [
                {"account_code": "101", "side": "debit", "amount": "600000"},
                {"account_code": "301", "side": "credit", "amount": 600000},
            ]},
            {"entry_no": 1, "date": "20X6-04-01", "memo": "bool金額", "lines": [
                {"account_code": "101", "side": "debit", "amount": False},
                {"account_code": "301", "side": "credit", "amount": False},
            ]},
            {"entry_no": 1, "date": "20X6-04-01", "memo": "型違い", "lines": "not-a-list"},
            None,
        ]
        for attempt in cases:
            graded = validator.grade_attempt(self.by_id["Q01"], self.accounts, [attempt])
            self.assertFalse(graded["ok"])
            self.assertTrue(graded["errors"])
            self.assertEqual(graded["posted_ledger"], [])
        graded = validator.grade_attempt(self.by_id["Q01"], self.accounts, "not-a-list")
        self.assertFalse(graded["ok"])
        self.assertTrue(any("配列" in item for item in graded["errors"]))

    def test_check_fixture_rejects_additional_properties(self):
        errors = self.mutated_problem_errors(
            lambda document: document["problems"][0].__setitem__("review_note", "x")
        )
        self.assertTrue(any("review_note" in item for item in errors))
        root_errors = self.mutated_problem_errors(
            lambda document: document.__setitem__("not_in_schema", 1)
        )
        self.assertTrue(any("not_in_schema" in item for item in root_errors))

    def test_check_fixture_rejects_ledger_false_and_float(self):
        def set_false(document):
            for row in document["problems"][7]["expected_ledger"]:
                if row["account_code"] == "201":
                    self.assertEqual(row["balance"], 0)
                    row["balance"] = False

        errors = self.mutated_problem_errors(set_false)
        self.assertTrue(any("falseを0円にしない" in item and "False" in item for item in errors))
        self.assertFalse(any("expected_ledger と一致しない" in item for item in errors))

        def set_float(document):
            for row in document["problems"][0]["expected_ledger"]:
                if row["account_code"] == "101":
                    row["balance"] = 600000.0

        float_errors = self.mutated_problem_errors(set_float)
        self.assertTrue(any("600000.0" in item and "変換しない" in item for item in float_errors))
        self.assertFalse(any("expected_ledger と一致しない" in item for item in float_errors))

    def test_check_fixture_rejects_malformed_without_exception(self):
        type_errors = self.mutated_problem_errors(
            lambda document: document["problems"].__setitem__(0, "not-an-object")
        )
        self.assertTrue(any("object" in item for item in type_errors))
        missing = self.mutated_problem_errors(
            lambda document: document["problems"][1]["expected_entries"][0].__delitem__("lines")
        )
        self.assertTrue(missing)
        self.assertTrue(any("lines" in item or "転記しない" in item for item in missing))
        float_journal = self.mutated_problem_errors(
            lambda document: document["problems"][1]["expected_entries"][0]["lines"][0].__setitem__(
                "amount", 15000.0
            )
        )
        self.assertTrue(any("15000.0" in item and "変換しない" in item for item in float_journal))


if __name__ == "__main__":
    unittest.main()
