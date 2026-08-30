import React, { useRef } from 'react';
import { AppProvider } from './context/AppContext';
import { useZones } from './hooks/useZones';
import { useReports } from './hooks/useReports';
import StatusBar from './components/StatusBar';
import PriorityPanel from './components/PriorityPanel';
import MapView from './components/MapView';
import './App.css';

// Inner component so hooks can use context
function Dashboard() {
  const mapRef = useRef(null);
  useZones();
  useReports();

  const handleZoneClick = (zone) => {
    if (mapRef.current) {
      mapRef.current.setView([zone.lat, zone.lon], 11, { animate: true });
    }
  };

  return (
    <div className="app-shell">
      <StatusBar />
      <div className="app-body">
        <PriorityPanel onZoneClick={handleZoneClick} />
        <MapView mapRef={mapRef} />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Dashboard />
    </AppProvider>
  );
}
