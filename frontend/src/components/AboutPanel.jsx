import React from 'react';
import { useApp } from '../context/AppContext';

/**
 * AboutPanel — Full scientific and architectural transparency disclosure modal.
 * Built to provide genuine trust signals for ministry officials and hackathon judges.
 */
export default function AboutPanel() {
  const { state, actions } = useApp();

  if (state.activeModal !== 'transparency') return null;

  return (
    <div className="modal-backdrop" onClick={actions.closeModal}>
      <div className="about-modal glass-panel animate-fade" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="about-modal__header">
          <div className="about-modal__title-wrap">
            <span className="about-modal__badge">System Architecture & Transparency</span>
            <h2 className="about-modal__title">RedBeryl Landslide Early Warning Engine</h2>
            <p className="about-modal__subtitle">
              Scientific disclosure of telemetry feeds, AI model architectures, and operational constraints (SIH 2026 · MDoNER).
            </p>
          </div>
          <button className="zone-drawer__close" onClick={actions.closeModal}>✕</button>
        </div>

        {/* Content Body */}
        <div className="about-modal__body">
          {/* Two Layer Architecture Diagram Banner */}
          <div className="about-model-box glass-card">
            <h3 className="about-model-box__title">
              🧠 DeepLabv3+ Multi-Scale Spatial Segmentation Pipeline
            </h3>
            <p className="about-model-box__desc">
              The core geological susceptibility model has been migrated from our initial baseline U-Net (val IoU 0.1962, first run) to a DeepLabv3+ architecture with Atrous Spatial Pyramid Pooling (ASPP). This allows multi-scale feature capture over steep Himalayan mountain contours and varied slope textures.
            </p>
            <div className="about-model-tags">
              <span className="badge badge--neutral">Architecture: DeepLabv3+</span>
              <span className="badge badge--neutral">Resolution: 10m/pixel</span>
              <span className="badge badge--neutral">Format: ONNX Runtime Engine</span>
              <span className="badge badge--neutral">Patch Dimension: 128×128px (1.28km²)</span>
            </div>
          </div>

          {/* Provenance Table */}
          <div className="about-section-title">
            <span>Telemetry Feeds & Operational Disclosures</span>
          </div>

          <div className="about-table-wrap glass-card">
            <table className="about-table">
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Production Feed</th>
                  <th>Institutional Fallback / Substitution</th>
                  <th>Cadence / Latency</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td><strong>Precipitation</strong></td>
                  <td>CHIRPS Daily (0.05° grid)</td>
                  <td>Used in place of IMD Gridded Rainfall (API registration pending)</td>
                  <td>~1–2 days latency (satellite-gauge hybrid)</td>
                </tr>
                <tr>
                  <td><strong>Elevation / Slope</strong></td>
                  <td>JAXA AW3D30 (30m DSM)</td>
                  <td>Used in place of ALOS PALSAR high-res DEM</td>
                  <td>Static high-resolution topographical baseline</td>
                </tr>
                <tr>
                  <td><strong>Optical Multispectral</strong></td>
                  <td>Sentinel-2 MSI (Copernicus)</td>
                  <td>L2A Bottom-of-Atmosphere Reflectance (B2, B3, B4, B8, B11, B12)</td>
                  <td>5-day constellation revisit period</td>
                </tr>
                <tr>
                  <td><strong>Historical Landslides</strong></td>
                  <td>NASA COOLR Database</td>
                  <td>Cooperative Open Online Landslide Repository (Northeast India subset)</td>
                  <td>Historical calibration & spatial validation</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Risk Formula Explanation */}
          <div className="about-formula-card glass-card">
            <h4 style={{ color: 'var(--brand-orange)', marginBottom: 6 }}>
              📐 Multi-Criteria Risk Formula
            </h4>
            <div className="about-formula-code">
              <code>Combined Risk = 0.60 × Susceptibility (DeepLabv3+) + 0.40 × RainfallTrigger (CHIRPS) + 0.10 × (Susceptibility × RainfallTrigger)</code>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 8 }}>
              This formulation ensures that a high terrain vulnerability alone does not trigger a false alarm during dry seasons, while heavy monsoon precipitation on fragile slopes generates immediate critical warning alerts.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="about-modal__footer">
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Smart India Hackathon 2026 · Ministry of Development of North Eastern Region (MDoNER)
          </span>
          <button className="btn-secondary" onClick={actions.closeModal}>
            Close Disclosure
          </button>
        </div>
      </div>
    </div>
  );
}
