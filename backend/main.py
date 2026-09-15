"""
main.py — Xaodhang API entry point.
"""

import datetime
import threading

import database
import models
from database import Base, engine, get_db
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from risk_engine import compute_combined_risk, compute_rainfall_risk
from routers import (alerts, chatbot, evacuation, forecast, history, live,
                     predict, rainfall, reports, zones, scan)

Base.metadata.create_all(bind=engine)

NER_ZONES = [
    {"name": "Noney, Manipur (2022 landslide site)",  "lat": 24.9833, "lon": 93.4833},
    {"name": "Tupul, Manipur (railway landslide)",     "lat": 24.9500, "lon": 93.5000},
    {"name": "Aizawl-Thenzawl Highway, Mizoram",      "lat": 23.5000, "lon": 92.8000},
    {"name": "Shillong-Silchar NH6, Meghalaya",       "lat": 25.1000, "lon": 92.0000},
    {"name": "Kohima-Imphal NH2, Nagaland",           "lat": 25.4000, "lon": 94.1000},
    {"name": "Jiribam-Imphal Highway, Manipur",       "lat": 24.8000, "lon": 93.1200},
    {"name": "Gangtok-Nathula, Sikkim",               "lat": 27.3300, "lon": 88.6200},
    {"name": "Tawang Highway, Arunachal Pradesh",     "lat": 27.5800, "lon": 91.8600},
    {"name": "Dima Hasao District, Assam",            "lat": 25.5700, "lon": 93.0500},
    {"name": "Champhai, Mizoram (border zone)",       "lat": 23.4600, "lon": 93.3300},
]


def _auto_seed():
    from database import SessionLocal
    db = SessionLocal()
    try:
        if db.query(models.Zone).count() == 0:
            for z in NER_ZONES:
                db.add(models.Zone(**z))
            db.commit()
            print(f"[SEED] Auto-seeded {len(NER_ZONES)} NER zones.")
        else:
            print("[SEED] Zones already present — skipping.")
    finally:
        db.close()


def _startup_pipeline():
    def _run():
        import time
        time.sleep(5)

        import fetch_rainfall_openmeteo
        from database import SessionLocal
        from routers.predict import _run_model_for_zone

        db = SessionLocal()
        try:
            blank = [z for z in db.query(models.Zone).all() if z.structural_risk == 0.0]
            if not blank:
                print("[STARTUP] All zones populated — skipping.")
                return

            print(f"[STARTUP] {len(blank)} blank zones — running pipeline...")
            for zone in blank:
                try:
                    r = fetch_rainfall_openmeteo.fetch_rainfall(zone.lat, zone.lon)
                    zone.rainfall_mm_24h     = r["rainfall_mm_24h"]
                    zone.rainfall_mm_48h     = r["rainfall_mm_48h"]
                    zone.rainfall_mm_72h     = r["rainfall_mm_72h"]
                    zone.rainfall_updated_at = datetime.datetime.utcnow()
                    db.commit()
                except Exception as e:
                    print(f"[STARTUP] Rainfall error {zone.name}: {e}")

                try:
                    _run_model_for_zone(zone, db)
                except Exception as e:
                    print(f"[STARTUP] Model error {zone.name}: {e}")

                rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
                combined_score, risk_level = compute_combined_risk(zone.structural_risk, rainfall_risk)
                db.add(models.RiskHistory(
                    zone_id=zone.id, structural_risk=zone.structural_risk,
                    rainfall_risk=rainfall_risk, combined_score=combined_score,
                    risk_level=risk_level, recorded_at=datetime.datetime.utcnow(),
                ))
                db.commit()
                print(f"[STARTUP] {zone.name}: {risk_level} ({combined_score:.2f})")

            print("[STARTUP] Auto-pipeline complete.")
        finally:
            db.close()

    threading.Thread(target=_run, daemon=True).start()


_auto_seed()
_startup_pipeline()

