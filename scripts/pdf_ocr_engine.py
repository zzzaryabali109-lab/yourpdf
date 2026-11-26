#!/usr/bin/env python3
"""Render PDF pages locally and return Tesseract word lines for a searchable text layer."""

from __future__ import annotations

import csv
import io
import json
import os
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import pypdfium2 as pdfium
from PIL import Image


MAX_INPUT_BYTES = 100 * 1024 * 1024
RENDER_DPI = 250
NATIVE_TEXT_THRESHOLD = 40
LOW_CONFIDENCE_THRESHOLD = 0.60
TESSERACT_TIMEOUT_SECONDS = 120


def _get_native_text(page: Any) -> str:
    text_page = page.get_textpage()
    try:
        return text_page.get_text_range().strip()
    finally:
        text_page.close()


def _render_page(page: Any) -> tuple[bytes, int, int]:
    bitmap = page.render(scale=RENDER_DPI / 72.0)
    try:
        image = bitmap.to_pil().convert("RGB")
        image_bytes = io.BytesIO()
        image.save(image_bytes, format="PNG", optimize=True)
        return image_bytes.getvalue(), image.width, image.height
    finally:
        close_bitmap = getattr(bitmap, "close", None)
        if callable(close_bitmap):
            close_bitmap()


def _ocr_lines(image_bytes: bytes, language: str) -> list[dict[str, Any]]:
    command = [
        "tesseract",
        "stdin",
        "stdout",
        "--dpi",
        str(RENDER_DPI),
        "-l",
        language,
        "--psm",
        "1",
        "-c",
        "preserve_interword_spaces=1",
        "tsv",
    ]
    try:
        result = subprocess.run(
            command,
            input=image_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=TESSERACT_TIMEOUT_SECONDS,
            check=False,
        )
    except FileNotFoundError as error:
        raise RuntimeError("Tesseract OCR is not installed in the service image.") from error
    except subprocess.TimeoutExpired as error:
        raise RuntimeError("Tesseract took too long to process a page.") from error

    if result.returncode != 0:
        detail = result.stderr.decode("utf-8", errors="replace").strip()
        raise RuntimeError(detail or f"Tesseract exited with code {result.returncode}.")

    tsv = result.stdout.decode("utf-8-sig", errors="replace")
    rows = csv.DictReader(io.StringIO(tsv), delimiter="\t")
    line_words: dict[tuple[int, int, int], list[dict[str, Any]]] = defaultdict(list)

    for row in rows:
        if row.get("level") != "5":
            continue
        word = (row.get("text") or "").strip()
        if not word:
            continue
        try:
            confidence = float(row.get("conf", "-1")) / 100.0
            left = int(row.get("left", "0"))
            top = int(row.get("top", "0"))
            width = int(row.get("width", "0"))
            height = int(row.get("height", "0"))
            line_key = (
                int(row.get("block_num", "0")),
                int(row.get("par_num", "0")),
                int(row.get("line_num", "0")),
            )
        except (TypeError, ValueError):
            continue
        if confidence < 0 or width <= 0 or height <= 0:
            continue
        line_words[line_key].append(
            {
                "text": word,
                "confidence": confidence,
                "left": left,
                "top": top,
                "right": left + width,
                "bottom": top + height,
            }
        )

    lines: list[dict[str, Any]] = []
    for words in line_words.values():
        words.sort(key=lambda item: item["left"])
        confidence = sum(item["confidence"] for item in words) / len(words)
        x0 = min(item["left"] for item in words)
        y0 = min(item["top"] for item in words)
        x1 = max(item["right"] for item in words)
        y1 = max(item["bottom"] for item in words)
        lines.append(
            {
                "text": " ".join(item["text"] for item in words),
                "bbox": [float(x0), float(y0), float(x1), float(y1)],
                "confidence": round(confidence, 4),
                "low_confidence": confidence < LOW_CONFIDENCE_THRESHOLD,
                "sort_key": (y0, x0),
            }
        )

    lines.sort(key=lambda item: item["sort_key"])
    for line in lines:
        del line["sort_key"]
    return lines


def process_pdf(pdf_path: Path, job_id: str, language: str) -> dict[str, Any]:
    if not pdf_path.is_file():
        raise ValueError("Input PDF was not found.")
    if pdf_path.stat().st_size <= 0 or pdf_path.stat().st_size > MAX_INPUT_BYTES:
        raise ValueError("PDF must be between 1 byte and 100 MB.")
    if not re.fullmatch(r"[A-Za-z0-9_+.-]+", language):
        raise ValueError("TESSERACT_LANG contains unsupported characters.")

    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        pages: list[dict[str, Any]] = []
        for page_index in range(len(pdf)):
            page = pdf[page_index]
            width_pts = float(page.get_width())
            height_pts = float(page.get_height())
            rotation = int(page.get_rotation())
            page_result: dict[str, Any] = {
                "page_num": page_index,
                "width_pts": width_pts,
                "height_pts": height_pts,
                "render_dpi": RENDER_DPI,
                "img_width_px": 0,
                "img_height_px": 0,
                "rotation": rotation,
                "skipped": False,
                "boxes": [],
            }

            try:
                native_text = _get_native_text(page)
                if len(native_text) >= NATIVE_TEXT_THRESHOLD:
                    page_result["skipped"] = True
                    page_result["native_text"] = native_text
                    pages.append(page_result)
                    continue

                image_bytes, image_width, image_height = _render_page(page)
                page_result["img_width_px"] = image_width
                page_result["img_height_px"] = image_height
                page_result["boxes"] = _ocr_lines(image_bytes, language)
            except Exception as error:
                page_result["error"] = str(error) or error.__class__.__name__
            finally:
                page.close()

            pages.append(page_result)

        return {"job_id": job_id, "total_pages": len(pdf), "pages": pages}
    finally:
        pdf.close()


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: pdf_ocr_engine.py INPUT.pdf JOB_ID", file=sys.stderr)
        return 2

    language = os.environ.get("TESSERACT_LANG", "eng").strip() or "eng"
    try:
        response = process_pdf(Path(sys.argv[1]), sys.argv[2], language)
    except Exception as error:
        print(str(error) or error.__class__.__name__, file=sys.stderr)
        return 1

    print(json.dumps(response, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
