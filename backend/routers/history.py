"""
history.py — Risk score time-series for trend charts.

GET /history/{zone_id}         — last N readings for one zone
GET /history/{zone_id}/summary — min/max/avg over the window
GET /history                   — latest reading per zone (dashboard overview)

The frontend uses these to render the 7-day risk trend line chart per zone.
"""

import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db

router = APIRouter(prefix="/history", tags=["history"])


class HistoryPoint(BaseModel):
    id: int
    zone_id: int
    zone_name: str
    structural_risk: float
    rainfall_risk: float
    combined_score: float
    risk_level: str
    recorded_at: str   # ISO 8601


class HistorySummary(BaseModel):
    zone_id: int
    zone_name: str
    readings: int
    min_score: float
    max_score: float
    avg_score: float
    trend: str          # "rising" / "falling" / "stable"
    latest_level: str


@router.get("/{zone_id}", response_model=list[HistoryPoint])
def get_zone_history(zone_id: int, limit: int = 48, db: Session = Depends(get_db)):
    """
    Last `limit` risk readings for a zone (default 48 = ~2 days if run hourly).
    For a 7-day chart at 6h intervals, use limit=28.
    """
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    rows = (
        db.query(models.RiskHistory)
        .filter(models.RiskHistory.zone_id == zone_id)
        .order_by(models.RiskHistory.recorded_at.desc())
        .limit(limit)
        .all()
    )
    rows.reverse()   # chronological order for charts

    return [
        HistoryPoint(
            id=r.id,
            zone_id=r.zone_id,
            zone_name=zone.name,
            structural_risk=round(r.structural_risk or 0, 3),
            rainfall_risk=round(r.rainfall_risk or 0, 3),
            combined_score=round(r.combined_score or 0, 3),
            risk_level=r.risk_level or "LOW",
            recorded_at=r.recorded_at.isoformat() if r.recorded_at else "",
        )
        for r in rows
    ]


@router.get("/{zone_id}/summary", response_model=HistorySummary)
def get_zone_summary(zone_id: int, days: int = 7, db: Session = Depends(get_db)):
    """7-day summary with trend direction — good for the dashboard card header."""
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    since = datetime.datetime.utcnow() - datetime.timedelta(days=days)
    rows = (
        db.query(models.RiskHistory)
        .filter(models.RiskHistory.zone_id == zone_id)
        .filter(models.RiskHistory.recorded_at >= since)
        .order_by(models.RiskHistory.recorded_at.asc())
        .all()
    )

    if not rows:
        return HistorySummary(
            zone_id=zone_id, zone_name=zone.name, readings=0,
            min_score=0.0, max_score=0.0, avg_score=0.0,
            trend="stable", latest_level="LOW"
        )

    scores = [r.combined_score or 0.0 for r in rows]
    avg = sum(scores) / len(scores)

    # Simple trend: compare first half avg vs second half avg
    mid = len(scores) // 2
    first_half_avg = sum(scores[:mid]) / max(mid, 1)
    second_half_avg = sum(scores[mid:]) / max(len(scores) - mid, 1)
    delta = second_half_avg - first_half_avg
    trend = "rising" if delta > 0.05 else "falling" if delta < -0.05 else "stable"

    return HistorySummary(
        zone_id=zone_id,
        zone_name=zone.name,
        readings=len(rows),
        min_score=round(min(scores), 3),
        max_score=round(max(scores), 3),
        avg_score=round(avg, 3),
        trend=trend,
        latest_level=rows[-1].risk_level or "LOW",
    )


@router.get("", response_model=list[HistoryPoint])
def get_latest_all_zones(db: Session = Depends(get_db)):
    """
    Most recent history entry per zone — for the dashboard overview table.
    One row per zone, sorted by combined_score descending (highest risk first).
    """
    zones = db.query(models.Zone).all()
    results = []

    for zone in zones:
        latest = (
            db.query(models.RiskHistory)
            .filter(models.RiskHistory.zone_id == zone.id)
            .order_by(models.RiskHistory.recorded_at.desc())
            .first()
        )
        if latest:
            results.append(HistoryPoint(
                id=latest.id,
                zone_id=zone.id,
                zone_name=zone.name,
                structural_risk=round(latest.structural_risk or 0, 3),
                rainfall_risk=round(latest.rainfall_risk or 0, 3),
                combined_score=round(latest.combined_score or 0, 3),
                risk_level=latest.risk_level or "LOW",
                recorded_at=latest.recorded_at.isoformat() if latest.recorded_at else "",
            ))

    results.sort(key=lambda x: x.combined_score, reverse=True)
    return results
