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
