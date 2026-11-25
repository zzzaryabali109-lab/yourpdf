import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { globalConversionQueue } from "./conversion-queue";

const execFileAsync = promisify(execFile);

export const MAX_PDF_TO_POWERPOINT_SIZE = 100 * 1024 * 1024; // 100 MB

const PPTX_ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export class PdfToPowerpointConversionError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "PdfToPowerpointConversionError";
    this.statusCode = statusCode;
  }
}

export type PdfToPowerpointValidationResult = {
  valid: boolean;
  pageCount?: number;
  error?: string;
};

export async function validatePdfForPowerpointConversion(
  bytes: Uint8Array,
  filename: string,
): Promise<PdfToPowerpointValidationResult> {
  if (bytes.byteLength === 0) {
    return { valid: false, error: "The uploaded file is empty." };
  }

  if (bytes.byteLength > MAX_PDF_TO_POWERPOINT_SIZE) {
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
  if (!rawMessage) return "PDF to PowerPoint conversion failed. Please try again.";

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

async function runNativePowerpointConversion(
  inputBytes: Uint8Array,
): Promise<Buffer | null> {
  const scriptPath = path.resolve(process.cwd(), "scripts", "convert-pdf-to-pptx.py");
  if (!fs.existsSync(scriptPath)) {
    return null;
  }

  const uniqueId = crypto.randomUUID();
  const tempIn = path.join(os.tmpdir(), `clearpdf_pdf_slide_${uniqueId}.pdf`);
  const tempOut = path.join(os.tmpdir(), `clearpdf_pptx_out_${uniqueId}.pptx`);

  await fs.promises.writeFile(tempIn, Buffer.from(inputBytes));

  try {
    const pythonExec = process.env.PYTHON_BIN || "python";
    await execFileAsync(pythonExec, [
      scriptPath,
      tempIn,
      tempOut,
    ], {
      timeout: 120_000,
    });

    if (fs.existsSync(tempOut)) {
      const pptxBytes = await fs.promises.readFile(tempOut);
      if (pptxBytes.byteLength > 4 && pptxBytes.subarray(0, 4).equals(PPTX_ZIP_HEADER)) {
        return pptxBytes;
      }
    }
    return null;
  } catch (err) {
    console.warn("[PDF to PowerPoint] Native PowerPoint conversion failed:", err);
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
  const tempDir = path.join(os.tmpdir(), `clearpdf_lo_pdf2pptx_${uniqueId}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  const tempIn = path.join(tempDir, "input.pdf");
  await fs.promises.writeFile(tempIn, Buffer.from(inputBytes));

  try {
    await execFileAsync(
      sofficePath,
      ["--headless", "--infilter=impress_pdf_import", "--convert-to", "pptx", "--outdir", tempDir, tempIn],
      { timeout: 60_000 },
    );

    const tempOut = path.join(tempDir, "input.pptx");
    if (fs.existsSync(tempOut)) {
      const bytes = await fs.promises.readFile(tempOut);
      if (bytes.byteLength > 4 && bytes.subarray(0, 4).equals(PPTX_ZIP_HEADER)) {
        return bytes;
      }
    }
    return null;
  } catch (err) {
    console.warn("[PDF to PowerPoint] Local LibreOffice conversion failed:", err);
    return null;
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

export type PdfToPowerpointResult = {
  pptxBuffer: Buffer;
  pageCount: number;
  method: string;
  warnings: string[];
  featuresDetected: string[];
  latencyMs: number;
};

export async function convertPdfToPowerpoint(
  inputBytes: Uint8Array,
  filename: string,
): Promise<PdfToPowerpointResult> {
  const validation = await validatePdfForPowerpointConversion(inputBytes, filename);
  if (!validation.valid || !validation.pageCount) {
    throw new PdfToPowerpointConversionError(validation.error || "Invalid PDF document.", 400);
  }

  return globalConversionQueue.submit(inputBytes, filename, async () => {
    const startTime = Date.now();

    // 1. Native PowerPoint Engine with pypdfium2 slide extraction
    try {
      const nativePptx = await runNativePowerpointConversion(inputBytes);
      if (nativePptx && nativePptx.byteLength > 4 && nativePptx.subarray(0, 4).equals(PPTX_ZIP_HEADER)) {
        return {
          pptxBuffer: nativePptx,
          pageCount: validation.pageCount || 1,
          method: "native-powerpoint-engine",
          warnings: [],
          featuresDetected: ["PPTX", "SLIDES"],
          latencyMs: Date.now() - startTime,
        };
      }
    } catch (err) {
      console.warn("[PDF to PowerPoint] Native PowerPoint conversion failed, trying fallback:", err);
    }

    // 2. Local LibreOffice fallback if installed
    try {
      const loPptx = await runLocalLibreOffice(inputBytes);
      if (loPptx && loPptx.byteLength > 4 && loPptx.subarray(0, 4).equals(PPTX_ZIP_HEADER)) {
        return {
          pptxBuffer: loPptx,
          pageCount: validation.pageCount || 1,
          method: "local-libreoffice",
          warnings: [],
          featuresDetected: ["PPTX"],
          latencyMs: Date.now() - startTime,
        };
      }
    } catch {}

    throw new PdfToPowerpointConversionError(
      "The PDF to PowerPoint conversion service is currently unavailable. Please ensure PowerPoint or LibreOffice is available on the host.",
      503,
    );
  });
}
