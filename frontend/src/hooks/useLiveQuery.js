import { useCallback, useEffect, useRef } from 'react';
import { predictLive } from '../api/client';
import { useApp } from '../context/AppContext';

const TIMEOUT_MS = 45_000;

/**
 * useLiveQuery — handles the POST /predict/live interaction
 * Provides real-time multi-stage feedback during GEE pipeline execution.
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

    // Multi-stage timer simulation for clear user transparency
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      const el = elapsedRef.current;
      let stage = 'satellite';
      if (el > 12) stage = 'rainfall';
      else if (el > 4) stage = 'model';

      actions.setLiveQuery({ elapsed: el, stage });
    }, 1000);

    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const result = await predictLive(lat, lon, controller.signal);
      clearTimeout(timeoutId);
      clearInterval(timerRef.current);

      if (!result || typeof result !== 'object') {
        throw new Error('Invalid response received from prediction pipeline.');
      }

      actions.setLiveQuery({ status: 'done', result, stage: 'done' });
      // Auto-select the live zone so the Zone Drawer opens with full breakdown
      actions.setSelectedZone({
        ...result,
        source: 'live',
      });
    } catch (err) {
      clearTimeout(timeoutId);
      clearInterval(timerRef.current);

      if (err.name === 'AbortError') {
        actions.setLiveQuery({
          status: 'error',
          error: `Satellite pipeline timed out after ${TIMEOUT_MS / 1000}s. Please click to retry.`,
        });
      } else {
        actions.setLiveQuery({
          status: 'error',
          error: err.message || 'Live prediction failed. Check connection.',
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
