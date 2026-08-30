import React from 'react';
import { useApp } from '../context/AppContext';
import { RISK_META, normalizeRiskLevel } from './RiskCard';

/**
 * AlertsDrawer — Active high & critical hazard alert center.
 * Shows high-priority warning bulletins for disaster management officers.
 */
export default function AlertsDrawer({ onLocateZone }) {
  const { state, actions } = useApp();

  if (state.activeModal !== 'alerts') return null;

  const alertZones = state.zones.filter(z => {
    const lvl = normalizeRiskLevel(z.risk_level);
    return lvl === 'CRITICAL' || lvl === 'HIGH';
  }).sort((a, b) => (b.combined_score ?? 0) - (a.combined_score ?? 0));

  return (
    <div className="modal-backdrop" onClick={actions.closeModal}>
      <div className="alerts-modal glass-panel animate-fade" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="alerts-modal__header">
          <div className="alerts-modal__title-row">
            <span className="alerts-modal__bell">🚨</span>
            <div>
              <h2 className="alerts-modal__title">Active Landslide Warning Alerts</h2>
              <span className="alerts-modal__subtitle">
                Corridors requiring immediate slope stability monitoring and vehicular caution.
              </span>
            </div>
          </div>
          <button className="zone-drawer__close" onClick={actions.closeModal}>✕</button>
        </div>

        {/* List */}
        <div className="alerts-modal__body">
          {alertZones.length === 0 ? (
            <div className="alerts-modal__empty">
              <span style={{ fontSize: 32 }}>🛡️</span>
              <h3>No Critical or High Hazard Warnings</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>
                All monitored zones are currently operating within Low to Moderate baseline thresholds.
              </p>
            </div>
          ) : (
            <div className="alerts-modal__list">
              {alertZones.map((zone, i) => {
                const level = normalizeRiskLevel(zone.risk_level);
                const meta = RISK_META[level] || RISK_META.HIGH;
                const displayName = zone.zone_name || zone.name || `Zone ${zone.id}`;
                const combinedPct = ((zone.combined_score ?? 0) * 100).toFixed(1);
                const rainMm = zone.rainfall_mm_72h ?? zone.rainfall_72h ?? Math.round((zone.rainfall_risk ?? 0) * 150);

                return (
                  <div
                    key={zone.id || i}
                    className="alert-item glass-card"
                    style={{ borderLeft: `4px solid ${meta.color}` }}
                  >
                    <div className="alert-item__header">
                      <div className="alert-item__title-wrap">
                        <span className={`badge badge--${level.toLowerCase()}`}>
                          {meta.icon} {meta.label} SEVERITY
                        </span>
                        <h3 className="alert-item__name">{displayName}</h3>
                      </div>
                      <span className="alert-item__score" style={{ color: meta.color }}>
                        {combinedPct}% Risk
                      </span>
                    </div>

                    <p className="alert-item__desc">
                      Terrain susceptibility ({((zone.structural_risk ?? 0) * 100).toFixed(0)}%) compounded by {rainMm} mm cumulative rainfall threshold over 72 hours.
                    </p>

                    <div className="alert-item__footer">
                      <span className="alert-item__coords">
                        📍 {zone.lat?.toFixed(3)}°N, {zone.lon?.toFixed(3)}°E
                      </span>
                      <div className="alert-item__actions">
                        <button
                          className="btn-secondary"
                          style={{ fontSize: 11, padding: '4px 10px' }}
                          onClick={() => {
                            actions.closeModal();
                            actions.setSelectedZone(zone);
                          }}
                        >
                          Diagnostic Signals
                        </button>
                        <button
                          className="btn-primary"
                          style={{ fontSize: 11, padding: '4px 10px' }}
                          onClick={() => {
                            actions.closeModal();
                            actions.setView('map');
                            onLocateZone(zone);
                          }}
                        >
                          View on Map ↗
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
