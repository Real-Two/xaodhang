import datetime
import io

import h5py
import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from ml_service import StructuralRiskModel
from risk_engine import compute_combined_risk, compute_rainfall_risk

router = APIRouter(tags=["prediction"])

# Loaded once at import time, shared across requests — loading an ONNX
# session per-request would be needlessly slow.
_model: StructuralRiskModel | None = None


def get_model() -> StructuralRiskModel:
    global _model
    if _model is None:
        _model = StructuralRiskModel()
    return _model


def _load_patch(upload_bytes: bytes, filename: str) -> np.ndarray:
    """Accepts either .npy (H,W,14) or .h5 (Landslide4Sense 'img' key)."""
    if filename.endswith(".npy"):
        arr = np.load(io.BytesIO(upload_bytes))
    elif filename.endswith(".h5"):
        with h5py.File(io.BytesIO(upload_bytes), "r") as f:
            key = "img" if "img" in f else list(f.keys())[0]
            arr = f[key][:]
    else:
        raise HTTPException(status_code=400,
                             detail="Upload a .npy or .h5 file (14-band patch).")

    if arr.shape[-1] != 14:
        raise HTTPException(status_code=400,
                             detail=f"Expected 14 bands, got shape {arr.shape}.")
    return arr


@router.post("/predict/structural/{zone_id}", response_model=schemas.PredictOut)
async def predict_structural(zone_id: int, file: UploadFile = File(...),
                              db: Session = Depends(get_db),
                              model: StructuralRiskModel = Depends(get_model)):
    """
    Upload a fresh 14-band satellite patch for a zone. Runs the U-Net,
    stores the resulting structural risk on the zone, and returns the
    probability heatmap as a base64 PNG the frontend can overlay directly.
    """
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    contents = await file.read()
    patch = _load_patch(contents, file.filename)

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


@router.get("/risk/{zone_id}", response_model=schemas.RiskOut)
def get_combined_risk(zone_id: int, db: Session = Depends(get_db)):
    """
    The single number/label the dashboard's priority list should sort by —
    combines the last computed structural risk with the current rainfall
    reading for this zone.
    """
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
