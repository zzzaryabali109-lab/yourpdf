"""
Private ConvertAPI Compression HTTP Service
Runs on private localhost (127.0.0.1:7332). Not exposed publicly.
Protected with an internal shared secret.
"""

from __future__ import annotations

import base64
import os
import tempfile
from typing import Any

from flask import Flask, jsonify, request
from compress import run_convertapi_compression

app = Flask(__name__)
INTERNAL_SECRET = os.environ.get("INTERNAL_COMPRESS_SECRET", "clearpdf-internal-secret-local")


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "service": "convertapi-compress-worker"})


@app.route("/compress", methods=["POST"])
def compress_endpoint():
    auth_header = request.headers.get("X-Internal-Secret", "")
    if auth_header != INTERNAL_SECRET:
        return jsonify({"success": False, "error": "Unauthorized internal request", "code": "UNAUTHORIZED"}), 403

    body = request.get_json(force=True, silent=True) or {}
    pdf_b64 = body.get("pdf_b64", "")
    preset = body.get("preset")
    resolution = int(body.get("resolution", 150))
    quality = int(body.get("quality", 80))
    timeout_sec = int(body.get("timeout", 120))
    store_file = bool(body.get("store_file", False))

    if not pdf_b64:
        return jsonify({"success": False, "error": "Missing pdf_b64 field", "code": "MISSING_PDF"}), 400

    token = (
        os.environ.get("CONVERT_API_TOKEN")
        or os.environ.get("CONVERTAPI_SECRET")
        or os.environ.get("CONVERTAPI_TOKEN")
        or ""
    )

    if not token:
        return jsonify({
            "success": False,
            "error": "ConvertAPI is not configured. Please set the CONVERT_API_TOKEN environment variable on the server.",
            "code": "MISSING_CREDENTIALS",
        }), 500

    # Write input to private temporary file
    temp_in = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    temp_out = tempfile.NamedTemporaryFile(suffix=".pdf", delete=False)
    temp_in.close()
    temp_out.close()

    try:
        raw_pdf = base64.b64decode(pdf_b64)
        with open(temp_in.name, "wb") as f_in:
            f_in.write(raw_pdf)

        result = run_convertapi_compression(
            input_path=temp_in.name,
            output_path=temp_out.name,
            token=token,
            preset=preset,
            image_resolution=resolution,
            image_quality=quality,
            timeout_sec=timeout_sec,
            store_file=store_file,
        )

        if result.get("success") and os.path.isfile(temp_out.name):
            with open(temp_out.name, "rb") as f_out:
                out_bytes = f_out.read()
            result["pdf_b64"] = base64.b64encode(out_bytes).decode("ascii")

        status_code = 200 if result.get("success") else 400
        return jsonify(result), status_code

    finally:
        for p in (temp_in.name, temp_out.name):
            try:
                if os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass


if __name__ == "__main__":
    port = int(os.environ.get("COMPRESS_WORKER_PORT", 7332))
    app.run(host="127.0.0.1", port=port, debug=False)
