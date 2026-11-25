import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { globalConversionQueue } from "./conversion-queue";

const execFileAsync = promisify(execFile);

export const MAX_POWERPOINT_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

// Magic byte signatures
const PPTX_ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const PPT_OLE_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export class PowerpointConversionError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "PowerpointConversionError";
    this.statusCode = statusCode;
  }
}

export type PowerpointValidationResult = {
  valid: boolean;
  format: "pptx" | "ppt" | "unknown";
  error?: string;
};

export function validatePowerpointDocument(
  bytes: Uint8Array,
  filename: string,
): PowerpointValidationResult {
  if (bytes.byteLength === 0) {
    return { valid: false, format: "unknown", error: "The uploaded file is empty." };
  }

  if (bytes.byteLength > MAX_POWERPOINT_FILE_SIZE) {
    return { valid: false, format: "unknown", error: "The presentation exceeds the 100 MB file size limit." };
  }

  const buf = Buffer.from(bytes.subarray(0, 16));
  const isPptx = buf.subarray(0, 4).equals(PPTX_ZIP_HEADER);
  const isPpt = buf.subarray(0, 8).equals(PPT_OLE_HEADER);

  const lowerName = filename.toLowerCase();

  // Extension checks with signature matching
  if (lowerName.endsWith(".pptx") || lowerName.endsWith(".ppsx") || lowerName.endsWith(".potx")) {
    if (!isPptx) {
      return {
        valid: false,
        format: "unknown",
        error: "Invalid PowerPoint presentation signature. The file appears to be corrupted or not a valid PowerPoint file (.pptx).",
      };
    }
    return { valid: true, format: "pptx" };
  }

  if (lowerName.endsWith(".ppt") || lowerName.endsWith(".pps") || lowerName.endsWith(".pot")) {
    if (!isPpt) {
      return {
        valid: false,
        format: "unknown",
        error: "Invalid PowerPoint presentation signature. The file appears to be corrupted or not a valid PowerPoint file (.ppt).",
      };
    }
    return { valid: true, format: "ppt" };
  }

  if (isPptx) return { valid: true, format: "pptx" };
  if (isPpt) return { valid: true, format: "ppt" };

  return {
    valid: false,
    format: "unknown",
    error: "Please upload a valid PowerPoint presentation (.pptx or .ppt).",
  };
}

export function sanitizeErrorMessage(rawMessage: string): string {
  if (!rawMessage) return "PowerPoint to PDF conversion failed. Please try again.";

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
  filename: string,
): Promise<Buffer | null> {
  const scriptPath = path.resolve(process.cwd(), "scripts", "convert-pptx-to-pdf.ps1");
  if (!fs.existsSync(scriptPath)) {
    return null;
  }

  const uniqueId = crypto.randomUUID();
  const ext = path.extname(filename).toLowerCase() || ".pptx";
  const tempIn = path.join(os.tmpdir(), `clearpdf_ppt_in_${uniqueId}${ext}`);
  const tempOut = path.join(os.tmpdir(), `clearpdf_ppt_out_${uniqueId}.pdf`);

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
    console.warn("[PowerPoint to PDF] Native PowerPoint COM conversion failed:", err);
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
  const ext = path.extname(filename).toLowerCase() || ".pptx";
  const tempDir = path.join(os.tmpdir(), `clearpdf_lo_ppt_${uniqueId}`);
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
    console.warn("[PowerPoint to PDF] Local LibreOffice conversion failed:", err);
    return null;
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

export type PowerpointConversionResult = {
  pdfBuffer: Buffer;
  pageCount: number;
  method: string;
  warnings: string[];
  featuresDetected: string[];
  latencyMs: number;
};

export async function convertPowerpointToPdf(
  inputBytes: Uint8Array,
  filename: string,
): Promise<PowerpointConversionResult> {
  const validation = validatePowerpointDocument(inputBytes, filename);
  if (!validation.valid) {
    throw new PowerpointConversionError(validation.error || "Invalid PowerPoint presentation.", 400);
  }

  return globalConversionQueue.submit(inputBytes, filename, async () => {
    const startTime = Date.now();

    // 1. Native PowerPoint automation on Windows (exact 1:1 original slide fidelity, fonts, shapes, diagrams)
    if (process.platform === "win32") {
      try {
        const nativePdf = await runNativePowerpointConversion(inputBytes, filename);
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
            method: "native-powerpoint-engine",
            warnings: [],
            featuresDetected: [validation.format.toUpperCase()],
            latencyMs: Date.now() - startTime,
          };
        }
      } catch (err) {
        console.warn("[PowerPoint to PDF] Native PowerPoint conversion failed, trying fallback:", err);
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

    throw new PowerpointConversionError(
      "The presentation conversion service is currently unavailable. Please ensure Microsoft PowerPoint or LibreOffice is available on the host.",
      503,
    );
  });
}
