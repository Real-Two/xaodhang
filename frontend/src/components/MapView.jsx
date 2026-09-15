import React, { useCallback, useMemo } from 'react';
import {
  MapContainer, TileLayer, useMapEvents, LayerGroup, CircleMarker, Popup, useMap
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

import { useApp } from '../context/AppContext';
import { useLiveQuery } from '../hooks/useLiveQuery';
import HeatmapOverlay from './HeatmapOverlay';
import ReportMarker from './ReportMarker';
import LiveQueryPin from './LiveQueryPin';
import EvacuationOverlay from './EvacuationOverlay';
import { RISK_META, normalizeRiskLevel } from './RiskCard';

const MAP_CENTER = [25.5, 93.0];
const MAP_ZOOM = 7;
const NER_BOUNDS = [[21.5, 88.0], [29.6, 97.5]];
const TILE_URL  = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const RISK_RADIUS = { CRITICAL: 14, HIGH: 12, MODERATE: 10, LOW: 8 };

function MapClickHandler({ onMapClick }) {
  useMapEvents({ click(e) { onMapClick(e.latlng.lat, e.latlng.lng); } });
  return null;
}

function EnhancedZoneMarker({ zone, onSelect }) {
  const map   = useMap();
  const level = normalizeRiskLevel(zone.risk_level);
  const meta  = RISK_META[level] || RISK_META.LOW;
  const displayName = zone.zone_name || zone.name || `Zone ${zone.id}`;
  const radius   = RISK_RADIUS[level] || 10;
  const isSevere = level === 'CRITICAL' || level === 'HIGH';

  return (
    <>
      {isSevere && (
        <CircleMarker
          center={[zone.lat, zone.lon]}
          radius={radius + 8}
          pathOptions={{ color: meta.color, fillColor: meta.color, fillOpacity: 0.12, weight: 1, opacity: 0.4, className: 'marker-pulse-ring' }}
          interactive={false}
        />
      )}
      <CircleMarker
        center={[zone.lat, zone.lon]}
        radius={radius}
        pathOptions={{ color: '#ffffff', fillColor: meta.color, fillOpacity: 0.9, weight: 2, opacity: 1 }}
        eventHandlers={{
          click: (e) => {
            L.DomEvent.stopPropagation(e);
            onSelect(zone);
            map.setView([zone.lat, zone.lon], Math.max(map.getZoom(), 10), { animate: true });
          },
        }}
      >
        <Popup className="zone-popup" minWidth={220} autoPan>
          <div className="zone-mini-popup">
            <div className="zone-mini-popup__header">
              <span className={`badge badge--${level.toLowerCase()}`}>{meta.label}</span>
              <span className="zone-mini-popup__score">{((zone.combined_score ?? 0) * 100).toFixed(0)}% Risk</span>
            </div>
            <h4 className="zone-mini-popup__title">{displayName}</h4>
            <p className="zone-mini-popup__coords">📍 {zone.lat?.toFixed(3)}°N, {zone.lon?.toFixed(3)}°E</p>
            <button
              className="btn-primary"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8, fontSize: 11, padding: '5px' }}
              onClick={() => onSelect(zone)}
            >
              Open Diagnostic Signals ↗
            </button>
          </div>
        </Popup>
      </CircleMarker>
    </>
  );
}

function FloatingLayerToolbar() {
  const { state, actions } = useApp();
  return (
    <div className="layer-toolbar glass-panel animate-fade">
      <div className="layer-toolbar__header">
        <span className="layer-toolbar__title">GIS Telemetry Layers</span>
      </div>
      <div className="layer-toolbar__list">
        <label className="layer-toggle-row">
          <input type="checkbox" checked={state.layers.heatmap && !state.bandwidthMode} onChange={() => actions.toggleLayer('heatmap')} disabled={state.bandwidthMode} />
          <span className="layer-toggle-name">🔥 Terrain Heatmap</span>
          {state.bandwidthMode && <span className="badge badge--coming-soon">Low-BW</span>}
        </label>
        <label className="layer-toggle-row">
          <input type="checkbox" checked={state.layers.rainfall} onChange={() => actions.toggleLayer('rainfall')} />
          <span className="layer-toggle-name">🌧️ ERA5 Precipitation</span>
        </label>
        <label className="layer-toggle-row">
          <input type="checkbox" checked={state.layers.historical} onChange={() => actions.toggleLayer('historical')} />
          <span className="layer-toggle-name">📜 NASA COOLR Historical</span>
        </label>
        <label className="layer-toggle-row">
          <input type="checkbox" checked={state.layers.reports} onChange={() => actions.toggleLayer('reports')} />
          <span className="layer-toggle-name">📸 Citizen Field Reports</span>
        </label>
        <div className="divider" style={{ margin: '8px 0', opacity: 0.15 }} />
        <div className="layer-toggle-row layer-toggle-row--disabled">
          <input type="checkbox" disabled checked={false} />
          <span className="layer-toggle-name">💧 Soil Moisture</span>
          <span className="badge badge--coming-soon">Coming soon</span>
        </div>
        <div className="layer-toggle-row layer-toggle-row--disabled">
          <input type="checkbox" disabled checked={false} />
          <span className="layer-toggle-name">🌲 Deforestation Watch</span>
          <span className="badge badge--coming-soon">Coming soon</span>
        </div>
        <div className="layer-toggle-row layer-toggle-row--disabled">
          <input type="checkbox" disabled checked={false} />
          <span className="layer-toggle-name">⛏️ Mining Impact</span>
          <span className="badge badge--coming-soon">Coming soon</span>
        </div>
      </div>
    </div>
  );
}

