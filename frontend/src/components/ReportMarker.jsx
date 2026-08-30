import React from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';

// Custom SVG pin icon for citizen reports — distinct from zone circles
const reportIcon = L.divIcon({
  className: '',
  html: `<div class="report-pin">
    <svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 0C6.27 0 0 6.27 0 14c0 10.5 14 22 14 22S28 24.5 28 14C28 6.27 21.73 0 14 0z" fill="#a78bfa"/>
      <circle cx="14" cy="14" r="6" fill="white" fill-opacity="0.9"/>
      <text x="14" y="18" text-anchor="middle" font-size="9" font-family="sans-serif" fill="#6d28d9">📋</text>
    </svg>
  </div>`,
  iconSize: [28, 36],
  iconAnchor: [14, 36],
  popupAnchor: [0, -36],
});

/**
 * ReportMarker — citizen / field officer report pin.
 * Distinct purple SVG pin with popup showing report details.
 */
export default function ReportMarker({ report }) {
  const {
    lat, lon, description,
    photo_url, photo,
    created_at, timestamp,
    id,
  } = report;

  const displayTime = created_at || timestamp
    ? new Date(created_at || timestamp).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
      })
    : 'Unknown time';

  // photo might be a URL or base64
  const photoSrc = photo_url || (photo?.startsWith?.('data:') ? photo : photo ? `data:image/jpeg;base64,${photo}` : null);

  return (
    <Marker position={[lat, lon]} icon={reportIcon}>
      <Popup className="report-popup" minWidth={240} maxWidth={280}>
        <div className="report-popup__inner glass-card">
          <div className="report-popup__header">
            <span style={{ fontSize: 13, fontWeight: 600 }}>Field Report #{id || '—'}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{displayTime}</span>
          </div>

          <div className="divider" style={{ margin: '8px 0' }} />

          <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {description || 'No description provided.'}
          </p>

          {photoSrc && (
            <img
              src={photoSrc}
              alt="Field photo"
              style={{
                width: '100%',
                borderRadius: 8,
                marginTop: 10,
                objectFit: 'cover',
                maxHeight: 160,
              }}
            />
          )}

          <p style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8 }}>
            📍 {lat.toFixed(5)}°N, {lon.toFixed(5)}°E
          </p>
        </div>
      </Popup>
    </Marker>
  );
}
