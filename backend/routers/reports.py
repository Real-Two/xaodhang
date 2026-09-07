import os
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db

router = APIRouter(prefix="/reports", tags=["reports"])

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}


def _nearest_zone_id(db: Session, lat: float, lon: float) -> int | None:
    """
    Cheap nearest-zone lookup using flat lat/lon distance — fine at the
    scale of a handful of NER district zones. Swap for a proper haversine
    or PostGIS query if the zone count grows into the hundreds.
    """
    zones = db.query(models.Zone).all()
    if not zones:
        return None
    closest = min(zones, key=lambda z: (z.lat - lat) ** 2 + (z.lon - lon) ** 2)
    return closest.id


@router.post("", response_model=schemas.ReportOut)
async def create_report(
    lat: float = Form(...),
    lon: float = Form(...),
    description: str = Form(""),
    zone_id: int | None = Form(None),
    photo: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Citizen or field officer submits a geo-tagged photo report (e.g. visible
    ground cracking, water seepage, debris). If zone_id isn't supplied, the
    report auto-links to the nearest known zone for map clustering.
    """
    ext = os.path.splitext(photo.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400,
                             detail=f"Unsupported file type '{ext}'. Use jpg/png/webp.")

    filename = f"{uuid.uuid4().hex}{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)
    contents = await photo.read()
    with open(filepath, "wb") as f:
        f.write(contents)

    resolved_zone_id = zone_id if zone_id is not None else _nearest_zone_id(db, lat, lon)

    report = models.Report(
        zone_id=resolved_zone_id,
        lat=lat,
        lon=lon,
        description=description,
        photo_path=filepath,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


@router.get("", response_model=list[schemas.ReportOut])
def list_reports(db: Session = Depends(get_db)):
    return db.query(models.Report).order_by(models.Report.created_at.desc()).all()


@router.get("/{report_id}", response_model=schemas.ReportOut)
def get_report(report_id: int, db: Session = Depends(get_db)):
    report = db.query(models.Report).filter(models.Report.id == report_id).first()
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    return report
