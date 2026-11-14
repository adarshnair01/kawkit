"""Weekly data for the real-data examples, with candidate baseline features.

Sources
  - Sales and spend: Conjura MMM dataset (Anderson, 2024, CC BY 4.0).
  - Weather: Open-Meteo historical weather API (CC BY 4.0), daily mean temperature and precipitation
    averaged over a few large cities per country.
  - Consumer sentiment and prices: FRED (University of Michigan sentiment UMCSENT, OECD consumer
    confidence for the UK, consumer price indices).
Calendar events are computed, not downloaded.
"""

from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

SERIES = {
    "home": "826fd57057c52458a1f77cae4e3e6c67",     # Home & Garden > Home & Interior Decor, UK
    "beauty": "3340d86d751fe8213235565e69512aa2",   # Beauty & Fitness > Face & Body Care, US
    "apparel": "f7493de0a760f84888105af70245bed3",  # Apparel > Undergarments, US
    "food": "ac9965a4cc73306fa9e4fcc0ac581eb5",     # Food & Drink, US
    "health": "acfe71e0c8a49dbe6f3f6e97d0370339",   # Health > Oral & Dental Care, UK
}
NAMES = {
    "GOOGLE_PAID_SEARCH_SPEND": "google_search", "GOOGLE_SHOPPING_SPEND": "google_shopping",
    "GOOGLE_PMAX_SPEND": "google_pmax", "GOOGLE_DISPLAY_SPEND": "google_display",
    "GOOGLE_VIDEO_SPEND": "google_video", "META_FACEBOOK_SPEND": "facebook",
    "META_INSTAGRAM_SPEND": "instagram", "META_OTHER_SPEND": "meta_other", "TIKTOK_SPEND": "tiktok",
}
CITIES = {"UK": ["uk_london", "uk_manchester", "uk_birmingham"],
          "US": ["us_newyork", "us_chicago", "us_losangeles", "us_houston", "us_atlanta"]}
EASTER = [date(2021, 4, 4), date(2022, 4, 17), date(2023, 4, 9), date(2024, 3, 31)]

GROUPS = {
    "events": ["black_friday", "cyber_week", "pre_christmas", "christmas_newyear", "easter"],
    "promo": ["discount_rate"],
    "weather": ["temp_anomaly", "rain_anomaly"],
    "macro": ["consumer_confidence", "inflation"],
}


def monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


def black_friday(year: int) -> date:
    d = date(year, 11, 1)
    thursdays = [d + timedelta(days=i) for i in range(30) if (d + timedelta(days=i)).weekday() == 3]
    return thursdays[3] + timedelta(days=1)


def event_flags(weeks: pd.DatetimeIndex) -> pd.DataFrame:
    """One row per week (Monday start). Each flag marks the weeks an event falls in."""
    out = pd.DataFrame(0.0, index=weeks, columns=GROUPS["events"])
    for w in weeks:
        start = w.date()
        days = [start + timedelta(days=i) for i in range(7)]
        bf = monday(black_friday(start.year))
        if start == bf:
            out.loc[w, "black_friday"] = 1
        elif start == bf + timedelta(days=7):
            out.loc[w, "cyber_week"] = 1
        elif start.month == 12 and start.day <= 18:
            out.loc[w, "pre_christmas"] = 1
        if any((d.month, d.day) in ((12, 25), (1, 1)) for d in days):
            out.loc[w, "christmas_newyear"] = 1
        if any(d in EASTER for d in days):
            out.loc[w, "easter"] = 1
    return out


