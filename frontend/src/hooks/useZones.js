import { useEffect, useRef } from 'react';
import { getZones, pingBackend } from '../api/client';
import { useApp } from '../context/AppContext';
import { enrichZone } from '../utils/riskUtils';

const POLL_INTERVAL_MS = 60_000; // 60 seconds

/**
 * useZones — fetches /zones on mount and polls every 60s.
 *
 * GET /zones returns raw structural_risk + rainfall fields but NOT
 * combined_score or risk_level. We compute those client-side using
 * the same formula as risk_engine.py (via enrichZone).
 */
export function useZones() {
  const { actions } = useApp();
  const timerRef = useRef(null);

  async function fetchZones() {
    try {
      const alive = await pingBackend();
      actions.setBackendStatus(alive);
      if (!alive) return;

      const raw = await getZones();
      const zones = Array.isArray(raw) ? raw : [];

      // Log the first zone so field names are visible in the console
      if (zones.length > 0) {
        console.log('[RedBeryl] GET /zones — first zone raw fields:', zones[0]);
      }

      // Enrich each zone: compute combined_score + risk_level client-side
      // if the backend didn't return them (or returned 0 / null).
      const enriched = zones.map(enrichZone);

      // Log a sorted summary so you can see the ordering immediately
      const sorted = [...enriched].sort((a, b) => b.combined_score - a.combined_score);
      console.log('[RedBeryl] Zones by risk (top 5):',
        sorted.slice(0, 5).map(z => ({
          name: z.zone_name || z.name,
          level: z.risk_level,
          score: z.combined_score?.toFixed(3),
          structural: z.structural_risk?.toFixed(3),
          computed: z._computed,
        }))
      );

      actions.setZones(enriched);
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
