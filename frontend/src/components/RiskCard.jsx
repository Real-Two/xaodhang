import React from 'react';

/** Map risk_level string → CSS class + display label
 *  Colors confirmed against PS spec: colorblind-safe, distinct at small size */
export const RISK_META = {
  LOW:      { cls: 'low',      label: 'Low',      color: '#4CAF50', icon: '▲' },
  MODERATE: { cls: 'moderate', label: 'Moderate', color: '#FF9800', icon: '▲' },
  HIGH:     { cls: 'high',     label: 'High',     color: '#F44336', icon: '▲' },
  CRITICAL: { cls: 'critical', label: 'Critical', color: '#7B1FA2', icon: '▲' },
};

/** Normalize a risk_level string (e.g. handle lowercase from API) */
export function normalizeRiskLevel(level) {
  if (!level) return 'LOW';
  return level.toUpperCase();
}

/**
 * RiskCard — Shared component for displaying zone risk data.
 * Used by: ZoneMarker popup, LiveQueryPin result, PriorityPanel detail.
 *
 * Props (matches real /predict/live + /zones response shapes):
 *   name OR zone_name, lat, lon,
 *   structural_risk (0–1), rainfall_risk (0–1),
 *   combined_score (0–1), risk_level ('LOW'|'MODERATE'|'HIGH'|'CRITICAL'),
 *   source ('zone'|'live'), cached (bool),
 *   compact (bool) — smaller layout for popups
 */
export default function RiskCard({
  name,
  zone_name,         // real API field — prefer over name
  lat,
  lon,
  structural_risk,
  rainfall_risk,     // 0-1 score from CHIRPS accumulation
  rainfall_mm_72h,   // fallback legacy field (unused by live endpoint)
  combined_score,
  risk_level,
  source,
  cached,
  compact = false,
}) {
  const level = normalizeRiskLevel(risk_level);
  const meta = RISK_META[level] || RISK_META.LOW;

  const displayName = zone_name || name || 'Unknown Zone';
  const structPct   = Math.round((structural_risk ?? 0) * 100);
  // rainfall_risk is already 0-1; fallback computes from raw mm if needed
  const rainScore   = rainfall_risk != null
    ? Math.min(1, rainfall_risk)
    : Math.min(1, (rainfall_mm_72h ?? 0) / 150);
  const rainPct     = Math.round(rainScore * 100);
  const combinedPct = Math.round((combined_score ?? 0) * 100);

  // SVG gauge arc
  const R = 36;
  const circ = Math.PI * R;
  const stroke = circ * (1 - combinedPct / 100);

  return (
    <div className={`risk-card ${compact ? 'risk-card--compact' : ''}`}
         style={{ '--risk-color': meta.color }}>

      {/* Header */}
      <div className="risk-card__header">
        <div className="risk-card__name-block">
          <h3 className="risk-card__name">{displayName}</h3>
          {lat != null && lon != null && (
            <span className="risk-card__coords">{lat.toFixed(4)}°N, {lon.toFixed(4)}°E</span>
          )}
        </div>
        <div className="risk-card__badges">
          <span className={`risk-badge ${meta.cls}`}>{meta.label}</span>
          {source === 'live' && (
            <span className="risk-badge" style={{
              background: 'rgba(59,127,245,0.15)', color: '#60a5fa',
              border: '1px solid rgba(59,127,245,0.25)'
            }}>{cached ? '⚡ Cached' : '🛰 Live'}</span>
          )}
        </div>
      </div>

      {/* Gauge + Bars */}
      <div className="risk-card__body">
        {/* SVG Gauge Arc */}
        <div className="risk-card__gauge" title={`Combined risk: ${combinedPct}%`}>
          <svg viewBox="0 0 90 50" width={compact ? 72 : 88}>
            {/* Track */}
            <path
              d="M 9 45 A 36 36 0 0 1 81 45"
              fill="none"
              stroke="rgba(255,255,255,0.07)"
              strokeWidth="7"
              strokeLinecap="round"
            />
            {/* Fill */}
            <path
              d="M 9 45 A 36 36 0 0 1 81 45"
              fill="none"
              stroke={meta.color}
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={stroke}
              style={{ filter: `drop-shadow(0 0 4px ${meta.color}66)` }}
            />
            <text x="45" y="44" textAnchor="middle"
              fill={meta.color}
              fontSize={compact ? "13" : "15"}
              fontFamily="'Space Grotesk', sans-serif"
              fontWeight="700">
              {combinedPct}%
            </text>
          </svg>
          <span className="risk-card__gauge-label">Combined</span>
        </div>

        {/* Progress Bars */}
        <div className="risk-card__bars">
          <BarRow
            label="Terrain susceptibility"
            icon="⛰"
            pct={structPct}
            color={structPct > 70 ? '#F44336' : structPct > 40 ? '#FF9800' : '#4CAF50'}
          />
          <BarRow
            label={`Rainfall trigger (${rainPct}% accumulation)`}
            icon="🌧"
            pct={rainPct}
            color={rainPct > 70 ? '#F44336' : rainPct > 40 ? '#FF9800' : '#60a5fa'}
          />
        </div>
      </div>
    </div>
  );
}

function BarRow({ label, icon, pct, color }) {
  return (
    <div className="risk-card__bar-row">
      <div className="risk-card__bar-label">
        <span>{icon} {label}</span>
        <span style={{ color, fontWeight: 600 }}>{pct}%</span>
      </div>
      <div className="progress-bar-track">
        <div
          className="progress-bar-fill"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
