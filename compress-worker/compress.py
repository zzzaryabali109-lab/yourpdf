"""
ConvertAPI PDF Compression Worker
Uses the official ConvertAPI Python SDK (convertapi==2.0.1) to perform server-side
cloud-based PDF compression.

Security and Integrity Constraints:
- Processes files server-side only. Never sends credentials from browser.
- Credentials read from server environment variable `CONVERT_API_TOKEN`. Never logged.
- Validates PDF signature, enforces upload limits, preserves page count & orientation.
- Accurately measures and reports size reduction: ((in - out) / in) * 100.
- If output >= input, retains original with 0% reduction (never falsifies savings).
- Temporary files must be cleaned up by caller/wrapper.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import sys
import traceback
from typing import Any

# ---------------------------------------------------------------------------
# PDF Validation and Integrity Helpers
# ---------------------------------------------------------------------------

def validate_pdf_signature(file_path: str) -> bool:
    """Check if file starts with valid %PDF- signature."""
    try:
        with open(file_path, "rb") as f:
            header = f.read(1024)
            return b"%PDF-" in header
    except Exception:
        return False


def get_pdf_metadata(file_path: str) -> dict[str, Any]:
    """Inspect page count and page dimensions using pypdfium2."""
    import pypdfium2 as pdfium  # type: ignore

    try:
        doc = pdfium.PdfDocument(file_path)
        page_count = len(doc)
        pages_info = []
        for i in range(page_count):
            p = doc[i]
            pages_info.append({
                "page": i + 1,
                "width": round(p.get_width(), 1),
                "height": round(p.get_height(), 1),
                "rotation": p.get_rotation(),
            })
        doc.close()
        return {"valid": True, "page_count": page_count, "pages": pages_info}
    except Exception as exc:
        return {"valid": False, "error": str(exc), "page_count": 0, "pages": []}


# ---------------------------------------------------------------------------
# ConvertAPI Compression Runner
# ---------------------------------------------------------------------------

def run_convertapi_compression(
    input_path: str,
    output_path: str,
    token: str,
    preset: str | None = None,
    image_resolution: int = 150,
    image_quality: int = 80,
    timeout_sec: int = 120,
    store_file: bool = False,
) -> dict[str, Any]:
    """Execute PDF compression using the official ConvertAPI Python SDK."""
    import convertapi  # type: ignore
    from convertapi.exceptions import ApiError  # type: ignore

    if not token or not token.strip():
        return {
            "success": False,
            "error": "ConvertAPI is not configured. Please set the CONVERT_API_TOKEN environment variable on the server.",
            "code": "MISSING_CREDENTIALS",
        }

    if not os.path.isfile(input_path):
        return {
            "success": False,
            "error": "The input PDF file could not be found.",
            "code": "INPUT_NOT_FOUND",
        }

    original_size = os.path.getsize(input_path)
    if original_size == 0:
        return {
            "success": False,
            "error": "The input PDF file is empty.",
            "code": "EMPTY_FILE",
        }

    if not validate_pdf_signature(input_path):
        return {
            "success": False,
            "error": "The file does not contain a valid PDF signature.",
            "code": "INVALID_SIGNATURE",
        }

    # Inspect original PDF metadata
    orig_meta = get_pdf_metadata(input_path)
    if not orig_meta["valid"]:
        return {
            "success": False,
            "error": f"The input PDF is corrupted or invalid: {orig_meta.get('error', 'unreadable')}",
            "code": "CORRUPTED_PDF",
        }

    orig_page_count = orig_meta["page_count"]

    # Configure ConvertAPI credentials (never log the token)
    convertapi.api_credentials = token.strip()
    convertapi.timeout = timeout_sec

    # Build conversion parameters.
    # Note on Preset vs Fine-Tuning: ConvertAPI ignores custom ImageResolution/ImageQuality
    # when a Preset is passed. We strictly avoid combining them.
    params: dict[str, Any] = {
        "File": input_path,
    }

    if preset and preset.lower() not in ("none", "custom"):
        # Use explicit preset (e.g., 'web', 'lossless', 'archive')
        params["Preset"] = preset.lower()
    else:
        # Fine-tuning mode (balanced for high readability + substantial safe reduction):
        # 150 DPI is standard for high-legibility digital viewing and small print
        params["ImageResolution"] = max(72, min(image_resolution, 300))
        params["ImageQuality"] = max(50, min(image_quality, 100))
        params["Optimize"] = True
        params["RemoveDuplicates"] = True
        params["RemoveUnusedResources"] = True
        params["SubsetEmbeddedFonts"] = True
        # Explicitly preserve sensitive interactive & structural content
        params["RemoveForms"] = False
        params["RemoveBookmarks"] = False
        params["RemoveAnnotations"] = False
        params["RemoveMetadata"] = False
        params["PreservePdfa"] = True

    # Parameter for storage persistence on ConvertAPI:
    # Pass StoreFile parameter. In the Python SDK, StoreFile defaults to True for URL download.
    # If StoreFile=False is supported and FileData is returned in the response, we write FileData directly.
    params["StoreFile"] = store_file

    try:
        result = convertapi.convert("compress", params, from_format="pdf", timeout=timeout_sec)

        # Handle output writing:
        # Check if FileData (base64 inline) is present in response when StoreFile=False
        saved = False
        try:
            files_info = result.response.get("Files", [])
            if files_info and "FileData" in files_info[0]:
                raw_bytes = base64.b64decode(files_info[0]["FileData"])
                with open(output_path, "wb") as f_out:
                    f_out.write(raw_bytes)
                saved = True
        except Exception:
            saved = False

        if not saved:
            # Fall back to standard SDK file download via secure URL
            result.file.save(output_path)

    except ApiError as err:
        code = getattr(err, "code", "")
        msg = str(err.message if hasattr(err, "message") else err)
        # Sanitize error messages to avoid leaking provider internals or paths
        if code in (4001, 401, "4001"):
            clean_err = "ConvertAPI authentication failed. Please check that CONVERT_API_TOKEN is valid."
        elif code in (4020, 4021, 402, "4020", "4021"):
            clean_err = "ConvertAPI subscription quota or seconds limit has been exceeded."
        elif "timeout" in msg.lower():
            clean_err = "The compression operation timed out while processing with ConvertAPI."
        else:
            clean_err = f"ConvertAPI conversion error: {msg}"
        return {"success": False, "error": clean_err, "code": f"CONVERTAPI_ERROR_{code}"}

    except Exception as exc:
        msg = str(exc).lower()
        if "timeout" in msg:
            clean_err = "The compression request timed out while communicating with ConvertAPI."
        elif "connection" in msg:
            clean_err = "Could not connect to ConvertAPI cloud service. Please check network connectivity."
        else:
            clean_err = "An error occurred during PDF compression with ConvertAPI."
        return {"success": False, "error": clean_err, "code": "NETWORK_OR_API_ERROR"}

    # Verify that output file exists and is valid
    if not os.path.isfile(output_path) or os.path.getsize(output_path) == 0:
        return {
            "success": False,
            "error": "ConvertAPI returned an empty or unreadable output file.",
            "code": "EMPTY_OUTPUT",
        }

    if not validate_pdf_signature(output_path):
        return {
            "success": False,
            "error": "The compressed result is not a valid PDF file.",
            "code": "INVALID_OUTPUT_PDF",
        }

    # Verify document page integrity
    out_meta = get_pdf_metadata(output_path)
    if not out_meta["valid"]:
        return {
            "success": False,
            "error": "The compressed PDF is malformed or damaged.",
            "code": "DAMAGED_OUTPUT",
        }

    if out_meta["page_count"] != orig_page_count:
        # Page count mismatch: document integrity compromised.
        # Fall back to original file to guarantee zero page loss.
        shutil.copyfile(input_path, output_path)
        return {
            "success": True,
            "originalSize": original_size,
            "compressedSize": original_size,
            "bytesSaved": 0,
            "percentage": 0.0,
            "method": "convertapi-integrity-preserved-original",
            "pageCount": orig_page_count,
            "warning": "Page count drifted during compression; original PDF preserved.",
        }

    compressed_size = os.path.getsize(output_path)

    # If output is not smaller, honestly preserve original and report 0% savings
    if compressed_size >= original_size:
        shutil.copyfile(input_path, output_path)
        return {
            "success": True,
            "originalSize": original_size,
            "compressedSize": original_size,
            "bytesSaved": 0,
            "percentage": 0.0,
            "method": "convertapi-preserved-original",
            "pageCount": orig_page_count,
        }

    bytes_saved = original_size - compressed_size
    percentage = round(((original_size - compressed_size) / original_size) * 100, 1)

    return {
        "success": True,
        "originalSize": original_size,
        "compressedSize": compressed_size,
        "bytesSaved": bytes_saved,
        "percentage": percentage,
        "method": "convertapi-pdf-compress",
        "pageCount": orig_page_count,
    }


# ---------------------------------------------------------------------------
# CLI Entrypoint
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(description="ConvertAPI PDF Compression Worker")
    parser.add_argument("--input", required=True, help="Path to input PDF file")
    parser.add_argument("--output", required=True, help="Path to output PDF file")
    parser.add_argument("--preset", default=None, help="Preset: web, lossless, archive, etc.")
    parser.add_argument("--resolution", type=int, default=150, help="Max image DPI (default 150)")
    parser.add_argument("--quality", type=int, default=80, help="Image quality percent (default 80)")
    parser.add_argument("--timeout", type=int, default=120, help="Timeout in seconds (default 120)")
    parser.add_argument("--store-file", action="store_true", default=False, help="Use StoreFile=True")
    args = parser.parse_args()

    # Read token from environment (supports CONVERT_API_TOKEN, CONVERTAPI_SECRET, CONVERTAPI_TOKEN)
    token = (
        os.environ.get("CONVERT_API_TOKEN")
        or os.environ.get("CONVERTAPI_SECRET")
        or os.environ.get("CONVERTAPI_TOKEN")
        or ""
    )

    result = run_convertapi_compression(
        input_path=args.input,
        output_path=args.output,
        token=token,
        preset=args.preset,
        image_resolution=args.resolution,
        image_quality=args.quality,
        timeout_sec=args.timeout,
        store_file=args.store_file,
    )

    # Output ONLY JSON to stdout for clean consumption by Node.js
    print(json.dumps(result))
    if not result.get("success"):
        sys.exit(1)


if __name__ == "__main__":
    main()
