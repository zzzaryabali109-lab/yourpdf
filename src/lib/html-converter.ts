import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { PDFDocument } from "pdf-lib";
import { globalConversionQueue } from "./conversion-queue";
import { libreOfficeUserProfileArg } from "./libreoffice";

const execFileAsync = promisify(execFile);

export const MAX_HTML_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

export class HtmlConversionError extends Error {
  public statusCode: number;

  constructor(message: string, statusCode = 500) {
    super(message);
    this.name = "HtmlConversionError";
    this.statusCode = statusCode;
  }
}

export type HtmlValidationResult = {
  valid: boolean;
  format: "html" | "xhtml" | "unknown";
  error?: string;
};

export function validateHtmlDocument(
  bytes: Uint8Array,
  filename: string,
): HtmlValidationResult {
  if (bytes.byteLength === 0) {
    return { valid: false, format: "unknown", error: "The uploaded file is empty." };
  }

  if (bytes.byteLength > MAX_HTML_FILE_SIZE) {
    return { valid: false, format: "unknown", error: "The HTML document exceeds the 50 MB file size limit." };
  }

  const lowerName = filename.toLowerCase();
  const sample = Buffer.from(bytes.subarray(0, 4096)).toString("utf-8").toLowerCase();

  const isHtmlExtension =
    lowerName.endsWith(".html") ||
    lowerName.endsWith(".htm") ||
    lowerName.endsWith(".xhtml") ||
    lowerName.endsWith(".txt");

  const hasHtmlTags =
    sample.includes("<!doctype html") ||
    sample.includes("<html") ||
    sample.includes("<head") ||
    sample.includes("<body") ||
    sample.includes("<?xml") ||
    sample.includes("<div") ||
    sample.includes("<p") ||
    sample.includes("<table") ||
    sample.includes("<style");

  if (lowerName.endsWith(".xhtml")) {
    return { valid: true, format: "xhtml" };
  }

  if (isHtmlExtension || hasHtmlTags) {
    return { valid: true, format: "html" };
  }

  return {
    valid: false,
    format: "unknown",
    error: "Please upload a valid HTML file (.html, .htm, or .xhtml).",
  };
}

export function sanitizeErrorMessage(rawMessage: string): string {
  if (!rawMessage) return "HTML to PDF conversion failed. Please try again.";

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

export function getChromiumExecutable(): string | null {
  const envCandidates = [
    process.env.CHROME_BIN,
    process.env.EDGE_BIN,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.BROWSER_PATH,
  ];

  for (const candidate of envCandidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";

    const winCandidates = [
      path.join(programFiles, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(programFilesX86, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(programFilesX86, "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(programFiles, "Microsoft\\Edge\\Application\\msedge.exe"),
      path.join(localAppData, "Google\\Chrome\\Application\\chrome.exe"),
      path.join(localAppData, "Microsoft\\Edge\\Application\\msedge.exe"),
    ];

    for (const p of winCandidates) {
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
        return p;
      }
    }
  } else if (process.platform === "darwin") {
    const macCandidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
    for (const p of macCandidates) {
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
        return p;
      }
    }
  } else {
    // Linux / POSIX
    const linuxCandidates = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/snap/bin/chromium",
    ];
    for (const p of linuxCandidates) {
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
        return p;
      }
    }
  }

  return null;
}

