"""
Rainfall data — CHIRPS via Google Earth Engine.

POST /rainfall/{zone_id}        — manual override (testing)
POST /rainfall/fetch/{zone_id}  — auto-fetch from CHIRPS via GEE
POST /rainfall/fetch-all        — fetch CHIRPS for every zone in one call
GET  /rainfall/{zone_id}/risk   — rainfall risk score for a zone
"""

import datetime
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from risk_engine import compute_rainfall_risk

GEE_PROJECT = os.environ.get("GEE_PROJECT", "xhaodong-506519")

try:
    import fetch_rainfall_chirps
    _GEE_AVAILABLE = True
except ImportError:
    _GEE_AVAILABLE = False

router = APIRouter(prefix="/rainfall", tags=["rainfall"])


def _do_gee_fetch(zone: models.Zone, db: Session) -> dict:
    """Fetches CHIRPS rainfall for a zone and saves to DB. Returns the values."""
    if not _GEE_AVAILABLE:
        raise HTTPException(status_code=503, detail="earthengine-api not installed.")
    try:
        from gee_auth import initialize_gee
        initialize_gee(GEE_PROJECT)
        result = fetch_rainfall_chirps.fetch_rainfall(zone.lat, zone.lon, GEE_PROJECT)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GEE/CHIRPS fetch failed: {e}")

    zone.rainfall_mm_24h = result.get("rainfall_mm_24h", 0.0)
    zone.rainfall_mm_48h = result.get("rainfall_mm_48h", 0.0)
    zone.rainfall_mm_72h = result.get("rainfall_mm_72h", 0.0)
    zone.rainfall_updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(zone)
    return result


@router.post("/fetch-all")
def fetch_all_rainfall(db: Session = Depends(get_db)):
    """
    Auto-fetches CHIRPS rainfall from GEE for every zone.
    Call this once to populate all zones, then run update_all_zones.py
    on a schedule to keep it fresh.
    """
    zones = db.query(models.Zone).all()
    results = []
    for zone in zones:
        try:
            data = _do_gee_fetch(zone, db)
            results.append({
                "zone_id": zone.id,
                "zone_name": zone.name,
                "status": "ok",
                "rainfall_mm_24h": data.get("rainfall_mm_24h"),
                "rainfall_mm_48h": data.get("rainfall_mm_48h"),
                "rainfall_mm_72h": data.get("rainfall_mm_72h"),
            })
        except HTTPException as e:
            results.append({"zone_id": zone.id, "zone_name": zone.name,
                            "status": "error", "detail": e.detail})
    return results


@router.post("/fetch/{zone_id}")
def fetch_zone_rainfall(zone_id: int, db: Session = Depends(get_db)):
    """Auto-fetch CHIRPS rainfall for one zone from GEE."""
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    data = _do_gee_fetch(zone, db)
    return {"zone_id": zone_id, "zone_name": zone.name, "status": "ok", **data}


@router.post("/{zone_id}", response_model=schemas.ZoneOut)
def update_rainfall(zone_id: int, payload: schemas.RainfallUpdate,
                   db: Session = Depends(get_db)):
    """Manual rainfall override — useful for testing without GEE."""
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
    return {"zone_id": zone_id, "rainfall_mm_72h": zone.rainfall_mm_72h,
            "rainfall_risk": risk}
