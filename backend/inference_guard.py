"""Process-wide guard for memory-intensive Earth Engine and ONNX work."""

import threading

# A 512 MB Render instance can safely execute one GEE download/ONNX inference
# at a time.  This is intentionally process-wide, not request-local.
prediction_lock = threading.Lock()
