"""Server-side CSV checks. Mirror of web/src/validation/validate.ts; the two share test fixtures.

The CSV is untrusted: it is parsed with strict limits and never executed or evaluated.
"""

from __future__ import annotations

import csv
import io
import math
import re
from dataclasses import dataclass, field
from datetime import date, timedelta

import numpy as np

MAX_BYTES = 10 * 1024 * 1024
MAX_ROWS = 5000
MAX_CHANNELS = 15
MAX_COLUMNS = 60
MIN_WEEKS = 52
RECOMMENDED_WEEKS = 104
MAX_ROWS_LISTED = 10

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NUMBER_RE = re.compile(r"^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$")
STRIP_RE = re.compile(r"[\s,$€£₹¥]")
NAME_RE = re.compile(r"[^a-z0-9_]+")


@dataclass
class Dataset:
    """Clean weekly data ready for the model."""

    dates: list[str]
    y: np.ndarray  # (T,)
    spend: np.ndarray  # (T, C)
    controls: np.ndarray  # (T, K)
    channels: list[str]
    control_names: list[str]


@dataclass
class Validation:
    errors: list[dict] = field(default_factory=list)
    warnings: list[dict] = field(default_factory=list)
    summary: dict = field(default_factory=dict)
    dataset: Dataset | None = None

    @property
    def ok(self) -> bool:
        return not self.errors


def _rows_text(rows: list[int]) -> str:
    shown = ", ".join(str(r) for r in rows[:MAX_ROWS_LISTED])
    more = len(rows) - MAX_ROWS_LISTED
    label = "row" if len(rows) == 1 else "rows"
    return f"{label} {shown}" + (f" and {more} more" if more > 0 else "")


def parse_number(raw: str) -> float | None:
    """Strip currency symbols, spaces and thousands separators; None if not a number."""
    s = STRIP_RE.sub("", raw)
    if not s or not NUMBER_RE.match(s):
        return None
    v = float(s)
    return v if math.isfinite(v) else None


def parse_date(raw: str) -> date | None:
    s = raw.strip()
    if not DATE_RE.match(s):
        return None
    try:
        return date(int(s[0:4]), int(s[5:7]), int(s[8:10]))
    except ValueError:
        return None


def _seasonal_share(x: np.ndarray, period: float) -> float:
    """Share of a series' variance explained by a linear trend plus 2 yearly Fourier pairs."""
    n = len(x)
    if n < 8 or float(np.var(x)) == 0.0:
        return 0.0
    t = np.arange(n, dtype=float)
    cols = [np.ones(n), t / max(n - 1, 1)]
    for k in (1, 2):
        cols.append(np.sin(2 * np.pi * k * t / period))
        cols.append(np.cos(2 * np.pi * k * t / period))
    a = np.stack(cols, axis=1)
    coef, *_ = np.linalg.lstsq(a, x, rcond=None)
    resid = x - a @ coef
    return float(max(0.0, 1.0 - np.var(resid) / np.var(x)))


