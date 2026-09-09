import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import HeatmapOverlay from './HeatmapOverlay';
import { useLiveQuery } from '../hooks/useLiveQuery';
import { useApp } from '../context/AppContext';
import { RISK_META, normalizeRiskLevel } from './RiskCard';

// ── Spinner marker — animated dot at clicked point during fetch ───────────────
function makeSpinnerIcon(elapsed) {
  return L.divIcon({
    className: '',
    html: `
      <div class="live-pin-spinner">
        <div class="spinner spinner-lg"></div>
        <div class="live-pin-timer">${elapsed}s</div>
      </div>`,
    iconSize: [48, 60],
    iconAnchor: [24, 30],
    popupAnchor: [0, -34],
  });
}

// ── Result marker — colored teardrop matching risk level ─────────────────────
function makeResultIcon(color) {
  return L.divIcon({
    className: '',
    html: `
      <div class="live-pin-result" style="--live-color: ${color}">
        <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24S32 28 32 16C32 7.16 24.84 0 16 0z"
                fill="${color}"/>
          <circle cx="16" cy="16" r="7" fill="rgba(0,0,0,0.35)"/>
          <text x="16" y="20" text-anchor="middle" font-size="10"
                font-family="sans-serif" fill="white">⚡</text>
        </svg>
      </div>`,
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -42],
  });
}

