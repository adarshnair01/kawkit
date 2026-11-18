"""Hierarchical (breakdown) model: fast structural checks, and slow known-truth checks (uv run pytest -m slow)."""

import numpy as np
import pytest

from kawkit_worker import hier as H
from kawkit_worker import model as M
from kawkit_worker.synth import make_hier_dataset

SOCIAL = {"social": dict(mix="varied", dims=["platform"], items=[("meta", 2.6), ("tiktok", 1.3), ("youtube", 0.5)])}
SEARCH_FIXED = {"search": dict(mix="fixed", dims=["term"], items=[("brand", 2.4), ("nonbrand", 0.9)])}
DISPLAY_2D = {"display": dict(mix="varied", dims=["platform", "region"], items=[("a", "uk", 1.6), ("a", "us", 2.4), ("b", "uk", 0.8), ("b", "us", 1.2)])}


def test_items_add_up_to_their_channel_and_have_the_right_structure():
    ds, items, truth = make_hier_dataset(seed=5, breakdowns={**SOCIAL, **DISPLAY_2D})
    for c in range(len(ds.channels)):
        assert items.spend[:, items.channel == c].sum(axis=1) == pytest.approx(ds.spend[:, c])
    assert items.n == 3 + 4 + 3  # social 3, display 4, the other three channels one each
    mat = items.matrix()
    assert mat.shape == (items.n, 3 + 2 + 2)  # platform(3) + platform(2) + region(2)
    assert truth.item_roi["social / meta"] == 2.6
    # each display item takes part in one platform effect and one region effect
    display = [i for i, nm in enumerate(items.names) if nm.startswith("display")]
    assert all(mat[i].sum() == 2 for i in display)


def test_single_items_design_reproduces_the_channel_only_priors():
    ds, items, _ = make_hier_dataset(seed=5)
    flat = M.build_design(ds)
    hd = H.build_hier_design(ds, H.single_items(ds.channels, ds.spend))
    assert hd.beta_scale == pytest.approx(flat.beta_scale)
    assert hd.xs_item == pytest.approx(flat.xs)
    # a breakdown changes the calibrated prior scale (smaller items saturate less) but keeps it positive and finite
    hb = H.build_hier_design(ds, make_hier_dataset(seed=5, breakdowns=SOCIAL)[1])
    assert np.all(np.isfinite(hb.beta_scale)) and np.all(hb.beta_scale > 0)


def test_forward_pass_shapes():
    ds, items, _ = make_hier_dataset(seed=5, breakdowns=SOCIAL)
    hd = H.build_hier_design(ds, items)
    D = 6
    rng = np.random.default_rng(0)
    post = {
        "beta": rng.uniform(0.05, 0.2, (D, 5)), "alpha": rng.uniform(0.1, 0.6, (D, 5)), "lam": rng.uniform(1, 4, (D, 5)),
        "logw": rng.normal(0, 0.3, (D, items.n)), "intercept": rng.normal(0.5, 0.1, D), "gamma": rng.normal(0, 0.1, D),
        "fourier": rng.normal(0, 0.1, (D, hd.fourier.shape[1])), "delta": rng.normal(0, 0.1, (D, 1)),
    }
    assert H.item_contrib(hd, post).shape == (D, 156, items.n)
    assert H.predict_hier(hd, post).shape == (D, 156)
    item_roi, chan_roi = H.roi_draws(hd, post)
    assert item_roi.shape == (D, items.n) and chan_roi.shape == (D, 5)


# ---------------------------------------------------------------- slow: recovery of known truth

def _fit(cfg, seed):
    ds, items, truth = make_hier_dataset(seed=seed, **cfg)
    hd = H.build_hier_design(ds, items)
    fit = H.fit_hier(hd, {}, seed=1, cores=4, retry_on_caution=False)
    item_roi, chan_roi = H.roi_draws(hd, fit.post)
    return ds, items, truth, fit, item_roi, chan_roi


def _coverage_and_order(cfg, seeds):
    hit = n = 0
    orders = []
    chan_hit = chan_n = 0
    for seed in seeds:
        ds, items, truth, fit, item_roi, chan_roi = _fit(cfg, seed)
        assert fit.diagnostics["verdict"] in ("pass", "caution")
        idx = [i for i in range(items.n) if items.level_of[i]]
        for i in idx:
            lo, hi = np.percentile(item_roi[:, i], [5, 95])
            n += 1
            hit += lo <= truth.item_roi[items.names[i]] <= hi
        best = max(idx, key=lambda i: truth.item_roi[items.names[i]])
        worst = min(idx, key=lambda i: truth.item_roi[items.names[i]])
        orders.append(float((item_roi[:, best] > item_roi[:, worst]).mean()))
        for c, ch in enumerate(ds.channels):
            lo, hi = np.percentile(chan_roi[:, c], [5, 95])
            chan_n += 1
            chan_hit += lo <= truth.channel_roi[ch] <= hi
    return hit / n, float(np.mean(orders)), chan_hit / chan_n


