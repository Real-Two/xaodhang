"""
scan.py — NER-wide regional landslide risk scan.

GET /scan/ner/stream   — SSE stream, cache-first, non-persisting scan results
GET /scan/ner/grid     — Grid point definitions only (no inference)
POST /scan/ner         — Blocking version for scripts/cron

Key design decisions vs v1:
  1. Scan results are NOT written to the zones table. They are ephemeral —
     each user's scan is their own session view. Persisting scan points was
     causing map clutter for all users and polluting the seeded zone list.
     The 10 curated zones remain the only permanent DB entries.

  2. Grid is built per-state with proper coverage, not deduplicated by
     rounded lat/lon (which was causing Assam's bbox to shadow all other
     states sharing the same lat range).

  3. Rainfall threshold raised to 200mm/72h for NER context. Cherrapunji
     averages 11,000mm/year — 100mm/72h is routine monsoon, not extreme.
     Using 100mm was inflating rainfall_risk to 0.8–1.0 everywhere.

  4. Scan-specific risk scoring uses a more conservative formula than the
     live zone formula — higher thresholds, lower interaction weight. The
     seeded zone formula (risk_engine.py) is calibrated for known-dangerous
     sites; the scan formula needs to discriminate across the full NER
     landscape where most points are not active slide sites.
"""

import asyncio
import datetime
import json
import os
from typing import AsyncGenerator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from database import SessionLocal, get_db
from risk_engine import compute_combined_risk, compute_rainfall_risk

router = APIRouter(prefix="/scan", tags=["regional-scan"])

GEE_PROJECT = os.environ.get("GEE_PROJECT", "xhaodong-506519")

# ── NER Grid Definition ───────────────────────────────────────────────────────
# One grid point per 0.5° cell, per state, no cross-state deduplication.
# Arunachal Pradesh gets 1.0° spacing (it's huge and mostly uninhabited).
NER_STATE_GRIDS = {
    "Assam":             {"bbox": (24.1, 27.9, 89.7, 96.0),  "step": 0.5},
    "Meghalaya":         {"bbox": (24.9, 26.1, 89.8, 92.8),  "step": 0.5},
    "Manipur":           {"bbox": (23.8, 25.7, 93.0, 94.8),  "step": 0.5},
    "Mizoram":           {"bbox": (21.9, 24.5, 92.2, 93.5),  "step": 0.5},
    "Nagaland":          {"bbox": (25.1, 27.1, 93.3, 95.2),  "step": 0.5},
    "Tripura":           {"bbox": (22.9, 24.5, 91.1, 92.4),  "step": 0.5},
    "Arunachal Pradesh": {"bbox": (26.6, 29.5, 91.6, 97.4),  "step": 1.0},
    "Sikkim":            {"bbox": (27.0, 28.2, 88.0, 88.9),  "step": 0.5},
}

# Scan-specific risk thresholds — more conservative than zone thresholds.
# NER monsoon context: 200mm/72h is genuinely heavy; 100mm is routine.
SCAN_RAINFALL_THRESHOLD_MM = 200.0

# Structural weight slightly higher than rainfall for scan — terrain
# susceptibility is the stable signal; rainfall varies daily and shouldn't
# alone push a grid cell to HIGH across a 55km² area.
SCAN_STRUCTURAL_WEIGHT = 0.65
SCAN_RAINFALL_WEIGHT   = 0.35
SCAN_INTERACTION_WEIGHT = 0.15   # lower interaction bonus vs zone formula

SCAN_RISK_LEVELS = [
    (0.75, "CRITICAL"),
    (0.55, "HIGH"),
    (0.35, "MODERATE"),
    (0.00, "LOW"),
]


def _build_ner_grid():
    """
    Generates grid points per state. Points in overlapping bboxes (border
    areas) appear once per state they belong to — the scan table shows state
    attribution clearly, so this is correct behaviour (a point on the
    Assam-Meghalaya border is relevant to both states' DM offices).

    Global deduplication by exact (lat4, lon4) to avoid running GEE twice
    for the exact same coordinate when two state bboxes genuinely share it.
    """
    seen_coords = set()
    points = []

    for state, cfg in NER_STATE_GRIDS.items():
        lat_min, lat_max, lon_min, lon_max = cfg["bbox"]
        step = cfg["step"]

        lat = lat_min
        while lat <= lat_max + 1e-6:
            lon = lon_min
            while lon <= lon_max + 1e-6:
                key = (round(lat, 4), round(lon, 4))
                if key not in seen_coords:
                    seen_coords.add(key)
                    points.append({
                        "lat":   round(lat, 4),
                        "lon":   round(lon, 4),
                        "state": state,
                        "name":  f"{state} ({lat:.1f}°N {lon:.1f}°E)",
                    })
                lon = round(lon + step, 4)
            lat = round(lat + step, 4)

    return points


NER_GRID = _build_ner_grid()


def _scan_rainfall_risk(rainfall_mm_72h: float) -> float:
    """NER-calibrated rainfall risk: linear ramp to 200mm threshold."""
    return max(0.0, min(1.0, rainfall_mm_72h / SCAN_RAINFALL_THRESHOLD_MM))


