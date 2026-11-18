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


def allocate(value, lower: np.ndarray, upper: np.ndarray, budget: float, steps: int = STEPS) -> np.ndarray:
    """Hand a budget out across channels, given value(c, x) = expected response. Greedy steps with look-ahead,
    then pairwise moves until none helps. Mirror of allocate() in optimize.ts."""
    n = len(lower)
    x = np.asarray(lower, dtype=float).copy()
    remaining = budget - float(x.sum())
    step = budget / steps if budget > 0 else 0.0

    # hand out the budget in small steps, each to the channel with the best return per unit
    while step > 0 and remaining > 1e-9:
        s = min(step, remaining)
        best_c, best_gain = -1, -np.inf
        for c in range(n):
            room = upper[c] - x[c]
            if room <= 1e-12:
                continue
            base = value(c, x[c])
            for k in LOOKAHEAD:
                d = min(k * s, room, remaining)
                if d <= 0:
                    continue
                gain = (value(c, x[c] + d) - base) / d
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
                    gain = (value(j, x[j] + d) - value(j, x[j])
                            + value(i, x[i] - d) - value(i, x[i]))
                    if gain > 1e-9:
                        x[i] -= d
                        x[j] += d
                        improved = True
        delta /= 2
    return x


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
    x = allocate(curves.value, lower, upper, b)

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


# ------------------------------------------------------------------ breakdown: channels made of items

N_CHANNEL_GRID = 41
INNER_STEPS = 200
SHARE_SLACK = 0.25  # an item's share of its channel may move by this much, relative
PROB_GATE = 0.8  # re-split a channel only when the draws say the re-split helps at least this often


