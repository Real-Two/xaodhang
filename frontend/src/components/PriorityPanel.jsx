import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { RISK_META, normalizeRiskLevel } from './RiskCard';

const RISK_COLORS = {
  LOW: '#4CAF50', MODERATE: '#FF9800', HIGH: '#F44336', CRITICAL: '#7B1FA2',
};

/** Glowing score bar — exact spec from fix brief */
function ScoreBar({ score, level }) {
  const color = RISK_COLORS[level] || '#4CAF50';
  const pct = Math.min(100, (score ?? 0) * 100);
  return (
    <div>
      <div className="priority-row__score-label">
        <span>Risk score</span>
        <span className="priority-row__score-value" style={{ color }}>
          {pct.toFixed(1)}%
        </span>
      </div>
      <div className="priority-row__score-bar-track">
        <div
          className="priority-row__score-bar-fill"
          style={{
            width: `${pct}%`,
            background: color,
            boxShadow: pct > 0 ? `0 0 6px ${color}88` : 'none',
          }}
        />
      </div>
    </div>
  );
}

function PriorityRow({ zone, rank, onClick }) {
  const level = normalizeRiskLevel(zone.risk_level);
  const meta = RISK_META[level] || RISK_META.LOW;
  const displayName = zone.zone_name || zone.name || `Zone ${zone.id}`;

  return (
    <button
      className="priority-row"
      onClick={() => onClick(zone)}
      id={`priority-zone-${zone.id}`}
    >
      <span className="priority-row__rank">{rank}</span>

      <div className="priority-row__info">
        <div className="priority-row__name-line">
          <span className="priority-row__name">{displayName}</span>
          <span
            className={`risk-badge ${meta.cls}`}
            style={{ fontSize: 10, padding: '2px 8px' }}
          >
            {meta.label}
          </span>
        </div>
        <ScoreBar score={zone.combined_score} level={level} />
      </div>
    </button>
  );
}

/**
 * PriorityPanel — collapsible left sidebar.
 * Header shows the highest-risk zone (not just a generic count).
 * Zones sorted by combined_score descending.
 */
export default function PriorityPanel({ onZoneClick }) {
  const { state } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');

  const sorted = [...state.zones]
    .sort((a, b) => (b.combined_score ?? 0) - (a.combined_score ?? 0));

  const filtered = sorted.filter(z =>
    !search ||
    (z.zone_name || z.name || '').toLowerCase().includes(search.toLowerCase())
  );

  // Highest risk zone for header
  const topZone = sorted[0];
  const topLevel = topZone ? normalizeRiskLevel(topZone.risk_level) : null;
  const topMeta  = topLevel ? (RISK_META[topLevel] || RISK_META.LOW) : null;
  const topName  = topZone ? (topZone.zone_name || topZone.name || `Zone ${topZone.id}`) : null;

  const lastRefresh = state.lastRefresh
    ? state.lastRefresh.toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    : '—';

  // Risk level summary counts
  const counts = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'].reduce((acc, lvl) => {
    acc[lvl] = state.zones.filter(z => normalizeRiskLevel(z.risk_level) === lvl).length;
    return acc;
  }, {});

  return (
    <aside className={`priority-panel glass-card ${collapsed ? 'priority-panel--collapsed' : ''}`}>

      {/* ── Header ── */}
      <div className="priority-panel__header">
        {!collapsed && (
          <div className="priority-panel__title-block">
            <h2 className="priority-panel__title">Priority Zones</h2>
            <span className="priority-panel__refresh">↻ {lastRefresh}</span>
          </div>
        )}
        <button
          className="btn priority-panel__toggle"
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {!collapsed && (
        <>
          {/* ── Highest risk zone callout ── */}
          {topZone && (
            <div className="priority-panel__top-risk">
              <div className="priority-panel__top-risk-label">Highest risk</div>
              <div className="priority-panel__top-risk-name">
                <span style={{ color: topMeta?.color }}>▲ </span>
                {topName}
                {topMeta && (
                  <span style={{ color: topMeta.color, marginLeft: 6, fontSize: 11 }}>
                    — {topMeta.label}
                  </span>
                )}
              </div>
              <div className="priority-panel__zone-count">
                {state.zones.length} zone{state.zones.length !== 1 ? 's' : ''} monitored
                {counts.CRITICAL > 0 && (
                  <span style={{ color: RISK_COLORS.CRITICAL, marginLeft: 8, fontWeight: 600 }}>
                    ⚠ {counts.CRITICAL} CRITICAL
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ── Risk summary pills ── */}
          <div className="priority-panel__summary">
            {['CRITICAL', 'HIGH', 'MODERATE', 'LOW'].map(level => {
              const count = counts[level];
              if (!count) return null;
              const meta = RISK_META[level];
              return (
                <div key={level} className="priority-panel__summary-item">
                  <span style={{ color: meta.color, fontSize: 15, fontWeight: 700 }}>{count}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{meta.label}</span>
                </div>
              );
            })}
          </div>

          {/* ── Search ── */}
          <div className="priority-panel__search">
            <input
              type="search"
              placeholder="🔍 Search zones…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="divider" style={{ margin: '8px 0' }} />

          {/* ── Zone list ── */}
          <div className="priority-panel__list" role="list">
            {state.zones.length === 0 ? (
              <div className="priority-panel__empty">
                <div className="skeleton" style={{ height: 58, marginBottom: 6 }} />
                <div className="skeleton" style={{ height: 58, marginBottom: 6 }} />
                <div className="skeleton" style={{ height: 58 }} />
                <p style={{ marginTop: 10, color: 'var(--text-muted)', fontSize: 12, textAlign: 'center' }}>
                  Loading zones…
                </p>
              </div>
            ) : filtered.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13, padding: '0 var(--sp-3)' }}>
                No zones match.
              </p>
            ) : (
              filtered.map((zone, i) => (
                <PriorityRow
                  key={zone.id}
                  zone={zone}
                  rank={i + 1}
                  onClick={onZoneClick}
                />
              ))
            )}
          </div>
        </>
      )}
    </aside>
  );
}
