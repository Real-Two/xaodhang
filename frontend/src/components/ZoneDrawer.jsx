import React from 'react';
import { useApp } from '../context/AppContext';
import { RISK_META, normalizeRiskLevel } from './RiskCard';
import { useLiveQuery } from '../hooks/useLiveQuery';
import RiskTrendChart from './RiskTrendChart';

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
    if (isLive) cancelQuery();
    else actions.clearSelectedZone();
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    const stage = state.liveQuery?.stage ?? 'satellite';
    const elapsed = state.liveQuery?.elapsed ?? 0;
    const stageLabel = {
      satellite: '🛰 Fetching Sentinel-2 & JAXA elevation data...',
      model:     '🧠 Running UNet terrain segmentation...',
      rainfall:  '🌧 Querying CHIRPS 72h precipitation...',
    }[stage] || '🛰 Fetching satellite data...';

    return (
      <div className="zone-drawer-backdrop" onClick={handleClose}>
        <aside className="zone-drawer glass-panel" onClick={e => e.stopPropagation()}>
          <div className="zone-drawer__header">
            <div className="zone-drawer__title-block">
              <div className="zone-drawer__meta-line">
                <span className="badge badge--neutral">🛰 Live Inference</span>
              </div>
              <h2 className="zone-drawer__title">{displayName}</h2>
              <span className="zone-drawer__coords">
                📍 {zone.lat?.toFixed(4)}°N, {zone.lon?.toFixed(4)}°E
              </span>
            </div>
            <button className="zone-drawer__close" onClick={handleClose}>✕</button>
          </div>
          <div className="zone-drawer__body">
            <div className="zone-drawer__loading-card glass-card">
              <div className="zone-drawer__loading-spinner">
                <div className="zone-drawer__loading-ring" />
                <span className="zone-drawer__loading-elapsed">{elapsed}s</span>
              </div>
              <div className="zone-drawer__loading-text">
                <span className="zone-drawer__loading-stage">{stageLabel}</span>
                <span className="zone-drawer__loading-hint">GEE satellite pipeline typically takes 5–10 seconds</span>
              </div>
            </div>
            <div className="zone-drawer__pipeline-steps">
              {[
                { key: 'satellite', icon: '🛰', label: 'Satellite fetch' },
                { key: 'model',     icon: '🧠', label: 'AI inference' },
                { key: 'rainfall',  icon: '🌧', label: 'Rainfall query' },
              ].map(step => {
                const order   = ['satellite', 'model', 'rainfall'];
                const isDone  = order.indexOf(step.key) < order.indexOf(stage);
                const isCur   = step.key === stage;
                return (
                  <div key={step.key} className={`zone-drawer__pipeline-step${isCur ? ' zone-drawer__pipeline-step--active' : ''}${isDone ? ' zone-drawer__pipeline-step--done' : ''}`}>
                    <span className="zone-drawer__pipeline-icon">{isDone ? '✓' : step.icon}</span>
                    <span className="zone-drawer__pipeline-label">{step.label}</span>
                  </div>
                );
              })}
            </div>
            <div className="zone-drawer__formula-box" style={{ marginTop: 16 }}>
              <span className="zone-drawer__formula-badge">Formula</span>
              <code>Risk = 0.60×Terrain + 0.40×Rainfall + 0.15×(Terrain×Rainfall)</code>
            </div>
          </div>
        </aside>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="zone-drawer-backdrop" onClick={handleClose}>
        <aside className="zone-drawer glass-panel" onClick={e => e.stopPropagation()}>
          <div className="zone-drawer__header">
            <div className="zone-drawer__title-block">
              <div className="zone-drawer__meta-line">
                <span className="badge" style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}>⚠ Prediction Failed</span>
              </div>
              <h2 className="zone-drawer__title">{displayName}</h2>
            </div>
            <button className="zone-drawer__close" onClick={handleClose}>✕</button>
          </div>
          <div className="zone-drawer__body">
            <div className="zone-drawer__loading-card glass-card" style={{ borderLeft: '3px solid var(--risk-critical)' }}>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>{zone._error}</p>
            </div>
            <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 12 }} onClick={handleClose}>Dismiss</button>
          </div>
        </aside>
      </div>
    );
  }

  // ── Normal ────────────────────────────────────────────────────────────────
  const level = normalizeRiskLevel(zone.risk_level);
  const meta  = RISK_META[level] || RISK_META.LOW;

  const structuralPct = Math.round((zone.structural_risk ?? 0) * 100);
  const rainfallPct   = Math.round((zone.rainfall_risk   ?? 0) * 100);
  const combinedPct   = Math.round((zone.combined_score  ?? 0) * 100);

  const rain72 = zone.rainfall_mm_72h ?? null;
  const rain48 = zone.rainfall_mm_48h ?? null;
  const rain24 = zone.rainfall_mm_24h ?? null;

  const maskBase64 = zone.mask_png_base64 || (zone.id ? state.structuralResults?.[zone.id]?.mask_png_base64 : null);
  const zoneIdForHistory = zone.id ?? zone.zone_id ?? null;
  const showTrendChart   = !isLive || (zone.zone_id && typeof zone.zone_id === 'number');

  // Seismic context
  const seismicUplift = zone.seismic_uplift ?? 0;
  const seismicNote   = zone.seismic_note ?? null;
  const seismicEvents = zone.seismic_events_72h ?? 0;
  const hasSeismic    = seismicUplift > 0.01 && seismicNote;

  // Impact context
  const population  = zone.population_5km ?? null;
  const infra       = zone.critical_infra ?? [];
  const impactScore = zone.impact_score ?? null;
  const hasImpact   = population != null || infra.length > 0;

  const nearbyReports = state.reports.filter(r =>
    r.lat && r.lon && zone.lat && zone.lon &&
    Math.abs(r.lat - zone.lat) < 0.15 && Math.abs(r.lon - zone.lon) < 0.15
  );

  return (
    <div className="zone-drawer-backdrop" onClick={handleClose}>
      <aside className="zone-drawer glass-panel" onClick={e => e.stopPropagation()}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="zone-drawer__header">
          <div className="zone-drawer__title-block">
            <div className="zone-drawer__meta-line">
              <span className={`badge badge--${level.toLowerCase()}`}>{meta.icon} {meta.label} Risk</span>
              {isLive && (
                <span className="badge badge--neutral">{zone.cached ? '⚡ Cached' : '🛰 Live Inference'}</span>
              )}
              {hasSeismic && (
                <span className="badge badge--neutral" style={{ color: 'var(--brand-orange)', borderColor: 'rgba(232,119,34,0.35)' }}>
                  ⚡ Seismic
                </span>
              )}
            </div>
            <h2 className="zone-drawer__title">{displayName}</h2>
            {zone.lat != null && (
              <span className="zone-drawer__coords">
                📍 {zone.lat.toFixed(4)}°N, {zone.lon.toFixed(4)}°E · Northeast Region
              </span>
            )}
          </div>
          <button className="zone-drawer__close" onClick={handleClose} aria-label="Close">✕</button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="zone-drawer__body">

          {/* Hero score */}
          <div className="zone-drawer__hero-score" style={{ '--risk-color': meta.color }}>
            <div className="zone-drawer__hero-left">
              <span className="zone-drawer__hero-label">Combined Landslide Risk Score</span>
              <div className="zone-drawer__hero-value">
                {combinedPct}<span className="zone-drawer__hero-pct">%</span>
              </div>
              <p className="zone-drawer__hero-desc">
                Non-linear combination of terrain susceptibility, rainfall trigger
                {hasSeismic ? ', and seismic context.' : '.'}
              </p>
            </div>
            <div className="zone-drawer__hero-badge-wrap">
              <div className="zone-drawer__hero-ring"
                   style={{ background: `conic-gradient(${meta.color} ${combinedPct * 3.6}deg, rgba(255,255,255,0.06) 0deg)` }}>
                <div className="zone-drawer__hero-ring-inner">
                  <span style={{ color: meta.color, fontWeight: 700, fontSize: 13 }}>{meta.label}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Impact row — compact, right below hero ──────────────────── */}
          {hasImpact && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
              padding: '10px 14px',
              background: 'var(--bg-panel)',
              borderRadius: 'var(--r-md)',
              border: '1px solid var(--border)',
              marginBottom: 'var(--sp-3)',
            }}>
              {/* Population */}
              {population != null && (
                <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 14 }}>👥</span>
                  <strong style={{ color: level === 'CRITICAL' || level === 'HIGH' ? meta.color : 'var(--text-primary)' }}>
                    ~{population.toLocaleString()}
                  </strong>
                  <span style={{ color: 'var(--text-muted)' }}>people within 5km</span>
                </span>
              )}

              {population != null && infra.length > 0 && (
                <span style={{ color: 'var(--border)', fontSize: 14 }}>·</span>
              )}

              {/* Road */}
              {infra.find(i => i.type === 'road') && (() => {
                const road = infra.find(i => i.type === 'road');
                return (
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 13 }}>🛣</span>
                    <span style={{ color: 'var(--text-muted)' }}>{road.name}</span>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 99,
                      background: road.dist_km < 1 ? 'rgba(232,119,34,0.15)' : 'var(--bg-deep)',
                      color: road.dist_km < 1 ? 'var(--brand-orange)' : 'var(--text-muted)',
                    }}>{road.dist_km}km</span>
                  </span>
                );
              })()}

              {infra.length > 0 && infra.find(i => i.type !== 'road') && (
                <span style={{ color: 'var(--border)', fontSize: 14 }}>·</span>
              )}

              {/* Facility */}
              {infra.find(i => i.type !== 'road') && (() => {
                const fac = infra.find(i => i.type !== 'road');
                const icon = { hospital: '🏥', PHC: '🏥', railway: '🚉', bridge: '🌉' }[fac.type] || '📍';
                return (
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 13 }}>{icon}</span>
                    <span>{fac.name}</span>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 99,
                      background: 'var(--bg-deep)', color: 'var(--text-muted)',
                    }}>{fac.dist_km}km</span>
                  </span>
                );
              })()}

              {/* Impact score — far right */}
              {impactScore != null && (
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                  Impact{' '}
                  <strong style={{ color: impactScore >= 70 ? meta.color : 'var(--text-primary)' }}>
                    {impactScore}/100
                  </strong>
                </span>
              )}
            </div>
          )}

          {/* ── Two-Layer signals ───────────────────────────────────────── */}
          <div className="zone-drawer__section-title">
            <span>Two-Layer Diagnostic Signals</span>
            <span className="badge badge--neutral" style={{ fontSize: 9.5 }}>Model Architecture</span>
          </div>

          <div className="zone-drawer__dual-grid">
            {/* Layer 1: Terrain */}
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
                <div className="zone-drawer__bar-fill" style={{
                  width: `${structuralPct}%`,
                  background: structuralPct > 65 ? 'var(--risk-critical)' : structuralPct > 35 ? 'var(--risk-high)' : 'var(--risk-low)',
                }} />
              </div>
              <p className="zone-drawer__signal-notes">
                <strong>UNet:</strong> 10m Sentinel-2 + JAXA AW3D30 slope &amp; elevation.
              </p>

              {/* ── Seismic note — inline in terrain card ─────────────── */}
              {hasSeismic && (
                <div style={{
                  marginTop: 8,
                  padding: '6px 10px',
                  borderRadius: 'var(--r-sm)',
                  background: 'rgba(232,119,34,0.10)',
                  border: '1px solid rgba(232,119,34,0.25)',
                  fontSize: 11,
                  color: 'var(--brand-orange)',
                  lineHeight: 1.5,
                }}>
                  <span style={{ fontWeight: 700 }}>⚡ +{(seismicUplift * 100).toFixed(1)}pp seismic</span>
                  {seismicEvents > 0 && (
                    <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                      ({seismicEvents} event{seismicEvents !== 1 ? 's' : ''} nearby)
                    </span>
                  )}
                  <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{seismicNote}</div>
                </div>
              )}
            </div>

            {/* Layer 2: Rainfall */}
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
                <div className="zone-drawer__bar-fill" style={{
                  width: `${rainfallPct}%`,
                  background: rainfallPct > 65 ? 'var(--risk-critical)' : rainfallPct > 35 ? 'var(--risk-moderate)' : '#3B82F6',
                }} />
              </div>
              <p className="zone-drawer__signal-notes">
                <strong>CHIRPS:</strong>{' '}
                {rain72 != null ? `${rain72.toFixed(1)}mm cumulative over 72 hours.` : 'Precipitation data pending.'}
              </p>
            </div>
          </div>

          {/* Formula */}
          <div className="zone-drawer__formula-box">
            <span className="zone-drawer__formula-badge">Formula</span>
            <code>Risk = 0.60×Terrain + 0.40×Rainfall + 0.15×(T×R){hasSeismic ? ' + seismic' : ''}</code>
          </div>

          {/* Rainfall accumulation */}
          <div className="zone-drawer__section-title">
            <span>Precipitation Accumulation</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>CHIRPS</span>
          </div>

          <div className="zone-drawer__rain-trend glass-card">
            <RainRow label="24h Accumulation" val={rain24} maxMm={100} />
            <RainRow label="48h Cumulative"   val={rain48} maxMm={120} color="var(--brand-orange)" />
            <RainRow label="72h Cumulative"   val={rain72} maxMm={150} color={meta.color} bold />
          </div>

          {/* Risk Trend Chart */}
          {showTrendChart && zoneIdForHistory && (
            <>
              <div className="zone-drawer__section-title" style={{ marginTop: 'var(--sp-4)' }}>
                <span>Historical Risk Trend</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Last 7 days</span>
              </div>
              <RiskTrendChart zoneId={zoneIdForHistory} zoneName={displayName} />
            </>
          )}

          {/* AI Heatmap */}
          {maskBase64 && (
            <div className="zone-drawer__heatmap-box glass-card">
              <div className="zone-drawer__section-title" style={{ marginBottom: 8 }}>
                <span>AI Segmentation Heatmap</span>
                <span className="badge badge--neutral">128×128px · 1.28km²</span>
              </div>
              <div className="zone-drawer__heatmap-img-wrap">
                <img src={`data:image/png;base64,${maskBase64}`} alt="Landslide Risk Heatmap" className="zone-drawer__heatmap-img" />
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
                <span>Field Reports in Vicinity</span>
                <span className="badge badge--neutral">{nearbyReports.length}</span>
              </div>
              <div className="zone-drawer__reports-list">
                {nearbyReports.map((r, i) => (
                  <div key={r.id || i} className="zone-drawer__report-card glass-card">
                    {r.photo_url && <img src={r.photo_url} alt="Report" className="zone-drawer__report-thumb" />}
                    <div className="zone-drawer__report-info">
                      <p className="zone-drawer__report-desc">{r.description}</p>
                      <span className="zone-drawer__report-time">
                        {r.created_at ? new Date(r.created_at).toLocaleDateString() : 'Recent'}
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

// ── RainRow ───────────────────────────────────────────────────────────────────
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
            style={bold ? { fontWeight: 700, color: color || 'var(--text-primary)' } : {}}>
        {val.toFixed(1)} mm
      </span>
    </div>
  );
}
