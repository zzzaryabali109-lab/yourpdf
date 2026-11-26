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
const LOCAL_ENGINE_TIMEOUT_MS = 120_000;
const execFileAsync = promisify(execFile);

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

type LocalEngineStats = {
  changed: boolean;
  originalBytes: number;
  compressedBytes: number;
  imagesFound: number;
  imagesRewritten: number;
  profile: { scale: number; jpegQuality: number } | null;
};

async function compressWithLocalImageEngine(
  inputBytes: Buffer,
): Promise<{ bytes: Buffer | null; stats: LocalEngineStats }> {
  const workingDirectory = await mkdtemp(path.join(os.tmpdir(), "yourpdf-compress-"));
  const inputPath = path.join(workingDirectory, "input.pdf");
  const outputPath = path.join(workingDirectory, "output.pdf");
  const scriptPath = path.join(process.cwd(), "scripts", "pdf_compress_engine.py");
  const pythonExec = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

  try {
    await writeFile(inputPath, inputBytes, { mode: 0o600 });
    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(pythonExec, [scriptPath, inputPath, outputPath], {
        timeout: LOCAL_ENGINE_TIMEOUT_MS,
        maxBuffer: 2 * 1024 * 1024,
        windowsHide: true,
      }));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        throw new Error("The local PDF compression engine is unavailable. Please redeploy the service.");
      }
      const detail = error instanceof Error ? error.message : "unknown Python engine error";
      throw new Error(`The local PDF compression engine could not process this file: ${detail}`);
    }

    let stats: LocalEngineStats;
    try {
      stats = JSON.parse(stdout.trim()) as LocalEngineStats;
    } catch {
      throw new Error("The local PDF compression engine returned an invalid result. Please redeploy the service.");
    }

    let candidate: Buffer | null = null;
    try {
      candidate = await readFile(outputPath);
    } catch {
      // The Python engine omits the output when it cannot make it smaller.
    }

    if (!candidate || !hasPdfSignature(candidate) || candidate.byteLength >= inputBytes.byteLength) {
      candidate = null;
    }

    console.info("[pdf-compression] local image engine", JSON.stringify({
      originalBytes: inputBytes.byteLength,
      outputBytes: candidate?.byteLength ?? inputBytes.byteLength,
      imagesFound: stats.imagesFound,
      imagesRewritten: stats.imagesRewritten,
      profile: stats.profile,
    }));

    return { bytes: candidate, stats };
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
 * Compresses embedded raster images with the local image-stream engine.
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

      const { bytes: candidateBytes, stats: engineStats } = await compressWithLocalImageEngine(originalBytes);
      if (!candidateBytes || candidateBytes.byteLength >= originalSize) {
        throw new Error(
          engineStats.changed
            ? "The PDF compression result was not smaller than the original, so the original file was kept."
            : "The local engine could not make this PDF smaller. It may contain no compressible images, already-optimized images, or image types this engine cannot safely rewrite.",
        );
      }

      const compressedBytes = candidateBytes;
      const compressedSize = compressedBytes.byteLength;
      const bytesSaved = originalSize - compressedSize;
      const stats = {
        originalSize,
        compressedSize,
        bytesSaved,
        percentage: originalSize > 0 ? Number(((bytesSaved / originalSize) * 100).toFixed(1)) : 0,
        compressedAt: new Date().toISOString(),
        method: bytesSaved > 0 ? "local-pdf-image-stream-engine" : "local-no-size-reduction",
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
