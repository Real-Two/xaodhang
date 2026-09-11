"""
live.py — on-demand risk prediction for ANY lat/lon in the Northeast region.

Drop this file into: routers/live.py
"""

import datetime
import os

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db
from routers.predict import get_model
from ml_service import StructuralRiskModel
from risk_engine import compute_combined_risk, compute_rainfall_risk

# fetch_real_patch.py and fetch_rainfall_chirps.py live in the project root,
# not inside routers/. Import them as top-level modules — this works because
# uvicorn is always launched from the project root folder, so the root IS
# on Python's path already. The relative sys.path trick fails on Windows
# multiprocessing; this approach does not.
try:
    import fetch_real_patch
    import fetch_rainfall_chirps
    _GEE_ROUTERS_AVAILABLE = True
except Exception as _gee_import_err:
    _GEE_ROUTERS_AVAILABLE = False
    print(f"[WARN] live.py: GEE modules not available: {_gee_import_err}. /predict/live will return 503.")

router = APIRouter(prefix="/predict", tags=["live-prediction"])

GEE_PROJECT = os.environ.get("GEE_PROJECT", "xhaodong-506519")

GRID_SNAP_DEG = 0.01  # ~1.1km — repeat clicks near the same spot reuse the cached zone


class LiveQuery(BaseModel):
    lat: float
    lon: float
    name: str | None = None


class LiveRiskOut(BaseModel):
    zone_id: int
    zone_name: str
    lat: float
    lon: float
    structural_risk: float
    rainfall_risk: float
    rainfall_mm_24h: float
    rainfall_mm_48h: float
    rainfall_mm_72h: float
    combined_score: float
    risk_level: str
    mask_png_base64: str | None = None
    cached: bool
    source: str = "live"


def _snap(value: float, step: float = GRID_SNAP_DEG) -> float:
    return round(value / step) * step


@router.post("/live", response_model=LiveRiskOut)
def predict_live(
    query: LiveQuery,
    db: Session = Depends(get_db),
    model: StructuralRiskModel = Depends(get_model),
):
    lat, lon = _snap(query.lat), _snap(query.lon)

    zone = (
        db.query(models.Zone)
        .filter(models.Zone.lat.between(lat - GRID_SNAP_DEG / 2, lat + GRID_SNAP_DEG / 2))
        .filter(models.Zone.lon.between(lon - GRID_SNAP_DEG / 2, lon + GRID_SNAP_DEG / 2))
        .first()
    )

    mask_png_base64 = None
    cached = zone is not None

    if zone is None:
        if not _GEE_ROUTERS_AVAILABLE:
            raise HTTPException(
                status_code=503,
                detail="Live prediction unavailable: GEE not configured on this server. "
                       "Use the seeded zones via /zones and /risk/{zone_id} instead."
            )
        try:
            patch = fetch_real_patch.fetch_patch(lat, lon, GEE_PROJECT)
        except RuntimeError as e:
            raise HTTPException(status_code=502, detail=f"Satellite fetch failed: {e}")

        prediction = model.predict(patch)
        mask_png_base64 = prediction["mask_png_base64"]

        try:
            rainfall = fetch_rainfall_chirps.fetch_rainfall(lat, lon, GEE_PROJECT)
        except Exception as e:
            print(f"Rainfall fetch failed for ({lat}, {lon}): {e}")
            rainfall = {"rainfall_mm_24h": 0.0, "rainfall_mm_48h": 0.0, "rainfall_mm_72h": 0.0}

        zone = models.Zone(
            name=query.name or f"Live query {lat:.3f}, {lon:.3f}",
            lat=lat,
            lon=lon,
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

    return LiveRiskOut(
        zone_id=zone.id,
        zone_name=zone.name,
        lat=zone.lat,
        lon=zone.lon,
        structural_risk=zone.structural_risk,
        rainfall_risk=rainfall_risk,
        rainfall_mm_24h=zone.rainfall_mm_24h or 0.0,
        rainfall_mm_48h=zone.rainfall_mm_48h or 0.0,
        rainfall_mm_72h=zone.rainfall_mm_72h or 0.0,
        combined_score=combined_score,
        risk_level=risk_level,
        mask_png_base64=mask_png_base64,
        cached=cached,
    )


@router.get("/live", response_model=LiveRiskOut)
def predict_live_get(
    lat: float,
    lon: float,
    name: str = None,
    db: Session = Depends(get_db),
    model: StructuralRiskModel = Depends(get_model),
):
    """GET version of /predict/live for easy browser/frontend use."""
    return predict_live(LiveQuery(lat=lat, lon=lon, name=name), db, model)