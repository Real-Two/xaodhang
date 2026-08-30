import React from 'react';
import { useApp } from '../context/AppContext';

/**
 * ReportsView — Citizen and field officer disaster report gallery.
 * Renders photos, descriptions, timestamps, and geolocation tags.
 */
export default function ReportsView({ onLocateReport }) {
  const { state, actions } = useApp();

  return (
    <div className="reports-view animate-fade">
      {/* Header */}
      <div className="reports-view__header">
        <div className="reports-view__header-left">
          <h1 className="reports-view__title">Citizen & Officer Field Reports</h1>
          <p className="reports-view__subtitle">
            Ground-truth crowdsourced incident reports and slope displacement observations from district disaster officers and local residents.
          </p>
        </div>
        <button
          className="btn-primary"
          onClick={() => actions.openModal('reportForm')}
        >
          <span>📸 + Submit New Field Report</span>
        </button>
      </div>

      {/* Grid */}
      {state.reports.length === 0 ? (
        <div className="reports-view__empty glass-panel">
          <span className="reports-view__empty-icon">📷</span>
          <h3>No Field Reports Submitted Yet</h3>
          <p>
            Field officers and local citizens can submit geolocated photo reports of rockfalls, tension cracks, and debris flows to calibrate the early warning system.
          </p>
          <button
            className="btn-primary"
            style={{ marginTop: 16 }}
            onClick={() => actions.openModal('reportForm')}
          >
            File First Incident Report
          </button>
        </div>
      ) : (
        <div className="reports-grid">
          {state.reports.map((report, idx) => {
            const hasPhoto = !!report.photo_url;
            const dateStr = report.created_at
              ? new Date(report.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
              : 'Recent submission';

            return (
              <div key={report.id || idx} className="report-card glass-card">
                {/* Photo Header */}
                <div className="report-card__media">
                  {hasPhoto ? (
                    <img src={report.photo_url} alt="Field observation" className="report-card__img" />
                  ) : (
                    <div className="report-card__placeholder">
                      <span>⛰️</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>GPS Verified Report</span>
                    </div>
                  )}
                  <span className="report-card__tag">
                    Verified Observation
                  </span>
                </div>

                {/* Content */}
                <div className="report-card__content">
                  <div className="report-card__user-row">
                    <div className="report-card__avatar">
                      {report.officer_name ? report.officer_name.charAt(0).toUpperCase() : '👤'}
                    </div>
                    <div className="report-card__user-meta">
                      <span className="report-card__author">
                        {report.officer_name || 'District Observer / Citizen'}
                      </span>
                      <span className="report-card__time">{dateStr}</span>
                    </div>
                  </div>

                  <p className="report-card__desc">
                    {report.description || 'Ground observation report without detailed notes.'}
                  </p>

                  <div className="report-card__footer">
                    <div className="report-card__coords">
                      📍 {report.lat?.toFixed(3)}°N, {report.lon?.toFixed(3)}°E
                    </div>
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 11, padding: '4px 10px' }}
                      onClick={() => {
                        actions.setView('map');
                        onLocateReport(report);
                      }}
                    >
                      Locate on Map ↗
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
