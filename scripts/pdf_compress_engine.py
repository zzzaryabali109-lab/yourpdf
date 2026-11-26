#!/usr/bin/env python3
"""Local PDF image compressor. Rewrites raster image streams, keeping PDF text/vector content."""

from __future__ import annotations

import io
import json
import sys
import tempfile
from pathlib import Path

import pikepdf
from pikepdf import PdfImage
from PIL import Image


MAX_INPUT_BYTES = 100 * 1024 * 1024
MAX_IMAGE_PIXELS = 100_000_000
# The last passes are deliberately strong enough to reduce oversized scans.
# Each pass starts from the original so the best valid output always wins.
PROFILES = (
    (0.90, 88),
    (0.80, 82),
    (0.70, 76),
    (0.60, 70),
    (0.50, 64),
    (0.40, 58),
)

Image.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS
PdfImage.MAX_IMAGE_PIXELS = MAX_IMAGE_PIXELS


def _drop_key(obj: pikepdf.Object, key: str) -> None:
    if key in obj:
        del obj[key]


def _is_masked(obj: pikepdf.Object) -> bool:
    return bool(
        obj.get("/ImageMask", False)
        or obj.get("/SMask") is not None
        or obj.get("/Mask") is not None
        or obj.get("/SMaskInData") is not None
    )


def _encode_jpeg(source: Image.Image, quality: int, colorspace: str) -> bytes:
    encoded = io.BytesIO()
    source.save(
        encoded,
        format="JPEG",
        quality=quality,
        optimize=True,
        progressive=False,
        subsampling=2 if colorspace == "/DeviceRGB" else 0,
    )
    return encoded.getvalue()


def _pil_for_recompression(image: PdfImage) -> tuple[Image.Image, str] | None:
    if image.colorspace not in {"/DeviceRGB", "/DeviceGray", "/DeviceCMYK", "/Indexed"}:
        return None

    decoded = image.as_pil_image(apply_decode_array=True, apply_mask=False)
    if decoded.mode in {"1", "L"}:
        return decoded.convert("L"), "/DeviceGray"
    if decoded.mode == "P":
        return decoded.convert("RGB"), "/DeviceRGB"
    if decoded.mode == "RGB":
        return decoded, "/DeviceRGB"
    if decoded.mode == "CMYK":
        return decoded.convert("RGB"), "/DeviceRGB"
    return None


def _rewrite_image(obj: pikepdf.Object, scale: float, quality: int) -> bool:
    # Keep masks and alpha objects intact; changing only their base image can
    # misalign transparency or alter the rendered page.
    if _is_masked(obj) or obj.get("/Subtype") != pikepdf.Name("/Image"):
        return False

    try:
        prepared = _pil_for_recompression(PdfImage(obj))
        if prepared is None:
            return False

        source, output_colorspace = prepared
        width = max(1, round(source.width * scale))
        height = max(1, round(source.height * scale))
        if (width, height) != source.size:
            source = source.resize((width, height), Image.Resampling.LANCZOS)

        jpeg_bytes = _encode_jpeg(source, quality, output_colorspace)
        if not jpeg_bytes or len(jpeg_bytes) >= len(obj.read_raw_bytes()):
            return False

        obj.write(jpeg_bytes, filter=pikepdf.Name("/DCTDecode"))
        obj.Width = width
        obj.Height = height
        obj.BitsPerComponent = 8
        obj.ColorSpace = pikepdf.Name(output_colorspace)
        for key in ("/Decode", "/DecodeParms", "/Mask", "/SMask", "/SMaskInData", "/ImageMask"):
            _drop_key(obj, key)
        return True
    except Exception:
        # Unsupported or malformed image encodings should not abort compression
        # for the other images in the document.
        return False


def _compress_profile(input_path: Path, output_path: Path, scale: float, quality: int) -> tuple[int, int]:
    visited: set[tuple[int, int]] = set()
    rewritten = 0
    pdf = pikepdf.open(input_path)
    try:
        for page in pdf.pages:
            # get_images() includes images inside Form XObjects, which many
            # scanned PDFs use for their actual page contents.
            for image_obj in page.get_images().values():
                object_id = tuple(image_obj.objgen)
                if object_id == (0, 0) or object_id in visited:
                    continue
                visited.add(object_id)
                if _rewrite_image(image_obj, scale, quality):
                    rewritten += 1

        pdf.save(
            output_path,
            compress_streams=True,
            recompress_flate=True,
            object_stream_mode=pikepdf.ObjectStreamMode.generate,
        )
    finally:
        pdf.close()

    return len(visited), rewritten


def compress(input_path: Path, output_path: Path) -> dict[str, object]:
    if not input_path.is_file():
        raise ValueError("Input PDF was not found.")
    original_size = input_path.stat().st_size
    if original_size <= 0 or original_size > MAX_INPUT_BYTES:
        raise ValueError("PDF must be between 1 byte and 100 MB.")

    best_path: Path | None = None
    best_size = original_size
    best_profile: tuple[float, int] | None = None
    best_rewritten = 0
    discovered_images = 0
    profiles_completed = 0
    last_failure: Exception | None = None

    with tempfile.TemporaryDirectory(prefix="pdf-engine-", dir=output_path.parent) as temp_dir:
        temp_root = Path(temp_dir)
        for index, (scale, quality) in enumerate(PROFILES):
            candidate_path = temp_root / f"candidate-{index}.pdf"
            try:
                image_count, rewritten = _compress_profile(input_path, candidate_path, scale, quality)
                candidate_size = candidate_path.stat().st_size
                profiles_completed += 1
            except Exception as error:
                last_failure = error
                continue

            discovered_images = max(discovered_images, image_count)
            if candidate_size < best_size:
                best_size = candidate_size
                best_path = candidate_path
                best_profile = (scale, quality)
                best_rewritten = rewritten

            # Avoid extra image damage once a very strong size reduction exists.
            if candidate_size <= original_size * 0.20:
                break

        if profiles_completed == 0:
            detail = str(last_failure) if last_failure else "no profile completed"
            raise RuntimeError(f"The local PDF image engine could not read this PDF: {detail}")

        if best_path is None:
            return {
                "changed": False,
                "originalBytes": original_size,
                "compressedBytes": original_size,
                "imagesFound": discovered_images,
                "imagesRewritten": 0,
                "profile": None,
            }

        output_path.write_bytes(best_path.read_bytes())

    return {
        "changed": True,
        "originalBytes": original_size,
        "compressedBytes": best_size,
        "imagesFound": discovered_images,
        "imagesRewritten": best_rewritten,
        "profile": {"scale": best_profile[0], "jpegQuality": best_profile[1]} if best_profile else None,
    }


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: pdf_compress_engine.py INPUT.pdf OUTPUT.pdf", file=sys.stderr)
        return 2

    try:
        result = compress(Path(sys.argv[1]), Path(sys.argv[2]))
    except Exception as error:
        print(str(error) or error.__class__.__name__, file=sys.stderr)
        return 1

    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
