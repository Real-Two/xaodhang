import React, { useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { pingBackend } from '../api/client';

/**
 * StatusBar — thin top bar showing backend status and last refresh time.
 * Pulses red when backend has been unreachable for >30s.
 */
export default function StatusBar() {
  const { state, actions } = useApp();
  const { backendOnline, lastRefresh, zones } = state;
  const offlineSince = useRef(null);

  // Track continuous offline duration
  useEffect(() => {
    if (backendOnline === false) {
      if (!offlineSince.current) offlineSince.current = Date.now();
    } else {
      offlineSince.current = null;
    }
  }, [backendOnline]);

  const lastRefreshStr = lastRefresh
    ? lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : 'Never';

  const isOnline = backendOnline === true;
  const isOffline = backendOnline === false;
  const isUnknown = backendOnline === null;

  const criticalCount = zones.filter(z =>
    (z.risk_level || '').toUpperCase() === 'CRITICAL'
  ).length;

  return (
    <div className={`status-bar ${isOffline ? 'status-bar--offline' : ''}`} role="status">
      <div className="status-bar__left">
        {/* Logo wordmark */}
        <span className="status-bar__brand">🔴 RedBeryl EWS</span>
        <span className="status-bar__divider" />
        <span className="status-bar__region">Northeast India · MDoNER SIH 2026</span>
      </div>

      <div className="status-bar__center">
        {criticalCount > 0 && (
          <span className="status-bar__alert risk-critical">
            ⚠ {criticalCount} CRITICAL zone{criticalCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="status-bar__right">
        <span className="status-bar__refresh">
          ↻ {lastRefreshStr}
        </span>
        <span className="status-bar__divider" />
        <span className={`status-bar__dot ${isOnline ? 'online' : isOffline ? 'offline' : 'unknown'}`} />
        <span className="status-bar__status-text">
          {isOnline ? 'Backend live' : isOffline ? 'Backend offline' : 'Connecting…'}
        </span>
      </div>
    </div>
  );
}
