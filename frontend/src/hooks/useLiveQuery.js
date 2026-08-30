import { useCallback, useEffect, useRef } from 'react';
import { predictLive } from '../api/client';
import { useApp } from '../context/AppContext';

// Backend can take up to ~20s for a live GEE fetch + model run.
// Give 35s before hard abort so we never cut a valid response short.
const TIMEOUT_MS = 35_000;

/**
 * useLiveQuery — state machine for POST /predict/live
 *
 * Call queryPoint(lat, lon) to start a query.
 * State transitions: idle → loading → done | error
 * While loading, liveQuery.elapsed counts up (for the UI countdown).
 */
export function useLiveQuery() {
  const { state, actions } = useApp();
  const abortRef = useRef(null);
  const timerRef = useRef(null);
  const elapsedRef = useRef(0);

  // Cleanup on unmount
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

    actions.setLiveQuery({ status: 'loading', lat, lon, result: null, error: null, elapsed: 0 });

    // Elapsed counter — ticks every second for the UI countdown
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      actions.setLiveQuery({ elapsed: elapsedRef.current });
    }, 1000);

    // Hard abort after TIMEOUT_MS
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const result = await predictLive(lat, lon, controller.signal);
      clearTimeout(timeoutId);
      clearInterval(timerRef.current);

      // ── Debug: always log the raw response so field issues are visible ──
      console.log('[RedBeryl] /predict/live raw response:', result);
      console.log('[RedBeryl] risk_level:', result?.risk_level,
                  '| combined_score:', result?.combined_score,
                  '| cached:', result?.cached,
                  '| has_heatmap:', !!result?.mask_png_base64);

      // Validate the result has the fields we need
      if (!result || typeof result !== 'object') {
        throw new Error(`Unexpected response type: ${typeof result}. Got: ${JSON.stringify(result).slice(0, 100)}`);
      }

      actions.setLiveQuery({ status: 'done', result });
    } catch (err) {
      clearTimeout(timeoutId);
      clearInterval(timerRef.current);

      console.error('[RedBeryl] /predict/live error:', err);

      if (err.name === 'AbortError') {
        actions.setLiveQuery({
          status: 'error',
          error: `Request timed out after ${TIMEOUT_MS / 1000}s. The satellite fetch is taking longer than expected — try again.`,
        });
      } else {
        actions.setLiveQuery({
          status: 'error',
          error: err.message || 'Live query failed.',
        });
      }
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
