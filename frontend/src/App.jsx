import React, { useRef } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { useZones } from './hooks/useZones';
import { useReports } from './hooks/useReports';

import NavigationSidebar from './components/NavigationSidebar';
import HeaderBar from './components/HeaderBar';
import MapView from './components/MapView';
import PriorityView from './components/PriorityView';
import ReportsView from './components/ReportsView';
import ZoneDrawer from './components/ZoneDrawer';
import AlertsDrawer from './components/AlertsDrawer';
import AboutPanel from './components/AboutPanel';
import ReportForm from './components/ReportForm';

import './App.css';

// Main Dashboard Shell
function DashboardShell() {
  const mapRef = useRef(null);
  const { state, actions } = useApp();

  // Polling hooks for live telemetry
  useZones();
  useReports();

  const handleLocateOnMap = (item) => {
    if (item.lat != null && item.lon != null && mapRef.current) {
      mapRef.current.setView([item.lat, item.lon], 11, { animate: true });
    }
  };

  return (
    <div className={`app-shell ${state.bandwidthMode ? 'app-shell--bandwidth-mode' : ''}`}>
      {/* 1. Slim Icon Navigation Sidebar */}
      <NavigationSidebar />

      {/* 2. Main Content Area */}
      <div className="app-main">
        {/* Top Header */}
        <HeaderBar />

        {/* Dynamic View Body */}
        <div className="app-content">
          {state.currentView === 'map' && (
            <MapView mapRef={mapRef} />
          )}

          {state.currentView === 'priority' && (
            <PriorityView
              onInspectZone={(z) => actions.setSelectedZone(z)}
              onLocateOnMap={handleLocateOnMap}
            />
          )}

          {state.currentView === 'reports' && (
            <ReportsView onLocateReport={handleLocateOnMap} />
          )}
        </div>
      </div>

      {/* 3. Global Overlays & Modals */}
      <ZoneDrawer />
      <AlertsDrawer onLocateZone={handleLocateOnMap} />
      <AboutPanel />
      <ReportForm />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <DashboardShell />
    </AppProvider>
  );
}
