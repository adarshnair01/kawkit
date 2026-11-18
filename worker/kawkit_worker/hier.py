"""Hierarchical (breakdown) model: items inside each channel, tied to the channel by partial pooling.

    contribution_{c,s,t} = beta_c * w_{c,s} * S(A_{c,s,t}; lam_c)        for item s of channel c
    log w_{c,s}          = sum over the channel's dimensions d of u_{c,d,level(s,d)}
    u_{c,d,.}            = tau_{c,d} * (z - mean(z)),   z ~ Normal(0, 1),   tau ~ HalfNormal(0.5)

Carry-over (alpha_c) and saturation speed (lam_c) are shared by a channel's items; only the scale differs.
Several dimensions combine additively (a platform effect and a region effect), so each effect is learned from
many items. A channel's own ROI is derived from its items, so channel results stay comparable to the
channel-only model. With one item per channel and no dimensions this is the channel-only model.
"""

from __future__ import annotations

from dataclasses import dataclass, field, fields

import numpy as np

from . import model as M
from .model import L_MAX, Design, Fit, adstock_np, build_design, lag_tensor, saturation_np

TAU_SCALE = 0.5  # prior scale of the spread between items, on the log scale (about +-50% between items)


@dataclass
class Group:
    """One dimension of one channel, for example 'platform' for social."""

    channel: int
    dim: str
    levels: list[str]
    col0: int  # first column of this group in the stacked effect vector


@dataclass
class Items:
    names: list[str]
    channel: np.ndarray  # (I,) channel index of each item
    spend: np.ndarray  # (T, I)
    groups: list[Group] = field(default_factory=list)
    level_of: list[list[tuple[int, int]]] = field(default_factory=list)  # per item: (group index, level index)

    @property
    def n(self) -> int:
        return len(self.names)

    def matrix(self) -> np.ndarray:
        """(I, L) 0/1: which stacked effects each item takes part in."""
        width = sum(len(g.levels) for g in self.groups)
        m = np.zeros((self.n, width))
        for i, pairs in enumerate(self.level_of):
            for g, lvl in pairs:
                m[i, self.groups[g].col0 + lvl] = 1.0
        return m


def single_items(channels: list[str], spend: np.ndarray) -> Items:
    """One item per channel and no dimensions: the channel-only model."""
    return Items(names=list(channels), channel=np.arange(len(channels)), spend=spend.copy(), groups=[], level_of=[[] for _ in channels])


@dataclass
class HDesign(Design):
    items: Items = None  # type: ignore[assignment]
    xs_item: np.ndarray = None  # type: ignore[assignment]  # (T, I) item spend / channel max
    mat: np.ndarray = None  # type: ignore[assignment]  # (I, L)


def build_hier_design(ds, items: Items, holdout: int = 0) -> HDesign:
    base = build_design(ds, holdout)
    n = base.n_fit
    xs_item = items.spend / base.xmax[items.channel]
    shape_i = saturation_np(adstock_np(xs_item[:n], np.full(items.n, 0.25)), 3.0).sum(axis=0)
    shape_c = np.bincount(items.channel, weights=shape_i, minlength=len(base.channels))
    total = base.spend[:n].sum(axis=0)
    half_normal_median = 0.6744897501960817
    with np.errstate(divide="ignore", invalid="ignore"):
        beta_scale = base.roi_centre * total / (half_normal_median * base.ymax * shape_c)
    beta_scale = np.where(np.isfinite(beta_scale) & (beta_scale > 0), beta_scale, 1e-4)
    kw = {f.name: getattr(base, f.name) for f in fields(Design)}
    kw["beta_scale"] = beta_scale
    return HDesign(**kw, items=items, xs_item=xs_item, mat=items.matrix())


