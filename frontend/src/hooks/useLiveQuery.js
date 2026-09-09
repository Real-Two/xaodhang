import { useCallback, useEffect, useRef } from 'react';
import { predictLive } from '../api/client';
import { useApp } from '../context/AppContext';

// Railway backend GEE pipeline: 5–10s typical, 30s hard timeout
const TIMEOUT_MS = 30_000;

/**
 * useLiveQuery — map click → GET /predict/live?lat=X&lon=Y → popup result.
 *
 * Stages (shown in progress banner):
 *   0–4s:  satellite  — GEE fetching Sentinel-2 + JAXA elevation
 *   4–8s:  model      — DeepLabv3+ inference on 128×128 patch
 *   8s+:   rainfall   — CHIRPS 72h accumulation + combined score
 */
export function useLiveQuery() {
  const { state, actions } = useApp();
  const abortRef = useRef(null);
  const timerRef = useRef(null);
  const elapsedRef = useRef(0);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      clearInterval(timerRef.current);
    };
  }, []);

  const queryPoint = useCallback(async (lat, lon) => {
    // Cancel any in-flight query
    abortRef.current?.abort();
    clearInterval(timerRef.current);
    elapsedRef.current = 0;

    const controller = new AbortController();
    abortRef.current = controller;

    actions.setLiveQuery({
      status: 'loading',
      lat,
      lon,
      result: null,
      error: null,
      elapsed: 0,
      stage: 'satellite',
    });

    // Realistic stage progression matching GEE pipeline timing (5–10s total)
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      const el = elapsedRef.current;

      let stage = 'satellite';
      if (el >= 8) stage = 'rainfall';
      else if (el >= 4) stage = 'model';

      actions.setLiveQuery({ elapsed: el, stage });
    }, 1000);

    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      console.log(`[RedBeryl] GET /predict/live?lat=${lat}&lon=${lon}`);
      const result = await predictLive(lat, lon, controller.signal);
      clearTimeout(timeoutId);
      clearInterval(timerRef.current);

      console.log('[RedBeryl] /predict/live response:', result);

      if (!result || typeof result !== 'object') {
        throw new Error('Invalid response from prediction pipeline.');
      }

      actions.setLiveQuery({ status: 'done', result, stage: 'done' });

      // Auto-open Zone Drawer with full risk breakdown
      actions.setSelectedZone({ ...result, source: 'live' });

    } catch (err) {
      clearTimeout(timeoutId);
      clearInterval(timerRef.current);

      const timedOut = err.name === 'AbortError';
      console.warn('[RedBeryl] /predict/live error:', err.message);

      actions.setLiveQuery({
        status: 'error',
        error: timedOut
          ? `GEE pipeline timed out after ${TIMEOUT_MS / 1000}s — click again to retry.`
          : (err.message || 'Live prediction failed. Check backend connection.'),
      });
    }
  }, [actions]);

  const cancelQuery = useCallback(() => {
    abortRef.current?.abort();
    clearInterval(timerRef.current);
    actions.resetLiveQuery();
  }, [actions]);

  return {
    liveQuery: state.liveQuery,
    queryPoint,
    cancelQuery,
  };
}
