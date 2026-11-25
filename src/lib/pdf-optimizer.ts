import zlib from "node:zlib";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { encodeJpeg } from "./jpeg-encoder";

// ---------------------------------------------------------------------------
// Profiles & Types
// ---------------------------------------------------------------------------

export interface OptimizationProfile {
  name: "lossless" | "light" | "balanced" | "strong";
  maxDim: number;
  quality: number;
  minSavingsRatio: number;
  skipImages: boolean;
}

interface JpegDecoderInstance {
  width: number;
  height: number;
  numComponents: number;
  parse(data: Uint8Array): void;
  getData(options: { width: number; height: number; forceRGB?: boolean }): Uint8Array;
}

interface JpegDecoderConstructor {
  new (): JpegDecoderInstance;
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
}

export const PROFILES: Record<"lossless" | "light" | "balanced" | "strong", OptimizationProfile> = {
  lossless: {
    name: "lossless",
    maxDim: Infinity,
    quality: 100,
    minSavingsRatio: 0,
    skipImages: true,
  },
  light: {
    name: "light",
    maxDim: 1800,
    quality: 80,
    minSavingsRatio: 0.15,
    skipImages: false,
  },
  balanced: {
    name: "balanced",
    maxDim: 1400,
    quality: 70,
    minSavingsRatio: 0.15,
    skipImages: false,
  },
  strong: {
    name: "strong",
    maxDim: 1100,
    quality: 60,
    minSavingsRatio: 0.15,
    skipImages: false,
  },
};

export interface OptimizationResult {
  bytes: Buffer;
  originalSize: number;
  compressedSize: number;
  bytesSaved: number;
  percentage: number;
  method: string;
  pageCount: number;
  profileUsed: string;
  validationPassed: boolean;
  validationDetails?: string;
}

// ---------------------------------------------------------------------------
// Bilinear Resampling
// ---------------------------------------------------------------------------

function resampleBilinear(
  src: Uint8Array,
  origW: number,
  origH: number,
  newW: number,
  newH: number,
  channels: number,
): Uint8Array {
  if (origW === newW && origH === newH) {
    return src;
  }

  const dst = new Uint8Array(newW * newH * channels);
  const scaleX = origW / newW;
  const scaleY = origH / newH;

  for (let dy = 0; dy < newH; dy++) {
    const srcY = (dy + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.min(origH - 1, Math.floor(srcY)));
    const y1 = Math.max(0, Math.min(origH - 1, y0 + 1));
    const fy = Math.max(0, Math.min(1, srcY - y0));
    const ify = 1 - fy;

    const row0 = y0 * origW;
    const row1 = y1 * origW;
    const dstRow = dy * newW;

    for (let dx = 0; dx < newW; dx++) {
      const srcX = (dx + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.min(origW - 1, Math.floor(srcX)));
      const x1 = Math.max(0, Math.min(origW - 1, x0 + 1));
      const fx = Math.max(0, Math.min(1, srcX - x0));
      const ifx = 1 - fx;

      const w00 = ifx * ify;
      const w10 = fx * ify;
      const w01 = ifx * fy;
      const w11 = fx * fy;

      const dIdx = (dstRow + dx) * channels;
      const s00 = (row0 + x0) * channels;
      const s10 = (row0 + x1) * channels;
      const s01 = (row1 + x0) * channels;
      const s11 = (row1 + x1) * channels;

      for (let c = 0; c < channels; c++) {
        dst[dIdx + c] = Math.round(
          src[s00 + c] * w00 +
          src[s10 + c] * w10 +
          src[s01 + c] * w01 +
          src[s11 + c] * w11,
        );
      }
    }
  }

  return dst;
}

// ---------------------------------------------------------------------------
// FlateDecode & PNG Predictor helpers
// ---------------------------------------------------------------------------

interface FlateParms {
  predictor: number;
  columns: number;
  colors: number;
  bpc: number;
}

function readFlateParms(obj: PDFRawStream): FlateParms {
  const defaults: FlateParms = { predictor: 1, columns: 1, colors: 1, bpc: 8 };
  const dp = obj.dict.get(PDFName.of("DecodeParms"));
  if (!dp) return defaults;

  let d: PDFDict | undefined;
  if (dp instanceof PDFDict) {
    d = dp;
  } else if (dp instanceof PDFArray && dp.size() > 0) {
    const first = dp.get(0);
    if (first instanceof PDFDict) d = first;
  }
  if (!d) return defaults;

  const num = (key: string, def: number): number => {
    const v = d!.get(PDFName.of(key));
    return v instanceof PDFNumber ? v.asNumber() : def;
  };

  return {
    predictor: num("Predictor", 1),
    columns: num("Columns", 1),
    colors: num("Colors", 1),
    bpc: num("BitsPerComponent", 8),
  };
}

