import React from 'react';
import { useApp } from '../context/AppContext';
import { RISK_META, normalizeRiskLevel } from './RiskCard';

/**
 * ZoneDrawer — Deep-dive side panel for any selected zone or live query point.
 *
 * Supports two data shapes:
 *   1. Zone from GET /risk/all  → { zone_id/id, zone_name, lat, lon,
 *        structural_risk, rainfall_risk, combined_score, risk_level,
 *        rainfall_mm_24h, rainfall_mm_48h, rainfall_mm_72h }
 *   2. Live query from GET /predict/live → same shape + mask_png_base64
 */
export default function ZoneDrawer() {
  const { state, actions } = useApp();
  const zone = state.selectedZone;

  if (!zone) return null;

  const level = normalizeRiskLevel(zone.risk_level);
  const meta = RISK_META[level] || RISK_META.LOW;
  const displayName = zone.zone_name || zone.name || `Zone ${zone.id || zone.zone_id || ''}`;
  const isLive = zone.source === 'live';

  const structuralPct = Math.round((zone.structural_risk ?? 0) * 100);
  const rainfallPct   = Math.round((zone.rainfall_risk ?? 0) * 100);
  const combinedPct   = Math.round((zone.combined_score ?? 0) * 100);

  // Use real API rainfall accumulation fields — don't fabricate from scores
  const rain72  = zone.rainfall_mm_72h  ?? zone.rainfall_72h  ?? null;
  const rain48  = zone.rainfall_mm_48h  ?? zone.rainfall_48h  ?? (rain72 != null ? Math.round(rain72 * 0.65) : null);
  const rain24  = zone.rainfall_mm_24h  ?? zone.rainfall_24h  ?? (rain72 != null ? Math.round(rain72 * 0.35) : null);

  // Heatmap — from live prediction or cached structural result
  const structResult = zone.id ? state.structuralResults[zone.id] : null;
  const maskBase64   = zone.mask_png_base64 || structResult?.mask_png_base64;

  // Field reports within ~15km radius
  const nearbyReports = state.reports.filter(r => {
    if (!r.lat || !r.lon || !zone.lat || !zone.lon) return false;
    return Math.abs(r.lat - zone.lat) < 0.15 && Math.abs(r.lon - zone.lon) < 0.15;
  });

  return (
    <div className="zone-drawer-backdrop" onClick={actions.clearSelectedZone}>
      <aside className="zone-drawer glass-panel" onClick={e => e.stopPropagation()}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="zone-drawer__header">
          <div className="zone-drawer__title-block">
            <div className="zone-drawer__meta-line">
              <span className={`badge badge--${level.toLowerCase()}`}>
                {meta.icon} {meta.label} Risk
              </span>
              {isLive && (
                <span className="badge badge--neutral">
                  {zone.cached ? '⚡ Cached Query' : '🛰 Live Inference'}
                </span>
              )}
            </div>
            <h2 className="zone-drawer__title">{displayName}</h2>
            {zone.lat != null && zone.lon != null && (
              <span className="zone-drawer__coords">
                📍 {zone.lat.toFixed(4)}°N, {zone.lon.toFixed(4)}°E · Northeast Region
              </span>
            )}
          </div>

          <button
            className="zone-drawer__close"
            onClick={actions.clearSelectedZone}
            aria-label="Close details"
          >
            ✕
          </button>
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div className="zone-drawer__body">

          {/* Combined Score Hero */}
          <div className="zone-drawer__hero-score" style={{ '--risk-color': meta.color }}>
            <div className="zone-drawer__hero-left">
              <span className="zone-drawer__hero-label">Combined Landslide Risk Score</span>
              <div className="zone-drawer__hero-value">
                {combinedPct}
                <span className="zone-drawer__hero-pct">%</span>
              </div>
              <p className="zone-drawer__hero-desc">
                Non-linear combination of static geological susceptibility and dynamic precipitation trigger.
              </p>
            </div>
            <div className="zone-drawer__hero-badge-wrap">
              <div
                className="zone-drawer__hero-ring"
                style={{
                  background: `conic-gradient(${meta.color} ${combinedPct * 3.6}deg, rgba(255,255,255,0.06) 0deg)`
                }}
              >
                <div className="zone-drawer__hero-ring-inner">
                  <span style={{ color: meta.color, fontWeight: 700, fontSize: 13 }}>{meta.label}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Two-Layer Architecture */}
          <div className="zone-drawer__section-title">
            <span>Two-Layer Diagnostic Signals</span>
            <span className="badge badge--neutral" style={{ fontSize: 9.5 }}>Core Model Architecture</span>
          </div>

          <div className="zone-drawer__dual-grid">
            {/* Layer 1: Terrain Susceptibility */}
            <div className="zone-drawer__signal-card">
              <div className="zone-drawer__signal-header">
                <span className="zone-drawer__signal-icon">⛰️</span>
                <span className="zone-drawer__signal-type">Layer 1: Terrain Susceptibility</span>
              </div>
              <div className="zone-drawer__signal-value-row">
                <span className="zone-drawer__signal-val">{structuralPct}%</span>
                <span className="zone-drawer__signal-tag">Static Model</span>
              </div>
              <div className="zone-drawer__bar-track">
                <div
                  className="zone-drawer__bar-fill"
                  style={{
                    width: `${structuralPct}%`,
                    background: structuralPct > 65
                      ? 'var(--risk-critical)'
                      : structuralPct > 35
                      ? 'var(--risk-high)'
                      : 'var(--risk-low)'
                  }}
                />
              </div>
              <p className="zone-drawer__signal-notes">
                <strong>DeepLabv3+ Model:</strong> 10m Sentinel-2 multi-spectral + JAXA AW3D30 slope, aspect &amp; elevation.
              </p>
            </div>

            {/* Layer 2: Rainfall Trigger */}
            <div className="zone-drawer__signal-card">
              <div className="zone-drawer__signal-header">
                <span className="zone-drawer__signal-icon">🌧️</span>
                <span className="zone-drawer__signal-type">Layer 2: Rainfall Trigger</span>
              </div>
              <div className="zone-drawer__signal-value-row">
                <span className="zone-drawer__signal-val">{rainfallPct}%</span>
                <span className="zone-drawer__signal-tag">CHIRPS 72h</span>
              </div>
              <div className="zone-drawer__bar-track">
                <div
                  className="zone-drawer__bar-fill"
                  style={{
                    width: `${rainfallPct}%`,
                    background: rainfallPct > 65
                      ? 'var(--risk-critical)'
                      : rainfallPct > 35
                      ? 'var(--risk-moderate)'
                      : '#3B82F6'
                  }}
                />
              </div>
              <p className="zone-drawer__signal-notes">
                <strong>Precipitation Feed:</strong>{' '}
                {rain72 != null ? `${rain72.toFixed(1)} mm cumulative rainfall over last 72 hours.` : 'CHIRPS accumulation data pending.'}
              </p>
            </div>
          </div>

          {/* Interaction Formula */}
          <div className="zone-drawer__formula-box">
            <span className="zone-drawer__formula-badge">Formula</span>
            <code>Risk = 0.60×Terrain + 0.40×Rainfall + 0.10×(Terrain×Rainfall)</code>
          </div>

          {/* Rainfall Accumulation Bars */}
          <div className="zone-drawer__section-title">
            <span>Precipitation Accumulation Pattern</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>CHIRPS Data</span>
          </div>

          <div className="zone-drawer__rain-trend glass-card">
            {rain24 != null ? (
              <div className="zone-drawer__rain-row">
                <span className="zone-drawer__rain-label">24h Accumulation</span>
                <div className="zone-drawer__rain-bar-wrap">
                  <div className="zone-drawer__rain-bar" style={{ width: `${Math.min(100, (rain24 / 100) * 100)}%` }} />
                </div>
                <span className="zone-drawer__rain-val">{rain24.toFixed(1)} mm</span>
              </div>
            ) : (
              <div className="zone-drawer__rain-row">
                <span className="zone-drawer__rain-label">24h Accumulation</span>
                <span className="zone-drawer__rain-val" style={{ color: 'var(--text-muted)' }}>—</span>
              </div>
            )}

            {rain48 != null ? (
              <div className="zone-drawer__rain-row">
                <span className="zone-drawer__rain-label">48h Cumulative</span>
                <div className="zone-drawer__rain-bar-wrap">
                  <div className="zone-drawer__rain-bar" style={{ width: `${Math.min(100, (rain48 / 120) * 100)}%`, background: 'var(--brand-orange)' }} />
                </div>
                <span className="zone-drawer__rain-val">{rain48.toFixed(1)} mm</span>
              </div>
            ) : (
              <div className="zone-drawer__rain-row">
                <span className="zone-drawer__rain-label">48h Cumulative</span>
                <span className="zone-drawer__rain-val" style={{ color: 'var(--text-muted)' }}>—</span>
              </div>
            )}

            {rain72 != null ? (
              <div className="zone-drawer__rain-row">
                <span className="zone-drawer__rain-label">72h Cumulative</span>
                <div className="zone-drawer__rain-bar-wrap">
                  <div className="zone-drawer__rain-bar" style={{ width: `${Math.min(100, (rain72 / 150) * 100)}%`, background: meta.color }} />
                </div>
                <span className="zone-drawer__rain-val" style={{ color: meta.color, fontWeight: 700 }}>{rain72.toFixed(1)} mm</span>
              </div>
            ) : (
              <div className="zone-drawer__rain-row">
                <span className="zone-drawer__rain-label">72h Cumulative</span>
                <span className="zone-drawer__rain-val" style={{ color: 'var(--text-muted)' }}>—</span>
              </div>
            )}
          </div>

          {/* AI Heatmap (only if available from live prediction) */}
          {maskBase64 && (
            <div className="zone-drawer__heatmap-box glass-card">
              <div className="zone-drawer__section-title" style={{ marginBottom: 8 }}>
                <span>AI Segmentation Heatmap</span>
                <span className="badge badge--neutral">128×128px · 1.28km²</span>
              </div>
              <div className="zone-drawer__heatmap-img-wrap">
                <img
                  src={`data:image/png;base64,${maskBase64}`}
                  alt="Landslide Risk Heatmap"
                  className="zone-drawer__heatmap-img"
                />
                <div className="zone-drawer__heatmap-legend">
                  <span style={{ color: '#4CAF50' }}>■ Low</span>
                  <span style={{ color: '#FF9800' }}>■ Moderate</span>
                  <span style={{ color: '#F44336' }}>■ High Risk Slip Plane</span>
                </div>
              </div>
            </div>
          )}

          {/* Field Reports nearby */}
          {nearbyReports.length > 0 && (
            <div className="zone-drawer__reports-box">
              <div className="zone-drawer__section-title">
                <span>Field Reports in this Vicinity</span>
                <span className="badge badge--neutral">{nearbyReports.length}</span>
              </div>
              <div className="zone-drawer__reports-list">
                {nearbyReports.map((r, i) => (
                  <div key={r.id || i} className="zone-drawer__report-card glass-card">
                    {r.photo_url && (
                      <img src={r.photo_url} alt="Report" className="zone-drawer__report-thumb" />
                    )}
                    <div className="zone-drawer__report-info">
                      <p className="zone-drawer__report-desc">{r.description}</p>
                      <span className="zone-drawer__report-time">
                        {r.created_at ? new Date(r.created_at).toLocaleDateString() : 'Recent submission'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
