"""
live.py — on-demand risk prediction for ANY lat/lon in the Northeast region.
"""

import datetime
import asyncio
import json
import os
from typing import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import SessionLocal, get_db
from inference_guard import prediction_lock
from ml_service import StructuralRiskModel, get_shared_model
from risk_engine import compute_combined_risk, compute_rainfall_risk
from seismic import get_seismic_context
from zone_impact import get_zone_impact

try:
    import fetch_real_patch
    import fetch_rainfall_openmeteo
    _GEE_ROUTERS_AVAILABLE = True
except Exception as _e:
    _GEE_ROUTERS_AVAILABLE = False
    print(f"[WARN] live.py: GEE modules unavailable: {_e}")

router = APIRouter(prefix="/predict", tags=["live-prediction"])

GEE_PROJECT    = os.environ.get("GEE_PROJECT", "xhaodong-506519")
GRID_SNAP_DEG  = 0.01

_model: StructuralRiskModel | None = None


def get_model() -> StructuralRiskModel:
    return get_shared_model()


class LiveQuery(BaseModel):
    lat:  float
    lon:  float
    name: str | None = None


def _snap(v: float, step: float = GRID_SNAP_DEG) -> float:
    return round(v / step) * step


def _do_predict(query: LiveQuery, db: Session, model: StructuralRiskModel) -> dict:
    lat, lon = _snap(query.lat), _snap(query.lon)

    zone = (
        db.query(models.Zone)
        .filter(models.Zone.lat.between(lat - GRID_SNAP_DEG / 2, lat + GRID_SNAP_DEG / 2))
        .filter(models.Zone.lon.between(lon - GRID_SNAP_DEG / 2, lon + GRID_SNAP_DEG / 2))
        .first()
    )

    mask_png_base64 = None
    # Seeded zones exist before their first UNet run.  Presence in SQLite is
    # not a valid cache hit; only a completed structural timestamp is.
    needs_inference = zone is None or zone.structural_updated_at is None
    cached = not needs_inference

    if needs_inference:
        if not _GEE_ROUTERS_AVAILABLE:
            raise HTTPException(
                status_code=503,
                detail="Live prediction unavailable: GEE not configured on this server.",
            )
        # GEE downloads and ONNX inference are memory-heavy.  Render's
        # starter instance cannot safely run two of them at once.
        with prediction_lock:
            try:
                patch = fetch_real_patch.fetch_patch(lat, lon, GEE_PROJECT)
            except RuntimeError as e:
                raise HTTPException(status_code=502, detail=f"Satellite fetch failed: {e}")

            prediction      = model.predict(patch)
            mask_png_base64 = prediction["mask_png_base64"]

        try:
            rainfall = fetch_rainfall_openmeteo.fetch_rainfall(lat, lon)
        except Exception as e:
            print(f"[LIVE] Rainfall fetch failed ({lat},{lon}): {e}")
            rainfall = {"rainfall_mm_24h": 0.0, "rainfall_mm_48h": 0.0, "rainfall_mm_72h": 0.0}

        if zone is None:
            zone = models.Zone(
                name=query.name or f"Live query {lat:.3f},{lon:.3f}",
                lat=lat,
                lon=lon,
            )
            db.add(zone)

        zone.structural_risk = prediction["risk_score"]
        zone.structural_updated_at = datetime.datetime.utcnow()
        zone.rainfall_mm_24h = rainfall["rainfall_mm_24h"]
        zone.rainfall_mm_48h = rainfall["rainfall_mm_48h"]
        zone.rainfall_mm_72h = rainfall["rainfall_mm_72h"]
        zone.rainfall_updated_at = datetime.datetime.utcnow()
        db.commit()
        db.refresh(zone)

    # Seismic context
    seismic       = get_seismic_context(lat, lon)
    rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
    combined_score, risk_level = compute_combined_risk(
        zone.structural_risk,
        rainfall_risk,
        seismic_uplift=seismic["seismic_uplift"],
    )

    # Impact context (None for arbitrary live-query points outside seeded zones)
    impact = get_zone_impact(zone.name)

    return {
        "zone_id":        zone.id,
        "zone_name":      zone.name,
        "lat":            zone.lat,
        "lon":            zone.lon,
        "structural_risk":    zone.structural_risk,
        "rainfall_risk":      rainfall_risk,
        "rainfall_mm_24h":    zone.rainfall_mm_24h or 0.0,
        "rainfall_mm_48h":    zone.rainfall_mm_48h or 0.0,
        "rainfall_mm_72h":    zone.rainfall_mm_72h or 0.0,
        "combined_score":     round(combined_score, 3),
        "risk_level":         risk_level,
        "mask_png_base64":    mask_png_base64,
        "cached":             cached,
        "source":             "live",
        # Seismic
        "seismic_uplift":     seismic["seismic_uplift"],
        "seismic_note":       seismic["seismic_note"],
        "seismic_events_72h": seismic["events_72h"],
        "nearest_seismic_event": seismic["nearest_event"],
        # Impact
        "population_5km":     impact["population_5km"],
        "critical_infra":     impact["critical_infra"],
        "recovery_note":      impact["recovery_note"],
        "impact_score":       impact["impact_score"],
    }


@router.post("/live")
def predict_live_post(
    query: LiveQuery,
    db:    Session              = Depends(get_db),
    model: StructuralRiskModel  = Depends(get_model),
):
    return _do_predict(query, db, model)


@router.get("/live")
def predict_live_get(
    lat:   float,
    lon:   float,
    name:  str | None = None,
    db:    Session              = Depends(get_db),
    model: StructuralRiskModel  = Depends(get_model),
):
    return _do_predict(LiveQuery(lat=lat, lon=lon, name=name), db, model)


def _stream_prediction(query: LiveQuery) -> dict:
    """Runs a streamed request in its own SQLAlchemy session/thread."""
    db = SessionLocal()
    try:
        return _do_predict(query, db, get_model())
    finally:
        db.close()


async def _live_stream(query: LiveQuery) -> AsyncGenerator[str, None]:
    """Keep the HTTP response active while the satellite request is running."""
    yield f"data: {json.dumps({'type': 'start', 'stage': 'satellite'})}\n\n"
    await asyncio.sleep(0)
    try:
        task = asyncio.create_task(asyncio.to_thread(_stream_prediction, query))
        # Render/proxies can close an otherwise idle long-running response.
        # SSE comment frames keep the connection alive without changing UI state.
        while not task.done():
            done, _ = await asyncio.wait({task}, timeout=10)
            if not done:
                yield ": keep-alive\n\n"
        result = await task
        yield f"data: {json.dumps({'type': 'result', 'result': result})}\n\n"
    except HTTPException as exc:
        yield f"data: {json.dumps({'type': 'error', 'detail': exc.detail})}\n\n"
    except Exception as exc:
        print(f"[LIVE] Stream failed: {exc}")
        yield f"data: {json.dumps({'type': 'error', 'detail': 'Live prediction failed.'})}\n\n"


@router.get("/live/stream")
async def predict_live_stream(lat: float, lon: float, name: str | None = None):
    """SSE live inference endpoint for long-running GEE/ONNX predictions."""
    return StreamingResponse(
        _live_stream(LiveQuery(lat=lat, lon=lon, name=name)),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
