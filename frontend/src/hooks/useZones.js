import { useEffect, useRef, useCallback } from 'react';
import { getRiskAll, BASE_URL } from '../api/client';
import { useApp } from '../context/AppContext';

const POLL_INTERVAL_MS  = 60_000;   // refresh risk data every 60s
const KEEPALIVE_MS      = 4 * 60_000; // ping every 4min to prevent Railway spin-down

/**
 * useZones — fetches /risk/all on mount, polls every 60s.
 * Also fires a lightweight keepalive ping every 4 minutes so Railway
 * never cold-starts during an active session ("connecting to API" issue).
 */
export function useZones() {
  const { actions } = useApp();
  const pollRef      = useRef(null);
  const keepaliveRef = useRef(null);

  const fetchZones = useCallback(async () => {
    try {
      const raw    = await getRiskAll();
      const rawArr = Array.isArray(raw) ? raw : [];
      const zones  = rawArr.map(z => ({ ...z, id: z.id ?? z.zone_id }));
      actions.setZones(zones);
      actions.setBackendStatus(true);
    } catch (err) {
      console.warn('[useZones] fetch error:', err);
      actions.setBackendStatus(false);
    }
  }, [actions]);

  // Keepalive — GET / (health check) every 4 min, fire-and-forget
  const keepalive = useCallback(() => {
    fetch(`${BASE_URL}/`, { cache: 'no-store' }).catch(() => {});
  }, []);

  useEffect(() => {
    fetchZones();
    pollRef.current      = setInterval(fetchZones, POLL_INTERVAL_MS);
    keepaliveRef.current = setInterval(keepalive,  KEEPALIVE_MS);
    return () => {
      clearInterval(pollRef.current);
      clearInterval(keepaliveRef.current);
    };
  }, [fetchZones, keepalive]);

  return { refresh: fetchZones };
}
