"""
chatbot.py — Xaodhang AI Copilot on Groq (free).

Setup:
  1. console.groq.com → API Keys → Create (free, no card)
  2. Render → xaodhang service → Environment → add GROQ_API_KEY=gsk_...
  3. Auto-deploys on save.

Language fix:
  Llama ignores system-prompt language instructions when the conversation
  is in English. The only reliable trigger is prepending a short translated
  instruction as the FIRST thing in the user message turn itself.
  e.g. user message becomes:
    "[Respond in Hindi only]\nWhich zones are critical?"
  Llama bootstraps into Hindi from that first line and stays there.
"""

import os

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db
from risk_engine import compute_combined_risk, compute_rainfall_risk
from zone_impact import get_zone_impact

router = APIRouter(prefix="/chat", tags=["chatbot"])

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_URL     = "https://api.groq.com/openai/v1/chat/completions"
MODEL_GOOD   = "llama-3.3-70b-versatile"
MODEL_FAST   = "llama-3.1-8b-instant"

EVAC_TARGETS = {
    "noney":      "Noney District HQ",
    "tupul":      "Noney District HQ",
    "aizawl":     "Aizawl City",
    "shillong":   "Jowai Town",
    "kohima":     "Senapati District HQ",
    "jiribam":    "Jiribam Town Centre",
    "gangtok":    "Gangtok City Centre",
    "tawang":     "Dirang Town",
    "dima hasao": "Haflong Town",
    "champhai":   "Champhai Town Centre",
}

# Prepended to EVERY user message when language != en.
# Written in the target language so Llama bootstraps immediately.
LANG_PREFIXES = {
    "hi":  "[निर्देश: केवल हिंदी में उत्तर दें।]",
    "as":  "[নির্দেশ: কেৱল অসমীয়াত উত্তৰ দিবা।]",
    "mni": "[নির্দেশ: কেৱল মেইতেই ভাষাতে উত্তর দাও।]",
}

SYSTEM = """You are the Xaodhang AI Copilot — operational assistant for the Xaodhang Landslide Early Warning System (Team RedBeryl, SIH 2026, MDoNER SIH26001).

You MUST respond in whatever language the user message instructs. If the message starts with a [নির্দেশ] or [निर्देश] tag, follow it strictly and respond entirely in that language.

SYSTEM: UNet on Sentinel-2 | Open-Meteo ERA5-Land rainfall | USGS seismic
Risk = 0.60×Terrain + 0.40×Rainfall + 0.15×(T×R) + seismic

LEVELS: LOW<35% | MODERATE 35-55% | HIGH 55-75% | CRITICAL>75%

CURRENT ZONE DATA (highest risk first):
{zone_context}

RULES:
- For HIGH/CRITICAL: state recommended action FIRST
- Rank by combined score then population when prioritising
- Give specific evacuation destination when asked
- Under 150 words unless genuinely needed
- Only discuss: NER landslides, zones, risk, evacuation, Xaodhang"""


def _build_context(db: Session) -> str:
    zones = db.query(models.Zone).all()
    if not zones:
        return "No zone data available."
    rows = []
    for z in zones:
        rr           = compute_rainfall_risk(z.rainfall_mm_72h or 0)
        score, level = compute_combined_risk(z.structural_risk or 0, rr)
        impact       = get_zone_impact(z.name)
        evac_key     = next((k for k in EVAC_TARGETS if k in z.name.lower()), None)
        evac         = EVAC_TARGETS[evac_key] if evac_key else "nearest district HQ"
        pop          = f"~{impact['population_5km']:,} people" if impact["population_5km"] else "pop unknown"
        road         = next((i["name"] for i in impact.get("critical_infra", []) if i["type"] == "road"), "—")
        rows.append((score, f"[{level}] {z.name}: {score*100:.0f}% | terrain {z.structural_risk*100:.0f}% | rain {z.rainfall_mm_72h:.0f}mm | {pop} | {road} | evac→{evac}"))
    rows.sort(key=lambda x: x[0], reverse=True)
    return "\n".join(r for _, r in rows)


class ChatRequest(BaseModel):
    message:  str
    language: str        = "en"
    history:  list[dict] = []


class ChatResponse(BaseModel):
    reply:            str
    zones_referenced: list[str]  = []
    suggested_action: str | None = None


@router.post("", response_model=ChatResponse)
def chat(req: ChatRequest, db: Session = Depends(get_db)):
    if not GROQ_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="GROQ_API_KEY not configured. Add it to Render environment variables (console.groq.com for a free key).",
        )

    # Prepend language instruction to user message if not English
    lang     = req.language if req.language in LANG_PREFIXES else "en"
    prefix   = LANG_PREFIXES.get(lang, "")
    user_msg = f"{prefix}\n{req.message}" if prefix else req.message

    system = SYSTEM.format(zone_context=_build_context(db))

    messages = [
        {"role": h["role"], "content": h["content"]}
        for h in req.history[-6:]
        if h.get("role") in ("user", "assistant") and h.get("content")
    ]
    messages.append({"role": "user", "content": user_msg})

    reply      = None
    last_error = None

    for model in [MODEL_GOOD, MODEL_FAST]:
        try:
            resp = httpx.post(
                GROQ_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type":  "application/json",
                },
                json={
                    "model":       model,
                    "max_tokens":  600,
                    "temperature": 0.3,
                    "messages":    [{"role": "system", "content": system}] + messages,
                },
                timeout=20.0,
            )

            if resp.status_code == 429:
                last_error = f"rate limited on {model}"
                continue

            resp.raise_for_status()
            reply = resp.json()["choices"][0]["message"]["content"]
            break

        except httpx.TimeoutException:
            last_error = f"timeout on {model}"
            continue
        except httpx.HTTPStatusError as e:
            last_error = e.response.text[:200]
            if e.response.status_code == 429:
                continue
            raise HTTPException(status_code=502, detail=f"Groq error: {last_error}")

    if reply is None:
        raise HTTPException(
            status_code=503,
            detail=f"Groq unavailable ({last_error}). Try again in 30 seconds.",
        )

    zones            = db.query(models.Zone).all()
    zones_referenced = [z.name for z in zones if z.name.split(",")[0].lower() in reply.lower()]

    ru = reply.upper()
    suggested_action = (
        "EVACUATE"     if "EVACUATE" in ru or "निकासी" in reply or "খালী" in reply else
        "DEPLOY_TEAMS" if "DEPLOY"   in ru or "DISPATCH" in ru else
        "MONITOR"      if "MONITOR"  in ru or "ADVISORY" in ru else
        None
    )

    return ChatResponse(
        reply=reply,
        zones_referenced=zones_referenced,
        suggested_action=suggested_action,
    )
