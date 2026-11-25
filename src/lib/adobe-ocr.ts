import {
  getTransientDocument,
    saveCleanPdf,
    saveOcrStatus,
    type OcrProcessingStatus,
} from "@/lib/storage";
import { processPdfOcr } from "@/lib/local-ocr";

const MAX_FILE_SIZE = 100 * 1024 * 1024;

export async function readOcrStatus(id: string): Promise<OcrProcessingStatus> {
  return getTransientDocument(id)?.status ?? { status: "not_started" };
}

export async function documentExists(id: string): Promise<boolean> {
  return !!getTransientDocument(id);
}

function isPdf(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 5) return false;
  return Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from("%PDF-"));
}

export async function runAdobeOcr(id: string): Promise<void> {
  const document = getTransientDocument(id);
  if (!document || document.processing) return;
  document.processing = true;

  const startedAt = new Date().toISOString();
  saveOcrStatus(id, {
    status: "processing",
    startedAt,
    totalPages: 1,
    completedPages: 0,
    failedPages: 0,
  });

  try {
    const inputBytes = document.original;
    if (inputBytes.byteLength > MAX_FILE_SIZE) {
      throw new Error("File exceeds the 100 MB limit.");
    }
    if (!isPdf(inputBytes)) {
      throw new Error("This file is not a valid PDF.");
    }

    const result = await processPdfOcr(inputBytes, (completed, total) => {
      saveOcrStatus(id, {
        status: "processing",
        startedAt,
        totalPages: total,
        completedPages: completed,
        failedPages: 0,
      });
    });

    saveCleanPdf(id, result.outputBytes);

    saveOcrStatus(id, {
      status: "completed",
      startedAt,
      completedAt: new Date().toISOString(),
      totalPages: result.pageCount,
      completedPages: result.pageCount,
      failedPages: 0,
      conversion: "invisible-text-layer",
      recognizedText: result.recognizedText,
      textCharacters: result.textCharacters,
      outputSize: result.outputBytes.byteLength,
    });
  } catch (error) {
    console.error("[OCR] Backend OCR processing failed:", error);
    saveOcrStatus(id, {
      status: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      failedPages: 1,
      error: error instanceof Error ? error.message : "OCR processing failed. Please retry.",
    });
  } finally {
    document.processing = false;
  }
}
