/**
 * RedBeryl API Client — Render (free, no expiry)
 * Backend: https://xaodhang.onrender.com
 * Docs:    https://xaodhang.onrender.com/docs
 *
 * Render free tier spins down after 15min inactivity.
 * useZones.js fires a keepalive ping every 4min while the tab is open.
 */

export const BASE_URL =
  import.meta.env.VITE_API_URL ||
  'https://xaodhang.onrender.com';
