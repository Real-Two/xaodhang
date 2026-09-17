"""
chatbot.py — Xaodhang AI Copilot on Groq (free, no credit card needed).

Setup:
  1. console.groq.com → API Keys → Create (free, no card required)
  2. Railway → your service → Variables → add GROQ_API_KEY=gsk_...
  3. Deploy.

Models used:
  Primary:  llama-3.3-70b-versatile  (30 RPM free, better quality)
  Fallback: llama-3.1-8b-instant     (higher daily limit, faster)
  Auto-fallback on 429 rate limit or timeout.
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

# Language instructions written in the target language so the model
# bootstraps into the right mode immediately — more reliable than English
# instructions asking it to switch language.
LANG_INSTRUCTIONS = {
    "en":  "Respond in clear, concise English.",
    "hi":  "तुम्हें केवल हिंदी में जवाब देना है। Proper nouns के अलावा अंग्रेज़ी मत इस्तेमाल करो।",
    "as":  "তুমি কেৱল অসমীয়া ভাষাত উত্তৰ দিবা। Proper noun ৰ বাহিৰে ইংৰাজী ব্যৱহাৰ নকৰিবা।",
    "mni": "তোমার কেৱল মেইতেই ভাষাতে উত্তর দিতে হবে। Proper noun ছাড়া ইংরেজি ব্যবহার করো না।",
}

SYSTEM_PROMPT = """You are the Xaodhang AI Copilot — operational assistant for the Xaodhang Landslide Early Warning System (Team RedBeryl, SIH 2026, MDoNER / SIH26001).

*** LANGUAGE INSTRUCTION — MANDATORY, HIGHEST PRIORITY ***
{lang_instruction}
*** END LANGUAGE INSTRUCTION ***

SYSTEM:
Risk = 0.60×Terrain + 0.40×Rainfall + 0.15×(Terrain×Rainfall) + seismic uplift
Data: UNet on Sentinel-2 | Open-Meteo ERA5-Land | USGS earthquake feed

RISK LEVELS:
LOW <35%: routine monitoring
MODERATE 35-55%: prepare teams, monitor closely
HIGH 55-75%: issue advisory, pre-position rescue, restrict slope access
CRITICAL >75%: EVACUATE IMMEDIATELY, dispatch teams now

LIVE ZONE DATA (highest risk first):
{zone_context}

RULES:
- State recommended action FIRST for HIGH/CRITICAL zones
- Rank by combined score then population when prioritising
- Give specific evacuation destination when asked about any zone
- Answers under 150 words unless more is genuinely needed
- Only discuss: NER landslides, these zones, risk, evacuation, Xaodhang system"""


def _build_context(db: Session) -> str:
    """DB-only — zero HTTP calls, instant, never times out."""
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
            detail="GROQ_API_KEY not set. Get a free key at console.groq.com and add it to Railway env vars.",
        )

    lang_code = req.language if req.language in LANG_INSTRUCTIONS else "en"
    system    = SYSTEM_PROMPT.format(
        lang_instruction=LANG_INSTRUCTIONS[lang_code],
        zone_context=_build_context(db),
    )

    messages = [
        {"role": h["role"], "content": h["content"]}
        for h in req.history[-6:]
        if h.get("role") in ("user", "assistant") and h.get("content")
    ]
    messages.append({"role": "user", "content": req.message})

    reply = None
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
                last_error = f"Rate limited on {model}"
                continue   # try fallback model

            resp.raise_for_status()
            reply = resp.json()["choices"][0]["message"]["content"]
            break

        except httpx.TimeoutException:
            last_error = f"Timeout on {model}"
            continue
        except httpx.HTTPStatusError as e:
            last_error = e.response.text[:300]
            if e.response.status_code == 429:
                continue
            # Non-rate-limit error — don't retry
            raise HTTPException(status_code=502, detail=f"Groq error: {last_error}")

    if reply is None:
        raise HTTPException(
            status_code=503,
            detail=f"Groq unavailable: {last_error}. Try again in 30 seconds.",
        )

    zones            = db.query(models.Zone).all()
    zones_referenced = [z.name for z in zones if z.name.split(",")[0].lower() in reply.lower()]

    ru = reply.upper()
    suggested_action = (
        "EVACUATE"     if "EVACUATE" in ru else
        "DEPLOY_TEAMS" if ("DEPLOY" in ru or "DISPATCH" in ru) else
        "MONITOR"      if ("MONITOR" in ru or "ADVISORY" in ru) else
        None
    )

    return ChatResponse(
        reply=reply,
        zones_referenced=zones_referenced,
        suggested_action=suggested_action,
    )
