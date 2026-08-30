/**
 * riskUtils.js
 * Client-side risk computation matching risk_engine.py exactly.
 * Used to enrich GET /zones responses which only return raw structural_risk
 * and rainfall fields — not the derived combined_score or risk_level.
 */

/**
 * Compute combined risk score and level from raw fields.
 *
 * Formula from risk_engine.py:
 *   rainfallRisk = min(rainfall_72h / 150, 1.0)
 *   combined     = 0.6 * structural + 0.4 * rainfallRisk + 0.1 * structural * rainfallRisk
 *
 * Thresholds:
 *   combined >= 0.7  → CRITICAL
 *   combined >= 0.5  → HIGH
 *   combined >= 0.3  → MODERATE
 *   otherwise        → LOW
 *
 * @param {number} structural   structural_risk from model (0–1)
 * @param {number} rainfall_72h raw rainfall accumulation in mm over 72h
 * @returns {{ score: number, level: string, rainfall_risk: number }}
 */
export function computeRisk(structural, rainfall_72h) {
  const s = structural ?? 0;
  const r = rainfall_72h ?? 0;

  const rainfallRisk = Math.min(r / 150, 1.0);
  const combined = 0.6 * s + 0.4 * rainfallRisk + 0.1 * s * rainfallRisk;

  let level;
  if (combined >= 0.7) level = 'CRITICAL';
  else if (combined >= 0.5) level = 'HIGH';
  else if (combined >= 0.3) level = 'MODERATE';
  else level = 'LOW';

  return { score: combined, level, rainfall_risk: rainfallRisk };
}

/**
 * Enrich a raw zone object from GET /zones with computed risk fields.
 * Preserves all existing fields; only overwrites combined_score / risk_level
 * if the zone doesn't already have authoritative values from the backend.
 *
 * GET /zones may return several rainfall field names depending on backend version:
 *   rainfall_mm_72h, rainfall_72h, rainfall, rainfall_mm
 * We try them in order.
 */
export function enrichZone(zone) {
  // If the backend already returned a meaningful combined_score, trust it
  if (zone.combined_score != null && zone.combined_score > 0 && zone.risk_level) {
    return zone;
  }

  const structural = zone.structural_risk ?? 0;

  // Try all known rainfall field names
  const rawRainfall =
    zone.rainfall_mm_72h ??
    zone.rainfall_72h ??
    zone.rainfall_mm ??
    zone.rainfall ??
    0;

  const { score, level, rainfall_risk } = computeRisk(structural, rawRainfall);

  return {
    ...zone,
    combined_score: score,
    risk_level: level,
    rainfall_risk,          // normalised 0–1 for RiskCard bars
    _computed: true,        // flag so we know this was client-computed
  };
}
