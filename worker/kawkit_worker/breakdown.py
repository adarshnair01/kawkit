"""Breakdown file: long-format weekly spend by channel and dimensions, turned into the items the model uses.

Columns: date, channel, spend, plus any dimension columns (platform, campaign, region, ...). The run's settings say,
per channel, which dimensions to break it down by. Spend rows are added up per week and item; dimension values that
are rare are folded into "Other"; whatever the main file's channel total has beyond the items becomes
"Not broken down", and a breakdown that adds up to more than the channel total is an error.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field, replace
from datetime import timedelta

import numpy as np

from .hier import Group, Items
from .validate import Dataset, parse_date, parse_number

MAX_ROWS = 60_000
MAX_LEVELS = 7  # per dimension, before the rest are folded into "Other"
MIN_LEVEL_SHARE = 0.02
MAX_ITEMS = 12  # per channel
RECONCILE_TOL = 0.02
OTHER = "Other"
REMAINDER = "Not broken down"
SPARSE_ACTIVE_SHARE = 0.2
NAME_RE = re.compile(r"[^a-z0-9_]+")


class BreakdownError(Exception):
    pass


@dataclass
class BreakdownResult:
    items: Items
    dataset: Dataset  # the main dataset with broken-down channels' spend replaced by the sum of their items
    summary: dict
    warnings: list[dict] = field(default_factory=list)


def _slug(s: str) -> str:
    return NAME_RE.sub("_", s.strip().lower()).strip("_")


def clean_spec(spec: dict | None, channels: list[str]) -> dict[str, list[str]]:
    """{channel: {"dims": [..]}} -> {channel: [dims]}, keeping only channels in the data and at most 3 dimensions."""
    out: dict[str, list[str]] = {}
    for ch, entry in (spec or {}).items():
        name = _slug(str(ch))
        if name not in channels:
            raise BreakdownError(f"The breakdown names a channel '{ch}' that is not in the data.")
        dims = [str(d).strip() for d in (entry or {}).get("dims", []) if str(d).strip()]
        dims = list(dict.fromkeys(dims))
        if not dims:
            continue
        if len(dims) > 3:
            raise BreakdownError(f"Channel '{ch}': break down by at most 3 dimensions.")
        out[name] = dims
    return out


def read_long(content: bytes | str):
    raw = content.encode("utf-8") if isinstance(content, str) else content
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError as e:
        raise BreakdownError("The breakdown file is not UTF-8 text. Export it as CSV (UTF-8).") from e
    try:
        table = [r for r in csv.reader(io.StringIO(text, newline=""), strict=False)]
    except csv.Error as e:
        raise BreakdownError("The breakdown file could not be read as CSV.") from e
    table = [r for r in table if any(c.strip() for c in r)]
    if not table:
        raise BreakdownError("The breakdown file is empty.")
    if len(table) - 1 > MAX_ROWS:
        raise BreakdownError(f"The breakdown file has {len(table) - 1} rows; at most {MAX_ROWS} are allowed.")
    header = [h.strip().lower() for h in table[0]]
    for need in ("date", "channel", "spend"):
        if need not in header:
            raise BreakdownError(f"The breakdown file needs a '{need}' column.")
    return header, table[1:]


def _norm(v: str) -> str:
    return re.sub(r"\s+", " ", v.strip())


def build_items(ds: Dataset, content: bytes | str, spec: dict | None) -> BreakdownResult:
    wanted = clean_spec(spec, ds.channels)
    if not wanted:
        raise BreakdownError("Choose at least one channel and dimension to break down by.")
    header, body = read_long(content)
    col = {h: i for i, h in enumerate(header)}
    for ch, dims in wanted.items():
        for d in dims:
            if d.lower() not in col:
                raise BreakdownError(f"Channel '{ch}': the breakdown file has no '{d}' column.")

    weeks = [parse_date(d) for d in ds.dates]
    T = len(weeks)
    week_of = {w: i for i, w in enumerate(weeks)}

    def week_index(day) -> int | None:
        i = week_of.get(day)
        if i is not None:
            return i
        for k in range(1, 7):  # daily rows fall in the week that started up to 6 days earlier
            i = week_of.get(day - timedelta(days=k))
            if i is not None:
                return i
        return None

    warnings: list[dict] = []
    # spend[channel][(level tuple)] -> (T,) weekly series, with value spellings merged case-insensitively
    spellings: dict[tuple[str, str], dict[str, str]] = {}
    raw: dict[str, dict[tuple, np.ndarray]] = {ch: {} for ch in wanted}
    bad_rows: dict[str, list[int]] = {"date": [], "spend": [], "negative": [], "channel": []}
    outside = 0
    for ln, row in enumerate(body, start=2):
        row = row + [""] * (len(header) - len(row))
        ch = _slug(row[col["channel"]])
        if ch not in wanted:
            if ch not in ds.channels:
                bad_rows["channel"].append(ln)
            continue
        day = parse_date(row[col["date"]])
        if day is None:
            bad_rows["date"].append(ln)
            continue
        amount = parse_number(row[col["spend"]])
        if amount is None:
            bad_rows["spend"].append(ln)
            continue
        if amount < 0:
            bad_rows["negative"].append(ln)
            continue
        wi = week_index(day)
        if wi is None:
            outside += 1
            continue
        levels = []
        for d in wanted[ch]:
            v = _norm(row[col[d.lower()]]) or "(blank)"
            seen = spellings.setdefault((ch, d), {})
            levels.append(seen.setdefault(v.casefold(), v))
        series = raw[ch].setdefault(tuple(levels), np.zeros(T))
        series[wi] += amount

    def listed(rows: list[int]) -> str:
        shown = ", ".join(str(r) for r in rows[:8])
        return f"row{'s' if len(rows) > 1 else ''} {shown}{f' and {len(rows) - 8} more' if len(rows) > 8 else ''}"

    if bad_rows["date"]:
        raise BreakdownError(f"Date is not YYYY-MM-DD in the breakdown file, {listed(bad_rows['date'])}.")
    if bad_rows["spend"]:
        raise BreakdownError(f"Spend is missing or not a number in the breakdown file, {listed(bad_rows['spend'])}.")
    if bad_rows["negative"]:
        raise BreakdownError(f"Spend is negative in the breakdown file, {listed(bad_rows['negative'])}.")
    if bad_rows["channel"]:
        names = sorted({_slug(body[r - 2][col["channel"]]) for r in bad_rows["channel"][:50]})
        warnings.append({"code": "unknown_channel", "message": f"Rows for channels that are not in the main file were ignored: {', '.join(names[:6])}."})
    if outside:
        warnings.append({"code": "dates_outside", "message": f"{outside} breakdown rows fall outside the weeks in the main file and were ignored."})

    names: list[str] = []
    chan_idx: list[int] = []
    cols: list[np.ndarray] = []
    groups: list[Group] = []
    level_of: list[list[tuple[int, int]]] = []
    new_spend = ds.spend.copy()
    col0 = 0
    per_channel: dict[str, dict] = {}

    for c, ch in enumerate(ds.channels):
        dims = wanted.get(ch)
        if not dims:
            names.append(ch)
            chan_idx.append(c)
            cols.append(ds.spend[:, c])
            level_of.append([])
            continue
        series = raw[ch]
        if not series:
            raise BreakdownError(f"The breakdown file has no rows for channel '{ch}'.")
        total_main = ds.spend[:, c]
        # fold rare levels of each dimension into "Other"
        folded: dict[tuple, np.ndarray] = {}
        level_spend = [{} for _ in dims]
        for key, s in series.items():
            for d, lv in enumerate(key):
                level_spend[d][lv] = level_spend[d].get(lv, 0.0) + float(s.sum())
        grand = sum(float(s.sum()) for s in series.values())
        keep: list[set] = []
        merged_note = []
        for d in range(len(dims)):
            ranked = sorted(level_spend[d].items(), key=lambda kv: -kv[1])
            kept = {lv for k, (lv, v) in enumerate(ranked) if k < MAX_LEVELS and v / max(grand, 1e-9) >= MIN_LEVEL_SHARE}
            if len(ranked) - len(kept) >= 1:
                merged_note.append(f"{len(ranked) - len(kept)} small {dims[d]} values into Other")
            if not kept:
                kept = {ranked[0][0]}
            keep.append(kept)
        for key, s in series.items():
            k2 = tuple(lv if lv in keep[d] else OTHER for d, lv in enumerate(key))
            folded[k2] = folded.get(k2, np.zeros(T)) + s
        if merged_note:
            warnings.append({"code": "folded", "message": f"{ch}: folded " + " and ".join(merged_note) + "."})
        if len(folded) > MAX_ITEMS:
            raise BreakdownError(
                f"Channel '{ch}' breaks down into {len(folded)} items; at most {MAX_ITEMS} are allowed. "
                "Use fewer dimensions, or a coarser one.")
        # reconcile with the main file's channel total
        inside = sum(folded.values())
        gap = total_main - inside
        denom = max(float(total_main.sum()), 1e-9)
        over = float(np.clip(-gap, 0, None).sum()) / denom
        if over > RECONCILE_TOL:
            raise BreakdownError(
                f"Channel '{ch}': the breakdown adds up to {over * 100:.1f}% more than the channel total in the main file "
                f"(in {int((gap < -1e-6).sum())} weeks). Check that both files use the same spend and the same weeks.")
        remainder = np.clip(gap, 0, None)
        rem_share = float(remainder.sum()) / denom
        if rem_share > RECONCILE_TOL:
            folded[tuple(REMAINDER for _ in dims)] = remainder
            warnings.append({"code": "remainder", "message": f"{ch}: the breakdown covers {100 - rem_share * 100:.0f}% of the channel's spend; the rest is kept as '{REMAINDER}'."})
        # groups for this channel's dimensions
        gstart = len(groups)
        order = sorted(folded, key=lambda k: -float(folded[k].sum()))
        for d, dim in enumerate(dims):
            lv = list(dict.fromkeys(k[d] for k in order))
            if len(lv) >= 2:
                groups.append(Group(channel=c, dim=dim, levels=lv, col0=col0))
                col0 += len(lv)
            else:
                groups.append(Group(channel=c, dim=dim, levels=lv, col0=-1))  # one level: no effect to estimate
        sparse = []
        for k in order:
            s = folded[k]
            names.append(f"{ch} / " + " / ".join(k))
            chan_idx.append(c)
            cols.append(s)
            level_of.append([(gstart + d, groups[gstart + d].levels.index(k[d])) for d in range(len(dims)) if groups[gstart + d].col0 >= 0])
            if float((s > 0).mean()) < SPARSE_ACTIVE_SHARE:
                sparse.append(" / ".join(k))
        if sparse:
            few = ", ".join(sparse[:4])
            pct = int(SPARSE_ACTIVE_SHARE * 100)
            warnings.append({"code": "sparse_items", "message": f"{ch}: {few} had spend in under {pct}% of weeks, so the data says little about them."})
        new_spend[:, c] = sum(folded.values())
        shares = np.stack([folded[k] / np.maximum(sum(folded.values()), 1e-9) for k in order], axis=1)
        cv = [float(np.std(shares[:, i]) / max(np.mean(shares[:, i]), 1e-9)) for i in range(shares.shape[1])]
        per_channel[ch] = {"dims": dims, "items": len(order), "shares_cv": cv}

    # drop single-level groups from the model (they carry no effect) but keep numbering consistent
    live = [g for g in groups if g.col0 >= 0]
    remap = {id(g): i for i, g in enumerate(live)}
    old_to_new = {i: remap[id(g)] for i, g in enumerate(groups) if g.col0 >= 0}
    level_of = [[(old_to_new[g], lvl) for g, lvl in pairs] for pairs in level_of]
    items = Items(names=names, channel=np.array(chan_idx), spend=np.stack(cols, axis=1), groups=live, level_of=level_of)
    ds2 = replace(ds, spend=new_spend)
    summary = {"channels": per_channel, "items": items.n, "folded_or_remainder_notes": len(warnings)}
    return BreakdownResult(items=items, dataset=ds2, summary=summary, warnings=warnings)