def build_hier_model(design: HDesign, priors: dict[str, dict]):
    import pymc as pm
    import pytensor.tensor as pt

    it = design.items
    n = design.n_fit
    C = len(design.channels)
    n_items = it.n
    K = design.zs.shape[1]
    F = design.fourier.shape[1]
    lags = lag_tensor(design.xs_item[:n])  # (L, T, I)
    y = design.y[:n] / design.ymax
    chan = it.channel
    onehot = np.zeros((n_items, C))
    onehot[np.arange(n_items), chan] = 1.0

    a = np.ones(C)
    b = np.full(C, 3.0)
    for c, ch in enumerate(design.channels):
        if "carryover_weeks" in priors.get(ch, {}):
            a[c], b[c] = M.carryover_prior_params(priors[ch]["carryover_weeks"])

    with pm.Model() as model:
        intercept = pm.Normal("intercept", 0.0, 2.0)
        gamma = pm.Normal("gamma", 0.0, 2.0)
        mu = intercept + gamma * design.trend[:n]
        if F:
            fourier = pm.Normal("fourier", 0.0, 2.0, shape=F)
            mu = mu + pt.dot(design.fourier[:n], fourier)
        pm.Potential("baseline_not_negative", -0.5 * pt.sum((pt.minimum(mu, 0.0) / 0.01) ** 2))
        if K:
            delta = pm.Normal("delta", 0.0, 2.0, shape=K)
            mu = mu + pt.dot(design.zs[:n], delta)
        baseline_share = pt.sum(mu) / float(y.sum())
        outside = pt.maximum(M.BASELINE_SHARE[0] - baseline_share, 0.0) + pt.maximum(baseline_share - M.BASELINE_SHARE[1], 0.0)
        pm.Potential("baseline_share_prior", -0.5 * (outside / M.BASELINE_SHARE_SD) ** 2)
        beta = pm.HalfNormal("beta", sigma=design.beta_scale, shape=C)
        alpha = pm.Beta("alpha", alpha=a, beta=b, shape=C)
        lam = pm.Gamma("lam", alpha=3.0, beta=1.0, shape=C)
        sigma = pm.HalfNormal("sigma", 2.0)

        # item scales: sum-to-zero effects per (channel, dimension), non-centred so the sampler stays healthy
        if it.groups:
            taus = pm.HalfNormal("tau", TAU_SCALE, shape=len(it.groups))
            parts = []
            for gi, g in enumerate(it.groups):
                z = pm.Normal(f"z_{gi}", 0.0, 1.0, shape=len(g.levels))
                parts.append(taus[gi] * (z - z.mean()))
            u = pt.concatenate(parts)
            logw = pm.Deterministic("logw", pt.dot(design.mat, u))
        else:
            logw = pt.zeros(n_items)
            pm.Deterministic("logw", logw)

        alpha_i = alpha[chan]  # (I,)
        powers = pt.stack([alpha_i**lag for lag in range(L_MAX)], axis=0)  # (L, I)
        adstock = (lags * powers[:, None, :]).sum(axis=0) / powers.sum(axis=0)  # (T, I)
        item_contrib = (beta[chan] * pt.exp(logw)) * pt.tanh(lam[chan] * adstock / 2.0)  # (T, I)
        contribution = pt.dot(item_contrib, onehot)  # (T, C)
        mu = mu + contribution.sum(axis=1)

        total_spend = design.spend[:n].sum(axis=0)
        for c, ch in enumerate(design.channels):
            p = priors.get(ch, {})
            if "roi_low" in p:
                m, s = M.roi_prior_params(p["roi_low"], p["roi_high"])
                roi = contribution[:, c].sum() * design.ymax / total_spend[c]
                pm.Potential(f"roi_prior_{c}", pm.logp(pm.LogNormal.dist(mu=m, sigma=s), roi))

        pm.Normal("y", mu=mu, sigma=sigma, observed=y)
    return model


def fit_hier(design: HDesign, priors: dict[str, dict], **kw) -> Fit:
    kw.setdefault("target_accept", 0.98)  # the pooling can form a funnel when the data cannot separate items
    extra = ["logw", *(["tau"] if design.items.groups else [])]
    return M.fit(design, priors, builder=build_hier_model, extra_names=extra, **kw)


# ------------------------------------------------------------------ numpy forward pass and summaries

def item_contrib(design: HDesign, post: dict[str, np.ndarray], max_draws: int = 500) -> np.ndarray:
    """(D, T, I) scaled item contributions for up to max_draws thinned draws."""
    it = design.items
    D = post["beta"].shape[0]
    idx = np.linspace(0, D - 1, min(D, max_draws)).astype(int)
    chan = it.channel
    alpha = post["alpha"][idx][:, chan]  # (D, I)
    lam = post["lam"][idx][:, chan]
    beta = post["beta"][idx][:, chan]
    w = np.exp(post["logw"][idx])
    xs = design.xs_item  # (T, I)
    T = xs.shape[0]
    ads = np.zeros((len(idx), T, it.n))
    norm = np.zeros((len(idx), it.n))
    for lag in range(L_MAX):
        wt = alpha**lag  # (D, I)
        shifted = np.zeros_like(xs)
        shifted[lag:] = xs[: T - lag]
        ads += wt[:, None, :] * shifted[None]
        norm += wt
    ads /= norm[:, None, :]
    return (beta * w)[:, None, :] * np.tanh(lam[:, None, :] * ads / 2.0)


def predict_hier(design: HDesign, post: dict[str, np.ndarray], max_draws: int = 500) -> np.ndarray:
    """(D, T) expected revenue in original units."""
    D = post["beta"].shape[0]
    idx = np.linspace(0, D - 1, min(D, max_draws)).astype(int)
    mu = post["intercept"][idx][:, None] + post["gamma"][idx][:, None] * design.trend[None, :]
    if design.fourier.shape[1]:
        mu = mu + post["fourier"][idx] @ design.fourier.T
    if design.zs.shape[1]:
        mu = mu + post["delta"][idx] @ design.zs.T
    mu = mu + item_contrib(design, post, max_draws).sum(axis=2)
    return mu * design.ymax


def roi_draws(design: HDesign, post: dict[str, np.ndarray], max_draws: int = 500) -> tuple[np.ndarray, np.ndarray]:
    """(D, I) item ROI draws and (D, C) channel ROI draws over the fitted weeks."""
    n = design.n_fit
    it = design.items
    contrib = item_contrib(design, post, max_draws)[:, :n].sum(axis=1) * design.ymax  # (D, I)
    spend_i = it.spend[:n].sum(axis=0)
    item_roi = contrib / np.maximum(spend_i, 1e-9)
    C = len(design.channels)
    chan_contrib = np.stack([contrib[:, it.channel == c].sum(axis=1) for c in range(C)], axis=1)
    chan_roi = chan_contrib / np.maximum(design.spend[:n].sum(axis=0), 1e-9)
    return item_roi, chan_roi
