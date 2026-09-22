"""
fetch_rainfall_openmeteo.py — ERA5-Land rainfall via Open-Meteo forecast API.
Replaces CHIRPS. No GEE dependency. No data lag (forecast past_days).
"""

import datetime
import json
import time
import urllib.error
import urllib.request

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL  = "https://archive-api.open-meteo.com/v1/archive"
TIMEOUT_S    = 12
MAX_RETRIES  = 3

HEADERS = {
    "User-Agent": "Xaodhang-EWS/1.0 (SIH2026; contact=anuragalt2008@gmail.com)",
    "Accept":     "application/json",
}


def _get_with_retry(url: str) -> dict:
    for attempt in range(MAX_RETRIES):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 30 * (attempt + 1)
                print(f"[RAINFALL] 429 rate limit — waiting {wait}s")
                time.sleep(wait)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if attempt == MAX_RETRIES - 1:
                raise RuntimeError(f"Open-Meteo request failed after {MAX_RETRIES} attempts: {e}") from e
            wait = 2 * (attempt + 1)
            print(f"[RAINFALL] transient request failure — retrying in {wait}s: {e}")
            time.sleep(wait)
    raise RuntimeError(f"Open-Meteo 429 after {MAX_RETRIES} retries")


def fetch_rainfall(lat: float, lon: float, gee_project: str = None) -> dict:
    """
    Returns 24h, 48h, 72h cumulative precipitation (mm) from ERA5-Land.
    Uses forecast API with past_days=10, forecast_days=0 — no data lag.
    Falls back to archive (end=today-4) if forecast fails.
    """
    daily_mm = None
    source   = "fallback"

    # Primary: forecast past_days (no lag, always has yesterday)
    try:
        url = (
            f"{FORECAST_URL}?latitude={lat}&longitude={lon}"
            f"&daily=precipitation_sum&past_days=10"
            f"&forecast_days=0&timezone=UTC"
        )
        data     = _get_with_retry(url)
        daily_mm = [v or 0.0 for v in data["daily"]["precipitation_sum"]]
        source   = "open-meteo-forecast"
    except Exception as e:
        print(f"[RAINFALL] Forecast failed ({lat},{lon}): {e} — trying archive")

    # Fallback: archive (stop at today-4 to avoid lag-induced zeros)
    if daily_mm is None:
        try:
            now   = datetime.date.today()
            end   = (now - datetime.timedelta(days=4)).isoformat()
            start = (now - datetime.timedelta(days=12)).isoformat()
            url = (
                f"{ARCHIVE_URL}?latitude={lat}&longitude={lon}"
                f"&start_date={start}&end_date={end}"
                f"&daily=precipitation_sum&timezone=UTC"
            )
            data     = _get_with_retry(url)
            daily_mm = [v or 0.0 for v in data["daily"]["precipitation_sum"]]
            source   = "open-meteo-archive"
        except Exception as e:
            print(f"[RAINFALL] Archive also failed ({lat},{lon}): {e}")

    if not daily_mm:
        return {"rainfall_mm_24h": 0.0, "rainfall_mm_48h": 0.0,
                "rainfall_mm_72h": 0.0, "source": "fallback"}

    mm_24h = sum(daily_mm[-1:])
    mm_48h = sum(daily_mm[-2:])
    mm_72h = sum(daily_mm[-3:])

    print(f"[RAINFALL] ({lat},{lon}) 72h={mm_72h:.1f}mm [{source}]")
    return {
        "rainfall_mm_24h": round(mm_24h, 2),
        "rainfall_mm_48h": round(mm_48h, 2),
        "rainfall_mm_72h": round(mm_72h, 2),
        "source": source,
    }


def fetch_rainfall_many(coordinates: list[tuple[float, float]]) -> list[dict]:
    """Fetch rainfall for many locations in one Open-Meteo request."""
    if not coordinates:
        return []

    lats = ",".join(str(lat) for lat, _ in coordinates)
    lons = ",".join(str(lon) for _, lon in coordinates)
    url = (
        f"{FORECAST_URL}?latitude={lats}&longitude={lons}"
        f"&daily=precipitation_sum&past_days=10&forecast_days=0&timezone=UTC"
    )
    data = _get_with_retry(url)
    records = data if isinstance(data, list) else [data]
    if len(records) != len(coordinates):
        raise RuntimeError(
            f"Open-Meteo returned {len(records)} locations for {len(coordinates)} requests"
        )

    results = []
    for (lat, lon), record in zip(coordinates, records):
        daily = record.get("daily", {}).get("precipitation_sum") or []
        daily_mm = [value or 0.0 for value in daily]
        if not daily_mm:
            raise RuntimeError(f"Open-Meteo returned no daily rainfall for ({lat}, {lon})")
        results.append({
            "rainfall_mm_24h": round(sum(daily_mm[-1:]), 2),
            "rainfall_mm_48h": round(sum(daily_mm[-2:]), 2),
            "rainfall_mm_72h": round(sum(daily_mm[-3:]), 2),
            "source": "open-meteo-forecast",
        })
    return results
