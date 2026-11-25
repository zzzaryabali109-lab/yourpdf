import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { globalConversionQueue } from "./conversion-queue";

const execFileAsync = promisify(execFile);

export const MAX_PROTECT_PDF_SIZE = 100 * 1024 * 1024; // 100 MB

export class ProtectPdfError extends Error {
  public statusCode: number;
  public code?: "ALREADY_ENCRYPTED" | "INVALID_PASSWORD" | "CORRUPTED_PDF";

  constructor(
    message: string,
    statusCode = 500,
    code?: "ALREADY_ENCRYPTED" | "INVALID_PASSWORD" | "CORRUPTED_PDF",
  ) {
    super(message);
    this.name = "ProtectPdfError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type ProtectPdfValidationResult = {
  valid: boolean;
  hasEncryptDictionary?: boolean;
  error?: string;
};

export function validatePdfForProtecting(
  bytes: Uint8Array,
  filename: string,
): ProtectPdfValidationResult {
  if (bytes.byteLength === 0) {
    return { valid: false, error: "The uploaded file is empty." };
  }

  if (bytes.byteLength > MAX_PROTECT_PDF_SIZE) {
    return {
      valid: false,
      error: "The PDF document exceeds the 100 MB file size limit.",
    };
  }

  const header = Buffer.from(bytes.subarray(0, 10)).toString("latin1");
  if (!header.startsWith("%PDF-")) {
    return {
      valid: false,
      error: "Please upload a valid PDF document (%PDF header missing).",
    };
  }

  const lowerName = filename.toLowerCase();
  if (!lowerName.endsWith(".pdf")) {
    return { valid: false, error: "The file must have a .pdf extension." };
  }

  // Quick check for /Encrypt dictionary
  const rawSample = Buffer.from(bytes).toString("latin1");
  const hasEncryptDictionary = /\/Encrypt\s+(\d+\s+\d+\s+R|<<)/.test(rawSample);

  return { valid: true, hasEncryptDictionary };
}

export function sanitizeErrorMessage(rawMessage: string): string {
  if (!rawMessage) return "PDF encryption failed. Please try again.";

  const sanitized = rawMessage
    .replace(/https?:\/\/[^\s"']+/gi, "[internal-service]")
    .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]+)?\b/g, "[internal-host]")
    .replace(/[a-zA-Z]:\\[^\s"']+/g, "[internal-path]")
    .replace(/\/(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+/g, "[internal-path]");

  return sanitized;
}

export type ProtectPdfOptions = {
  userPassword: string;
  ownerPassword?: string;
  allowPrinting?: boolean;
  allowCopying?: boolean;
  allowModifying?: boolean;
};

export type ProtectResult = {
  pdfBuffer: Buffer;
  pageCount: number;
  originalSize: number;
  outputSize: number;
  algorithm: string;
  latencyMs: number;
};

export async function protectPdfDocument(
  inputBytes: Uint8Array,
  filename: string,
  options: ProtectPdfOptions,
): Promise<ProtectResult> {
  const validation = validatePdfForProtecting(inputBytes, filename);
  if (!validation.valid) {
    throw new ProtectPdfError(validation.error || "Invalid PDF file.", 400);
  }

  if (!options.userPassword || options.userPassword.trim() === "") {
    throw new ProtectPdfError("Please provide a password to protect the PDF document.", 400, "INVALID_PASSWORD");
  }

  return globalConversionQueue.submit(inputBytes, filename, async () => {
    const startTime = Date.now();
    const scriptPath = path.resolve(process.cwd(), "scripts", "protect-pdf.py");
    if (!fs.existsSync(scriptPath)) {
      throw new ProtectPdfError("Protect script is missing on server.", 500);
    }

    const uniqueId = crypto.randomUUID();
    const tempIn = path.join(os.tmpdir(), `clearpdf_protect_in_${uniqueId}.pdf`);
    const tempOut = path.join(os.tmpdir(), `clearpdf_protect_out_${uniqueId}.pdf`);

    await fs.promises.writeFile(tempIn, Buffer.from(inputBytes));

    const pythonExec = process.env.PYTHON_BIN || "python";
    const permsJson = JSON.stringify({
      allowPrinting: options.allowPrinting !== false,
      allowCopying: options.allowCopying !== false,
      allowModifying: Boolean(options.allowModifying),
    });

    const args = [
      scriptPath,
      tempIn,
      tempOut,
      options.userPassword,
      options.ownerPassword || "",
      permsJson,
    ];

    try {
      const { stdout } = await execFileAsync(pythonExec, args, { timeout: 60_000 });

      if (fs.existsSync(tempOut)) {
        const outBytes = await fs.promises.readFile(tempOut);
        if (
          outBytes.byteLength > 0 &&
          outBytes.subarray(0, 5).toString("latin1").startsWith("%PDF-")
        ) {
          let pageCount = 1;
          let algorithm = "AES-256";
          try {
            const parsed = JSON.parse(stdout.trim());
            pageCount = parsed.pageCount || 1;
            algorithm = parsed.algorithm || "AES-256";
          } catch {
            try {
              const doc = await PDFDocument.load(outBytes, { ignoreEncryption: true });
              pageCount = Math.max(1, doc.getPageCount());
            } catch {
              pageCount = 1;
            }
          }

          return {
            pdfBuffer: outBytes,
            pageCount,
            originalSize: inputBytes.byteLength,
            outputSize: outBytes.byteLength,
            algorithm,
            latencyMs: Date.now() - startTime,
          };
        }
      }

      throw new ProtectPdfError("Protected PDF file could not be verified.", 500);
    } catch (err: unknown) {
      const errObj = err as { code?: number; stderr?: string; message?: string };
      const stderr = errObj.stderr || errObj.message || "";

      if (stderr.includes("ALREADY_ENCRYPTED")) {
        throw new ProtectPdfError(
          "This PDF is already password-protected. Please unlock it first using Unlock PDF to change or reset its security.",
          409,
          "ALREADY_ENCRYPTED",
        );
      }

      console.error("[Protect PDF] Execution error:", stderr);
      throw new ProtectPdfError(
        sanitizeErrorMessage(stderr || "Failed to protect PDF with password."),
        500,
      );
    } finally {
      try {
        if (fs.existsSync(tempIn)) await fs.promises.unlink(tempIn);
      } catch {}
      try {
        if (fs.existsSync(tempOut)) await fs.promises.unlink(tempOut);
      } catch {}
    }
  });
}