// ── Error marker ──────────────────────────────────────────────────────────────
const ERROR_ICON = L.divIcon({
  className: '',
  html: `<div class="live-pin-error">⚠</div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  popupAnchor: [0, -18],
});

/**
 * LiveQueryPin — renders the pin + side-panel popup for map-click live predictions.
 *
 * Three states:
 *   loading → animated spinner at clicked lat/lon, no popup
 *   done    → colored teardrop pin + Popup with full risk breakdown
 *   error   → warning icon + error popup
 *
 * Response fields used:
 *   lat, lon, risk_level, combined_score, structural_risk, rainfall_risk,
 *   rainfall_mm_24h, rainfall_mm_48h, rainfall_mm_72h, mask_png_base64, cached
 */
export default function LiveQueryPin() {
  const { liveQuery, cancelQuery } = useLiveQuery();
  const { state } = useApp();

  const { status, lat, lon, result, error, elapsed } = liveQuery;

  if (status === 'idle') return null;
  if (lat == null || lon == null) return null;

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (status === 'loading') {
    return (
      <Marker
        position={[lat, lon]}
        icon={makeSpinnerIcon(elapsed)}
        interactive={false}
        zIndexOffset={1000}
      />
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <Marker position={[lat, lon]} icon={ERROR_ICON}>
        <Popup className="zone-popup" minWidth={260} autoPan>
          <div className="live-popup glass-card">
            <div className="live-popup__error-header">
              <span>⚠ Live Prediction Failed</span>
            </div>
            <p className="live-popup__error-body">{error}</p>
            <button className="btn" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
                    onClick={cancelQuery}>
              Dismiss
            </button>
          </div>
        </Popup>
      </Marker>
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────────
  if (status === 'done' && result) {
    const rawLevel = String(result.risk_level || 'LOW').toUpperCase().trim();
    const level = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(rawLevel) ? rawLevel : 'LOW';
    const meta = RISK_META[level];

    const combinedPct   = Math.round((result.combined_score  ?? 0) * 100);
    const structuralPct = Math.round((result.structural_risk ?? 0) * 100);
    const rainfallPct   = Math.round((result.rainfall_risk   ?? 0) * 100);

    const rain24 = result.rainfall_mm_24h;
    const rain48 = result.rainfall_mm_48h;
    const rain72 = result.rainfall_mm_72h;

    const hasMask = result.mask_png_base64 != null && result.mask_png_base64 !== '';
    const showHeatmap = hasMask && !result.cached && !state.bandwidthMode && state.layers.heatmap;

    // Semi-circle arc SVG gauge
    const R = 34;
    const circ = Math.PI * R;
    const strokeOffset = circ * (1 - combinedPct / 100);

    return (
      <>
        {showHeatmap && (
          <HeatmapOverlay lat={lat} lon={lon} base64Png={result.mask_png_base64} />
        )}

        <Marker position={[lat, lon]} icon={makeResultIcon(meta.color)} zIndexOffset={900}>
          <Popup className="zone-popup" minWidth={300} maxWidth={340} autoPan>
            <div className="live-popup glass-card" style={{ '--risk-color': meta.color }}>

              {/* ── Title: coordinates ── */}
              <div className="live-popup__header">
                <div className="live-popup__title-block">
                  <div className="live-popup__badges">
                    <span className={`risk-badge ${meta.cls}`}>{meta.label}</span>
                    <span className="risk-badge" style={{
                      background: 'rgba(59,127,245,0.15)',
                      color: '#60a5fa',
                      border: '1px solid rgba(59,127,245,0.25)',
                    }}>
                      {result.cached ? '⚡ Cached' : '🛰 Live'}
                    </span>
                  </div>
                  <h3 className="live-popup__coords-title">
                    {lat.toFixed(4)}°N, {lon.toFixed(4)}°E
                  </h3>
                  <span className="live-popup__subtitle">On-demand prediction · Northeast India</span>
                </div>
              </div>

              {/* ── Combined score gauge ── */}
              <div className="live-popup__gauge-row">
                <div className="live-popup__gauge">
                  <svg viewBox="0 0 84 48" width="84">
                    <path d="M 8 44 A 34 34 0 0 1 76 44" fill="none"
                          stroke="rgba(255,255,255,0.07)" strokeWidth="7" strokeLinecap="round" />
                    <path d="M 8 44 A 34 34 0 0 1 76 44" fill="none"
                          stroke={meta.color} strokeWidth="7" strokeLinecap="round"
                          strokeDasharray={circ} strokeDashoffset={strokeOffset}
                          style={{ filter: `drop-shadow(0 0 4px ${meta.color}88)` }} />
                    <text x="42" y="43" textAnchor="middle" fill={meta.color}
                          fontSize="14" fontFamily="'Space Grotesk', sans-serif" fontWeight="700">
                      {combinedPct}%
                    </text>
                  </svg>
                  <span className="live-popup__gauge-label">Combined</span>
                </div>

                <div className="live-popup__score-bars">
                  <ScoreBar icon="⛰" label="Layer 1 · Terrain" pct={structuralPct}
                            color={structuralPct > 65 ? '#EF4444' : structuralPct > 35 ? '#F97316' : '#22C55E'} />
                  <ScoreBar icon="🌧" label="Layer 2 · Rainfall" pct={rainfallPct}
                            color={rainfallPct > 65 ? '#EF4444' : rainfallPct > 35 ? '#EAB308' : '#60a5fa'} />
                </div>
              </div>

              {/* ── Rainfall accumulation ── */}
              {(rain24 != null || rain48 != null || rain72 != null) && (
                <div className="live-popup__rain-section">
                  <span className="live-popup__rain-title">CHIRPS Precipitation</span>
                  <div className="live-popup__rain-grid">
                    {rain24 != null && (
                      <div className="live-popup__rain-cell">
                        <span className="live-popup__rain-mm">{rain24.toFixed(1)}</span>
                        <span className="live-popup__rain-unit">mm 24h</span>
                      </div>
                    )}
                    {rain48 != null && (
                      <div className="live-popup__rain-cell">
                        <span className="live-popup__rain-mm" style={{ color: 'var(--brand-orange)' }}>
                          {rain48.toFixed(1)}
                        </span>
                        <span className="live-popup__rain-unit">mm 48h</span>
                      </div>
                    )}
                    {rain72 != null && (
                      <div className="live-popup__rain-cell">
                        <span className="live-popup__rain-mm" style={{ color: meta.color }}>
                          {rain72.toFixed(1)}
                        </span>
                        <span className="live-popup__rain-unit">mm 72h</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Actions ── */}
              <div className="live-popup__actions">
                <button className="btn btn--sm" style={{ flex: 1, justifyContent: 'center' }}
                        onClick={cancelQuery}>
                  Clear pin
                </button>
              </div>
            </div>
          </Popup>
        </Marker>
      </>
    );
  }

  return null;
}

// ── Mini score bar ────────────────────────────────────────────────────────────
function ScoreBar({ icon, label, pct, color }) {
  return (
    <div className="live-popup__bar-row">
      <div className="live-popup__bar-label">
        <span>{icon} {label}</span>
        <span style={{ color, fontWeight: 600 }}>{pct}%</span>
      </div>
      <div className="progress-bar-track" style={{ height: 5 }}>
        <div className="progress-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}
