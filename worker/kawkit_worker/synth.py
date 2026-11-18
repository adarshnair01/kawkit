"""Synthetic weekly datasets with known true effects, for the sample run and the known-truth tests."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

import numpy as np

from .model import L_MAX, adstock_np, saturation_np


@dataclass
class Truth:
    channels: list[str]
    roi: dict[str, float]
    alpha: dict[str, float]
    lam: dict[str, float]
    contribution: dict[str, float]


def make_dataset(seed: int = 7, weeks: int = 156, n_channels: int = 5, noise: float = 0.02,
                 with_promo: bool = True, base_level: float = 400_000.0) -> tuple[str, Truth]:
    """Return (csv_text, truth). Spend varies week to week so effects are identifiable."""
    rng = np.random.default_rng(seed)
    names = ["tv", "search", "social", "display", "email", "video", "radio", "affiliates", "podcast", "outdoor"]
    names = names[:n_channels]
    t = np.arange(weeks)

    spend = np.zeros((weeks, n_channels))
    for c in range(n_channels):
        level = rng.uniform(8_000, 45_000)
        # bursts and random walk, with some dark weeks for the first channel (TV-like flighting)
        walk = np.exp(np.cumsum(rng.normal(0, 0.12, weeks)))
        walk /= walk.mean()
        jitter = rng.lognormal(0, 0.35, weeks)
        x = level * walk * jitter
        if c == 0:
            on = rng.random(weeks) < 0.7
            x = x * on
        spend[:, c] = np.round(x, 0)

    alpha = rng.uniform(0.1, 0.65, n_channels)
    alpha[0] = max(alpha[0], 0.5)  # TV carries over longest
    lam = rng.uniform(1.5, 4.5, n_channels)
    target_roi = rng.uniform(0.6, 3.2, n_channels)

    xmax = spend.max(axis=0)
    xs = spend / xmax
    contrib = np.zeros_like(spend)
    for c in range(n_channels):
        shape = saturation_np(adstock_np(xs[:, c], alpha[c]), lam[c])
        beta = target_roi[c] * spend[:, c].sum() / shape.sum()
        contrib[:, c] = beta * shape

    trend = 60_000.0 * t / weeks
    season = 45_000.0 * np.sin(2 * np.pi * t / 52 + 0.6) + 18_000.0 * np.cos(4 * np.pi * t / 52)
    promo = (rng.random(weeks) < 0.12).astype(float) if with_promo else np.zeros(weeks)
    y_clean = base_level + trend + season + 40_000.0 * promo + contrib.sum(axis=1)
    y = y_clean * (1 + rng.normal(0, noise, weeks))

    start = date(2023, 1, 2)
    header = ["date", "revenue", *[f"spend_{n}" for n in names]] + (["control_promo"] if with_promo else [])
    lines = [",".join(header)]
    for i in range(weeks):
        row = [(start + timedelta(days=7 * i)).isoformat(), f"{y[i]:.0f}", *[f"{v:.0f}" for v in spend[i]]]
        if with_promo:
            row.append(f"{promo[i]:.0f}")
        lines.append(",".join(row))

    truth = Truth(
        channels=names,
        roi={n: float(contrib[:, i].sum() / spend[:, i].sum()) for i, n in enumerate(names)},
        alpha={n: float(alpha[i]) for i, n in enumerate(names)},
        lam={n: float(lam[i]) for i, n in enumerate(names)},
        contribution={n: float(contrib[:, i].sum()) for i, n in enumerate(names)},
    )
    assert L_MAX == 8
    return "\n".join(lines) + "\n", truth


@dataclass
class HierTruth:
    item_names: list[str]
    item_roi: dict[str, float]
    channel_roi: dict[str, float]


def make_hier_dataset(seed: int = 11, weeks: int = 156, noise: float = 0.02, base_level: float = 600_000.0,
                      breakdowns: dict | None = None, lam_spread: float = 0.0):
    """Five channels where some are split into items with different true ROIs. Returns (Dataset, Items, truth).

    breakdowns: channel -> {"mix": "varied" | "fixed", "dims": [dim names], "items": [(level per dim..., roi)]}.
    Carry-over and saturation speed are shared by a channel's items, as in the model. 'varied' gives each item
    its own spend pattern so the items can be told apart; 'fixed' keeps the mix of spend constant, so they cannot.
    lam_spread > 0 breaks the model's assumption by giving each item its own saturation speed (log-sd lam_spread).
    """
    from .hier import Group, Items
    from .validate import Dataset

    names = ["tv", "search", "social", "display", "email"]
    rng = np.random.default_rng(seed)
    breakdowns = breakdowns or {}
    t = np.arange(weeks)
    C = len(names)

    chan_spend = np.zeros((weeks, C))
    for c in range(C):
        walk = np.exp(np.cumsum(rng.normal(0, 0.12, weeks)))
        walk /= walk.mean()
        x = rng.uniform(15_000, 45_000) * walk * rng.lognormal(0, 0.3, weeks)
        chan_spend[:, c] = np.round(x, 0)
    alpha = rng.uniform(0.1, 0.6, C)
    lam = rng.uniform(1.5, 4.5, C)
    default_roi = rng.uniform(0.8, 2.6, C)
    xmax = chan_spend.max(axis=0)

    item_names: list[str] = []
    item_chan: list[int] = []
    item_contrib_total: list[float] = []
    cols: list[np.ndarray] = []
    groups: list[Group] = []
    level_of: list[list[tuple[int, int]]] = []
    true_roi: list[float] = []
    contrib_total = np.zeros(weeks)
    col0 = 0
    for c, ch in enumerate(names):
        spec = breakdowns.get(ch)
        if not spec:
            shape = saturation_np(adstock_np(chan_spend[:, c] / xmax[c], alpha[c]), lam[c])
            beta = default_roi[c] * chan_spend[:, c].sum() / shape.sum()
            contrib_total += beta * shape
            item_contrib_total.append(float((beta * shape).sum()))
            item_names.append(ch)
            item_chan.append(c)
            cols.append(chan_spend[:, c])
            level_of.append([])
            true_roi.append(float(default_roi[c]))
            continue
        items = spec["items"]
        S = len(items)
        if spec.get("mix", "varied") == "varied":
            g = np.cumsum(rng.normal(0, 0.35, (weeks, S)), axis=0) + rng.normal(0, 0.5, (weeks, S))
        else:
            g = np.tile(rng.normal(0, 0.6, S), (weeks, 1)) + rng.normal(0, 0.004, (weeks, S))
        share = np.exp(g) / np.exp(g).sum(axis=1, keepdims=True)
        spend = np.round(chan_spend[:, c, None] * share, 0)
        dims = spec["dims"]
        gstart = len(groups)
        for d, dim in enumerate(dims):
            levels = list(dict.fromkeys(it[d] for it in items))
            groups.append(Group(channel=c, dim=dim, levels=levels, col0=col0))
            col0 += len(levels)
        for s, it in enumerate(items):
            roi = it[-1]
            shape = saturation_np(adstock_np(spend[:, s] / xmax[c], alpha[c]), lam[c] * float(np.exp(rng.normal(0, lam_spread))) if lam_spread else lam[c])
            beta = roi * spend[:, s].sum() / shape.sum()
            contrib_total += beta * shape
            item_contrib_total.append(float((beta * shape).sum()))
            item_names.append(f"{ch} / " + " / ".join(it[:-1]))
            item_chan.append(c)
            cols.append(spend[:, s])
            level_of.append([(gstart + d, groups[gstart + d].levels.index(it[d])) for d in range(len(dims))])
            true_roi.append(float(roi))
        chan_spend[:, c] = spend.sum(axis=1)

    trend = 60_000.0 * t / weeks
    season = 45_000.0 * np.sin(2 * np.pi * t / 52 + 0.6) + 18_000.0 * np.cos(4 * np.pi * t / 52)
    promo = (rng.random(weeks) < 0.12).astype(float)
    y = (base_level + trend + season + 40_000.0 * promo + contrib_total) * (1 + rng.normal(0, noise, weeks))
    start = date(2023, 1, 2)
    ds = Dataset(
        dates=[(start + timedelta(days=7 * i)).isoformat() for i in range(weeks)], y=np.round(y, 0), spend=chan_spend,
        controls=promo[:, None], channels=names, control_names=["promo"],
    )
    items_obj = Items(names=item_names, channel=np.array(item_chan), spend=np.stack(cols, axis=1), groups=groups, level_of=level_of)
    chan_roi = {}
    for c, ch in enumerate(names):
        idx = [i for i, cc in enumerate(item_chan) if cc == c]
        chan_roi[ch] = float(sum(item_contrib_total[i] for i in idx) / sum(items_obj.spend[:, i].sum() for i in idx))
    truth = HierTruth(item_names=item_names, item_roi=dict(zip(item_names, true_roi)), channel_roi=chan_roi)
    return ds, items_obj, truth
