"""
alerts.py — Multilingual SMS alert system for Xaodhang.

Sends SMS via Fast2SMS (India-specific, free trial credits, no DLT needed
for transactional messages in trial mode).

Alert templates are available in:
  - English (en)
  - Hindi (hi)
  - Assamese (as)
  - Meitei/Manipuri (mni)

Usage:
  POST /alerts/send           — manual trigger for a zone (demo use)
  POST /alerts/check-all      — runs threshold check for all zones,
                                fires alerts for any new HIGH/CRITICAL crossing
  GET  /alerts/log            — alert history

Environment variables required:
  FAST2SMS_API_KEY  — from fast2sms.com (free account gives trial credits)

To get your key:
  1. Sign up at fast2sms.com
  2. Go to Dev API → API Key
  3. Set env var: FAST2SMS_API_KEY=your_key_here

For WhatsApp (future): set TWILIO_SID, TWILIO_TOKEN, TWILIO_WHATSAPP_FROM
"""

import os
import json
import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db
from risk_engine import compute_combined_risk, compute_rainfall_risk

router = APIRouter(prefix="/alerts", tags=["alerts"])

FAST2SMS_API_KEY = os.environ.get("FAST2SMS_API_KEY", "")
FAST2SMS_URL = "https://www.fast2sms.com/dev/bulkV2"

# Alert fires only at HIGH or CRITICAL
ALERT_THRESHOLD_LEVELS = {"HIGH", "CRITICAL"}

# Default recipients — replace with actual district admin numbers
# Format: Indian mobile numbers without +91
DEFAULT_RECIPIENTS = os.environ.get(
    "ALERT_RECIPIENTS", "9999999999,8888888888"
)


# ---------------------------------------------------------------------------
# Multilingual templates
# ---------------------------------------------------------------------------

