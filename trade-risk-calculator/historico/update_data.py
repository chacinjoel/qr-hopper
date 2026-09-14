#!/usr/bin/env python3
"""Refresh public USD/MXN, BTC/USD and macro series used by the dashboard."""

import csv
import datetime as dt
import io
import json
import os
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
START = "2018-01-01"
TODAY = dt.date.today().isoformat()
FRED = {
    "DEXMXUS": "Mexican pesos per U.S. dollar",
    "CBBTCUSD": "Coinbase Bitcoin price in U.S. dollars",
    "DFF": "Effective Federal Funds Rate, %",
    "DTWEXBGS": "Nominal Broad U.S. Dollar Index",
    "VIXCLS": "CBOE VIX",
    "DCOILWTICO": "WTI USD/barrel",
    "SP500": "S&P 500",
    "CPIAUCSL": "U.S. CPI index",
    "CPALTT01MXM659N": "Mexico CPI year-over-year, %",
    "IRSTCI01MXM156N": "Mexico interbank rate, %",
}


def get(url):
    request = urllib.request.Request(url, headers={"User-Agent": "TradeLabDataRefresh/1.0"})
    with urllib.request.urlopen(request, timeout=45) as response:
        return response.read().decode("utf-8")


def fred_series(series):
    query = urllib.parse.urlencode({"id": series, "cosd": START, "coed": TODAY})
    rows = csv.reader(io.StringIO(get(f"https://fred.stlouisfed.org/graph/fredgraph.csv?{query}")))
    next(rows, None)
    values = []
    for date, value, *_ in rows:
        if not value or value == ".":
            continue
        stamp = int(dt.datetime.fromisoformat(date).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)
        values.append([stamp, float(value)])
    if not values:
        raise RuntimeError(f"FRED returned no observations for {series}")
    return values


def js(name, payload):
    return f"window.{name}=" + json.dumps(payload, separators=(",", ":"), ensure_ascii=False) + ";\n"


def refresh_fred():
    downloaded = {key: fred_series(key) for key in FRED}
    generated = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    fx = downloaded.pop("DEXMXUS")
    btc = downloaded.pop("CBBTCUSD")
    fred_payload = {
        "source": "FRED DEXMXUS · Board of Governors H.10",
        "availableFrom": dt.datetime.fromtimestamp(fx[0][0] / 1000, dt.timezone.utc).date().isoformat(),
        "availableTo": dt.datetime.fromtimestamp(fx[-1][0] / 1000, dt.timezone.utc).date().isoformat(),
        "generatedAt": generated,
        "units": "Mexican pesos per U.S. dollar",
        "frequency": "Daily noon buying rate",
        "closes": fx,
    }
    macro_payload = {
        "source": "FRED · official and attributed source series",
        "from": START,
        "generatedAt": generated,
        "series": downloaded,
        "meta": {key: FRED[key] for key in downloaded},
    }
    (ROOT / "fred_data.js").write_text(js("USDMXN_FRED", fred_payload), encoding="utf-8")
    btc_payload = {
        "source": "FRED CBBTCUSD · Coinbase Bitcoin",
        "availableFrom": dt.datetime.fromtimestamp(btc[0][0] / 1000, dt.timezone.utc).date().isoformat(),
        "availableTo": dt.datetime.fromtimestamp(btc[-1][0] / 1000, dt.timezone.utc).date().isoformat(),
        "generatedAt": generated,
        "units": "U.S. dollars per Bitcoin",
        "frequency": "Daily close",
        "closes": btc,
    }
    (ROOT / "btc_fred_data.js").write_text(js("BTCUSD_FRED", btc_payload), encoding="utf-8")
    (ROOT / "macro_data.js").write_text(js("USDMXN_MACRO", macro_payload), encoding="utf-8")
    return generated, {"DEXMXUS": len(fx), "CBBTCUSD": len(btc), **{key: len(value) for key, value in downloaded.items()}}


def refresh_massive_asset(ticker, output, window_name, market, timezone):
    api_key = os.environ.get("MASSIVE_API_KEY")
    if not api_key:
        return 0
    all_bars = {}
    year = 2018
    while year <= dt.date.today().year:
        end_year = min(year + 1, dt.date.today().year)
        end = min(dt.date(end_year, 12, 31), dt.date.today()).isoformat()
        path = f"https://api.massive.com/v2/aggs/ticker/{ticker}/range/1/day/{year}-01-01/{end}"
        params = urllib.parse.urlencode({"adjusted": "true", "sort": "asc", "limit": 50000, "apiKey": api_key})
        try:
            payload = json.loads(get(f"{path}?{params}"))
            for bar in payload.get("results", []):
                all_bars[bar["t"]] = [bar["t"], bar["o"], bar["h"], bar["l"], bar["c"]]
        except Exception as error:
            print(f"Massive {ticker} batch {year}-{end_year} skipped: {error}")
        year += 2
    if not all_bars:
        return 0
    bars = [all_bars[key] for key in sorted(all_bars)]
    as_date = lambda stamp: dt.datetime.fromtimestamp(stamp / 1000, dt.timezone.utc).date().isoformat()
    payload = {
        "source": f"Massive {market} Custom Bars",
        "ticker": ticker,
        "requestedFrom": "2018-01-01",
        "requestedTo": TODAY,
        "availableFrom": as_date(bars[0][0]),
        "availableTo": as_date(bars[-1][0]),
        "generatedAt": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "timespan": "1 day",
        "timezone": timezone,
        "bars": bars,
    }
    (ROOT / output).write_text(js(window_name, payload), encoding="utf-8")
    return len(bars)


def refresh_massive():
    return {
        "USDMXN": refresh_massive_asset("C:USDMXN", "data.js", "USDMXN_HISTORY", "Forex", "ET"),
        "BTCUSD": refresh_massive_asset("X:BTCUSD", "btc_data.js", "BTCUSD_HISTORY", "Crypto", "UTC"),
    }


if __name__ == "__main__":
    generated_at, counts = refresh_fred()
    massive_counts = refresh_massive()
    status = {
        "generatedAt": generated_at,
        "counts": counts,
        "massiveUpdated": any(massive_counts.values()),
        "massiveBars": massive_counts,
    }
    (ROOT / "data_status.json").write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(status, indent=2))
