"""
predict.py — Structural risk prediction endpoints.

POST /predict/auto-all          — fetch GEE patch + run model for all zones
POST /predict/auto/{zone_id}    — fetch GEE patch + run model for one zone
POST /predict/structural/{zone_id} — manual upload fallback (.npy or .h5)
GET  /risk/{zone_id}            — combined risk score for one zone
GET  /risk/all                  — combined risk for every zone, sorted by score
"""

import datetime
import io
import os

import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from ml_service import StructuralRiskModel
from risk_engine import compute_combined_risk, compute_rainfall_risk

GEE_PROJECT = os.environ.get("GEE_PROJECT", "xhaodong-506519")

try:
    import fetch_real_patch
    _GEE_AVAILABLE = True
except ImportError:
    _GEE_AVAILABLE = False

router = APIRouter(tags=["prediction"])

# Load ONNX model once at startup — shared across all requests
_model: StructuralRiskModel | None = None


def get_model() -> StructuralRiskModel:
    global _model
    if _model is None:
        _model = StructuralRiskModel()
    return _model


def _run_model_for_zone(zone: models.Zone, db: Session) -> schemas.PredictOut:
    """
    Core logic: fetch Sentinel-2 + terrain patch from GEE for a zone,
    run ONNX inference, store structural_risk, return result.
    """
    if not _GEE_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="earthengine-api not installed — cannot auto-fetch patches."
        )

    try:
        from gee_auth import initialize_gee
        initialize_gee(GEE_PROJECT)
        patch = fetch_real_patch.fetch_patch(zone.lat, zone.lon, GEE_PROJECT)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"GEE patch fetch failed: {e}")

    model = get_model()
    result = model.predict(patch)

    zone.structural_risk = result["risk_score"]
    zone.structural_updated_at = datetime.datetime.utcnow()
    db.commit()

    return schemas.PredictOut(
        zone_id=zone.id,
        structural_risk=result["risk_score"],
        flagged_fraction=result["flagged_fraction"],
        mask_png_base64=result["mask_png_base64"],
    )


# ---------------------------------------------------------------------------
# Auto endpoints (GEE-powered, no file upload needed)
# ---------------------------------------------------------------------------

@router.post("/predict/auto-all")
def predict_all_zones(db: Session = Depends(get_db)):
    """
    Runs GEE fetch + model inference for every zone.
    Call once after seeding to populate structural_risk across all zones.
    Then update_all_zones.py keeps it fresh on a schedule.
    """
    zones = db.query(models.Zone).all()
    results = []
    for zone in zones:
        try:
            out = _run_model_for_zone(zone, db)
            results.append({
                "zone_id": zone.id,
                "zone_name": zone.name,
                "status": "ok",
                "structural_risk": out.structural_risk,
                "flagged_fraction": out.flagged_fraction,
            })
        except HTTPException as e:
            results.append({
                "zone_id": zone.id,
                "zone_name": zone.name,
                "status": "error",
                "detail": e.detail,
            })
    return results


@router.post("/predict/auto/{zone_id}", response_model=schemas.PredictOut)
def predict_zone_auto(zone_id: int, db: Session = Depends(get_db)):
    """
    Auto-fetches the Sentinel-2 + terrain patch from GEE for a zone
    and runs ONNX inference. No file upload needed.
    """
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    return _run_model_for_zone(zone, db)


# ---------------------------------------------------------------------------
# Manual upload fallback (for local testing without GEE)
# ---------------------------------------------------------------------------

@router.post("/predict/structural/{zone_id}", response_model=schemas.PredictOut)
async def predict_structural(zone_id: int, file: UploadFile = File(...),
                              db: Session = Depends(get_db)):
    """
    Manual fallback: upload a .npy or .h5 patch (14-band, 128x128).
    Use /predict/auto/{zone_id} in production — this is for local testing.
    """
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    contents = await file.read()
    filename = file.filename or ""

    if filename.endswith(".npy"):
        patch = np.load(io.BytesIO(contents))
    elif filename.endswith(".h5"):
        import h5py
        with h5py.File(io.BytesIO(contents), "r") as f:
            key = "img" if "img" in f else list(f.keys())[0]
            patch = f[key][:]
    else:
        raise HTTPException(status_code=400, detail="Upload a .npy or .h5 file.")

    if patch.shape[-1] != 14:
        raise HTTPException(status_code=400,
                            detail=f"Expected 14 bands, got shape {patch.shape}.")

    model = get_model()
    result = model.predict(patch)

    zone.structural_risk = result["risk_score"]
    zone.structural_updated_at = datetime.datetime.utcnow()
    db.commit()

    return schemas.PredictOut(
        zone_id=zone_id,
        structural_risk=result["risk_score"],
        flagged_fraction=result["flagged_fraction"],
        mask_png_base64=result["mask_png_base64"],
    )


# ---------------------------------------------------------------------------
# Risk endpoints
# ---------------------------------------------------------------------------

@router.get("/risk/all")
def get_all_risk(db: Session = Depends(get_db)):
    """
    Combined risk for every zone, sorted highest-first.
    This is the main feed for the dashboard priority list.
    """
    zones = db.query(models.Zone).all()
    results = []
    for zone in zones:
        rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
        combined_score, level = compute_combined_risk(zone.structural_risk, rainfall_risk)
        results.append({
            "zone_id": zone.id,
            "zone_name": zone.name,
            "lat": zone.lat,
            "lon": zone.lon,
            "structural_risk": zone.structural_risk,
            "rainfall_risk": rainfall_risk,
            "rainfall_mm_72h": zone.rainfall_mm_72h,
            "combined_score": round(combined_score, 3),
            "risk_level": level,
            "structural_updated_at": zone.structural_updated_at.isoformat()
                if zone.structural_updated_at else None,
            "rainfall_updated_at": zone.rainfall_updated_at.isoformat()
                if zone.rainfall_updated_at else None,
        })
    results.sort(key=lambda x: x["combined_score"], reverse=True)
    return results


@router.get("/risk/{zone_id}", response_model=schemas.RiskOut)
def get_combined_risk(zone_id: int, db: Session = Depends(get_db)):
    """Combined risk score + level for one zone."""
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
    combined_score, level = compute_combined_risk(zone.structural_risk, rainfall_risk)

    return schemas.RiskOut(
        zone_id=zone.id,
        zone_name=zone.name,
        structural_risk=zone.structural_risk,
        rainfall_risk=rainfall_risk,
        combined_score=combined_score,
        risk_level=level,
    )
