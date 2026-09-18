"""
fetch_rainfall_openmeteo.py — Real-time rainfall via Open-Meteo.

429 fix: added retry with exponential backoff. Open-Meteo rate-limits
burst requests from the same IP (Render's shared IP pool). 3 retries
with 2s/4s/8s backoff handles the burst on startup.
"""

import datetime
import json
import time
import urllib.error
import urllib.request

ARCHIVE_URL  = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TIMEOUT_S    = 12
MAX_RETRIES  = 3

HEADERS = {
    "User-Agent": "Xaodhang-EWS/1.0 (SIH2026; contact=anuragalt2008@gmail.com)",
    "Accept":     "application/json",
}


def _get_with_retry(url: str) -> dict:
    """GET with exponential backoff on 429. Raises on final failure."""
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 2 ** (attempt + 1)   # 2s, 4s, 8s
                print(f"[RAINFALL] 429 rate limit, retrying in {wait}s (attempt {attempt+1}/{MAX_RETRIES})")
                time.sleep(wait)
                continue
            raise
    raise RuntimeError(f"Open-Meteo 429 after {MAX_RETRIES} retries")


def _fetch_archive(lat: float, lon: float, start: str, end: str) -> list[float]:
    url = (
        f"{ARCHIVE_URL}?latitude={lat}&longitude={lon}"
        f"&start_date={start}&end_date={end}"
        f"&daily=precipitation_sum&timezone=UTC"
    )
    data = _get_with_retry(url)
    return [v or 0.0 for v in data["daily"]["precipitation_sum"]]


def _fetch_forecast_past(lat: float, lon: float, past_days: int = 7) -> list[float]:
    url = (
        f"{FORECAST_URL}?latitude={lat}&longitude={lon}"
        f"&daily=precipitation_sum&past_days={past_days}"
        f"&forecast_days=1&timezone=UTC"
    )
    data = _get_with_retry(url)
    return [v or 0.0 for v in data["daily"]["precipitation_sum"]]


def fetch_rainfall(lat: float, lon: float, gee_project: str = None) -> dict:
    now   = datetime.date.today()
    start = (now - datetime.timedelta(days=8)).isoformat()
    end   = (now - datetime.timedelta(days=1)).isoformat()

    daily_mm = None
    source   = "fallback"

    try:
        daily_mm = _fetch_archive(lat, lon, start, end)
        source   = "open-meteo-archive"
    except Exception as e:
        print(f"[RAINFALL] Archive failed ({lat},{lon}): {e} — trying forecast API")

    if daily_mm is None:
        try:
            daily_mm = _fetch_forecast_past(lat, lon, past_days=7)
            source   = "open-meteo-forecast"
        except Exception as e:
            print(f"[RAINFALL] Forecast fallback also failed ({lat},{lon}): {e}")

    if not daily_mm:
        return {"rainfall_mm_24h": 0.0, "rainfall_mm_48h": 0.0,
                "rainfall_mm_72h": 0.0, "source": "fallback"}

    mm_24h = sum(daily_mm[-1:])
    mm_48h = sum(daily_mm[-2:])
    mm_72h = sum(daily_mm[-3:])
    print(f"[RAINFALL] ({lat},{lon}) 24h={mm_24h:.1f} 48h={mm_48h:.1f} 72h={mm_72h:.1f}mm [{source}]")

    return {
        "rainfall_mm_24h": round(mm_24h, 2),
        "rainfall_mm_48h": round(mm_48h, 2),
        "rainfall_mm_72h": round(mm_72h, 2),
        "source": source,
    }
