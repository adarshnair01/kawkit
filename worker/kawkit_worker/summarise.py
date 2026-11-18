"""Turn a fit into what the results screen needs: thinned draws, ROI, contributions, curves, fit quality."""

from __future__ import annotations

import math

import numpy as np

from . import model as M
from .model import Design, Fit
from .optimise import current_split, optimise, optimise_items

KEEP = 500
N_CURVE = 40
N_DENSITY = 60


def q(a: np.ndarray, axis=0) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    lo, med, hi = np.percentile(a, [5, 50, 95], axis=axis)
    return lo, med, hi


def interval(a: np.ndarray) -> dict:
    lo, med, hi = q(a)
    return {"median": float(med), "low": float(lo), "high": float(hi)}


def r(x, digits: int = 4):
    """Round arrays for compact JSON."""
    return [float(f"{v:.{digits}g}") for v in np.asarray(x, dtype=float).ravel()]


def thin(post: dict[str, np.ndarray], keep: int = KEEP) -> dict[str, np.ndarray]:
    n = len(post["sigma"])
    idx = np.linspace(0, n - 1, min(keep, n)).round().astype(int)
    return {k: v[idx] for k, v in post.items()}


def is_hier(design: Design) -> bool:
    return getattr(design, "items", None) is not None


def predict(design: Design, post: dict[str, np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Return (mu, contributions) for all rows of the design, in revenue units.

    mu: (D, T); contributions: (D, T, C).
    """
    d = len(post["sigma"])
    mu = post["intercept"][:, None] + post["gamma"][:, None] * design.trend[None, :]
    if "fourier" in post:
        mu = mu + post["fourier"] @ design.fourier.T
    if "delta" in post:
        mu = mu + post["delta"] @ design.zs.T
    if is_hier(design):
        from . import hier as H

        ic = H.item_contrib(design, post, max_draws=d)  # (D, T, I)
        contrib = np.stack([ic[:, :, design.items.channel == c].sum(axis=2) for c in range(len(design.channels))], axis=2)
        mu = mu + contrib.sum(axis=2)
        return mu * design.ymax, contrib * design.ymax
    contrib = np.empty((d, design.T, len(design.channels)))
    for i in range(d):
        ad = M.adstock_np(design.xs, post["alpha"][i])
        contrib[i] = post["beta"][i] * M.saturation_np(ad, post["lam"][i])
    mu = mu + contrib.sum(axis=2)
    return mu * design.ymax, contrib * design.ymax


def mape(actual: np.ndarray, predicted: np.ndarray) -> float:
    ok = actual != 0
    return float(np.mean(np.abs((actual[ok] - predicted[ok]) / actual[ok])) * 100)


def prior_roi_draws(design: Design, priors: dict, c: int, n: int, rng: np.random.Generator) -> np.ndarray:
    """ROI implied by the prior for channel c: the user's LogNormal if given, else simulated from defaults."""
    p = priors.get(design.channels[c], {})
    if "roi_low" in p:
        m, s = M.roi_prior_params(p["roi_low"], p["roi_high"])
        return rng.lognormal(m, s, n)
    a, b = M.carryover_prior_params(p.get("carryover_weeks"))
    beta = np.abs(rng.normal(0, design.beta_scale[c], n))
    alpha = rng.beta(a, b, n)
    lam = rng.gamma(3.0, 1.0, n)
    spend = float(design.spend[: design.n_fit, c].sum())
    out = np.empty(n)
    if is_hier(design):  # the channel's items together, each at the typical item scale
        x = design.xs_item[: design.n_fit][:, design.items.channel == c]
        for i in range(n):
            out[i] = beta[i] * M.saturation_np(M.adstock_np(x, alpha[i]), lam[i]).sum() * design.ymax / spend
        return out
    x = design.xs[: design.n_fit, c]
    for i in range(n):
        out[i] = beta[i] * M.saturation_np(M.adstock_np(x, alpha[i]), lam[i]).sum() * design.ymax / spend
    return out


def density(samples: np.ndarray, grid: np.ndarray) -> np.ndarray:
    """Gaussian kernel density in log space, normalised to a peak of 1 for plotting."""
    s = np.log(np.maximum(samples, 1e-9))
    g = np.log(np.maximum(grid, 1e-9))
    sd = float(np.std(s))
    bw = max(1.06 * sd * len(s) ** (-0.2), 1e-3)
    dens = np.exp(-0.5 * ((g[:, None] - s[None, :]) / bw) ** 2).sum(axis=1)
    peak = dens.max()
    return dens / peak if peak > 0 else dens


def data_verdict(shrink: float, moved: bool = False) -> str:
    """How far the data moved the belief: by narrowing it, or by landing outside the prior's range."""
    if moved:
        return "The data overruled the starting assumption"
    if shrink > 0.5:
        return "The data was decisive"
    if shrink >= 0.2:
        return "The data refined the belief"
    return "This mostly reflects the prior"


def confidence_label(low: float, median: float, high: float) -> str:
    if median <= 0:
        return "low"
    rel = (high - low) / median
    return "high" if rel < 0.5 else "medium" if rel <= 1 else "low"


def channel_response(design: Design, post: dict[str, np.ndarray], c: int, xs: np.ndarray, current_items=None) -> np.ndarray:
    """(D, len(xs)) weekly revenue from channel c at steady weekly spend xs, in revenue units.
    With a breakdown the channel's spend is spread over its items in today's proportions."""
    xs = np.atleast_1d(np.asarray(xs, dtype=float))
    xmax = design.xmax[c]
    if not is_hier(design):
        return post["beta"][:, c][:, None] * design.ymax * np.tanh(post["lam"][:, c][:, None] * xs[None, :] / (2 * xmax))
    m = np.where(design.items.channel == c)[0]
    cur = np.asarray(current_items)[m]
    sh = cur / cur.sum() if cur.sum() > 0 else np.full(len(m), 1.0 / len(m))
    w = np.exp(post["logw"][:, m])  # (D, k)
    out = np.zeros((len(post["sigma"]), len(xs)))
    for k in range(len(m)):
        out += (post["beta"][:, c] * w[:, k])[:, None] * design.ymax * np.tanh(post["lam"][:, c][:, None] * xs[None, :] * sh[k] / (2 * xmax))
    return out


def widen_logw(post: dict[str, np.ndarray], k: float) -> dict[str, np.ndarray]:
    """Widen the spread of item scales around each item's median by k (see hier.ITEM_RANGE_WIDEN)."""
    if k == 1.0 or "logw" not in post:
        return post
    med = np.median(post["logw"], axis=0, keepdims=True)
    return {**post, "logw": med + k * (post["logw"] - med)}


def make_draws(design: Design, post: dict[str, np.ndarray]) -> dict:
    """The file the browser optimiser reads."""
    return {
        "channels": design.channels,
        "ymax": design.ymax,
        "xmax": [float(v) for v in design.xmax],
        "max_weekly": [float(v) for v in design.spend.max(axis=0)],
        "current": [float(v) for v in current_split(design.spend)],
        "beta": [r(row, 5) for row in post["beta"]],
        "lam": [r(row, 5) for row in post["lam"]],
        "alpha": [r(row, 5) for row in post["alpha"]],
    }


def summarise(fit: Fit, holdout_mape: float | None, seed: int) -> dict:
    design, priors = fit.design, fit.priors
    post = thin(fit.post)
    rng = np.random.default_rng(seed)
    mu, contrib = predict(design, post)
    y = design.y

    # ---- fit quality
    fitted = np.median(mu, axis=0)
    noise = rng.normal(0, 1, mu.shape) * post["sigma"][:, None] * design.ymax
    band_lo, _, band_hi = q(mu + noise)
    resid = y - mu.mean(axis=0)
    r2 = float(1 - resid.var() / y.var())
    baseline = np.median(mu - contrib.sum(axis=2), axis=0)
    fit_out = {
        "r2": round(r2, 4),
        "mape": round(mape(y, mu.mean(axis=0)), 3),
        "holdout_mape": None if holdout_mape is None else round(holdout_mape, 3),
        "holdout_weeks": 13 if holdout_mape is not None else 0,
        "coverage90": round(float(np.mean((y >= band_lo) & (y <= band_hi))), 3),
        "dates": design.dates,
        "actual": r(y, 7),
        "fitted": r(fitted, 6),
        "band_low": r(band_lo, 6),
        "band_high": r(band_hi, 6),
        "baseline": r(baseline, 6),
    }

    # ---- channels
    total_spend = design.spend.sum(axis=0)
    total_contrib = contrib.sum(axis=1)  # (D, C)
    roi = total_contrib / total_spend
    revenue_total = float(y.sum())
    current = current_split(design.spend)
    hier = is_hier(design)
    cur_items = current_split(design.items.spend) if hier else None
    channels = []
    curves = []
    for c, name in enumerate(design.channels):
        beta, lam, alpha = post["beta"][:, c], post["lam"][:, c], post["alpha"][:, c]
        xmax = design.xmax[c]
        roi_c = roi[:, c]
        roi_iv = interval(roi_c)
        # marginal ROI: revenue from one more unit of steady weekly spend at the current level
        if hier:
            eps = max(xmax / 200.0, 1e-9)
            r_hi = channel_response(design, post, c, [current[c] + eps], cur_items)[:, 0]
            r_lo = channel_response(design, post, c, [max(current[c] - eps, 0.0)], cur_items)[:, 0]
            mroi = (r_hi - r_lo) / (current[c] + eps - max(current[c] - eps, 0.0))
        else:
            u = lam * current[c] / (2 * xmax)
            mroi = beta * design.ymax * lam / (2 * xmax) / np.cosh(u) ** 2
        half_life = np.log(0.5) / np.log(np.clip(alpha, 1e-6, 1 - 1e-6))
        if hier:  # weekly spend at 90% of the channel's maximum effect, found on a grid
            gx = np.linspace(0.0, 25.0 * xmax, 600)
            gr = channel_response(design, post, c, gx, cur_items)
            top = (post["beta"][:, c] * np.exp(post["logw"][:, design.items.channel == c]).sum(axis=1)) * design.ymax
            saturation = gx[np.minimum((gr >= 0.9 * top[:, None]).argmax(axis=1), len(gx) - 1)]
        else:
            saturation = xmax * 2 * math.atanh(0.9) / lam  # weekly spend at 90% of the maximum effect
        lo_t, med_t, hi_t = q(contrib[:, :, c])

        prior = prior_roi_draws(design, priors, c, 2000, rng)
        p_lo, p_med, p_hi = np.percentile(prior, [5, 50, 95])
        shrink = float(1 - (roi_iv["high"] - roi_iv["low"]) / max(p_hi - p_lo, 1e-12))
        g_lo = max(min(p_lo, roi_iv["low"]) * 0.5, 1e-3)
        g_hi = max(p_hi, roi_iv["high"]) * 1.6
        grid = np.exp(np.linspace(math.log(g_lo), math.log(g_hi), N_DENSITY))
        user = priors.get(name, {})
        moved = bool(roi_iv["median"] < p_lo or roi_iv["median"] > p_hi)
        conflict = bool("roi_low" in user and (roi_iv["median"] < p_lo or roi_iv["median"] > p_hi))

        channels.append({
            "name": name,
            "total_spend": float(total_spend[c]),
            "current_weekly": float(current[c]),
            "max_weekly": float(design.spend[:, c].max()),
            "contribution": {**interval(total_contrib[:, c]),
                             "share": interval(total_contrib[:, c] / revenue_total)},
            "contribution_series": {"median": r(med_t, 5), "low": r(lo_t, 5), "high": r(hi_t, 5)},
            "roi": {**roi_iv, "p_above_1": float(np.mean(roi_c > 1)),
                    "confidence": confidence_label(roi_iv["low"], roi_iv["median"], roi_iv["high"])},
            "mroi": interval(mroi),
            "half_life_weeks": interval(half_life),
            "saturation_spend": interval(saturation),
            "prior": {
                "source": "yours" if "roi_low" in user else "default",
                "roi": {"median": float(p_med), "low": float(p_lo), "high": float(p_hi)},
                "carryover_weeks": user.get("carryover_weeks"),
                "note": user.get("note"),
                "shrink": round(shrink, 3),
                "moved": moved,
                "informed": bool(moved or shrink >= 0.2),
                "verdict": data_verdict(shrink, moved),
                "conflict": conflict,
                "grid": r(grid, 4),
                "prior_density": r(density(prior, grid), 3),
                "posterior_density": r(density(roi_c, grid), 3),
            },
        })

        top = max(1.5 * float(design.spend[:, c].max()), 1.0)
        xs = np.linspace(0, top, N_CURVE)
        resp = channel_response(design, post, c, xs, cur_items)
        c_lo, c_med, c_hi = q(resp)
        curves.append({"name": name, "spend": r(xs, 6), "median": r(c_med, 5), "low": r(c_lo, 5), "high": r(c_hi, 5),
                       "current": float(current[c]), "max_weekly": float(design.spend[:, c].max())})

    # baseline drivers: what each control adds in the weeks it is highest, against the weeks it is lowest
    drivers = []
    if "delta" in post and design.zs.shape[1]:
        span = design.zs.max(axis=0) - design.zs.min(axis=0)
        for k, name in enumerate(design.control_names):
            effect = post["delta"][:, k] * span[k] * design.ymax
            total = (post["delta"][:, k][:, None] * (design.zs[:, k] - design.zs[:, k].min())[None, :]).sum(axis=1) * design.ymax
            raw = design.controls_raw[:, k]
            drivers.append({
                "name": name, "effect": interval(effect), "p_positive": float(np.mean(effect > 0)),
                "share": interval(total / revenue_total),
                "binary": bool(set(np.unique(raw)) <= {0.0, 1.0}), "active_weeks": int(np.sum(raw != raw.min())),
                "low_value": float(raw.min()), "high_value": float(raw.max()),
            })

    media = total_contrib.sum(axis=1) / revenue_total
    breakdown = None
    default_plan_resplit = None
    if hier:
        from . import hier as H

        draws = H.item_draws(design, post, cur_items, H.ITEM_RANGE_WIDEN)
        plan_draws = {**draws, "beta": np.asarray(draws["beta"]), "lam": np.asarray(draws["lam"]), "xmax": np.asarray(draws["xmax"])}
        default_plan = optimise_items(plan_draws, cur_items, "keep")
        default_plan_resplit = optimise_items(plan_draws, cur_items, "resplit")
        breakdown = H.breakdown_results(design, post, H.ITEM_RANGE_WIDEN)
    else:
        draws = make_draws(design, post)
        plan_draws = {**draws, "beta": post["beta"], "lam": post["lam"], "xmax": design.xmax}
        default_plan = optimise(plan_draws, current)

    return {
        "diagnostics": fit.diagnostics,
        "fit": {**fit_out, "media_share": interval(media), "weeks": design.T,
                "channels": design.channels, "controls": design.control_names,
                "seasonality": bool(design.fourier.shape[1]), "drivers": drivers},
        "channels": channels,
        "curves": curves,
        "default_plan": default_plan,
        "draws": draws,
        **({"breakdown": breakdown, "default_plan_resplit": default_plan_resplit} if hier else {}),
    }
