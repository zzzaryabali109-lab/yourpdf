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
import { optimizePdf, validateCompressionCandidate } from "@/lib/pdf-optimizer";

const MAX_PDF_SIZE = 100 * 1024 * 1024;
const MAX_CONCURRENT_COMPRESSIONS = 1;
const GHOSTSCRIPT_TIME_BUDGET_MS = 90_000;
const execFileAsync = promisify(execFile);

const GHOSTSCRIPT_PROFILES = [
  { dpi: 180, qFactor: 0.88 },
  { dpi: 150, qFactor: 0.82 },
  { dpi: 120, qFactor: 0.76 },
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

function hasInteractiveContent(document: PDFDocument): boolean {
  if (document.catalog.AcroForm()) return true;

  return document.getPages().some((page) => {
    const annotations = page.node.Annots();
    return Boolean(annotations && annotations.size() > 0);
  });
}

async function optimizeWithGhostscript(inputBytes: Buffer, document: PDFDocument): Promise<Buffer | null> {
  // pdfwrite does not preserve every annotation type (notably links and form
  // widgets), so use the structure-preserving optimizer for interactive PDFs.
  if (hasInteractiveContent(document)) return null;

  const workingDirectory = await mkdtemp(path.join(os.tmpdir(), "yourpdf-compress-"));
  const inputPath = path.join(workingDirectory, "input.pdf");
  const outputPath = path.join(workingDirectory, "output.pdf");
  const startedAt = Date.now();
  let bestCandidate: Buffer | null = null;

  try {
    await writeFile(inputPath, inputBytes, { mode: 0o600 });

    for (const profile of GHOSTSCRIPT_PROFILES) {
      const remainingTime = GHOSTSCRIPT_TIME_BUDGET_MS - (Date.now() - startedAt);
      if (remainingTime < 1_000) break;

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

        const candidate = await readFile(outputPath);
        if (!hasPdfSignature(candidate) || candidate.byteLength >= inputBytes.byteLength) continue;

        const validation = await validateCompressionCandidate(inputBytes, candidate);
        if (!validation.valid) continue;

        if (!bestCandidate || candidate.byteLength < bestCandidate.byteLength) {
          bestCandidate = candidate;
        }

        // Stop once the requested high reduction range is reached; deeper
        // downsampling would trade more image detail for little user benefit.
        if (candidate.byteLength <= inputBytes.byteLength * 0.2) break;
      } catch (error) {
        // Ghostscript is optional during local development. The Docker runtime
        // installs it; if it is unavailable or rejects a profile, try the next
        // profile and ultimately fall back to the local JavaScript optimizer.
        if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
          break;
        }
      }
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
 * Compresses the uploaded PDF locally with the adaptive multi-profile engine.
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

      const ghostscriptCandidate = await optimizeWithGhostscript(originalBytes, originalPdf);
      const localCandidate = await optimizePdf(originalBytes);
      const candidateBytes = ghostscriptCandidate && ghostscriptCandidate.byteLength < localCandidate.byteLength
        ? ghostscriptCandidate
        : localCandidate;
      const compressedBytes = candidateBytes.byteLength < originalSize ? candidateBytes : originalBytes;
      const compressedSize = compressedBytes.byteLength;
      const bytesSaved = originalSize - compressedSize;
      const stats = {
        originalSize,
        compressedSize,
        bytesSaved,
        percentage: originalSize > 0 ? Number(((bytesSaved / originalSize) * 100).toFixed(1)) : 0,
        compressedAt: new Date().toISOString(),
        method: bytesSaved > 0
          ? candidateBytes === ghostscriptCandidate
            ? "local-ghostscript-image-optimizer"
            : "local-adaptive-pdf-optimizer"
          : "local-no-size-reduction",
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
