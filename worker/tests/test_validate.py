import json
from pathlib import Path

import pytest

from kawkit_worker.validate import parse_date, parse_number, validate_csv

CASES = json.loads((Path(__file__).parent / "fixtures" / "validation_cases.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_shared_cases(case):
    v = validate_csv(case["csv"])
    assert sorted(e["code"] for e in v.errors) == case["errors"]
    if case["error_rows"] is not None:
        assert [e["rows"] for e in v.errors] == case["error_rows"]
    codes = [w["code"] for w in v.warnings]
    for code in case["warnings_include"]:
        assert code in codes
    for code in case["warnings_exclude"]:
        assert code not in codes
    if case["weeks"] is not None:
        assert v.summary["weeks"] == case["weeks"]
        assert v.dataset.spend.shape == (case["weeks"], len(v.dataset.channels))
    if case["channels"] is not None:
        assert v.dataset.channels == case["channels"]
    if case["controls"] is not None:
        assert v.dataset.control_names == case["controls"]
    if case["cadence"] is not None:
        assert v.summary["cadence"] == case["cadence"]


def test_number_parsing_strips_symbols_and_rejects_text():
    assert parse_number(" $1,234.50 ") == 1234.5
    assert parse_number("₹ 12,00,000") == 1200000
    assert parse_number("1e3") == 1000
    for bad in ("", "abc", "1.2.3", "--5", "nan", "inf", "=1+1"):
        assert parse_number(bad) is None


def test_date_parsing_is_strict():
    assert parse_date("2024-02-29") is not None
    for bad in ("2023-02-29", "2024-13-01", "24-01-01", "2024/01/01", "2024-1-1"):
        assert parse_date(bad) is None


def test_limits():
    assert validate_csv(b"x" * (10 * 1024 * 1024 + 1)).errors[0]["code"] == "file_too_large"
    big = "date,revenue,spend_a\n" + "\n".join(f"2024-01-01,{i},1" for i in range(5001))
    assert validate_csv(big).errors[0]["code"] == "too_many_rows"
    wide = ",".join(["date", "revenue"] + [f"x{i}" for i in range(70)]) + "\n"
    assert validate_csv(wide).errors[0]["code"] == "too_many_columns"
    assert validate_csv(b"\xff\xfe\x00bad").errors[0]["code"] == "not_text"


def test_rows_listed_are_capped_in_message():
    body = "\n".join(f"bad,{i},1" for i in range(30))
    v = validate_csv("date,revenue,spend_a\n" + body)
    assert "and 20 more" in v.errors[0]["message"]
