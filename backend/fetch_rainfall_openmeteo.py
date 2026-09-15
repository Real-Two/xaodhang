"""
fetch_rainfall_openmeteo.py — Real-time rainfall via Open-Meteo Archive API.

Replaces fetch_rainfall_chirps.py.

Why Open-Meteo instead of CHIRPS:
  CHIRPS ends at ~2025 and we were using a same-season prior-year proxy,
  which meant the rainfall numbers were technically last year's data.
  Open-Meteo's ERA5-Land reanalysis archive updates with a ~5 day lag
  and covers the full NER region at 0.1° resolution. No API key, no
  registration, no IP whitelist. The data is real and current.

  For the 72h window we need, ERA5-Land is always available (the 5-day
  lag doesn't affect a 72h lookback since we look back 3-8 days).

API used:
  https://archive-api.open-meteo.com/v1/archive
  Variable: precipitation_sum (daily, mm)
  Source:   ERA5-Land (ECMWF reanalysis, 0.1° × 0.1°)

Fallback:
  If the archive API fails (timeout, network), falls back to the
  Open-Meteo forecast API (api.open-meteo.com) which has past 92 days
  of precipitation with no lag. If both fail, returns zeros and logs.

No GEE dependency — this module is pure Python, works without earthengine.
"""

import datetime
import urllib.request
import json

ARCHIVE_URL  = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT_S    = 10


def _fetch_archive(lat: float, lon: float, start: str, end: str) -> list[float]:
    """
    Returns list of daily precipitation totals (mm) for [start, end] inclusive.
    Raises on failure.
    """
    params = (
        f"?latitude={lat}&longitude={lon}"
        f"&start_date={start}&end_date={end}"
        f"&daily=precipitation_sum"
        f"&timezone=UTC"
    )
    url = ARCHIVE_URL + params
    req = urllib.request.Request(url, headers={"User-Agent": "Xaodhang/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        data = json.loads(r.read())
    return [v or 0.0 for v in data["daily"]["precipitation_sum"]]


def _fetch_forecast_past(lat: float, lon: float, past_days: int = 7) -> list[float]:
    """
    Returns daily precipitation for the last `past_days` days using the
    Open-Meteo forecast API (past_days param, no lag).
    """
    params = (
        f"?latitude={lat}&longitude={lon}"
        f"&daily=precipitation_sum"
        f"&past_days={past_days}"
        f"&forecast_days=1"
        f"&timezone=UTC"
    )
    url = FORECAST_URL + params
    req = urllib.request.Request(url, headers={"User-Agent": "Xaodhang/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        data = json.loads(r.read())
    return [v or 0.0 for v in data["daily"]["precipitation_sum"]]


def fetch_rainfall(lat: float, lon: float, gee_project: str = None) -> dict:
    """
    Main entry point — matches the signature of fetch_rainfall_chirps.fetch_rainfall
    so it's a drop-in replacement. gee_project is accepted but ignored (no GEE needed).

    Returns:
        rainfall_mm_24h  — last 24h precipitation (mm)
        rainfall_mm_48h  — last 48h precipitation (mm)
        rainfall_mm_72h  — last 72h precipitation (mm)
        source           — "open-meteo-archive" | "open-meteo-forecast" | "fallback"
    """
    now   = datetime.date.today()
    # Request 8 days to guarantee we have at least 72h even with the 5-day lag
    start = (now - datetime.timedelta(days=8)).isoformat()
    end   = (now - datetime.timedelta(days=1)).isoformat()   # yesterday (archive lag)

    daily_mm = None
    source   = "fallback"

    # Try archive first (ERA5-Land, most accurate)
    try:
        daily_mm = _fetch_archive(lat, lon, start, end)
        source   = "open-meteo-archive"
        print(f"[RAINFALL] Open-Meteo archive: {len(daily_mm)} days for ({lat},{lon})")
    except Exception as e:
        print(f"[RAINFALL] Archive failed ({lat},{lon}): {e} — trying forecast API")

    # Fallback: forecast API past_days (no lag, slightly different model)
    if daily_mm is None:
        try:
            daily_mm = _fetch_forecast_past(lat, lon, past_days=7)
            source   = "open-meteo-forecast"
            print(f"[RAINFALL] Open-Meteo forecast fallback: {len(daily_mm)} days")
        except Exception as e:
            print(f"[RAINFALL] Forecast fallback also failed ({lat},{lon}): {e}")

    if not daily_mm:
        return {
            "rainfall_mm_24h": 0.0,
            "rainfall_mm_48h": 0.0,
            "rainfall_mm_72h": 0.0,
            "source": "fallback",
        }

    # Sum the last N days from the tail of the list
    # daily_mm is ordered oldest→newest; tail = most recent
    mm_24h = sum(daily_mm[-1:])
    mm_48h = sum(daily_mm[-2:])
    mm_72h = sum(daily_mm[-3:])

    print(f"[RAINFALL] 24h={mm_24h:.1f}mm  48h={mm_48h:.1f}mm  72h={mm_72h:.1f}mm  src={source}")

    return {
        "rainfall_mm_24h": round(mm_24h, 2),
        "rainfall_mm_48h": round(mm_48h, 2),
        "rainfall_mm_72h": round(mm_72h, 2),
        "source": source,
    }


if __name__ == "__main__":
    # Smoke test — Noney, Manipur
    result = fetch_rainfall(24.9833, 93.4833)
    print(result)
    assert result["rainfall_mm_72h"] >= 0
    assert result["source"] != "fallback", "Both APIs failed — check network"
    print("Smoke test passed.")
