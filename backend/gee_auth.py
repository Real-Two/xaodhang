"""
gee_auth.py — Centralised Google Earth Engine authentication.

Handles three environments automatically:

  1. Railway / any cloud server:
     Set GEE_SERVICE_ACCOUNT_JSON env var to the full contents of your
     service account JSON key file. The module reads it, writes to a
     temp file, and authenticates with it.

  2. Local (already authenticated):
     If ~/.config/earthengine/credentials exists (from a previous
     ee.Authenticate()), ee.Initialize() succeeds directly.

  3. Local (first time):
     Falls back to ee.Authenticate() which opens a browser.

Usage:
    from gee_auth import initialize_gee
    initialize_gee("your-gee-project-id")
"""

import os
import json
import tempfile

try:
    import ee
    _EE_AVAILABLE = True
except ImportError:
    _EE_AVAILABLE = False

_initialized = False   # module-level flag — only auth once per process


def initialize_gee(project: str):
    global _initialized

    if not _EE_AVAILABLE:
        raise RuntimeError(
            "earthengine-api is not installed. "
            "Run: pip install earthengine-api"
        )

    if _initialized:
        return  # already authed in this process — skip

    service_account_json = os.environ.get("GEE_SERVICE_ACCOUNT_JSON", "").strip()

    if service_account_json:
        # --- Cloud / Railway path ---
        # Full JSON content is in the env var.
        # Write to a temp file so ADC and ee.ServiceAccountCredentials both work.
        try:
            key_data = json.loads(service_account_json)
        except json.JSONDecodeError as e:
            raise RuntimeError(
                f"GEE_SERVICE_ACCOUNT_JSON is set but is not valid JSON: {e}\n"
                "Make sure you pasted the entire JSON file contents, not just the path."
            )

        # Write temp credentials file
        tmp = tempfile.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, prefix="gee_sa_"
        )
        json.dump(key_data, tmp)
        tmp.flush()
        tmp.close()

        # Point ADC at it
        os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = tmp.name

        # Authenticate with service account credentials directly
        credentials = ee.ServiceAccountCredentials(
            email=key_data["client_email"],
            key_file=tmp.name,
        )
        ee.Initialize(credentials=credentials, project=project)
        print(f"[GEE] Authenticated via service account: {key_data['client_email']}")

    else:
        # --- Local path ---
        # Try existing credentials first, fall back to browser auth
        try:
            ee.Initialize(project=project)
            print("[GEE] Authenticated via existing local credentials.")
        except Exception:
            print("[GEE] No local credentials found. Opening browser for authentication...")
            try:
                ee.Authenticate()
                ee.Initialize(project=project)
                print("[GEE] Authenticated via browser.")
            except Exception as e:
                raise RuntimeError(
                    f"GEE authentication failed: {e}\n"
                    "On Railway: set GEE_SERVICE_ACCOUNT_JSON env var.\n"
                    "Locally: run ee.Authenticate() once in a Python shell."
                )

    _initialized = True
