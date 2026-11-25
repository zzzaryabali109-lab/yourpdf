/**
 * local-ocr.ts
 *
 * Searchable-PDF OCR engine powered by PaddleOCR (via the local Python
 * RapidOCR worker). Preserves the original scanned page image exactly —
 * only an invisible, accurately-positioned text layer is added.
 *
 * Architecture:
 *   Next.js (Node) → HTTP POST localhost:7331/ocr → Python RapidOCR worker
 *   Python worker returns per-page text boxes in rendered-image pixel coords.
 *   This module maps those pixel coords to PDF point coords and embeds
 *   invisible text using pdf-lib.
 *
 * API surface (unchanged):
 *   processPdfOcr(inputBytes, onPageProgress?) → OcrEngineResult
 */

import {
  PDFDocument,
  StandardFonts,
  rgb,
} from "pdf-lib";
import { callPaddleOcrWorker, type OcrPage } from "./paddle-ocr-client";

export type OcrEngineResult = {
  outputBytes: Buffer;
  originalSize: number;
  ocrSize: number;
  pageCount: number;
  textCharacters: number;
  recognizedText: string;
  hasSelectableText: boolean;
};

// ---------------------------------------------------------------------------
// Native text detection (fast-path: skip OCR for already-searchable PDFs)
// ---------------------------------------------------------------------------

async function extractExistingNativeText(bytes: Buffer): Promise<{
  pageTexts: string[];
  totalChars: number;
}> {
  try {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      useSystemFonts: true,
      disableFontFace: true,
    });
    const pdf = await loadingTask.promise;
    const pageTexts: string[] = [];
    let totalChars = 0;

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageStr = textContent.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pageTexts.push(pageStr);
      totalChars += pageStr.length;
    }

    await loadingTask.destroy().catch(() => undefined);
    return { pageTexts, totalChars };
  } catch (err) {
    console.warn("[OCR] Native text inspection skipped:", err);
    return { pageTexts: [], totalChars: 0 };
  }
}

// ---------------------------------------------------------------------------
// Coordinate mapping: image pixel → PDF point
// ---------------------------------------------------------------------------

/**
 * Map a bounding box from rendered-image pixel space to PDF user-space points.
 *
 * PDF origin is bottom-left; image origin is top-left.
 * Scale factors: pts_per_px = page_pts / img_px
 *
 * @param bbox    [x0_px, y0_px, x1_px, y1_px] in rendered image pixels
 * @param imgW    rendered image width  (pixels)
 * @param imgH    rendered image height (pixels)
 * @param pageW   PDF page width  (pts)
 * @param pageH   PDF page height (pts)
 * @returns       { x, y, width, height, fontSize } in PDF points, y = baseline
 */
function mapBoxToPdfCoords(
  bbox: [number, number, number, number],
  imgW: number,
  imgH: number,
  pageW: number,
  pageH: number,
): { x: number; y: number; width: number; height: number; fontSize: number } {
  const [x0_px, y0_px, x1_px, y1_px] = bbox;

  const scaleX = pageW / imgW;
  const scaleY = pageH / imgH;

  const boxWidthPx  = x1_px - x0_px;

  // PDF Y-axis is flipped: y0_px (top in image) → pageH - (y0_px * scaleY) (in PDF)
  // We use the bottom of the text box as the glyph baseline.
  const pdfX      = Math.max(0, x0_px * scaleX);
  const pdfYTop   = pageH - y0_px * scaleY;   // top of box in PDF coords
  const pdfYBot   = pageH - y1_px * scaleY;   // bottom of box in PDF coords
  const boxH_pts  = pdfYTop - pdfYBot;        // positive height in pts

  // Baseline sits ~15% up from bottom of the bounding box (empirical Helvetica)
  const baseline  = Math.max(2, pdfYBot + boxH_pts * 0.15);
  const fontSize  = Math.max(6, Math.min(72, boxH_pts * 0.85));
  const width     = Math.max(1, boxWidthPx * scaleX);
  const height    = Math.max(1, boxH_pts);

  return { x: pdfX, y: baseline, width, height, fontSize };
}

// ---------------------------------------------------------------------------
// Invisible text embedding
// ---------------------------------------------------------------------------

