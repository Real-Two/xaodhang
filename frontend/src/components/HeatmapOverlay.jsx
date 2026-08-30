import React from 'react';
import { ImageOverlay } from 'react-leaflet';

// 128×128 px patch at 10m/pixel = 1.28 km square → 0.00576° offset at NER latitudes
const DELTA = 0.00576;

/**
 * HeatmapOverlay — renders a base64 PNG heatmap as a Leaflet ImageOverlay.
 * Shows nothing if base64Png is null (cache hit / no prediction yet).
 */
export default function HeatmapOverlay({ lat, lon, base64Png }) {
  if (!base64Png) return null;

  const bounds = [
    [lat - DELTA, lon - DELTA],
    [lat + DELTA, lon + DELTA],
  ];

  const dataUrl = base64Png.startsWith('data:')
    ? base64Png
    : `data:image/png;base64,${base64Png}`;

  return (
    <ImageOverlay
      url={dataUrl}
      bounds={bounds}
      opacity={0.62}
      zIndex={400}
    />
  );
}
