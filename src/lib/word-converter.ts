import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { globalConversionQueue } from "./conversion-queue";

const execFileAsync = promisify(execFile);

export const MAX_WORD_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const CONVERSION_TIMEOUT_MS = 120_000; // 2 minutes

// Magic byte signatures
const DOCX_ZIP_HEADER = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const DOC_OLE_HEADER = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export class WordConversionError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "WordConversionError";
    this.statusCode = statusCode;
  }
}

export type WordValidationResult = {
  valid: boolean;
  format: "docx" | "doc" | "unknown";
  error?: string;
};

export function validateWordDocument(
  bytes: Uint8Array,
  filename: string,
): WordValidationResult {
  if (bytes.byteLength === 0) {
    return { valid: false, format: "unknown", error: "The uploaded file is empty." };
  }

  if (bytes.byteLength > MAX_WORD_FILE_SIZE) {
    return { valid: false, format: "unknown", error: "The document exceeds the 100 MB file size limit." };
  }

  const buf = Buffer.from(bytes.subarray(0, 16));
  const isDocx = buf.subarray(0, 4).equals(DOCX_ZIP_HEADER);
  const isDoc = buf.subarray(0, 8).equals(DOC_OLE_HEADER);

  const lowerName = filename.toLowerCase();

  // Explicit extension checks with signature matching
  if (lowerName.endsWith(".docx") || lowerName.endsWith(".dotx") || lowerName.endsWith(".docm")) {
    if (!isDocx) {
      return {
        valid: false,
        format: "unknown",
        error: "Invalid Word document signature. The file appears to be corrupted or not a valid Word document (.docx).",
      };
    }
    return { valid: true, format: "docx" };
  }

  if (lowerName.endsWith(".doc") || lowerName.endsWith(".dot")) {
    if (!isDoc) {
      return {
        valid: false,
        format: "unknown",
        error: "Invalid Word document signature. The file appears to be corrupted or not a valid Word document (.doc).",
      };
    }
    return { valid: true, format: "doc" };
  }

  // Sniff format by magic bytes if extension is missing or generic
  if (isDocx) {
    return { valid: true, format: "docx" };
  }

  if (isDoc) {
    return { valid: true, format: "doc" };
  }

  return {
    valid: false,
    format: "unknown",
    error: "Please upload a valid Word document (.docx or .doc). The file signature or format is invalid.",
  };
}

export type WordConversionResult = {
  pdfBuffer: Buffer;
  pageCount: number;
  method: string;
  warnings: string[];
  featuresDetected: string[];
  latencyMs?: number;
};

export function getGotenbergUrl(): string {
  const envUrl = process.env.GOTENBERG_URL?.trim();
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }
  // Inside Docker Compose, clearpdf container connects to gotenberg container
  if (process.env.NODE_ENV === "production" && !process.env.PORT) {
    return "http://gotenberg:3000";
  }
  // In local development outside Docker, default to port 3001
  // to avoid colliding with Next.js which listens on port 3000
  return "http://127.0.0.1:3001";
}

function isSelfAddress(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const isLocal =
      u.hostname === "localhost" ||
      u.hostname === "127.0.0.1" ||
      u.hostname === "0.0.0.0";
    const currentPort = process.env.PORT || "3000";
    const targetPort = u.port || (u.protocol === "https:" ? "443" : "80");
    return isLocal && String(targetPort) === String(currentPort);
  } catch {
    return false;
  }
}

export function sanitizeErrorMessage(rawMessage: string): string {
  if (!rawMessage) return "Word to PDF conversion failed. Please try again.";

  // Strip internal URLs, hostnames, IPs, ports, and file paths to avoid leaking backend details
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
    lower.includes("econnreset") ||
    lower.includes("server action unavailable")
  ) {
    return "The document conversion service is currently unavailable. Please try again later.";
  }

  return sanitized;
}

