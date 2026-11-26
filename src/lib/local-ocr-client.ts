/** Runs the bundled Python/PDFium/Tesseract OCR engine without a separate worker service. */

import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OCR_TIMEOUT_MS = 10 * 60 * 1000;
const OCR_MAX_BUFFER_BYTES = 64 * 1024 * 1024;

export type OcrBox = {
  text: string;
  /** [x0_px, y0_px, x1_px, y1_px] in rendered-image pixels */
  bbox: [number, number, number, number];
  confidence: number;
  low_confidence: boolean;
};

export type OcrPage = {
  page_num: number;
  width_pts: number;
  height_pts: number;
  render_dpi: number;
  img_width_px: number;
  img_height_px: number;
  rotation: number;
  skipped: boolean;
  boxes: OcrBox[];
  native_text?: string;
  error?: string;
};

export type LocalOcrResponse = {
  job_id: string;
  total_pages: number;
  pages: OcrPage[];
};

export async function runLocalOcrEngine(
  pdfBytes: Buffer,
  jobId: string,
): Promise<LocalOcrResponse> {
  const workingDirectory = await mkdtemp(path.join(os.tmpdir(), "yourpdf-ocr-"));
  const inputPath = path.join(workingDirectory, "input.pdf");
  const scriptPath = path.join(process.cwd(), "scripts", "pdf_ocr_engine.py");
  const pythonExec = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

  try {
    await writeFile(inputPath, pdfBytes, { mode: 0o600 });

    let stdout: string;
    try {
      ({ stdout } = await execFileAsync(pythonExec, [scriptPath, inputPath, jobId], {
        timeout: OCR_TIMEOUT_MS,
        maxBuffer: OCR_MAX_BUFFER_BYTES,
        windowsHide: true,
        env: { ...process.env, PYTHONIOENCODING: "utf-8" },
      }));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        throw new Error("The local OCR engine is unavailable. Please redeploy the service.");
      }
      const detail = error instanceof Error ? error.message : "unknown OCR engine error";
      throw new Error(`The local OCR engine could not process this PDF: ${detail}`);
    }

    let response: LocalOcrResponse;
    try {
      response = JSON.parse(stdout.trim()) as LocalOcrResponse;
    } catch {
      throw new Error("The local OCR engine returned an invalid result. Please retry.");
    }

    if (
      response.job_id !== jobId ||
      !Array.isArray(response.pages) ||
      response.total_pages !== response.pages.length
    ) {
      throw new Error("The local OCR engine returned incomplete page data. Please retry.");
    }

    return response;
  } finally {
    await rm(workingDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}