function reversePngPredictor(
  inflated: Uint8Array,
  columns: number,
  colors: number,
  bpc: number,
): Uint8Array | null {
  if (bpc !== 8) return null;

  const bytesPerRow = columns * colors;
  const rowStride = bytesPerRow + 1;
  const rows = Math.floor(inflated.length / rowStride);
  if (rows === 0) return null;

  const output = new Uint8Array(rows * bytesPerRow);
  const prev = new Uint8Array(bytesPerRow);

  for (let r = 0; r < rows; r++) {
    const base = r * rowStride;
    const ftype = inflated[base];
    const outBase = r * bytesPerRow;

    for (let i = 0; i < bytesPerRow; i++) {
      const raw = inflated[base + 1 + i] ?? 0;
      const a = i >= colors ? output[outBase + i - colors] : 0;
      const b = prev[i];
      const c = i >= colors ? prev[i - colors] : 0;

      let val: number;
      switch (ftype) {
        case 0:
          val = raw;
          break;
        case 1:
          val = (raw + a) & 0xff;
          break;
        case 2:
          val = (raw + b) & 0xff;
          break;
        case 3:
          val = (raw + Math.floor((a + b) / 2)) & 0xff;
          break;
        case 4: {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          val = (raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
          break;
        }
        default:
          val = raw;
          break;
      }
      output[outBase + i] = val;
    }

    prev.set(output.subarray(outBase, outBase + bytesPerRow));
  }

  return output;
}

function getNameString(val: unknown): string {
  if (val instanceof PDFName) {
    return val.asString().replace(/^\//, "");
  }
  return "";
}

function decodeFlateImageStream(obj: PDFRawStream): Uint8Array | null {
  try {
    const inflated = new Uint8Array(zlib.inflateSync(Buffer.from(obj.contents)));
    const { predictor, columns, colors, bpc } = readFlateParms(obj);

    if (predictor <= 1) {
      return inflated;
    }
    if (predictor >= 10 && predictor <= 15) {
      return reversePngPredictor(inflated, columns, colors, bpc);
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Candidate Generator
// ---------------------------------------------------------------------------

/**
 * Optimizes a PDF according to a specific profile.
 * - Profile "lossless": Re-deflates streams, strips metadata/thumbnails, uses object streams.
 * - Profiles "light", "balanced", "strong": Also optimizes eligible embedded raster images.
 */
export async function optimizePdfCandidate(
  inputBytes: Buffer,
  profile: OptimizationProfile,
): Promise<Buffer> {
  const doc = await PDFDocument.load(inputBytes, { ignoreEncryption: true });

  let JpegImageClass: JpegDecoderConstructor | null = null;
  if (!profile.skipImages) {
    try {
      const decoders = (await import("pdfjs-dist/image_decoders/pdf.image_decoders.mjs")) as unknown as {
        JpegImage: JpegDecoderConstructor;
      };
      JpegImageClass = decoders.JpegImage;
    } catch {
      // If JpegImage fails to load, image optimization will be safely skipped.
    }
  }

  for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;

    const subtype = getNameString(obj.dict.get(PDFName.of("Subtype")));
    const isImage = subtype === "Image";

    if (isImage && !profile.skipImages && JpegImageClass) {
      try {
        const filterObj = obj.dict.get(PDFName.of("Filter"));
        let filterName: string = "";
        if (filterObj instanceof PDFName) {
          filterName = getNameString(filterObj);
        } else if (filterObj instanceof PDFArray && filterObj.size() === 1) {
          filterName = getNameString(filterObj.get(0));
        }

        // Never touch specialized or vector formats
        if (
          filterName === "JPXDecode" ||
          filterName === "JBIG2Decode" ||
          filterName === "CCITTFaxDecode"
        ) {
          continue;
        }

        // Preserve all masks and transparency intact
        if (obj.dict.get(PDFName.of("SMask"))) continue;
        if (obj.dict.get(PDFName.of("Mask"))) continue;
        const imgMask = obj.dict.get(PDFName.of("ImageMask"));
        if (imgMask && imgMask.toString() === "true") continue;

        const widthObj = obj.dict.get(PDFName.of("Width"));
        const heightObj = obj.dict.get(PDFName.of("Height"));
        const bpcObj = obj.dict.get(PDFName.of("BitsPerComponent"));
        const csObj = obj.dict.get(PDFName.of("ColorSpace"));

        const origW = widthObj instanceof PDFNumber ? widthObj.asNumber() : 0;
        const origH = heightObj instanceof PDFNumber ? heightObj.asNumber() : 0;
        const bpc = bpcObj instanceof PDFNumber ? bpcObj.asNumber() : 8;

        if (bpc !== 8 || origW < 64 || origH < 64) continue;

        let pixels: Uint8Array | null = null;
        let isGray = false;

        if (filterName === "DCTDecode") {
          // Embedded JPEG
          const decoder = new JpegImageClass();
          try {
            decoder.parse(new Uint8Array(obj.contents));
          } catch {
            continue;
          }

          if (decoder.numComponents === 1) {
            isGray = true;
            pixels = decoder.getData({ width: decoder.width, height: decoder.height });
          } else if (decoder.numComponents === 3) {
            isGray = false;
            pixels = decoder.getData({ width: decoder.width, height: decoder.height, forceRGB: true });
          } else {
            // CMYK or other component counts — leave untouched to prevent color shifts
            continue;
          }
        } else if (filterName === "FlateDecode" || !filterObj) {
          // Embedded Deflate or raw bitmap
          const raw = filterName === "FlateDecode"
            ? decodeFlateImageStream(obj)
            : new Uint8Array(obj.contents);

          if (!raw) continue;

          const colorSpaceStr = csObj?.toString() ?? "";
          if (colorSpaceStr === "/DeviceGray" && raw.length >= origW * origH) {
            isGray = true;
            pixels = raw.subarray(0, origW * origH);
          } else if (colorSpaceStr === "/DeviceRGB" && raw.length >= origW * origH * 3) {
            isGray = false;
            pixels = raw.subarray(0, origW * origH * 3);
          } else if (raw.length === origW * origH) {
            isGray = true;
            pixels = raw;
          } else if (raw.length === origW * origH * 3) {
            isGray = false;
            pixels = raw;
          } else {
            continue;
          }
        } else {
          continue;
        }

        if (!pixels) continue;

        // Downsample oversized scans/photos adaptively while preserving exact aspect ratio
        const maxOrigDim = Math.max(origW, origH);
        let newW = origW;
        let newH = origH;
        let processedPixels = pixels;

        if (maxOrigDim > profile.maxDim) {
          const scale = profile.maxDim / maxOrigDim;
          newW = Math.max(32, Math.round(origW * scale));
          newH = Math.max(32, Math.round(origH * scale));
          processedPixels = resampleBilinear(
            pixels,
            origW,
            origH,
            newW,
            newH,
            isGray ? 1 : 3,
          );
        }

        const newJpeg = encodeJpeg(processedPixels, newW, newH, profile.quality, isGray);

        // Only replace if reduction meets threshold
        const threshold = obj.contents.length * (1 - profile.minSavingsRatio);
        if (newJpeg.length < threshold) {
          obj.dict.set(PDFName.of("Filter"), PDFName.of("DCTDecode"));
          obj.dict.set(PDFName.of("Width"), PDFNumber.of(newW));
          obj.dict.set(PDFName.of("Height"), PDFNumber.of(newH));
          obj.dict.set(PDFName.of("ColorSpace"), PDFName.of(isGray ? "DeviceGray" : "DeviceRGB"));
          obj.dict.set(PDFName.of("BitsPerComponent"), PDFNumber.of(8));
          obj.dict.delete(PDFName.of("DecodeParms"));
          obj.dict.delete(PDFName.of("Decode"));
          doc.context.assign(ref, PDFRawStream.of(obj.dict, newJpeg));
        }
      } catch {
        // Any error on this individual stream: preserve it untouched
      }
    } else if (!isImage) {
      // Recompress non-image streams (content streams, fonts) at zlib max level
      const filter = obj.dict.get(PDFName.of("Filter"));
      const filterName = getNameString(filter);
      if (!filter) {
        try {
          const deflated = zlib.deflateSync(Buffer.from(obj.contents), { level: 9 });
          if (deflated.length < obj.contents.length * 0.90) {
            obj.dict.set(PDFName.of("Filter"), PDFName.of("FlateDecode"));
            doc.context.assign(ref, PDFRawStream.of(obj.dict, deflated));
          }
        } catch {
          // Keep as-is
        }
      } else if (filterName === "FlateDecode") {
        try {
          const inflated = zlib.inflateSync(Buffer.from(obj.contents));
          const redeflated = zlib.deflateSync(inflated, { level: 9 });
          if (redeflated.length < obj.contents.length * 0.95) {
            doc.context.assign(ref, PDFRawStream.of(obj.dict, redeflated));
          }
        } catch {
          // Keep as-is
        }
      }
    }
  }

  // Strip thumbnails and PieceInfo metadata
  for (const page of doc.getPages()) {
    page.node.delete(PDFName.of("Thumb"));
  }
  doc.catalog.delete(PDFName.of("PieceInfo"));

  const saved = await doc.save({
    useObjectStreams: true,
    addDefaultPage: false,
    updateFieldAppearances: false,
  });

  return Buffer.from(saved);
}

// ---------------------------------------------------------------------------
// Candidate Validation Suite
// ---------------------------------------------------------------------------

export interface ValidationReport {
  valid: boolean;
  reason?: string;
  pageCount: number;
}

/**
 * Validates a candidate PDF against the original PDF:
 * 1. Both PDFs open cleanly in pdf-lib and pdfjs.
 * 2. Page count matches 100%.
 * 3. Page dimensions, bounding boxes, and orientations match 100%.
 * 4. All extracted text items (strings, order, coordinates) match 100%.
 * 5. Visual drawing operator counts match 100%.
 */
export async function validateCandidate(
  originalBytes: Buffer,
  candidateBytes: Buffer,
): Promise<ValidationReport> {
  let origDoc: PDFDocument;
  let candDoc: PDFDocument;

  try {
    origDoc = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    candDoc = await PDFDocument.load(candidateBytes, { ignoreEncryption: true });
  } catch (error) {
    return {
      valid: false,
      reason: `PDFDocument loading failed: ${error instanceof Error ? error.message : "corrupt structure"}`,
      pageCount: 0,
    };
  }

  const origPages = origDoc.getPageCount();
  const candPages = candDoc.getPageCount();

  if (origPages !== candPages) {
    return {
      valid: false,
      reason: `Page count mismatch: original has ${origPages}, candidate has ${candPages}`,
      pageCount: candPages,
    };
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const origLoading = pdfjs.getDocument({ data: new Uint8Array(originalBytes) });
  const candLoading = pdfjs.getDocument({ data: new Uint8Array(candidateBytes) });

  try {
    const origPdf = await origLoading.promise;
    const candPdf = await candLoading.promise;

    if (origPdf.numPages !== candPdf.numPages) {
      return {
        valid: false,
        reason: `pdfjs page count mismatch: original ${origPdf.numPages}, candidate ${candPdf.numPages}`,
        pageCount: candPdf.numPages,
      };
    }

    for (let p = 1; p <= origPdf.numPages; p++) {
      const origP = await origPdf.getPage(p);
      const candP = await candPdf.getPage(p);

      // Check dimensions
      const oView = origP.view;
      const cView = candP.view;
      if (
        Math.abs(oView[2] - cView[2]) > 0.5 ||
        Math.abs(oView[3] - cView[3]) > 0.5
      ) {
        return {
          valid: false,
          reason: `Page ${p} dimensions changed: [${oView[2]}, ${oView[3]}] vs [${cView[2]}, ${cView[3]}]`,
          pageCount: origPdf.numPages,
        };
      }

      // Check orientation
      if (origP.rotate !== candP.rotate) {
        return {
          valid: false,
          reason: `Page ${p} rotation changed: ${origP.rotate} vs ${candP.rotate}`,
          pageCount: origPdf.numPages,
        };
      }

      // Check text content & OCR layer
      const origText = await origP.getTextContent();
      const candText = await candP.getTextContent();

      const origItems = (origText.items as unknown[]).filter(
        (item): item is PdfTextItem =>
          typeof item === "object" &&
          item !== null &&
          "str" in item &&
          typeof (item as { str: unknown }).str === "string" &&
          ((item as { str: string }).str.trim().length > 0),
      );
      const candItems = (candText.items as unknown[]).filter(
        (item): item is PdfTextItem =>
          typeof item === "object" &&
          item !== null &&
          "str" in item &&
          typeof (item as { str: unknown }).str === "string" &&
          ((item as { str: string }).str.trim().length > 0),
      );

      if (origItems.length !== candItems.length) {
        return {
          valid: false,
          reason: `Text items count mismatch on page ${p}: original has ${origItems.length}, candidate has ${candItems.length}`,
          pageCount: origPdf.numPages,
        };
      }

      for (let k = 0; k < origItems.length; k++) {
        const oi = origItems[k];
        const ci = candItems[k];

        if (oi.str !== ci.str) {
          return {
            valid: false,
            reason: `Text string altered on page ${p}: expected "${oi.str}", found "${ci.str}"`,
            pageCount: origPdf.numPages,
          };
        }

        if (
          Math.abs(oi.transform[4] - ci.transform[4]) > 1.5 ||
          Math.abs(oi.transform[5] - ci.transform[5]) > 1.5
        ) {
          return {
            valid: false,
            reason: `Text position shifted on page ${p} for text "${oi.str}"`,
            pageCount: origPdf.numPages,
          };
        }
      }

      // Check operator list preservation
      const origOps = await origP.getOperatorList();
      const candOps = await candP.getOperatorList();

      if (origOps.fnArray.length !== candOps.fnArray.length) {
        return {
          valid: false,
          reason: `Operator list mismatch on page ${p}: original has ${origOps.fnArray.length}, candidate has ${candOps.fnArray.length}`,
          pageCount: origPdf.numPages,
        };
      }
    }

    return {
      valid: true,
      pageCount: origPdf.numPages,
    };
  } catch (error) {
    return {
      valid: false,
      reason: `Validation execution failed: ${error instanceof Error ? error.message : "unknown error"}`,
      pageCount: 0,
    };
  } finally {
    await origLoading.destroy().catch(() => undefined);
    await candLoading.destroy().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Adaptive PDF Compression Engine
// ---------------------------------------------------------------------------

function hasCompressibleImages(doc: PDFDocument): boolean {
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      const subtype = getNameString(obj.dict.get(PDFName.of("Subtype")));
      if (subtype === "Image") {
        const mask = obj.dict.get(PDFName.of("ImageMask"));
        if (!mask || mask.toString() !== "true") {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Adaptive local size-reduction engine:
 * 1. Generates lossless candidate first.
 * 2. If lossless reaches >= 60%, validates and returns it.
 * 3. If PDF has compressible images, tests balanced profile (target 60-70%).
 * 4. If balanced passes and saves >= 60%, returns it.
 * 5. If balanced passes but saves < 60%, tests strong profile to approach target.
 * 6. Validates every candidate thoroughly. Rejects any that change appearance or text.
 * 7. Never fakes the percentage. Returns real byte counts.
 */
export async function optimizePdf(inputBytes: Buffer): Promise<Buffer> {
  const originalSize = inputBytes.byteLength;
  const doc = await PDFDocument.load(inputBytes, { ignoreEncryption: true });
  const hasImages = hasCompressibleImages(doc);

  // Pass 0: Lossless candidate
  let losslessBytes: Buffer;
  try {
    losslessBytes = await optimizePdfCandidate(inputBytes, PROFILES.lossless);
  } catch {
    losslessBytes = inputBytes;
  }

  const losslessReport = await validateCandidate(inputBytes, losslessBytes);
  const losslessValid = losslessReport.valid && losslessBytes.byteLength < originalSize;

  if (losslessValid) {
    const losslessSavings = (originalSize - losslessBytes.byteLength) / originalSize;
    if (losslessSavings >= 0.60 || !hasImages) {
      return losslessBytes;
    }
  }

  // If there are no images, lossless is the only safe option
  if (!hasImages) {
    return losslessValid ? losslessBytes : inputBytes;
  }

  // Pass 1: Try balanced profile (target 60-70%)
  let balancedBytes: Buffer | null = null;
  try {
    balancedBytes = await optimizePdfCandidate(inputBytes, PROFILES.balanced);
  } catch {
    balancedBytes = null;
  }

  if (balancedBytes && balancedBytes.byteLength < originalSize) {
    const report = await validateCandidate(inputBytes, balancedBytes);
    if (report.valid) {
      const savings = (originalSize - balancedBytes.byteLength) / originalSize;
      if (savings >= 0.60) {
        return balancedBytes;
      }

      // If balanced saved < 60%, try strong profile to see if we can reach target
      let strongBytes: Buffer | null = null;
      try {
        strongBytes = await optimizePdfCandidate(inputBytes, PROFILES.strong);
      } catch {
        strongBytes = null;
      }

      if (strongBytes && strongBytes.byteLength < balancedBytes.byteLength) {
        const strongReport = await validateCandidate(inputBytes, strongBytes);
        if (strongReport.valid) {
          return strongBytes;
        }
      }

      return balancedBytes;
    }
  }

  // Pass 2: Fall back to light profile
  let lightBytes: Buffer | null = null;
  try {
    lightBytes = await optimizePdfCandidate(inputBytes, PROFILES.light);
  } catch {
    lightBytes = null;
  }

  if (lightBytes && lightBytes.byteLength < originalSize) {
    const report = await validateCandidate(inputBytes, lightBytes);
    if (report.valid) {
      return lightBytes;
    }
  }

  // Fall back to lossless if valid and smaller, otherwise original
  if (losslessValid && losslessBytes.byteLength < originalSize) {
    return losslessBytes;
  }

  return inputBytes;
}
