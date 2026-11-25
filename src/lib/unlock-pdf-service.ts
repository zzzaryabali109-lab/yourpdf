import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { globalConversionQueue } from "./conversion-queue";

const execFileAsync = promisify(execFile);

export const MAX_UNLOCK_PDF_SIZE = 100 * 1024 * 1024; // 100 MB

export class UnlockPdfError extends Error {
  public statusCode: number;
  public code?: "PASSWORD_REQUIRED" | "INVALID_PASSWORD" | "CORRUPTED_PDF";

  constructor(message: string, statusCode = 500, code?: "PASSWORD_REQUIRED" | "INVALID_PASSWORD" | "CORRUPTED_PDF") {
    super(message);
    this.name = "UnlockPdfError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type UnlockPdfValidationResult = {
  valid: boolean;
  hasEncryptDictionary?: boolean;
  error?: string;
};

export function validatePdfForUnlocking(
  bytes: Uint8Array,
  filename: string,
): UnlockPdfValidationResult {
  if (bytes.byteLength === 0) {
    return { valid: false, error: "The uploaded file is empty." };
  }

  if (bytes.byteLength > MAX_UNLOCK_PDF_SIZE) {
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

  // Quick scan for /Encrypt dictionary in the trailer or object table
  const rawSample = Buffer.from(bytes).toString("latin1");
  const hasEncryptDictionary = /\/Encrypt\s+(\d+\s+\d+\s+R|<<)/.test(rawSample);

  return { valid: true, hasEncryptDictionary };
}

export function sanitizeErrorMessage(rawMessage: string): string {
  if (!rawMessage) return "PDF unlocking failed. Please try again.";

  const sanitized = rawMessage
    .replace(/https?:\/\/[^\s"']+/gi, "[internal-service]")
    .replace(/\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?::[0-9]+)?\b/g, "[internal-host]")
    .replace(/[a-zA-Z]:\\[^\s"']+/g, "[internal-path]")
    .replace(/\/(?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+/g, "[internal-path]");

  return sanitized;
}

export type UnlockResult = {
  pdfBuffer: Buffer;
  pageCount: number;
  originalSize: number;
  outputSize: number;
  wasEncrypted: boolean;
  restrictionsRemoved: boolean;
  latencyMs: number;
};

export async function unlockPdfDocument(
  inputBytes: Uint8Array,
  filename: string,
  password?: string,
): Promise<UnlockResult> {
  const validation = validatePdfForUnlocking(inputBytes, filename);
  if (!validation.valid) {
    throw new UnlockPdfError(validation.error || "Invalid PDF file.", 400);
  }

  return globalConversionQueue.submit(inputBytes, filename, async () => {
    const startTime = Date.now();
    const scriptPath = path.resolve(process.cwd(), "scripts", "unlock-pdf.py");
    if (!fs.existsSync(scriptPath)) {
      throw new UnlockPdfError("Unlock script is missing on server.", 500);
    }

    const uniqueId = crypto.randomUUID();
    const tempIn = path.join(os.tmpdir(), `clearpdf_lock_in_${uniqueId}.pdf`);
    const tempOut = path.join(os.tmpdir(), `clearpdf_unlocked_out_${uniqueId}.pdf`);

    await fs.promises.writeFile(tempIn, Buffer.from(inputBytes));

    const pythonExec = process.env.PYTHON_BIN || "python";
    const args = [scriptPath, tempIn, tempOut];
    if (password && password.trim() !== "") {
      args.push(password);
    }

    try {
      await execFileAsync(pythonExec, args, { timeout: 60_000 });

      if (fs.existsSync(tempOut)) {
        const outBytes = await fs.promises.readFile(tempOut);
        if (outBytes.byteLength > 0 && outBytes.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
          let pageCount = 1;
          try {
            const doc = await PDFDocument.load(outBytes, { ignoreEncryption: true });
            pageCount = Math.max(1, doc.getPageCount());
          } catch {
            pageCount = 1;
          }

          return {
            pdfBuffer: outBytes,
            pageCount,
            originalSize: inputBytes.byteLength,
            outputSize: outBytes.byteLength,
            wasEncrypted: Boolean(validation.hasEncryptDictionary),
            restrictionsRemoved: true,
            latencyMs: Date.now() - startTime,
          };
        }
      }

      throw new UnlockPdfError("Unlocked file could not be verified.", 500);
    } catch (err: unknown) {
      const errObj = err as { code?: number; stderr?: string; message?: string };
      const stderr = errObj.stderr || errObj.message || "";

      if (stderr.includes("PASSWORD_REQUIRED")) {
        throw new UnlockPdfError(
          "This PDF document is encrypted with a user password. Please enter the password to unlock it.",
          401,
          "PASSWORD_REQUIRED",
        );
      }

      if (stderr.includes("INVALID_PASSWORD")) {
        throw new UnlockPdfError(
          "The password entered is incorrect. Please check the password and try again.",
          403,
          "INVALID_PASSWORD",
        );
      }

      console.error("[Unlock PDF] Execution error:", stderr);
      throw new UnlockPdfError(
        sanitizeErrorMessage(stderr || "Failed to remove PDF password and restrictions."),
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
