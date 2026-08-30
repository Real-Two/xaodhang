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

// ── Health ────────────────────────────────────────────────────────────────────

/** Ping the backend — resolves true if reachable, false otherwise */
export async function pingBackend() {
  try {
    const res = await fetch(`${BASE_URL}/zones`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(4000),
    });
    return res.ok || res.status < 500;
  } catch (_) {
    return false;
  }
}
