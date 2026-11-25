import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isSameOriginRequest, consumeRateLimit } from "@/lib/request-guards";
import { createTransientDocument } from "@/lib/storage";
import {
  validatePdfDocument,
  MAX_PDF_TO_JPG_SIZE,
  PdfToJpgConversionError,
  sanitizeErrorMessage,
} from "@/lib/pdf-to-jpg-converter";

const RATE_LIMIT_COUNT = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "This conversion request was rejected." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rateLimit = consumeRateLimit("pdf-to-jpg", RATE_LIMIT_COUNT, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Conversion rate limit reached. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
          "Cache-Control": "no-store",
        },
      },
    );
  }

  try {
    const formData = await request.formData();
    let file = formData.get("file");
    if (!file) {
      const files = formData.getAll("files");
      if (files && files.length > 0) {
        file = files[0];
      }
    }

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Please select a PDF file (.pdf) to convert." },
        { status: 400 },
      );
    }

    const filename = (file as File).name || "document.pdf";
    const arrayBuf = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);

    if (bytes.byteLength === 0) {
      return NextResponse.json(
        { error: "The uploaded file is empty." },
        { status: 400 },
      );
    }

    if (bytes.byteLength > MAX_PDF_TO_JPG_SIZE) {
      return NextResponse.json(
        { error: "The PDF document exceeds the 100 MB file size limit." },
        { status: 400 },
      );
    }

    const validation = await validatePdfDocument(bytes, filename);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Please upload a valid PDF file." },
        { status: 400 },
      );
    }

    const id = randomUUID();
    const pageCount = validation.pageCount || 1;

    // Save as transient document so it can be edited in workspace or fetched
    createTransientDocument(
      {
        id,
        filename,
        size: bytes.byteLength,
        uploadedAt: new Date().toISOString(),
      },
      Buffer.from(bytes),
    );

    return NextResponse.json(
      {
        id,
        filename,
        pageCount,
        originalSize: bytes.byteLength,
        downloadUrl: `/api/documents/${id}/file?download=1`,
      },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[PDF to JPG] Processing failed:", error);
    if (error instanceof PdfToJpgConversionError) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(error.message) },
        { status: error.statusCode },
      );
    }
    const message = sanitizeErrorMessage(
      error instanceof Error ? error.message : "PDF to JPG conversion failed. Please retry.",
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
