"""
PaddleOCR-based OCR Worker for the searchable PDF pipeline.
Runs as a private Flask HTTP server on localhost:7331.

POST /ocr
  Body: { "pdf_b64": "<base64 PDF bytes>", "job_id": "<uuid>" }
  Returns: {
    "pages": [
      {
        "page_num": 0,
        "width_pts": 612.0,
        "height_pts": 792.0,
        "render_dpi": 150,
        "img_width_px": 1275,
        "img_height_px": 1650,
        "skipped": false,         // true when page already has native text
        "boxes": [
          {
            "text": "Hello World",
            "bbox": [x0_px, y0_px, x1_px, y1_px],  // pixels in rendered image
            "confidence": 0.97,
            "low_confidence": false
          }
        ]
      }
    ],
    "job_id": "<uuid>",
    "total_pages": 1
  }

GET /health -> { "status": "ok", "model": "rapidocr" }
"""

from __future__ import annotations

import base64
import io
import logging
import os
import sys
import threading
import time
from typing import Any

import numpy as np
from flask import Flask, jsonify, request
from PIL import Image

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [OCR-Worker] %(levelname)s %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Global: load OCR engine once at startup
# ---------------------------------------------------------------------------
_ocr_engine: Any = None
_ocr_lock = threading.Lock()
_model_ready = threading.Event()


def _load_ocr_engine() -> None:
    global _ocr_engine
    log.info("Loading RapidOCR engine (PaddleOCR ONNX models)…")
    try:
        from rapidocr_onnxruntime import RapidOCR  # type: ignore

        _ocr_engine = RapidOCR()
        _model_ready.set()
        log.info("RapidOCR engine loaded successfully.")
    except Exception as exc:  # noqa: BLE001
        log.error("Failed to load RapidOCR engine: %s", exc)
        _model_ready.set()  # unblock health check; /ocr will return error


threading.Thread(target=_load_ocr_engine, daemon=True).start()

# ---------------------------------------------------------------------------
# PDF rendering helper using pypdfium2
# ---------------------------------------------------------------------------
RENDER_DPI = 150
NATIVE_TEXT_THRESHOLD = 40  # characters; skip OCR if page already has this many


def _render_page_to_numpy(pdf_bytes: bytes, page_index: int, dpi: int = RENDER_DPI):
    """Render a single PDF page to a numpy RGB array at the given DPI."""
    import pypdfium2 as pdfium  # type: ignore

    pdf = pdfium.PdfDocument(pdf_bytes)
    try:
        page = pdf[page_index]
        scale = dpi / 72.0
        bitmap = page.render(scale=scale, rotation=0)
        pil_img = bitmap.to_pil()
        return np.array(pil_img.convert("RGB"))
    finally:
        pdf.close()


def _get_page_dimensions(pdf_bytes: bytes, page_index: int):
    """Return (width_pts, height_pts, rotation) for the given page."""
    import pypdfium2 as pdfium  # type: ignore

    pdf = pdfium.PdfDocument(pdf_bytes)
    try:
        page = pdf[page_index]
        w = page.get_width()
        h = page.get_height()
        rot = page.get_rotation()
        return float(w), float(h), int(rot)
    finally:
        pdf.close()


def _page_has_native_text(pdf_bytes: bytes, page_index: int) -> bool:
    """Return True when page already carries a readable text layer."""
    try:
        import pypdfium2 as pdfium  # type: ignore

        pdf = pdfium.PdfDocument(pdf_bytes)
        try:
            page = pdf[page_index]
            textpage = page.get_textpage()
            text = textpage.get_text_range()
            return len(text.strip()) >= NATIVE_TEXT_THRESHOLD
        finally:
            pdf.close()
    except Exception:  # noqa: BLE001
        return False


# ---------------------------------------------------------------------------
# OCR on a single rendered image
# ---------------------------------------------------------------------------
LOW_CONFIDENCE_THRESHOLD = 0.60


