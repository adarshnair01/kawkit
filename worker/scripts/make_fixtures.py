"""Build the validation cases shared by the worker (pytest) and the web app (vitest).

Expected codes are written by hand here; the worker's own summary is stored too, so the web
test can check the two implementations agree number for number.
    uv run python scripts/make_fixtures.py
"""

import json
import math
from datetime import date, timedelta
from pathlib import Path

from kawkit_worker.validate import validate_csv


def rows(n=60, step=7, start=date(2024, 1, 1), extra=None, header=None, mutate=None):
    header = header or ["date", "revenue", "spend_tv", "spend_search", "control_promo"]
    out = []
    for i in range(n):
        d = start + timedelta(days=step * i)
        row = {
            "date": d.isoformat(),
            "revenue": 50000 + 900 * ((i * 7) % 13) + 40 * i,
            "spend_tv": 1000 + 400 * ((i * 5) % 11),
            "spend_search": 800 + 150 * ((i * 3) % 7),
            "control_promo": 1 if i % 9 == 0 else 0,
        }
        if extra:
            row.update(extra(i))
        if mutate:
            mutate(i, row)
        out.append(row)
    return header, out


def to_csv(header, body):
    return "\n".join([",".join(header)] + [",".join(str(r.get(h, "")) for h in header) for r in body]) + "\n"


def case(name, csv, errors=(), warn_in=(), warn_out=(), weeks=None, channels=None, controls=None, cadence=None, rows_=None):
    v = validate_csv(csv)
    return {
        "name": name, "csv": csv, "errors": sorted(errors), "error_rows": rows_,
        "warnings_include": list(warn_in), "warnings_exclude": list(warn_out),
        "weeks": weeks, "channels": channels, "controls": controls, "cadence": cadence,
        "python": {"errors": v.errors, "summary": v.summary},
    }


cases = []
h, b = rows()
cases.append(case("valid weekly", to_csv(h, b), warn_in=["short_history"], warn_out=["date_gaps", "channel_flat"],
                  weeks=60, channels=["tv", "search"], controls=["promo"], cadence="weekly"))

h, b = rows(n=110)
cases.append(case("valid, 110 weeks, shuffled order", to_csv(h, b[::-1]), warn_out=["short_history"], weeks=110,
                  channels=["tv", "search"], cadence="weekly"))

h, b = rows()
cases.append(case("missing date column", to_csv([x for x in h if x != "date"], b), errors=["missing_column"]))
cases.append(case("missing revenue and spend", to_csv(["date", "control_promo"], b), errors=["missing_column", "missing_column"]))
cases.append(case("duplicate column", to_csv(h + ["spend_tv"], b), errors=["duplicate_column"]))

h, b = rows(mutate=lambda i, r: r.update(date="01/15/2024") if i == 2 else None)
cases.append(case("bad date", to_csv(h, b), errors=["bad_date"], rows_=[[4]]))
h, b = rows(mutate=lambda i, r: r.update(date="2024-02-30") if i == 5 else None)
cases.append(case("impossible date", to_csv(h, b), errors=["bad_date"], rows_=[[7]]))
h, b = rows(mutate=lambda i, r: r.update(date="2024-01-01") if i == 3 else None)
cases.append(case("duplicate date", to_csv(h, b), errors=["duplicate_date"], rows_=[[5]]))


def bad_values(i, r):
    if i == 1:
        r["revenue"] = "n/a"
    if i == 4:
        r["spend_tv"] = ""
    if i == 6:
        r["spend_search"] = -5


h, b = rows(mutate=bad_values)
cases.append(case("bad values and negative spend", to_csv(h, b), errors=["bad_value", "bad_value", "negative_spend"],
                  rows_=[[3], [6], [8]]))

h, b = rows(mutate=lambda i, r: r.update(revenue=f'"${r["revenue"]:,}"', spend_tv=f'"€ {r["spend_tv"]:,}"'))
cases.append(case("currency symbols and thousands separators", to_csv(h, b), weeks=60, channels=["tv", "search"]))

h, b = rows(mutate=lambda i, r: r.update(date=(date(2024, 1, 1) + timedelta(days=7 * i + 3)).isoformat()) if i == 10 else None)
cases.append(case("irregular spacing", to_csv(h, b), errors=["bad_spacing"]))
h, b = rows(step=3)
cases.append(case("rows 3 days apart", to_csv(h, b), errors=["bad_spacing"]))
h, b = rows(n=30)
cases.append(case("too few rows", to_csv(h, b), errors=["too_few_rows"]))
h, b = rows(n=400, step=1)
cases.append(case("daily data summed to weeks", to_csv(h, b), warn_in=["partial_weeks"], weeks=57, cadence="daily",
                  channels=["tv", "search"]))
h, b = rows(n=70)
cases.append(case("gap of two weeks", to_csv(h, b[:20] + b[22:]), warn_in=["date_gaps"], weeks=68))

h, b = rows(header=["date", "revenue", "spend_tv", "spend_search", "spend_dead", "spend_flat", "spend_rare",
                    "spend_seasonal", "control_promo", "control_fixed", "notes"],
            extra=lambda i: {"spend_dead": 0, "spend_flat": 500 + (i % 2), "spend_rare": 900 if i % 12 == 0 else 0,
                             "spend_seasonal": round(1000 + 600 * math.sin(2 * math.pi * i / 52), 2),
                             "control_fixed": 3, "notes": "x"})
cases.append(case("warnings: zero, flat, sparse, seasonal, constant control, ignored", to_csv(h, b),
                  warn_in=["channel_all_zero", "channel_flat", "channel_sparse", "channel_seasonal", "control_constant",
                           "ignored_columns"],
                  weeks=60, channels=["tv", "search", "flat", "rare", "seasonal"], controls=["promo"]))

many = ["date", "revenue"] + [f"spend_c{k}" for k in range(16)]
h, b = rows(header=many, extra=lambda i: {f"spend_c{k}": 100 + (i * (k + 1)) % 17 for k in range(16)})
cases.append(case("too many channels", to_csv(h, b), errors=["too_many_channels"]))
cases.append(case("empty file", "\n\n", errors=["empty"]))
h, b = rows(header=["date", "revenue", "spend_tv"], mutate=lambda i, r: r.update(spend_tv=0))
cases.append(case("every spend column zero", to_csv(h, b), errors=["no_spend"]))

out = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "validation_cases.json"
out.write_text(json.dumps(cases, indent=1))
for c in cases:
    got = sorted(e["code"] for e in c["python"]["errors"])
    print(("ok  " if got == c["errors"] else "DIFF"), c["name"], got if got != c["errors"] else "",
          [w["code"] for w in (c["python"]["summary"] or {}).get("warnings", [])])
