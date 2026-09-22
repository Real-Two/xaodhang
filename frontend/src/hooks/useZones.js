import { useEffect, useRef } from 'react';
import { getRiskAll, pingBackend } from '../api/client';
import { useApp } from '../context/AppContext';

const POLL_INTERVAL_MS = 90_000; // refresh risk data every 90s (gentler on Render free tier)
const MAX_CONSECUTIVE_FAILURES = 2; // require 2 consecutive ping failures before showing "disconnected"

/**
 * useZones — fetches GET /risk/all on mount and polls every 90s.
 *
 * /risk/all returns all seeded zones with real combined_score, risk_level,
 * structural_risk, rainfall_risk, and rainfall_mm_* already computed server-side.
 * No client-side enrichment needed.
 *
 * Field normalization:
 *   /risk/all → { zone_id, zone_name, ... } — we alias zone_id as id so the
 *   rest of the app (ZoneDrawer, markers, PriorityView) can use z.id everywhere.
 *
 * Resilience:
 *   - Requires 2 consecutive failures before marking backend as offline (prevents
 *     false disconnects when Render is slow or GEE is processing a live query).
 *   - Skips health ping if a live query is actively in flight (backend is clearly
 *     alive if it's processing our request).
 */
export function useZones() {
  const { state, actions } = useApp();
  const timerRef = useRef(null);
  const failCountRef = useRef(0);

  async function fetchZones() {
    try {
      // Skip the health ping if a live query is actively running —
      // the backend is obviously alive if it's processing our GEE request,
      // and the ping might timeout because the server is busy with it.
      const liveQueryActive = state.liveQuery?.status === 'loading';

      let alive;
      if (liveQueryActive) {
        alive = true; // assume alive — it's processing our request right now
      } else {
        alive = await pingBackend();
      }

      if (alive) {
        failCountRef.current = 0;
        actions.setBackendStatus(true);
      } else {
        failCountRef.current += 1;
        // Only mark offline after MAX_CONSECUTIVE_FAILURES failures
        // to avoid false positives from a single slow Render response.
        if (failCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
          actions.setBackendStatus(false);
        }
        return;
      }

      const raw = await getRiskAll();
      actions.setBackendStatus(true);
      const rawArr = Array.isArray(raw) ? raw : [];

      // Normalize: /risk/all uses zone_id; the rest of the app uses id
      const zones = rawArr.map(z => ({
        ...z,
        id: z.id ?? z.zone_id,
      }));

      if (zones.length > 0) {
        console.log('[RedBeryl] GET /risk/all — first zone:', zones[0]);
        console.log('[RedBeryl] Top 5 by risk:',
          zones.slice(0, 5).map(z => ({
            name: z.zone_name || z.name,
            level: z.risk_level,
            score: z.combined_score?.toFixed(3),
            struct: z.structural_risk?.toFixed(3),
            rain_mm: z.rainfall_mm_72h,
          }))
        );
      }

      actions.setZones(zones);
    } catch (err) {
      console.warn('[useZones] fetch error:', err);
      failCountRef.current += 1;
      if (failCountRef.current >= MAX_CONSECUTIVE_FAILURES) {
        actions.setBackendStatus(false);
      }
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
