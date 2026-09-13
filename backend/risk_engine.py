"""
risk_engine.py — Two-layer landslide risk combinator.

NER-calibrated thresholds (updated):
  - Rainfall threshold raised to 150mm/72h. In Northeast India, Cherrapunji
    and the Meghalaya hills regularly see 100mm in a single day — treating
    100mm as "maximum risk" was inflating rainfall_risk to 0.8–1.0 everywhere
    during monsoon, making the combined score meaningless.

  - Structural weight raised to 0.60, rainfall to 0.40. Terrain
    susceptibility (slope angle, lithology, soil depth, historical slip
    planes captured by the UNet) is the stable underlying risk factor.
    Rainfall is a trigger, not the risk itself — a steep unstable slope is
    dangerous even in a dry spell, and a flat valley floor doesn't become
    a landslide risk just because it rained hard.

  - Interaction weight reduced to 0.15. The compounding bonus should fire
    when BOTH layers are simultaneously high — but it was previously adding
    up to 0.192 (0.3 × 0.8 × 0.8) on top of an already-inflated base,
    pushing too many points to CRITICAL.

  - Risk level thresholds tightened:
      CRITICAL ≥ 0.75  (was 0.70) — genuine imminent danger
      HIGH     ≥ 0.55  (was 0.50) — alert-worthy, evacuation consideration
      MODERATE ≥ 0.35  (was 0.30) — elevated watch
      LOW       < 0.35            — routine monitoring

Rationale for tighter CRITICAL threshold:
  A system that cries CRITICAL at every third grid point trains DM officers
  to ignore it. False positives in early warning systems kill people — not
  directly, but by eroding trust until the real alert gets ignored.
  The threshold should be calibrated so CRITICAL is rare and actionable.
"""

# ── Tunable constants ─────────────────────────────────────────────────────────

# 150mm/72h is a defensible NER-specific threshold:
#   - IMD classifies "extremely heavy rainfall" as >204mm/day
#   - NDMA landslide literature uses 100–150mm/24h as trigger threshold
#   - 150mm/72h (~50mm/day) is moderate-to-heavy sustained NER monsoon
RAINFALL_THRESHOLD_MM_72H = 150.0

STRUCTURAL_WEIGHT  = 0.60
RAINFALL_WEIGHT    = 0.40
INTERACTION_WEIGHT = 0.15

RISK_LEVELS = [
    (0.75, "CRITICAL"),
    (0.55, "HIGH"),
    (0.35, "MODERATE"),
    (0.00, "LOW"),
]


# ── Core functions ────────────────────────────────────────────────────────────

def compute_rainfall_risk(rainfall_mm_72h: float,
                           threshold_mm: float = RAINFALL_THRESHOLD_MM_72H) -> float:
    """Linear ramp: 0 at 0mm, 1.0 at/above threshold_mm."""
    if threshold_mm <= 0:
        return 0.0
    return max(0.0, min(1.0, rainfall_mm_72h / threshold_mm))


def classify_level(score: float) -> str:
    for cutoff, label in RISK_LEVELS:
        if score >= cutoff:
            return label
    return "LOW"


def compute_combined_risk(structural_risk: float,
                           rainfall_risk: float) -> tuple[float, str]:
    """
    Returns (combined_score in [0,1], risk_level string).

    Formula: base = 0.60×S + 0.40×R
             combined = base + 0.15×S×R   (interaction bonus, capped at 1.0)

    The interaction term specifically rewards the physically dangerous case
    where both a susceptible slope AND a rainfall trigger are present
    simultaneously. A plain weighted average would treat S=1, R=0 and
    S=0.5, R=0.5 identically — this formula doesn't.
    """
    s = max(0.0, min(1.0, structural_risk))
    r = max(0.0, min(1.0, rainfall_risk))

    base        = STRUCTURAL_WEIGHT * s + RAINFALL_WEIGHT * r
    interaction = INTERACTION_WEIGHT * s * r
    combined    = min(1.0, base + interaction)

    return round(combined, 4), classify_level(combined)


# ── Smoke test ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    cases = {
        "flat_dry    (S=0.1, R=0.1)":  (0.1,  0.1),
        "risky_dry   (S=0.8, R=0.05)": (0.8,  0.05),
        "flat_wet    (S=0.05,R=0.8)":  (0.05, 0.8),
        "risky_wet   (S=0.8, R=0.8)":  (0.8,  0.8),
        "medium_both (S=0.5, R=0.5)":  (0.5,  0.5),
        "chirp_norm  (S=0.6, R=0.6)":  (0.6,  0.6),   # was CRITICAL before fix
    }
    for name, (s, r) in cases.items():
        score, level = compute_combined_risk(s, r)
        print(f"{name}  ->  combined={score:.3f}  ({level})")

    # Ordering assertions
    both_high, _      = compute_combined_risk(0.8, 0.8)
    struct_only, _    = compute_combined_risk(0.8, 0.05)
    rainfall_only, _  = compute_combined_risk(0.05, 0.8)
    medium_both, _    = compute_combined_risk(0.5, 0.5)

    assert both_high > struct_only,   "compounding must beat struct-only"
    assert both_high > rainfall_only, "compounding must beat rainfall-only"
    assert struct_only > rainfall_only, "terrain > rainfall in NER context"

    # Sanity: medium (0.5, 0.5) should be HIGH not CRITICAL
    assert medium_both < 0.75, f"medium scores should not be CRITICAL, got {medium_both}"

    print("\nAll assertions passed.")
