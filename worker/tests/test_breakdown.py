import numpy as np
import pytest

from kawkit_worker.breakdown import BreakdownError, build_items
from kawkit_worker.synth import make_hier_dataset

SOCIAL = {"social": dict(mix="varied", dims=["platform"], items=[("meta", 2.6), ("tiktok", 1.3), ("youtube", 0.5)])}
DISPLAY = {"display": dict(mix="varied", dims=["platform", "region"], items=[("a", "uk", 1.6), ("a", "us", 2.4), ("b", "uk", 0.8), ("b", "us", 1.2)])}


def long_csv(ds, items, channel, dims, scale=1.0, drop=None, extra_rows=""):
    c = ds.channels.index(channel)
    lines = [f"date,channel,{','.join(dims)},spend"]
    for i in np.where(items.channel == c)[0]:
        parts = items.names[i].split(" / ")[1:]
        if drop and parts == drop:
            continue
        for w, d in enumerate(ds.dates):
            lines.append(f"{d},{channel},{','.join(parts)},{items.spend[w, i] * scale:.0f}")
    return "\n".join(lines) + "\n" + extra_rows


def test_round_trip_matches_the_generated_items():
    ds, items, _ = make_hier_dataset(seed=3, breakdowns=SOCIAL)
    r = build_items(ds, long_csv(ds, items, "social", ["platform"]), {"social": {"dims": ["platform"]}})
    assert r.items.n == items.n
    social = [i for i, n in enumerate(r.items.names) if n.startswith("social")]
    assert sorted(r.items.names[i] for i in social) == sorted(n for n in items.names if n.startswith("social"))
    assert r.dataset.spend[:, ds.channels.index("social")] == pytest.approx(ds.spend[:, ds.channels.index("social")], abs=3)
    assert len(r.items.groups) == 1 and len(r.items.groups[0].levels) == 3
    assert not any(w["code"] == "remainder" for w in r.warnings)


def test_two_dimensions_make_two_groups_and_items_take_both_effects():
    ds, items, _ = make_hier_dataset(seed=3, breakdowns=DISPLAY)
    r = build_items(ds, long_csv(ds, items, "display", ["platform", "region"]), {"display": {"dims": ["platform", "region"]}})
    assert [g.dim for g in r.items.groups] == ["platform", "region"]
    mat = r.items.matrix()
    disp = [i for i, n in enumerate(r.items.names) if n.startswith("display")]
    assert len(disp) == 4 and all(mat[i].sum() == 2 for i in disp)


def test_missing_item_becomes_a_remainder_and_value_spellings_merge():
    ds, items, _ = make_hier_dataset(seed=3, breakdowns=SOCIAL)
    csv = long_csv(ds, items, "social", ["platform"], drop=["youtube"]).replace("tiktok", "TikTok ", 5).replace("meta,", "Meta,", 7)
    r = build_items(ds, csv, {"social": {"dims": ["platform"]}})
    names = [n for n in r.items.names if n.startswith("social")]
    assert "social / Not broken down" in names
    assert len(names) == 3  # meta, tiktok (spellings merged) and the remainder
    assert any(w["code"] == "remainder" for w in r.warnings)


def test_a_breakdown_that_adds_up_to_too_much_is_rejected_with_the_reason():
    ds, items, _ = make_hier_dataset(seed=3, breakdowns=SOCIAL)
    with pytest.raises(BreakdownError, match="adds up to .* more than the channel total"):
        build_items(ds, long_csv(ds, items, "social", ["platform"], scale=1.3), {"social": {"dims": ["platform"]}})


def test_small_levels_fold_into_other():
    ds, items, _ = make_hier_dataset(seed=3, breakdowns=SOCIAL)
    c = ds.channels.index("social")
    csv = long_csv(ds, items, "social", ["platform"])
    # nine extra tiny platforms, each well under 2% of the channel
    extra = "".join(f"{ds.dates[w]},social,tiny{k},1\n" for k in range(9) for w in range(0, 150, 10))
    r = build_items(ds, csv + extra, {"social": {"dims": ["platform"]}})
    assert any(n == "social / Other" for n in r.items.names)
    assert r.dataset.spend[:, c].sum() == pytest.approx(ds.spend[:, c].sum(), rel=0.02)
    assert any(w["code"] == "folded" for w in r.warnings)


def test_daily_rows_are_added_into_their_week():
    ds, items, _ = make_hier_dataset(seed=3, breakdowns=SOCIAL)
    c = ds.channels.index("social")
    lines = ["date,channel,platform,spend"]
    from datetime import date, timedelta

    for i in np.where(items.channel == c)[0]:
        name = items.names[i].split(" / ")[1]
        for w, d in enumerate(ds.dates):
            start = date.fromisoformat(d)
            for k in range(7):
                lines.append(f"{start + timedelta(days=k)},social,{name},{items.spend[w, i] / 7:.4f}")
    r = build_items(ds, "\n".join(lines) + "\n", {"social": {"dims": ["platform"]}})
    assert r.dataset.spend[:, c] == pytest.approx(ds.spend[:, c], abs=3)


@pytest.mark.parametrize("csv, spec, message", [
    ("date,channel,spend\n", {"social": {"dims": ["platform"]}}, "no 'platform' column"),
    ("date,spend,platform\n2023-01-02,5,a\n", {"social": {"dims": ["platform"]}}, "needs a 'channel' column"),
    ("date,channel,platform,spend\nnope,social,a,5\n", {"social": {"dims": ["platform"]}}, "Date is not YYYY-MM-DD"),
    ("date,channel,platform,spend\n2023-01-02,social,a,abc\n", {"social": {"dims": ["platform"]}}, "not a number"),
    ("date,channel,platform,spend\n2023-01-02,social,a,-4\n", {"social": {"dims": ["platform"]}}, "negative"),
    ("date,channel,platform,spend\n2023-01-02,tv,a,4\n", {"social": {"dims": ["platform"]}}, "no rows for channel 'social'"),
    ("date,channel,platform,spend\n2023-01-02,social,a,4\n", {"nonsense": {"dims": ["platform"]}}, "not in the data"),
    ("date,channel,platform,spend\n2023-01-02,social,a,4\n", {}, "at least one channel"),
])
def test_clear_errors(csv, spec, message):
    ds, _, _ = make_hier_dataset(seed=3)
    with pytest.raises(BreakdownError, match=message):
        build_items(ds, csv, spec)