def validate_csv(content: bytes | str) -> Validation:
    v = Validation()

    def err(code: str, message: str, rows: list[int] | None = None) -> None:
        v.errors.append({"code": code, "message": message, "rows": (rows or [])[:50]})

    def warn(code: str, message: str, column: str | None = None) -> None:
        v.warnings.append({"code": code, "message": message, "column": column})

    if isinstance(content, str):
        raw = content.encode("utf-8")
    else:
        raw = content
    if len(raw) > MAX_BYTES:
        err("file_too_large", "The file is larger than 10 MB.")
        return v
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        err("not_text", "The file is not UTF-8 text. Export it as CSV (UTF-8).")
        return v

    try:
        table = [r for r in csv.reader(io.StringIO(text, newline=""), strict=False)]
    except csv.Error:
        err("not_csv", "The file could not be read as CSV.")
        return v
    # keep original line numbers (header is row 1); drop fully empty lines
    numbered = [(i + 1, r) for i, r in enumerate(table) if any(c.strip() for c in r)]
    if not numbered:
        err("empty", "The file is empty.")
        return v

    header = [h.strip().lower() for h in numbered[0][1]]
    body = numbered[1:]
    if len(header) > MAX_COLUMNS:
        err("too_many_columns", f"The file has {len(header)} columns; at most {MAX_COLUMNS} are allowed.")
        return v
    if len(body) > MAX_ROWS:
        err("too_many_rows", f"The file has {len(body)} rows; at most {MAX_ROWS} are allowed.")
        return v

    dupes = sorted({h for h in header if h and header.count(h) > 1})
    if dupes:
        err("duplicate_column", f"Column name repeats: {', '.join(dupes)}.")
    if "date" not in header:
        err("missing_column", "Required column 'date' is missing.")
    if "revenue" not in header:
        err("missing_column", "Required column 'revenue' is missing.")
    spend_cols = [h for h in header if h.startswith("spend_") and len(h) > 6]
    control_cols = [h for h in header if h.startswith("control_") and len(h) > 8]
    if not spend_cols:
        err("missing_column", "At least one 'spend_<channel>' column is needed.")
    if len(spend_cols) > MAX_CHANNELS:
        err("too_many_channels", f"The file has {len(spend_cols)} spend columns; at most {MAX_CHANNELS} are allowed.")
    if v.errors:
        return v

    used = ["date", "revenue", *spend_cols, *control_cols]
    ignored = [h for h in header if h not in used]
    if ignored:
        shown = ", ".join(h if h else "(blank)" for h in ignored[:8])
        warn("ignored_columns", f"Ignored columns (no spend_ or control_ prefix): {shown}.")
    idx = {h: header.index(h) for h in used}

    # ---- cell checks
    bad_dates: list[int] = []
    dup_dates: list[int] = []
    bad_values: dict[str, list[int]] = {}
    negative: dict[str, list[int]] = {}
    seen: dict[date, int] = {}
    records: list[tuple[date, list[float], int]] = []
    numeric_cols = ["revenue", *spend_cols, *control_cols]
    for line, row in body:
        cells = row + [""] * (len(header) - len(row))
        d = parse_date(cells[idx["date"]])
        if d is None:
            bad_dates.append(line)
        elif d in seen:
            dup_dates.append(line)
        else:
            seen[d] = line
        values: list[float] = []
        row_ok = True
        for c in numeric_cols:
            num = parse_number(cells[idx[c]])
            if num is None:
                bad_values.setdefault(c, []).append(line)
                row_ok = False
                continue
            if num < 0 and c.startswith("spend_"):
                negative.setdefault(c, []).append(line)
                row_ok = False
            values.append(num)
        if d is not None and row_ok:
            records.append((d, values, line))

    if bad_dates:
        err("bad_date", f"Date is not YYYY-MM-DD in {_rows_text(bad_dates)}.", bad_dates)
    if dup_dates:
        err("duplicate_date", f"Date appears twice in {_rows_text(dup_dates)}.", dup_dates)
    for c, rows in bad_values.items():
        err("bad_value", f"Column '{c}' has a missing or non-numeric value in {_rows_text(rows)}.", rows)
    for c, rows in negative.items():
        err("negative_spend", f"Column '{c}' has negative spend in {_rows_text(rows)}.", rows)
    if v.errors:
        return v

    records.sort(key=lambda r: r[0])
    dates = [r[0] for r in records]
    lines = [r[2] for r in records]
    data = np.array([r[1] for r in records], dtype=float).reshape(len(records), len(numeric_cols))

    # ---- spacing: weekly or daily
    cadence = "weekly"
    gaps = 0
    if len(dates) >= 2:
        diffs = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
        ordered = sorted(diffs)
        median = ordered[(len(ordered) - 1) // 2]
        if median == 1:
            cadence = "daily"
            gaps = sum(1 for d in diffs if d > 1)
        elif median == 7:
            off = [lines[i + 1] for i, d in enumerate(diffs) if d % 7 != 0]
            if off:
                err("bad_spacing", f"Rows must be 7 days apart (or 1 day apart for daily data); see {_rows_text(off)}.", off)
                return v
            gaps = sum(1 for d in diffs if d > 7)
        else:
            err("bad_spacing", "Rows are neither 7 days nor 1 day apart. Use one row per week or per day.")
            return v

    input_rows = len(dates)
    if cadence == "daily":
        # sum to weeks starting Monday; keep only complete weeks
        weeks: dict[date, list] = {}
        for d, row in zip(dates, data):
            monday = d - timedelta(days=d.weekday())
            slot = weeks.setdefault(monday, [0, np.zeros(len(numeric_cols))])
            slot[0] += 1
            slot[1] += row
        full = sorted(k for k, s in weeks.items() if s[0] == 7)
        partial = len(weeks) - len(full)
        if partial:
            warn("partial_weeks", f"{partial} incomplete week(s) were left out after summing daily rows to weeks.")
        dates = full
        data = np.array([weeks[k][1] for k in full], dtype=float).reshape(len(full), len(numeric_cols))
        gaps = sum(1 for i in range(1, len(dates)) if (dates[i] - dates[i - 1]).days > 7)

    n = len(dates)
    if n < MIN_WEEKS:
        err("too_few_rows", f"The file has {n} weekly rows; at least {MIN_WEEKS} are needed (104 or more recommended).")
        return v
    if gaps:
        warn("date_gaps", f"Dates have {gaps} gap(s). The model treats the rows as consecutive weeks.")
    if n < RECOMMENDED_WEEKS:
        warn("short_history", f"{n} weeks of data; 104 or more give steadier estimates, especially for seasonality.")

    y = data[:, 0]
    if float(np.max(y)) <= 0:
        err("bad_value", "Column 'revenue' is zero or negative throughout.")
        return v

    # ---- per-channel checks
    channels: list[dict] = []
    keep_spend: list[int] = []
    for j, col in enumerate(spend_cols):
        x = data[:, 1 + j]
        name = col[6:]
        total = float(x.sum())
        if total == 0:
            warn("channel_all_zero", f"Channel '{name}' is zero throughout and was dropped.", col)
            continue
        active = float(np.mean(x > 0))
        mean = float(x.mean())
        cv = float(x.std() / mean) if mean > 0 else 0.0
        seasonal = _seasonal_share(x, 52.0)
        if active < 0.15:
            warn("channel_sparse", f"Channel '{name}' is active in only {active * 100:.0f}% of weeks; its estimate will be wide.", col)
        elif cv < 0.15:
            warn("channel_flat", f"Channel '{name}' spend barely changes, so its effect cannot be measured from this data.", col)
        if seasonal > 0.6:
            warn("channel_seasonal", f"Channel '{name}' spend mostly follows the season or trend ({seasonal * 100:.0f}% of its movement), so it is hard to separate from seasonality.", col)
        keep_spend.append(j)
        channels.append({
            "name": name, "column": col, "total": total, "mean": mean, "max": float(x.max()),
            "active_share": active, "cv": cv, "seasonal_share": seasonal,
        })

    if not keep_spend:
        err("no_spend", "Every spend column is zero throughout.")
        return v

    keep_controls: list[int] = []
    control_names: list[str] = []
    for j, col in enumerate(control_cols):
        z = data[:, 1 + len(spend_cols) + j]
        if float(np.ptp(z)) == 0:
            warn("control_constant", f"Control '{col[8:]}' never changes and was dropped.", col)
            continue
        keep_controls.append(j)
        control_names.append(col[8:])

    n_terms = len(keep_spend) + len(keep_controls)
    if n < 10 * n_terms:
        warn("many_channels", f"{len(keep_spend)} channels and {len(keep_controls)} controls is a lot for {n} weeks; expect wide intervals.")

    spend = data[:, [1 + j for j in keep_spend]]
    controls = data[:, [1 + len(spend_cols) + j for j in keep_controls]] if keep_controls else np.zeros((n, 0))
    date_strs = [d.isoformat() for d in dates]

    v.dataset = Dataset(
        dates=date_strs, y=y, spend=spend, controls=controls,
        channels=[c["name"] for c in channels], control_names=control_names,
    )
    v.summary = {
        "input_rows": input_rows,
        "weeks": n,
        "cadence": cadence,
        "start": date_strs[0],
        "end": date_strs[-1],
        "revenue_total": float(y.sum()),
        "channels": channels,
        "controls": control_names,
        "ignored": ignored,
        "warnings": v.warnings,
    }
    return v
