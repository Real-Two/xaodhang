import React, { useEffect, useState } from 'react';
import { Polyline, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { BASE_URL } from '../api/client';
import { normalizeRiskLevel } from './RiskCard';

/**
 * EvacuationOverlay
 *
 * Shows on the map when a HIGH or CRITICAL zone is selected.
 * Draws: dashed line from zone → district HQ, with a destination marker.
 * If ORS routing is available, draws the actual road polyline instead.
 *
 * Props:
 *   selectedZone — the currently selected zone object
 *   visible      — boolean, true when the layer should render
 */
export default function EvacuationOverlay({ selectedZone, visible }) {
  const [route, setRoute] = useState(null);
  const map = useMap();

  const zoneId = selectedZone?.id ?? selectedZone?.zone_id;
  const level  = normalizeRiskLevel(selectedZone?.risk_level);
  const show   = visible && selectedZone && (level === 'HIGH' || level === 'CRITICAL');

  useEffect(() => {
    if (!show || !zoneId) { setRoute(null); return; }

    fetch(`${BASE_URL}/evacuation/${zoneId}`, { cache: 'no-store' })
      .then(r => r.ok ? r.json() : null)
      .then(data => setRoute(data))
      .catch(() => setRoute(null));
  }, [zoneId, show]);

  if (!show || !route) return null;

  const zonePos  = [route.zone_lat,   route.zone_lon];
  const targetPos = [route.target_lat, route.target_lon];

  // If ORS returned a full road geometry, use it; else straight line
  const linePositions = route.route_geojson?.coordinates
    ? route.route_geojson.coordinates.map(([lon, lat]) => [lat, lon])
    : [zonePos, targetPos];

  const lineColor = level === 'CRITICAL' ? '#7B1FA2' : '#F44336';

  // Custom destination icon
  const destIcon = L.divIcon({
    html: `<div style="
      background: #1a1a2e; border: 2px solid ${lineColor};
      border-radius: 50%; width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; box-shadow: 0 0 10px ${lineColor}88;
    ">🏛</div>`,
    className: '',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  return (
    <>
      {/* Route line */}
      <Polyline
        positions={linePositions}
        pathOptions={{
          color:     lineColor,
          weight:    3,
          opacity:   0.85,
          dashArray: route.has_route ? undefined : '8 6',
        }}
      />

      {/* Destination marker */}
      <Marker position={targetPos} icon={destIcon}>
        <Popup>
          <div style={{ fontSize: 12, lineHeight: 1.6 }}>
            <strong>🏛 {route.target_name}</strong><br />
            <span style={{ color: '#888' }}>Evacuation destination</span><br />
            {route.has_route ? (
              <>Road distance: <strong>{route.road_km}km</strong><br /></>
            ) : (
              <>Straight-line: <strong>{route.straight_km}km</strong> {route.direction}<br /></>
            )}
            Est. time: <strong>~{route.est_time_min} min</strong>
            {route.steps?.length > 0 && (
              <>
                <hr style={{ margin: '6px 0', borderColor: '#333' }} />
                <strong>Route steps:</strong><br />
                {route.steps.slice(0, 4).map((s, i) => (
                  <div key={i} style={{ marginTop: 2, color: '#ccc' }}>
                    {i + 1}. {s.instruction} ({Math.round(s.distance_m / 100) / 10}km)
                  </div>
                ))}
              </>
            )}
          </div>
        </Popup>
      </Marker>
    </>
  );
}
