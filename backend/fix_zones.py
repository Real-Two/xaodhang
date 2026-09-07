"""
fix_zones.py — wipe all zones and re-seed with real coordinates.
Run this from D:\SIH\landslide_api\

What it does:
1. Deletes every zone in the DB
2. Calls /predict/live for each real NER historical zone
3. Each call runs the full satellite + model + rainfall pipeline
4. After this, all zones will have real structural_risk values

Run with:
    python fix_zones.py

Takes about 3-4 minutes total (10 zones x ~20s each).
Leave it running, don't close the terminal.
"""

import requests
import time

BASE_URL = "http://localhost:8000"

REAL_ZONES = [
    {"name": "Noney, Manipur (2022 landslide site)",      "lat": 24.833, "lon": 93.583},
    {"name": "Tupul, Manipur (railway landslide 2022)",   "lat": 24.717, "lon": 93.650},
    {"name": "Aizawl-Thenzawl Highway, Mizoram",          "lat": 23.500, "lon": 92.917},
    {"name": "Shillong-Silchar NH6, Meghalaya",            "lat": 25.200, "lon": 92.750},
    {"name": "Kohima-Imphal NH2, Nagaland",                "lat": 25.350, "lon": 94.100},
    {"name": "Jiribam-Imphal Highway, Manipur",            "lat": 24.800, "lon": 93.200},
    {"name": "Gangtok-Nathula Highway, Sikkim",            "lat": 27.333, "lon": 88.617},
    {"name": "Tawang Highway, Arunachal Pradesh",          "lat": 27.583, "lon": 91.867},
    {"name": "Dima Hasao District, Assam",                 "lat": 25.317, "lon": 93.083},
    {"name": "Lunglei District, Mizoram",                  "lat": 22.883, "lon": 92.733},
]

def wipe_all_zones():
    print("Step 1: Getting all existing zones...")
    r = requests.get(f"{BASE_URL}/zones")
    zones = r.json()
    print(f"  Found {len(zones)} zones to delete.")
    for z in zones:
        zid = z["id"]
        requests.delete(f"{BASE_URL}/zones/{zid}")
        print(f"  Deleted zone {zid}: {z['name']}")

def seed_with_live_pipeline():
    print("\nStep 2: Re-seeding with live satellite pipeline...")
    print("  Each zone takes ~20 seconds. Do not close this terminal.\n")
    results = []
    for i, zone in enumerate(REAL_ZONES):
        print(f"  [{i+1}/10] {zone['name']} ({zone['lat']}, {zone['lon']})...")
        try:
            r = requests.post(
                f"{BASE_URL}/predict/live",
                json={"lat": zone["lat"], "lon": zone["lon"], "name": zone["name"]},
                timeout=120
            )
            data = r.json()
            # Update the zone name to the proper one (live endpoint auto-names it)
            requests.put(
                f"{BASE_URL}/zones/{data['zone_id']}",
                json={"name": zone["name"], "lat": zone["lat"], "lon": zone["lon"]}
            )
            results.append(data)
            print(f"    structural_risk={data['structural_risk']:.4f}  "
                  f"combined_score={data['combined_score']:.4f}  "
                  f"risk_level={data['risk_level']}")
        except Exception as e:
            print(f"    ERROR: {e}")
        time.sleep(2)

    print("\n=== DONE — Final risk levels ===")
    results.sort(key=lambda x: x["combined_score"], reverse=True)
    for r in results:
        print(f"  {r['risk_level']:8s}  {r['combined_score']:.3f}  {r['zone_name']}")

if __name__ == "__main__":
    wipe_all_zones()
    seed_with_live_pipeline()
    print("\nRefresh the frontend now — you should see real risk levels.")