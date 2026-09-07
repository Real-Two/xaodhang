"""
fetch_real_patch.py - FINAL fixed version

Root cause of the persistent 15-band bug:
  Band list incorrectly included BOTH B8 and B8A. Landslide4Sense (the
  dataset the model was trained on) uses exactly 12 Sentinel-2 bands
  (B1-B12, NOT including B8A) + slope + elevation = 14 total.
  B8A is a real Sentinel-2 band but it is NOT part of the 14-channel
  input this model expects. Removing it fixes the shape mismatch once
  and for all.

Other fixes retained from earlier rounds:
  - JAXA/ALOS/AW3D30/V4_1 is an ImageCollection -> .mosaic() before .select()
  - COPERNICUS/S2_HARMONIZED (S2 is deprecated)
  - Python datetime instead of ee.Date.now()
  - Explicit .select('slope') after ee.Terrain.slope() to avoid extra bands
  - Patch transposed to HWC (128, 128, 14) to match predict.py's _load_patch
  - 3-stage date fallback (60d -> 90d -> 180d w/ relaxed cloud filter) for
    zones like Tawang with persistent cloud cover
"""

import numpy as np
import datetime
import requests
import io

# Lazy import — GEE is not required at startup, only when fetch_patch() is called.
# This lets the server boot on Railway even before GEE credentials are configured.
try:
    import ee
    from gee_auth import initialize_gee
    _GEE_AVAILABLE = True
except ImportError:
    _GEE_AVAILABLE = False
    def initialize_gee(project): raise RuntimeError("earthengine-api not installed.")

# Landslide4Sense band convention: 12 S2 bands (NO B8A) + slope + elevation
S2_BANDS = ['B1','B2','B3','B4','B5','B6','B7','B8','B9','B10','B11','B12']
BAND_NAMES = S2_BANDS + ['slope', 'elevation']
assert len(BAND_NAMES) == 14, f"BAND_NAMES must have 14 entries, has {len(BAND_NAMES)}"


def _get_s2_median(point, start_str, end_str, cloud_pct: float = 30):
    collection = (
        ee.ImageCollection('COPERNICUS/S2_HARMONIZED')
        .filterBounds(point)
        .filterDate(start_str, end_str)
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', cloud_pct))
        .select(S2_BANDS)
    )
    count = collection.size().getInfo()
    if count == 0:
        return None, count
    return collection.median(), count


def fetch_patch(lat: float, lon: float, gee_project: str,
                patch_size: int = 128, scale: int = 10) -> np.ndarray:
    """
    Returns a (128, 128, 14) float32 HWC patch for the given lat/lon.
    Band order: B1,B2,B3,B4,B5,B6,B7,B8,B9,B10,B11,B12,slope,elevation
    """
    initialize_gee(gee_project)

    point  = ee.Geometry.Point([lon, lat])
    region = point.buffer(patch_size * scale / 2).bounds()

    end_dt  = datetime.datetime.utcnow()
    end_str = end_dt.strftime('%Y-%m-%d')

    # 3-stage fallback: 60d strict -> 90d strict -> 180d relaxed cloud filter
    attempts = [
        (60,  30),
        (90,  30),
        (180, 60),
    ]
    s2, count = None, 0
    for days, cloud_pct in attempts:
        start_str = (end_dt - datetime.timedelta(days=days)).strftime('%Y-%m-%d')
        s2, count = _get_s2_median(point, start_str, end_str, cloud_pct)
        if s2 is not None:
            if days > 60 or cloud_pct > 30:
                print(f"    Fallback used: {days}-day window, <{cloud_pct}% cloud")
            break

    if s2 is None:
        raise RuntimeError(
            f"No Sentinel-2 images found in 180-day window for lat={lat}, lon={lon}, "
            f"even with relaxed cloud filter."
        )

    print(f"    Using {count} S2 scenes for median composite.")

    # JAXA AW3D30 V4_1 is an ImageCollection — mosaic to get a single Image
    dem = ee.ImageCollection('JAXA/ALOS/AW3D30/V4_1').mosaic().select('DSM')

    # CRITICAL: .mosaic() drops explicit projection/scale info, causing
    # ee.Terrain.slope() to compute gradients at a coarse default pyramid
    # level instead of the DEM's real ~30m resolution -- this produces a
    # flat/constant slope band over small patches. Explicitly reproject to
    # native scale first so the gradient calculation is meaningful.
    dem = dem.reproject(crs='EPSG:4326', scale=30)

    slope = ee.Terrain.slope(dem).select('slope')
    elev = dem.rename('elevation')

    stack = s2.addBands(slope).addBands(elev)

    url = stack.getDownloadURL({
        'region':     region,
        'dimensions': f'{patch_size}x{patch_size}',
        'format':     'NPY',
        'bands':      BAND_NAMES,
    })

    response = requests.get(url, timeout=180)
    if response.status_code != 200:
        raise RuntimeError(
            f"GEE download failed: HTTP {response.status_code} — {response.text[:300]}"
        )

    arr_struct = np.load(io.BytesIO(response.content))

    bands = [arr_struct[b].astype(np.float32) for b in BAND_NAMES]
    patch = np.stack(bands, axis=0)  # (14, H, W) CHW
    patch = _crop_or_pad(patch, patch_size)

    assert patch.shape == (14, patch_size, patch_size), \
        f"Unexpected patch shape before transpose: {patch.shape}"

    patch = np.transpose(patch, (1, 2, 0))  # -> (128, 128, 14) HWC

    print(f"    Patch shape: {patch.shape}")
    return patch


def _crop_or_pad(arr: np.ndarray, size: int) -> np.ndarray:
    c, h, w = arr.shape
    if h > size:
        s = (h - size) // 2
        arr = arr[:, s:s+size, :]
    if w > size:
        s = (w - size) // 2
        arr = arr[:, :, s:s+size]
    c, h, w = arr.shape
    if h < size or w < size:
        arr = np.pad(arr,
                     ((0, 0), (0, max(0, size-h)), (0, max(0, size-w))),
                     mode='constant', constant_values=0)
    return arr[:, :size, :size]


if __name__ == '__main__':
    # Standalone sanity check — run this file directly to confirm band count
    # logic without touching GEE:
    print(f"S2_BANDS ({len(S2_BANDS)}): {S2_BANDS}")
    print(f"BAND_NAMES ({len(BAND_NAMES)}): {BAND_NAMES}")
    assert len(S2_BANDS) == 12
    assert len(BAND_NAMES) == 14
    print("Band count assertions passed: 12 S2 bands + slope + elevation = 14.")