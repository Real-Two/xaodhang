import React, { useCallback, useRef, useState } from 'react';
import { BASE_URL } from '../api/client';
import { useApp } from '../context/AppContext';
import { RISK_META, normalizeRiskLevel } from './RiskCard';

const RISK_ORDER = { CRITICAL: 4, HIGH: 3, MODERATE: 2, LOW: 1 };

// ── Small helpers ─────────────────────────────────────────────────────────────

function RiskBadge({ level }) {
  const meta = RISK_META[level] || RISK_META.LOW;
  return (
    <span className={`badge badge--${level.toLowerCase()}`} style={{ fontSize: 11, padding: '2px 8px' }}>
      {meta.icon} {meta.label}
    </span>
  );
}

function ScoreBar({ score, level }) {
  const meta = RISK_META[level] || RISK_META.LOW;
  const pct  = Math.min(100, (score ?? 0) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, minWidth: 42 }}>
        {pct.toFixed(1)}%
      </span>
      <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--bg-panel)' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: meta.color, boxShadow: `0 0 6px ${meta.color}88` }} />
      </div>
    </div>
  );
}

// ── Scan status strip ─────────────────────────────────────────────────────────

function ScanStatusBar({ status, progress, total, elapsed }) {
  if (status === 'idle') return null;

  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
  const isRunning = status === 'scanning';

  return (
    <div style={{
      background: 'var(--bg-panel)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--r-md)',
      padding: 'var(--sp-3) var(--sp-4)',
      marginBottom: 'var(--sp-4)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isRunning && (
            <span style={{
              width: 8, height: 8, borderRadius: '50%',
              background: 'var(--brand-orange)',
              boxShadow: '0 0 8px var(--brand-orange)',
              display: 'inline-block',
              animation: 'pulse 1.2s infinite',
            }} />
          )}
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {status === 'scanning' && `Scanning NER region… ${progress} / ${total} points`}
            {status === 'complete' && `Scan complete — ${progress} points processed in ${elapsed}s`}
            {status === 'error'    && 'Scan encountered an error'}
          </span>
        </div>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pct}%</span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--bg-deep)' }}>
        <div style={{
          height: '100%', borderRadius: 2,
          width: `${pct}%`,
          background: status === 'complete' ? 'var(--risk-low)' : 'var(--brand-orange)',
          transition: 'width 0.3s ease',
          boxShadow: isRunning ? '0 0 8px var(--brand-orange)' : 'none',
        }} />
      </div>
    </div>
  );
}

// ── State summary cards ───────────────────────────────────────────────────────

