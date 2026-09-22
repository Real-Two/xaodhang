"""
update_all_zones.py — Master pipeline orchestrator for Xaodhang.

Run this on a schedule (cron, Task Scheduler, Railway cron job) to keep
all zone data fresh. It:

  1. Fetches latest CHIRPS rainfall for every zone via GEE
  2. Computes combined risk score using risk_engine.py
  3. Logs each result to RiskHistory (powers the trend chart)
  4. Checks if any zone crossed into HIGH/CRITICAL for the first time
     and triggers SMS alerts in all 4 languages if so
  5. Prints a summary table

Usage:
  python update_all_zones.py               # run once, then exit
  python update_all_zones.py --loop 3600   # run every 3600 seconds (1 hour)

Environment variables:
  GEE_PROJECT          — your Google Earth Engine project ID
  FAST2SMS_API_KEY     — for SMS alerts (optional; alerts skipped if unset)
  ANTHROPIC_API_KEY    — for chatbot (not used by this script)
  ALERT_RECIPIENTS     — comma-separated mobile numbers (no +91)
  DATABASE_URL         — defaults to sqlite:///./risk.db
"""

import argparse
import datetime
import os
import time

from sqlalchemy.orm import Session

import models
from database import engine, SessionLocal, Base
from risk_engine import compute_combined_risk, compute_rainfall_risk

# Make sure new tables exist
Base.metadata.create_all(bind=engine)

ALERT_LEVELS = {"HIGH", "CRITICAL"}
DEFAULT_RECIPIENTS = os.environ.get("ALERT_RECIPIENTS", "").split(",")

# Try importing GEE fetch scripts — skip gracefully if GEE auth isn't available
try:
    import fetch_rainfall_openmeteo
    RAINFALL_AVAILABLE = True
except ImportError:
    RAINFALL_AVAILABLE = False
    print("[WARN] fetch_rainfall_chirps not importable — rainfall will not be updated")


def _get_last_alert_level(zone_id: int, db: Session) -> str | None:
    last = (
        db.query(models.AlertLog)
        .filter(models.AlertLog.zone_id == zone_id)
        .filter(models.AlertLog.status == "sent")
        .order_by(models.AlertLog.sent_at.desc())
        .first()
    )
    return last.risk_level if last else None


def _send_alerts(zone: models.Zone, risk_level: str, combined_score: float, db: Session):
    """Fire SMS in all 4 languages. Logs each attempt to AlertLog."""
    from routers.alerts import _build_message, _send_fast2sms, TEMPLATES

    recipients = [r for r in DEFAULT_RECIPIENTS if r.strip()]
    if not recipients:
        print(f"  [ALERT] No recipients configured — skipping SMS for {zone.name}")
        return

    for lang in ["en", "hi", "as", "mni"]:
        message = _build_message(zone, risk_level, combined_score, lang)
        success, error = _send_fast2sms(message, recipients)
        status = "sent" if success else "failed"

        log = models.AlertLog(
            zone_id=zone.id,
            risk_level=risk_level,
            combined_score=combined_score,
            channel="sms",
            language=lang,
            message=message,
            recipients=",".join(recipients),
            status=status,
            error=error or None,
        )
        db.add(log)
        print(f"  [ALERT/{lang.upper()}] {status.upper()} → {zone.name} ({risk_level})"
              + (f" | {error}" if error else ""))

    db.commit()


def run_once(db: Session):
    zones = db.query(models.Zone).all()
    print(f"\n{'='*60}")
    print(f"Xaodhang Pipeline Run — {datetime.datetime.utcnow().isoformat()} UTC")
    print(f"{'='*60}")
    print(f"Processing {len(zones)} zones...\n")

    for zone in zones:
        print(f"  → {zone.name} (id={zone.id})")

        # Step 1: Fetch rainfall from GEE/CHIRPS
        if RAINFALL_AVAILABLE:
            try:
                rainfall = fetch_rainfall_openmeteo.fetch_rainfall(zone.lat, zone.lon)
                zone.rainfall_mm_24h = rainfall.get("rainfall_mm_24h", zone.rainfall_mm_24h)
                zone.rainfall_mm_48h = rainfall.get("rainfall_mm_48h", zone.rainfall_mm_48h)
                zone.rainfall_mm_72h = rainfall.get("rainfall_mm_72h", zone.rainfall_mm_72h)
                zone.rainfall_updated_at = datetime.datetime.utcnow()
                print(f"     Rainfall: 24h={zone.rainfall_mm_24h:.1f}mm "
                      f"48h={zone.rainfall_mm_48h:.1f}mm "
                      f"72h={zone.rainfall_mm_72h:.1f}mm")
            except Exception as e:
                print(f"     [WARN] GEE rainfall fetch failed: {e}")
        else:
            print(f"     [SKIP] GEE unavailable — using stored rainfall")

        db.commit()

        # Step 2: Compute combined risk
        rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
        combined_score, risk_level = compute_combined_risk(zone.structural_risk, rainfall_risk)
        print(f"     Structural={zone.structural_risk:.2f}  "
              f"Rainfall={rainfall_risk:.2f}  "
              f"Combined={combined_score:.2f}  → {risk_level}")

        # Step 3: Log to RiskHistory
        history_entry = models.RiskHistory(
            zone_id=zone.id,
            structural_risk=zone.structural_risk,
            rainfall_risk=rainfall_risk,
            combined_score=combined_score,
            risk_level=risk_level,
            recorded_at=datetime.datetime.utcnow(),
        )
        db.add(history_entry)
        db.commit()

        # Step 4: Check for new threshold crossing → alert
        if risk_level in ALERT_LEVELS:
            last_level = _get_last_alert_level(zone.id, db)
            if last_level != risk_level:
                print(f"     🚨 NEW ALERT THRESHOLD CROSSED: {last_level or 'none'} → {risk_level}")
                _send_alerts(zone, risk_level, combined_score, db)
            else:
                print(f"     Already alerted at {risk_level} — no duplicate sent")
        else:
            print(f"     Level is {risk_level} — no alert needed")

    # Step 5: Print summary table
    print(f"\n{'='*60}")
    print("SUMMARY")
    print(f"{'Zone':<30} {'Level':<10} {'Score':<8} {'72h Rain'}")
    print("-" * 60)
    for zone in sorted(zones, key=lambda z: z.name):
        rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
        combined_score, risk_level = compute_combined_risk(zone.structural_risk, rainfall_risk)
        print(f"{zone.name:<30} {risk_level:<10} {combined_score:<8.3f} {zone.rainfall_mm_72h:.1f}mm")
    print(f"{'='*60}")
    print(f"Run complete — {datetime.datetime.utcnow().isoformat()} UTC\n")


def main():
    parser = argparse.ArgumentParser(description="Xaodhang zone update pipeline")
    parser.add_argument(
        "--loop", type=int, default=0,
        help="If > 0, run every N seconds (e.g. --loop 3600 for hourly). Default: run once."
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.loop > 0:
            print(f"Loop mode: running every {args.loop}s. Press Ctrl+C to stop.")
            while True:
                run_once(db)
                print(f"Sleeping {args.loop}s until next run...")
                time.sleep(args.loop)
        else:
            run_once(db)
    except KeyboardInterrupt:
        print("\nStopped by user.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
