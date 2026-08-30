import React, { useState } from 'react';

/**
 * AboutPanel — data sources disclosure.
 * Slide-up from bottom; triggered by (i) info button.
 */
export default function AboutPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        id="about-panel-btn"
        className="btn about-trigger"
        onClick={() => setOpen(true)}
        title="About & data sources"
        aria-label="Open data sources panel"
      >
        ⓘ About
      </button>

      {open && (
        <div className="about-overlay" onClick={() => setOpen(false)}>
          <div className="about-panel glass-card" onClick={e => e.stopPropagation()}>
            <div className="about-panel__header">
              <h2>About & Data Sources</h2>
              <button className="btn" onClick={() => setOpen(false)}
                style={{ padding: '4px 10px', minHeight: 32 }}>✕</button>
            </div>

            <div className="about-panel__body">
              <section>
                <h3>🎯 What this system does</h3>
                <p>
                  RedBeryl is an AI-based Early Warning and Landslide Risk Monitoring System
                  for Northeast India, developed for Smart India Hackathon 2026 (Ministry of
                  Development of North Eastern Region — Disaster Management theme).
                </p>
                <p style={{ marginTop: 8 }}>
                  Risk is computed as <strong>terrain susceptibility</strong> (a static U-Net
                  prediction on satellite + DEM data) compounded by <strong>rainfall as a
                  dynamic trigger</strong>. Neither factor alone tells the full story.
                </p>
              </section>

              <div className="divider" />

              <section>
                <h3>📡 Data Sources</h3>
                <table className="about-panel__table">
                  <thead>
                    <tr>
                      <th>Layer</th>
                      <th>Source Used</th>
                      <th>Ideal (future)</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Rainfall</td>
                      <td>
                        <a href="https://www.chc.ucsb.edu/data/chirps" target="_blank" rel="noreferrer">
                          CHIRPS v2.0
                        </a>
                        <span className="about-panel__tag">Open</span>
                      </td>
                      <td>IMD gridded rainfall (registration required)</td>
                    </tr>
                    <tr>
                      <td>Terrain / DEM</td>
                      <td>
                        <a href="https://www.eorc.jaxa.jp/ALOS/en/aw3d30/" target="_blank" rel="noreferrer">
                          JAXA AW3D30
                        </a>
                        <span className="about-panel__tag">Open</span>
                      </td>
                      <td>ALOS PALSAR (higher-res, restricted)</td>
                    </tr>
                    <tr>
                      <td>Landslide inventory</td>
                      <td>
                        <a href="https://coolr.org" target="_blank" rel="noreferrer">
                          NASA COOLR / GLC
                        </a>
                        <span className="about-panel__tag">Open</span>
                      </td>
                      <td>GSI / NDMA national inventory</td>
                    </tr>
                    <tr>
                      <td>Satellite imagery</td>
                      <td>Sentinel-2 (ESA Copernicus)</td>
                      <td>Cartosat-3 / ResourceSat (ISRO)</td>
                    </tr>
                  </tbody>
                </table>
                <p style={{ marginTop: 12, color: 'var(--text-muted)', fontSize: 12 }}>
                  We use open datasets because IMD gridded rainfall and ALOS PALSAR require
                  institutional registration we do not yet hold. This is disclosed plainly
                  rather than oversold. Swapping these sources requires only updating the
                  data-fetch layer in the backend; the model and frontend are source-agnostic.
                </p>
              </section>

              <div className="divider" />

              <section>
                <h3>🤖 Model</h3>
                <p>
                  U-Net segmentation model trained on COOLR landslide patches + JAXA DEM
                  derivatives (slope, aspect, curvature). Inference runs via ONNX Runtime
                  (CPU). Structural risk scores are the per-pixel mean of the predicted mask.
                </p>
              </section>

              <div className="divider" />

              <section style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                <p>
                  ⚠ This system is a research prototype developed for SIH 2026. It is not
                  certified for operational emergency use. Always confirm with district
                  disaster management authority before issuing advisories.
                </p>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
