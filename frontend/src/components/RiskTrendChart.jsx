import React, { useEffect, useState, useCallback } from 'react';
import { BASE_URL } from '../api/client';

const RISK_COLORS = {
  LOW:      '#4CAF50',
  MODERATE: '#FF9800',
  HIGH:     '#F44336',
  CRITICAL: '#7B1FA2',
};

const LEVEL_ORDER = { LOW: 0, MODERATE: 1, HIGH: 2, CRITICAL: 3 };

function normalizeLevel(level) {
  const l = (level || '').toUpperCase().trim();
  return ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(l) ? l : 'LOW';
}

/**
 * Mini sparkline drawn in SVG — no external charting library.
 * Renders the combined_score time-series for the last N readings.
 */
function Sparkline({ data, width = 280, height = 72 }) {
  if (!data || data.length < 2) return null;

  const scores = data.map(d => d.combined_score);
  const minV = Math.min(...scores);
  const maxV = Math.max(...scores);
  const range = maxV - minV || 0.01;

  const pad = { top: 8, right: 6, bottom: 8, left: 6 };
  const W = width - pad.left - pad.right;
  const H = height - pad.top - pad.bottom;

  const toX = (i) => pad.left + (i / (data.length - 1)) * W;
  const toY = (v) => pad.top + H - ((v - minV) / range) * H;

  const linePath = data
    .map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i).toFixed(1)},${toY(d.combined_score).toFixed(1)}`)
    .join(' ');

  const areaPath =
    `M${toX(0).toFixed(1)},${(pad.top + H).toFixed(1)} ` +
    data.map((d, i) => `L${toX(i).toFixed(1)},${toY(d.combined_score).toFixed(1)}`).join(' ') +
    ` L${toX(data.length - 1).toFixed(1)},${(pad.top + H).toFixed(1)} Z`;

  const lastScore = scores[scores.length - 1];
  const lastColor = RISK_COLORS[normalizeLevel(data[data.length - 1]?.risk_level)] || '#4CAF50';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lastColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lastColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Faint horizontal gridlines at 25%, 50%, 75% of score range */}
      {[0.25, 0.5, 0.75].map(frac => {
        const y = pad.top + H - frac * H;
        return (
          <line
            key={frac}
            x1={pad.left} y1={y} x2={pad.left + W} y2={y}
            stroke="var(--border)" strokeWidth="0.5" strokeDasharray="3,3"
          />
        );
      })}

      {/* Area fill */}
      <path d={areaPath} fill="url(#spark-fill)" />

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke={lastColor}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />

      {/* Last point dot */}
      <circle
        cx={toX(data.length - 1)}
        cy={toY(lastScore)}
        r="3.5"
        fill={lastColor}
        stroke="var(--bg-deep)"
        strokeWidth="1.5"
      />
    </svg>
  );
}

/**
 * RiskTrendChart
 *
 * Props:
 *   zoneId   — number | null
 *   zoneName — string
 *
 * Fetches GET /history/{zoneId}?limit=28 (7 days × 4 readings/day)
 * and renders a sparkline + summary row.
 */
export default function RiskTrendChart({ zoneId, zoneName }) {
  const [data,    setData]    = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const fetchHistory = useCallback(async () => {
    if (!zoneId) return;
    setLoading(true);
    setError(null);
    try {
      const [histRes, sumRes] = await Promise.all([
        fetch(`${BASE_URL}/history/${zoneId}?limit=28`, { cache: 'no-store' }),
        fetch(`${BASE_URL}/history/${zoneId}/summary?days=7`, { cache: 'no-store' }),
      ]);

      if (!histRes.ok) throw new Error(`History fetch failed: ${histRes.status}`);

      const histJson = await histRes.json();
      setData(histJson);

      if (sumRes.ok) {
        setSummary(await sumRes.json());
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [zoneId]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!zoneId) return null;

  const trendIcon = {
    rising:  '↑',
    falling: '↓',
    stable:  '→',
  }[summary?.trend] ?? '→';

  const trendColor = {
    rising:  'var(--risk-high)',
    falling: 'var(--risk-low)',
    stable:  'var(--text-muted)',
  }[summary?.trend] ?? 'var(--text-muted)';

  const latestLevel = normalizeLevel(summary?.latest_level || data[data.length - 1]?.risk_level);
  const latestColor = RISK_COLORS[latestLevel];

  return (
    <div className="risk-trend-chart glass-card" style={{
      padding: 'var(--sp-4)',
      marginTop: 'var(--sp-3)',
      borderRadius: 'var(--r-lg)',
      border: '1px solid var(--border)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--sp-2)' }}>
        <div>
          <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            7-Day Risk Trend
          </span>
          {summary && (
            <span style={{ fontSize: 11, color: trendColor, marginLeft: 8, fontWeight: 700 }}>
              {trendIcon} {summary.trend}
            </span>
          )}
        </div>
        <button
          onClick={fetchHistory}
          title="Refresh trend data"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--text-muted)', fontSize: 13, padding: '2px 6px',
            borderRadius: 'var(--r-sm)',
          }}
        >
          ↻
        </button>
      </div>

      {/* Chart body */}
      {loading && (
        <div style={{ height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Loading trend data…</span>
        </div>
      )}

      {error && !loading && (
        <div style={{ height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--risk-moderate)' }}>No history available yet.</span>
        </div>
      )}

      {!loading && !error && data.length < 2 && (
        <div style={{ height: 72, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Not enough data — history builds over time as the pipeline runs.
          </span>
        </div>
      )}

      {!loading && !error && data.length >= 2 && (
        <Sparkline data={data} height={72} />
      )}

      {/* Summary stats */}
      {summary && summary.readings > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--sp-2)', marginTop: 'var(--sp-3)',
          borderTop: '1px solid var(--border)', paddingTop: 'var(--sp-3)',
        }}>
          {[
            { label: 'Readings', value: summary.readings },
            { label: 'Min', value: `${(summary.min_score * 100).toFixed(0)}%` },
            { label: 'Avg', value: `${(summary.avg_score * 100).toFixed(0)}%` },
            { label: 'Max', value: `${(summary.max_score * 100).toFixed(0)}%`, color: summary.max_score > 0.65 ? 'var(--risk-high)' : undefined },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: color || 'var(--text-primary)' }}>{value}</div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Current level badge */}
      {latestLevel && !loading && data.length > 0 && (
        <div style={{ marginTop: 'var(--sp-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
            padding: '2px 8px', borderRadius: 99,
            background: `${latestColor}22`, color: latestColor,
            border: `1px solid ${latestColor}55`,
          }}>
            {latestLevel}
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            latest level · {data.length} reading{data.length !== 1 ? 's' : ''} stored
          </span>
        </div>
      )}
    </div>
  );
}
