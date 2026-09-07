# Landslide Early Warning API — SIH26001

FastAPI backend that combines the U-Net structural risk model, rainfall-based
dynamic risk, and citizen field reports into one system antigravity's
frontend can call. Every endpoint below has been tested end-to-end
(including file uploads and error cases) — this is a working server, not a
sketch.

## 1. Setup

```bash
pip install -r requirements.txt
```

Copy your **real trained model files** from Kaggle into this folder:
- `model.onnx` (from `export_onnx.py` in the model repo)
- `stats.json` (from `compute_stats.py`)

Then seed the demo zones (5 illustrative NER locations — swap for your
team's real monitoring sites whenever you have them):

```bash
python seed_zones.py
```

Run the server:

```bash
uvicorn main:app --reload --port 8000
```

Open **http://localhost:8000/docs** — that's an interactive Swagger UI where
you can call every endpoint by hand. Great for demoing the backend alone
before the frontend is wired up.

## 2. Architecture

```
main.py           — app setup, CORS, mounts all routers + /uploads static files
database.py       — SQLite connection (swap DATABASE_URL for Postgres later if needed)
models.py         — Zone, Report tables
schemas.py        — request/response validation
ml_service.py     — loads model.onnx, runs inference, renders the heatmap PNG
risk_engine.py    — combines structural + rainfall risk into one score/level
routers/
  zones.py        — CRUD for monitored zones
  rainfall.py     — push/read rainfall data per zone
  predict.py      — run the model on a new satellite patch; combined risk endpoint
  reports.py      — citizen/field-officer geo-tagged photo uploads
```

## 3. API reference

| Method | Endpoint | What it does |
|---|---|---|
| GET | `/zones` | List all zones — poll this to draw map markers |
| GET | `/zones/{id}` | Single zone detail |
| POST | `/zones` | Create a new zone `{name, lat, lon}` |
| POST | `/rainfall/{id}` | Push rainfall readings `{rainfall_mm_24h, _48h, _72h}` |
| GET | `/rainfall/{id}/risk` | Just the rainfall-layer risk number for this zone |
| POST | `/predict/structural/{id}` | Upload a `.npy` or `.h5` 14-band patch → runs the model, stores the risk, returns a base64 PNG heatmap |
| GET | `/risk/{id}` | **The number to sort your priority list by** — combines structural + rainfall into one score + LOW/MODERATE/HIGH/CRITICAL label |
| POST | `/reports` | Multipart form: `lat, lon, description, photo` — citizen report, auto-links to nearest zone |
| GET | `/reports` | List all reports, newest first |
| GET | `/reports/{id}` | Single report detail |
| GET | `/uploads/{filename}` | Serves an uploaded report photo directly |

## 4. For antigravity — frontend integration notes

- **Base URL during dev:** `http://localhost:8000` (or wherever this gets deployed — update CORS `allow_origins` in `main.py` to the real frontend origin before the live demo instead of `"*"`).
- **Map markers:** poll `GET /zones`, then call `GET /risk/{id}` for each zone to get the color-code (`risk_level`) — or we can add a single `/zones-with-risk` endpoint that returns both in one call if the per-zone round trip is too chatty for the map. Just ask.
- **Heatmap overlay:** `POST /predict/structural/{id}` returns `mask_png_base64` — decode it (`data:image/png;base64,{that string}`) and lay it directly over the zone's map bounds as an image overlay.
- **Report pins:** `GET /reports` gives lat/lon + `photo_path`; prefix `photo_path` with the API base URL to load the actual image (it's already served at `/uploads/...`).
- **Report submission form:** must be `multipart/form-data`, not JSON — `lat`, `lon`, `description` as form fields, `photo` as the file field.

## 5. What's still missing (intentionally, for now)

- **Automated CHIRPS/IMD rainfall ingestion.** Right now rainfall numbers only enter via manual `POST /rainfall/{id}` calls. For the live demo this is fine (call it manually or script a few realistic values in), but a real deployment needs a scheduled job pulling CHIRPS data and pushing it here on a timer. Happy to build that next if you want it before the demo.
- **Deforestation/mining risk layers.** Per the earlier plan, these are meant to be additional multipliers on top of `risk_engine.py`'s combined score rather than new model inputs — that hook doesn't exist yet but the file is structured so it's a small addition when you're ready.
- **Auth.** There's no login/auth on any endpoint — fine for a hackathon demo, not fine for a real deployment. Flagging so it doesn't get missed if this goes beyond SIH.
