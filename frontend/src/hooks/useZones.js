import { useEffect, useRef } from 'react';
import { getRiskAll, pingBackend } from '../api/client';
import { useApp } from '../context/AppContext';

const POLL_INTERVAL_MS = 60_000; // refresh risk data every 60s

/**
 * useZones — fetches GET /risk/all on mount and polls every 60s.
 *
 * /risk/all returns all zones with real combined_score, risk_level,
 * structural_risk, and rainfall_risk already computed by risk_engine.py.
 * No client-side enrichment needed.
 */
export function useZones() {
  const { actions } = useApp();
  const timerRef = useRef(null);

  async function fetchZones() {
    try {
      const alive = await pingBackend();
      actions.setBackendStatus(alive);
      if (!alive) return;

      const raw = await getRiskAll();
      const zones = Array.isArray(raw) ? raw : [];

      if (zones.length > 0) {
        console.log('[RedBeryl] GET /risk/all — first zone:', zones[0]);
        console.log('[RedBeryl] Top 5 by risk:',
          zones.slice(0, 5).map(z => ({
            name: z.zone_name || z.name,
            level: z.risk_level,
            score: z.combined_score?.toFixed(3),
          }))
        );
      }

      actions.setZones(zones);
    } catch (err) {
      console.warn('[useZones] fetch error:', err);
      actions.setBackendStatus(false);
    }
  }

  useEffect(() => {
    fetchZones();
    timerRef.current = setInterval(fetchZones, POLL_INTERVAL_MS);
    return () => clearInterval(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { refresh: fetchZones };
}
