import React, { useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { useZones } from './hooks/useZones';
import { useReports } from './hooks/useReports';

import NavigationSidebar from './components/NavigationSidebar';
import HeaderBar from './components/HeaderBar';
import MapView from './components/MapView';
import PriorityView from './components/PriorityView';
import ReportsView from './components/ReportsView';
import ScanView from './components/ScanView';
import ZoneDrawer from './components/ZoneDrawer';
import AlertsDrawer from './components/AlertsDrawer';
import AboutPanel from './components/AboutPanel';
import ReportForm from './components/ReportForm';
import ChatbotPanel from './components/ChatbotPanel';

import './App.css';

function DashboardShell() {
  const { state, actions, mapRef } = useApp();
  const [chatOpen, setChatOpen] = useState(false);

  useZones();
  useReports();

  const handleLocateOnMap = (item) => {
    if (item.lat != null && item.lon != null) {
      actions.setView('map');
      setTimeout(() => {
        if (mapRef.current) {
          mapRef.current.setView([item.lat, item.lon], 11, { animate: true });
        }
      }, 80);
    }
  };

  return (
    <div className={`app-shell ${state.bandwidthMode ? 'app-shell--bandwidth-mode' : ''}`}>
      <NavigationSidebar onChatOpen={() => setChatOpen(true)} />

      <div className="app-main">
        <HeaderBar />
        <div className="app-content">
          {state.currentView === 'map'      && <MapView mapRef={mapRef} />}
          {state.currentView === 'priority' && (
            <PriorityView
              onInspectZone={z => actions.setSelectedZone(z)}
              onLocateOnMap={handleLocateOnMap}
            />
          )}
          {state.currentView === 'reports'  && <ReportsView onLocateReport={handleLocateOnMap} />}
          {state.currentView === 'scan'     && <ScanView onLocateOnMap={handleLocateOnMap} />}
        </div>
      </div>

      <ZoneDrawer />
      <AlertsDrawer onLocateZone={handleLocateOnMap} />
      <AboutPanel />
      <ReportForm />

      {/* Chatbot panel — rendered in a portal-like fixed layer above everything */}
      {chatOpen && <ChatbotPanel onClose={() => setChatOpen(false)} />}

      {/* Floating chatbot button — z-index above modal-z (2000) so it's always visible */}
      {!chatOpen && (
        <button
          onClick={() => setChatOpen(true)}
          title="Open AI Copilot"
          style={{
            position:     'fixed',
            bottom:       24,
            right:        24,
            width:        52,
            height:       52,
            borderRadius: '50%',
            background:   'linear-gradient(135deg, #E87722, #c0392b)',
            border:       'none',
            cursor:       'pointer',
            zIndex:       9999,          // above everything
            display:      'flex',
            alignItems:   'center',
            justifyContent: 'center',
            fontSize:     22,
            boxShadow:    '0 4px 20px rgba(232,119,34,0.55)',
            transition:   'transform 0.15s',
          }}
          onMouseOver={e => e.currentTarget.style.transform = 'scale(1.1)'}
          onMouseOut={e  => e.currentTarget.style.transform = 'scale(1)'}
          aria-label="Open AI Copilot"
        >
          🤖
        </button>
      )}
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
