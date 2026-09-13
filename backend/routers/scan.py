"""
scan.py — NER-wide regional landslide risk scan.

GET /scan/ner/stream   — SSE stream: scans ~120 grid points across all 8
                         NER states, yields a JSON result per point as they
                         complete. Cache-first: if a zone at that grid cell
                         already exists in the DB it's returned instantly.
                         New points run the full GEE → ONNX → CHIRPS pipeline.

POST /scan/ner         — Same scan but blocking; returns when ALL points done.
                         Useful for batch scripts, not the live UI.

GET /scan/ner/grid     — Just the list of grid points (no inference) — so the
                         frontend can draw the scan coverage overlay before
                         the scan starts.

Design rationale:
  The 10 seeded zones are a DEMO convenience. Real disaster managers need to
  know *any* slope in the NER that is currently elevated risk — not just the
  10 we pre-selected. This endpoint gives them that. A grid at 0.5° spacing
  (~55km) is the right trade-off: dense enough to catch major corridors and
  river valleys, sparse enough to finish in a reasonable time (~3-5 min for
  the full set via GEE).

  For the demo, the scan streams results live so judges can see the
  priority list build up in real time as the model processes each cell.
"""

import asyncio
import datetime
import json
import os
from typing import AsyncGenerator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

import models
from database import SessionLocal, get_db
from risk_engine import compute_combined_risk, compute_rainfall_risk

router = APIRouter(prefix="/scan", tags=["regional-scan"])

GEE_PROJECT = os.environ.get("GEE_PROJECT", "xhaodong-506519")
GRID_SNAP = 0.01  # must match live.py so cache lookup is consistent

# ── NER Grid Definition ───────────────────────────────────────────────────────
# ~0.5° spacing across the bounding box of all 8 NER states.
# State approximate bounding boxes (lat_min, lat_max, lon_min, lon_max):
NER_STATES = {
    "Assam":              (24.1, 27.9, 89.7, 96.0),
    "Meghalaya":          (24.9, 26.1, 89.8, 92.8),
    "Manipur":            (23.8, 25.7, 93.0, 94.8),
    "Mizoram":            (21.9, 24.5, 92.2, 93.5),
    "Nagaland":           (25.1, 27.1, 93.3, 95.2),
    "Tripura":            (22.9, 24.5, 91.1, 92.4),
    "Arunachal Pradesh":  (26.6, 29.5, 91.6, 97.4),
    "Sikkim":             (27.0, 28.2, 88.0, 88.9),
}

GRID_STEP = 0.5   # degrees — ~55 km at NER latitudes


def _build_ner_grid():
    """
    Generates a deduplicated list of (lat, lon, state_name) for all grid
    cells that fall inside at least one NER state bounding box.
    """
    seen = set()
    points = []

    for state, (lat_min, lat_max, lon_min, lon_max) in NER_STATES.items():
        lat = lat_min
        while lat <= lat_max + 1e-6:
            lon = lon_min
            while lon <= lon_max + 1e-6:
                key = (round(lat, 1), round(lon, 1))
                if key not in seen:
                    seen.add(key)
                    points.append({
                        "lat": round(lat, 4),
                        "lon": round(lon, 4),
                        "state": state,
                        "name": f"{state} ({lat:.1f}N, {lon:.1f}E)",
                    })
                lon += GRID_STEP
            lat += GRID_STEP

    return points


NER_GRID = _build_ner_grid()


# ── Grid info endpoint (no inference) ────────────────────────────────────────

@router.get("/ner/grid")
def get_ner_grid():
    """Returns the full list of grid points that will be scanned."""
    return {
        "total_points": len(NER_GRID),
        "grid_step_deg": GRID_STEP,
        "states": list(NER_STATES.keys()),
        "points": NER_GRID,
    }


# ── Core scan logic ───────────────────────────────────────────────────────────

def _snap(value: float, step: float = GRID_SNAP) -> float:
    return round(value / step) * step


def _cached_zone(lat: float, lon: float, db: Session):
    """Return existing zone if one is snapped to this grid cell."""
    slat, slon = _snap(lat), _snap(lon)
    return (
        db.query(models.Zone)
        .filter(models.Zone.lat.between(slat - GRID_SNAP / 2, slat + GRID_SNAP / 2))
        .filter(models.Zone.lon.between(slon - GRID_SNAP / 2, slon + GRID_SNAP / 2))
        .first()
    )


def _score_from_zone(zone: models.Zone, cached: bool, point_meta: dict) -> dict:
    """Build the result dict from a Zone ORM object."""
    rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h or 0)
    combined_score, risk_level = compute_combined_risk(zone.structural_risk or 0, rainfall_risk)
    return {
        "lat": zone.lat,
        "lon": zone.lon,
        "name": zone.name,
        "state": point_meta.get("state", ""),
        "zone_id": zone.id,
        "structural_risk": round(zone.structural_risk or 0, 3),
        "rainfall_risk": round(rainfall_risk, 3),
        "rainfall_mm_72h": round(zone.rainfall_mm_72h or 0, 1),
        "combined_score": round(combined_score, 3),
        "risk_level": risk_level,
        "cached": cached,
        "scanned_at": datetime.datetime.utcnow().isoformat(),
    }


