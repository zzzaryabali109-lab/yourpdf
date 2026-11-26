/**
 * Local backend compression handler for transient documents.
 * Keeps the existing API response compatible with the compression page.
 */

import { PDFDocument } from "pdf-lib";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { getTransientDocument, saveCompressedPdf } from "@/lib/storage";

const MAX_PDF_SIZE = 100 * 1024 * 1024;
const MAX_CONCURRENT_COMPRESSIONS = 1;
const GHOSTSCRIPT_TIME_BUDGET_MS = 90_000;
const execFileAsync = promisify(execFile);

const GHOSTSCRIPT_PROFILES = [
  // The upstream Quartz filter scales images to 90% and uses JPEG quality
  // -0.70. Ghostscript has no relative image-scale setting, so start near
  // 90% of a 300 DPI scan, then lower the ceiling only if needed.
  { dpi: 270, qFactor: 0.7 },
  { dpi: 240, qFactor: 0.7 },
  { dpi: 210, qFactor: 0.7 },
  { dpi: 180, qFactor: 0.7 },
  { dpi: 150, qFactor: 0.7 },
  { dpi: 120, qFactor: 0.7 },
] as const;

let activeCompressions = 0;
const compressionQueue: Array<() => void> = [];

function acquireCompressionSlot(): Promise<void> {
  return new Promise((resolve) => {
    if (activeCompressions < MAX_CONCURRENT_COMPRESSIONS) {
      activeCompressions++;
      resolve();
      return;
    }

    compressionQueue.push(() => {
      activeCompressions++;
      resolve();
    });
  });
}

function releaseCompressionSlot(): void {
  activeCompressions--;
  compressionQueue.shift()?.();
}

function hasPdfSignature(bytes: Buffer): boolean {
  return bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"));
}

