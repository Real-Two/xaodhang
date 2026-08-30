import { createContext, useContext, useReducer, useCallback } from 'react';

// ── Initial State ─────────────────────────────────────────────────────────────

const initialState = {
  zones: [],
  reports: [],
  activeZone: null,          // full risk object for the selected zone
  liveQuery: {
    status: 'idle',          // 'idle' | 'loading' | 'done' | 'error'
    lat: null,
    lon: null,
    result: null,
    error: null,
    elapsed: 0,              // seconds elapsed while loading
  },
  bandwidthMode: false,      // LOW bandwidth: no auto-load of heatmap imagery
  heatmapVisible: true,      // master toggle for heatmap overlay layer
  reportsVisible: true,      // toggle for report pins layer
  backendOnline: null,       // null=unknown, true, false
  lastRefresh: null,         // Date of last /zones fetch
  structuralResults: {},     // { [zoneId]: { mask_png_base64, ... } }
};

// ── Reducer ───────────────────────────────────────────────────────────────────

function reducer(state, action) {
  switch (action.type) {
    case 'SET_ZONES':
      return { ...state, zones: action.payload, lastRefresh: new Date() };

    case 'SET_REPORTS':
      return { ...state, reports: action.payload };

    case 'ADD_REPORT':
      return { ...state, reports: [action.payload, ...state.reports] };

    case 'SET_ACTIVE_ZONE':
      return { ...state, activeZone: action.payload };

    case 'CLEAR_ACTIVE_ZONE':
      return { ...state, activeZone: null };

    case 'SET_LIVE_QUERY':
      return { ...state, liveQuery: { ...state.liveQuery, ...action.payload } };

    case 'RESET_LIVE_QUERY':
      return { ...state, liveQuery: { ...initialState.liveQuery } };

    case 'TOGGLE_BANDWIDTH':
      return { ...state, bandwidthMode: !state.bandwidthMode };

    case 'TOGGLE_HEATMAP':
      return { ...state, heatmapVisible: !state.heatmapVisible };

    case 'TOGGLE_REPORTS':
      return { ...state, reportsVisible: !state.reportsVisible };

    case 'SET_BACKEND_STATUS':
      return { ...state, backendOnline: action.payload };

    case 'SET_STRUCTURAL_RESULT':
      return {
        ...state,
        structuralResults: {
          ...state.structuralResults,
          [action.payload.zoneId]: action.payload.result,
        },
      };

    case 'UPDATE_ZONE_RISK':
      return {
        ...state,
        zones: state.zones.map(z =>
          z.id === action.payload.id
            ? { ...z, ...action.payload }
            : z
        ),
        activeZone:
          state.activeZone?.id === action.payload.id
            ? { ...state.activeZone, ...action.payload }
            : state.activeZone,
      };

    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Convenience action creators
  const actions = {
    setZones: useCallback(z => dispatch({ type: 'SET_ZONES', payload: z }), []),
    setReports: useCallback(r => dispatch({ type: 'SET_REPORTS', payload: r }), []),
    addReport: useCallback(r => dispatch({ type: 'ADD_REPORT', payload: r }), []),
    setActiveZone: useCallback(z => dispatch({ type: 'SET_ACTIVE_ZONE', payload: z }), []),
    clearActiveZone: useCallback(() => dispatch({ type: 'CLEAR_ACTIVE_ZONE' }), []),
    setLiveQuery: useCallback(p => dispatch({ type: 'SET_LIVE_QUERY', payload: p }), []),
    resetLiveQuery: useCallback(() => dispatch({ type: 'RESET_LIVE_QUERY' }), []),
    toggleBandwidth: useCallback(() => dispatch({ type: 'TOGGLE_BANDWIDTH' }), []),
    toggleHeatmap: useCallback(() => dispatch({ type: 'TOGGLE_HEATMAP' }), []),
    toggleReports: useCallback(() => dispatch({ type: 'TOGGLE_REPORTS' }), []),
    setBackendStatus: useCallback(s => dispatch({ type: 'SET_BACKEND_STATUS', payload: s }), []),
    setStructuralResult: useCallback((zoneId, result) =>
      dispatch({ type: 'SET_STRUCTURAL_RESULT', payload: { zoneId, result } }), []),
    updateZoneRisk: useCallback(r => dispatch({ type: 'UPDATE_ZONE_RISK', payload: r }), []),
  };

  return (
    <AppContext.Provider value={{ state, actions }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
