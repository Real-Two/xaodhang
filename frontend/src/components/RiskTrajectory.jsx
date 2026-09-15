import React, { useEffect, useState, useCallback } from 'react';
import { BASE_URL } from '../api/client';

const LEVEL_COLOR = {
  LOW:      '#4CAF50',
  MODERATE: '#FF9800',
  HIGH:     '#F44336',
  CRITICAL: '#7B1FA2',
};

const LEVEL_ORDER = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

/**
 * RiskTrajectory — compact 4-point timeline: Now → +24h → +48h → +72h
 * Shows forecast risk levels and highlights threshold crossings.
 * Placed in ZoneDrawer between the formula box and rainfall section.
 */
export default function RiskTrajectory({ zoneId, currentLevel, currentScore }) {
  const [forecast, setForecast] = useState(null);
  const [loading,  setLoading]  = useState(false);

  const load = useCallback(async () => {
    if (!zoneId) return;
    setLoading(true);
    try {
      const r = await fetch(`${BASE_URL}/forecast/${zoneId}`, { cache: 'no-store' });
      if (r.ok) setForecast(await r.json());
    } catch (_) {}
    finally { setLoading(false); }
  }, [zoneId]);

  useEffect(() => { load(); }, [load]);

  if (!zoneId) return null;

  const now = currentLevel || 'LOW';
  const fc  = forecast?.forecast_risk_level || null;

  const points = [
    { label: 'Now',   level: now,                                          score: currentScore },
    { label: '+24h',  level: fc || now,                                    score: forecast?.forecast_combined_score },
    { label: '+48h',  level: fc || now,                                    score: forecast?.forecast_combined_score },
    { label: '+72h',  level: forecast?.forecast_risk_level || now,         score: forecast?.forecast_combined_score },
  ];

  // Trend arrow
  const trend = fc
    ? LEVEL_ORDER[fc] > LEVEL_ORDER[now] ? '↑ Worsening'
    : LEVEL_ORDER[fc] < LEVEL_ORDER[now] ? '↓ Improving'
    : '→ Stable'
    : null;

  const trendColor = fc
    ? LEVEL_ORDER[fc] > LEVEL_ORDER[now] ? 'var(--risk-high)'
    : LEVEL_ORDER[fc] < LEVEL_ORDER[now] ? 'var(--risk-low)'
    : 'var(--text-muted)'
    : 'var(--text-muted)';

  return (
    <div style={{
      padding: '12px 14px',
      background: 'var(--bg-panel)',
      borderRadius: 'var(--r-md)',
      border: '1px solid var(--border)',
      marginBottom: 'var(--sp-3)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.07em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
          72h Risk Trajectory
        </span>
        {trend && !loading && (
          <span style={{ fontSize: 11, fontWeight: 700, color: trendColor }}>{trend}</span>
        )}
        {loading && (
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Loading…</span>
        )}
      </div>

      {/* Timeline */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 0, position: 'relative' }}>
        {points.map((pt, i) => {
          const color  = LEVEL_COLOR[pt.level] || LEVEL_COLOR.LOW;
          const pct    = pt.score != null ? Math.round(pt.score * 100) : null;
          const isNow  = i === 0;
          const isCrit = pt.level === 'CRITICAL';

          return (
            <React.Fragment key={i}>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                {/* Score */}
                <span style={{
                  fontSize: 11, fontWeight: 700,
                  color: isNow ? color : pct != null ? color : 'var(--text-muted)',
                }}>
                  {pct != null ? `${pct}%` : '—'}
                </span>

                {/* Circle */}
                <div style={{
                  width: isNow ? 14 : 10,
                  height: isNow ? 14 : 10,
                  borderRadius: '50%',
                  background: color,
                  border: isNow ? `2px solid var(--bg-deep)` : 'none',
                  boxShadow: isCrit ? `0 0 8px ${color}` : 'none',
                  flexShrink: 0,
                }} />

                {/* Label */}
                <span style={{
                  fontSize: 10, color: isNow ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: isNow ? 700 : 400,
                }}>
                  {pt.label}
                </span>

                {/* Level badge — only show if changes */}
                {(!isNow && fc && pt.level !== now) && (
                  <span style={{
                    fontSize: 9, padding: '1px 5px', borderRadius: 99,
                    background: `${color}22`, color,
                    border: `1px solid ${color}44`,
                    fontWeight: 700, marginTop: -4,
                  }}>
                    {pt.level}
                  </span>
                )}
              </div>

              {/* Connector line */}
              {i < points.length - 1 && (
                <div style={{
                  height: 2, flex: 1, marginBottom: 20,
                  background: `linear-gradient(to right, ${LEVEL_COLOR[pt.level]}, ${LEVEL_COLOR[points[i+1].level]})`,
                  opacity: 0.5,
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Threshold crossing warning */}
      {fc && LEVEL_ORDER[fc] > LEVEL_ORDER[now] && LEVEL_ORDER[fc] >= 2 && (
        <div style={{
          marginTop: 10, padding: '5px 10px',
          background: `${LEVEL_COLOR[fc]}18`,
          border: `1px solid ${LEVEL_COLOR[fc]}44`,
          borderRadius: 'var(--r-sm)',
          fontSize: 11, color: LEVEL_COLOR[fc], fontWeight: 600,
        }}>
          ⚠ Forecast crosses {fc} threshold — conditions expected to deteriorate
        </div>
      )}
    </div>
  );
}