TEMPLATES = {
    "en": {
        "HIGH": (
            "⚠️ XAODHANG ALERT — HIGH RISK\n"
            "Zone: {zone_name} ({lat:.3f}, {lon:.3f})\n"
            "Combined Risk Score: {score:.2f}/1.0\n"
            "Rainfall (72h): {rain:.1f}mm\n"
            "Action: Issue advisory. Monitor closely.\n"
            "— RedBeryl / SIH26001"
        ),
        "CRITICAL": (
            "🚨 XAODHANG CRITICAL ALERT\n"
            "Zone: {zone_name} ({lat:.3f}, {lon:.3f})\n"
            "Combined Risk Score: {score:.2f}/1.0\n"
            "Rainfall (72h): {rain:.1f}mm\n"
            "Action: EVACUATE. Dispatch rescue team immediately.\n"
            "— RedBeryl / SIH26001"
        ),
    },
    "hi": {
        "HIGH": (
            "⚠️ शाओधांग चेतावनी — उच्च जोखिम\n"
            "क्षेत्र: {zone_name}\n"
            "जोखिम स्कोर: {score:.2f}/1.0\n"
            "वर्षा (72 घंटे): {rain:.1f}मिमी\n"
            "कार्रवाई: सलाह जारी करें। निगरानी रखें।\n"
            "— RedBeryl / SIH26001"
        ),
        "CRITICAL": (
            "🚨 शाओधांग गंभीर चेतावनी\n"
            "क्षेत्र: {zone_name}\n"
            "जोखिम स्कोर: {score:.2f}/1.0\n"
            "वर्षा (72 घंटे): {rain:.1f}मिमी\n"
            "कार्रवाई: तुरंत निकासी करें। बचाव दल भेजें।\n"
            "— RedBeryl / SIH26001"
        ),
    },
    "as": {
        "HIGH": (
            "⚠️ শাওধাং সতৰ্কতা — উচ্চ বিপদ\n"
            "অঞ্চল: {zone_name}\n"
            "বিপদৰ নম্বৰ: {score:.2f}/1.0\n"
            "বৰষুণ (৭২ ঘণ্টা): {rain:.1f}মিমি\n"
            "পদক্ষেপ: সতৰ্কতা জাৰি কৰক। নিগৰানি ৰাখক।\n"
            "— RedBeryl / SIH26001"
        ),
        "CRITICAL": (
            "🚨 শাওধাং জৰুৰী সতৰ্কতা\n"
            "অঞ্চল: {zone_name}\n"
            "বিপদৰ নম্বৰ: {score:.2f}/1.0\n"
            "বৰষুণ (৭২ ঘণ্টা): {rain:.1f}মিমি\n"
            "পদক্ষেপ: লগে লগে স্থান খালি কৰক।\n"
            "— RedBeryl / SIH26001"
        ),
    },
    "mni": {
        "HIGH": (
            "⚠️ শাওধাং লাইরিক্ক — অহানবা শক্তম\n"
            "মফম: {zone_name}\n"
            "শক্তম স্কোর: {score:.2f}/1.0\n"
            "ইশিং লাকপা (72 চক): {rain:.1f}মিমি\n"
            "তৌবিয়ু: অয়াবা পীজরু।\n"
            "— RedBeryl / SIH26001"
        ),
        "CRITICAL": (
            "🚨 শাওধাং — থৌনা শক্তম\n"
            "মফম: {zone_name}\n"
            "শক্তম স্কোর: {score:.2f}/1.0\n"
            "ইশিং লাকপা (72 চক): {rain:.1f}মিমি\n"
            "তৌবিয়ু: লৈরোনবা ওইরক্তুনা হেল্লু।\n"
            "— RedBeryl / SIH26001"
        ),
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_message(zone: models.Zone, risk_level: str, combined_score: float,
                   language: str = "en") -> str:
    lang_templates = TEMPLATES.get(language, TEMPLATES["en"])
    template = lang_templates.get(risk_level, lang_templates["HIGH"])
    return template.format(
        zone_name=zone.name,
        lat=zone.lat,
        lon=zone.lon,
        score=combined_score,
        rain=zone.rainfall_mm_72h,
    )


def _send_fast2sms(message: str, numbers: list[str]) -> tuple[bool, str]:
    """
    Returns (success, error_or_empty).
    Uses Fast2SMS Quick SMS (non-DLT, works in trial).
    """
    if not FAST2SMS_API_KEY:
        return False, "FAST2SMS_API_KEY env var not set"

    try:
        resp = httpx.post(
            FAST2SMS_URL,
            headers={"authorization": FAST2SMS_API_KEY},
            data={
                "route": "q",
                "message": message,
                "language": "unicode",   # supports Devanagari + Bengali script
                "flash": 0,
                "numbers": ",".join(numbers),
            },
            timeout=10.0,
        )
        result = resp.json()
        if result.get("return"):
            return True, ""
        return False, result.get("message", "Unknown error")
    except Exception as e:
        return False, str(e)


def _get_last_alert_level(zone_id: int, db: Session) -> Optional[str]:
    """Returns the risk_level of the most recent alert for this zone, or None."""
    last = (
        db.query(models.AlertLog)
        .filter(models.AlertLog.zone_id == zone_id)
        .filter(models.AlertLog.status == "sent")
        .order_by(models.AlertLog.sent_at.desc())
        .first()
    )
    return last.risk_level if last else None


# ---------------------------------------------------------------------------
# Request/Response schemas
# ---------------------------------------------------------------------------

class AlertRequest(BaseModel):
    zone_id: int
    language: str = "en"       # en / hi / as / mni
    recipients: Optional[list[str]] = None   # override default numbers
    force: bool = False        # send even if level unchanged


class AlertCheckResult(BaseModel):
    zone_id: int
    zone_name: str
    risk_level: str
    combined_score: float
    alert_sent: bool
    skipped_reason: Optional[str] = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/send", response_model=dict)
def send_alert(req: AlertRequest, db: Session = Depends(get_db)):
    """
    Manually trigger an SMS alert for a zone.
    Used for demo: judges can see the alert fire in real time.
    """
    zone = db.query(models.Zone).filter(models.Zone.id == req.zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
    combined_score, risk_level = compute_combined_risk(zone.structural_risk, rainfall_risk)

    if risk_level not in ALERT_THRESHOLD_LEVELS and not req.force:
        return {
            "sent": False,
            "reason": f"Risk level is {risk_level} — below alert threshold. Use force=true to override.",
        }

    message = _build_message(zone, risk_level, combined_score, req.language)
    recipients = req.recipients or DEFAULT_RECIPIENTS.split(",")
    success, error = _send_fast2sms(message, recipients)

    log = models.AlertLog(
        zone_id=zone.id,
        risk_level=risk_level,
        combined_score=combined_score,
        channel="sms",
        language=req.language,
        message=message,
        recipients=",".join(recipients),
        status="sent" if success else "failed",
        error=error or None,
    )
    db.add(log)
    db.commit()

    return {
        "sent": success,
        "zone": zone.name,
        "risk_level": risk_level,
        "combined_score": round(combined_score, 3),
        "message_preview": message[:120] + "..." if len(message) > 120 else message,
        "recipients_count": len(recipients),
        "error": error or None,
    }


@router.post("/check-all", response_model=list[AlertCheckResult])
def check_all_zones(db: Session = Depends(get_db)):
    """
    Runs threshold check for every zone. Fires an alert only when
    the risk level is HIGH/CRITICAL AND it's different from the last
    alert sent (avoids spamming on consecutive runs).

    This is what update_all_zones.py calls automatically.
    Call this endpoint manually from the dashboard to trigger a sweep.
    """
    zones = db.query(models.Zone).all()
    results = []

    for zone in zones:
        rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
        combined_score, risk_level = compute_combined_risk(zone.structural_risk, rainfall_risk)

        result = AlertCheckResult(
            zone_id=zone.id,
            zone_name=zone.name,
            risk_level=risk_level,
            combined_score=round(combined_score, 3),
            alert_sent=False,
        )

        if risk_level not in ALERT_THRESHOLD_LEVELS:
            result.skipped_reason = f"Level is {risk_level} — below threshold"
            results.append(result)
            continue

        last_level = _get_last_alert_level(zone.id, db)
        if last_level == risk_level:
            result.skipped_reason = f"Already alerted at {risk_level} — no change"
            results.append(result)
            continue

        # Send in all four languages
        for lang in ["en", "hi", "as", "mni"]:
            message = _build_message(zone, risk_level, combined_score, lang)
            recipients = DEFAULT_RECIPIENTS.split(",")
            success, error = _send_fast2sms(message, recipients)

            log = models.AlertLog(
                zone_id=zone.id,
                risk_level=risk_level,
                combined_score=combined_score,
                channel="sms",
                language=lang,
                message=message,
                recipients=",".join(recipients),
                status="sent" if success else "failed",
                error=error or None,
            )
            db.add(log)

        db.commit()
        result.alert_sent = True
        results.append(result)

    return results


@router.get("/log", response_model=list[dict])
def get_alert_log(limit: int = 50, db: Session = Depends(get_db)):
    """Last N alerts — for the dashboard's notification history panel."""
    logs = (
        db.query(models.AlertLog)
        .order_by(models.AlertLog.sent_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": log.id,
            "zone_id": log.zone_id,
            "risk_level": log.risk_level,
            "combined_score": log.combined_score,
            "language": log.language,
            "message": log.message,
            "status": log.status,
            "sent_at": log.sent_at.isoformat() if log.sent_at else None,
            "error": log.error,
        }
        for log in logs
    ]


@router.get("/templates", response_model=dict)
def get_templates():
    """
    Returns all message templates in all languages.
    Useful for the frontend to preview what will be sent.
    """
    return {
        lang: {
            level: template
            for level, template in levels.items()
        }
        for lang, levels in TEMPLATES.items()
    }
