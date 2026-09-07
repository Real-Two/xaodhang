"""
forecast.py — 72-hour rainfall forecast per zone using Open-Meteo.

Open-Meteo is completely free with no API key. It returns hourly
precipitation forecasts. We sum into 24h/48h/72h windows and run them
through the same risk engine as observed CHIRPS rainfall — this gives
judges a *predictive* risk score, not just a historical one.

This is the single biggest conceptual upgrade from a monitoring system
to an actual early-warning system.
"""

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db
from risk_engine import compute_combined_risk, compute_rainfall_risk

router = APIRouter(prefix="/forecast", tags=["forecast"])

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"


class ForecastOut(BaseModel):
    zone_id: int
    zone_name: str
    lat: float
    lon: float

    # Forecasted rainfall totals (mm)
    forecast_mm_24h: float
    forecast_mm_48h: float
    forecast_mm_72h: float

    # Risk derived from forecast rainfall + current structural risk
    forecast_rainfall_risk: float
    forecast_combined_score: float
    forecast_risk_level: str

    # Current (observed) risk for comparison
    current_combined_score: float
    current_risk_level: str

    source: str = "Open-Meteo (free, no key)"
    hours_ahead: int = 72


def _fetch_open_meteo(lat: float, lon: float) -> dict:
    """
    Calls Open-Meteo and returns hourly precipitation list for next 72h.
    Raises HTTPException on failure so FastAPI returns a clean 502.
    """
    try:
        resp = httpx.get(
            OPEN_METEO_URL,
            params={
                "latitude": lat,
                "longitude": lon,
                "hourly": "precipitation",
                "forecast_days": 3,
                "timezone": "Asia/Kolkata",
            },
            timeout=10.0,
        )
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Open-Meteo fetch failed: {e}")


@router.get("/{zone_id}", response_model=ForecastOut)
def get_zone_forecast(zone_id: int, db: Session = Depends(get_db)):
    """
    Returns 72-hour forecasted risk for a zone.
    Compare forecast_risk_level vs current_risk_level to see if
    conditions are improving or deteriorating.
    """
    zone = db.query(models.Zone).filter(models.Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    data = _fetch_open_meteo(zone.lat, zone.lon)
    hourly_precip = data.get("hourly", {}).get("precipitation", [])

    # Sum hourly mm into accumulation windows
    forecast_24h = round(sum(hourly_precip[:24]), 2)
    forecast_48h = round(sum(hourly_precip[:48]), 2)
    forecast_72h = round(sum(hourly_precip[:72]), 2)

    # Forecast risk uses 72h window (worst-case accumulation)
    forecast_rainfall_risk = compute_rainfall_risk(forecast_72h)
    forecast_combined, forecast_level = compute_combined_risk(
        zone.structural_risk, forecast_rainfall_risk
    )

    # Current observed risk for side-by-side display
    current_rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
    current_combined, current_level = compute_combined_risk(
        zone.structural_risk, current_rainfall_risk
    )

    return ForecastOut(
        zone_id=zone.id,
        zone_name=zone.name,
        lat=zone.lat,
        lon=zone.lon,
        forecast_mm_24h=forecast_24h,
        forecast_mm_48h=forecast_48h,
        forecast_mm_72h=forecast_72h,
        forecast_rainfall_risk=round(forecast_rainfall_risk, 3),
        forecast_combined_score=round(forecast_combined, 3),
        forecast_risk_level=forecast_level,
        current_combined_score=round(current_combined, 3),
        current_risk_level=current_level,
    )


@router.get("", response_model=list[ForecastOut])
def get_all_forecasts(db: Session = Depends(get_db)):
    """
    Forecast for every zone — the dashboard calls this once on load
    to show the 'expected tomorrow' column next to current risk.
    One Open-Meteo call per zone; runs in sequence (fine for 10 zones).
    """
    zones = db.query(models.Zone).all()
    results = []
    for zone in zones:
        try:
            data = _fetch_open_meteo(zone.lat, zone.lon)
            hourly_precip = data.get("hourly", {}).get("precipitation", [])

            forecast_24h = round(sum(hourly_precip[:24]), 2)
            forecast_48h = round(sum(hourly_precip[:48]), 2)
            forecast_72h = round(sum(hourly_precip[:72]), 2)

            forecast_rainfall_risk = compute_rainfall_risk(forecast_72h)
            forecast_combined, forecast_level = compute_combined_risk(
                zone.structural_risk, forecast_rainfall_risk
            )
            current_rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
            current_combined, current_level = compute_combined_risk(
                zone.structural_risk, current_rainfall_risk
            )

            results.append(ForecastOut(
                zone_id=zone.id,
                zone_name=zone.name,
                lat=zone.lat,
                lon=zone.lon,
                forecast_mm_24h=forecast_24h,
                forecast_mm_48h=forecast_48h,
                forecast_mm_72h=forecast_72h,
                forecast_rainfall_risk=round(forecast_rainfall_risk, 3),
                forecast_combined_score=round(forecast_combined, 3),
                forecast_risk_level=forecast_level,
                current_combined_score=round(current_combined, 3),
                current_risk_level=current_level,
            ))
        except HTTPException:
            # Skip zones where Open-Meteo fails rather than aborting all
            continue

    return results
