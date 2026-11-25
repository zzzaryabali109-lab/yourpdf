import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { globalConversionQueue } from "./conversion-queue";

const execFileAsync = promisify(execFile);

export const MAX_PDF_TO_WORD_SIZE = 100 * 1024 * 1024; // 100 MB

const DOCX_ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export class PdfToWordConversionError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "PdfToWordConversionError";
    this.statusCode = statusCode;
  }
}

export type PdfToWordValidationResult = {
  valid: boolean;
  pageCount?: number;
  error?: string;
};

export async function validatePdfForWordConversion(
  bytes: Uint8Array,
  filename: string,
): Promise<PdfToWordValidationResult> {
  if (bytes.byteLength === 0) {
    return { valid: false, error: "The uploaded file is empty." };
  }

  if (bytes.byteLength > MAX_PDF_TO_WORD_SIZE) {
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
  if (!rawMessage) return "PDF to Word conversion failed. Please try again.";

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

async function runNativeWordConversion(
  inputBytes: Uint8Array,
): Promise<Buffer | null> {
  const scriptPath = path.resolve(process.cwd(), "scripts", "convert-pdf-to-docx.ps1");
  if (!fs.existsSync(scriptPath)) {
    return null;
  }

  const uniqueId = crypto.randomUUID();
  const tempIn = path.join(os.tmpdir(), `clearpdf_pdf_in_${uniqueId}.pdf`);
  const tempOut = path.join(os.tmpdir(), `clearpdf_docx_out_${uniqueId}.docx`);

  await fs.promises.writeFile(tempIn, Buffer.from(inputBytes));

  try {
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Sta",
      "-File",
      scriptPath,
      "-InputPath",
      tempIn,
      "-OutputPath",
      tempOut,
    ], {
      timeout: 90_000,
    });

    if (fs.existsSync(tempOut)) {
      const docxBytes = await fs.promises.readFile(tempOut);
      if (docxBytes.byteLength > 4 && docxBytes.subarray(0, 4).equals(DOCX_ZIP_HEADER)) {
        return docxBytes;
      }
    }
    return null;
  } catch (err) {
    console.warn("[PDF to Word] Native Word COM conversion failed:", err);
    return null;
  } finally {
    try {
      if (fs.existsSync(tempIn)) await fs.promises.unlink(tempIn);
    } catch {}
    try {
      if (fs.existsSync(tempOut)) await fs.promises.unlink(tempOut);
    } catch {}
  }
}

async function runLocalLibreOffice(
  inputBytes: Uint8Array,
): Promise<Buffer | null> {
  const sofficePath = process.env.LIBREOFFICE_PATH || "soffice";
  const uniqueId = crypto.randomUUID();
  const tempDir = path.join(os.tmpdir(), `clearpdf_lo_pdf2word_${uniqueId}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  const tempIn = path.join(tempDir, "input.pdf");
  await fs.promises.writeFile(tempIn, Buffer.from(inputBytes));

  try {
    await execFileAsync(
      sofficePath,
      ["--headless", "--infilter=writer_pdf_import", "--convert-to", "docx", "--outdir", tempDir, tempIn],
      { timeout: 60_000 },
    );

    const tempOut = path.join(tempDir, "input.docx");
    if (fs.existsSync(tempOut)) {
      const bytes = await fs.promises.readFile(tempOut);
      if (bytes.byteLength > 4 && bytes.subarray(0, 4).equals(DOCX_ZIP_HEADER)) {
        return bytes;
      }
    }
    return null;
  } catch (err) {
    console.warn("[PDF to Word] Local LibreOffice conversion failed:", err);
    return null;
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

export type PdfToWordResult = {
  docxBuffer: Buffer;
  pageCount: number;
  method: string;
  warnings: string[];
  featuresDetected: string[];
  latencyMs: number;
};

export async function convertPdfToWord(
  inputBytes: Uint8Array,
  filename: string,
): Promise<PdfToWordResult> {
  const validation = await validatePdfForWordConversion(inputBytes, filename);
  if (!validation.valid || !validation.pageCount) {
    throw new PdfToWordConversionError(validation.error || "Invalid PDF document.", 400);
  }

  return globalConversionQueue.submit(inputBytes, filename, async () => {
    const startTime = Date.now();

    // 1. Native Microsoft Word COM automation with official PDF Reflow (1:1 editable fidelity, native formatting)
    if (process.platform === "win32") {
      try {
        const nativeDocx = await runNativeWordConversion(inputBytes);
        if (nativeDocx && nativeDocx.byteLength > 4 && nativeDocx.subarray(0, 4).equals(DOCX_ZIP_HEADER)) {
          return {
            docxBuffer: nativeDocx,
            pageCount: validation.pageCount || 1,
            method: "native-word-engine",
            warnings: [],
            featuresDetected: ["PDF_REFLOW", "DOCX"],
            latencyMs: Date.now() - startTime,
          };
        }
      } catch (err) {
        console.warn("[PDF to Word] Native Word conversion failed, trying fallback:", err);
      }
    }

    // 2. Local LibreOffice fallback if installed
    try {
      const loDocx = await runLocalLibreOffice(inputBytes);
      if (loDocx && loDocx.byteLength > 4 && loDocx.subarray(0, 4).equals(DOCX_ZIP_HEADER)) {
        return {
          docxBuffer: loDocx,
          pageCount: validation.pageCount || 1,
          method: "local-libreoffice",
          warnings: [],
          featuresDetected: ["DOCX"],
          latencyMs: Date.now() - startTime,
        };
      }
    } catch {}

    throw new PdfToWordConversionError(
      "The PDF to Word conversion service is currently unavailable. Please ensure Microsoft Word or LibreOffice is available on the host.",
      503,
    );
  });
}
