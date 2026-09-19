"""
scan.py — NER-wide regional landslide risk scan.

GET /scan/ner/stream   — SSE stream, cache-first, non-persisting scan results
GET /scan/ner/grid     — Grid point definitions only (no inference)
POST /scan/ner         — Blocking version for scripts/cron

Key design decisions:
  1. Scan results are NOT written to the zones table — ephemeral, per-session.
     The 10 curated zones remain the only permanent DB entries.
  2. Grid built per-state, no cross-shadowing dedup bug.
  3. Rainfall via Open-Meteo (matches the rest of the system — was
     stale-importing fetch_rainfall_chirps before, now fixed).
  4. Scan-specific conservative risk formula — see thresholds below.
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

SCAN_RAINFALL_THRESHOLD_MM = 200.0
SCAN_STRUCTURAL_WEIGHT     = 0.65
SCAN_RAINFALL_WEIGHT       = 0.35
SCAN_INTERACTION_WEIGHT    = 0.15

SCAN_RISK_LEVELS = [
    (0.75, "CRITICAL"),
    (0.55, "HIGH"),
    (0.35, "MODERATE"),
    (0.00, "LOW"),
]


def _build_ner_grid():
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
                        "lat": round(lat, 4), "lon": round(lon, 4),
                        "state": state,
                        "name": f"{state} ({lat:.1f}°N {lon:.1f}°E)",
                    })
                lon = round(lon + step, 4)
            lat = round(lat + step, 4)
    return points


NER_GRID = _build_ner_grid()


def _scan_rainfall_risk(rainfall_mm_72h: float) -> float:
    return max(0.0, min(1.0, rainfall_mm_72h / SCAN_RAINFALL_THRESHOLD_MM))


def _scan_combined_risk(structural: float, rainfall: float):
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


@router.get("/ner/grid")
def get_ner_grid():
    return {
        "total_points": len(NER_GRID),
        "states": {s: cfg["step"] for s, cfg in NER_STATE_GRIDS.items()},
        "points": NER_GRID,
    }


def _run_scan_point(lat: float, lon: float, name: str) -> dict:
    """Runs GEE → UNet → Open-Meteo for one scan point. Never writes to DB."""
    try:
        import fetch_real_patch
        import fetch_rainfall_openmeteo
        from gee_auth import initialize_gee
        from ml_service import StructuralRiskModel

        model = StructuralRiskModel()

        try:
            initialize_gee(GEE_PROJECT)
            patch = fetch_real_patch.fetch_patch(lat, lon, GEE_PROJECT)
            prediction = model.predict(patch)
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

        await asyncio.sleep(0)

    elapsed = (datetime.datetime.utcnow() - start).total_seconds()
    yield f"data: {json.dumps({'type': 'complete', 'total_scanned': scanned, 'elapsed_s': round(elapsed, 1)})}\n\n"


@router.get("/ner/stream")
async def scan_ner_stream(concurrency: int = 3):
    return StreamingResponse(
        _scan_generator(concurrency=concurrency),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/ner")
def scan_ner_blocking(db: Session = Depends(get_db)):
    results = []
    for point in NER_GRID:
        r = _run_scan_point(point["lat"], point["lon"], point["name"])
        r["state"] = point.get("state", "")
        results.append(r)
    results.sort(key=lambda x: x.get("combined_score", 0), reverse=True)
    return {"scanned": len(results), "results": results}
