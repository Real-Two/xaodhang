import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import RiskCard from './RiskCard';
import HeatmapOverlay from './HeatmapOverlay';
import { useLiveQuery } from '../hooks/useLiveQuery';
import { useApp } from '../context/AppContext';

// Risk colors — exact spec from PS brief
const RISK_COLORS = {
  LOW: '#4CAF50',
  MODERATE: '#FF9800',
  HIGH: '#F44336',
  CRITICAL: '#7B1FA2',
};

// Spinner marker for loading state
function makeSpinnerIcon(elapsed) {
  return L.divIcon({
    className: '',
    html: `<div class="live-pin-spinner">
      <div class="spinner spinner-lg"></div>
      <div class="live-pin-timer">${elapsed}s</div>
    </div>`,
    iconSize: [48, 60],
    iconAnchor: [24, 30],
    popupAnchor: [0, -34],
  });
}

// Result marker — color matches risk level
function makeResultIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div class="live-pin-result" style="--live-color: ${color}">
      <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24S32 28 32 16C32 7.16 24.84 0 16 0z" fill="${color}"/>
        <circle cx="16" cy="16" r="7" fill="rgba(0,0,0,0.35)"/>
        <text x="16" y="20" text-anchor="middle" font-size="10" font-family="sans-serif" fill="white">⚡</text>
      </svg>
    </div>`,
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -42],
  });
}

/**
 * LiveQueryPin — handles the "click anywhere on map" flow.
 *
 * Field names match real /predict/live response:
 *   zone_name, structural_risk, rainfall_risk, combined_score,
 *   risk_level, mask_png_base64, cached, source
 */
export default function LiveQueryPin() {
  const { liveQuery, cancelQuery } = useLiveQuery();
  const { state } = useApp();

  if (liveQuery.status === 'idle') return null;
  const { lat, lon, status, result, error, elapsed } = liveQuery;
  if (lat == null || lon == null) return null;

  // ── Loading ────────────────────────────────────────────────────────────────
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

  // ── Error ──────────────────────────────────────────────────────────────────
  if (status === 'error') {
    const errorIcon = L.divIcon({
      className: '',
      html: `<div class="live-pin-error">⚠</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
      popupAnchor: [0, -18],
    });
    return (
      <Marker position={[lat, lon]} icon={errorIcon}>
        <Popup className="zone-popup" minWidth={240}>
          <div className="zone-popup__inner glass-card" style={{ padding: 16 }}>
            <p style={{ color: '#F44336', fontWeight: 600, marginBottom: 8 }}>⚠ Live query failed</p>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{error}</p>
            <button className="btn" style={{ marginTop: 12 }} onClick={cancelQuery}>Dismiss</button>
          </div>
        </Popup>
      </Marker>
    );
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  if (status === 'done' && result) {
    // Normalise risk_level — handle any casing or missing value
    const rawLevel = String(result.risk_level || 'LOW').toUpperCase().trim();
    // Exhaustive fallback so an unexpected value never crashes the icon lookup
    const level = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(rawLevel)
      ? rawLevel : 'LOW';
    const color = RISK_COLORS[level]; // always defined now

    // null mask_png_base64 = cached response — skip overlay render entirely
    const hasMask = result.mask_png_base64 != null && result.mask_png_base64 !== '';
    const showHeatmap = hasMask && !result.cached && !state.bandwidthMode && state.heatmapVisible;

    return (
      <>
        {showHeatmap && (
          <HeatmapOverlay lat={lat} lon={lon} base64Png={result.mask_png_base64} />
        )}

        <Marker position={[lat, lon]} icon={makeResultIcon(color)} zIndexOffset={900}>
          <Popup className="zone-popup" minWidth={300} maxWidth={340} autoPan>
            <div className="zone-popup__inner glass-card">
              <RiskCard
                zone_name={result.zone_name || result.name}
                lat={result.lat ?? lat}
                lon={result.lon ?? lon}
                structural_risk={result.structural_risk ?? 0}
                rainfall_risk={result.rainfall_risk ?? 0}
                combined_score={result.combined_score ?? 0}
                risk_level={level}
                source="live"
                cached={!!result.cached}
                compact
              />

              {result.cached && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', padding: '0 4px 4px', marginTop: 6 }}>
                  ⚡ Instant result — cached from a previous query at this location
                </p>
              )}

              {!hasMask && !result.cached && (
                <p style={{ fontSize: 11, color: 'var(--text-muted)', padding: '0 4px 4px', marginTop: 6 }}>
                  ℹ No heatmap returned for this location
                </p>
              )}

              <button
                className="btn"
                style={{ width: '100%', justifyContent: 'center', marginTop: 10 }}
                onClick={cancelQuery}
              >
                Clear pin
              </button>
            </div>
          </Popup>
        </Marker>
      </>
    );
  }

  return null;
}