async function embedInvisibleTextLayer(
  doc: PDFDocument,
  pageIndex: number,
  ocrPage: OcrPage,
  helveticaFont: Awaited<ReturnType<typeof doc.embedFont>>,
): Promise<{ pageText: string; charCount: number; lowConfCount: number }> {
  const page      = doc.getPage(pageIndex);
  const pageW     = page.getWidth();
  const pageH     = page.getHeight();
  const imgW      = ocrPage.img_width_px;
  const imgH      = ocrPage.img_height_px;

  if (!imgW || !imgH || ocrPage.boxes.length === 0) {
    return { pageText: "", charCount: 0, lowConfCount: 0 };
  }

  const textLines: string[] = [];
  let lowConfCount = 0;

  for (const box of ocrPage.boxes) {
    const cleanText = box.text
      .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
      .trim();
    if (!cleanText) continue;

    if (box.low_confidence) {
      lowConfCount++;
      console.warn(
        `[OCR] Low-confidence text (${(box.confidence * 100).toFixed(0)}%) on page ${pageIndex + 1}: "${cleanText}"`,
      );
    }

    const { x, y, fontSize } = mapBoxToPdfCoords(
      box.bbox as [number, number, number, number],
      imgW,
      imgH,
      pageW,
      pageH,
    );

    try {
      page.drawText(cleanText, {
        x: Math.min(x, pageW - 2),
        y: Math.max(2, Math.min(y, pageH - 2)),
        size: fontSize,
        font: helveticaFont,
        color: rgb(0, 0, 0),
        opacity: 0, // Fully invisible — preserves scanned image appearance
      });
    } catch {
      // Ignore individual glyph encoding failures
    }

    textLines.push(cleanText);
  }

  return {
    pageText: textLines.join("\n"),
    charCount: textLines.reduce((s, t) => s + t.length, 0),
    lowConfCount,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function processPdfOcr(
  inputBytes: Buffer,
  onPageProgress?: (completedPage: number, totalPages: number) => void,
): Promise<OcrEngineResult> {
  const doc        = await PDFDocument.load(inputBytes, { ignoreEncryption: true });
  const totalPages = doc.getPageCount();

  // ── Fast-path: PDF already has native selectable text ────────────────────
  const nativeText      = await extractExistingNativeText(inputBytes);
  const minTextThreshold = Math.max(40, totalPages * 20);

  if (nativeText.totalChars >= minTextThreshold) {
    const allText = nativeText.pageTexts
      .map((t, idx) => (t ? `--- Page ${idx + 1} ---\n${t}` : ""))
      .filter(Boolean)
      .join("\n\n");

    onPageProgress?.(totalPages, totalPages);

    return {
      outputBytes:      inputBytes,
      originalSize:     inputBytes.byteLength,
      ocrSize:          inputBytes.byteLength,
      pageCount:        totalPages,
      textCharacters:   nativeText.totalChars,
      recognizedText:   allText,
      hasSelectableText: true,
    };
  }

  // ── Scanned-document path: call the PaddleOCR worker ─────────────────────
  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  console.log(`[OCR] Sending ${totalPages}-page PDF to PaddleOCR worker (job ${jobId})`);

  let ocrResponse;
  try {
    ocrResponse = await callPaddleOcrWorker(inputBytes, jobId);
  } catch (err) {
    console.error("[OCR] PaddleOCR worker call failed:", err);
    throw err; // Let adobe-ocr.ts surface the error to the UI
  }

  const helveticaFont = await doc.embedFont(StandardFonts.Helvetica);
  let allRecognizedText = "";
  let totalCharacters   = 0;
  let totalLowConf      = 0;

  for (const ocrPage of ocrResponse.pages) {
    const pageIdx = ocrPage.page_num;

    if (ocrPage.error) {
      console.error(`[OCR] Page ${pageIdx + 1} error from worker: ${ocrPage.error}`);
      onPageProgress?.(pageIdx + 1, totalPages);
      continue;
    }

    if (ocrPage.skipped) {
      // Page already has native text — keep it as-is
      onPageProgress?.(pageIdx + 1, totalPages);
      continue;
    }

    const { pageText, charCount, lowConfCount } = await embedInvisibleTextLayer(
      doc,
      pageIdx,
      ocrPage,
      helveticaFont,
    );

    totalLowConf += lowConfCount;

    if (pageText) {
      allRecognizedText +=
        (allRecognizedText ? "\n\n" : "") + `--- Page ${pageIdx + 1} ---\n` + pageText;
      totalCharacters += charCount;
    }

    onPageProgress?.(pageIdx + 1, totalPages);
  }

  if (totalLowConf > 0) {
    console.warn(
      `[OCR] ${totalLowConf} low-confidence text box(es) across all pages. ` +
        "Review the OCR output for potential misreads.",
    );
  }

  const outputBytes = Buffer.from(await doc.save({ useObjectStreams: true }));

  return {
    outputBytes,
    originalSize:     inputBytes.byteLength,
    ocrSize:          outputBytes.byteLength,
    pageCount:        totalPages,
    textCharacters:   totalCharacters,
    recognizedText:   allRecognizedText,
    hasSelectableText: totalCharacters > 0,
  };
}
