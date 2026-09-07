"""
Populates a handful of illustrative zones across landslide-prone NER areas
for the demo. Coordinates are approximate town/city centers — swap for real
slope-segment coordinates once your team has identified specific monitoring
sites.

Run once:  python seed_zones.py
"""

from database import Base, SessionLocal, engine
from models import Zone

Base.metadata.create_all(bind=engine)

DEMO_ZONES = [
    {"name": "Shillong Peak Road, Meghalaya", "lat": 25.5497, "lon": 91.8710},
    {"name": "Aizawl Tanhril, Mizoram", "lat": 23.7307, "lon": 92.6849},
    {"name": "Kohima Ridge, Nagaland", "lat": 25.6747, "lon": 94.1086},
    {"name": "Itanagar Foothills, Arunachal Pradesh", "lat": 27.0844, "lon": 93.6053},
    {"name": "Gangtok-Nathula Highway, Sikkim", "lat": 27.3389, "lon": 88.6065},
]


def seed():
    db = SessionLocal()
    try:
        existing = {z.name for z in db.query(Zone).all()}
        added = 0
        for z in DEMO_ZONES:
            if z["name"] not in existing:
                db.add(Zone(**z))
                added += 1
        db.commit()
        print(f"Seeded {added} new zones ({len(existing)} already existed).")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
