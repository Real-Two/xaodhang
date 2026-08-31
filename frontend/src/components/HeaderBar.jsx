import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { normalizeRiskLevel } from './RiskCard';
import { geocodeSearch } from '../api/client';
import { useLiveQuery } from '../hooks/useLiveQuery';

const DEBOUNCE_MS = 450; // Nominatim usage policy asks for ~1 req/sec max
const ZOOM_ON_SELECT = 13; // close enough to see the actual road/village, not just the region

/** Friendlier label for OSM's place-type codes */
function osmTypeLabel(osmType) {
  const map = {
    village: 'Village', town: 'Town', city: 'City', hamlet: 'Hamlet',
    residential: 'Road', primary: 'Highway', secondary: 'Road',
    trunk: 'Highway', tertiary: 'Road', road: 'Road',
    administrative: 'District', suburb: 'Area', county: 'District',
  };
  return map[osmType] || 'Place';
}

/**
 * HeaderBar — Top application header.
 * Search bar, risk severity filter chips, live pipeline pulse, and report submission CTA.
 */
export default function HeaderBar() {
  const { state, actions, mapRef } = useApp();
  const { queryPoint } = useLiveQuery();

  const [suggestions, setSuggestions] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  // ── Debounced search: local monitored zones first, then OSM geocoding ──────
  useEffect(() => {
    clearTimeout(debounceRef.current);
    abortRef.current?.abort();

    const q = state.searchQuery.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setShowDropdown(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      // 1. Zones we already monitor — instant, no network call
      const localMatches = state.zones
        .filter(z => (z.zone_name || z.name || '').toLowerCase().includes(q.toLowerCase()))
        .slice(0, 4)
        .map(z => ({
          type: 'zone',
          id: `zone-${z.id}`,
          label: z.zone_name || z.name,
          sublabel: `Monitored · ${normalizeRiskLevel(z.risk_level)}`,
          lat: z.lat,
          lon: z.lon,
          zone: z,
        }));

      // 2. Anything else in NER — real geocoding, works for roads/villages
      //    that aren't one of our seeded zones yet
      setSearching(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const geoResults = await geocodeSearch(q, controller.signal);
      setSearching(false);

      const geoMatches = geoResults
        .filter(g => !localMatches.some(l =>
          Math.abs(l.lat - g.lat) < 0.01 && Math.abs(l.lon - g.lon) < 0.01))
        .map(g => ({ ...g, sublabel: osmTypeLabel(g.osmType) }));

      setSuggestions([...localMatches, ...geoMatches]);
      setShowDropdown(true);
    }, DEBOUNCE_MS);

    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.searchQuery, state.zones]);

  const handleSelect = useCallback((item) => {
    actions.setView('map');
    actions.setSearchQuery('');
    setShowDropdown(false);
    setSuggestions([]);

    // Give the map view a tick to mount if we just switched to it
    setTimeout(() => {
      mapRef.current?.setView([item.lat, item.lon], ZOOM_ON_SELECT, { animate: true });

      if (item.type === 'zone') {
        // Already-monitored zone — we have the data, just show it
        actions.setSelectedZone(item.zone);
      } else {
        // Anywhere else the user searched for — run the real live pipeline
        // (satellite fetch + model + rainfall) for that exact point
        queryPoint(item.lat, item.lon);
      }
    }, 50);
  }, [actions, mapRef, queryPoint]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && suggestions.length > 0) {
      handleSelect(suggestions[0]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  const filterCounts = state.zones.reduce((acc, z) => {
    const lvl = normalizeRiskLevel(z.risk_level);
    acc[lvl] = (acc[lvl] || 0) + 1;
    acc.ALL = (acc.ALL || 0) + 1;
    return acc;
  }, { ALL: 0, CRITICAL: 0, HIGH: 0, MODERATE: 0, LOW: 0 });

  const filterChips = [
    { key: 'ALL', label: 'All Zones', count: filterCounts.ALL, color: 'var(--text-secondary)' },
    { key: 'CRITICAL', label: 'Critical', count: filterCounts.CRITICAL, color: 'var(--risk-critical)' },
    { key: 'HIGH', label: 'High', count: filterCounts.HIGH, color: 'var(--risk-high)' },
    { key: 'MODERATE', label: 'Moderate', count: filterCounts.MODERATE, color: 'var(--risk-moderate)' },
    { key: 'LOW', label: 'Low', count: filterCounts.LOW, color: 'var(--risk-low)' },
  ];

  return (
    <header className="header-bar">
      {/* Left: Brand Identity */}
      <div className="header-bar__left">
        <div className="header-bar__brand-wrap">
          <div className="header-bar__title-row">
            <span className="header-bar__brand-name">RedBeryl</span>
            <span className="header-bar__brand-tag">EWS</span>
            <span className="header-bar__theme-badge">SIH26001 · MDoNER</span>
          </div>
          <span className="header-bar__subtitle">
            Northeast India Landslide Early-Warning & Risk Monitoring
          </span>
        </div>

        {/* Live Pipeline Status Pulse */}
        <div className="header-bar__pipeline-status" title="Google Earth Engine + Sentinel-2 & CHIRPS Active">
          <span className="pulse-dot pulse-dot--live" />
          <span className="header-bar__pipeline-text">
            {state.backendOnline ? 'AI Pipeline Live' : 'Connecting to API...'}
          </span>
        </div>
      </div>

      {/* Center: Search & Filter Chips */}
      <div className="header-bar__center">
        {/* Search */}
        <div className="header-bar__search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="header-bar__search-icon">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="search"
            placeholder="Search any road, village or district in NER…"
            value={state.searchQuery}
            onChange={e => actions.setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 120)}
            className="header-bar__search-input"
          />
          {state.searchQuery && (
            <button
              className="header-bar__search-clear"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { actions.setSearchQuery(''); setSuggestions([]); setShowDropdown(false); }}
            >
              ✕
            </button>
          )}

          {showDropdown && (
            <div className="header-bar__search-dropdown glass-panel">
              {searching && (
                <div className="header-bar__search-status">
                  <span className="spinner spinner-sm" /> Searching Northeast India…
                </div>
              )}
              {!searching && suggestions.length === 0 && (
                <div className="header-bar__search-status">
                  No matches. Try a highway (NH2), village, or district name.
                </div>
              )}
              {suggestions.map(item => (
                <button
                  key={item.id}
                  className="header-bar__search-option"
                  onMouseDown={(e) => e.preventDefault()} // fire select before input's onBlur closes the dropdown
                  onClick={() => handleSelect(item)}
                >
                  <span className={`header-bar__search-option-icon ${item.type === 'zone' ? 'header-bar__search-option-icon--zone' : ''}`}>
                    {item.type === 'zone' ? '📍' : '🔍'}
                  </span>
                  <span className="header-bar__search-option-text">
                    <span className="header-bar__search-option-label">{item.label}</span>
                    <span className="header-bar__search-option-sub">{item.sublabel}</span>
                  </span>
                  {item.type !== 'zone' && (
                    <span className="header-bar__search-option-cta">Run live prediction →</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Filter Chips */}
        <div className="header-bar__filters">
          {filterChips.map(chip => (
            <button
              key={chip.key}
              className={`header-bar__chip ${state.filterLevel === chip.key ? 'header-bar__chip--active' : ''}`}
              onClick={() => actions.setFilterLevel(chip.key)}
              style={{
                '--chip-color': chip.color,
              }}
            >
              <span>{chip.label}</span>
              {chip.count > 0 && <span className="header-bar__chip-count">{chip.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Right: Actions */}
      <div className="header-bar__right">
        {/* Low-Bandwidth Mode Toggle */}
        <button
          className={`header-bar__bw-btn ${state.bandwidthMode ? 'header-bar__bw-btn--active' : ''}`}
          onClick={actions.toggleBandwidth}
          title="Toggle vector-only low bandwidth mode"
        >
          <span className="header-bar__bw-icon">⚡</span>
          <span>{state.bandwidthMode ? 'Low-BW Mode (Active)' : 'Low-Bandwidth'}</span>
        </button>

        {/* Primary CTA: File Report */}
        <button
          className="btn-primary header-bar__report-btn"
          onClick={() => actions.openModal('reportForm')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>File Field Report</span>
        </button>
      </div>
    </header>
  );
}
