import { useCallback, useEffect, useRef } from 'react';
import { predictLiveStream } from '../api/client';
import { useApp } from '../context/AppContext';

// Railway GEE pipeline: typically 5–10s, 30s hard cap
const TIMEOUT_MS = 180_000;

/**
 * useLiveQuery — map click → GET /predict/live?lat=X&lon=Y → ZoneDrawer panel.
 *
 * On click:
 *   1. Immediately open ZoneDrawer with _loading: true so user sees "Fetching..."
 *   2. Place spinner marker on map at exact clicked coordinate
 *   3. On API success: update selectedZone with full result → drawer updates in-place
 *   4. On error: update selectedZone with _error state, keep marker for retry
 *
 * Stage labels (shown in drawer and progress banner):
 *   0–4s:  satellite  — GEE Sentinel-2 + JAXA AW3D30
 *   4–8s:  model      — DeepLabv3+ inference
 *   8s+:   rainfall   — CHIRPS 72h accumulation
 */
export function useLiveQuery() {
  const { state, actions } = useApp();
  const { mergeSelectedZone } = actions;
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
    // Cancel any previous in-flight request
    abortRef.current?.abort();
    clearInterval(timerRef.current);
    elapsedRef.current = 0;

    const controller = new AbortController();
    abortRef.current = controller;

    // ── Step 1: Set live query state (drives map pin) ─────────────────────────
    actions.setLiveQuery({
      status: 'loading',
      lat,           // exact clicked coordinate — used for pin position
      lon,
      result: null,
      error: null,
      elapsed: 0,
      stage: 'satellite',
    });

    // ── Step 2: Immediately open ZoneDrawer with loading placeholder ──────────
    // This is what the user sees in the side panel while GEE runs.
    actions.setSelectedZone({
      source: 'live',
      _loading: true,
      lat,
      lon,
      // Coordinates as title — same pattern as the result drawer
      zone_name: `${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`,
      _subtitle: 'Fetching satellite data for this location...',
    });

    // ── Step 3: Elapsed timer with stage labels ───────────────────────────────
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      const el = elapsedRef.current;

      let stage = 'satellite';
      if (el >= 8) stage = 'rainfall';
      else if (el >= 4) stage = 'model';

      actions.setLiveQuery({ elapsed: el, stage });
      // Partial update to side-panel subtitle — mergeSelectedZone so we don't
      // clobber the full zone object set during the initial loading placeholder.
      const subtitles = {
        satellite: 'Fetching Sentinel-2 (10m) & JAXA AW3D30 elevation data...',
        model:     'Running DeepLabv3+ terrain segmentation...',
        rainfall:  'Querying CHIRPS 72h precipitation accumulation...',
      };
      mergeSelectedZone({ _subtitle: subtitles[stage], elapsed: el });
    }, 1000);

    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      console.log(`[RedBeryl] GET /predict/live/stream?lat=${lat}&lon=${lon}`);
      const result = await predictLiveStream(lat, lon, controller.signal, event => {
        if (event.stage) {
          actions.setLiveQuery({ stage: event.stage });
        }
      });
      clearTimeout(timeoutId);
      clearInterval(timerRef.current);

      console.log('[RedBeryl] /predict/live/stream response:', result);

      if (!result || typeof result !== 'object') {
        throw new Error('Invalid response from prediction pipeline.');
      }

      // ── Step 4: Mark query done (drives pin change to teardrop) ──────────────
      actions.setLiveQuery({ status: 'done', result, stage: 'done' });

      // ── Step 5: Update ZoneDrawer in-place with full result data ─────────────
      // Use clicked lat/lon for the title (API returns snapped coords in result.lat/lon)
      // LiveRiskOut does NOT include rainfall_mm_* — those are zone-specific from /risk/all
      actions.setSelectedZone({
        source: 'live',
        _loading: false,
        _error: null,
        lat,
        lon,
        zone_name: `${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`,
        _subtitle: 'Live Prediction · Northeast Region',
        // Risk fields from API (LiveRiskOut)
        structural_risk:  result.structural_risk,
        rainfall_risk:    result.rainfall_risk,
        combined_score:   result.combined_score,
        risk_level:       result.risk_level,
        // rainfall_mm_* not in LiveRiskOut — drawer will show — for these
        rainfall_mm_24h:  result.rainfall_mm_24h  ?? null,
        rainfall_mm_48h:  result.rainfall_mm_48h  ?? null,
        rainfall_mm_72h:  result.rainfall_mm_72h  ?? null,
        // Heatmap (may be null)
        mask_png_base64:  result.mask_png_base64 ?? null,
        cached:           result.cached,
      });


    } catch (err) {
      clearTimeout(timeoutId);
      clearInterval(timerRef.current);

      const timedOut = err.name === 'AbortError';
      const errorMsg = timedOut
        ? `GEE pipeline timed out after ${TIMEOUT_MS / 1000}s — click again to retry.`
        : (err.message || 'Live prediction failed. Check backend connection.');

      console.warn('[RedBeryl] /predict/live error:', err.message);

      actions.setLiveQuery({ status: 'error', error: errorMsg });
      // Update side panel with error state
      actions.setSelectedZone({
        source: 'live',
        _loading: false,
        _error: errorMsg,
        lat,
        lon,
        zone_name: `${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`,
      });
    }
  }, [actions]);

  const cancelQuery = useCallback(() => {
    abortRef.current?.abort();
    clearInterval(timerRef.current);
    actions.resetLiveQuery();
    actions.clearSelectedZone();
  }, [actions]);

  return {
    liveQuery: state.liveQuery,
    queryPoint,
    cancelQuery,
  };
}
