"""
Wraps the exported ONNX model for the API server. Deliberately uses
onnxruntime instead of PyTorch here — the training stack (torch, h5py, full
CUDA toolchain) has no business being installed on a lightweight API server;
this is exactly why export_onnx.py exists in the model pipeline.
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
            std = np.array(self.stats["std"], dtype=np.float32).reshape(NUM_BANDS, 1, 1)
            return (img_chw - mean) / (std + 1e-6)
        out = np.empty_like(img_chw)
        for i in range(img_chw.shape[0]):
            band = img_chw[i]
            lo, hi = band.min(), band.max()
            out[i] = (band - lo) / (hi - lo + 1e-6)
        return out

    def predict(self, img_hwc: np.ndarray, threshold: float = 0.5) -> dict:
        """
        img_hwc: (H, W, 14) raw patch, same convention as the training data.
        Returns risk_score, flagged_fraction, and a base64-encoded PNG
        heatmap ready to overlay on the frontend's GIS map.
        """
        img_chw = np.transpose(img_hwc, (2, 0, 1)).astype(np.float32)
        img_chw = self._normalize(img_chw)
        x = img_chw[np.newaxis, ...]  # (1, 14, H, W)

        logits = self.session.run(None, {self.input_name: x})[0]
        probs = 1 / (1 + np.exp(-logits))  # sigmoid
        probs = probs[0, 0]  # (H, W)

        binary = (probs > threshold).astype(np.uint8)
        flat_sorted = np.sort(probs.flatten())[::-1]
        top_k = max(1, int(0.05 * flat_sorted.size))
        risk_score = float(flat_sorted[:top_k].mean())

        return {
            "risk_score": risk_score,
            "flagged_fraction": float(binary.mean()),
            "mask_png_base64": self._mask_to_png_base64(probs),
        }

    @staticmethod
    def _mask_to_png_base64(probs: np.ndarray) -> str:
        """Blue (safe) -> yellow -> red (high risk) heatmap, as a PNG."""
        h, w = probs.shape
        rgb = np.zeros((h, w, 3), dtype=np.uint8)

        # Simple 3-stop gradient: blue -> yellow -> red
        r = np.clip(probs * 2, 0, 1)
        g = np.clip(2 - probs * 2, 0, 1) * (probs < 0.5) + np.clip(2 - probs * 2, 0, 1) * 0
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
    # Smoke test with a randomly initialized ONNX model (structure-only
    # check — this validates the service code path, not model accuracy).
    import subprocess
    import sys

    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "landslide_model"))

    dummy_img = np.random.rand(128, 128, NUM_BANDS).astype(np.float32)

    if not os.path.exists(MODEL_PATH):
        print(f"No model found at {MODEL_PATH} — skipping live inference smoke test.")
        print("This is expected until the real best_model.pt is exported to ONNX and placed here.")
    else:
        model = StructuralRiskModel()
        result = model.predict(dummy_img)
        print(f"risk_score: {result['risk_score']:.4f}")
        print(f"flagged_fraction: {result['flagged_fraction']:.4f}")
        print(f"PNG base64 length: {len(result['mask_png_base64'])}")
        print("Smoke test passed.")
