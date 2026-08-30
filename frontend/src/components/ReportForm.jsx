import React, { useState, useRef } from 'react';
import { postReport } from '../api/client';
import { useApp } from '../context/AppContext';
import { useReports } from '../hooks/useReports';

/**
 * ReportForm — mobile-first citizen / field officer report submission.
 * Large touch targets, GPS auto-fill, photo upload, optimistic UI.
 */
export default function ReportForm({ prefillLat, prefillLon, onClose }) {
  const { actions } = useApp();
  const { refresh } = useReports();

  const [lat, setLat] = useState(prefillLat != null ? String(prefillLat.toFixed(6)) : '');
  const [lon, setLon] = useState(prefillLon != null ? String(prefillLon.toFixed(6)) : '');
  const [description, setDescription] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | loading | success | error
  const [errorMsg, setErrorMsg] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const fileRef = useRef(null);

  const handleGPS = () => {
    if (!navigator.geolocation) {
      setErrorMsg('GPS not available on this device.');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLon(pos.coords.longitude.toFixed(6));
        setGpsLoading(false);
      },
      () => {
        setErrorMsg('Could not get GPS location.');
        setGpsLoading(false);
      },
      { timeout: 8000 }
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
      setErrorMsg('Location and description are required.');
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
      });

      // Optimistically add to list
      actions.addReport(result || {
        id: Date.now(),
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        description: description.trim(),
        created_at: new Date().toISOString(),
      });

      setStatus('success');
      await refresh();
      setTimeout(() => onClose?.(), 1800);
    } catch (err) {
      setStatus('error');
      setErrorMsg(err.message || 'Submission failed. Please try again.');
    }
  };

  return (
    <div className="report-form glass-card">
      <div className="report-form__header">
        <h2>📋 Field Report</h2>
        {onClose && (
          <button className="btn" onClick={onClose} aria-label="Close form"
            style={{ padding: '4px 10px', minHeight: 32 }}>✕</button>
        )}
      </div>

      {status === 'success' ? (
        <div className="report-form__success">
          <div style={{ fontSize: 32 }}>✓</div>
          <p>Report submitted successfully</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="report-form__body">

          {/* Location */}
          <div className="report-form__field-group">
            <div className="report-form__field">
              <label htmlFor="report-lat">Latitude</label>
              <input
                id="report-lat"
                type="number"
                step="any"
                placeholder="e.g. 26.1445"
                value={lat}
                onChange={e => setLat(e.target.value)}
                required
              />
            </div>
            <div className="report-form__field">
              <label htmlFor="report-lon">Longitude</label>
              <input
                id="report-lon"
                type="number"
                step="any"
                placeholder="e.g. 91.7362"
                value={lon}
                onChange={e => setLon(e.target.value)}
                required
              />
            </div>
          </div>

          <button
            type="button"
            className="btn"
            onClick={handleGPS}
            disabled={gpsLoading}
            style={{ width: '100%', justifyContent: 'center', minHeight: 44 }}
          >
            {gpsLoading ? <><span className="spinner" /> Getting GPS…</> : '📍 Use my GPS location'}
          </button>

          {/* Description */}
          <div className="report-form__field">
            <label htmlFor="report-desc">Observation / Description *</label>
            <textarea
              id="report-desc"
              placeholder="Describe what you see: cracks in road, water seepage, slope movement…"
              value={description}
              onChange={e => setDescription(e.target.value)}
              required
              style={{ minHeight: 90 }}
            />
          </div>

          {/* Photo */}
          <div className="report-form__field">
            <label>Photo (optional)</label>
            {photoPreview && (
              <img
                src={photoPreview}
                alt="Preview"
                style={{ width: '100%', borderRadius: 8, marginBottom: 8, maxHeight: 160, objectFit: 'cover' }}
              />
            )}
            <button
              type="button"
              className="btn"
              onClick={() => fileRef.current?.click()}
              style={{ width: '100%', justifyContent: 'center', minHeight: 44 }}
            >
              📷 {photo ? 'Change photo' : 'Attach photo'}
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
            <p style={{ color: 'var(--risk-high)', fontSize: 13 }}>{errorMsg}</p>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={status === 'loading'}
            style={{ width: '100%', justifyContent: 'center', minHeight: 48, fontSize: 15 }}
          >
            {status === 'loading' ? <><span className="spinner" /> Submitting…</> : 'Submit Report'}
          </button>

          <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 4 }}>
            Report goes to the district disaster management cell
          </p>
        </form>
      )}
    </div>
  );
}
