/**
 * Local backend compression handler for transient documents.
 * Keeps the existing API response compatible with the compression page.
 */

import { PDFDocument } from "pdf-lib";
import { getTransientDocument, saveCompressedPdf } from "@/lib/storage";
import { optimizePdf } from "@/lib/pdf-optimizer";

const MAX_PDF_SIZE = 100 * 1024 * 1024;
const MAX_CONCURRENT_COMPRESSIONS = 1;

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
      try {
        const originalPdf = await PDFDocument.load(originalBytes);
        pageCount = originalPdf.getPageCount();
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : "";
        if (message.includes("encrypt") || message.includes("password")) {
          throw new Error("This PDF is password-protected. Please unlock the file before compressing.");
        }
        throw new Error("This PDF file is corrupted or not a valid document.");
      }

      const candidateBytes = await optimizePdf(originalBytes);
      const compressedBytes = candidateBytes.byteLength < originalSize ? candidateBytes : originalBytes;
      const compressedSize = compressedBytes.byteLength;
      const bytesSaved = originalSize - compressedSize;
      const stats = {
        originalSize,
        compressedSize,
        bytesSaved,
        percentage: originalSize > 0 ? Number(((bytesSaved / originalSize) * 100).toFixed(1)) : 0,
        compressedAt: new Date().toISOString(),
        method: bytesSaved > 0 ? "local-adaptive-pdf-optimizer" : "local-no-size-reduction",
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
