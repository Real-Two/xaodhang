import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { RISK_META, normalizeRiskLevel } from './RiskCard';

/**
 * PriorityView — Full-screen triage table & priority dashboard.
 * Sorted by combined_score descending.
 */
export default function PriorityView({ onInspectZone, onLocateOnMap }) {
  const { state, actions } = useApp();
  const [sortKey, setSortKey] = useState('combined_score');
  const [sortOrder, setSortOrder] = useState('desc');

  // Filter and sort zones
  const filteredZones = useMemo(() => {
    return state.zones.filter(z => {
      const lvl = normalizeRiskLevel(z.risk_level);
      if (state.filterLevel !== 'ALL' && lvl !== state.filterLevel) {
        return false;
      }
      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        const name = (z.zone_name || z.name || '').toLowerCase();
        const id = String(z.id || '');
        return name.includes(q) || id.includes(q);
      }
      return true;
    });
  }, [state.zones, state.filterLevel, state.searchQuery]);

  const sortedZones = useMemo(() => {
    return [...filteredZones].sort((a, b) => {
      let valA = a[sortKey] ?? 0;
      let valB = b[sortKey] ?? 0;
      if (sortOrder === 'desc') return valB - valA;
      return valA - valB;
    });
  }, [filteredZones, sortKey, sortOrder]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortOrder(o => o === 'desc' ? 'asc' : 'desc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  const exportCSV = () => {
    const headers = ['ID', 'Zone Name', 'Latitude', 'Longitude', 'Risk Level', 'Combined Score', 'Terrain Susceptibility', '72h Rainfall'];
    const rows = sortedZones.map(z => [
      z.id,
      `"${z.zone_name || z.name || 'Zone ' + z.id}"`,
      z.lat,
      z.lon,
      normalizeRiskLevel(z.risk_level),
      ((z.combined_score ?? 0) * 100).toFixed(1) + '%',
      ((z.structural_risk ?? 0) * 100).toFixed(1) + '%',
      (z.rainfall_mm_72h ?? z.rainfall_72h ?? ((z.rainfall_risk ?? 0) * 150)).toFixed(0) + ' mm'
    ]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `redberyl_landslide_priorities_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="priority-view animate-fade">
      {/* Header Bar */}
      <div className="priority-view__header">
        <div className="priority-view__header-left">
          <h1 className="priority-view__title">Landslide Hazard Priority Triage</h1>
          <p className="priority-view__subtitle">
            Ranked monitoring list ordered by multi-criteria risk index (DeepLabv3+ Terrain Susceptibility × CHIRPS Precipitation Trigger).
          </p>
        </div>
        <div className="priority-view__header-actions">
          <button className="btn-secondary" onClick={exportCSV}>
            <span>📥 Export CSV Report</span>
          </button>
        </div>
      </div>

      {/* Triage Summary Stats */}
      <div className="priority-view__stats-grid">
        <div className="priority-stat-card glass-card" style={{ borderLeft: '3px solid var(--risk-critical)' }}>
          <span className="priority-stat-card__label">Critical Risk Zones</span>
          <div className="priority-stat-card__val" style={{ color: 'var(--risk-critical)' }}>
            {state.zones.filter(z => normalizeRiskLevel(z.risk_level) === 'CRITICAL').length}
          </div>
          <span className="priority-stat-card__hint">Immediate evacuation watch</span>
        </div>

        <div className="priority-stat-card glass-card" style={{ borderLeft: '3px solid var(--risk-high)' }}>
          <span className="priority-stat-card__label">High Risk Zones</span>
          <div className="priority-stat-card__val" style={{ color: 'var(--risk-high)' }}>
            {state.zones.filter(z => normalizeRiskLevel(z.risk_level) === 'HIGH').length}
          </div>
          <span className="priority-stat-card__hint">Highway & slope alert</span>
        </div>

        <div className="priority-stat-card glass-card" style={{ borderLeft: '3px solid var(--risk-moderate)' }}>
          <span className="priority-stat-card__label">Moderate Zones</span>
          <div className="priority-stat-card__val" style={{ color: 'var(--risk-moderate)' }}>
            {state.zones.filter(z => normalizeRiskLevel(z.risk_level) === 'MODERATE').length}
          </div>
          <span className="priority-stat-card__hint">Heightened rainfall watch</span>
        </div>

        <div className="priority-stat-card glass-card" style={{ borderLeft: '3px solid var(--risk-low)' }}>
          <span className="priority-stat-card__label">Total Monitored</span>
          <div className="priority-stat-card__val" style={{ color: 'var(--text-primary)' }}>
            {state.zones.length}
          </div>
          <span className="priority-stat-card__hint">Active NER telemetry points</span>
        </div>
      </div>

      {/* Zones Table */}
      <div className="priority-table-wrap glass-panel">
        <table className="priority-table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>Rank</th>
              <th onClick={() => handleSort('zone_name')} className="priority-table__sortable">
                Zone / Critical Corridor {sortKey === 'zone_name' ? (sortOrder === 'desc' ? '▼' : '▲') : ''}
              </th>
              <th>Coordinates</th>
              <th>Severity</th>
              <th onClick={() => handleSort('combined_score')} className="priority-table__sortable" style={{ width: 180 }}>
                Combined Risk Index {sortKey === 'combined_score' ? (sortOrder === 'desc' ? '▼' : '▲') : ''}
              </th>
              <th onClick={() => handleSort('structural_risk')} className="priority-table__sortable">
                Terrain Susceptibility {sortKey === 'structural_risk' ? (sortOrder === 'desc' ? '▼' : '▲') : ''}
              </th>
              <th>72h Rainfall</th>
              <th style={{ width: 140 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedZones.length === 0 ? (
              <tr>
                <td colSpan="8" className="priority-table__empty">
                  No zones match the current search / filter criteria.
                </td>
              </tr>
            ) : (
              sortedZones.map((zone, idx) => {
                const level = normalizeRiskLevel(zone.risk_level);
                const meta = RISK_META[level] || RISK_META.LOW;
                const displayName = zone.zone_name || zone.name || `Zone ${zone.id}`;
                const combinedScore = (zone.combined_score ?? 0) * 100;
                const structScore = (zone.structural_risk ?? 0) * 100;
                const rainMm = zone.rainfall_mm_72h ?? zone.rainfall_72h ?? Math.round((zone.rainfall_risk ?? 0) * 150);

                return (
                  <tr key={zone.id || idx} className="priority-table__row" onClick={() => onInspectZone(zone)}>
                    <td className="priority-table__rank">#{idx + 1}</td>
                    <td className="priority-table__name">
                      <strong>{displayName}</strong>
                    </td>
                    <td className="priority-table__coords">
                      {zone.lat?.toFixed(3)}°N, {zone.lon?.toFixed(3)}°E
                    </td>
                    <td>
                      <span className={`badge badge--${level.toLowerCase()}`}>
                        {meta.icon} {meta.label}
                      </span>
                    </td>
                    <td>
                      <div className="priority-table__score-cell">
                        <span className="priority-table__score-num" style={{ color: meta.color }}>
                          {combinedScore.toFixed(1)}%
                        </span>
                        <div className="priority-table__bar-track">
                          <div
                            className="priority-table__bar-fill"
                            style={{
                              width: `${combinedScore}%`,
                              background: meta.color,
                              boxShadow: `0 0 8px ${meta.color}66`
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, color: structScore > 65 ? 'var(--risk-critical)' : 'var(--text-secondary)' }}>
                        {structScore.toFixed(1)}%
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 6 }}>DeepLabv3+</span>
                    </td>
                    <td>
                      <span style={{ color: rainMm > 60 ? 'var(--brand-orange)' : 'var(--text-secondary)' }}>
                        {rainMm.toFixed(0)} mm
                      </span>
                    </td>
                    <td>
                      <div className="priority-table__actions" onClick={e => e.stopPropagation()}>
                        <button
                          className="priority-table__btn"
                          title="Inspect full diagnostic signals"
                          onClick={() => onInspectZone(zone)}
                        >
                          Inspect
                        </button>
                        <button
                          className="priority-table__btn priority-table__btn--map"
                          title="Locate on GIS Map"
                          onClick={() => {
                            actions.setView('map');
                            onLocateOnMap(zone);
                          }}
                        >
                          Map ↗
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
