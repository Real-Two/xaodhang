/**
 * RedBeryl API Client — Render Production
 * Backend: https://xaodhang.onrender.com
 * Docs:    https://xaodhang.onrender.com/docs
 *
 * CORS is fully open (*) on the backend — no preflight issues.
 */

export const BASE_URL =
  import.meta.env.VITE_API_URL ||
  'https://xaodhang.onrender.com';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request(method, path, options = {}) {
  const { body, formData, signal } = options;

  const headers = {};
  let reqBody = undefined;

  if (formData) {
    reqBody = formData; // let browser set Content-Type with boundary
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: reqBody,
    signal,
    cache: 'no-store',
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const errData = await res.json();
      msg = errData.detail || errData.message || msg;
    } catch (_) {}
    throw new ApiError(res.status, msg);
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

// ── Zones ────────────────────────────────────────────────────────────────────

/** GET /zones → array of all seeded zone summaries */
export async function getZones() {
  return request('GET', '/zones');
}

/** POST /zones → create a new zone */
export async function createZone(data) {
  return request('POST', '/zones', { body: data });
}

// ── Risk ─────────────────────────────────────────────────────────────────────

/**
 * GET /risk/all → combined risk scores for all zones, sorted highest first.
 */
export async function getRiskAll() {
  return request('GET', '/risk/all');
}

/** GET /risk/{id} → combined risk result for one seeded zone */
export async function getRisk(id) {
  return request('GET', `/risk/${id}`);
}

// ── Forecast ─────────────────────────────────────────────────────────────────

/**
 * GET /forecast/{zone_id} → 72-hour predicted risk via Open-Meteo weather model.
 */
export async function getForecast(id) {
  return request('GET', `/forecast/${id}`);
}

// ── History ───────────────────────────────────────────────────────────────────

/**
 * GET /history/{zone_id}?limit=N → risk trend data for charts.
 */
export async function getHistory(id, limit = 28) {
  return request('GET', `/history/${id}?limit=${limit}`);
}

/**
 * GET /history/{zone_id}/summary?days=N → 7-day summary with trend direction.
 */
export async function getHistorySummary(id, days = 7) {
  return request('GET', `/history/${id}/summary?days=${days}`);
}

// ── Live Prediction (Map Click) ───────────────────────────────────────────────

/**
 * GET /predict/live?lat={lat}&lon={lon}
 * On-demand risk prediction for any arbitrary coordinate.
 */
export async function predictLive(lat, lon, signal) {
  return request('GET', `/predict/live?lat=${lat}&lon=${lon}`, { signal });
}

/**
 * Stream a live prediction so Render sees activity while GEE is fetching the
 * satellite patch. Resolves with the same object as predictLive.
 */
export async function predictLiveStream(lat, lon, signal, onEvent = () => {}) {
  const res = await fetch(`${BASE_URL}/predict/live/stream?lat=${lat}&lon=${lon}`, {
    method: 'GET',
    signal,
    cache: 'no-store',
    headers: { Accept: 'text/event-stream' },
  });

  if (!res.ok || !res.body) {
    throw new ApiError(res.status, `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const payload = frame
        .split('\n')
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('');
      if (!payload) continue;

      const event = JSON.parse(payload);
      onEvent(event);
      if (event.type === 'result') return event.result;
      if (event.type === 'error') throw new ApiError(502, event.detail || 'Live prediction failed.');
    }

    if (done) break;
  }

  throw new Error('Prediction stream ended before a result was returned.');
}

// ── Structural Prediction ─────────────────────────────────────────────────────

/**
 * POST /predict/structural/{id}
 * Upload a satellite patch (.npy / .h5) to run inference locally.
 */
export async function predictStructural(id, file) {
  const fd = new FormData();
  fd.append('file', file);
  return request('POST', `/predict/structural/${id}`, { formData: fd });
}

// ── Rainfall ─────────────────────────────────────────────────────────────────

/** POST /rainfall/{id} → push manual rainfall data */
export async function postRainfall(id, data) {
  return request('POST', `/rainfall/${id}`, { body: data });
}

// ── Reports ───────────────────────────────────────────────────────────────────

/** GET /reports → array of all citizen / field-officer geo-tagged reports */
export async function getReports() {
  return request('GET', '/reports');
}

/**
 * POST /reports (multipart)
 */
export async function postReport({ lat, lon, description, photo, officer_name }) {
  const fd = new FormData();
  fd.append('lat', String(lat));
  fd.append('lon', String(lon));
  fd.append('description', description);
  if (officer_name) fd.append('officer_name', officer_name);
  if (photo) fd.append('photo', photo);
  return request('POST', '/reports', { formData: fd });
}

// ── AI Chatbot ────────────────────────────────────────────────────────────────

/**
 * POST /chat → AI chatbot endpoint.
 */
export async function postChat(message) {
  return request('POST', '/chat', { body: { message } });
}

// ── Alerts ────────────────────────────────────────────────────────────────────

/**
 * GET /alerts/log → historical alert log.
 */
export async function getAlertsLog() {
  return request('GET', '/alerts/log');
}

// ── NER Regional Scan ─────────────────────────────────────────────────────────

/**
 * GET /scan/ner/grid → returns the full grid of points to be scanned (no inference).
 * Useful to preview scan coverage before starting.
 */
export async function getScanGrid() {
  return request('GET', '/scan/ner/grid');
}

/**
 * POST /scan/ner → blocking full NER scan (for scripts/cron, not the live UI).
 * For the live streaming UI, connect directly to /scan/ner/stream via fetch+ReadableStream.
 */
export async function runScanBlocking() {
  return request('POST', '/scan/ner');
}

// ── Geocoding (OSM Nominatim, NER-restricted) ─────────────────────────────────

const NER_VIEWBOX = '88.0,29.6,97.5,21.5';

export async function geocodeSearch(query, signal) {
  if (!query || query.trim().length < 3) return [];

  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2` +
    `&q=${encodeURIComponent(query)}` +
    `&viewbox=${NER_VIEWBOX}&bounded=1&countrycodes=in&limit=6`;

  try {
    const res = await fetch(url, {
      headers: { 'Accept-Language': 'en' },
      signal,
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(d => ({
      type: 'place',
      id: `osm-${d.place_id}`,
      label: d.display_name,
      lat: parseFloat(d.lat),
      lon: parseFloat(d.lon),
      osmType: d.type,
    }));
  } catch (err) {
    if (err.name === 'AbortError') return [];
    console.warn('[geocodeSearch] failed:', err);
    return [];
  }
}

// ── Health ────────────────────────────────────────────────────────────────────

/** Ping the Render backend root — resolves true if alive. */
export async function pingBackend() {
  try {
    const res = await fetch(`${BASE_URL}/`, {
      method: 'GET',
      cache: 'no-store',
      // Render free-tier cold starts can take 30-50s on first request;
      // 15s is generous enough for warm instances, short enough to detect
      // genuine outages without blocking the UI too long.
      signal: AbortSignal.timeout(15_000),
    });
    return res.status < 500;
  } catch (_) {
    return false;
  }
}