async function readStreamWithLimit(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number = MAX_WORD_FILE_SIZE,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalLength += value.byteLength;
        if (totalLength > maxBytes) {
          throw new WordConversionError("Converted PDF output exceeded the maximum allowed size limit.", 413);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}

async function runNativeWordConversion(
  inputBytes: Uint8Array,
  filename: string,
): Promise<Buffer | null> {
  if (process.platform !== "win32") {
    return null;
  }

  const scriptPath = path.resolve(process.cwd(), "scripts", "convert-docx-to-pdf.ps1");
  if (!fs.existsSync(scriptPath)) {
    return null;
  }

  const uniqueId = crypto.randomUUID();
  const ext = path.extname(filename).toLowerCase() || ".docx";
  const tempIn = path.join(os.tmpdir(), `clearpdf_winword_in_${uniqueId}${ext}`);
  const tempOut = path.join(os.tmpdir(), `clearpdf_winword_out_${uniqueId}.pdf`);

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
      timeout: 60_000,
    });

    if (fs.existsSync(tempOut)) {
      const pdfBytes = await fs.promises.readFile(tempOut);
      if (pdfBytes.byteLength > 0 && pdfBytes.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
        return pdfBytes;
      }
    }
    return null;
  } catch (err) {
    console.warn("[Word to PDF] Native Word COM conversion failed:", err);
    return null;
  } finally {
    try {
      if (fs.existsSync(tempIn)) await fs.promises.unlink(tempIn);
    } catch {
      // ignore
    }
    try {
      if (fs.existsSync(tempOut)) await fs.promises.unlink(tempOut);
    } catch {
      // ignore
    }
  }
}

