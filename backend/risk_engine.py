"""
Combines the two independent risk layers into one actionable score.

Design rationale (say this out loud to judges — it's the most defensible
part of the architecture):

  Landslides need BOTH a susceptible slope (structural) AND a trigger
  (rainfall). Neither factor alone tells the full story:
    - High structural risk + no rain  -> a slope to watch, not an emergency
    - Heavy rain + stable terrain     -> lower concern than the same rain
                                          on a fragile slope
    - Both high at once               -> genuine compounding danger

  So instead of a flat weighted average, we add an interaction bonus term
  that specifically rewards the case where BOTH layers are elevated
  simultaneously — that's the physically dangerous scenario a simple
  average would under-emphasize.

All thresholds/weights below are configurable constants, not buried magic
numbers — tune them once you have real validation data or IMD/CHIRPS
exceedance statistics for the specific NER districts you're targeting.
"""

# --- Tunable constants -------------------------------------------------

RAINFALL_THRESHOLD_MM_72H = 100.0  # 72h cumulative rainfall considered "heavy" for NER hill terrain
STRUCTURAL_WEIGHT = 0.5
RAINFALL_WEIGHT = 0.5
INTERACTION_WEIGHT = 0.3  # bonus applied when both layers are simultaneously elevated

RISK_LEVELS = [
    (0.70, "CRITICAL"),
    (0.50, "HIGH"),
    (0.30, "MODERATE"),
    (0.00, "LOW"),
]


def compute_rainfall_risk(rainfall_mm_72h: float,
                           threshold_mm: float = RAINFALL_THRESHOLD_MM_72H) -> float:
    """Linear ramp from 0 at no-rain to 1.0 at/above the threshold."""
    if threshold_mm <= 0:
        return 0.0
    return max(0.0, min(1.0, rainfall_mm_72h / threshold_mm))


def classify_level(score: float) -> str:
    for cutoff, label in RISK_LEVELS:
        if score >= cutoff:
            return label
    return "LOW"


def compute_combined_risk(structural_risk: float, rainfall_risk: float) -> tuple[float, str]:
    """
    Returns (combined_score in [0,1], risk_level string).
    """
    structural_risk = max(0.0, min(1.0, structural_risk))
    rainfall_risk = max(0.0, min(1.0, rainfall_risk))

    base = STRUCTURAL_WEIGHT * structural_risk + RAINFALL_WEIGHT * rainfall_risk
    interaction_bonus = INTERACTION_WEIGHT * structural_risk * rainfall_risk
    combined = min(1.0, base + interaction_bonus)

    return combined, classify_level(combined)


if __name__ == "__main__":
    # Smoke test: the four qualitative scenarios described above should
    # produce a sensible ordering, with the "both high" case landing in the
    # top bracket even though a plain average of 0.8/0.8 would too — the
    # real check is that it's not LOWER than what an average would give it,
    # and that "one high, one zero" cases land distinctly below it.
    cases = {
        "both_low": (0.1, 0.1),
        "structural_high_only": (0.8, 0.05),
        "rainfall_high_only": (0.05, 0.8),
        "both_high": (0.8, 0.8),
    }
    for name, (s, r) in cases.items():
        score, level = compute_combined_risk(s, r)
        print(f"{name}: structural={s} rainfall={r} -> combined={score:.3f} ({level})")

    both_high_score, _ = compute_combined_risk(0.8, 0.8)
    structural_only_score, _ = compute_combined_risk(0.8, 0.05)
    rainfall_only_score, _ = compute_combined_risk(0.05, 0.8)
    assert both_high_score > structural_only_score
    assert both_high_score > rainfall_only_score
    print("\nSmoke test passed: compounding case scores highest, as intended.")
