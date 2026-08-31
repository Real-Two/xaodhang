/**
 * RedBeryl API Client
 * All fetch calls to the FastAPI backend.
 * Swap BASE_URL via env: VITE_API_URL=https://prod.example.com
 */

export const BASE_URL = import.meta.env.VITE_API_URL || 'https://unguided-simply-sloppily.ngrok-free.dev';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function request(method, path, options = {}) {
  const { body, formData, signal } = options;

  const headers = {
    // ngrok free tier intercepts browser requests with an HTML interstitial
    // unless this header is present — without it the backend appears offline
    'ngrok-skip-browser-warning': 'true',
  };
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
    cache: 'no-store',   // always hit the backend — never browser-cached zone data
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const errData = await res.json();
      msg = errData.detail || errData.message || msg;
    } catch (_) {}
    throw new ApiError(res.status, msg);
  }

  // Always try JSON first — don't trust content-type header sniffing,
  // FastAPI may send charset suffixes that confuse includes() checks.
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    return text; // genuine plain-text response
  }
}

// ── Zones ────────────────────────────────────────────────────────────────────

/** GET /zones → array of zone summaries */
export async function getZones() {
  return request('GET', '/zones');
}

/** POST /zones → create a zone */
export async function createZone(data) {
  return request('POST', '/zones', { body: data });
}

// ── Risk ─────────────────────────────────────────────────────────────────────

/** GET /risk/{id} → combined risk result for a seeded zone */
export async function getRisk(id) {
  return request('GET', `/risk/${id}`);
}

// ── Rainfall ─────────────────────────────────────────────────────────────────

/** POST /rainfall/{id} → push rainfall data */
export async function postRainfall(id, data) {
  return request('POST', `/rainfall/${id}`, { body: data });
}

// ── Structural Prediction ─────────────────────────────────────────────────────

/**
 * POST /predict/structural/{id}
 * @param {number} id  Zone ID
 * @param {File}   file  .npy or .h5 patch file
 * @returns {{ mask_png_base64: string, ... }}
 */
export async function predictStructural(id, file) {
  const fd = new FormData();
  fd.append('file', file);
  return request('POST', `/predict/structural/${id}`, { formData: fd });
}

// ── Live Prediction ───────────────────────────────────────────────────────────

/**
 * POST /predict/live { lat, lon }
 * Can take 5–15s (live satellite fetch + model run).
 * Returns same shape as /risk/{id} plus mask_png_base64.
 */
export async function predictLive(lat, lon, signal) {
  return request('POST', '/predict/live', {
    body: { lat, lon },
    signal,
  });
}

// ── Reports ───────────────────────────────────────────────────────────────────

/** GET /reports → array of citizen/field-officer reports */
export async function getReports() {
  return request('GET', '/reports');
}

/**
 * POST /reports (multipart)
 * @param {{ lat, lon, description, photo?: File }} data
 */
export async function postReport({ lat, lon, description, photo }) {
  const fd = new FormData();
  fd.append('lat', String(lat));
  fd.append('lon', String(lon));
  fd.append('description', description);
  if (photo) fd.append('photo', photo);
  return request('POST', '/reports', { formData: fd });
}

// ── Geocoding (search any road/village/town in NER) ───────────────────────────

// left,top,right,bottom (lon/lat) — same bounding box MapView uses for NER_BOUNDS
const NER_VIEWBOX = '88.0,29.6,97.5,21.5';

/**
 * geocodeSearch — free OpenStreetMap Nominatim lookup, restricted to NER.
 * Lets users search for ANY named road/village/town, not just the zones
 * already being monitored. Callers must debounce (Nominatim usage policy
 * asks for ~1 request/sec max) — see HeaderBar's search debounce.
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
      osmType: d.type, // 'village', 'residential' (road), 'town', etc.
    }));
  } catch (err) {
    if (err.name === 'AbortError') return [];
    console.warn('[geocodeSearch] failed:', err);
    return [];
  }
}

// ── Health ────────────────────────────────────────────────────────────────────

/** Ping the backend root — returns {"status":"ok"}, definitely accepts GET.
 *  Do NOT ping /zones (was returning 405 on HEAD, and wastes a full DB query).
 */
export async function pingBackend() {
  try {
    const res = await fetch(`${BASE_URL}/`, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'ngrok-skip-browser-warning': 'true' },
      signal: AbortSignal.timeout(5000),
    });
    return res.status < 500;
  } catch (_) {
    return false;
  }
}