function LivePipelineBanner() {
  const { state } = useApp();
  const { status, lat, lon, elapsed, stage } = state.liveQuery;
  if (status !== 'loading') return null;
  const latStr    = lat != null ? lat.toFixed(4) : '—';
  const lonStr    = lon != null ? lon.toFixed(4) : '—';
  const remaining = Math.max(1, 20 - elapsed);
  const stageDescriptions = {
    satellite: '🛰 Fetching Sentinel-2 (10m) & JAXA AW3D30 Elevation...',
    model:     '🧠 UNet Multi-Scale Spatial Segmentation Inference...',
    rainfall:  '🌧 Querying Open-Meteo ERA5-Land 72h Precipitation...',
  };
  return (
    <div className="live-progress-banner glass-panel animate-fade">
      <div className="live-progress-banner__top">
        <div className="live-progress-banner__status">
          <span className="spinner spinner-sm" />
          <span>Analyzing Coordinates: <strong>{latStr}°N, {lonStr}°E</strong></span>
        </div>
        <span className="live-progress-banner__timer">{elapsed}s (~{remaining}s remaining)</span>
      </div>
      <div className="live-progress-banner__stage">{stageDescriptions[stage] || stageDescriptions.satellite}</div>
      <div className="live-progress-banner__bar-track">
        <div className="live-progress-banner__bar-fill" style={{ width: `${Math.min(95, (elapsed / 20) * 100)}%` }} />
      </div>
    </div>
  );
}

function FloatingLegend() {
  return (
    <div className="floating-legend glass-panel">
      <span className="floating-legend__title">Landslide Hazard Severity</span>
      <div className="floating-legend__items">
        {[['var(--risk-critical)', 'Critical'], ['var(--risk-high)', 'High'], ['var(--risk-moderate)', 'Moderate'], ['var(--risk-low)', 'Low']].map(([color, label]) => (
          <div key={label} className="floating-legend__item">
            <span className="floating-legend__dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
            <span>{label}</span>
          </div>
        ))}
      </div>
      <span className="floating-legend__hint">Click anywhere on map for live AI prediction</span>
    </div>
  );
}

export default function MapView({ mapRef }) {
  const { state, actions } = useApp();
  const { queryPoint }     = useLiveQuery();

  const handleMapClick = useCallback((lat, lon) => { queryPoint(lat, lon); }, [queryPoint]);

  const visibleZones = useMemo(() => state.zones.filter(z => {
    const lvl = normalizeRiskLevel(z.risk_level);
    if (state.filterLevel !== 'ALL' && lvl !== state.filterLevel) return false;
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      return (z.zone_name || z.name || '').toLowerCase().includes(q);
    }
    return true;
  }), [state.zones, state.filterLevel, state.searchQuery]);

  return (
    <div className="map-view-wrapper">
      <MapContainer
        center={MAP_CENTER} zoom={MAP_ZOOM} minZoom={6}
        maxBounds={NER_BOUNDS} maxBoundsViscosity={0.6}
        style={{ height: '100%', width: '100%' }}
        ref={mapRef} zoomControl attributionControl
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} subdomains="abc" maxZoom={19} />
        <MapClickHandler onMapClick={handleMapClick} />

        <LayerGroup>
          {visibleZones.map(zone => (
            <React.Fragment key={zone.id}>
              <EnhancedZoneMarker zone={zone} onSelect={z => actions.setSelectedZone(z)} />
              {!state.bandwidthMode && state.layers.heatmap && state.structuralResults[zone.id]?.mask_png_base64 && (
                <HeatmapOverlay lat={zone.lat} lon={zone.lon} base64Png={state.structuralResults[zone.id].mask_png_base64} />
              )}
            </React.Fragment>
          ))}
        </LayerGroup>

        {state.layers.reports && (
          <LayerGroup>
            {state.reports.map((r, i) => <ReportMarker key={r.id ?? i} report={r} />)}
          </LayerGroup>
        )}

        <LiveQueryPin />

        {/* Evacuation route overlay — renders when HIGH/CRITICAL zone selected */}
        <EvacuationOverlay
          selectedZone={state.selectedZone}
          visible={!!state.selectedZone}
        />
      </MapContainer>

      <FloatingLayerToolbar />
      <LivePipelineBanner />
      <FloatingLegend />

      {state.liveQuery.status === 'idle' && (
        <div className="map-interaction-hint glass-panel animate-fade">
          <span className="map-interaction-hint__dot" />
          <span>Click anywhere in Northeast India to run on-demand live prediction</span>
        </div>
      )}
    </div>
  );
}
