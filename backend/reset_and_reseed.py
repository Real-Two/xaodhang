"""
reset_and_reseed.py
Wipes all zones from the DB and reseeds with the 10 real NER high-risk zones.
Run this from D:\SIH\landslide_api\ BEFORE running update_all_zones.py
"""

import requests
import sys

API_BASE = "http://127.0.0.1:8000"

# 10 real documented NER high-risk zones from GSI/NDMA reports
REAL_ZONES = [
    {"name": "Noney, Manipur (2022 landslide site)",   "lat": 24.7500, "lon": 93.0500},
    {"name": "Tupul, Manipur (railway landslide)",      "lat": 24.7200, "lon": 93.0700},
    {"name": "Aizawl-Thenzawl Highway, Mizoram",        "lat": 23.7271, "lon": 92.7176},
    {"name": "Shillong-Silchar NH6, Meghalaya",          "lat": 25.2000, "lon": 91.9000},
    {"name": "Kohima-Imphal NH2, Nagaland",              "lat": 25.6747, "lon": 94.1086},
    {"name": "Jiribam-Imphal Highway, Manipur",          "lat": 24.8000, "lon": 93.1200},
    {"name": "Gangtok-Nathula Highway, Sikkim",          "lat": 27.3389, "lon": 88.6065},
    {"name": "Tawang Highway, Arunachal Pradesh",        "lat": 27.5859, "lon": 91.8594},
    {"name": "Dima Hasao District, Assam",               "lat": 25.1000, "lon": 92.8000},
    {"name": "Champhai, Mizoram (border zone)",          "lat": 23.4573, "lon": 93.3265},
]


def main():
    # 1. Get all existing zones
    resp = requests.get(f"{API_BASE}/zones", timeout=10)
    resp.raise_for_status()
    existing = resp.json()
    print(f"Found {len(existing)} existing zones.")

    # 2. Delete all via DELETE /zones/{id} if endpoint exists,
    #    otherwise use SQLite directly (handled below)
    deleted = 0
    for zone in existing:
        zid = zone["id"]
        r = requests.delete(f"{API_BASE}/zones/{zid}", timeout=10)
        if r.status_code in (200, 204, 404):
            deleted += 1
        else:
            print(f"  Could not delete zone {zid}: {r.status_code} — will try DB wipe instead")
            break

    if deleted == len(existing):
        print(f"Deleted {deleted} zones via API.")
    else:
        # Fallback: wipe SQLite directly
        print("API delete not available — wiping SQLite directly...")
        import sqlite3, os, glob
        # Find the DB file
        db_candidates = glob.glob('*.db') + glob.glob('*.sqlite') + ['landslide.db', 'app.db']
        db_path = None
        for c in db_candidates:
            if os.path.exists(c):
                db_path = c
                break
        if db_path is None:
            print("ERROR: Could not find SQLite DB file. Run from D:\\SIH\\landslide_api\\")
            sys.exit(1)
        conn = sqlite3.connect(db_path)
        conn.execute("DELETE FROM zones")
        conn.execute("DELETE FROM reports")
        conn.commit()
        conn.close()
        print(f"Wiped all zones from {db_path}.")

    # 3. Reseed with the 10 real zones
    print(f"\nSeeding {len(REAL_ZONES)} real NER zones...")
    for z in REAL_ZONES:
        r = requests.post(f"{API_BASE}/zones", json=z, timeout=10)
        if r.status_code in (200, 201):
            print(f"  ✓ {z['name']}")
        else:
            print(f"  ✗ {z['name']}: {r.status_code} {r.text[:100]}")

    # 4. Verify
    resp = requests.get(f"{API_BASE}/zones", timeout=10)
    zones = resp.json()
    print(f"\nDB now has {len(zones)} zones. Done.")


if __name__ == "__main__":
    main()
