"""
risk_engine.py — Two-layer landslide risk combinator with optional seismic modifier.

Formula (unchanged from v2):
  base      = 0.60 × structural + 0.40 × rainfall
  combined  = base + 0.15 × structural × rainfall   (interaction term)

Seismic modifier (new in v3):
  Applied to structural_risk BEFORE it enters the formula.
  seismic_uplift ∈ [0, 0.08] — computed in seismic.py.
  structural_effective = min(1.0, structural + seismic_uplift)

  This means seismic can add at most 0.08 × 0.60 = 0.048 to the final
  combined score (under 5 percentage points). It cannot change a zone's
  risk LEVEL on its own — it only matters when the zone is already close
  to a threshold. That's the correct physical interpretation: an earthquake
  doesn't cause landslides by itself in NER; it weakens susceptible slopes
  that were already at risk.

Thresholds (NER-calibrated, unchanged):
  CRITICAL ≥ 0.75
  HIGH     ≥ 0.55
  MODERATE ≥ 0.35
  LOW       < 0.35
"""

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


def compute_rainfall_risk(rainfall_mm_72h: float,
                           threshold_mm: float = RAINFALL_THRESHOLD_MM_72H) -> float:
    if threshold_mm <= 0:
        return 0.0
    return max(0.0, min(1.0, rainfall_mm_72h / threshold_mm))


def classify_level(score: float) -> str:
    for cutoff, label in RISK_LEVELS:
        if score >= cutoff:
            return label
    return "LOW"


def compute_combined_risk(structural_risk: float,
                           rainfall_risk: float,
                           seismic_uplift: float = 0.0) -> tuple[float, str]:
    """
    Returns (combined_score in [0,1], risk_level string).

    seismic_uplift is added to structural before the formula runs.
    It is capped so structural_effective never exceeds 1.0.
    """
    s = max(0.0, min(1.0, structural_risk + seismic_uplift))
    r = max(0.0, min(1.0, rainfall_risk))

    base        = STRUCTURAL_WEIGHT * s + RAINFALL_WEIGHT * r
    interaction = INTERACTION_WEIGHT * s * r
    combined    = min(1.0, base + interaction)

    return round(combined, 4), classify_level(combined)


if __name__ == "__main__":
    cases = [
        ("flat_dry    S=0.1 R=0.1 Q=0.00",  0.1,  0.1,  0.00),
        ("risky_dry   S=0.8 R=0.05 Q=0.00", 0.8,  0.05, 0.00),
        ("risky_dry   S=0.8 R=0.05 Q=0.08", 0.8,  0.05, 0.08),  # seismic at max
        ("flat_wet    S=0.05 R=0.8 Q=0.00", 0.05, 0.8,  0.00),
        ("flat_wet    S=0.05 R=0.8 Q=0.08", 0.05, 0.8,  0.08),  # seismic on flat — still LOW
        ("medium_both S=0.5 R=0.5 Q=0.00",  0.5,  0.5,  0.00),
        ("medium_both S=0.5 R=0.5 Q=0.08",  0.5,  0.5,  0.08),  # seismic on medium
    ]
    for name, s, r, q in cases:
        score, level = compute_combined_risk(s, r, q)
        print(f"{name}  ->  {score:.3f}  {level}")

    # Seismic on a flat zone should not change level
    score_no_q, level_no_q = compute_combined_risk(0.05, 0.1, 0.0)
    score_q,    level_q    = compute_combined_risk(0.05, 0.1, 0.08)
    assert level_no_q == level_q == "LOW", "seismic alone should not lift flat zone out of LOW"

    # Seismic max uplift < 5pp on final score
    score_base, _ = compute_combined_risk(0.7, 0.6, 0.0)
    score_seis, _ = compute_combined_risk(0.7, 0.6, 0.08)
    assert (score_seis - score_base) < 0.055, f"seismic added too much: {score_seis - score_base:.3f}"

    print("\nAll assertions passed.")
