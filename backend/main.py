"""
Entry point. Run locally with:

    uvicorn main:app --reload --port 8000

Then open http://localhost:8000/docs for the interactive Swagger UI —
that's also the fastest way to demo the API standalone before the frontend
is wired up.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

import models
from database import Base, engine
from routers import live, predict, rainfall, reports, zones, forecast, alerts, chatbot, history

Base.metadata.create_all(bind=engine)

# ---------------------------------------------------------------------------
# Auto-seed zones on startup if the DB is empty.
# This means Railway's ephemeral SQLite is always populated after a redeploy.
# ---------------------------------------------------------------------------
def _auto_seed():
    from database import SessionLocal
    from models import Zone

    NER_ZONES = [
        {"name": "Noney, Manipur (2022 landslide site)",   "lat": 24.9833, "lon": 93.4833},
        {"name": "Tupul, Manipur (railway landslide)",      "lat": 24.9500, "lon": 93.5000},
        {"name": "Aizawl-Thenzawl Highway, Mizoram",       "lat": 23.5000, "lon": 92.8000},
        {"name": "Shillong-Silchar NH6, Meghalaya",        "lat": 25.1000, "lon": 92.0000},
        {"name": "Kohima-Imphal NH2, Nagaland",            "lat": 25.4000, "lon": 94.1000},
        {"name": "Jiribam-Imphal Highway, Manipur",        "lat": 24.8000, "lon": 93.1200},
        {"name": "Gangtok-Nathula, Sikkim",                "lat": 27.3300, "lon": 88.6200},
        {"name": "Tawang Highway, Arunachal Pradesh",      "lat": 27.5800, "lon": 91.8600},
        {"name": "Dima Hasao District, Assam",             "lat": 25.5700, "lon": 93.0500},
        {"name": "Champhai, Mizoram (border zone)",        "lat": 23.4600, "lon": 93.3300},
    ]

    db = SessionLocal()
    try:
        if db.query(Zone).count() == 0:
            for z in NER_ZONES:
                db.add(Zone(**z))
            db.commit()
            print(f"[SEED] Auto-seeded {len(NER_ZONES)} NER zones into fresh database.")
        else:
            print(f"[SEED] Database already has zones — skipping auto-seed.")
    finally:
        db.close()

_auto_seed()

app = FastAPI(
    title="NER Landslide Early Warning API",
    description="Combines satellite-based structural risk (U-Net) with "
                 "rainfall-based dynamic risk and citizen field reports "
                 "into a single early-warning system for SIH26001. "
                 "Covers the 10 seeded historical zones, a slope-filtered "
                 "grid across the wider Northeast region, and live "
                 "on-demand prediction for any point via /predict/live.",
    version="0.2.0",
)

# Wide-open CORS for hackathon development — antigravity's frontend will
# likely run on a different port/origin during dev. Tighten this to the
# actual deployed frontend origin before the live demo if possible.
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


@app.get("/")
def health_check():
    return {
        "status": "ok",
        "service": "NER Landslide Early Warning API",
        "team": "RedBeryl",
        "version": "0.3.0",
        "features": [
            "structural-risk", "rainfall-trigger", "combined-risk-engine",
            "72h-forecast", "multilingual-sms-alerts", "ai-chatbot",
            "risk-history", "citizen-reporting", "live-prediction"
        ]
    }