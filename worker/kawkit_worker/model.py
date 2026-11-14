"""The Bayesian marketing mix model.

    y_t ~ Normal(b0 + g*trend_t + seasonality_t + sum_j d_j z_jt + sum_c beta_c * S(A_ct; lam_c), sigma)
    A_ct = sum_{l=0..7} alpha_c^l x_c,t-l / sum_l alpha_c^l      (geometric adstock, normalised)
    S(A; lam) = (1 - exp(-lam A)) / (1 + exp(-lam A))             (logistic saturation)

These are PyMC-Marketing's geometric adstock (normalised, l_max 8) and logistic saturation; the
tests check parity against pymc_marketing.mmm.transformers. They are written out here so the same
expressions exist in numpy (for summaries and the optimiser) and in the sampled graph.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field
from typing import Callable

import numpy as np

from .validate import Dataset

L_MAX = 8  # weeks of carry-over
SEASON_MIN_WEEKS = 78
PERIOD = 52.0
N_FOURIER = 2
Z90 = 1.6448536269514722


class ModelError(Exception):
    """A problem the user can act on; the message is shown as the run's failure reason."""


class Cancelled(Exception):
    pass


# ------------------------------------------------------------------ numpy forward pieces

def adstock_np(x: np.ndarray, alpha) -> np.ndarray:
    """Normalised geometric adstock along the first axis. x: (T,) or (T, C); alpha: scalar or (C,)."""
    out = np.zeros_like(x, dtype=float)
    norm = np.zeros_like(np.asarray(alpha, dtype=float))
    for lag in range(L_MAX):
        w = np.asarray(alpha, dtype=float) ** lag
        shifted = np.zeros_like(x, dtype=float)
        shifted[lag:] = x[: len(x) - lag]
        out += w * shifted
        norm = norm + w
    return out / norm


def saturation_np(a: np.ndarray, lam) -> np.ndarray:
    return np.tanh(np.asarray(lam) * a / 2.0)  # identical to (1-e^-la)/(1+e^-la)


def lag_tensor(xs: np.ndarray) -> np.ndarray:
    """(T, C) -> (L_MAX, T, C) with xs shifted by each lag."""
    t = xs.shape[0]
    out = np.zeros((L_MAX, *xs.shape))
    for lag in range(L_MAX):
        out[lag, lag:] = xs[: t - lag]
    return out


# ------------------------------------------------------------------ priors

def roi_prior_params(low: float, high: float) -> tuple[float, float]:
    """A 90% range [low, high] -> LogNormal(mu, sigma)."""
    if not (low > 0 and high > low):
        raise ModelError("An ROI range needs 0 < low < high.")
    mu = (math.log(low) + math.log(high)) / 2
    sigma = (math.log(high) - math.log(low)) / (2 * Z90)
    return mu, sigma


def carryover_prior_params(weeks: float | None) -> tuple[float, float]:
    """'Effect lasts about N weeks' -> Beta with mean 0.1^(1/N) (10% left after N weeks), strength 20."""
    if weeks is None:
        return 1.0, 3.0
    if not (0.5 <= weeks <= 26):
        raise ModelError("Carry-over must be between 0.5 and 26 weeks.")
    mean = min(max(0.1 ** (1.0 / weeks), 0.02), 0.98)
    return mean * 20.0, (1 - mean) * 20.0


def clean_priors(priors: dict | None, channels: list[str]) -> dict[str, dict]:
    """Keep only well-formed entries for channels in the data."""
    out: dict[str, dict] = {}
    for ch in channels:
        p = (priors or {}).get(ch) or {}
        entry: dict = {}
        lo, hi = p.get("roi_low"), p.get("roi_high")
        if lo is not None and hi is not None:
            lo, hi = float(lo), float(hi)
            roi_prior_params(lo, hi)
            entry["roi_low"], entry["roi_high"] = lo, hi
        elif lo is not None or hi is not None:
            raise ModelError(f"Channel '{ch}': give both ends of the ROI range, or neither.")
        if p.get("carryover_weeks") is not None:
            w = float(p["carryover_weeks"])
            carryover_prior_params(w)
            entry["carryover_weeks"] = w
        if p.get("note"):
            entry["note"] = str(p["note"])[:200]
        out[ch] = entry
    return out


# ------------------------------------------------------------------ design

