"""Budget optimiser over posterior draws. Mirror of web/src/optimizer/optimize.ts.

Steady weekly spend x_c per channel; with normalised adstock the steady-state response of channel c
under draw d is  beta_cd * ymax * tanh(lam_cd * x_c / (2 * xmax_c)).
"""

from __future__ import annotations

import numpy as np

GRID = 400
STEPS = 2000
LOOKAHEAD = (1, 5, 25, 100)
EXTRAPOLATION = 1.2


def response_draws(draws: dict, c: int, x) -> np.ndarray:
    """(D, len(x)) revenue from channel c at weekly spend x under every draw."""
    x = np.atleast_1d(np.asarray(x, dtype=float))
    beta = np.asarray(draws["beta"])[:, c][:, None]
    lam = np.asarray(draws["lam"])[:, c][:, None]
    return beta * draws["ymax"] * np.tanh(lam * x[None, :] / (2.0 * draws["xmax"][c]))


class Curves:
    """Expected response per channel, averaged over draws once on a fine grid."""

    def __init__(self, draws: dict, upper: np.ndarray):
        self.top = np.maximum(np.asarray(upper, dtype=float), 1e-9)
        self.grid = [np.linspace(0.0, t, GRID + 1) for t in self.top]
        self.mean = [response_draws(draws, c, g).mean(axis=0) for c, g in enumerate(self.grid)]

    def value(self, c: int, x: float) -> float:
        return float(np.interp(x, self.grid[c], self.mean[c]))

    def total(self, x: np.ndarray) -> float:
        return sum(self.value(c, float(v)) for c, v in enumerate(x))


def current_split(spend: np.ndarray, weeks: int = 13) -> np.ndarray:
    return np.asarray(spend)[-weeks:].mean(axis=0)


def optimise(draws: dict, current: np.ndarray, budget: float | None = None,
             lower: np.ndarray | None = None, upper: np.ndarray | None = None,
             max_weekly: np.ndarray | None = None) -> dict:
    current = np.asarray(current, dtype=float)
    n = len(current)
    lower = 0.5 * current if lower is None else np.asarray(lower, dtype=float)
    upper = 1.5 * current if upper is None else np.asarray(upper, dtype=float)
    upper = np.maximum(upper, lower)
    requested = float(current.sum() if budget is None else budget)
    notes: list[str] = []
    b = requested
    if b < lower.sum() - 1e-9:
        b = float(lower.sum())
        notes.append("The budget is below the sum of the channel minimums, so the minimums were used.")
    elif b > upper.sum() + 1e-9:
        b = float(upper.sum())
        notes.append("The budget is above the sum of the channel maximums, so the maximums were used.")

    curves = Curves(draws, np.maximum(upper, current))
    x = lower.copy()
    remaining = b - float(x.sum())
    step = b / STEPS if b > 0 else 0.0

    # hand out the budget in small steps, each to the channel with the best return per unit
    while step > 0 and remaining > 1e-9:
        s = min(step, remaining)
        best_c, best_gain = -1, -np.inf
        for c in range(n):
            room = upper[c] - x[c]
            if room <= 1e-12:
                continue
            base = curves.value(c, x[c])
            for k in LOOKAHEAD:
                d = min(k * s, room, remaining)
                if d <= 0:
                    continue
                gain = (curves.value(c, x[c] + d) - base) / d
                if gain > best_gain:
                    best_gain, best_c = gain, c
        if best_c < 0:
            break
        d = min(s, upper[best_c] - x[best_c])
        x[best_c] += d
        remaining -= d

    # refine: move money between pairs of channels while any move helps
    delta = step
    for _ in range(12):
        improved = True
        guard = 0
        while improved and guard < 5000:
            improved = False
            guard += 1
            for i in range(n):
                for j in range(n):
                    if i == j:
                        continue
                    d = min(delta, x[i] - lower[i], upper[j] - x[j])
                    if d <= 1e-12:
                        continue
                    gain = (curves.value(j, x[j] + d) - curves.value(j, x[j])
                            + curves.value(i, x[i] - d) - curves.value(i, x[i]))
                    if gain > 1e-9:
                        x[i] -= d
                        x[j] += d
                        improved = True
        delta /= 2

    # never recommend something worse than the current split when the current split is feasible
    feasible_now = (abs(current.sum() - b) <= 1e-6 * max(b, 1.0)
                    and np.all(current >= lower - 1e-9) and np.all(current <= upper + 1e-9))
    if feasible_now and curves.total(current) > curves.total(x):
        x = current.copy()

    rec = np.stack([response_draws(draws, c, x[c])[:, 0] for c in range(n)], axis=1).sum(axis=1)
    cur = np.stack([response_draws(draws, c, current[c])[:, 0] for c in range(n)], axis=1).sum(axis=1)
    lift = rec - cur
    max_weekly = np.asarray(draws.get("max_weekly", draws["xmax"]) if max_weekly is None else max_weekly, dtype=float)
    return {
        "budget": b,
        "requested_budget": requested,
        "channels": list(draws["channels"]),
        "current": [float(v) for v in current],
        "recommended": [float(v) for v in x],
        "lower": [float(v) for v in lower],
        "upper": [float(v) for v in upper],
        "extrapolated": [bool(x[c] > EXTRAPOLATION * max_weekly[c]) for c in range(n)],
        "expected_current": float(cur.mean()),
        "expected_recommended": float(rec.mean()),
        "lift": {"mean": float(lift.mean()), "median": float(np.median(lift)),
                 "low": float(np.percentile(lift, 5)), "high": float(np.percentile(lift, 95))},
        "lift_pct": {"mean": float(lift.mean() / cur.mean() * 100) if cur.mean() > 0 else 0.0,
                     "low": float(np.percentile(lift / np.maximum(cur, 1e-9), 5) * 100),
                     "high": float(np.percentile(lift / np.maximum(cur, 1e-9), 95) * 100)},
        "prob_better": float(np.mean(lift > 0)),
        "notes": notes,
    }