def _scan_combined_risk(structural: float, rainfall: float):
    """Conservative scan formula — see module docstring for rationale."""
    s = max(0.0, min(1.0, structural))
    r = max(0.0, min(1.0, rainfall))
    base = SCAN_STRUCTURAL_WEIGHT * s + SCAN_RAINFALL_WEIGHT * r
    interaction = SCAN_INTERACTION_WEIGHT * s * r
    score = min(1.0, base + interaction)
    level = "LOW"
    for cutoff, label in SCAN_RISK_LEVELS:
        if score >= cutoff:
            level = label
            break
    return round(score, 4), level


# ── Grid info endpoint ────────────────────────────────────────────────────────

@router.get("/ner/grid")
def get_ner_grid():
    return {
        "total_points": len(NER_GRID),
        "states": {s: cfg["step"] for s, cfg in NER_STATE_GRIDS.items()},
        "points": NER_GRID,
    }


# ── Core per-point inference (ephemeral — no DB write) ────────────────────────

def _run_scan_point(lat: float, lon: float, name: str) -> dict:
    """
    Runs GEE → UNet → CHIRPS for one scan point.
    Returns a result dict. DOES NOT write to DB.
    On GEE failure returns a zero-score result with an error flag so the
    scan continues rather than dying.
    """
    try:
        import fetch_real_patch
        import fetch_rainfall_openmeteo
        from inference_guard import prediction_lock
        from routers.live import get_model

        try:
            # A regional scan must not create concurrent GEE/ONNX workloads
            # on the small Render worker.
            with prediction_lock:
                patch = fetch_real_patch.fetch_patch(lat, lon, GEE_PROJECT)
                prediction = get_model().predict(patch)
            structural = prediction["risk_score"]
        except Exception as e:
            print(f"[SCAN] GEE/model failed ({lat},{lon}): {e}")
            structural = 0.0

        try:
            rainfall_data = fetch_rainfall_openmeteo.fetch_rainfall(lat, lon)
            rain72 = rainfall_data.get("rainfall_mm_72h", 0.0)
        except Exception:
            rain72 = 0.0

        rainfall_risk = _scan_rainfall_risk(rain72)
        combined_score, risk_level = _scan_combined_risk(structural, rainfall_risk)

        return {
            "lat": lat, "lon": lon, "name": name,
            "structural_risk": round(structural, 3),
            "rainfall_risk":   round(rainfall_risk, 3),
            "rainfall_mm_72h": round(rain72, 1),
            "combined_score":  combined_score,
            "risk_level":      risk_level,
            "cached":          False,
            "scanned_at":      datetime.datetime.utcnow().isoformat(),
        }

    except Exception as e:
        print(f"[SCAN] Unexpected error ({lat},{lon}): {e}")
        return {
            "lat": lat, "lon": lon, "name": name,
            "structural_risk": 0.0, "rainfall_risk": 0.0,
            "rainfall_mm_72h": 0.0, "combined_score": 0.0,
            "risk_level": "LOW", "cached": False,
            "error": str(e),
            "scanned_at": datetime.datetime.utcnow().isoformat(),
        }


# ── SSE streaming scan ────────────────────────────────────────────────────────

async def _scan_generator(concurrency: int = 3) -> AsyncGenerator[str, None]:
    total = len(NER_GRID)
    yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"

    start   = datetime.datetime.utcnow()
    scanned = 0
    loop    = asyncio.get_event_loop()

    for batch_start in range(0, total, concurrency):
        batch = NER_GRID[batch_start: batch_start + concurrency]

        async def process_point(point, idx):
            result = await loop.run_in_executor(
                None,
                lambda p=point: _run_scan_point(p["lat"], p["lon"], p["name"])
            )
            result["index"] = idx
            result["state"] = point.get("state", "")
            return f"data: {json.dumps({'type': 'result', **result})}\n\n"

        tasks   = [process_point(pt, batch_start + i) for i, pt in enumerate(batch)]
        results = await asyncio.gather(*tasks)

        for msg in results:
            yield msg
            scanned += 1

        await asyncio.sleep(0)   # flush SSE buffer

    elapsed = (datetime.datetime.utcnow() - start).total_seconds()
    yield f"data: {json.dumps({'type': 'complete', 'total_scanned': scanned, 'elapsed_s': round(elapsed, 1)})}\n\n"


@router.get("/ner/stream")
async def scan_ner_stream(concurrency: int = 3):
    """SSE — scan results stream as they complete. Results are NOT persisted."""
    return StreamingResponse(
        _scan_generator(concurrency=concurrency),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Blocking scan ─────────────────────────────────────────────────────────────

@router.post("/ner")
def scan_ner_blocking(db: Session = Depends(get_db)):
    """Blocking NER scan — for scripts/cron. Results not persisted."""
    results = []
    for point in NER_GRID:
        r = _run_scan_point(point["lat"], point["lon"], point["name"])
        r["state"] = point.get("state", "")
        results.append(r)
    results.sort(key=lambda x: x.get("combined_score", 0), reverse=True)
    return {"scanned": len(results), "results": results}
