from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db

router = APIRouter(prefix="/zones", tags=["zones"])


@router.get("", response_model=list[schemas.ZoneOut])
def list_zones(db: Session = Depends(get_db)):
    """All monitored zones — this is what the GIS map polls to draw markers."""
    return db.query(models.Zone).all()


@router.get("/{zone_id}", response_model=schemas.ZoneOut)
def get_zone(zone_id: int, db: Session = Depends(get_db)):
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    return zone

from fastapi import Response

@router.head("")
def head_zones():
    return Response(status_code=200)

@router.post("", response_model=schemas.ZoneOut)
def create_zone(zone: schemas.ZoneCreate, db: Session = Depends(get_db)):
    db_zone = models.Zone(name=zone.name, lat=zone.lat, lon=zone.lon)
    db.add(db_zone)
    db.commit()
    db.refresh(db_zone)
    return db_zone
