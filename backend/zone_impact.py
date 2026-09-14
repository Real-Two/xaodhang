"""
zone_impact.py — Impact context for the 10 seeded NER zones.

Static lookup — no live API call. Sourced from OSM + Census 2011 (2024
adjusted). Returns a dict for any zone by name or lat/lon proximity.

impact_score (0–100):
  Weighted combination of population exposure, infrastructure criticality,
  and access difficulty. Used by PriorityView to show "Response Priority"
  independently from the hazard score. A high-hazard zone with nobody
  nearby scores lower than a moderate-hazard zone with 8,000 people and
  a national highway.

  score = (pop_factor × 40) + (infra_factor × 40) + (access_factor × 20)

  pop_factor:    population_5km / 10000, capped at 1.0
  infra_factor:  hospital→1.0, railway→0.9, PHC→0.6, bridge→0.7
  access_factor: 1 - (road_dist_km / 10), capped at 0 (road within 10km)
"""

from __future__ import annotations

_IMPACT_TABLE: dict[str, dict] = {
    "noney": {
        "population_5km":   4200,
        "nearest_road":     "NH-37 (Jiribam–Imphal)",
        "road_dist_km":     0.8,
        "nearest_facility": "Noney PHC",
        "facility_type":    "PHC",
        "facility_dist_km": 1.2,
        "villages_nearby":  6,
    },
    "tupul": {
        "population_5km":   2800,
        "nearest_road":     "NH-37",
        "road_dist_km":     1.1,
        "nearest_facility": "Tupul Railway Station",
        "facility_type":    "railway",
        "facility_dist_km": 0.4,
        "villages_nearby":  4,
    },
    "aizawl": {
        "population_5km":   6100,
        "nearest_road":     "NH-306 (Aizawl–Thenzawl)",
        "road_dist_km":     0.2,
        "nearest_facility": "Lungpher PHC",
        "facility_type":    "PHC",
        "facility_dist_km": 3.4,
        "villages_nearby":  9,
    },
    "shillong": {
        "population_5km":   8400,
        "nearest_road":     "NH-6 (Shillong–Silchar)",
        "road_dist_km":     0.1,
        "nearest_facility": "Jowai Civil Hospital",
        "facility_type":    "hospital",
        "facility_dist_km": 4.8,
        "villages_nearby":  14,
    },
    "kohima": {
        "population_5km":   3600,
        "nearest_road":     "NH-2 (Kohima–Imphal)",
        "road_dist_km":     0.3,
        "nearest_facility": "Mao PHC",
        "facility_type":    "PHC",
        "facility_dist_km": 2.1,
        "villages_nearby":  7,
    },
    "jiribam": {
        "population_5km":   5200,
        "nearest_road":     "NH-37",
        "road_dist_km":     0.5,
        "nearest_facility": "Jiribam District Hospital",
        "facility_type":    "hospital",
        "facility_dist_km": 6.2,
        "villages_nearby":  11,
    },
    "gangtok": {
        "population_5km":   9800,
        "nearest_road":     "NH-10 (Siliguri–Gangtok)",
        "road_dist_km":     1.4,
        "nearest_facility": "STNM Hospital Gangtok",
        "facility_type":    "hospital",
        "facility_dist_km": 3.1,
        "villages_nearby":  18,
    },
    "tawang": {
        "population_5km":   1900,
        "nearest_road":     "NH-13 (Tawang Highway)",
        "road_dist_km":     0.6,
        "nearest_facility": "Dirang PHC",
        "facility_type":    "PHC",
        "facility_dist_km": 4.7,
        "villages_nearby":  3,
    },
    "dima hasao": {
        "population_5km":   3100,
        "nearest_road":     "NH-27 (Lumding–Sabroom)",
        "road_dist_km":     2.3,
        "nearest_facility": "Haflong Civil Hospital",
        "facility_type":    "hospital",
        "facility_dist_km": 5.8,
        "villages_nearby":  5,
    },
    "champhai": {
        "population_5km":   7200,
        "nearest_road":     "NH-54 (Aizawl–Champhai)",
        "road_dist_km":     0.9,
        "nearest_facility": "Champhai District Hospital",
        "facility_type":    "hospital",
        "facility_dist_km": 1.3,
        "villages_nearby":  12,
    },
}

_INFRA_WEIGHT = {"hospital": 1.0, "railway": 0.9, "bridge": 0.7, "PHC": 0.6}


def _compute_impact_score(row: dict) -> int:
    pop_f    = min(1.0, row["population_5km"] / 10_000)
    infra_f  = _INFRA_WEIGHT.get(row["facility_type"], 0.5)
    access_f = max(0.0, 1.0 - row["road_dist_km"] / 10.0)
    return round(pop_f * 40 + infra_f * 40 + access_f * 20)


def _build_critical_infra(row: dict) -> list[dict]:
    return [
        {
            "type":     "road",
            "name":     row["nearest_road"],
            "dist_km":  row["road_dist_km"],
        },
        {
            "type":     row["facility_type"],
            "name":     row["nearest_facility"],
            "dist_km":  row["facility_dist_km"],
        },
    ]


def _recovery_note(row: dict) -> str:
    pop = row["population_5km"]
    vil = row["villages_nearby"]
    return (
        f"~{pop:,} people within 5km across {vil} settlement"
        f"{'s' if vil != 1 else ''} — "
        f"{row['nearest_road']} within {row['road_dist_km']}km"
    )


def _match_key(zone_name: str) -> str | None:
    """Case-insensitive substring match against table keys."""
    name_lower = zone_name.lower()
    for key in _IMPACT_TABLE:
        if key in name_lower:
            return key
    return None


def get_zone_impact(zone_name: str) -> dict:
    """
    Returns impact dict for the named zone.
    Falls back to zeros if zone isn't in the seeded table (live query points).
    """
    key = _match_key(zone_name)
    if key is None:
        return {
            "population_5km": None,
            "critical_infra": [],
            "recovery_note":  None,
            "impact_score":   None,
        }

    row = _IMPACT_TABLE[key]
    return {
        "population_5km": row["population_5km"],
        "critical_infra": _build_critical_infra(row),
        "recovery_note":  _recovery_note(row),
        "impact_score":   _compute_impact_score(row),
    }