async function runNativeChromiumConversion(
  inputBytes: Uint8Array,
  filename: string,
): Promise<Buffer | null> {
  const browserPath = getChromiumExecutable();
  if (!browserPath) {
    return null;
  }

  const uniqueId = crypto.randomUUID();
  const ext = path.extname(filename).toLowerCase() || ".html";
  const tempDir = path.join(os.tmpdir(), `clearpdf_html_${uniqueId}`);
  await fs.promises.mkdir(tempDir, { recursive: true });

  const tempIn = path.join(tempDir, `index${ext}`);
  const tempOut = path.join(tempDir, "output.pdf");

  let htmlText = Buffer.from(inputBytes).toString("utf-8");
  // Ensure UTF-8 meta charset is present if not already declared to prevent encoding issues
  if (!htmlText.includes("<meta charset") && !htmlText.includes("<meta http-equiv=\"Content-Type\"")) {
    if (htmlText.includes("<head>")) {
      htmlText = htmlText.replace("<head>", '<head><meta charset="utf-8">');
    } else if (htmlText.includes("<head ")) {
      htmlText = htmlText.replace(/(<head[^>]*>)/i, '$1<meta charset="utf-8">');
    } else {
      htmlText = `<meta charset="utf-8">\n${htmlText}`;
    }
  }

  await fs.promises.writeFile(tempIn, htmlText, "utf-8");

  try {
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--no-pdf-header-footer",
      "--run-all-compositor-stages-before-draw",
      `--print-to-pdf=${tempOut}`,
      tempIn,
    ];

    await execFileAsync(browserPath, args, {
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
    console.warn("[HTML to PDF] Native Chromium conversion error:", err);
    return null;
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

async function runGotenbergHtmlConversion(
  inputBytes: Uint8Array,
): Promise<Buffer | null> {
  const configuredUrl = process.env.GOTENBERG_URL?.trim();
  const gotenbergBase =
    configuredUrl || (process.env.NODE_ENV === "production" ? null : "http://127.0.0.1:3001");
  if (!gotenbergBase) return null;
  const endpoint = `${gotenbergBase.replace(/\/+$/, "")}/forms/chromium/convert/html`;

  const formData = new FormData();
  formData.append(
    "files",
    new Blob([new Uint8Array(inputBytes)], { type: "text/html; charset=utf-8" }),
    "index.html",
  );

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: formData,
      signal: controller.signal,
      headers: {
        "Gotenberg-Trace": `clearpdf-html-${crypto.randomUUID()}`,
      },
    });

    if (response.ok) {
      const arrayBuffer = await response.arrayBuffer();
      const pdfBytes = Buffer.from(arrayBuffer);
      if (pdfBytes.byteLength > 0 && pdfBytes.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
        return pdfBytes;
      }
    }
    return null;
  } catch (err) {
    console.warn("[HTML to PDF] Gotenberg conversion unavailable:", err);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runLocalLibreOffice(
  inputBytes: Uint8Array,
  filename: string,
): Promise<Buffer | null> {
  const sofficePath = process.env.LIBREOFFICE_PATH || "soffice";
  const uniqueId = crypto.randomUUID();
  const ext = path.extname(filename).toLowerCase() || ".html";
  const tempDir = path.join(os.tmpdir(), `clearpdf_lo_html_${uniqueId}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  const tempIn = path.join(tempDir, `input${ext}`);
  await fs.promises.writeFile(tempIn, Buffer.from(inputBytes));

  try {
    await execFileAsync(
      sofficePath,
      [
        libreOfficeUserProfileArg(tempDir),
        "--headless",
        "--convert-to",
        "pdf",
        "--outdir",
        tempDir,
        tempIn,
      ],
      { timeout: 60_000 },
    );

    const tempOut = path.join(tempDir, "input.pdf");
    if (fs.existsSync(tempOut)) {
      return await fs.promises.readFile(tempOut);
    }
    return null;
  } catch (err) {
    console.warn("[HTML to PDF] Local LibreOffice conversion failed:", err);
    return null;
  } finally {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
}

export type HtmlConversionResult = {
  pdfBuffer: Buffer;
  pageCount: number;
  method: string;
  warnings: string[];
  featuresDetected: string[];
  latencyMs: number;
};

export async function convertHtmlToPdf(
  inputBytes: Uint8Array,
  filename: string,
): Promise<HtmlConversionResult> {
  const validation = validateHtmlDocument(inputBytes, filename);
  if (!validation.valid) {
    throw new HtmlConversionError(validation.error || "Invalid HTML document.", 400);
  }

  return globalConversionQueue.submit(inputBytes, filename, async () => {
    const startTime = Date.now();

    // 1. Native Chromium engine (Google Chrome or Microsoft Edge headless)
    try {
      const nativePdf = await runNativeChromiumConversion(inputBytes, filename);
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
          method: "native-chromium-engine",
          warnings: [],
          featuresDetected: [validation.format.toUpperCase()],
          latencyMs: Date.now() - startTime,
        };
      }
    } catch (err) {
      console.warn("[HTML to PDF] Native Chromium conversion failed, trying fallbacks:", err);
    }

    // 2. Gotenberg HTML endpoint if running
    try {
      const gotenbergPdf = await runGotenbergHtmlConversion(inputBytes);
      if (gotenbergPdf && gotenbergPdf.byteLength > 0 && gotenbergPdf.subarray(0, 5).toString("latin1").startsWith("%PDF-")) {
        let pageCount = 1;
        try {
          const doc = await PDFDocument.load(gotenbergPdf, { ignoreEncryption: true });
          pageCount = Math.max(1, doc.getPageCount());
        } catch {
          pageCount = 1;
        }

        return {
          pdfBuffer: gotenbergPdf,
          pageCount,
          method: "gotenberg-chromium",
          warnings: [],
          featuresDetected: [validation.format.toUpperCase()],
          latencyMs: Date.now() - startTime,
        };
      }
    } catch {}

    // 3. Local LibreOffice fallback if installed
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

    throw new HtmlConversionError(
      "The HTML conversion service is currently unavailable. Please ensure Google Chrome, Microsoft Edge, or Gotenberg is available.",
      503,
    );
  });
}
