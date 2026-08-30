import React, { useCallback, useState } from 'react';
import {
  MapContainer, TileLayer, useMapEvents, LayerGroup
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

import { useApp } from '../context/AppContext';
import { useLiveQuery } from '../hooks/useLiveQuery';
import ZoneMarker from './ZoneMarker';
import HeatmapOverlay from './HeatmapOverlay';
import ReportMarker from './ReportMarker';
import LiveQueryPin from './LiveQueryPin';
import BandwidthToggle from './BandwidthToggle';
import ReportForm from './ReportForm';
import AboutPanel from './AboutPanel';
import Legend from './Legend';

// NE India — confirmed center per PS spec
const MAP_CENTER = [25.5, 93.0];
const MAP_ZOOM = 7;
// Soft bounds — let users pan if needed (pad gives 50% extra)
const NER_BOUNDS = [[21.5, 88.0], [29.6, 97.5]];

// OpenStreetMap — zero API key requirement.
const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// ── Map click handler (inner component, has map context) ─────────────────────
function MapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

// ── Layer control toolbar ─────────────────────────────────────────────────────
function LayerToolbar({ onReportFormOpen }) {
  const { state, actions } = useApp();

  return (
    <div className="layer-toolbar glass-card">
      <span className="layer-toolbar__title">Layers</span>

      <label className="layer-toggle" htmlFor="toggle-heatmap">
        <input
          id="toggle-heatmap"
          type="checkbox"
          checked={state.heatmapVisible && !state.bandwidthMode}
          onChange={actions.toggleHeatmap}
          disabled={state.bandwidthMode}
        />
        <span>🔥 Heatmap</span>
        {state.bandwidthMode && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}> (low-BW)</span>}
      </label>

      <label className="layer-toggle" htmlFor="toggle-reports">
        <input
          id="toggle-reports"
          type="checkbox"
          checked={state.reportsVisible}
          onChange={actions.toggleReports}
        />
        <span>📋 Reports</span>
      </label>

      <div className="divider" style={{ margin: '6px 0' }} />

      <button
        id="open-report-form"
        className="btn"
        onClick={onReportFormOpen}
        style={{ width: '100%', justifyContent: 'center', fontSize: 12 }}
      >
        + File Report
      </button>
    </div>
  );
}

// ── Live query hint ───────────────────────────────────────────────────────────
function LiveQueryHint() {
  const { state } = useApp();
  const { status, lat, lon, elapsed } = state.liveQuery;
  if (status !== 'loading') return null;

  const latStr = lat != null ? lat.toFixed(4) : '—';
  const lonStr = lon != null ? lon.toFixed(4) : '—';
  const remaining = Math.max(1, 20 - elapsed);

  return (
    <div className="live-query-hint glass-card">
      <span className="spinner" />
      <span>
        Analyzing satellite imagery for <strong>{latStr}, {lonStr}</strong>…
      </span>
      <span style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
        ~{remaining}s remaining
      </span>
    </div>
  );
}

/**
 * MapView — main Leaflet map with all layers and floating controls.
 * Exported so PriorityPanel can receive a ref to pan the map.
 */
export default function MapView({ mapRef }) {
  const { state } = useApp();
  const { queryPoint, liveQuery } = useLiveQuery();
  const [reportFormOpen, setReportFormOpen] = useState(false);
  const [reportPrefill, setReportPrefill] = useState({ lat: null, lon: null });

  const handleMapClick = useCallback((lat, lon) => {
    if (reportFormOpen) {
      // If form is open, prefill coords from click
      setReportPrefill({ lat, lon });
      return;
    }
    // Otherwise fire live query
    queryPoint(lat, lon);
  }, [queryPoint, reportFormOpen]);

  const handleZoneClick = useCallback((zone) => {
    mapRef?.current?.setView([zone.lat, zone.lon], 11, { animate: true });
  }, [mapRef]);

  return (
    <div className="map-wrapper">
      <MapContainer
        center={MAP_CENTER}
        zoom={MAP_ZOOM}
        minZoom={6}
        maxBounds={NER_BOUNDS}
        maxBoundsViscosity={0.5}
        style={{ height: '100%', width: '100%' }}
        ref={mapRef}
        zoomControl={true}
        attributionControl={true}
      >
        {/* Dark tile layer */}
        <TileLayer
          url={TILE_URL}
          attribution={TILE_ATTR}
          subdomains="abcd"
          maxZoom={19}
        />

        {/* Map click → live query */}
        <MapClickHandler onMapClick={handleMapClick} />

        {/* Zone markers */}
        <LayerGroup>
          {state.zones.map(zone => (
            <React.Fragment key={zone.id}>
              <ZoneMarker zone={zone} />
              {/* Heatmap overlay for this zone (if structural result exists) */}
              {!state.bandwidthMode && state.heatmapVisible &&
               state.structuralResults[zone.id]?.mask_png_base64 && (
                <HeatmapOverlay
                  lat={zone.lat}
                  lon={zone.lon}
                  base64Png={state.structuralResults[zone.id].mask_png_base64}
                />
              )}
            </React.Fragment>
          ))}
        </LayerGroup>

        {/* Report markers */}
        {state.reportsVisible && (
          <LayerGroup>
            {state.reports.map((r, i) => (
              <ReportMarker key={r.id ?? i} report={r} />
            ))}
          </LayerGroup>
        )}

        {/* Live query pin (spinner or result) */}
        <LiveQueryPin />
      </MapContainer>

      {/* ── Floating Controls (top-right) ── */}
      <div className="floating-controls">
        <LayerToolbar onReportFormOpen={() => setReportFormOpen(true)} />
      </div>

      {/* ── Legend (always visible, bottom-left) ── */}
      <Legend />

      {/* ── Floating Controls (bottom-left) ── */}
      <div className="floating-controls-left">
        <BandwidthToggle />
        <AboutPanel />
      </div>

      {/* ── Live query status hint ── */}
      <LiveQueryHint />

      {/* ── Click-anywhere hint (shown when idle) ── */}
      {liveQuery.status === 'idle' && state.zones.length > 0 && (
        <div className="map-hint">
          Click anywhere on the map for a live risk estimate
        </div>
      )}

      {/* ── Report Form Panel ── */}
      {reportFormOpen && (
        <div className="report-form-overlay" onClick={() => setReportFormOpen(false)}>
          <div
            className="report-form-container"
            onClick={e => e.stopPropagation()}
          >
            <ReportForm
              prefillLat={reportPrefill.lat}
              prefillLon={reportPrefill.lon}
              onClose={() => {
                setReportFormOpen(false);
                setReportPrefill({ lat: null, lon: null });
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
