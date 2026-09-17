/**
 * RedBeryl API Client — Render (free, no expiry)
 * Backend: https://xaodhang.onrender.com
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
  let reqBody;

  if (formData) {
    reqBody = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method, headers, body: reqBody, signal, cache: 'no-store',
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const e = await res.json(); msg = e.detail || e.message || msg; } catch (_) {}
    throw new ApiError(res.status, msg);
  }

  const text = await res.text();
  try { return JSON.parse(text); } catch (_) { return text; }
}

// ── Zones ─────────────────────────────────────────────────────────────────────
export const getZones   = ()     => request('GET',  '/zones');
export const createZone = (data) => request('POST', '/zones', { body: data });

// ── Risk ──────────────────────────────────────────────────────────────────────
export const getRiskAll = ()   => request('GET', '/risk/all');
export const getRisk    = (id) => request('GET', `/risk/${id}`);

// ── Forecast ──────────────────────────────────────────────────────────────────
export const getForecast = (id) => request('GET', `/forecast/${id}`);

// ── History ───────────────────────────────────────────────────────────────────
export const getHistory        = (id, limit = 28) => request('GET', `/history/${id}?limit=${limit}`);
export const getHistorySummary = (id, days  = 7)  => request('GET', `/history/${id}/summary?days=${days}`);

// ── Live Prediction ───────────────────────────────────────────────────────────
export const predictLive = (lat, lon, signal) =>
  request('GET', `/predict/live?lat=${lat}&lon=${lon}`, { signal });

// ── Structural Prediction ─────────────────────────────────────────────────────
export const predictStructural = (id, file) => {
  const fd = new FormData();
  fd.append('file', file);
  return request('POST', `/predict/structural/${id}`, { formData: fd });
};

// ── Rainfall ──────────────────────────────────────────────────────────────────
export const postRainfall = (id, data) => request('POST', `/rainfall/${id}`, { body: data });

// ── Reports ───────────────────────────────────────────────────────────────────
export const getReports = () => request('GET', '/reports');

export const postReport = ({ lat, lon, description, photo, officer_name }) => {
  const fd = new FormData();
  fd.append('lat',         String(lat));
  fd.append('lon',         String(lon));
  fd.append('description', description);
  if (officer_name) fd.append('officer_name', officer_name);
  if (photo)        fd.append('photo', photo);
  return request('POST', '/reports', { formData: fd });
};

// ── Chat ──────────────────────────────────────────────────────────────────────
export const postChat = (message) => request('POST', '/chat', { body: { message } });

// ── Alerts ────────────────────────────────────────────────────────────────────
export const getAlertsLog = () => request('GET', '/alerts/log');

// ── Evacuation ────────────────────────────────────────────────────────────────
export const getEvacuation    = (id) => request('GET', `/evacuation/${id}`);
export const getAllEvacuation  = ()   => request('GET', '/evacuation');

// ── NER Scan ─────────────────────────────────────────────────────────────────
export const getScanGrid      = ()   => request('GET', '/scan/ner/grid');
export const runScanBlocking  = ()   => request('POST', '/scan/ner');

// ── Geocoding (OSM Nominatim, NER-restricted) ─────────────────────────────────
const NER_VIEWBOX = '88.0,29.6,97.5,21.5';

export async function geocodeSearch(query, signal) {
  if (!query || query.trim().length < 3) return [];
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2` +
    `&q=${encodeURIComponent(query)}` +
    `&viewbox=${NER_VIEWBOX}&bounded=1&countrycodes=in&limit=6`;
  try {
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' }, signal });
    if (!res.ok) return [];
    const data = await res.json();
    return data.map(d => ({
      type: 'place', id: `osm-${d.place_id}`,
      label: d.display_name,
      lat: parseFloat(d.lat), lon: parseFloat(d.lon),
      osmType: d.type,
    }));
  } catch (err) {
    if (err.name === 'AbortError') return [];
    return [];
  }
}

// ── Health ────────────────────────────────────────────────────────────────────
export async function pingBackend() {
  try {
    const res = await fetch(`${BASE_URL}/`, {
      method: 'GET', cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    return res.status < 500;
  } catch (_) {
    return false;
  }
}
