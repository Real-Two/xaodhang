"""
clean_and_fix_zones.py
Run from D:\SIH\landslide_api\ with server still running.

Step 1: wipes all zones, inserts 14 clean canonical ones using
        the best structural_risk values already in your DB (no GEE needed).
Step 2: fetches real CHIRPS rainfall for each zone and pushes it to the API.

Total time: ~5 minutes for rainfall fetches.
"""

import datetime
import requests
import sys
import time

from database import SessionLocal
from models import Zone

# Best structural_risk from your existing DB (picked higher value where dupes exist)
CANONICAL_ZONES = [
    {"name": "Noney, Manipur (2022 landslide site)",    "lat": 24.833, "lon": 93.583, "structural_risk": 0.2898},
    {"name": "Tupul, Manipur (railway landslide 2022)", "lat": 24.717, "lon": 93.650, "structural_risk": 0.1608},
    {"name": "Aizawl-Thenzawl Highway, Mizoram",        "lat": 23.500, "lon": 92.917, "structural_risk": 0.0007},
    {"name": "Shillong-Silchar NH6, Meghalaya",          "lat": 25.200, "lon": 92.750, "structural_risk": 0.8671},
    {"name": "Kohima-Imphal NH2, Nagaland",              "lat": 25.350, "lon": 94.100, "structural_risk": 0.0001},
    {"name": "Jiribam-Imphal Highway, Manipur",          "lat": 24.800, "lon": 93.200, "structural_risk": 0.8197},
    {"name": "Gangtok-Nathula Highway, Sikkim",          "lat": 27.333, "lon": 88.617, "structural_risk": 0.9162},
    {"name": "Tawang Highway, Arunachal Pradesh",        "lat": 27.583, "lon": 91.867, "structural_risk": 0.6863},
    {"name": "Dima Hasao District, Assam",               "lat": 25.317, "lon": 93.083, "structural_risk": 0.1309},
    {"name": "Champhai, Mizoram (border zone)",          "lat": 23.467, "lon": 93.317, "structural_risk": 0.7782},
    {"name": "Lunglei District, Mizoram",                "lat": 22.883, "lon": 92.733, "structural_risk": 0.0001},
    {"name": "Senapati Hills, Manipur",                  "lat": 25.070, "lon": 94.120, "structural_risk": 0.7262},
    {"name": "Live query 24.770, 92.980",                "lat": 24.770, "lon": 92.980, "structural_risk": 0.4727},
    {"name": "Live query 26.450, 90.490",                "lat": 26.450, "lon": 90.490, "structural_risk": 0.8666},
]

BASE_URL = "http://localhost:8000"
GEE_PROJECT = "xhaodong-506519"

# ── STEP 1: wipe and re-insert ──────────────────────────────────────────────
print("=" * 55)
print("STEP 1: Wiping all zones and inserting clean records")
print("=" * 55)

db = SessionLocal()
deleted = db.query(Zone).delete()
db.commit()
print(f"Deleted {deleted} existing zones.")

for z in CANONICAL_ZONES:
    zone = Zone(
        name=z["name"],
        lat=z["lat"],
        lon=z["lon"],
        structural_risk=z["structural_risk"],
        structural_updated_at=datetime.datetime.utcnow(),
        rainfall_mm_24h=0.0,
        rainfall_mm_48h=0.0,
        rainfall_mm_72h=0.0,
    )
    db.add(zone)

db.commit()
db.close()
print(f"Inserted {len(CANONICAL_ZONES)} clean zones.\n")

# ── STEP 2: fetch real rainfall via CHIRPS ───────────────────────────────────
print("=" * 55)
print("STEP 2: Fetching real CHIRPS rainfall for each zone")
print("  (~20s per zone, do not close terminal)")
print("=" * 55)

sys.path.insert(0, r"D:\SIH\landslide_real_data")
from fetch_rainfall_chirps import fetch_rainfall

zones = requests.get(f"{BASE_URL}/zones").json()

for z in zones:
    print(f"\n  [{z['id']}] {z['name'][:50]}")
    print(f"       lat={z['lat']}, lon={z['lon']}", end=" ... ", flush=True)
    try:
        rain = fetch_rainfall(z["lat"], z["lon"], GEE_PROJECT)
        r = requests.post(f"{BASE_URL}/rainfall/{z['id']}", json=rain)
        print(f"✓  24h={rain['rainfall_mm_24h']}mm  "
              f"48h={rain['rainfall_mm_48h']}mm  "
              f"72h={rain['rainfall_mm_72h']}mm")
    except Exception as e:
        print(f"✗ FAILED: {e}")
    time.sleep(2)

# ── Final summary ─────────────────────────────────────────────────────────────
print("\n" + "=" * 55)
print("FINAL RISK SCORES (sorted by combined_score)")
print("=" * 55)

for z in zones:
    r = requests.get(f"{BASE_URL}/risk/{z['id']}").json()
    bar = "█" * int(r["combined_score"] * 20)
    print(f"  {r['risk_level']:8s}  {r['combined_score']:.3f}  {bar:20s}  {z['name'][:40]}")

print("\nDone. Refresh the frontend.")