@pytest.mark.slow
def test_separable_items_are_recovered_and_ranked():
    cover, order, chan = _coverage_and_order(dict(breakdowns=SOCIAL), seeds=(1, 3, 5))
    assert cover >= 0.55, cover  # nominal 90%; measured about 83% over 162 intervals (docs/operations.md). Small samples are noisy.
    assert order >= 0.75, order
    assert chan >= 0.8, chan


@pytest.mark.slow
def test_inseparable_items_are_not_confidently_ranked_but_the_channel_is_right():
    cover, order, chan = _coverage_and_order(dict(breakdowns=SEARCH_FIXED), seeds=(1, 2, 3))
    assert order <= 0.7, order  # the data cannot tell them apart; the model must not pretend it can
    assert cover >= 0.55, cover  # nominal 90%; measured about 83% over 162 intervals (docs/operations.md). Small samples are noisy.
    assert chan >= 0.8, chan


@pytest.mark.slow
def test_two_dimensions_combine_additively():
    cover, order, chan = _coverage_and_order(dict(breakdowns=DISPLAY_2D), seeds=(1, 3, 5))
    assert cover >= 0.55, cover  # nominal 90%; measured about 83% over 162 intervals (docs/operations.md). Small samples are noisy.
    assert order >= 0.7, order
    assert chan >= 0.8, chan


@pytest.mark.slow
def test_no_breakdown_gives_the_channel_only_answer():
    """With one item per channel and no dimensions the hierarchical code path is the channel-only model."""
    ds, _, _ = make_hier_dataset(seed=4)
    flat = M.fit(M.build_design(ds), {}, seed=1, cores=4, retry_on_caution=False)
    hier = H.fit_hier(H.build_hier_design(ds, H.single_items(ds.channels, ds.spend)), {}, seed=1, cores=4, retry_on_caution=False)
    assert np.median(hier.post["beta"], axis=0) == pytest.approx(np.median(flat.post["beta"], axis=0), rel=0.15)
    assert np.median(hier.post["alpha"], axis=0) == pytest.approx(np.median(flat.post["alpha"], axis=0), abs=0.08)
    assert np.median(hier.post["lam"], axis=0) == pytest.approx(np.median(flat.post["lam"], axis=0), rel=0.2)


@pytest.mark.slow
def test_a_run_with_a_breakdown_produces_item_results_and_a_two_level_plan():
    from kawkit_worker.pipeline import run_pipeline
    from kawkit_worker.synth import hier_csvs

    ds, items, truth = make_hier_dataset(seed=3, breakdowns=SOCIAL)
    main, long = hier_csvs(ds, items, {"social": ["platform"]})
    out = run_pipeline(main, {}, seed=5, settings={"draws": 400, "tune": 400, "breakdown": {"social": {"dims": ["platform"]}}},
                       breakdown_bytes=long)
    assert out["diagnostics"]["verdict"] in ("pass", "caution")
    bd = out["breakdown"]
    social = next(c for c in bd["channels"] if c["name"] == "social")
    assert [i["name"] for i in social["items"]] == sorted((i["name"] for i in social["items"]), key=lambda n: -next(x["total_spend"] for x in social["items"] if x["name"] == n))
    by_name = {i["name"]: i for i in social["items"]}
    assert by_name["social / meta"]["roi"]["median"] > by_name["social / youtube"]["roi"]["median"]
    assert {c["name"] for c in bd["channel_only"]} == set(ds.channels)
    assert out["draws"]["groups"]["channel_names"] == ds.channels
    assert len(out["draws"]["channels"]) == items.n
    assert out["default_plan"]["mode"] == "keep" and out["default_plan_resplit"]["mode"] == "resplit"
    assert out["default_plan"]["expected_recommended"] >= out["default_plan"]["expected_current"]
    assert [c["name"] for c in out["channels"]] == ds.channels  # channel-level results are unchanged in shape
    assert out["fit"]["holdout"] is not None
