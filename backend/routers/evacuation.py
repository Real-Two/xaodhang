"""
evacuation.py — Evacuation route data for HIGH/CRITICAL zones.

GET /evacuation/{zone_id}   — returns route geometry + instructions
GET /evacuation/all         — all zones with evacuation targets

Uses OpenRouteService (ORS) free tier for actual road routing.
ORS free: 2,000 requests/day, no credit card needed.
Sign up at openrouteservice.org → API key → set ORS_API_KEY env var.

If ORS key is not set, returns straight-line bearing + distance as fallback
(still useful for the map overlay — shows direction to safety).

Route is cached in-process (24h TTL) since roads don't change daily.
"""

import math
import os
import time
import urllib.request
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
from database import get_db

router = APIRouter(prefix="/evacuation", tags=["evacuation"])

ORS_API_KEY = os.environ.get("ORS_API_KEY", "")
ORS_URL     = "https://api.openrouteservice.org/v2/directions/driving-car/geojson"

# District HQ / safe evacuation destinations per zone (keyed by name substring)
EVAC_TARGETS = {
    "noney":      {"name": "Noney District HQ",     "lat": 24.9883, "lon": 93.5167, "dist_hq_km": 8},
    "tupul":      {"name": "Noney District HQ",     "lat": 24.9883, "lon": 93.5167, "dist_hq_km": 6},
    "aizawl":    {"name": "Aizawl City",           "lat": 23.7271, "lon": 92.7176, "dist_hq_km": 35},
    "shillong":  {"name": "Jowai Town",            "lat": 25.4500, "lon": 92.2000, "dist_hq_km": 28},
    "kohima":    {"name": "Senapati District HQ",  "lat": 25.2667, "lon": 94.0167, "dist_hq_km": 22},
    "jiribam":   {"name": "Jiribam Town Centre",   "lat": 24.8000, "lon": 93.1000, "dist_hq_km": 4},
    "gangtok":   {"name": "Gangtok City Centre",   "lat": 27.3389, "lon": 88.6065, "dist_hq_km": 12},
    "tawang":    {"name": "Dirang Town",           "lat": 27.3583, "lon": 92.2417, "dist_hq_km": 45},
    "dima hasao": {"name": "Haflong Town",         "lat": 25.1700, "lon": 93.0200, "dist_hq_km": 18},
    "champhai":  {"name": "Champhai Town Centre",  "lat": 23.4588, "lon": 93.3221, "dist_hq_km": 3},
}

# In-process route cache {zone_id: (timestamp, route_dict)}
_route_cache: dict[int, tuple[float, dict]] = {}
CACHE_TTL_S = 86400   # 24 hours


def _match_key(zone_name: str) -> str | None:
    name_lower = zone_name.lower()
    for key in EVAC_TARGETS:
        if key in name_lower:
            return key
    return None


def _haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _bearing(lat1, lon1, lat2, lon2) -> float:
    dlon = math.radians(lon2 - lon1)
    y    = math.sin(dlon) * math.cos(math.radians(lat2))
    x    = (math.cos(math.radians(lat1)) * math.sin(math.radians(lat2)) -
            math.sin(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.cos(dlon))
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _cardinal(bearing: float) -> str:
    dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return dirs[round(bearing / 45) % 8]


def _get_ors_route(from_lat, from_lon, to_lat, to_lon) -> dict | None:
    """Returns ORS GeoJSON route or None on failure."""
    if not ORS_API_KEY:
        return None
    try:
        body = json.dumps({
            "coordinates": [[from_lon, from_lat], [to_lon, to_lat]],
            "instructions": True,
        }).encode()
        req = urllib.request.Request(
            ORS_URL,
            data=body,
            headers={
                "Authorization": ORS_API_KEY,
                "Content-Type":  "application/json",
                "User-Agent":    "Xaodhang/1.0",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        print(f"[EVAC] ORS route failed: {e}")
        return None


def _build_route(zone: models.Zone) -> dict:
    """Core route builder — tries ORS, falls back to straight-line."""
    key    = _match_key(zone.name)
    target = EVAC_TARGETS.get(key) if key else None

    if target is None:
        return {
            "zone_id":        zone.id,
            "zone_name":      zone.name,
            "has_route":      False,
            "reason":         "No evacuation target defined for this zone",
        }

    dist_km = _haversine_km(zone.lat, zone.lon, target["lat"], target["lon"])
    bearing = _bearing(zone.lat, zone.lon, target["lat"], target["lon"])
    card    = _cardinal(bearing)

    base = {
        "zone_id":        zone.id,
        "zone_name":      zone.name,
        "zone_lat":       zone.lat,
        "zone_lon":       zone.lon,
        "target_name":    target["name"],
        "target_lat":     target["lat"],
        "target_lon":     target["lon"],
        "straight_km":    round(dist_km, 2),
        "bearing_deg":    round(bearing, 1),
        "direction":      card,
        "est_road_km":    target["dist_hq_km"],
        "est_time_min":   round(target["dist_hq_km"] / 30 * 60),  # ~30km/h mountain roads
        "has_route":      False,
        "route_geojson":  None,
        "steps":          [],
        "route_source":   "straight-line (ORS key not configured)" if not ORS_API_KEY else "straight-line (ORS failed)",
    }

    ors = _get_ors_route(zone.lat, zone.lon, target["lat"], target["lon"])
    if ors:
        try:
            feature  = ors["features"][0]
            props    = feature["properties"]
            summary  = props["summary"]
            segments = props.get("segments", [{}])
            steps    = segments[0].get("steps", []) if segments else []
            base.update({
                "has_route":     True,
                "route_geojson": feature["geometry"],   # LineString coordinates
                "road_km":       round(summary["distance"] / 1000, 2),
                "est_time_min":  round(summary["duration"] / 60),
                "route_source":  "OpenRouteService (driving-car)",
                "steps": [
                    {
                        "instruction": s.get("instruction", ""),
                        "distance_m":  round(s.get("distance", 0)),
                        "duration_s":  round(s.get("duration", 0)),
                    }
                    for s in steps[:8]   # first 8 steps is enough
                ],
            })
        except (KeyError, IndexError) as e:
            print(f"[EVAC] ORS parse error: {e}")

    return base


@router.get("/{zone_id}")
def get_evacuation_route(zone_id: int, db: Session = Depends(get_db)):
    """
    Returns evacuation route for a zone.
    Response always includes straight-line bearing + estimated road distance.
    If ORS_API_KEY is set, also returns full road geometry and turn-by-turn steps.
    Results are cached 24h.
    """
    now   = time.time()
    cache = _route_cache.get(zone_id)
    if cache and (now - cache[0]) < CACHE_TTL_S:
        return cache[1]

    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    route = _build_route(zone)
    _route_cache[zone_id] = (now, route)
    return route


@router.get("")
def get_all_evacuation_routes(db: Session = Depends(get_db)):
    """
    Returns evacuation route summaries for all zones.
    Useful for the map overlay on initial load — draws all routes at once.
    Only includes zones that have a defined target (the 10 seeded zones).
    """
    zones  = db.query(models.Zone).all()
    routes = []
    now    = time.time()

    for zone in zones:
        cache = _route_cache.get(zone.id)
        if cache and (now - cache[0]) < CACHE_TTL_S:
            routes.append(cache[1])
            continue
        route = _build_route(zone)
        _route_cache[zone.id] = (now, route)
        routes.append(route)

    return [r for r in routes if r.get("has_route") is not False or r.get("straight_km")]