async function validateCompressionCandidate(
  originalBytes: Buffer,
  candidateBytes: Buffer,
): Promise<boolean> {
  let originalPdf: PDFDocument;
  let candidatePdf: PDFDocument;

  try {
    originalPdf = await PDFDocument.load(originalBytes, { ignoreEncryption: true });
    candidatePdf = await PDFDocument.load(candidateBytes, { ignoreEncryption: true });
  } catch {
    return false;
  }

  if (originalPdf.getPageCount() !== candidatePdf.getPageCount()) return false;

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const originalLoading = pdfjs.getDocument({ data: new Uint8Array(originalBytes) });
  const candidateLoading = pdfjs.getDocument({ data: new Uint8Array(candidateBytes) });

  try {
    const [originalDocument, candidateDocument] = await Promise.all([
      originalLoading.promise,
      candidateLoading.promise,
    ]);

    for (let pageNumber = 1; pageNumber <= originalDocument.numPages; pageNumber++) {
      const [originalPage, candidatePage] = await Promise.all([
        originalDocument.getPage(pageNumber),
        candidateDocument.getPage(pageNumber),
      ]);

      const originalView = originalPage.view;
      const candidateView = candidatePage.view;
      const originalText = await originalPage.getTextContent();
      const candidateText = await candidatePage.getTextContent();
      const normalizeText = (items: unknown[]) =>
        items
          .map((item) => {
            if (typeof item !== "object" || item === null || !("str" in item)) return "";
            const value = (item as { str?: unknown }).str;
            return typeof value === "string" ? value : "";
          })
          .join("")
          .replace(/\s+/g, " ")
          .trim();

      if (
        Math.abs((originalView[2] - originalView[0]) - (candidateView[2] - candidateView[0])) > 0.5 ||
        Math.abs((originalView[3] - originalView[1]) - (candidateView[3] - candidateView[1])) > 0.5 ||
        originalPage.rotate !== candidatePage.rotate ||
        normalizeText(originalText.items as unknown[]) !== normalizeText(candidateText.items as unknown[])
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  } finally {
    await originalLoading.destroy().catch(() => undefined);
    await candidateLoading.destroy().catch(() => undefined);
  }
}

function hasInteractiveContent(document: PDFDocument): boolean {
  if (document.catalog.AcroForm()) return true;

  return document.getPages().some((page) => {
    const annotations = page.node.Annots();
    return Boolean(annotations && annotations.size() > 0);
  });
}

async function compressWithLocalImageFilter(inputBytes: Buffer, document: PDFDocument): Promise<Buffer | null> {
  // The reference implementation redraws pages, so avoid rewriting PDFs that
  // contain interactive elements the source Quartz path would not preserve.
  if (hasInteractiveContent(document)) return null;

  const workingDirectory = await mkdtemp(path.join(os.tmpdir(), "yourpdf-compress-"));
  const inputPath = path.join(workingDirectory, "input.pdf");
  const outputPath = path.join(workingDirectory, "output.pdf");
  const startedAt = Date.now();
  let bestCandidate: Buffer | null = null;
  let successfulProfiles = 0;
  let lastFailure: unknown;

  try {
    await writeFile(inputPath, inputBytes, { mode: 0o600 });

    for (const profile of GHOSTSCRIPT_PROFILES) {
      const remainingTime = GHOSTSCRIPT_TIME_BUDGET_MS - (Date.now() - startedAt);
      if (remainingTime < 1_000) break;

      await rm(outputPath, { force: true }).catch(() => undefined);
      const imageDictionary = `<< /QFactor ${profile.qFactor} /Blend 1 /HSamples [2 1 1 2] /VSamples [2 1 1 2] >>`;
      const parameters = `<< /ColorImageDict ${imageDictionary} /GrayImageDict ${imageDictionary} /LockDistillerParams true >> setdistillerparams`;
      const args = [
        "-dSAFER",
        "-dBATCH",
        "-dNOPAUSE",
        "-dQUIET",
        "-dPDFSTOPONERROR",
        "-sDEVICE=pdfwrite",
        "-dCompatibilityLevel=1.7",
        "-dAutoRotatePages=/None",
        "-dPreserveAnnots=true",
        "-dCompressFonts=true",
        "-dCompressPages=true",
        "-dDetectDuplicateImages=true",
        "-dPassThroughJPEGImages=false",
        "-dPassThroughJPXImages=false",
        "-dAutoFilterColorImages=false",
        "-dAutoFilterGrayImages=false",
        "-dColorImageFilter=/DCTEncode",
        "-dGrayImageFilter=/DCTEncode",
        "-dDownsampleColorImages=true",
        "-dDownsampleGrayImages=true",
        `-dColorImageResolution=${profile.dpi}`,
        `-dGrayImageResolution=${profile.dpi}`,
        "-dColorImageDownsampleThreshold=1.0",
        "-dGrayImageDownsampleThreshold=1.0",
        "-dColorImageDownsampleType=/Bicubic",
        "-dGrayImageDownsampleType=/Bicubic",
        "-dDownsampleMonoImages=false",
        `-sOutputFile=${outputPath}`,
        "-c",
        parameters,
        "-f",
        inputPath,
      ];

      try {
        await execFileAsync("gs", args, {
          timeout: remainingTime,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
        });
        successfulProfiles++;

        const candidate = await readFile(outputPath);
        if (!hasPdfSignature(candidate) || candidate.byteLength >= inputBytes.byteLength) continue;

        if (!await validateCompressionCandidate(inputBytes, candidate)) continue;

        if (!bestCandidate || candidate.byteLength < bestCandidate.byteLength) {
          bestCandidate = candidate;
        }

        // Stop once the requested reduction range is reached to avoid
        // sacrificing additional image detail.
        if (candidate.byteLength <= inputBytes.byteLength * 0.2) break;
      } catch (error) {
        // The Linux deployment installs Ghostscript. Surface a clear message
        // instead of silently using a different compression implementation.
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          throw new Error("The local PDF compression engine is unavailable. Please redeploy the service.");
        }
        lastFailure = error;
      }
    }

    if (successfulProfiles === 0 && lastFailure) {
      const detail = lastFailure instanceof Error ? lastFailure.message : "unknown Ghostscript error";
      throw new Error(`The local PDF compression engine could not process this file: ${detail}`);
    }

    return bestCandidate;
  } finally {
    await rm(workingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

export type CompressDocumentResult = {
  id: string;
  filename: string;
  originalSize: number;
  compressedSize: number;
  bytesSaved: number;
  percentage: number;
  downloadUrl: string;
  method: string;
  pageCount: number;
};

/**
 * Compresses a PDF with a Quartz-filter-inspired local image recompression pass.
 */
export async function compressTransientDocument(
  id: string,
): Promise<CompressDocumentResult> {
  const document = getTransientDocument(id);
  if (!document) {
    throw new Error(
      "Document not found or temporary session expired. Please re-upload your PDF.",
    );
  }

  if (document.processing) {
    throw new Error(
      "This document is currently being processed. Please wait a moment.",
    );
  }

  document.processing = true;

  try {
    const originalBytes = document.original;
    const filename = document.metadata.filename;
    const originalSize = originalBytes.byteLength;

    if (originalSize === 0) {
      throw new Error("The PDF file is empty.");
    }
    if (originalSize > MAX_PDF_SIZE) {
      throw new Error("PDFs must be 100 MB or smaller.");
    }
    if (!hasPdfSignature(originalBytes)) {
      throw new Error("The selected file does not contain a valid PDF signature.");
    }

    await acquireCompressionSlot();
    try {
      let pageCount: number;
      let originalPdf: PDFDocument;
      try {
        originalPdf = await PDFDocument.load(originalBytes);
        pageCount = originalPdf.getPageCount();
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        if (message.includes("encrypt") || message.includes("password")) {
          throw new Error("This PDF is password-protected. Please unlock the file before compressing.");
        }
        throw new Error("This PDF file is corrupted or not a valid document.");
      }

      const candidateBytes = await compressWithLocalImageFilter(originalBytes, originalPdf);
      const compressedBytes = candidateBytes && candidateBytes.byteLength < originalSize
        ? candidateBytes
        : originalBytes;
      const compressedSize = compressedBytes.byteLength;
      const bytesSaved = originalSize - compressedSize;
      const stats = {
        originalSize,
        compressedSize,
        bytesSaved,
        percentage: originalSize > 0 ? Number(((bytesSaved / originalSize) * 100).toFixed(1)) : 0,
        compressedAt: new Date().toISOString(),
        method: bytesSaved > 0 ? "quartz-filter-inspired-local-compression" : "local-no-size-reduction",
        pageCount,
      };

      saveCompressedPdf(id, compressedBytes, stats);

      return {
        id,
        filename,
        originalSize,
        compressedSize,
        bytesSaved,
        percentage: stats.percentage,
        downloadUrl: `/api/documents/${id}/compressed?download=1`,
        method: stats.method,
        pageCount,
      };
    } finally {
      releaseCompressionSlot();
    }
  } finally {
    document.processing = false;
  }
}