def weather(country: str, external: Path) -> pd.DataFrame:
    """Weekly temperature and rain, as the difference from the usual value for that week of the year."""
    frames = []
    for city in CITIES[country]:
        d = json.loads((external / f"wx_{city}.json").read_text())["daily"]
        frames.append(pd.DataFrame({"temp": d["temperature_2m_mean"], "rain": d["precipitation_sum"]},
                                   index=pd.to_datetime(d["time"])))
    daily = sum(frames) / len(frames)
    weekly = daily.resample("W-MON", label="left", closed="left").agg({"temp": "mean", "rain": "sum"})
    woy = weekly.index.isocalendar().week.astype(int).clip(upper=52).values
    normal = weekly.groupby(woy).transform("mean")
    return pd.DataFrame({"temp_anomaly": (weekly.temp - normal.temp).round(2),
                         "rain_anomaly": (weekly.rain - normal.rain).round(1)})


def macro(country: str, external: Path, weeks: pd.DatetimeIndex) -> pd.DataFrame:
    """Monthly consumer confidence and year-on-year inflation, carried forward to weeks."""
    conf_id, cpi_id = ("UMCSENT", "CPIAUCSL") if country == "US" else ("CSCICP03GBM665S", "GBRCPIALLMINMEI")

    def series(name: str) -> pd.Series:
        s = pd.read_csv(external / f"fred_{name}.csv")
        return pd.Series(pd.to_numeric(s.iloc[:, 1], errors="coerce").values, index=pd.to_datetime(s.iloc[:, 0])).dropna()

    conf = series(conf_id)
    cpi = series(cpi_id)
    infl = (cpi / cpi.shift(12) - 1) * 100
    # a month's figure is published the following month: use last month's value
    def at(s: pd.Series) -> np.ndarray:
        return np.array([s[s.index <= (w - pd.DateOffset(months=1))].iloc[-1] for w in weeks])

    return pd.DataFrame({"consumer_confidence": at(conf).round(2), "inflation": at(infl.dropna()).round(2)}, index=weeks)


def build(df: pd.DataFrame, slug: str, external: Path) -> tuple[pd.DataFrame, dict]:
    """Weekly frame with date, revenue, spend_* and every candidate control_* column."""
    g = df[df.MMM_TIMESERIES_ID == SERIES[slug]].set_index("DATE_DAY").sort_index()
    meta = {k: str(g[c].iloc[0]) for k, c in [("vertical", "ORGANISATION_VERTICAL"), ("subvertical", "ORGANISATION_SUBVERTICAL"),
                                               ("territory", "ORGANISATION_PRIMARY_TERRITORY_NAME"), ("currency", "CURRENCY_CODE")]}
    price = g.ALL_PURCHASES_ORIGINAL_PRICE.fillna(0)
    disc = g.ALL_PURCHASES_GROSS_DISCOUNT.fillna(0)
    daily = g[list(NAMES)].fillna(0).assign(revenue=price - disc, price=price, disc=disc)
    weekly = daily.resample("W-MON", label="left", closed="left").sum()
    weekly = weekly[daily.revenue.resample("W-MON", label="left", closed="left").count() == 7]
    out = pd.DataFrame({"date": weekly.index.strftime("%Y-%m-%d"), "revenue": weekly.revenue.round(2).values}, index=weekly.index)
    for c in NAMES:
        if weekly[c].sum() > 0:
            out[f"spend_{NAMES[c]}"] = weekly[c].round(2).values
    country = meta["territory"]
    feats = pd.concat([
        event_flags(weekly.index),
        pd.DataFrame({"discount_rate": (weekly.disc / weekly.price.where(weekly.price > 0, np.nan)).fillna(0).round(4) * 100}),
        weather(country, external).reindex(weekly.index),
        macro(country, external, weekly.index),
    ], axis=1)
    for c in feats:
        out[f"control_{c}"] = feats[c].values
    return out.reset_index(drop=True), meta


def select(frame: pd.DataFrame, groups: list[str]) -> str:
    """CSV text with only the chosen feature groups as control columns."""
    keep = {f"control_{c}" for g in groups for c in GROUPS[g]}
    cols = [c for c in frame.columns if not c.startswith("control_") or c in keep]
    return frame[cols].to_csv(index=False)
