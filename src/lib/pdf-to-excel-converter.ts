import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { globalConversionQueue } from "./conversion-queue";

const execFileAsync = promisify(execFile);

export const MAX_PDF_TO_EXCEL_SIZE = 100 * 1024 * 1024; // 100 MB

const XLSX_ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

export class PdfToExcelConversionError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "PdfToExcelConversionError";
    this.statusCode = statusCode;
  }
}

export type PdfToExcelValidationResult = {
  valid: boolean;
  pageCount?: number;
  error?: string;
};

export async function validatePdfForExcelConversion(
  bytes: Uint8Array,
  filename: string,
): Promise<PdfToExcelValidationResult> {
  if (bytes.byteLength === 0) {
    return { valid: false, error: "The uploaded file is empty." };
  }

  if (bytes.byteLength > MAX_PDF_TO_EXCEL_SIZE) {
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
  if (!rawMessage) return "PDF to Excel conversion failed. Please try again.";

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

async function runNativeExcelExtraction(
  inputBytes: Uint8Array,
): Promise<Buffer | null> {
  const scriptPath = path.resolve(process.cwd(), "scripts", "convert-pdf-to-xlsx.py");
  if (!fs.existsSync(scriptPath)) {
    return null;
  }

  const uniqueId = crypto.randomUUID();
  const tempIn = path.join(os.tmpdir(), `clearpdf_pdf_table_${uniqueId}.pdf`);
  const tempOut = path.join(os.tmpdir(), `clearpdf_xlsx_out_${uniqueId}.xlsx`);

  await fs.promises.writeFile(tempIn, Buffer.from(inputBytes));

  try {
    const pythonExec = process.env.PYTHON_BIN || "python";
    await execFileAsync(pythonExec, [
      scriptPath,
      tempIn,
      tempOut,
    ], {
      timeout: 90_000,
    });

    if (fs.existsSync(tempOut)) {
      const xlsxBytes = await fs.promises.readFile(tempOut);
      if (xlsxBytes.byteLength > 4 && xlsxBytes.subarray(0, 4).equals(XLSX_ZIP_HEADER)) {
        return xlsxBytes;
      }
    }
    return null;
  } catch (err) {
    console.warn("[PDF to Excel] Python table extraction failed:", err);
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
  const tempDir = path.join(os.tmpdir(), `clearpdf_lo_pdf2xlsx_${uniqueId}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  const tempIn = path.join(tempDir, "input.pdf");
  await fs.promises.writeFile(tempIn, Buffer.from(inputBytes));

  try {
    await execFileAsync(
      sofficePath,
      ["--headless", "--infilter=calc_pdf_import", "--convert-to", "xlsx", "--outdir", tempDir, tempIn],
      { timeout: 60_000 },
    );

    const tempOut = path.join(tempDir, "input.xlsx");
    if (fs.existsSync(tempOut)) {
      const bytes = await fs.promises.readFile(tempOut);
      if (bytes.byteLength > 4 && bytes.subarray(0, 4).equals(XLSX_ZIP_HEADER)) {
        return bytes;
      }
    }
    return null;
  } catch (err) {
    console.warn("[PDF to Excel] Local LibreOffice conversion failed:", err);
    return null;
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

export type PdfToExcelResult = {
  xlsxBuffer: Buffer;
  pageCount: number;
  method: string;
  warnings: string[];
  featuresDetected: string[];
  latencyMs: number;
};

export async function convertPdfToExcel(
  inputBytes: Uint8Array,
  filename: string,
): Promise<PdfToExcelResult> {
  const validation = await validatePdfForExcelConversion(inputBytes, filename);
  if (!validation.valid || !validation.pageCount) {
    throw new PdfToExcelConversionError(validation.error || "Invalid PDF document.", 400);
  }

  return globalConversionQueue.submit(inputBytes, filename, async () => {
    const startTime = Date.now();

    // 1. Native Python pdfplumber + openpyxl table & numerical extraction
    try {
      const nativeXlsx = await runNativeExcelExtraction(inputBytes);
      if (nativeXlsx && nativeXlsx.byteLength > 4 && nativeXlsx.subarray(0, 4).equals(XLSX_ZIP_HEADER)) {
        return {
          xlsxBuffer: nativeXlsx,
          pageCount: validation.pageCount || 1,
          method: "native-excel-extractor",
          warnings: [],
          featuresDetected: ["XLSX", "TABLES"],
          latencyMs: Date.now() - startTime,
        };
      }
    } catch (err) {
      console.warn("[PDF to Excel] Native Excel extraction failed, trying fallback:", err);
    }

    // 2. Local LibreOffice fallback if installed
    try {
      const loXlsx = await runLocalLibreOffice(inputBytes);
      if (loXlsx && loXlsx.byteLength > 4 && loXlsx.subarray(0, 4).equals(XLSX_ZIP_HEADER)) {
        return {
          xlsxBuffer: loXlsx,
          pageCount: validation.pageCount || 1,
          method: "local-libreoffice",
          warnings: [],
          featuresDetected: ["XLSX"],
          latencyMs: Date.now() - startTime,
        };
      }
    } catch {}

    throw new PdfToExcelConversionError(
      "The PDF to Excel conversion service is currently unavailable. Please ensure Python (pdfplumber/openpyxl) or LibreOffice is available on the host.",
      503,
    );
  });
}
