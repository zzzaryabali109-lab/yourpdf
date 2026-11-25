import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { globalConversionQueue } from "./conversion-queue";

const execFileAsync = promisify(execFile);

export const MAX_EXCEL_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

// Magic byte signatures
const XLSX_ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const XLS_OLE_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export class ExcelConversionError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "ExcelConversionError";
    this.statusCode = statusCode;
  }
}

export type ExcelValidationResult = {
  valid: boolean;
  format: "xlsx" | "xls" | "csv" | "unknown";
  error?: string;
};

export function validateExcelDocument(
  bytes: Uint8Array,
  filename: string,
): ExcelValidationResult {
  if (bytes.byteLength === 0) {
    return { valid: false, format: "unknown", error: "The uploaded file is empty." };
  }

  if (bytes.byteLength > MAX_EXCEL_FILE_SIZE) {
    return { valid: false, format: "unknown", error: "The spreadsheet exceeds the 100 MB file size limit." };
  }

  const buf = Buffer.from(bytes.subarray(0, 16));
  const isXlsx = buf.subarray(0, 4).equals(XLSX_ZIP_HEADER);
  const isXls = buf.subarray(0, 8).equals(XLS_OLE_HEADER);

  const lowerName = filename.toLowerCase();

  // Extension checks with signature matching
  if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xlsm") || lowerName.endsWith(".xltx") || lowerName.endsWith(".xltm")) {
    if (!isXlsx) {
      return {
        valid: false,
        format: "unknown",
        error: "Invalid Excel spreadsheet signature. The file appears to be corrupted or not a valid Excel file (.xlsx).",
      };
    }
    return { valid: true, format: "xlsx" };
  }

  if (lowerName.endsWith(".xls") || lowerName.endsWith(".xlt")) {
    if (!isXls) {
      return {
        valid: false,
        format: "unknown",
        error: "Invalid Excel spreadsheet signature. The file appears to be corrupted or not a valid Excel file (.xls).",
      };
    }
    return { valid: true, format: "xls" };
  }

  if (lowerName.endsWith(".csv")) {
    return { valid: true, format: "csv" };
  }

  if (isXlsx) return { valid: true, format: "xlsx" };
  if (isXls) return { valid: true, format: "xls" };

  return {
    valid: false,
    format: "unknown",
    error: "Please upload a valid Excel spreadsheet (.xlsx, .xls, or .csv).",
  };
}

export function sanitizeErrorMessage(rawMessage: string): string {
  if (!rawMessage) return "Excel to PDF conversion failed. Please try again.";

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

async function runNativeExcelConversion(
  inputBytes: Uint8Array,
  filename: string,
): Promise<Buffer | null> {
  const scriptPath = path.resolve(process.cwd(), "scripts", "convert-xlsx-to-pdf.ps1");
  if (!fs.existsSync(scriptPath)) {
    return null;
  }

  const uniqueId = crypto.randomUUID();
  const ext = path.extname(filename).toLowerCase() || ".xlsx";
  const tempIn = path.join(os.tmpdir(), `clearpdf_excel_in_${uniqueId}${ext}`);
  const tempOut = path.join(os.tmpdir(), `clearpdf_excel_out_${uniqueId}.pdf`);

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
      const pdfBytes = await fs.promises.readFile(tempOut);
      if (pdfBytes.byteLength > 0 && pdfBytes.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
        return pdfBytes;
      }
    }
    return null;
  } catch (err) {
    console.warn("[Excel to PDF] Native Excel COM conversion failed:", err);
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
  filename: string,
): Promise<Buffer | null> {
  const sofficePath = process.env.LIBREOFFICE_PATH || "soffice";
  const uniqueId = crypto.randomUUID();
  const ext = path.extname(filename).toLowerCase() || ".xlsx";
  const tempDir = path.join(os.tmpdir(), `clearpdf_lo_excel_${uniqueId}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  const tempIn = path.join(tempDir, `input${ext}`);
  await fs.promises.writeFile(tempIn, Buffer.from(inputBytes));

  try {
    await execFileAsync(
      sofficePath,
      ["--headless", "--convert-to", "pdf", "--outdir", tempDir, tempIn],
      { timeout: 60_000 },
    );

    const tempOut = path.join(tempDir, "input.pdf");
    if (fs.existsSync(tempOut)) {
      return await fs.promises.readFile(tempOut);
    }
    return null;
  } catch (err) {
    console.warn("[Excel to PDF] Local LibreOffice conversion failed:", err);
    return null;
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

export type ExcelConversionResult = {
  pdfBuffer: Buffer;
  pageCount: number;
  method: string;
  warnings: string[];
  featuresDetected: string[];
  latencyMs: number;
};

export async function convertExcelToPdf(
  inputBytes: Uint8Array,
  filename: string,
): Promise<ExcelConversionResult> {
  const validation = validateExcelDocument(inputBytes, filename);
  if (!validation.valid) {
    throw new ExcelConversionError(validation.error || "Invalid Excel spreadsheet.", 400);
  }

  return globalConversionQueue.submit(inputBytes, filename, async () => {
    const startTime = Date.now();

    // 1. Native Excel automation on Windows (exact 1:1 original spreadsheet fidelity, formulas, tables, borders)
    if (process.platform === "win32") {
      try {
        const nativePdf = await runNativeExcelConversion(inputBytes, filename);
        if (nativePdf && nativePdf.byteLength > 0 && nativePdf.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
          let pageCount = 1;
          try {
            const doc = await PDFDocument.load(nativePdf, { ignoreEncryption: true });
            pageCount = Math.max(1, doc.getPageCount());
          } catch {
            pageCount = 1;
          }

          return {
            pdfBuffer: nativePdf,
            pageCount,
            method: "native-excel-engine",
            warnings: [],
            featuresDetected: [validation.format.toUpperCase()],
            latencyMs: Date.now() - startTime,
          };
        }
      } catch (err) {
        console.warn("[Excel to PDF] Native Excel conversion failed, trying fallback:", err);
      }
    }

    // 2. Local LibreOffice fallback if installed
    try {
      const loPdf = await runLocalLibreOffice(inputBytes, filename);
      if (loPdf && loPdf.byteLength > 0 && loPdf.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
        let pageCount = 1;
        try {
          const doc = await PDFDocument.load(loPdf, { ignoreEncryption: true });
          pageCount = Math.max(1, doc.getPageCount());
        } catch {
          pageCount = 1;
        }

        return {
          pdfBuffer: loPdf,
          pageCount,
          method: "local-libreoffice",
          warnings: [],
          featuresDetected: [validation.format.toUpperCase()],
          latencyMs: Date.now() - startTime,
        };
      }
    } catch {}

    throw new ExcelConversionError(
      "The spreadsheet conversion service is currently unavailable. Please ensure Microsoft Excel or LibreOffice is available on the host.",
      503,
    );
  });
}