@dataclass
class Design:
    """Scaled arrays for a dataset; n_fit rows are used for fitting, the rest held out."""

    channels: list[str]
    control_names: list[str]
    dates: list[str]
    y: np.ndarray
    spend: np.ndarray
    ymax: float
    xmax: np.ndarray
    xs: np.ndarray  # (T, C) spend / xmax
    zs: np.ndarray  # (T, K) standardised controls
    trend: np.ndarray  # (T,)
    fourier: np.ndarray  # (T, 2*N_FOURIER) or (T, 0)
    share: np.ndarray  # (C,) share of total spend
    n_fit: int

    @property
    def T(self) -> int:
        return len(self.y)


def build_design(ds: Dataset, holdout: int = 0) -> Design:
    t_all = len(ds.y)
    n_fit = t_all - holdout
    y_fit, x_fit = ds.y[:n_fit], ds.spend[:n_fit]
    ymax = float(y_fit.max())
    xmax = x_fit.max(axis=0)
    xmax = np.where(xmax > 0, xmax, 1.0)
    if ds.controls.shape[1]:
        mu, sd = ds.controls[:n_fit].mean(axis=0), ds.controls[:n_fit].std(axis=0)
        zs = (ds.controls - mu) / np.where(sd > 0, sd, 1.0)
    else:
        zs = np.zeros((t_all, 0))
    t = np.arange(t_all, dtype=float)
    trend = t / max(n_fit - 1, 1)
    if n_fit >= SEASON_MIN_WEEKS:
        fourier = np.stack(
            [f(2 * np.pi * k * t / PERIOD) for k in range(1, N_FOURIER + 1) for f in (np.sin, np.cos)], axis=1
        )
    else:
        fourier = np.zeros((t_all, 0))
    total = x_fit.sum(axis=0)
    return Design(
        channels=ds.channels, control_names=ds.control_names, dates=ds.dates, y=ds.y, spend=ds.spend,
        ymax=ymax, xmax=xmax, xs=ds.spend / xmax, zs=zs, trend=trend, fourier=fourier,
        share=total / total.sum(), n_fit=n_fit,
    )


def check_priors_plausible(design: Design, priors: dict[str, dict]) -> dict:
    """Prior predictive sanity check on the user's ROI ranges: what share of revenue do they imply?"""
    revenue = float(design.y[: design.n_fit].sum())
    low = mid = high = 0.0
    for c, ch in enumerate(design.channels):
        p = priors.get(ch, {})
        if "roi_low" in p:
            spend = float(design.spend[: design.n_fit, c].sum())
            low += p["roi_low"] * spend
            high += p["roi_high"] * spend
            mid += math.sqrt(p["roi_low"] * p["roi_high"]) * spend
    out = {"media_share_low": low / revenue, "media_share_mid": mid / revenue, "media_share_high": high / revenue}
    if low / revenue > 1.0:
        raise ModelError(
            "Your ROI ranges are impossible for this data: even at their low ends, the channels would have "
            f"generated {low / revenue * 100:.0f}% of all revenue. Lower the ROI ranges and submit again."
        )
    return out


# ------------------------------------------------------------------ fit

@dataclass
class Fit:
    design: Design
    priors: dict[str, dict]
    post: dict[str, np.ndarray]  # flattened draws: name -> (D, ...)
    diagnostics: dict = field(default_factory=dict)


PARAMS = ["intercept", "gamma", "fourier", "delta", "beta", "alpha", "lam", "sigma"]


