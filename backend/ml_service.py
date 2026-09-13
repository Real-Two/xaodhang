"""
ml_service.py — ONNX inference wrapper for the landslide segmentation model.

risk_score computation (updated):
  Previously used top-5% pixel mean, which was too sensitive — on NER
  terrain (steep, heavily forested, high spectral variance) the UNet
  consistently finds a handful of high-confidence pixels even on safe
  slopes, so structural risk was rarely below 0.4 anywhere.

  New approach: weighted combination of
    (a) flagged_fraction — what % of the patch is above the slip threshold
    (b) mean probability  — average model confidence across all pixels
    (c) 95th percentile   — how severe the worst area is

  This gives a more honest spatial signal: a patch where 2% of pixels are
  flagged at 0.9 confidence (a small rockfall scar) scores differently from
  one where 40% of pixels are flagged at 0.7 (a widespread unstable slope).
"""

import base64
import io
import json
import os

import numpy as np
import onnxruntime as ort
from PIL import Image

NUM_BANDS = 14

MODEL_PATH = os.environ.get("MODEL_PATH", "model.onnx")
STATS_PATH = os.environ.get("STATS_PATH", "stats.json")

# Probability threshold above which a pixel is "flagged" as slip-prone
SLIP_THRESHOLD = 0.5

# Weights for the composite risk score from three spatial statistics
# Area coverage (flagged fraction) matters most — a small high-confidence
# scar is less concerning than widespread moderate instability
SCORE_WEIGHT_FRACTION  = 0.50
SCORE_WEIGHT_MEAN_PROB = 0.30
SCORE_WEIGHT_P95       = 0.20


class StructuralRiskModel:
    def __init__(self, model_path: str = MODEL_PATH, stats_path: str = STATS_PATH):
        self.session = ort.InferenceSession(model_path)
        self.input_name = self.session.get_inputs()[0].name

        self.stats = None
        if os.path.exists(stats_path):
            with open(stats_path) as f:
                self.stats = json.load(f)

    def _normalize(self, img_chw: np.ndarray) -> np.ndarray:
        if self.stats:
            mean = np.array(self.stats["mean"], dtype=np.float32).reshape(NUM_BANDS, 1, 1)
            std  = np.array(self.stats["std"],  dtype=np.float32).reshape(NUM_BANDS, 1, 1)
            return (img_chw - mean) / (std + 1e-6)
        # Per-band min-max fallback (less accurate but self-contained)
        out = np.empty_like(img_chw)
        for i in range(img_chw.shape[0]):
            band = img_chw[i]
            lo, hi = band.min(), band.max()
            out[i] = (band - lo) / (hi - lo + 1e-6)
        return out

    def predict(self, img_hwc: np.ndarray, threshold: float = SLIP_THRESHOLD) -> dict:
        """
        img_hwc: (H, W, 14) raw satellite patch.

        Returns:
          risk_score        — composite [0,1] structural susceptibility score
          flagged_fraction  — fraction of pixels above slip threshold
          mean_probability  — mean model confidence across all pixels
          p95_probability   — 95th percentile pixel probability
          mask_png_base64   — heatmap PNG for the ZoneDrawer overlay
        """
        img_chw = np.transpose(img_hwc, (2, 0, 1)).astype(np.float32)
        img_chw = self._normalize(img_chw)
        x       = img_chw[np.newaxis, ...]   # (1, 14, H, W)

        logits = self.session.run(None, {self.input_name: x})[0]
        probs  = 1 / (1 + np.exp(-logits))   # sigmoid → (1, 1, H, W)
        probs  = probs[0, 0]                  # (H, W)

        binary           = (probs > threshold).astype(np.uint8)
        flagged_fraction = float(binary.mean())
        mean_prob        = float(probs.mean())
        p95              = float(np.percentile(probs, 95))

        # Composite score: area coverage weighted most heavily
        risk_score = (
            SCORE_WEIGHT_FRACTION  * flagged_fraction +
            SCORE_WEIGHT_MEAN_PROB * mean_prob        +
            SCORE_WEIGHT_P95       * p95
        )
        risk_score = float(np.clip(risk_score, 0.0, 1.0))

        return {
            "risk_score":       risk_score,
            "flagged_fraction": flagged_fraction,
            "mean_probability": mean_prob,
            "p95_probability":  p95,
            "mask_png_base64":  self._mask_to_png_base64(probs),
        }

    @staticmethod
    def _mask_to_png_base64(probs: np.ndarray) -> str:
        """Blue (safe) → yellow → red (high risk) heatmap PNG."""
        h, w = probs.shape
        rgb  = np.zeros((h, w, 3), dtype=np.uint8)

        r = np.clip(probs * 2, 0, 1)
        g = np.where(probs < 0.5, probs * 2, np.clip(2 - probs * 2, 0, 1))
        b = np.clip(1 - probs * 2, 0, 1)

        rgb[..., 0] = (r * 255).astype(np.uint8)
        rgb[..., 1] = (g * 255).astype(np.uint8)
        rgb[..., 2] = (b * 255).astype(np.uint8)

        img = Image.fromarray(rgb, mode="RGB")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return base64.b64encode(buf.getvalue()).decode("utf-8")


if __name__ == "__main__":
    dummy = np.random.rand(128, 128, NUM_BANDS).astype(np.float32)

    if not os.path.exists(MODEL_PATH):
        print(f"No model at {MODEL_PATH} — skipping live inference test.")
    else:
        model  = StructuralRiskModel()
        result = model.predict(dummy)
        print(f"risk_score:       {result['risk_score']:.4f}")
        print(f"flagged_fraction: {result['flagged_fraction']:.4f}")
        print(f"mean_probability: {result['mean_probability']:.4f}")
        print(f"p95_probability:  {result['p95_probability']:.4f}")
        print(f"PNG base64 len:   {len(result['mask_png_base64'])}")
        print("Smoke test passed.")
