import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class ZoneCreate(BaseModel):
    name: str
    lat: float
    lon: float


class ZoneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    lat: float
    lon: float
    structural_risk: float
    rainfall_mm_24h: float
    rainfall_mm_48h: float
    rainfall_mm_72h: float
    structural_updated_at: Optional[datetime.datetime] = None
    rainfall_updated_at: Optional[datetime.datetime] = None


class RainfallUpdate(BaseModel):
    rainfall_mm_24h: float
    rainfall_mm_48h: float
    rainfall_mm_72h: float


class RiskOut(BaseModel):
    zone_id: int
    zone_name: str
    structural_risk: float
    rainfall_risk: float
    combined_score: float
    risk_level: str


class PredictOut(BaseModel):
    zone_id: int
    structural_risk: float
    flagged_fraction: float
    mask_png_base64: str


class ReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    zone_id: Optional[int] = None
    lat: float
    lon: float
    description: Optional[str] = None
    photo_path: Optional[str] = None
    status: str
    created_at: datetime.datetime
