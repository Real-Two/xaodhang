/**
 * RedBeryl API Client — Railway Production
 * Backend: https://xaodhang-production12.up.railway.app
 * Docs:    https://xaodhang-production12.up.railway.app/docs
 *
 * CORS is fully open (*) on the backend — no preflight issues.
 */

export const BASE_URL =
  import.meta.env.VITE_API_URL ||
  'https://xaodhang-production12.up.railway.app';

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

/** GET /zones → array of all 10 seeded zone summaries */
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
 * Returns combined_score, risk_level, structural_risk, rainfall_risk per zone.
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
 * Returns hourly forecasted rainfall and risk scores for the next 3 days.
 */
export async function getForecast(id) {
  return request('GET', `/forecast/${id}`);
}

// ── History ───────────────────────────────────────────────────────────────────

/**
 * GET /history/{zone_id} → 7-day risk trend data for charts.
 * Provides historical combined_score, structural_risk, rainfall_risk per day.
 */
export async function getHistory(id) {
  return request('GET', `/history/${id}`);
}

// ── Live Prediction (Map Click) ───────────────────────────────────────────────

/**
 * POST /predict/live
 * On-demand risk prediction for any arbitrary coordinate.
 * GEE satellite fetch + DeepLabv3+ model + CHIRPS rainfall — takes 5–10s.
 *
 * Request body: { lat: number, lon: number }
 * Response (LiveRiskOut):
 *   { zone_id, zone_name, lat, lon, structural_risk, rainfall_risk,
 *     combined_score, risk_level, mask_png_base64, cached, source }
 *
 * Note: rainfall_mm_24h/48h/72h are NOT returned by /predict/live.
 * They come from /risk/all (seeded zones only).
 */
export async function predictLive(lat, lon, signal) {
  return request('POST', '/predict/live', { body: { lat, lon }, signal });
}


// ── Structural Prediction ─────────────────────────────────────────────────────

/**
 * POST /predict/structural/{id}
 * Upload a satellite patch (.npy / .h5) to run DeepLabv3+ locally.
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
 * @param {{ lat, lon, description, photo?: File, officer_name?: string }} data
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
 * @param {string} message  User's question about landslide risk
 * @returns {{ response: string }}
 */
export async function postChat(message) {
  return request('POST', '/chat', { body: { message } });
}

// ── Alerts ────────────────────────────────────────────────────────────────────

/**
 * GET /alerts/log → historical alert log.
 * Returns an array of past triggered HIGH/CRITICAL zone alerts.
 */
export async function getAlertsLog() {
  return request('GET', '/alerts/log');
}

// ── Geocoding (OSM Nominatim, NER-restricted) ─────────────────────────────────

// viewbox = left,top,right,bottom (lon/lat) — NER bounding box
const NER_VIEWBOX = '88.0,29.6,97.5,21.5';

/**
 * geocodeSearch — free Nominatim lookup restricted to Northeast India.
 * Callers must debounce (~1 req/sec per Nominatim policy).
 * https://operations.osmfoundation.org/policies/nominatim/
 */
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

/** Ping the Railway backend root — resolves true if alive. */
export async function pingBackend() {
  try {
    const res = await fetch(`${BASE_URL}/`, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    return res.status < 500;
  } catch (_) {
    return false;
  }
}
