"""
seed_railway.py — Seeds all 10 real NER zones into the Railway database.
Run once from your local machine:

    python seed_railway.py

This hits the live Railway API, not localhost.
"""

import requests

BASE_URL = "https://xaodhang-production.up.railway.app"

real_ner_zones = [
    {"name": "Noney, Manipur (2022 landslide site)", "lat": 24.9833, "lon": 93.4833},
    {"name": "Tupul, Manipur (railway landslide)", "lat": 24.9500, "lon": 93.5000},
    {"name": "Aizawl-Thenzawl Highway, Mizoram", "lat": 23.5000, "lon": 92.8000},
    {"name": "Shillong-Silchar NH6, Meghalaya", "lat": 25.1000, "lon": 92.0000},
    {"name": "Kohima-Imphal NH2, Nagaland", "lat": 25.4000, "lon": 94.1000},
    {"name": "Jiribam-Imphal Highway, Manipur", "lat": 24.8000, "lon": 93.1200},
    {"name": "Gangtok-Nathula, Sikkim", "lat": 27.3300, "lon": 88.6200},
    {"name": "Tawang Highway, Arunachal Pradesh", "lat": 27.5800, "lon": 91.8600},
    {"name": "Dima Hasao District, Assam", "lat": 25.5700, "lon": 93.0500},
    {"name": "Champhai, Mizoram (border zone)", "lat": 23.4600, "lon": 93.3300},
]

print(f"Seeding zones into {BASE_URL}...\n")

# Check existing
existing = requests.get(f"{BASE_URL}/zones").json()
existing_names = {z["name"] for z in existing}
print(f"Existing zones on Railway: {len(existing_names)}")

added = 0
for z in real_ner_zones:
    if z["name"] in existing_names:
        print(f"SKIP (exists) — {z['name']}")
        continue
    r = requests.post(f"{BASE_URL}/zones", json=z)
    if r.status_code in (200, 201):
        print(f"OK — {z['name']}")
        added += 1
    else:
        print(f"FAIL ({r.status_code}) — {z['name']} | {r.text}")

print(f"\nDone. Added {added} zones.")
print(f"Total on Railway: {len(requests.get(f'{BASE_URL}/zones').json())}")
print(f"\nVerify: {BASE_URL}/zones")
