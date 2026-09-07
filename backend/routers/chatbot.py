"""
chatbot.py — AI assistant for Xaodhang.

POST /chat — takes a user question, injects live zone risk data as
context, and returns an answer via the Anthropic API.

Scoped tightly to be useful, not generic:
  - "Is Noney safe right now?"
  - "Which zones are CRITICAL?"
  - "What should I do if I'm near a HIGH risk area?"
  - "What does the risk score mean?"
  - "How much rain has fallen in Tupul?"

Environment variables:
  ANTHROPIC_API_KEY — required

The system prompt is injected fresh on every call with current zone data
pulled from the DB, so the chatbot always reflects live conditions.
"""

import os
import json

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db
from risk_engine import compute_combined_risk, compute_rainfall_risk

router = APIRouter(prefix="/chat", tags=["chatbot"])

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-haiku-4-5-20251001"   # fast + cheap for chat queries


def _build_zone_context(db: Session) -> str:
    """Builds a concise summary of current risk status for all zones."""
    zones = db.query(models.Zone).all()
    if not zones:
        return "No zones are currently monitored."

    lines = ["Current risk status for all monitored NER zones:\n"]
    for zone in zones:
        rainfall_risk = compute_rainfall_risk(zone.rainfall_mm_72h)
        combined_score, risk_level = compute_combined_risk(zone.structural_risk, rainfall_risk)
        lines.append(
            f"- {zone.name} (lat {zone.lat:.3f}, lon {zone.lon:.3f}): "
            f"Risk Level = {risk_level}, Score = {combined_score:.2f}, "
            f"Structural Risk = {zone.structural_risk:.2f}, "
            f"Rainfall 72h = {zone.rainfall_mm_72h:.1f}mm"
        )
    return "\n".join(lines)


SYSTEM_PROMPT_TEMPLATE = """You are Xaodhang Assistant, the AI helper for the Xaodhang Landslide Early Warning System built by Team RedBeryl for Smart India Hackathon 2026.

Xaodhang monitors landslide risk in India's North Eastern Region (NER) using:
- A DeepLabV3+ segmentation model trained on Sentinel-2 satellite imagery (structural terrain risk)
- CHIRPS rainfall data via Google Earth Engine (rainfall trigger — 24h/48h/72h accumulation)
- A combined risk engine that produces scores from 0 to 1, classified as LOW / MODERATE / HIGH / CRITICAL

Risk level meanings:
- LOW (score < 0.30): Normal conditions. No action needed.
- MODERATE (0.30–0.50): Elevated — monitor closely. No immediate action.
- HIGH (0.50–0.70): Issue advisory. Pre-position rescue teams. Avoid the slope.
- CRITICAL (> 0.70): EVACUATE immediately. Dispatch teams now.

{zone_context}

Answer questions about zone risk levels, what to do in an emergency, how the system works, or what the data means. 
Be concise and clear. For HIGH/CRITICAL zones, always emphasize the recommended action.
If asked about a specific zone not in the list, say so politely.
Never provide medical advice or information unrelated to landslides and this system.
Respond in the same language the user writes in where possible.
"""


class ChatRequest(BaseModel):
    message: str
    language: str = "en"   # hint for response language: en / hi / as / mni


class ChatResponse(BaseModel):
    reply: str
    zones_referenced: list[str] = []


@router.post("", response_model=ChatResponse)
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    """
    Ask the Xaodhang assistant anything about current risk conditions.
    Live zone data is injected into every request so answers are always current.
    """
    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not configured on this server."
        )

    zone_context = _build_zone_context(db)
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(zone_context=zone_context)

    lang_hint = ""
    if req.language == "hi":
        lang_hint = " (Please respond in Hindi.)"
    elif req.language == "as":
        lang_hint = " (Please respond in Assamese.)"
    elif req.language == "mni":
        lang_hint = " (Please respond in Meitei/Manipuri.)"

    try:
        resp = httpx.post(
            ANTHROPIC_URL,
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": MODEL,
                "max_tokens": 512,
                "system": system_prompt,
                "messages": [
                    {"role": "user", "content": req.message + lang_hint}
                ],
            },
            timeout=20.0,
        )
        resp.raise_for_status()
        data = resp.json()
        reply = data["content"][0]["text"]
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Anthropic API error: {e.response.text}")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Chat failed: {e}")

    # Find which zone names appear in the reply for frontend highlighting
    zones = db.query(models.Zone).all()
    referenced = [z.name for z in zones if z.name.lower() in reply.lower()]

    return ChatResponse(reply=reply, zones_referenced=referenced)
