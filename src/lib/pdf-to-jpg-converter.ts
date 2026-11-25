import { PDFDocument } from "pdf-lib";
import { globalConversionQueue } from "./conversion-queue";

export const MAX_PDF_TO_JPG_SIZE = 100 * 1024 * 1024; // 100 MB

export class PdfToJpgConversionError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "PdfToJpgConversionError";
    this.statusCode = statusCode;
  }
}

export type PdfValidationResult = {
  valid: boolean;
  pageCount?: number;
  error?: string;
};

export async function validatePdfDocument(
  bytes: Uint8Array,
  filename: string,
): Promise<PdfValidationResult> {
  if (bytes.byteLength === 0) {
    return { valid: false, error: "The uploaded file is empty." };
  }

  if (bytes.byteLength > MAX_PDF_TO_JPG_SIZE) {
    return { valid: false, error: "The PDF document exceeds the 100 MB file size limit." };
  }

  const header = Buffer.from(bytes.subarray(0, 10)).toString("latin1");
  if (!header.startsWith("%PDF-")) {
    return { valid: false, error: "Please upload a valid PDF document (%PDF header missing)." };
  }

  const lowerName = filename.toLowerCase();
  if (!lowerName.endsWith(".pdf")) {
    return { valid: false, error: "The file must have a .pdf extension." };
  }

  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pageCount = doc.getPageCount();
    if (pageCount === 0) {
      return { valid: false, error: "The PDF document has no pages." };
    }
    return { valid: true, pageCount };
  } catch (err) {
    return {
      valid: false,
      error: `Could not parse the PDF file: ${err instanceof Error ? err.message : "Invalid or encrypted PDF."}`,
    };
  }
}

export function sanitizeErrorMessage(rawMessage: string): string {
  if (!rawMessage) return "PDF to JPG conversion failed. Please try again.";

  const sanitized = rawMessage
    .replace(/https?:\/\/[^\s"']+/gi, "[internal-service]")
    .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]+)?\b/g, "[internal-host]")
    .replace(/[a-zA-Z]:\\[^\s"']+/g, "[internal-path]")
    .replace(/\/(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+/g, "[internal-path]");

  const lower = sanitized.toLowerCase();
  if (
    lower.includes("econnrefused") ||
    lower.includes("fetch failed") ||
    lower.includes("enotfound") ||
    lower.includes("econnreset")
  ) {
    return "The document conversion service is currently unavailable. Please try again later.";
  }

  return sanitized;
}

export type PdfToJpgResult = {
  id: string;
  filename: string;
  pageCount: number;
  originalSize: number;
  latencyMs: number;
};

export async function processPdfToJpg(
  bytes: Uint8Array,
  filename: string,
): Promise<PdfToJpgResult> {
  const validation = await validatePdfDocument(bytes, filename);
  if (!validation.valid || !validation.pageCount) {
    throw new PdfToJpgConversionError(validation.error || "Invalid PDF document.", 400);
  }

  return globalConversionQueue.submit(bytes, filename, async () => {
    const startTime = Date.now();

    return {
      id: crypto.randomUUID(),
      filename,
      pageCount: validation.pageCount || 1,
      originalSize: bytes.byteLength,
      latencyMs: Date.now() - startTime,
    };
  });
}