async function runLocalLibreOffice(
  inputBytes: Uint8Array,
  filename: string,
): Promise<Buffer | null> {
  const sofficePath = process.env.LIBREOFFICE_PATH || "soffice";
  const uniqueId = crypto.randomUUID();
  const ext = path.extname(filename).toLowerCase() || ".docx";
  const tempDir = path.join(os.tmpdir(), `clearpdf_lo_${uniqueId}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  const tempIn = path.join(tempDir, `input${ext}`);
  await fs.promises.writeFile(tempIn, Buffer.from(inputBytes));

  try {
    await execFileAsync(sofficePath, [
      "--headless",
      "--convert-to",
      "pdf",
      "--outdir",
      tempDir,
      tempIn,
    ], {
      timeout: 60_000,
    });

    const expectedOut = path.join(tempDir, "input.pdf");
    if (fs.existsSync(expectedOut)) {
      const pdfBytes = await fs.promises.readFile(expectedOut);
      if (pdfBytes.byteLength > 0 && pdfBytes.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
        return pdfBytes;
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

function getLocalPythonExecutable(): string | null {
  if (process.env.WORD_ENGINE_PYTHON_PATH && fs.existsSync(process.env.WORD_ENGINE_PYTHON_PATH)) {
    return process.env.WORD_ENGINE_PYTHON_PATH;
  }
  const localVenvWin = path.resolve(process.cwd(), "aspose-env", "Scripts", "python.exe");
  if (fs.existsSync(localVenvWin)) {
    return localVenvWin;
  }
  const localVenvNix = path.resolve(process.cwd(), "aspose-env", "bin", "python");
  if (fs.existsSync(localVenvNix)) {
    return localVenvNix;
  }
  return "python";
}

async function runLocalDocxFallback(inputBytes: Uint8Array): Promise<Buffer | null> {
  const pythonExec = getLocalPythonExecutable();
  if (!pythonExec) return null;

  const scriptPath = path.resolve(process.cwd(), "src", "lib", "docx-local-fallback.py");
  if (!fs.existsSync(scriptPath)) return null;

  const uniqueId = crypto.randomUUID();
  const tempIn = path.join(os.tmpdir(), `clearpdf_docx_in_${uniqueId}.docx`);
  const tempOut = path.join(os.tmpdir(), `clearpdf_docx_out_${uniqueId}.pdf`);

  await fs.promises.writeFile(tempIn, Buffer.from(inputBytes));

  try {
    await execFileAsync(pythonExec, [scriptPath, tempIn, tempOut], {
      timeout: 30_000,
      shell: false,
    });

    if (fs.existsSync(tempOut)) {
      const pdfBytes = await fs.promises.readFile(tempOut);
      return pdfBytes;
    }
    return null;
  } catch (err) {
    console.warn("[Word to PDF] Local fallback execution failed:", err);
    return null;
  } finally {
    try {
      if (fs.existsSync(tempIn)) await fs.promises.unlink(tempIn);
    } catch {
      // ignore
    }
    try {
      if (fs.existsSync(tempOut)) await fs.promises.unlink(tempOut);
    } catch {
      // ignore
    }
  }
}

export async function convertWordToPdf(
  inputBytes: Uint8Array,
  filename: string,
): Promise<WordConversionResult> {
  const validation = validateWordDocument(inputBytes, filename);
  if (!validation.valid) {
    throw new WordConversionError(validation.error || "Invalid Word document.", 400);
  }

  // Submit via durable worker coordinator queue for concurrency control and idempotency
  return globalConversionQueue.submit(inputBytes, filename, async () => {
    const startTime = Date.now();

    // 1. Native Word conversion on Windows (provides 100% exact original Word layout, fonts, margins, tables)
    if (process.platform === "win32") {
      try {
        const nativePdf = await runNativeWordConversion(inputBytes, filename);
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
            method: "native-word-engine",
            warnings: [],
            featuresDetected: [validation.format.toUpperCase()],
            latencyMs: Date.now() - startTime,
          };
        }
      } catch (err) {
        console.warn("[Word to PDF] Native Word COM conversion failed, trying alternatives:", err);
      }
    }

    const gotenbergBase = getGotenbergUrl();
    const isSelf = isSelfAddress(gotenbergBase);

    // If Gotenberg is not pointing to the Next.js self-port, attempt Gotenberg conversion first
    if (!isSelf) {
      const endpoint = `${gotenbergBase}/forms/libreoffice/convert`;
      const formData = new FormData();
      const mimeType =
        validation.format === "doc"
          ? "application/msword"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

      const fileBlob = new Blob([Buffer.from(inputBytes)], { type: mimeType });
      formData.append("files", fileBlob, filename);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONVERSION_TIMEOUT_MS);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          body: formData,
          signal: controller.signal,
          headers: {
            "Gotenberg-Trace": `clearpdf-${crypto.randomUUID()}`,
          },
        });

        // If response is a Next.js Server Action 409 or loop, do not process as Gotenberg
        if (response.status === 409) {
          throw new WordConversionError("Gotenberg service unavailable", 503);
        }

        if (!response.ok) {
          let errText = "";
          try {
            const rawErr = await response.text();
            errText = rawErr.slice(0, 1024);
          } catch {
            // ignore
          }

          if (errText.includes("Server Action unavailable")) {
            throw new WordConversionError("Gotenberg service unavailable", 503);
          }

          if (response.status === 400 || response.status === 422) {
            throw new WordConversionError(
              "Failed to convert Word document. The file may be password-protected, corrupted, or unsupported.",
              response.status,
            );
          }

          if (response.status === 504) {
            throw new WordConversionError(
              "Document conversion timed out. Please try with a smaller document or retry shortly.",
              504,
            );
          }

          if (response.status === 503 || response.status === 502) {
            throw new WordConversionError(
              "The document conversion service is currently unavailable. Please try again later.",
              503,
            );
          }

          throw new WordConversionError(
            sanitizeErrorMessage(errText || "Word to PDF conversion service error."),
            response.status,
          );
        }

        if (response.body) {
          const pdfBuffer = await readStreamWithLimit(response.body, MAX_WORD_FILE_SIZE);
          if (pdfBuffer.byteLength > 0 && pdfBuffer.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
            let pageCount = 1;
            try {
              const doc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
              pageCount = Math.max(1, doc.getPageCount());
            } catch {
              pageCount = 1;
            }

            return {
              pdfBuffer,
              pageCount,
              method: "gotenberg-libreoffice",
              warnings: [],
              featuresDetected: [validation.format.toUpperCase()],
              latencyMs: Date.now() - startTime,
            };
          }
        }
      } catch (err: unknown) {
        if (err instanceof WordConversionError && (err.statusCode === 400 || err.statusCode === 422)) {
          throw err;
        }
        // If Gotenberg is not reachable or errored, proceed to local fallback below
        console.warn("[Word to PDF] Gotenberg unreachable, trying local converter...");
      } finally {
        clearTimeout(timeoutId);
      }
    }

    // Local LibreOffice CLI if installed
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
    } catch {
      // ignore
    }

    // Local fallback for local development environment when Gotenberg is not running
    if (validation.format === "docx") {
      const localPdf = await runLocalDocxFallback(inputBytes);
      if (localPdf && localPdf.length > 0 && localPdf.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
        let pageCount = 1;
        try {
          const doc = await PDFDocument.load(localPdf, { ignoreEncryption: true });
          pageCount = Math.max(1, doc.getPageCount());
        } catch {
          pageCount = 1;
        }

        return {
          pdfBuffer: localPdf,
          pageCount,
          method: "local-docx-engine",
          warnings: ["Converted via local engine. For full LibreOffice fidelity, run Gotenberg via Docker Compose."],
          featuresDetected: ["DOCX"],
          latencyMs: Date.now() - startTime,
        };
      }
    }

    // If both Gotenberg and local fallback are unavailable
    throw new WordConversionError(
      "The document conversion service is currently unavailable. Please ensure the Gotenberg service is running (e.g. docker compose up) or configure GOTENBERG_URL.",
      503,
    );
  });
}
