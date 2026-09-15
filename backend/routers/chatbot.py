"""
chatbot.py — Scenario-aware AI assistant for Xaodhang.

POST /chat

The assistant has full situational awareness:
  - Current risk level and score for every zone
  - Forecast risk for next 72h per zone
  - Impact data (population, roads, facilities)
  - Evacuation routes to nearest district HQ
  - Priority ordering

It can answer:
  - "Which zones are critical right now?"
  - "What's the evacuation route for Noney?"
  - "Where should I send teams first?"
  - "Will conditions get worse in Manipur tonight?"
  - "How many people are at risk across HIGH zones?"
  - "What does a 78% risk score mean?"

Uses claude-haiku — fast, cheap (~$0.001 per query), already integrated.
"""

import os
import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db
from risk_engine import compute_combined_risk, compute_rainfall_risk
from zone_impact import get_zone_impact

router = APIRouter(prefix="/chat", tags=["chatbot"])

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_URL     = "https://api.anthropic.com/v1/messages"
MODEL             = "claude-haiku-4-5-20251001"

# District HQ evacuation targets — nearest safe destination per zone
EVACUATION_TARGETS = {
    "noney":      {"name": "Noney District HQ",        "lat": 24.9883, "lon": 93.5167},
    "tupul":      {"name": "Noney District HQ",        "lat": 24.9883, "lon": 93.5167},
    "aizawl":    {"name": "Aizawl City",              "lat": 23.7271, "lon": 92.7176},
    "shillong":  {"name": "Jowai Town",               "lat": 25.4500, "lon": 92.2000},
    "kohima":    {"name": "Senapati District HQ",     "lat": 25.2667, "lon": 94.0167},
    "jiribam":   {"name": "Jiribam Town Centre",      "lat": 24.8000, "lon": 93.1000},
    "gangtok":   {"name": "Gangtok City Centre",      "lat": 27.3389, "lon": 88.6065},
    "tawang":    {"name": "Dirang Town",              "lat": 27.3583, "lon": 92.2417},
    "dima hasao": {"name": "Haflong Town",            "lat": 25.1700, "lon": 93.0200},
    "champhai":  {"name": "Champhai Town Centre",     "lat": 23.4588, "lon": 93.3221},
}


def _match_evac_key(zone_name: str) -> str | None:
    name_lower = zone_name.lower()
    for key in EVACUATION_TARGETS:
        if key in name_lower:
            return key
    return None


def _build_full_context(db: Session) -> str:
    """
    Builds comprehensive situational context injected into every chat call.
    Includes: current risk, forecast risk, impact data, evacuation targets.
    Sorted by priority (highest risk first).
    """
    zones = db.query(models.Zone).all()
    if not zones:
        return "No zones currently monitored."

    zone_summaries = []
    for zone in zones:
        rainfall_risk              = compute_rainfall_risk(zone.rainfall_mm_72h)
        combined_score, risk_level = compute_combined_risk(zone.structural_risk, rainfall_risk)
        impact                     = get_zone_impact(zone.name)
        evac_key                   = _match_evac_key(zone.name)
        evac_target                = EVACUATION_TARGETS.get(evac_key) if evac_key else None

        # Forecast via Open-Meteo — best effort, skip if fails
        forecast_line = ""
        try:
            import httpx as _httpx
            r = _httpx.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": zone.lat, "longitude": zone.lon,
                    "hourly": "precipitation", "forecast_days": 3,
                    "timezone": "Asia/Kolkata",
                },
                timeout=5.0,
            )
            hourly = r.json().get("hourly", {}).get("precipitation", [])
            fc72   = round(sum(hourly[:72]), 1)
            from risk_engine import compute_rainfall_risk as crr, compute_combined_risk as ccr
            fc_rr  = crr(fc72)
            _, fc_level = ccr(zone.structural_risk, fc_rr)
            trend = "↑ WORSENING" if fc_level > risk_level else ("↓ IMPROVING" if fc_level < risk_level else "→ STABLE")
            forecast_line = f"\n  Forecast (72h): {fc72}mm → {fc_level} {trend}"
        except Exception:
            forecast_line = "\n  Forecast: unavailable"

        pop_line  = f"~{impact['population_5km']:,} people within 5km" if impact["population_5km"] else ""
        road_line = ""
        fac_line  = ""
        for item in impact.get("critical_infra", []):
            if item["type"] == "road":
                road_line = f"{item['name']} ({item['dist_km']}km)"
            else:
                fac_line = f"{item['name']} ({item['type']}, {item['dist_km']}km)"

        evac_line = f"\n  Evacuation → {evac_target['name']}" if evac_target else ""

        zone_summaries.append((combined_score, (
            f"ZONE: {zone.name}\n"
            f"  Lat/Lon: {zone.lat:.4f}°N, {zone.lon:.4f}°E\n"
            f"  Risk Level: {risk_level} | Score: {combined_score:.2f}\n"
            f"  Terrain Risk: {zone.structural_risk:.2f} | "
            f"Rainfall 72h: {zone.rainfall_mm_72h:.1f}mm{forecast_line}\n"
            f"  Population: {pop_line}\n"
            f"  Nearest road: {road_line}\n"
            f"  Nearest facility: {fac_line}"
            f"{evac_line}"
        )))

    zone_summaries.sort(key=lambda x: x[0], reverse=True)
    return "\n\n".join(s for _, s in zone_summaries)