function StateSummary({ results }) {
  const byState = {};
  results.forEach(r => {
    const s = r.state || 'Unknown';
    if (!byState[s]) byState[s] = { total: 0, maxScore: 0, maxLevel: 'LOW' };
    byState[s].total++;
    if (r.combined_score > byState[s].maxScore) {
      byState[s].maxScore = r.combined_score;
      byState[s].maxLevel = normalizeRiskLevel(r.risk_level);
    }
  });

  const states = Object.entries(byState).sort(
    (a, b) => b[1].maxScore - a[1].maxScore
  );

  if (states.length === 0) return null;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
      gap: 'var(--sp-2)',
      marginBottom: 'var(--sp-4)',
    }}>
      {states.map(([state, info]) => {
        const meta = RISK_META[info.maxLevel] || RISK_META.LOW;
        return (
          <div key={state} className="glass-card" style={{
            padding: 'var(--sp-3)',
            borderLeft: `3px solid ${meta.color}`,
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              {state}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6 }}>
              {info.total} point{info.total !== 1 ? 's' : ''} scanned
            </div>
            <span className={`badge badge--${info.maxLevel.toLowerCase()}`} style={{ fontSize: 10, padding: '1px 6px' }}>
              {meta.icon} {meta.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main ScanView component ───────────────────────────────────────────────────

export default function ScanView({ onLocateOnMap }) {
  const { actions } = useApp();

  const [scanStatus,   setScanStatus]   = useState('idle');   // idle | scanning | complete | error
  const [results,      setResults]      = useState([]);
  const [progress,     setProgress]     = useState(0);
  const [total,        setTotal]        = useState(0);
  const [elapsed,      setElapsed]      = useState(0);
  const [sortKey,      setSortKey]      = useState('combined_score');
  const [sortOrder,    setSortOrder]    = useState('desc');
  const [filterLevel,  setFilterLevel]  = useState('ALL');
  const [filterState,  setFilterState]  = useState('ALL');
  const [cachedCount,  setCachedCount]  = useState(0);

  const abortRef = useRef(null);

  // ── Start scan ──────────────────────────────────────────────────────────────

  const startScan = useCallback(async () => {
    // Abort any running scan
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setResults([]);
    setProgress(0);
    setTotal(0);
    setElapsed(0);
    setCachedCount(0);
    setScanStatus('scanning');

    try {
      const response = await fetch(`${BASE_URL}/scan/ner/stream`, {
        signal: abortRef.current.signal,
      });

      if (!response.ok) throw new Error(`Stream failed: ${response.status}`);

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let   buffer  = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE format: "data: {...}\n\n"
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';   // keep incomplete trailing chunk

        for (const part of parts) {
          const line = part.trim();
          if (!line.startsWith('data:')) continue;
          try {
            const event = JSON.parse(line.slice(5).trim());
            handleSseEvent(event);
          } catch (_) {
            // malformed JSON — skip
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error('[ScanView] SSE error:', err);
      setScanStatus('error');
    }
  }, []);

  const handleSseEvent = useCallback((event) => {
    switch (event.type) {
      case 'start':
        setTotal(event.total);
        break;

      case 'result':
        setResults(prev => {
          const next = [...prev, event];
          next.sort((a, b) =>
            (RISK_ORDER[normalizeRiskLevel(b.risk_level)] - RISK_ORDER[normalizeRiskLevel(a.risk_level)]) ||
            (b.combined_score - a.combined_score)
          );
          return next;
        });
        setProgress(p => p + 1);
        if (event.cached) setCachedCount(c => c + 1);
        break;

      case 'skip':
        setProgress(p => p + 1);
        break;

      case 'complete':
        setScanStatus('complete');
        setElapsed(event.elapsed_s);
        break;

      default:
        break;
    }
  }, []);

  const stopScan = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setScanStatus('idle');
  }, []);

  // ── Export CSV ──────────────────────────────────────────────────────────────

  const exportCSV = useCallback(() => {
    const headers = ['State', 'Name', 'Lat', 'Lon', 'Risk Level', 'Combined Score', 'Terrain Risk', '72h Rainfall (mm)', 'Cached'];
    const rows = sortedFiltered.map(r => [
      r.state,
      `"${r.name}"`,
      r.lat,
      r.lon,
      normalizeRiskLevel(r.risk_level),
      ((r.combined_score ?? 0) * 100).toFixed(1) + '%',
      ((r.structural_risk ?? 0) * 100).toFixed(1) + '%',
      (r.rainfall_mm_72h ?? 0).toFixed(0),
      r.cached ? 'yes' : 'no',
    ]);
    const csv = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(csv));
    link.setAttribute('download', `ner_scan_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [results]);  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Filtering & sorting ─────────────────────────────────────────────────────

  const allStates = [...new Set(results.map(r => r.state).filter(Boolean))].sort();

  const sortedFiltered = [...results]
    .filter(r => filterLevel === 'ALL' || normalizeRiskLevel(r.risk_level) === filterLevel)
    .filter(r => filterState === 'ALL' || r.state === filterState)
    .sort((a, b) => {
      let va = a[sortKey] ?? 0;
      let vb = b[sortKey] ?? 0;
      return sortOrder === 'desc' ? vb - va : va - vb;
    });

  const handleSort = (key) => {
    if (sortKey === key) setSortOrder(o => o === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortOrder('desc'); }
  };

  // Counts for summary bar
  const counts = {
    CRITICAL: results.filter(r => normalizeRiskLevel(r.risk_level) === 'CRITICAL').length,
    HIGH:     results.filter(r => normalizeRiskLevel(r.risk_level) === 'HIGH').length,
    MODERATE: results.filter(r => normalizeRiskLevel(r.risk_level) === 'MODERATE').length,
    LOW:      results.filter(r => normalizeRiskLevel(r.risk_level) === 'LOW').length,
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="priority-view animate-fade">
      {/* ── Page header ──────────────────────────────────────────────────────── */}
      <div className="priority-view__header">
        <div className="priority-view__header-left">
          <h1 className="priority-view__title">NER Regional Landslide Scan</h1>
          <p className="priority-view__subtitle" style={{ maxWidth: 640 }}>
            Runs the full GEE → UNet → CHIRPS pipeline across a ~0.5° grid covering all 8
            Northeast Indian states (~120 points). Results stream in live, sorted by severity.
            Cached zones return instantly; new points take 5–10s each.
          </p>
        </div>
        <div className="priority-view__header-actions" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {results.length > 0 && scanStatus !== 'scanning' && (
            <button className="btn-secondary" onClick={exportCSV}>
              📥 Export CSV
            </button>
          )}
          {scanStatus === 'scanning' ? (
            <button
              className="btn-secondary"
              onClick={stopScan}
              style={{ borderColor: 'var(--risk-high)', color: 'var(--risk-high)' }}
            >
              ⬛ Stop Scan
            </button>
          ) : (
            <button
              className="btn-primary"
              onClick={startScan}
              style={{
                background: 'var(--brand-orange)',
                color: '#fff',
                border: 'none',
                padding: '10px 20px',
                borderRadius: 'var(--r-md)',
                fontWeight: 700,
                fontSize: 14,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 0 16px rgba(232,119,34,0.35)',
              }}
            >
              <span style={{ fontSize: 16 }}>🛰</span>
              {results.length > 0 ? 'Re-Scan NER' : 'Scan NER Region'}
            </button>
          )}
        </div>
      </div>

      {/* ── Idle state — call to action ───────────────────────────────────────── */}
      {scanStatus === 'idle' && results.length === 0 && (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          flex: 1, gap: 'var(--sp-4)', padding: 'var(--sp-8) 0', color: 'var(--text-muted)',
        }}>
          <div style={{ fontSize: 56, opacity: 0.3 }}>🛰</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 8 }}>
              No scan has been run yet
            </div>
            <div style={{ fontSize: 13, maxWidth: 420, lineHeight: 1.6 }}>
              Click <strong>Scan NER Region</strong> to run the pipeline across all ~120 grid
              points covering Assam, Meghalaya, Manipur, Mizoram, Nagaland, Tripura,
              Arunachal Pradesh and Sikkim. Results will populate below as they arrive.
            </div>
          </div>
        </div>
      )}

      {/* ── Progress bar ─────────────────────────────────────────────────────── */}
      <ScanStatusBar
        status={scanStatus}
        progress={progress}
        total={total}
        elapsed={elapsed}
      />

      {/* ── Results section ──────────────────────────────────────────────────── */}
      {results.length > 0 && (
        <>
          {/* Summary stat cards */}
          <div className="priority-view__stats-grid" style={{ marginBottom: 'var(--sp-3)' }}>
            {[
              { key: 'CRITICAL', label: 'Critical', hint: 'Immediate action', color: 'var(--risk-critical)' },
              { key: 'HIGH',     label: 'High',     hint: 'Alert issued',      color: 'var(--risk-high)' },
              { key: 'MODERATE', label: 'Moderate', hint: 'Elevated watch',    color: 'var(--risk-moderate)' },
              { key: 'LOW',      label: 'Low',      hint: 'Routine monitor',   color: 'var(--risk-low)' },
            ].map(({ key, label, hint, color }) => (
              <div
                key={key}
                className={`priority-stat-card glass-card ${filterLevel === key ? 'priority-stat-card--active' : ''}`}
                style={{ borderLeft: `3px solid ${color}`, cursor: 'pointer' }}
                onClick={() => setFilterLevel(f => f === key ? 'ALL' : key)}
              >
                <span className="priority-stat-card__label">{label} Risk Zones</span>
                <div className="priority-stat-card__val" style={{ color }}>{counts[key]}</div>
                <span className="priority-stat-card__hint">{hint}</span>
              </div>
            ))}
          </div>

          {/* Per-state breakdown */}
          <StateSummary results={results} />

          {/* Filter + sort controls */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 'var(--sp-3)', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {sortedFiltered.length} of {results.length} points shown
              {cachedCount > 0 && ` · ${cachedCount} from cache`}
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <select
                value={filterState}
                onChange={e => setFilterState(e.target.value)}
                style={{
                  background: 'var(--bg-panel)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', borderRadius: 'var(--r-sm)',
                  padding: '4px 8px', fontSize: 12, cursor: 'pointer',
                }}
              >
                <option value="ALL">All states</option>
                {allStates.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select
                value={filterLevel}
                onChange={e => setFilterLevel(e.target.value)}
                style={{
                  background: 'var(--bg-panel)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', borderRadius: 'var(--r-sm)',
                  padding: '4px 8px', fontSize: 12, cursor: 'pointer',
                }}
              >
                <option value="ALL">All levels</option>
                <option value="CRITICAL">Critical</option>
                <option value="HIGH">High</option>
                <option value="MODERATE">Moderate</option>
                <option value="LOW">Low</option>
              </select>
            </div>
          </div>

          {/* Results table */}
          <div className="priority-table-wrap glass-panel">
            <table className="priority-table">
              <thead>
                <tr>
                  <th style={{ width: 50 }}>Rank</th>
                  <th>Location</th>
                  <th>State</th>
                  <th>Severity</th>
                  <th
                    className="priority-table__sortable"
                    onClick={() => handleSort('combined_score')}
                    style={{ width: 180 }}
                  >
                    Combined Risk {sortKey === 'combined_score' ? (sortOrder === 'desc' ? '▼' : '▲') : ''}
                  </th>
                  <th
                    className="priority-table__sortable"
                    onClick={() => handleSort('structural_risk')}
                  >
                    Terrain {sortKey === 'structural_risk' ? (sortOrder === 'desc' ? '▼' : '▲') : ''}
                  </th>
                  <th
                    className="priority-table__sortable"
                    onClick={() => handleSort('rainfall_mm_72h')}
                  >
                    72h Rain {sortKey === 'rainfall_mm_72h' ? (sortOrder === 'desc' ? '▼' : '▲') : ''}
                  </th>
                  <th style={{ width: 80 }}>Source</th>
                  <th style={{ width: 80 }}>Map</th>
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="priority-table__empty">
                      No results match the current filter.
                    </td>
                  </tr>
                ) : (
                  sortedFiltered.map((row, idx) => {
                    const level = normalizeRiskLevel(row.risk_level);
                    const meta  = RISK_META[level] || RISK_META.LOW;
                    return (
                      <tr key={`${row.lat}-${row.lon}`} className="priority-table__row">
                        <td className="priority-table__rank">#{idx + 1}</td>
                        <td className="priority-table__name">
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{row.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                            {row.lat?.toFixed(3)}°N, {row.lon?.toFixed(3)}°E
                          </div>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{row.state}</td>
                        <td><RiskBadge level={level} /></td>
                        <td>
                          <ScoreBar score={row.combined_score} level={level} />
                        </td>
                        <td>
                          <span style={{
                            fontSize: 12, fontWeight: 600,
                            color: row.structural_risk > 0.65 ? 'var(--risk-high)' : 'var(--text-secondary)',
                          }}>
                            {((row.structural_risk ?? 0) * 100).toFixed(1)}%
                          </span>
                        </td>
                        <td>
                          <span style={{
                            fontSize: 12,
                            color: row.rainfall_mm_72h > 60 ? 'var(--brand-orange)' : 'var(--text-secondary)',
                          }}>
                            {(row.rainfall_mm_72h ?? 0).toFixed(0)} mm
                          </span>
                        </td>
                        <td>
                          <span style={{
                            fontSize: 10, padding: '2px 6px', borderRadius: 99,
                            background: row.cached ? 'rgba(76,175,80,0.15)' : 'rgba(232,119,34,0.15)',
                            color: row.cached ? 'var(--risk-low)' : 'var(--brand-orange)',
                            fontWeight: 600,
                          }}>
                            {row.cached ? 'cached' : 'live'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="priority-table__btn priority-table__btn--map"
                            title="Locate on GIS map"
                            onClick={() => {
                              actions.setView('map');
                              onLocateOnMap?.({ lat: row.lat, lon: row.lon, zone_name: row.name, ...row });
                            }}
                          >
                            Map ↗
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