def build_model(design: Design, priors: dict[str, dict]):
    import pymc as pm
    import pytensor.tensor as pt

    n = design.n_fit
    C = len(design.channels)
    K = design.zs.shape[1]
    F = design.fourier.shape[1]
    lags = lag_tensor(design.xs[:n])  # (L, T, C)
    y = design.y[:n] / design.ymax

    a = np.ones(C)
    b = np.full(C, 3.0)
    for c, ch in enumerate(design.channels):
        if "carryover_weeks" in priors.get(ch, {}):
            a[c], b[c] = carryover_prior_params(priors[ch]["carryover_weeks"])

    with pm.Model() as model:
        intercept = pm.Normal("intercept", 0.0, 2.0)
        gamma = pm.Normal("gamma", 0.0, 2.0)
        mu = intercept + gamma * design.trend[:n]
        if F:
            fourier = pm.Normal("fourier", 0.0, 2.0, shape=F)
            mu = mu + pt.dot(design.fourier[:n], fourier)
        # Sales without any media cannot be negative: penalise weeks where the baseline (intercept,
        # trend and seasonality) dips below zero, as a tight half-normal on the negative part.
        pm.Potential("baseline_not_negative", -0.5 * pt.sum((pt.minimum(mu, 0.0) / 0.01) ** 2))
        if K:
            delta = pm.Normal("delta", 0.0, 2.0, shape=K)
            mu = mu + pt.dot(design.zs[:n], delta)
        beta = pm.HalfNormal("beta", sigma=2.0 * design.share, shape=C)
        alpha = pm.Beta("alpha", alpha=a, beta=b, shape=C)
        lam = pm.Gamma("lam", alpha=3.0, beta=1.0, shape=C)
        sigma = pm.HalfNormal("sigma", 2.0)

        powers = pt.stack([alpha**lag for lag in range(L_MAX)], axis=0)  # (L, C)
        adstock = (lags * powers[:, None, :]).sum(axis=0) / powers.sum(axis=0)  # (T, C)
        contribution = beta * pt.tanh(lam * adstock / 2.0)  # (T, C), scaled revenue
        mu = mu + contribution.sum(axis=1)

        # user ROI beliefs: a LogNormal on the channel's implied ROI (total contribution / total spend)
        total_spend = design.spend[:n].sum(axis=0)
        for c, ch in enumerate(design.channels):
            p = priors.get(ch, {})
            if "roi_low" in p:
                m, s = roi_prior_params(p["roi_low"], p["roi_high"])
                roi = contribution[:, c].sum() * design.ymax / total_spend[c]
                pm.Potential(f"roi_prior_{c}", pm.logp(pm.LogNormal.dist(mu=m, sigma=s), roi))

        pm.Normal("y", mu=mu, sigma=sigma, observed=y)
    return model


def _flatten(trace, names: list[str]) -> dict[str, np.ndarray]:
    post = trace["posterior"] if "posterior" in trace.children else trace.posterior
    out = {}
    for name in names:
        if name in post:
            v = np.asarray(post[name].values)  # (chain, draw, ...)
            out[name] = v.reshape(v.shape[0] * v.shape[1], *v.shape[2:])
    return out


def _chains(trace, name: str) -> np.ndarray:
    post = trace["posterior"] if "posterior" in trace.children else trace.posterior
    return np.asarray(post[name].values)


def rhat_ess(x: np.ndarray) -> tuple[float, float]:
    """Rank-normalised split R-hat and bulk ESS for one scalar parameter, x: (chains, draws).

    Follows Vehtari et al. (2021); kept local so results do not depend on ArviZ's changing API.
    """
    from scipy import stats

    m, n = x.shape
    half = n // 2
    split = np.concatenate([x[:, :half], x[:, half : 2 * half]], axis=0)

    def rank_normalise(v: np.ndarray) -> np.ndarray:
        r = stats.rankdata(v, method="average").reshape(v.shape)
        return stats.norm.ppf((r - 0.375) / (v.size + 0.25))

    def _rhat(v: np.ndarray) -> float:
        n_ = v.shape[1]
        w = v.var(axis=1, ddof=1).mean()
        b = n_ * v.mean(axis=1).var(ddof=1)
        if w == 0:
            return 1.0
        return float(np.sqrt(((n_ - 1) / n_ * w + b / n_) / w))

    def _ess(v: np.ndarray) -> float:
        m_, n_ = v.shape
        centred = v - v.mean(axis=1, keepdims=True)
        size = 2 * n_
        f = np.fft.rfft(centred, n=size, axis=1)
        acov = np.fft.irfft(f * np.conj(f), n=size, axis=1)[:, :n_] / n_
        w = (acov[:, 0] * n_ / (n_ - 1)).mean()
        b_over_n = v.mean(axis=1).var(ddof=1) if m_ > 1 else 0.0
        var_plus = (n_ - 1) / n_ * w + b_over_n
        if var_plus == 0:
            return float(m_ * n_)
        rho = 1 - (w - acov.mean(axis=0) * n_ / (n_ - 1)) / var_plus
        rho[0] = 1.0
        # Geyer's initial monotone positive sequence
        tau = -1.0
        prev = np.inf
        t_ = 0
        while t_ + 1 < n_:
            pair = rho[t_] + rho[t_ + 1]
            if pair < 0:
                break
            pair = min(pair, prev)
            tau += 2 * pair
            prev = pair
            t_ += 2
        return float(m_ * n_ / max(tau, 1.0 / math.log10(m_ * n_)))

    z = rank_normalise(split)
    folded = rank_normalise(np.abs(split - np.median(split)))
    return max(_rhat(z), _rhat(folded)), _ess(z)


