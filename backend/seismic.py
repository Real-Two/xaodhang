"""
seismic.py — NCS/USGS earthquake feed → seismic uplift factor.

uplift ∈ [0, 0.08]. Adds to structural_risk before the risk formula.
Max effect on combined score: 0.08 × 0.60 = 0.048 (<5 percentage points).

Results are in-process cached for 30 minutes so the USGS API isn't
hammered on every /risk/all poll (which runs every 60s in the frontend).
"""

import datetime
import json
import math
import threading
import urllib.request

MAX_UPLIFT     = 0.08
MAX_RADIUS_KM  = 300.0
LOOKBACK_HOURS = 72
FETCH_TIMEOUT  = 8
CACHE_TTL_MIN  = 30

USGS_URL = (
    "https://earthquake.usgs.gov/fdsnws/event/1/query"
    "?format=geojson&minmagnitude=3.0&orderby=time&limit=100"
    "&minlatitude=20.0&maxlatitude=30.0"
    "&minlongitude=87.0&maxlongitude=98.0"
)

# ── In-process event cache ────────────────────────────────────────────────────
_cache_lock   = threading.Lock()
_cached_events: list[dict] = []
_cache_fetched_at: datetime.datetime | None = None


def _haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _magnitude_factor(mag: float) -> float:
    """Piecewise linear: M<3→0, M4→0.30, M5→0.65, M6→0.90, M≥6.5→1.0"""
    if mag < 3.0:  return 0.0
    if mag >= 6.5: return 1.0
    if mag < 4.0:  return 0.30 * (mag - 3.0)
    if mag < 5.0:  return 0.30 + 0.35 * (mag - 4.0)
    if mag < 6.0:  return 0.65 + 0.25 * (mag - 5.0)
    return 0.90 + 0.10 * (mag - 6.0)


def _recency_factor(hours_ago: float) -> float:
    if hours_ago < 12: return 1.00
    if hours_ago < 24: return 0.70
    if hours_ago < 48: return 0.40
    return 0.20


def _get_events() -> list[dict]:
    """Returns cached USGS events, refreshing if cache is stale."""
    global _cached_events, _cache_fetched_at

    with _cache_lock:
        age = (datetime.datetime.utcnow() - _cache_fetched_at).total_seconds() / 60 \
              if _cache_fetched_at else float("inf")

        if age < CACHE_TTL_MIN:
            return _cached_events

        # Fetch fresh
        try:
            req = urllib.request.Request(USGS_URL, headers={"User-Agent": "Xaodhang/1.0"})
            with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as r:
                data = json.loads(r.read())
            events = []
            for feat in data.get("features", []):
                p = feat.get("properties", {})
                c = feat.get("geometry", {}).get("coordinates", [None, None])
                t = p.get("time")
                if t is None or c[0] is None:
                    continue
                events.append({
                    "lat":       c[1],
                    "lon":       c[0],
                    "magnitude": p.get("mag") or 0.0,
                    "time_utc":  datetime.datetime.utcfromtimestamp(t / 1000),
                    "place":     p.get("place", ""),
                })
            _cached_events    = events
            _cache_fetched_at = datetime.datetime.utcnow()
            print(f"[SEISMIC] Refreshed: {len(events)} events from USGS")
        except Exception as e:
            print(f"[SEISMIC] USGS fetch failed: {e} — using stale cache")

        return _cached_events


def get_seismic_context(lat: float, lon: float) -> dict:
    """
    Returns a dict with:
      seismic_uplift       — float [0, 0.08], added to structural_risk
      seismic_note         — str | None, human-readable context
      events_72h           — int, number of qualifying events nearby
      nearest_event        — dict | None, closest event details
    """
    now    = datetime.datetime.utcnow()
    cutoff = now - datetime.timedelta(hours=LOOKBACK_HOURS)

    best_uplift  = 0.0
    best_note    = None
    nearest_ev   = None
    nearest_dist = float("inf")
    event_count  = 0

    for ev in _get_events():
        if ev["time_utc"] < cutoff:
            continue
        dist_km   = _haversine_km(lat, lon, ev["lat"], ev["lon"])
        if dist_km > MAX_RADIUS_KM:
            continue

        event_count += 1
        hours_ago = (now - ev["time_utc"]).total_seconds() / 3600

        uplift = (MAX_UPLIFT
                  * _magnitude_factor(ev["magnitude"])
                  * max(0.0, 1.0 - dist_km / MAX_RADIUS_KM)
                  * _recency_factor(hours_ago))

        if uplift > best_uplift:
            best_uplift = uplift
            if uplift > 0.01:   # surface note only if contribution ≥1pp
                severity = (
                    "significant seismic loading"    if ev["magnitude"] >= 5.5 else
                    "moderate slope stress"           if ev["magnitude"] >= 4.5 else
                    "minor slope weakening possible"
                )
                best_note = (
                    f"M{ev['magnitude']:.1f} quake {dist_km:.0f}km away "
                    f"({hours_ago:.0f}h ago) — {severity}"
                )

        if dist_km < nearest_dist:
            nearest_dist = dist_km
            nearest_ev   = {
                "magnitude": ev["magnitude"],
                "dist_km":   round(dist_km, 1),
                "hours_ago": round(hours_ago, 1),
                "place":     ev["place"],
            }

    return {
        "seismic_uplift": round(min(best_uplift, MAX_UPLIFT), 4),
        "seismic_note":   best_note,
        "events_72h":     event_count,
        "nearest_event":  nearest_ev,
    }


# keep old name as alias for scan.py
def compute_seismic_uplift(lat: float, lon: float) -> tuple[float, str | None]:
    ctx = get_seismic_context(lat, lon)
    return ctx["seismic_uplift"], ctx["seismic_note"]


if __name__ == "__main__":
    ctx = get_seismic_context(24.98, 93.48)
    print(f"uplift={ctx['seismic_uplift']:.4f}  events={ctx['events_72h']}")
    print(f"note={ctx['seismic_note']}")
    print(f"nearest={ctx['nearest_event']}")
    assert 0.0 <= ctx["seismic_uplift"] <= MAX_UPLIFT
    print("OK")
