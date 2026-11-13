"""Turn a fit into what the results screen needs: thinned draws, ROI, contributions, curves, fit quality."""

from __future__ import annotations

import math

import numpy as np

from . import model as M
from .model import Design, Fit
from .optimise import current_split, optimise

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
    beta = np.abs(rng.normal(0, 2.0 * design.share[c], n))
    alpha = rng.beta(a, b, n)
    lam = rng.gamma(3.0, 1.0, n)
    x = design.xs[: design.n_fit, c]
    spend = float(design.spend[: design.n_fit, c].sum())
    out = np.empty(n)
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


def data_verdict(shrink: float) -> str:
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
    n = design.n_fit
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
    channels = []
    curves = []
    for c, name in enumerate(design.channels):
        beta, lam, alpha = post["beta"][:, c], post["lam"][:, c], post["alpha"][:, c]
        xmax = design.xmax[c]
        roi_c = roi[:, c]
        roi_iv = interval(roi_c)
        # marginal ROI: revenue from one more unit of steady weekly spend at the current level
        u = lam * current[c] / (2 * xmax)
        mroi = beta * design.ymax * lam / (2 * xmax) / np.cosh(u) ** 2
        half_life = np.log(0.5) / np.log(np.clip(alpha, 1e-6, 1 - 1e-6))
        saturation = xmax * 2 * math.atanh(0.9) / lam  # weekly spend at 90% of the maximum effect
        lo_t, med_t, hi_t = q(contrib[:, :, c])

        prior = prior_roi_draws(design, priors, c, 2000, rng)
        p_lo, p_med, p_hi = np.percentile(prior, [5, 50, 95])
        shrink = float(1 - (roi_iv["high"] - roi_iv["low"]) / max(p_hi - p_lo, 1e-12))
        g_lo = max(min(p_lo, roi_iv["low"]) * 0.5, 1e-3)
        g_hi = max(p_hi, roi_iv["high"]) * 1.6
        grid = np.exp(np.linspace(math.log(g_lo), math.log(g_hi), N_DENSITY))
        user = priors.get(name, {})
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
                "verdict": data_verdict(shrink),
                "conflict": conflict,
                "grid": r(grid, 4),
                "prior_density": r(density(prior, grid), 3),
                "posterior_density": r(density(roi_c, grid), 3),
            },
        })

        top = max(1.5 * float(design.spend[:, c].max()), 1.0)
        xs = np.linspace(0, top, N_CURVE)
        resp = beta[:, None] * design.ymax * np.tanh(lam[:, None] * xs[None, :] / (2 * xmax))
        c_lo, c_med, c_hi = q(resp)
        curves.append({"name": name, "spend": r(xs, 6), "median": r(c_med, 5), "low": r(c_lo, 5), "high": r(c_hi, 5),
                       "current": float(current[c]), "max_weekly": float(design.spend[:, c].max())})

    media = total_contrib.sum(axis=1) / revenue_total
    draws = make_draws(design, post)
    plan_draws = {**draws, "beta": post["beta"], "lam": post["lam"], "xmax": design.xmax}
    default_plan = optimise(plan_draws, current)

    return {
        "diagnostics": fit.diagnostics,
        "fit": {**fit_out, "media_share": interval(media), "weeks": design.T,
                "channels": design.channels, "controls": design.control_names,
                "seasonality": bool(design.fourier.shape[1])},
        "channels": channels,
        "curves": curves,
        "default_plan": default_plan,
        "draws": draws,
    }
