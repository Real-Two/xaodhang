import React, { useState, useRef } from 'react';
import { CircleMarker, Popup, useMap } from 'react-leaflet';
import RiskCard, { RISK_META, normalizeRiskLevel } from './RiskCard';
import { useApp } from '../context/AppContext';
import { predictStructural, getRisk } from '../api/client';

/** Zone radius on map by risk level */
const RISK_RADIUS = { LOW: 10, MODERATE: 12, HIGH: 14, CRITICAL: 16 };

/**
 * ZoneMarker — renders a circle marker for a seeded zone.
 * Clicking opens a popup with RiskCard + structural upload.
 */
export default function ZoneMarker({ zone }) {
  const map = useMap();
  const { state, actions } = useApp();
  const level = normalizeRiskLevel(zone.risk_level);
  const meta = RISK_META[level] || RISK_META.LOW;

  const [structLoading, setStructLoading] = useState(false);
  const [structError, setStructError] = useState(null);
  const [riskData, setRiskData] = useState(null); // fetched full risk on open
  const fileRef = useRef(null);

  // Fetch full risk data when popup opens
  const handlePopupOpen = async () => {
    try {
      const risk = await getRisk(zone.id);
      setRiskData(risk);
      actions.setActiveZone(risk);
    } catch (_) {
      setRiskData(zone); // fallback to zone summary
      actions.setActiveZone(zone);
    }
  };

  const handlePopupClose = () => {
    actions.clearActiveZone();
  };

  // Structural prediction upload
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStructLoading(true);
    setStructError(null);
    try {
      const result = await predictStructural(zone.id, file);
      actions.setStructuralResult(zone.id, result);
    } catch (err) {
      setStructError(err.message || 'Prediction failed');
    } finally {
      setStructLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const structResult = state.structuralResults[zone.id];
  const displayData = riskData || zone;

  return (
    <CircleMarker
      center={[zone.lat, zone.lon]}
      radius={RISK_RADIUS[level] || 12}
      pathOptions={{
        color: meta.color,
        fillColor: meta.color,
        fillOpacity: 0.35,
        weight: 2,
        opacity: 0.9,
      }}
      eventHandlers={{
        popupopen: handlePopupOpen,
        popupclose: handlePopupClose,
        click: () => {
          map.setView([zone.lat, zone.lon], Math.max(map.getZoom(), 10), { animate: true });
        },
      }}
    >
      {/* Pulsing ring for CRITICAL */}
      {level === 'CRITICAL' && <CriticalPulse lat={zone.lat} lon={zone.lon} color={meta.color} />}

      <Popup className="zone-popup" minWidth={300} maxWidth={340}>
        <div className="zone-popup__inner glass-card">
          <RiskCard
            zone_name={displayData.zone_name || displayData.name}
            lat={displayData.lat ?? zone.lat}
            lon={displayData.lon ?? zone.lon}
            structural_risk={displayData.structural_risk}
            rainfall_risk={displayData.rainfall_risk}
            combined_score={displayData.combined_score}
            risk_level={displayData.risk_level}
            source="zone"
            compact
          />

          {/* Structural Prediction Upload */}
          <div className="zone-popup__upload">
            <div className="divider" />
            <p className="zone-popup__upload-label">
              🛰 Run structural prediction
            </p>
            {structResult ? (
              <p style={{ fontSize: 12, color: '#4CAF50', marginTop: 4 }}>
                ✓ Heatmap loaded — toggle overlay on map
              </p>
            ) : (
              <>
                <label htmlFor={`struct-upload-${zone.id}`} className="btn"
                  style={{ width: '100%', justifyContent: 'center', cursor: 'pointer', marginTop: 6 }}>
                  {structLoading ? (
                    <><span className="spinner" /> Running model…</>
                  ) : (
                    '↑ Upload .npy / .h5 patch'
                  )}
                </label>
                <input
                  id={`struct-upload-${zone.id}`}
                  ref={fileRef}
                  type="file"
                  accept=".npy,.h5"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                  disabled={structLoading}
                />
                {structError && (
                  <p style={{ color: '#f87171', fontSize: 11, marginTop: 4 }}>{structError}</p>
                )}
              </>
            )}
          </div>
        </div>
      </Popup>
    </CircleMarker>
  );
}

// Separate component needed for pulsing ring via canvas/CSS on the marker
// (simplified — just a decorative outer ring using a larger transparent circle)
function CriticalPulse({ lat, lon, color }) {
  return (
    <CircleMarker
      center={[lat, lon]}
      radius={22}
      pathOptions={{
        color,
        fillColor: 'transparent',
        fillOpacity: 0,
        weight: 1.5,
        opacity: 0.4,
        dashArray: '4 4',
      }}
      interactive={false}
    />
  );
}
