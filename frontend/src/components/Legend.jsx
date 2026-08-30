import React from 'react';

const LEVELS = [
  { level: 'CRITICAL', color: '#7B1FA2', bg: 'rgba(123,31,162,0.18)' },
  { level: 'HIGH',     color: '#F44336', bg: 'rgba(244,67,54,0.15)' },
  { level: 'MODERATE', color: '#FF9800', bg: 'rgba(255,152,0,0.15)' },
  { level: 'LOW',      color: '#4CAF50', bg: 'rgba(76,175,80,0.12)' },
];

/**
 * Legend — fixed bottom-left overlay, always visible.
 * Positioned inside the map wrapper (absolute, not inside Leaflet layers).
 */
export default function Legend() {
  return (
    <div className="map-legend glass-card">
      <div className="map-legend__title">Risk Level</div>

      {LEVELS.map(({ level, color, bg }) => (
        <div key={level} className="map-legend__row">
          <div
            className="map-legend__dot"
            style={{ background: color, boxShadow: `0 0 7px ${color}` }}
          />
          <span className="map-legend__label">{level}</span>
        </div>
      ))}

      <div className="map-legend__footer">
        Click map · live AI prediction
      </div>
    </div>
  );
}
