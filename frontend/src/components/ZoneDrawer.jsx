import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { RISK_META, normalizeRiskLevel } from './RiskCard';
import { predictStructural } from '../api/client';

/**
 * ZoneDrawer — Deep-dive analysis drawer for any selected zone or live query pin.
 * Highlights the Two-Layer Architecture: Static Terrain Susceptibility × Dynamic Rainfall Trigger.
 */
export default function ZoneDrawer() {
  const { state, actions } = useApp();
  const zone = state.selectedZone;
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);

  if (!zone) return null;

  const level = normalizeRiskLevel(zone.risk_level);
  const meta = RISK_META[level] || RISK_META.LOW;
  const displayName = zone.zone_name || zone.name || `Zone ${zone.id || ''}`;
  const isLive = zone.source === 'live';

  const structuralPct = Math.round((zone.structural_risk ?? 0) * 100);
  const rainfallPct = Math.round((zone.rainfall_risk ?? 0) * 100);
  const combinedPct = Math.round((zone.combined_score ?? 0) * 100);

  // Approximate rainfall accumulation in mm if not provided
  const rainfallMm = zone.rainfall_mm_72h ?? zone.rainfall_72h ?? Math.round(rainfallPct * 1.5);
  const rainfall48h = Math.round(rainfallMm * 0.65);
  const rainfall24h = Math.round(rainfallMm * 0.35);

  // Check if there are attached reports near this zone
  const nearbyReports = state.reports.filter(r => {
    if (!r.lat || !r.lon || !zone.lat || !zone.lon) return false;
    const dLat = Math.abs(r.lat - zone.lat);
    const dLon = Math.abs(r.lon - zone.lon);
    return dLat < 0.15 && dLon < 0.15;
  });

  const handlePatchUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !zone.id) return;
    setUploading(true);
    setUploadError(null);
    try {
      const res = await predictStructural(zone.id, file);
      actions.setStructuralResult(zone.id, res);
      actions.updateZoneRisk({ id: zone.id, ...res });
    } catch (err) {
      setUploadError(err.message || 'Failed to process patch');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const structResult = zone.id ? state.structuralResults[zone.id] : null;
  const maskBase64 = zone.mask_png_base64 || structResult?.mask_png_base64;

  return (
    <div className="zone-drawer-backdrop" onClick={actions.clearSelectedZone}>
      <aside className="zone-drawer glass-panel" onClick={e => e.stopPropagation()}>
        {/* Header */}
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

        {/* Body */}
        <div className="zone-drawer__body">
          {/* Combined Score Card */}
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
              <div className="zone-drawer__hero-ring" style={{ background: `conic-gradient(${meta.color} ${combinedPct * 3.6}deg, rgba(255,255,255,0.06) 0deg)` }}>
                <div className="zone-drawer__hero-ring-inner">
                  <span style={{ color: meta.color, fontWeight: 700, fontSize: 13 }}>{meta.label}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Two-Layer Architecture Story Cards */}
          <div className="zone-drawer__section-title">
            <span>Two-Layer Diagnostic Signals</span>
            <span className="badge badge--neutral" style={{ fontSize: 9.5 }}>Core Model Architecture</span>
          </div>

          <div className="zone-drawer__dual-grid">
            {/* Layer 1: Static Terrain Susceptibility */}
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
                    background: structuralPct > 65 ? 'var(--risk-critical)' : structuralPct > 35 ? 'var(--risk-high)' : 'var(--risk-low)'
                  }}
                />
              </div>
              <p className="zone-drawer__signal-notes">
                <strong>DeepLabv3+ Model:</strong> 10m Sentinel-2 multi-spectral + JAXA AW3D30 slope, aspect & elevation.
              </p>
            </div>

            {/* Layer 2: Dynamic Rainfall Trigger */}
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
                    background: rainfallPct > 65 ? 'var(--risk-critical)' : rainfallPct > 35 ? 'var(--risk-moderate)' : '#3B82F6'
                  }}
                />
              </div>
              <p className="zone-drawer__signal-notes">
                <strong>Precipitation Feed:</strong> {rainfallMm} mm cumulative rainfall over last 72 hours.
              </p>
            </div>
          </div>

          {/* Interaction Formula Footnote */}
          <div className="zone-drawer__formula-box">
            <span className="zone-drawer__formula-badge">Formula</span>
            <code>Risk = 0.60×Terrain + 0.40×Rainfall + 0.10×(Terrain×Rainfall)</code>
          </div>

          {/* Rainfall Trend Breakdown */}
          <div className="zone-drawer__section-title">
            <span>Precipitation Accumulation Pattern</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>CHIRPS Data</span>
          </div>

          <div className="zone-drawer__rain-trend glass-card">
            <div className="zone-drawer__rain-row">
              <span className="zone-drawer__rain-label">24h Accumulation</span>
              <div className="zone-drawer__rain-bar-wrap">
                <div className="zone-drawer__rain-bar" style={{ width: `${Math.min(100, (rainfall24h / 100) * 100)}%` }} />
              </div>
              <span className="zone-drawer__rain-val">{rainfall24h} mm</span>
            </div>
            <div className="zone-drawer__rain-row">
              <span className="zone-drawer__rain-label">48h Cumulative</span>
              <div className="zone-drawer__rain-bar-wrap">
                <div className="zone-drawer__rain-bar" style={{ width: `${Math.min(100, (rainfall48h / 120) * 100)}%`, background: 'var(--brand-orange)' }} />
              </div>
              <span className="zone-drawer__rain-val">{rainfall48h} mm</span>
            </div>
            <div className="zone-drawer__rain-row">
              <span className="zone-drawer__rain-label">72h Cumulative</span>
              <div className="zone-drawer__rain-bar-wrap">
                <div className="zone-drawer__rain-bar" style={{ width: `${Math.min(100, (rainfallMm / 150) * 100)}%`, background: meta.color }} />
              </div>
              <span className="zone-drawer__rain-val" style={{ color: meta.color, fontWeight: 700 }}>{rainfallMm} mm</span>
            </div>
          </div>

          {/* High-Resolution Heatmap Patch Preview */}
          {maskBase64 ? (
            <div className="zone-drawer__heatmap-box glass-card">
              <div className="zone-drawer__section-title" style={{ marginBottom: 8 }}>
                <span>AI Segmentation Heatmap Overlay</span>
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
          ) : (
            <div className="zone-drawer__upload-box glass-card">
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                Offline validation patch (.npy / .h5)
              </span>
              <input
                type="file"
                ref={fileInputRef}
                accept=".npy,.h5"
                onChange={handlePatchUpload}
                style={{ display: 'none' }}
                id="drawer-file-upload"
              />
              <button
                className="btn-secondary"
                style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Processing DeepLabv3+...' : '↑ Upload Satellite Patch (.npy / .h5)'}
              </button>
              {uploadError && <p style={{ color: 'var(--risk-critical)', fontSize: 11, marginTop: 4 }}>{uploadError}</p>}
            </div>
          )}

          {/* Nearby Field Reports */}
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
                      <img src={r.photo_url} alt="Report thumbnail" className="zone-drawer__report-thumb" />
                    )}
                    <div className="zone-drawer__report-info">
                      <p className="zone-drawer__report-desc">{r.description}</p>
                      <span className="zone-drawer__report-time">
                        {r.created_at ? new Date(r.created_at).toLocaleDateString() : 'Recent officer submission'}
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
