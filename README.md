# 🏔️ Xaodhang

**AI-Powered Landslide Early Warning System for Northeast India**
Smart India Hackathon 2026 · Problem Statement SIH26001 · Team RedBeryl

![SIH 2026](https://img.shields.io/badge/SIH-2026-green?style=for-the-badge)
![Problem ID](https://img.shields.io/badge/Problem_ID-26001-blue?style=for-the-badge)
![Python](https://img.shields.io/badge/Python-3.12-3776AB?style=for-the-badge&logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Deployed](https://img.shields.io/badge/Live-xaodhang.vercel.app-success?style=for-the-badge)

> **Ministry of Development of North Eastern Region (MDoNER)**

---

## 🎯 Problem Statement

The North Eastern Region of India — 8 states, 45+ million people — is one of the world's most landslide-prone zones. Geologically young terrain, active seismic zones, and extreme monsoon rainfall (Cherrapunji: 11,777mm/year) combine with deforestation and unplanned infrastructure to cause recurring disasters.

**The gap:** No centralized real-time monitoring. No AI prediction. Alerts are reactive, not predictive. Rural populations receive warnings too late, if at all.

---

## 🛡️ Our Solution

Xaodhang is a full-stack, real-time landslide early warning platform built specifically for NER. It fuses satellite data, rainfall feeds, seismic data, and a UNet deep learning model into a single live dashboard — monitored zone by zone across all 8 states.

- **Frontend:** [https://xaodhang.vercel.app](https://xaodhang.vercel.app)
- **Backend API:** [https://xaodhang.onrender.com](https://xaodhang.onrender.com)

---

## ⚙️ System Architecture

```
[Open-Meteo Rainfall API] ──┐
[Google Earth Engine]       ├──▶ FastAPI Backend ──▶ SQLite DB
[USGS Seismic Feed]    ─────┘         │
                                       ▼
                              ONNX UNet Inference
                              (Sentinel-2 patches)
                                       │
                                       ▼
                              Risk Engine → Alert Pipeline
                                       │
                                       ▼
                           React + Leaflet Frontend
```

**Two-pass startup pipeline:**
1. **Pass 1** — Rapid rainfall fetch for all zones (fast, runs first)
2. **Pass 2** — GEE + UNet inference for zones without real structural data (runs async, ~20 min)

---

## 🤖 AI / ML

| Component | Detail |
|---|---|
| Model | UNet (ONNX Runtime) |
| Input | Sentinel-2 satellite patches via Google Earth Engine |
| Output | Structural risk score per zone (0.0 – 1.0) |
| Baselines | Pre-computed structural risk per zone (0.43 – 0.71) seeded on startup |
| Risk engine | Combines structural risk + rainfall intensity + seismic activity |

**Risk levels:**

| Level | Score | Response |
|---|---|---|
| 🟢 Low | 0–25 | Routine monitoring |
| 🟡 Moderate | 25–50 | Notify district admin |
| 🟠 High | 50–75 | Pre-position rescue teams |
| 🔴 Critical | 75–100 | Immediate evacuation |

---

## 🛰️ Data Sources

| Source | Data | Status |
|---|---|---|
| Open-Meteo | Real-time rainfall per zone | ✅ Live |
| Google Earth Engine (Sentinel-2) | Satellite patches for UNet inference | ✅ Live |
| USGS | Seismic activity | ✅ Live |
| ONNX UNet | Structural landslide risk | ✅ Live |

GEE Project: `xhaodong-506519`

---

## 🖥️ Frontend

Built with **React + Vite + Leaflet**

| Page | Description |
|---|---|
| 📊 Dashboard | Live zone risk overview, zone cards, risk distribution |
| 🗺️ Risk Map | Interactive Leaflet heatmap across NER zones |
| 🚨 Alerts | Active alerts with severity and zone info |
| 🤖 Chatbot | AI assistant (Groq, multi-model fallback) |
| 📋 History | Past alert log and event timeline |
| 📡 Scan | Manual zone scan trigger |

---

## ⚡ Backend API

**Base URL:** `https://xaodhang.onrender.com`

| Method | Endpoint | Description |
|---|---|---|
| GET | `/risk/all` | Risk scores for all NER zones |
| GET | `/alerts` | Active alerts |
| GET | `/forecast` | Rainfall forecast per zone |
| GET | `/live` | Live sensor readings |
| GET | `/history` | Historical alert log |
| GET | `/zones` | Zone metadata |
| POST | `/scan` | Trigger a zone scan |
| POST | `/chatbot` | AI chatbot (Groq) |
| GET | `/reports` | Field reports |
| GET | `/evacuation` | Evacuation route data |
| GET | `/rainfall` | Current rainfall readings |
| GET | `/predict` | Model prediction endpoint |

---

## 📁 Project Structure

```
xaodhang/
├── main.py                  # Entry point — startup pipeline, auto-seed
├── database.py              # SQLite (StaticPool)
├── models.py                # DB models
├── schemas.py               # Pydantic schemas
├── ml_service.py            # ONNX UNet inference
├── risk_engine.py           # Risk scoring logic
├── gee_auth.py              # Google Earth Engine auth
├── fetch_real_patch.py      # Sentinel-2 patch fetcher
├── render.yaml              # Render deployment config
├── routers/
│   ├── alerts.py
│   ├── chatbot.py           # Groq multi-model fallback
│   ├── evacuation.py
│   ├── forecast.py
│   ├── history.py
│   ├── live.py
│   ├── predict.py
│   ├── rainfall.py
│   ├── reports.py
│   ├── scan.py
│   └── zones.py
└── frontend/                # React + Vite
    └── src/
        ├── hooks/
        │   └── useZones.js  # Zone fetch + cold-start retry logic
        └── components/
            └── ChatbotPanel.jsx
```

---

## 🚀 Setup

### Backend

```bash
pip install -r requirements.txt

# Required environment variables
GROQ_API_KEY=your_key
GEE_SERVICE_ACCOUNT=xaodhang-railway@xhaodong-506519.iam.gserviceaccount.com
GEE_CREDENTIALS_JSON=...

uvicorn main:app --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### Deployment

- **Frontend** — Vercel (`xaodhang.vercel.app`)
- **Backend** — Render free tier (`render.yaml`)

> ⚠️ Render free tier uses ephemeral SQLite — data reseeds on each deploy. Pre-computed structural risk baselines prevent zones from showing 0% on cold start.

> ⚠️ Backend cold-start can take ~30s. Frontend retries `/risk/all` up to 4 times with 8s intervals and a 20s timeout per request.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, FastAPI |
| Database | SQLite (StaticPool) |
| ML Inference | ONNX Runtime (UNet) |
| Satellite Data | Google Earth Engine (Sentinel-2) |
| Rainfall Data | Open-Meteo API |
| Seismic Data | USGS |
| AI Chatbot | Groq API (llama-3.3-70b → fallback chain) |
| Frontend | React, Vite, Leaflet |
| Deployment | Vercel (frontend) · Render (backend) |

---

## 👥 Team RedBeryl

| Name |
|---|
| Anurag Madan |
| Himang Bhatt |
| Kunal Giri |
| Harshveer Singh |

> SIH 2026 · Problem Statement SIH26001 · Ministry of Development of North Eastern Region

---

*Built to protect the people of Northeast India — before the slope gives way.*
