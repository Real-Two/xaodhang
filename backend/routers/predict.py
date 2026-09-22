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
from inference_guard import prediction_lock
from ml_service import StructuralRiskModel, get_shared_model
from risk_engine import compute_combined_risk, compute_rainfall_risk
from seismic import get_seismic_context
from zone_impact import get_zone_impact

GEE_PROJECT = os.environ.get("GEE_PROJECT", "xhaodong-506519")

try:
    import fetch_real_patch
    _GEE_AVAILABLE = True
except ImportError:
    _GEE_AVAILABLE = False

router = APIRouter(tags=["prediction"])

_model: StructuralRiskModel | None = None


def get_model() -> StructuralRiskModel:
    return get_shared_model()


def _run_model_for_zone(zone: models.Zone, db: Session) -> schemas.PredictOut:
    if not _GEE_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="earthengine-api not installed — cannot auto-fetch patches."
        )
    try:
        with prediction_lock:
            from gee_auth import initialize_gee
            initialize_gee(GEE_PROJECT)
            patch = fetch_real_patch.fetch_patch(zone.lat, zone.lon, GEE_PROJECT)
            model = get_model()
            result = model.predict(patch)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"GEE patch fetch failed: {e}")

    zone.structural_risk = result["risk_score"]
    zone.structural_updated_at = datetime.datetime.utcnow()
    db.commit()

    return schemas.PredictOut(
        zone_id=zone.id,
        structural_risk=result["risk_score"],
        flagged_fraction=result["flagged_fraction"],
        mask_png_base64=result["mask_png_base64"],
    )


@router.post("/predict/auto-all")
def predict_all_zones(db: Session = Depends(get_db)):
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
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    return _run_model_for_zone(zone, db)


@router.post("/predict/structural/{zone_id}", response_model=schemas.PredictOut)
async def predict_structural(zone_id: int, file: UploadFile = File(...),
                              db: Session = Depends(get_db)):
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

    with prediction_lock:
        result = get_model().predict(patch)

    zone.structural_risk = result["risk_score"]
    zone.structural_updated_at = datetime.datetime.utcnow()
    db.commit()

    return schemas.PredictOut(
        zone_id=zone_id,
        structural_risk=result["risk_score"],
        flagged_fraction=result["flagged_fraction"],
        mask_png_base64=result["mask_png_base64"],
    )


# ── Risk endpoints ────────────────────────────────────────────────────────────

@router.get("/risk/all")
def get_all_risk(db: Session = Depends(get_db)):
    """
    Combined risk for every zone, sorted highest-first.
    Now includes seismic context and impact metadata.

    Seismic is fetched once per call (cached 30min in seismic.py) and
    applied per-zone based on distance. Impact data is static lookup.
    """
    zones = db.query(models.Zone).all()
    results = []

    for zone in zones:
        # Seismic context — per-zone (distance varies)
        seismic = get_seismic_context(zone.lat, zone.lon)

        rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
        combined_score, level = compute_combined_risk(
            zone.structural_risk,
            rainfall_risk,
            seismic_uplift=seismic["seismic_uplift"],
        )

        # Impact metadata
        impact = get_zone_impact(zone.name)

        results.append({
            "zone_id":    zone.id,
            "zone_name":  zone.name,
            "lat":        zone.lat,
            "lon":        zone.lon,
            "structural_risk": zone.structural_risk,
            "rainfall_risk":   rainfall_risk,
            "rainfall_mm_72h": zone.rainfall_mm_72h,
            "combined_score":  round(combined_score, 3),
            "risk_level":      level,
            # Seismic
            "seismic_uplift":  seismic["seismic_uplift"],
            "seismic_note":    seismic["seismic_note"],
            "seismic_events_72h": seismic["events_72h"],
            "nearest_seismic_event": seismic["nearest_event"],
            # Impact
            "population_5km":  impact["population_5km"],
            "critical_infra":  impact["critical_infra"],
            "recovery_note":   impact["recovery_note"],
            "impact_score":    impact["impact_score"],
            # Timestamps
            "structural_updated_at": zone.structural_updated_at.isoformat()
                if zone.structural_updated_at else None,
            "rainfall_updated_at": zone.rainfall_updated_at.isoformat()
                if zone.rainfall_updated_at else None,
        })

    results.sort(key=lambda x: x["combined_score"], reverse=True)
    return results


@router.get("/risk/{zone_id}")
def get_combined_risk(zone_id: int, db: Session = Depends(get_db)):
    """Combined risk score + seismic + impact for one zone."""
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    seismic = get_seismic_context(zone.lat, zone.lon)
    rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
    combined_score, level = compute_combined_risk(
        zone.structural_risk,
        rainfall_risk,
        seismic_uplift=seismic["seismic_uplift"],
    )
    impact = get_zone_impact(zone.name)

    return {
        "zone_id":    zone.id,
        "zone_name":  zone.name,
        "structural_risk": zone.structural_risk,
        "rainfall_risk":   rainfall_risk,
        "combined_score":  round(combined_score, 3),
        "risk_level":      level,
        "seismic_uplift":  seismic["seismic_uplift"],
        "seismic_note":    seismic["seismic_note"],
        "seismic_events_72h": seismic["events_72h"],
        "nearest_seismic_event": seismic["nearest_event"],
        "population_5km":  impact["population_5km"],
        "critical_infra":  impact["critical_infra"],
        "recovery_note":   impact["recovery_note"],
        "impact_score":    impact["impact_score"],
    }