def _run_live_point(lat: float, lon: float, name: str) -> dict | None:
    """
    Runs the full pipeline for a single new point.
    Returns a result dict or None on failure (failures are soft — scan continues).
    """
    db = SessionLocal()
    try:
        import fetch_real_patch
        import fetch_rainfall_chirps
        from ml_service import StructuralRiskModel

        model = StructuralRiskModel()

        try:
            patch = fetch_real_patch.fetch_patch(lat, lon, GEE_PROJECT)
        except Exception as e:
            print(f"[SCAN] GEE patch failed for ({lat}, {lon}): {e}")
            return {
                "lat": lat, "lon": lon, "name": name,
                "structural_risk": 0.0, "rainfall_risk": 0.0,
                "rainfall_mm_72h": 0.0, "combined_score": 0.0,
                "risk_level": "LOW", "cached": False,
                "error": str(e),
                "scanned_at": datetime.datetime.utcnow().isoformat(),
            }

        prediction = model.predict(patch)

        try:
            rainfall = fetch_rainfall_chirps.fetch_rainfall(lat, lon, GEE_PROJECT)
        except Exception:
            rainfall = {"rainfall_mm_24h": 0.0, "rainfall_mm_48h": 0.0, "rainfall_mm_72h": 0.0}

        slat, slon = _snap(lat), _snap(lon)
        zone = models.Zone(
            name=name,
            lat=slat,
            lon=slon,
            structural_risk=prediction["risk_score"],
            structural_updated_at=datetime.datetime.utcnow(),
            rainfall_mm_24h=rainfall["rainfall_mm_24h"],
            rainfall_mm_48h=rainfall["rainfall_mm_48h"],
            rainfall_mm_72h=rainfall["rainfall_mm_72h"],
            rainfall_updated_at=datetime.datetime.utcnow(),
        )
        db.add(zone)
        db.commit()
        db.refresh(zone)

        rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
        combined_score, risk_level = compute_combined_risk(zone.structural_risk, rainfall_risk)

        return {
            "lat": zone.lat,
            "lon": zone.lon,
            "name": zone.name,
            "zone_id": zone.id,
            "structural_risk": round(zone.structural_risk, 3),
            "rainfall_risk": round(rainfall_risk, 3),
            "rainfall_mm_72h": round(zone.rainfall_mm_72h, 1),
            "combined_score": round(combined_score, 3),
            "risk_level": risk_level,
            "cached": False,
            "scanned_at": datetime.datetime.utcnow().isoformat(),
        }

    except Exception as e:
        print(f"[SCAN] Unexpected error at ({lat}, {lon}): {e}")
        return None
    finally:
        db.close()


# ── SSE streaming scan endpoint ───────────────────────────────────────────────

async def _scan_generator(concurrency: int = 4) -> AsyncGenerator[str, None]:
    """
    Async generator that yields SSE-formatted JSON lines.

    Each event is one of:
      data: {"type": "start",    "total": N}
      data: {"type": "result",   ...zone data..., "index": i}
      data: {"type": "skip",     "lat": ..., "lon": ..., "index": i}
      data: {"type": "complete", "total_scanned": N, "elapsed_s": T}

    Cached zones are yielded immediately (no GEE call).
    New zones are dispatched in a thread pool, `concurrency` at a time.
    """
    total = len(NER_GRID)
    yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"

    start = datetime.datetime.utcnow()
    scanned = 0
    loop = asyncio.get_event_loop()

    BATCH = concurrency
    for batch_start in range(0, total, BATCH):
        batch = NER_GRID[batch_start: batch_start + BATCH]

        async def process_point(point, idx):
            db = SessionLocal()
            try:
                cached_zone = _cached_zone(point["lat"], point["lon"], db)
                if cached_zone:
                    result = _score_from_zone(cached_zone, True, point)
                    result["index"] = idx
                    return f"data: {json.dumps({'type': 'result', **result})}\n\n"
                else:
                    result = await loop.run_in_executor(
                        None,
                        lambda p=point: _run_live_point(p["lat"], p["lon"], p["name"])
                    )
                    if result:
                        result["index"] = idx
                        result["state"] = point.get("state", "")
                        return f"data: {json.dumps({'type': 'result', **result})}\n\n"
                    else:
                        return f"data: {json.dumps({'type': 'skip', 'lat': point['lat'], 'lon': point['lon'], 'index': idx})}\n\n"
            finally:
                db.close()

        tasks = [
            process_point(point, batch_start + i)
            for i, point in enumerate(batch)
        ]
        results = await asyncio.gather(*tasks)

        for msg in results:
            yield msg
            scanned += 1

        await asyncio.sleep(0)

    elapsed = (datetime.datetime.utcnow() - start).total_seconds()
    yield f"data: {json.dumps({'type': 'complete', 'total_scanned': scanned, 'elapsed_s': round(elapsed, 1)})}\n\n"


@router.get("/ner/stream")
async def scan_ner_stream(concurrency: int = 4):
    """
    SSE endpoint — streams scan results as they complete.
    Frontend connects with EventSource or fetch+ReadableStream.
    """
    return StreamingResponse(
        _scan_generator(concurrency=concurrency),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ── Blocking scan (for scripts / cron) ───────────────────────────────────────

@router.post("/ner")
def scan_ner_blocking(db: Session = Depends(get_db)):
    """
    Blocking version of the NER scan. Runs all grid points sequentially.
    Use /scan/ner/stream for the live dashboard UI.
    """
    results = []
    errors = []

    for point in NER_GRID:
        cached_zone = _cached_zone(point["lat"], point["lon"], db)
        if cached_zone:
            result = _score_from_zone(cached_zone, True, point)
            result["state"] = point.get("state", "")
            results.append(result)
        else:
            result = _run_live_point(point["lat"], point["lon"], point["name"])
            if result:
                result["state"] = point.get("state", "")
                results.append(result)
            else:
                errors.append({"lat": point["lat"], "lon": point["lon"], "error": "pipeline failed"})

    results.sort(key=lambda x: x.get("combined_score", 0), reverse=True)

    return {
        "scanned": len(results),
        "errors": len(errors),
        "results": results,
        "error_detail": errors,
    }