app = FastAPI(
    title="Xaodhang — NER Landslide Early Warning API",
    description="RedBeryl / SIH26001. Sentinel-2 → UNet → Open-Meteo → USGS seismic.",
    version="0.6.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

app.include_router(zones.router)
app.include_router(rainfall.router)
app.include_router(predict.router)
app.include_router(reports.router)
app.include_router(live.router)
app.include_router(forecast.router)
app.include_router(alerts.router)
app.include_router(chatbot.router)
app.include_router(history.router)
app.include_router(scan.router)
app.include_router(evacuation.router)


@app.get("/", tags=["health"])
def health_check():
    return {
        "status": "ok", "team": "RedBeryl", "version": "0.6.0",
        "data_sources": {
            "satellite": "Sentinel-2 via GEE",
            "rainfall":  "Open-Meteo ERA5-Land (real-time)",
            "seismic":   "USGS FDSN (live, 30min cache)",
            "routing":   "OpenRouteService (if ORS_API_KEY set)",
        },
    }


@app.post("/pipeline/run", tags=["pipeline"])
def run_pipeline(db=Depends(get_db)):
    import fetch_rainfall_openmeteo
    from routers.alerts import (ALERT_THRESHOLD_LEVELS, DEFAULT_RECIPIENTS,
                                _build_message, _get_last_alert_level, _send_fast2sms)
    from routers.predict import _run_model_for_zone

    all_zones = db.query(models.Zone).all()
    summary   = []

    for zone in all_zones:
        entry = {"zone_id": zone.id, "zone_name": zone.name,
                 "rainfall": "skipped", "model": "skipped", "alert": "skipped"}

        try:
            r = fetch_rainfall_openmeteo.fetch_rainfall(zone.lat, zone.lon)
            zone.rainfall_mm_24h = r["rainfall_mm_24h"]
            zone.rainfall_mm_48h = r["rainfall_mm_48h"]
            zone.rainfall_mm_72h = r["rainfall_mm_72h"]
            zone.rainfall_updated_at = datetime.datetime.utcnow()
            db.commit()
            entry["rainfall"] = f"ok ({r.get('source','')})"
        except Exception as e:
            entry["rainfall"] = f"error: {e}"

        try:
            _run_model_for_zone(zone, db)
            entry["model"] = "ok"
        except Exception as e:
            entry["model"] = f"error: {e}"

        rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
        combined_score, risk_level = compute_combined_risk(zone.structural_risk, rainfall_risk)

        db.add(models.RiskHistory(
            zone_id=zone.id, structural_risk=zone.structural_risk,
            rainfall_risk=rainfall_risk, combined_score=combined_score,
            risk_level=risk_level, recorded_at=datetime.datetime.utcnow(),
        ))
        db.commit()

        entry["combined_score"] = round(combined_score, 3)
        entry["risk_level"]     = risk_level

        try:
            if risk_level in ALERT_THRESHOLD_LEVELS:
                last = _get_last_alert_level(zone.id, db)
                if last != risk_level:
                    recipients = [r for r in DEFAULT_RECIPIENTS.split(",") if r.strip()]
                    for lang in ["en", "hi", "as", "mni"]:
                        msg = _build_message(zone, risk_level, combined_score, lang)
                        ok, err = _send_fast2sms(msg, recipients)
                        db.add(models.AlertLog(
                            zone_id=zone.id, risk_level=risk_level,
                            combined_score=combined_score, channel="sms",
                            language=lang, message=msg,
                            recipients=",".join(recipients),
                            status="sent" if ok else "failed", error=err or None,
                        ))
                    db.commit()
                    entry["alert"] = f"fired ({risk_level})"
                else:
                    entry["alert"] = f"suppressed (already {risk_level})"
            else:
                entry["alert"] = f"not needed ({risk_level})"
        except Exception as e:
            entry["alert"] = f"error: {e}"

        summary.append(entry)

    return {"ran_at": datetime.datetime.utcnow().isoformat(),
            "zones_processed": len(summary), "zones": summary}
