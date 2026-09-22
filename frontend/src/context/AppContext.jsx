import React, { createContext, useContext, useReducer, useCallback, useMemo, useRef } from 'react';

// ── Initial State ─────────────────────────────────────────────────────────────

const initialState = {
  // Navigation & View
  currentView: 'map',        // 'map' | 'priority' | 'reports'
  searchQuery: '',
  filterLevel: 'ALL',        // 'ALL' | 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW'

  // Modals & Drawers
  selectedZone: null,        // Zone object shown in ZoneDetailDrawer
  activeModal: null,         // null | 'reportForm' | 'transparency' | 'alerts'

  // Core Data
  zones: [],
  reports: [],

  // Live Query State
  liveQuery: {
    status: 'idle',          // 'idle' | 'loading' | 'done' | 'error'
    lat: null,
    lon: null,
    result: null,
    error: null,
    elapsed: 0,
    stage: 'idle',           // 'satellite' | 'model' | 'rainfall' | 'done'
  },

  // Map & GIS Settings
  bandwidthMode: false,      // Low-bandwidth mode (reduces imagery/heavy layers)
  layers: {
    heatmap: true,
    rainfall: true,
    historical: true,
    reports: true,
    // Coming soon layers (always false)
    soilMoisture: false,
    deforestation: false,
    mining: false,
  },

  // System & Connection
  backendOnline: null,       // null=unknown, true, false
  lastRefresh: null,
  structuralResults: {},     // { [zoneId]: { mask_png_base64, ... } }
};

// ── Reducer ───────────────────────────────────────────────────────────────────

function reducer(state, action) {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, currentView: action.payload };

    case 'SET_SEARCH_QUERY':
      return { ...state, searchQuery: action.payload };

    case 'SET_FILTER_LEVEL':
      return { ...state, filterLevel: action.payload };

    case 'SET_SELECTED_ZONE':
      return { ...state, selectedZone: action.payload };

    case 'MERGE_SELECTED_ZONE':
      // Merges partial fields into the existing selectedZone (used by live query
      // interval ticker to update subtitle/elapsed without full replacement)
      if (!state.selectedZone) return state;
      return { ...state, selectedZone: { ...state.selectedZone, ...action.payload } };

    case 'CLEAR_SELECTED_ZONE':
      return { ...state, selectedZone: null };

    case 'OPEN_MODAL':
      return { ...state, activeModal: action.payload };

    case 'CLOSE_MODAL':
      return { ...state, activeModal: null };

    case 'SET_ZONES':
      return { ...state, zones: action.payload, lastRefresh: new Date() };

    case 'SET_REPORTS':
      return { ...state, reports: action.payload };

    case 'ADD_REPORT':
      return { ...state, reports: [action.payload, ...state.reports] };

    case 'SET_LIVE_QUERY':
      return { ...state, liveQuery: { ...state.liveQuery, ...action.payload } };

    case 'RESET_LIVE_QUERY':
      return { ...state, liveQuery: { ...initialState.liveQuery } };

    case 'TOGGLE_BANDWIDTH':
      return { ...state, bandwidthMode: !state.bandwidthMode };

    case 'TOGGLE_LAYER':
      return {
        ...state,
        layers: {
          ...state.layers,
          [action.payload]: !state.layers[action.payload],
        },
      };

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
          z.id === action.payload.id ? { ...z, ...action.payload } : z
        ),
        selectedZone:
          state.selectedZone?.id === action.payload.id
            ? { ...state.selectedZone, ...action.payload }
            : state.selectedZone,
      };

    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Shared Leaflet map instance ref — lets ANY component (search bar,
  // priority list, alerts drawer, etc.) fly the map to a location without
  // prop-drilling. MapView attaches this to <MapContainer ref={mapRef}>.
  const mapRef = useRef(null);

  const actions = useMemo(() => ({
    setView: v => dispatch({ type: 'SET_VIEW', payload: v }),
    setSearchQuery: q => dispatch({ type: 'SET_SEARCH_QUERY', payload: q }),
    setFilterLevel: lvl => dispatch({ type: 'SET_FILTER_LEVEL', payload: lvl }),
    setSelectedZone: z => dispatch({ type: 'SET_SELECTED_ZONE', payload: z }),
    mergeSelectedZone: p => dispatch({ type: 'MERGE_SELECTED_ZONE', payload: p }),
    clearSelectedZone: () => dispatch({ type: 'CLEAR_SELECTED_ZONE' }),
    openModal: m => dispatch({ type: 'OPEN_MODAL', payload: m }),
    closeModal: () => dispatch({ type: 'CLOSE_MODAL' }),
    setZones: z => dispatch({ type: 'SET_ZONES', payload: z }),
    setReports: r => dispatch({ type: 'SET_REPORTS', payload: r }),
    addReport: r => dispatch({ type: 'ADD_REPORT', payload: r }),
    setLiveQuery: p => dispatch({ type: 'SET_LIVE_QUERY', payload: p }),
    resetLiveQuery: () => dispatch({ type: 'RESET_LIVE_QUERY' }),
    toggleBandwidth: () => dispatch({ type: 'TOGGLE_BANDWIDTH' }),
    toggleLayer: layer => dispatch({ type: 'TOGGLE_LAYER', payload: layer }),
    setBackendStatus: s => dispatch({ type: 'SET_BACKEND_STATUS', payload: s }),
    setStructuralResult: (zoneId, result) =>
      dispatch({ type: 'SET_STRUCTURAL_RESULT', payload: { zoneId, result } }),
    updateZoneRisk: r => dispatch({ type: 'UPDATE_ZONE_RISK', payload: r }),
  }), [dispatch]);
  // dispatch is stable across the component's lifetime (guaranteed by React),
  // so this object is created exactly once and never triggers a re-render loop
  // in consumers whose effects depend on `actions` or a callback derived from it.

  const value = useMemo(() => ({ state, actions, mapRef }), [state, actions]);

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
