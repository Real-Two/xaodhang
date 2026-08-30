import React from 'react';
import { useApp } from '../context/AppContext';
import { normalizeRiskLevel } from './RiskCard';

/**
 * NavigationSidebar — Slim icon-only left navigation bar.
 * Gives the application a clean, modern SaaS visual hierarchy.
 */
export default function NavigationSidebar() {
  const { state, actions } = useApp();

  // Count active warnings (Critical + High)
  const activeAlertsCount = state.zones.filter(z => {
    const lvl = normalizeRiskLevel(z.risk_level);
    return lvl === 'CRITICAL' || lvl === 'HIGH';
  }).length;

  return (
    <aside className="nav-sidebar">
      {/* Brand Icon */}
      <div className="nav-sidebar__brand" title="RedBeryl Landslide EWS · SIH 2026">
        <div className="nav-sidebar__logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 8.5V15.5L12 22L22 15.5V8.5L12 2Z" stroke="#E87722" strokeWidth="2" strokeLinejoin="round" />
            <path d="M12 6L6 10V14L12 18L18 14V10L12 6Z" fill="#E87722" fillOpacity="0.3" stroke="#E87722" strokeWidth="1.5" />
            <circle cx="12" cy="12" r="2" fill="#F3F4F8" />
          </svg>
        </div>
      </div>

      {/* Primary Navigation Views */}
      <nav className="nav-sidebar__menu">
        {/* Map View */}
        <button
          className={`nav-sidebar__item ${state.currentView === 'map' ? 'nav-sidebar__item--active' : ''}`}
          onClick={() => actions.setView('map')}
          title="GIS Map & Live Predictions"
          aria-label="GIS Map"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6" />
            <line x1="8" y1="2" x2="8" y2="18" />
            <line x1="16" y1="6" x2="16" y2="22" />
          </svg>
          <span className="nav-sidebar__tooltip">GIS Map</span>
        </button>

        {/* Priority Triage List */}
        <button
          className={`nav-sidebar__item ${state.currentView === 'priority' ? 'nav-sidebar__item--active' : ''}`}
          onClick={() => actions.setView('priority')}
          title="Priority Risk Zones Triage"
          aria-label="Priority Zones"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="20" x2="18" y2="10" />
            <line x1="12" y1="20" x2="12" y2="4" />
            <line x1="6" y1="20" x2="6" y2="14" />
          </svg>
          <span className="nav-sidebar__tooltip">Priority List</span>
        </button>

        {/* Citizen Field Reports */}
        <button
          className={`nav-sidebar__item ${state.currentView === 'reports' ? 'nav-sidebar__item--active' : ''}`}
          onClick={() => actions.setView('reports')}
          title="Citizen & Officer Field Reports"
          aria-label="Citizen Reports"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
          {state.reports.length > 0 && (
            <span className="nav-sidebar__chip">{state.reports.length}</span>
          )}
          <span className="nav-sidebar__tooltip">Field Reports</span>
        </button>

        {/* Active Alerts */}
        <button
          className={`nav-sidebar__item ${state.activeModal === 'alerts' ? 'nav-sidebar__item--active' : ''}`}
          onClick={() => actions.openModal('alerts')}
          title="High & Critical Hazard Alerts"
          aria-label="Critical Alerts"
        >
          <div className="nav-sidebar__icon-wrap">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {activeAlertsCount > 0 && (
              <span className="nav-sidebar__alert-dot">{activeAlertsCount}</span>
            )}
          </div>
          <span className="nav-sidebar__tooltip">Active Alerts</span>
        </button>

        {/* Scientific Transparency & Architecture */}
        <button
          className={`nav-sidebar__item ${state.activeModal === 'transparency' ? 'nav-sidebar__item--active' : ''}`}
          onClick={() => actions.openModal('transparency')}
          title="Model Architecture & Data Sources Disclosure"
          aria-label="Transparency"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span className="nav-sidebar__tooltip">Transparency</span>
        </button>
      </nav>

      {/* Bottom Utility Actions */}
      <div className="nav-sidebar__footer">
        {/* Low-Bandwidth Mode Quick Button */}
        <button
          className={`nav-sidebar__item ${state.bandwidthMode ? 'nav-sidebar__item--bandwidth-active' : ''}`}
          onClick={actions.toggleBandwidth}
          title={state.bandwidthMode ? 'Low-Bandwidth Mode Active' : 'Toggle Low-Bandwidth Mode'}
          aria-label="Low-bandwidth GIS mode"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
          <span className="nav-sidebar__tooltip">
            {state.bandwidthMode ? 'Low-BW: ON' : 'Low-BW Mode'}
          </span>
        </button>

        {/* Pipeline / Server Connection Status */}
        <div
          className="nav-sidebar__status-indicator"
          title={`Backend Pipeline: ${state.backendOnline ? 'CONNECTED (Live)' : 'DISCONNECTED'}`}
        >
          <span className={`pulse-dot ${state.backendOnline ? 'pulse-dot--live' : 'pulse-dot--critical'}`} />
        </div>
      </div>
    </aside>
  );
}
