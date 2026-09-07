"""
Rainfall data enters the system through POST /rainfall/{zone_id}. For the
hackathon demo, this can be called manually or by a small scheduled script
you write later that pulls CHIRPS/IMD data and pushes it here — the endpoint
doesn't care where the numbers come from, which keeps that integration
decoupled from everything else.
"""

import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from risk_engine import compute_rainfall_risk

router = APIRouter(prefix="/rainfall", tags=["rainfall"])


@router.post("/{zone_id}", response_model=schemas.ZoneOut)
def update_rainfall(zone_id: int, payload: schemas.RainfallUpdate, db: Session = Depends(get_db)):
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    zone.rainfall_mm_24h = payload.rainfall_mm_24h
    zone.rainfall_mm_48h = payload.rainfall_mm_48h
    zone.rainfall_mm_72h = payload.rainfall_mm_72h
    zone.rainfall_updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(zone)
    return zone


@router.get("/{zone_id}/risk")
def get_rainfall_risk(zone_id: int, db: Session = Depends(get_db)):
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    risk = compute_rainfall_risk(zone.rainfall_mm_72h)
    return {
        "zone_id": zone_id,
        "rainfall_mm_72h": zone.rainfall_mm_72h,
        "rainfall_risk": risk,
    }
