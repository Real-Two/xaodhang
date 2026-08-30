import React from 'react';
import { useApp } from '../context/AppContext';

/**
 * BandwidthToggle — floating button to toggle low-bandwidth mode.
 * When ON: disables heatmap auto-load, shows vector layers only.
 */
export default function BandwidthToggle() {
  const { state, actions } = useApp();
  const { bandwidthMode } = state;

  return (
    <button
      id="bandwidth-toggle"
      className={`btn bandwidth-toggle ${bandwidthMode ? 'bandwidth-toggle--active' : ''}`}
      onClick={actions.toggleBandwidth}
      title={bandwidthMode ? 'Low-bandwidth mode ON — imagery hidden' : 'Switch to low-bandwidth mode'}
      aria-pressed={bandwidthMode}
    >
      <span className="bandwidth-toggle__icon">
        {bandwidthMode ? '📵' : '🛰'}
      </span>
      <span className="bandwidth-toggle__label">
        {bandwidthMode ? 'Low-BW' : 'Full'}
      </span>
    </button>
  );
}
