import React from 'react';
import { useApp } from '../context/AppContext';
import { RISK_META, normalizeRiskLevel } from './RiskCard';
import { useLiveQuery } from '../hooks/useLiveQuery';

/**
 * ZoneDrawer — Deep-dive side panel for any selected zone or live query point.
 *
 * Supports three zone shapes:
 *   1. Zone from GET /risk/all  → { zone_id/id, zone_name, lat, lon,
 *        structural_risk, rainfall_risk, combined_score, risk_level,
 *        rainfall_mm_24h, rainfall_mm_48h, rainfall_mm_72h }
 *   2. Live query loading       → { source: 'live', _loading: true, lat, lon,
 *        zone_name, _subtitle }
 *   3. Live query done          → shape 1 + { source: 'live', mask_png_base64 }
 *   4. Live query error         → { source: 'live', _error: string, lat, lon }
 */
export default function ZoneDrawer() {
  const { state, actions } = useApp();
  const { cancelQuery } = useLiveQuery();
  const zone = state.selectedZone;

  if (!zone) return null;

  const isLive    = zone.source === 'live';
  const isLoading = isLive && !!zone._loading;
  const isError   = isLive && !!zone._error;

  const displayName = zone.zone_name || zone.name || `Zone ${zone.id || zone.zone_id || ''}`;

  const handleClose = () => {
    if (isLive) {
      cancelQuery(); // also resets liveQuery state and clears map pin
    } else {
      actions.clearSelectedZone();
    }
  };

  // ── Loading state ─────────────────────────────────────────────────────────
  if (isLoading) {
    const stage = state.liveQuery?.stage ?? 'satellite';
    const elapsed = state.liveQuery?.elapsed ?? 0;
    const stageLabel = {
      satellite: '🛰 Fetching Sentinel-2 & JAXA elevation data...',
      model:     '🧠 Running DeepLabv3+ terrain segmentation...',
      rainfall:  '🌧 Querying CHIRPS 72h precipitation...',
    }[stage] || '🛰 Fetching satellite data for this location...';

    return (
      <div className="zone-drawer-backdrop" onClick={handleClose}>
        <aside className="zone-drawer glass-panel" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="zone-drawer__header">
            <div className="zone-drawer__title-block">
              <div className="zone-drawer__meta-line">
                <span className="badge badge--neutral">🛰 Live Inference</span>
              </div>
              <h2 className="zone-drawer__title">{displayName}</h2>
              <span className="zone-drawer__coords">
                📍 {zone.lat?.toFixed(4)}°N, {zone.lon?.toFixed(4)}°E · Northeast Region
              </span>
            </div>
            <button className="zone-drawer__close" onClick={handleClose} aria-label="Close">✕</button>
          </div>

          {/* Loading body */}
          <div className="zone-drawer__body">
            <div className="zone-drawer__loading-card glass-card">
              <div className="zone-drawer__loading-spinner">
                <div className="zone-drawer__loading-ring" />
                <span className="zone-drawer__loading-elapsed">{elapsed}s</span>
              </div>
              <div className="zone-drawer__loading-text">
                <span className="zone-drawer__loading-stage">{stageLabel}</span>
                <span className="zone-drawer__loading-hint">
                  GEE satellite pipeline typically takes 5–10 seconds
                </span>
              </div>
            </div>

            {/* Pipeline progress bar */}
            <div className="zone-drawer__pipeline-steps">
              {[
                { key: 'satellite', icon: '🛰', label: 'Satellite fetch' },
                { key: 'model',     icon: '🧠', label: 'AI inference' },
                { key: 'rainfall',  icon: '🌧', label: 'Rainfall query' },
              ].map(step => {
                const order = ['satellite', 'model', 'rainfall'];
                const stepIdx = order.indexOf(step.key);
                const curIdx  = order.indexOf(stage);
                const isDone  = stepIdx < curIdx;
                const isCur   = stepIdx === curIdx;
                return (
                  <div key={step.key}
                       className={`zone-drawer__pipeline-step ${isCur ? 'zone-drawer__pipeline-step--active' : ''} ${isDone ? 'zone-drawer__pipeline-step--done' : ''}`}>
                    <span className="zone-drawer__pipeline-icon">{isDone ? '✓' : step.icon}</span>
                    <span className="zone-drawer__pipeline-label">{step.label}</span>
                  </div>
                );
              })}
            </div>

            <div className="zone-drawer__formula-box" style={{ marginTop: 16 }}>
              <span className="zone-drawer__formula-badge">Formula</span>
              <code>Risk = 0.60×Terrain + 0.40×Rainfall + 0.10×(Terrain×Rainfall)</code>
            </div>
          </div>
        </aside>
      </div>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="zone-drawer-backdrop" onClick={handleClose}>
        <aside className="zone-drawer glass-panel" onClick={e => e.stopPropagation()}>
          <div className="zone-drawer__header">
            <div className="zone-drawer__title-block">
              <div className="zone-drawer__meta-line">
                <span className="badge" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>
                  ⚠ Prediction Failed
                </span>
              </div>
              <h2 className="zone-drawer__title">{displayName}</h2>
              <span className="zone-drawer__coords">
                📍 {zone.lat?.toFixed(4)}°N, {zone.lon?.toFixed(4)}°E
              </span>
            </div>
            <button className="zone-drawer__close" onClick={handleClose} aria-label="Close">✕</button>
          </div>
          <div className="zone-drawer__body">
            <div className="zone-drawer__loading-card glass-card" style={{ borderLeft: '3px solid var(--risk-critical)' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>{zone._error}</p>
            </div>
            <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }}
                    onClick={handleClose}>
              Dismiss
            </button>
          </div>
        </aside>
      </div>
    );
  }

  // ── Normal / Done state ───────────────────────────────────────────────────
  const level = normalizeRiskLevel(zone.risk_level);
  const meta  = RISK_META[level] || RISK_META.LOW;

  const structuralPct = Math.round((zone.structural_risk ?? 0) * 100);
  const rainfallPct   = Math.round((zone.rainfall_risk   ?? 0) * 100);
  const combinedPct   = Math.round((zone.combined_score  ?? 0) * 100);

  // Use real API rainfall mm fields; show — when absent
  const rain72 = zone.rainfall_mm_72h ?? zone.rainfall_72h ?? null;
  const rain48 = zone.rainfall_mm_48h ?? zone.rainfall_48h ?? null;
  const rain24 = zone.rainfall_mm_24h ?? zone.rainfall_24h ?? null;

  const structResult = zone.id ? state.structuralResults[zone.id] : null;
  const maskBase64   = zone.mask_png_base64 || structResult?.mask_png_base64;

  const nearbyReports = state.reports.filter(r => {
    if (!r.lat || !r.lon || !zone.lat || !zone.lon) return false;
    return Math.abs(r.lat - zone.lat) < 0.15 && Math.abs(r.lon - zone.lon) < 0.15;
  });

  return (
    <div className="zone-drawer-backdrop" onClick={handleClose}>
      <aside className="zone-drawer glass-panel" onClick={e => e.stopPropagation()}>

        {/* ── Header ───────────────────────────────────────────────────────── */}
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
            {isLive && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'block' }}>
                Live Prediction · Northeast Region
              </span>
            )}
          </div>
          <button className="zone-drawer__close" onClick={handleClose} aria-label="Close details">✕</button>
        </div>

        {/* ── Body ─────────────────────────────────────────────────────────── */}
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
                style={{ background: `conic-gradient(${meta.color} ${combinedPct * 3.6}deg, rgba(255,255,255,0.06) 0deg)` }}
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
            {/* Layer 1 */}
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
                <div className="zone-drawer__bar-fill"
                  style={{
                    width: `${structuralPct}%`,
                    background: structuralPct > 65 ? 'var(--risk-critical)' : structuralPct > 35 ? 'var(--risk-high)' : 'var(--risk-low)'
                  }} />
              </div>
              <p className="zone-drawer__signal-notes">
                <strong>DeepLabv3+ Model:</strong> 10m Sentinel-2 multi-spectral + JAXA AW3D30 slope, aspect &amp; elevation.
              </p>
            </div>

            {/* Layer 2 */}
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
                <div className="zone-drawer__bar-fill"
                  style={{
                    width: `${rainfallPct}%`,
                    background: rainfallPct > 65 ? 'var(--risk-critical)' : rainfallPct > 35 ? 'var(--risk-moderate)' : '#3B82F6'
                  }} />
              </div>
              <p className="zone-drawer__signal-notes">
                <strong>Precipitation Feed:</strong>{' '}
                {rain72 != null ? `${rain72.toFixed(1)} mm cumulative rainfall over last 72 hours.` : 'CHIRPS accumulation data pending.'}
              </p>
            </div>
          </div>

          {/* Formula */}
          <div className="zone-drawer__formula-box">
            <span className="zone-drawer__formula-badge">Formula</span>
            <code>Risk = 0.60×Terrain + 0.40×Rainfall + 0.10×(Terrain×Rainfall)</code>
          </div>

          {/* Rainfall Accumulation */}
          <div className="zone-drawer__section-title">
            <span>Precipitation Accumulation Pattern</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>CHIRPS Data</span>
          </div>

          <div className="zone-drawer__rain-trend glass-card">
            <RainRow label="24h Accumulation" val={rain24} maxMm={100} color={null} />
            <RainRow label="48h Cumulative"   val={rain48} maxMm={120} color="var(--brand-orange)" />
            <RainRow label="72h Cumulative"   val={rain72} maxMm={150} color={meta.color} bold />
          </div>

          {/* AI Heatmap */}
          {maskBase64 && (
            <div className="zone-drawer__heatmap-box glass-card">
              <div className="zone-drawer__section-title" style={{ marginBottom: 8 }}>
                <span>AI Segmentation Heatmap</span>
                <span className="badge badge--neutral">128×128px · 1.28km²</span>
              </div>
              <div className="zone-drawer__heatmap-img-wrap">
                <img src={`data:image/png;base64,${maskBase64}`} alt="Landslide Risk Heatmap"
                     className="zone-drawer__heatmap-img" />
                <div className="zone-drawer__heatmap-legend">
                  <span style={{ color: '#4CAF50' }}>■ Low</span>
                  <span style={{ color: '#FF9800' }}>■ Moderate</span>
                  <span style={{ color: '#F44336' }}>■ High Risk Slip Plane</span>
                </div>
              </div>
            </div>
          )}

          {/* Field Reports */}
          {nearbyReports.length > 0 && (
            <div className="zone-drawer__reports-box">
              <div className="zone-drawer__section-title">
                <span>Field Reports in this Vicinity</span>
                <span className="badge badge--neutral">{nearbyReports.length}</span>
              </div>
              <div className="zone-drawer__reports-list">
                {nearbyReports.map((r, i) => (
                  <div key={r.id || i} className="zone-drawer__report-card glass-card">
                    {r.photo_url && <img src={r.photo_url} alt="Report" className="zone-drawer__report-thumb" />}
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

// ── Rainfall row helper ───────────────────────────────────────────────────────
function RainRow({ label, val, maxMm, color, bold }) {
  if (val == null) {
    return (
      <div className="zone-drawer__rain-row">
        <span className="zone-drawer__rain-label">{label}</span>
        <span className="zone-drawer__rain-val" style={{ color: 'var(--text-muted)' }}>—</span>
      </div>
    );
  }
  return (
    <div className="zone-drawer__rain-row">
      <span className="zone-drawer__rain-label">{label}</span>
      <div className="zone-drawer__rain-bar-wrap">
        <div className="zone-drawer__rain-bar"
          style={{ width: `${Math.min(100, (val / maxMm) * 100)}%`, ...(color ? { background: color } : {}) }} />
      </div>
      <span className="zone-drawer__rain-val"
        style={{ ...(bold ? { fontWeight: 700, color: color || 'var(--text-primary)' } : {}) }}>
        {val.toFixed(1)} mm
      </span>
    </div>
  );
}
