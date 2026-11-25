/**
 * paddle-ocr-client.ts
 *
 * Connects the Next.js/Node backend to the private Python OCR worker
 * running on localhost:7331. The worker uses RapidOCR (PaddleOCR ONNX models)
 * and returns per-page text boxes in pixel coordinates of the rendered image.
 *
 * The Node side maps those pixel coords back to PDF point coordinates
 * before embedding the invisible text layer.
 */

const OCR_WORKER_URL = process.env.OCR_WORKER_URL ?? "http://127.0.0.1:7331";
const OCR_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes total

export type OcrBox = {
  text: string;
  /** [x0_px, y0_px, x1_px, y1_px] in rendered image pixels */
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
  error?: string;
};

export type PaddleOcrResponse = {
  job_id: string;
  total_pages: number;
  pages: OcrPage[];
};

/** Ping the worker to ensure it is healthy before uploading a large PDF. */
export async function checkOcrWorkerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${OCR_WORKER_URL}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { status: string };
    return json.status === "ok";
  } catch {
    return false;
  }
}

/**
 * Send a PDF to the local OCR worker for processing.
 * Returns structured per-page OCR results.
 *
 * Throws if the worker is unreachable, returns an HTTP error, or times out.
 */
export async function callPaddleOcrWorker(
  pdfBytes: Buffer,
  jobId: string,
): Promise<PaddleOcrResponse> {
  const pdf_b64 = pdfBytes.toString("base64");

  let response: Response;
  try {
    response = await fetch(`${OCR_WORKER_URL}/ocr`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdf_b64, job_id: jobId }),
      signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    if (isTimeout) {
      throw new Error(
        "OCR worker timed out. The document may be too large or the worker is overloaded.",
      );
    }
    throw new Error(
      `OCR worker unreachable at ${OCR_WORKER_URL}. ` +
        "Start the worker with: python ocr-worker/server.py",
    );
  }

  if (!response.ok) {
    let detail = "";
    try {
      const json = (await response.json()) as { error?: string };
      detail = json.error ? ` — ${json.error}` : "";
    } catch {
      /* ignore */
    }
    throw new Error(`OCR worker returned HTTP ${response.status}${detail}`);
  }

  const data = (await response.json()) as PaddleOcrResponse;
  return data;
}