def optimise_items(draws: dict, current: np.ndarray, mode: str = "keep", budget: float | None = None,
                   channel_lower: np.ndarray | None = None, channel_upper: np.ndarray | None = None,
                   slack: float = SHARE_SLACK, gate: float = PROB_GATE) -> dict:
    """Two-level optimiser. `draws` is item level: channels are items, with draws["groups"] =
    {"channel_names": [...], "channel_of": [...]}. Money moves between channels first, then (mode "resplit")
    between a channel's items, only in channels where the re-split helps in at least `gate` of the draws.
    Mirror of optimiseItems() in optimize.ts."""
    current = np.asarray(current, dtype=float)
    groups = draws["groups"]
    chan = np.asarray(groups["channel_of"], dtype=int)
    n_items = len(current)
    n_chan = len(groups["channel_names"])
    members = [np.where(chan == c)[0] for c in range(n_chan)]
    cur_c = np.array([current[m].sum() for m in members])
    share = np.array([current[i] / cur_c[chan[i]] if cur_c[chan[i]] > 0 else 1.0 / len(members[chan[i]]) for i in range(n_items)])
    lower_c = 0.5 * cur_c if channel_lower is None else np.asarray(channel_lower, dtype=float)
    upper_c = 1.5 * cur_c if channel_upper is None else np.maximum(np.asarray(channel_upper, dtype=float), lower_c)
    requested = float(cur_c.sum() if budget is None else budget)
    notes: list[str] = []
    b = requested
    if b < lower_c.sum() - 1e-9:
        b = float(lower_c.sum())
        notes.append("The budget is below the sum of the channel minimums, so the minimums were used.")
    elif b > upper_c.sum() + 1e-9:
        b = float(upper_c.sum())
        notes.append("The budget is above the sum of the channel maximums, so the maximums were used.")

    tops = np.maximum(upper_c[chan] * share * (1 + slack), current * 1.5)
    curves = Curves(draws, tops)

    def split_inside(c: int, x_total: float, steps: int) -> np.ndarray:
        m = members[c]
        lo = (1 - slack) * share[m] * x_total
        hi = np.minimum((1 + slack) * share[m] * x_total, tops[m])
        hi = np.maximum(hi, lo)
        return allocate(lambda k, v: curves.value(int(m[k]), v), lo, hi, x_total, steps)

    # decide per channel whether re-splitting is decisive: the gain over the current mix, at today's spend
    use_resplit = np.zeros(n_chan, dtype=bool)
    p_helps = np.zeros(n_chan)
    if mode == "resplit":
        for c in range(n_chan):
            m = members[c]
            if len(m) < 2 or cur_c[c] <= 0:
                continue
            best = split_inside(c, cur_c[c], INNER_STEPS)
            rec = sum(response_draws(draws, int(i), best[k])[:, 0] for k, i in enumerate(m))
            cur = sum(response_draws(draws, int(i), current[i])[:, 0] for i in m)
            p_helps[c] = float(np.mean(rec - cur > 0))
            use_resplit[c] = p_helps[c] >= gate

    # each channel's expected response as a function of its total, on a grid
    grids, values = [], []
    for c in range(n_chan):
        gx = np.linspace(0.0, max(upper_c[c], 1e-9), N_CHANNEL_GRID)
        gv = np.zeros(N_CHANNEL_GRID)
        for k, xv in enumerate(gx):
            if use_resplit[c] and xv > 0:
                part = split_inside(c, xv, INNER_STEPS)
                gv[k] = sum(curves.value(int(i), part[j]) for j, i in enumerate(members[c]))
            else:
                gv[k] = sum(curves.value(int(i), xv * share[i]) for i in members[c])
        grids.append(gx)
        values.append(gv)

    xc = allocate(lambda c, v: float(np.interp(v, grids[c], values[c])), lower_c, upper_c, b)

    x = np.zeros(n_items)
    keep_mix = np.zeros(n_items)
    for c in range(n_chan):
        m = members[c]
        keep_mix[m] = xc[c] * share[m]
        x[m] = split_inside(c, xc[c], 400) if use_resplit[c] and xc[c] > 0 else keep_mix[m]

    feasible_now = (abs(cur_c.sum() - b) <= 1e-6 * max(b, 1.0) and np.all(cur_c >= lower_c - 1e-9) and np.all(cur_c <= upper_c + 1e-9))
    total = lambda v: sum(curves.value(i, float(v[i])) for i in range(n_items))  # noqa: E731
    if feasible_now and total(current) > total(x):
        x, keep_mix = current.copy(), current.copy()

    def draws_of(v: np.ndarray) -> np.ndarray:
        return np.stack([response_draws(draws, i, v[i])[:, 0] for i in range(n_items)], axis=1).sum(axis=1)

    cur_d, rec_d, keep_d = draws_of(current), draws_of(x), draws_of(keep_mix)
    lift = rec_d - cur_d
    between = keep_d - cur_d
    max_weekly = np.asarray(draws.get("max_weekly", draws["xmax"]), dtype=float)
    item_lower, item_upper = x.copy(), x.copy()
    for c in range(n_chan):
        if use_resplit[c]:
            m = members[c]
            item_lower[m] = (1 - slack) * share[m] * xc[c]
            item_upper[m] = (1 + slack) * share[m] * xc[c]
    by_channel = []
    for c in range(n_chan):
        m = members[c]
        by_channel.append({
            "name": groups["channel_names"][c], "current": float(cur_c[c]), "recommended": float(x[m].sum()),
            "lower": float(lower_c[c]), "upper": float(upper_c[c]), "items_resplit": bool(use_resplit[c]),
            "p_resplit_helps": float(p_helps[c]) if len(m) > 1 and mode == "resplit" else None,
        })
        if mode == "resplit" and len(m) > 1 and not use_resplit[c]:
            notes.append(f"{groups['channel_names'][c]}: the data cannot tell its items apart well enough to move money between "
                         f"them (the re-split helps in {p_helps[c] * 100:.0f}% of draws, under {gate * 100:.0f}%). Test before moving.")
    return {
        "budget": b, "requested_budget": requested, "channels": list(draws["channels"]),
        "current": [float(v) for v in current], "recommended": [float(v) for v in x],
        "lower": [float(v) for v in item_lower],
        "upper": [float(v) for v in item_upper],
        "extrapolated": [bool(x[i] > EXTRAPOLATION * max_weekly[i]) for i in range(n_items)],
        "expected_current": float(cur_d.mean()), "expected_recommended": float(rec_d.mean()),
        "lift": {"mean": float(lift.mean()), "median": float(np.median(lift)),
                 "low": float(np.percentile(lift, 5)), "high": float(np.percentile(lift, 95))},
        "lift_pct": {"mean": float(lift.mean() / cur_d.mean() * 100) if cur_d.mean() > 0 else 0.0,
                     "low": float(np.percentile(lift / np.maximum(cur_d, 1e-9), 5) * 100),
                     "high": float(np.percentile(lift / np.maximum(cur_d, 1e-9), 95) * 100)},
        "prob_better": float(np.mean(lift > 0)),
        "notes": notes,
        "mode": mode,
        "by_channel": by_channel,
        "lift_between": float(between.mean()),
        "lift_within": float((lift - between).mean()),
    }