def diagnose(trace, names: list[str]) -> dict:
    post = trace["posterior"] if "posterior" in trace.children else trace.posterior
    worst_rhat, worst_ess, worst_name = 1.0, float("inf"), ""
    for name in names:
        if name not in post:
            continue
        v = _chains(trace, name)
        flat = v.reshape(v.shape[0], v.shape[1], -1)
        for i in range(flat.shape[2]):
            r, e = rhat_ess(flat[:, :, i])
            if r > worst_rhat:
                worst_rhat, worst_name = r, f"{name}[{i}]" if flat.shape[2] > 1 else name
            worst_ess = min(worst_ess, e)
    stats_group = trace["sample_stats"] if "sample_stats" in trace.children else trace.sample_stats
    div = np.asarray(stats_group["diverging"].values)
    n_div, n_total = int(div.sum()), int(div.size)
    pct = n_div / n_total
    if worst_rhat <= 1.01 and worst_ess >= 400 and pct < 0.001:
        verdict = "pass"
    elif worst_rhat <= 1.05 and worst_ess >= 100 and pct < 0.01:
        verdict = "caution"
    else:
        verdict = "fail"
    return {
        "max_rhat": round(worst_rhat, 4), "worst_parameter": worst_name, "min_ess_bulk": round(worst_ess),
        "divergences": n_div, "divergence_pct": round(pct * 100, 3), "verdict": verdict,
        "chains": int(div.shape[0]), "draws": int(div.shape[1]),
    }


def sample(design: Design, priors: dict[str, dict], *, seed: int, chains: int = 4, draws: int = 1000,
           tune: int = 1000, cores: int | None = None,
           on_progress: Callable[[float], None] | None = None,
           should_stop: Callable[[], bool] | None = None):
    """Sample with nutpie in the background so progress can be reported and the run cancelled."""
    import nutpie

    model = build_model(design, priors)
    compiled = nutpie.compile_pymc_model(model)
    total = chains * (draws + tune)
    sampler = nutpie.sample(
        compiled, draws=draws, tune=tune, chains=chains, cores=cores or chains, seed=seed,
        target_accept=0.9, progress_bar=False, blocking=False, save_warmup=False,
    )
    started = time.time()
    try:
        def finished() -> bool:
            try:
                return bool(sampler.is_finished)
            except TimeoutError:  # some nutpie versions raise instead of returning False
                return False

        while not finished():
            time.sleep(0.5)
            if should_stop and should_stop():
                sampler.abort()
                raise Cancelled()
            if on_progress:
                # nutpie has no cheap draw counter here; report a smooth estimate that never reaches 1
                elapsed = time.time() - started
                on_progress(1 - math.exp(-elapsed / max(15.0, total / 120.0)))
        trace = sampler.wait()
    except Cancelled:
        raise
    if on_progress:
        on_progress(1.0)
    return trace


def fit(design: Design, priors: dict[str, dict], *, seed: int, chains: int = 4, draws: int = 1000,
        tune: int = 1000, cores: int | None = None, retry_on_caution: bool = True,
        on_progress: Callable[[float], None] | None = None,
        should_stop: Callable[[], bool] | None = None) -> Fit:
    started = time.time()
    names = [p for p in PARAMS]
    trace = sample(design, priors, seed=seed, chains=chains, draws=draws, tune=tune, cores=cores,
                   on_progress=on_progress, should_stop=should_stop)
    diag = diagnose(trace, names)
    diag["tune"] = tune
    diag["retried"] = False
    if diag["verdict"] != "pass" and retry_on_caution:
        trace2 = sample(design, priors, seed=seed + 1, chains=chains, draws=draws, tune=2 * tune, cores=cores,
                        on_progress=on_progress, should_stop=should_stop)
        diag2 = diagnose(trace2, names)
        order = {"pass": 0, "caution": 1, "fail": 2}
        if (order[diag2["verdict"]], diag2["max_rhat"]) <= (order[diag["verdict"]], diag["max_rhat"]):
            trace, diag = trace2, diag2
            diag["tune"] = 2 * tune
        diag["retried"] = True
    diag["seconds"] = round(time.time() - started, 1)
    return Fit(design=design, priors=priors, post=_flatten(trace, names), diagnostics=diag)