SYSTEM_PROMPT = """You are the Xaodhang AI Copilot — the operational assistant for the Xaodhang Landslide Early Warning System, built by Team RedBeryl for Smart India Hackathon 2026 (Problem Statement SIH26001, MDoNER).

SYSTEM OVERVIEW:
Xaodhang monitors landslide risk across Northeast India (NER) using:
- UNet deep learning model on 10m Sentinel-2 satellite imagery (terrain susceptibility)
- Open-Meteo ERA5-Land real-time rainfall data (72h accumulation)
- USGS live earthquake feed (seismic uplift factor)
- Combined risk formula: Risk = 0.60×Terrain + 0.40×Rainfall + 0.15×(T×R) + seismic

RISK LEVELS:
- LOW (<0.35): Normal. No action needed.
- MODERATE (0.35-0.55): Elevated. Monitor closely, prepare teams.
- HIGH (0.55-0.75): Issue advisory. Pre-position rescue teams. Avoid the slope.
- CRITICAL (>0.75): EVACUATE NOW. Dispatch teams immediately.

CURRENT SITUATIONAL PICTURE (live data, sorted by priority):
{zone_context}

YOUR CAPABILITIES:
You can answer questions about:
1. Which zones need attention right now and why
2. Evacuation routes to nearest district HQ for any zone
3. Population and infrastructure at risk
4. Whether conditions are expected to improve or worsen
5. How to prioritize limited response resources across zones
6. What specific risk scores mean in practical terms
7. How the AI model and data pipeline works

RESPONSE STYLE:
- Be direct and operational — this is for disaster managers, not researchers
- For HIGH/CRITICAL zones always state the recommended action first
- When asked for priority ordering, rank by combined score then by population impact
- Keep responses concise but complete — lives may depend on quick decisions
- If asked about evacuation, give the specific destination from the zone data above
- Respond in the same language the user writes in

You are NOT a general-purpose assistant. Stay strictly on topic: landslides, risk levels, 
evacuation, NER zone data, and the Xaodhang system. Politely redirect off-topic questions."""


class ChatRequest(BaseModel):
    message:  str
    language: str = "en"    # en / hi / as / mni
    history:  list[dict] = []   # [{role: user|assistant, content: str}] for multi-turn


class ChatResponse(BaseModel):
    reply:            str
    zones_referenced: list[str] = []
    suggested_action: str | None = None   # e.g. "EVACUATE", "MONITOR", "DEPLOY"


@router.post("", response_model=ChatResponse)
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not configured. Add it to Railway environment variables."
        )

    zone_context = _build_full_context(db)
    system       = SYSTEM_PROMPT.format(zone_context=zone_context)

    lang_suffix = {
        "hi":  " (कृपया हिंदी में उत्तर दें।)",
        "as":  " (অনুগ্ৰহ কৰি অসমীয়াত উত্তৰ দিয়ক।)",
        "mni": " (মেইতেই ভাষাতে উত্তর দিন।)",
    }.get(req.language, "")

    # Build message list — support multi-turn history
    messages = []
    for h in req.history[-6:]:   # last 3 turns (6 messages) to keep tokens low
        if h.get("role") in ("user", "assistant") and h.get("content"):
            messages.append({"role": h["role"], "content": h["content"]})
    messages.append({"role": "user", "content": req.message + lang_suffix})

    try:
        resp = httpx.post(
            ANTHROPIC_URL,
            headers={
                "x-api-key":          ANTHROPIC_API_KEY,
                "anthropic-version":  "2023-06-01",
                "content-type":       "application/json",
            },
            json={
                "model":      MODEL,
                "max_tokens": 600,
                "system":     system,
                "messages":   messages,
            },
            timeout=25.0,
        )
        resp.raise_for_status()
        reply = resp.json()["content"][0]["text"]
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {e.response.text}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Chat failed: {e}")

    # Which zones were mentioned?
    zones             = db.query(models.Zone).all()
    zones_referenced  = [z.name for z in zones if z.name.split(",")[0].lower() in reply.lower()]

    # Infer a suggested action from the reply
    reply_upper       = reply.upper()
    suggested_action  = None
    if "EVACUATE" in reply_upper:
        suggested_action = "EVACUATE"
    elif "DEPLOY" in reply_upper or "DISPATCH" in reply_upper:
        suggested_action = "DEPLOY_TEAMS"
    elif "MONITOR" in reply_upper or "ADVISORY" in reply_upper:
        suggested_action = "MONITOR"

    return ChatResponse(
        reply=reply,
        zones_referenced=zones_referenced,
        suggested_action=suggested_action,
    )
