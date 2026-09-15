"""
Rainfall data — Open-Meteo ERA5-Land (replaces CHIRPS/GEE).

POST /rainfall/{zone_id}        — manual override (testing)
POST /rainfall/fetch/{zone_id}  — fetch current rainfall from Open-Meteo
POST /rainfall/fetch-all        — fetch Open-Meteo for every zone
GET  /rainfall/{zone_id}/risk   — rainfall risk score for a zone

No GEE dependency — Open-Meteo is a direct HTTP call, no API key needed.
ERA5-Land archive has ~5 day lag; forecast API covers the gap as fallback.
"""

import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from risk_engine import compute_rainfall_risk
import fetch_rainfall_openmeteo

router = APIRouter(prefix="/rainfall", tags=["rainfall"])


def _do_fetch(zone: models.Zone, db: Session) -> dict:
    """Fetches Open-Meteo rainfall for a zone and saves to DB."""
    try:
        result = fetch_rainfall_openmeteo.fetch_rainfall(zone.lat, zone.lon)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Open-Meteo fetch failed: {e}")

    zone.rainfall_mm_24h    = result["rainfall_mm_24h"]
    zone.rainfall_mm_48h    = result["rainfall_mm_48h"]
    zone.rainfall_mm_72h    = result["rainfall_mm_72h"]
    zone.rainfall_updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(zone)
    return result


@router.post("/fetch-all")
def fetch_all_rainfall(db: Session = Depends(get_db)):
    """Fetch current Open-Meteo rainfall for every zone and persist."""
    zones   = db.query(models.Zone).all()
    results = []
    for zone in zones:
        try:
            data = _do_fetch(zone, db)
            results.append({
                "zone_id":        zone.id,
                "zone_name":      zone.name,
                "status":         "ok",
                "rainfall_mm_24h": data["rainfall_mm_24h"],
                "rainfall_mm_48h": data["rainfall_mm_48h"],
                "rainfall_mm_72h": data["rainfall_mm_72h"],
                "source":          data.get("source"),
            })
        except HTTPException as e:
            results.append({"zone_id": zone.id, "zone_name": zone.name,
                            "status": "error", "detail": e.detail})
    return results


@router.post("/fetch/{zone_id}")
def fetch_zone_rainfall(zone_id: int, db: Session = Depends(get_db)):
    """Fetch current Open-Meteo rainfall for one zone."""
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    data = _do_fetch(zone, db)
    return {"zone_id": zone_id, "zone_name": zone.name, "status": "ok", **data}


@router.post("/{zone_id}", response_model=schemas.ZoneOut)
def update_rainfall(zone_id: int, payload: schemas.RainfallUpdate,
                    db: Session = Depends(get_db)):
    """Manual rainfall override — for testing."""
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    zone.rainfall_mm_24h    = payload.rainfall_mm_24h
    zone.rainfall_mm_48h    = payload.rainfall_mm_48h
    zone.rainfall_mm_72h    = payload.rainfall_mm_72h
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
    return {"zone_id": zone_id, "rainfall_mm_72h": zone.rainfall_mm_72h,
            "rainfall_risk": risk}
