import React, { useState, useRef } from 'react';
import { postReport } from '../api/client';
import { useApp } from '../context/AppContext';
import { useReports } from '../hooks/useReports';

/**
 * ReportForm — High-polish citizen / field officer disaster report modal.
 * Includes GPS auto-capture, photo preview, severity tagging, and optimistic updates.
 */
export default function ReportForm() {
  const { state, actions } = useApp();
  const { refresh } = useReports();

  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [officerName, setOfficerName] = useState('');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const fileRef = useRef(null);

  if (state.activeModal !== 'reportForm') return null;

  const handleGPS = () => {
    if (!navigator.geolocation) {
      setErrorMsg('Geolocation is not supported by your browser.');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(5));
        setLon(pos.coords.longitude.toFixed(5));
        setGpsLoading(false);
      },
      (err) => {
        setErrorMsg('Unable to retrieve GPS coordinates. Please enter manually.');
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handlePhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhoto(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!lat || !lon || !description.trim()) {
      setErrorMsg('Latitude, Longitude and Observation details are required.');
      return;
    }

    setStatus('loading');
    setErrorMsg('');

    try {
      const result = await postReport({
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        description: description.trim(),
        photo,
        officer_name: officerName.trim(),
      });

      // Optimistic update
      actions.addReport(result || {
        id: Date.now(),
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        description: description.trim(),
        officer_name: officerName.trim() || 'Field Officer',
        photo_url: photoPreview,
        created_at: new Date().toISOString(),
      });

      setStatus('success');
      await refresh();
      setTimeout(() => {
        actions.closeModal();
      }, 1500);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message || 'Submission failed. Please check network connectivity.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={actions.closeModal}>
      <div className="report-modal glass-panel animate-fade" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="report-modal__header">
          <div className="report-modal__title-wrap">
            <span className="badge badge--high">Ground Truth Validation</span>
            <h2 className="report-modal__title">Submit Citizen / Officer Field Report</h2>
            <p className="report-modal__subtitle">
              Ground observations of rockfalls, road cracks, or debris flows directly calibrate the early warning system.
            </p>
          </div>
          <button className="zone-drawer__close" onClick={actions.closeModal}>✕</button>
        </div>

        {/* Body */}
        <div className="report-modal__body">
          {status === 'success' ? (
            <div className="report-modal__success">
              <span className="report-modal__success-icon">✓</span>
              <h3>Field Report Submitted Successfully</h3>
              <p>The observation has been pinned to the GIS layer and logged with district authorities.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="report-modal__form">
              {/* Officer / Submitter Name */}
              <div className="form-group">
                <label className="form-label">Observer Name / Designation (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Officer R. Sharma / Senapati PWD Observer"
                  value={officerName}
                  onChange={e => setOfficerName(e.target.value)}
                  className="form-input"
                />
              </div>

              {/* Coordinates */}
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label">Latitude *</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="25.0700"
                    value={lat}
                    onChange={e => setLat(e.target.value)}
                    className="form-input"
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Longitude *</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="94.1200"
                    value={lon}
                    onChange={e => setLon(e.target.value)}
                    className="form-input"
                    required
                  />
                </div>
              </div>

              <button
                type="button"
                className="btn-secondary"
                onClick={handleGPS}
                disabled={gpsLoading}
                style={{ width: '100%', justifyContent: 'center', marginBottom: 12 }}
              >
                {gpsLoading ? '📡 Acquiring GPS Satellite Lock...' : '📍 Auto-detect GPS Coordinates'}
              </button>

              {/* Observation Description */}
              <div className="form-group">
                <label className="form-label">Observation Details / Slope Condition *</label>
                <textarea
                  placeholder="Describe ground evidence: tension cracks on highway, mud slurry, rockfall displacement..."
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  className="form-textarea"
                  rows={3}
                  required
                />
              </div>

              {/* Photo Upload */}
              <div className="form-group">
                <label className="form-label">Attach Site Photo (Optional)</label>
                {photoPreview && (
                  <div className="photo-preview-wrap">
                    <img src={photoPreview} alt="Preview" className="photo-preview-img" />
                    <button
                      type="button"
                      className="photo-preview-remove"
                      onClick={() => { setPhoto(null); setPhotoPreview(null); }}
                    >
                      ✕
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => fileRef.current?.click()}
                >
                  📷 {photo ? 'Replace Photo' : 'Upload Slope Photo'}
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  style={{ display: 'none' }}
                  onChange={handlePhoto}
                />
              </div>

              {errorMsg && (
                <div className="form-error-msg">{errorMsg}</div>
              )}

              {/* Actions */}
              <div className="report-modal__actions">
                <button type="button" className="btn-secondary" onClick={actions.closeModal}>
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={status === 'loading'}
                  style={{ flex: 1, justifyContent: 'center' }}
                >
                  {status === 'loading' ? 'Submitting to Telemetry...' : 'Submit Field Report'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
