import React from 'react';
import { useApp } from '../context/AppContext';
import { normalizeRiskLevel } from './RiskCard';

/**
 * HeaderBar — Top application header.
 * Search bar, risk severity filter chips, live pipeline pulse, and report submission CTA.
 */
export default function HeaderBar() {
  const { state, actions } = useApp();

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
            placeholder="Search zones, highways, districts (e.g., Senapati, NH2)..."
            value={state.searchQuery}
            onChange={e => actions.setSearchQuery(e.target.value)}
            className="header-bar__search-input"
          />
          {state.searchQuery && (
            <button className="header-bar__search-clear" onClick={() => actions.setSearchQuery('')}>
              ✕
            </button>
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