def _ocr_image(img_rgb: np.ndarray) -> list[dict]:
    """
    Run RapidOCR on a numpy RGB image.
    Returns list of dicts: {text, bbox:[x0,y0,x1,y1], confidence, low_confidence}
    """
    if _ocr_engine is None:
        raise RuntimeError("OCR engine not loaded")

    result, _ = _ocr_engine(img_rgb)

    if not result:
        return []

    boxes: list[dict] = []
    for item in result:
        # RapidOCR returns: [box_points, text, confidence]
        # box_points: [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] (quad)
        if len(item) < 2:
            continue

        box_pts = item[0]  # 4-point quad
        text = item[1] if len(item) > 1 else ""
        conf = float(item[2]) if len(item) > 2 else 1.0

        if not text or not text.strip():
            continue

        # Convert quad to axis-aligned bounding box
        xs = [pt[0] for pt in box_pts]
        ys = [pt[1] for pt in box_pts]
        x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)

        boxes.append(
            {
                "text": text.strip(),
                "bbox": [float(x0), float(y0), float(x1), float(y1)],
                "confidence": round(conf, 4),
                "low_confidence": conf < LOW_CONFIDENCE_THRESHOLD,
            }
        )

    # Sort top-to-bottom, left-to-right for natural reading order
    boxes.sort(key=lambda b: (round(b["bbox"][1] / 20) * 20, b["bbox"][0]))
    return boxes


# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 200 * 1024 * 1024  # 200 MB


@app.route("/health")
def health():
    ready = _model_ready.is_set() and _ocr_engine is not None
    return jsonify({"status": "ok" if ready else "loading", "model": "rapidocr-onnxruntime"})


@app.route("/ocr", methods=["POST"])
def ocr():
    _model_ready.wait(timeout=60)
    if _ocr_engine is None:
        return jsonify({"error": "OCR engine failed to load. Check server logs."}), 503

    body = request.get_json(force=True, silent=True) or {}
    pdf_b64: str = body.get("pdf_b64", "")
    job_id: str = body.get("job_id", "unknown")

    if not pdf_b64:
        return jsonify({"error": "Missing pdf_b64 field"}), 400

    try:
        pdf_bytes = base64.b64decode(pdf_b64)
    except Exception:  # noqa: BLE001
        return jsonify({"error": "Invalid base64 in pdf_b64"}), 400

    import pypdfium2 as pdfium  # type: ignore

    try:
        pdf_doc = pdfium.PdfDocument(pdf_bytes)
        num_pages = len(pdf_doc)
        pdf_doc.close()
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Cannot open PDF: {exc}"}), 400

    log.info("Job %s: processing %d page(s)", job_id, num_pages)
    pages_result: list[dict] = []

    for page_idx in range(num_pages):
        t0 = time.time()
        try:
            width_pts, height_pts, rotation = _get_page_dimensions(pdf_bytes, page_idx)

            # Skip OCR if page already has native selectable text
            if _page_has_native_text(pdf_bytes, page_idx):
                log.info("  Page %d: has native text, skipping OCR", page_idx)
                pages_result.append(
                    {
                        "page_num": page_idx,
                        "width_pts": width_pts,
                        "height_pts": height_pts,
                        "render_dpi": RENDER_DPI,
                        "img_width_px": 0,
                        "img_height_px": 0,
                        "rotation": rotation,
                        "skipped": True,
                        "boxes": [],
                    }
                )
                continue

            img_rgb = _render_page_to_numpy(pdf_bytes, page_idx, RENDER_DPI)
            img_h, img_w = img_rgb.shape[:2]

            boxes = _ocr_image(img_rgb)
            elapsed = time.time() - t0
            low_conf = sum(1 for b in boxes if b["low_confidence"])
            log.info(
                "  Page %d: %d boxes (%d low-conf) in %.1fs [img %dx%d]",
                page_idx,
                len(boxes),
                low_conf,
                elapsed,
                img_w,
                img_h,
            )

            pages_result.append(
                {
                    "page_num": page_idx,
                    "width_pts": width_pts,
                    "height_pts": height_pts,
                    "render_dpi": RENDER_DPI,
                    "img_width_px": int(img_w),
                    "img_height_px": int(img_h),
                    "rotation": rotation,
                    "skipped": False,
                    "boxes": boxes,
                }
            )
        except Exception as exc:  # noqa: BLE001
            log.error("  Page %d failed: %s", page_idx, exc)
            pages_result.append(
                {
                    "page_num": page_idx,
                    "width_pts": 0.0,
                    "height_pts": 0.0,
                    "render_dpi": RENDER_DPI,
                    "img_width_px": 0,
                    "img_height_px": 0,
                    "rotation": 0,
                    "skipped": False,
                    "error": str(exc),
                    "boxes": [],
                }
            )

    return jsonify({"job_id": job_id, "total_pages": num_pages, "pages": pages_result})


if __name__ == "__main__":
    port = int(os.environ.get("OCR_WORKER_PORT", 7331))
    log.info("Starting OCR worker on http://localhost:%d", port)
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)

