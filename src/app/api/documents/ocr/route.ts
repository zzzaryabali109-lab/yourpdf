import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isSameOriginRequest, consumeRateLimit } from "@/lib/request-guards";
import {
  saveCleanPdf,
  saveOcrStatus,
  createTransientDocument,
  getTransientDocument,
} from "@/lib/storage";
import { processPdfOcr } from "@/lib/local-ocr";

const MAX_PDF_SIZE = 100 * 1024 * 1024;
const OCR_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function isPdfSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 5) return false;
  return Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from("%PDF-"));
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "This request was rejected." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rateLimit = consumeRateLimit("pdf-ocr", OCR_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "The rate limit has been reached. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  try {
    let bytes: Buffer | null = null;
    let originalName = "document.pdf";

    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const body = await request.json();
      if (body.documentId) {
        const doc = getTransientDocument(body.documentId);
        if (!doc) {
          return NextResponse.json(
            { error: "Document not found or temporary session expired." },
            { status: 404 },
          );
        }
        bytes = doc.original;
        originalName = doc.metadata.filename;
      }
    } else {
      const formData = await request.formData();
      const documentId = formData.get("documentId")?.toString()?.trim();
      const file = formData.get("file");

      if (documentId) {
        const doc = getTransientDocument(documentId);
        if (!doc) {
          return NextResponse.json(
            { error: "Document not found or temporary session expired." },
            { status: 404 },
          );
        }
        bytes = doc.original;
        originalName = doc.metadata.filename;
      } else if (file && file instanceof Blob) {
        bytes = Buffer.from(await file.arrayBuffer());
        if (typeof file.name === "string") originalName = file.name;
      }
    }

    if (!bytes || bytes.byteLength === 0) {
      return NextResponse.json(
        { error: "Please select a PDF file to process." },
        { status: 400 },
      );
    }

    if (bytes.byteLength > MAX_PDF_SIZE) {
      return NextResponse.json(
        { error: "The selected file exceeds the 100 MB limit." },
        { status: 400 },
      );
    }

    if (!isPdfSignature(bytes)) {
      return NextResponse.json(
        { error: "The selected file does not contain a valid PDF signature." },
        { status: 400 },
      );
    }

    const baseName = originalName.replace(/\.pdf$/i, "").trim() || "document";
    const filename = `${baseName}-ocr.pdf`;

    const result = await processPdfOcr(bytes);
    const id = randomUUID();

    createTransientDocument(
      {
        id,
        filename,
        size: result.outputBytes.byteLength,
        uploadedAt: new Date().toISOString(),
      },
      result.outputBytes,
    );

    saveCleanPdf(id, result.outputBytes);
    saveOcrStatus(id, {
      status: "completed",
      completedAt: new Date().toISOString(),
      totalPages: result.pageCount,
      completedPages: result.pageCount,
      failedPages: 0,
      conversion: "invisible-text-layer",
      recognizedText: result.recognizedText,
      textCharacters: result.textCharacters,
      outputSize: result.outputBytes.byteLength,
    });

    return NextResponse.json(
      {
        success: true,
        id,
        filename,
        originalFilename: originalName,
        originalSize: bytes.byteLength,
        ocrSize: result.outputBytes.byteLength,
        pageCount: result.pageCount,
        textCharacters: result.textCharacters,
        recognizedText: result.recognizedText,
        downloadUrl: `/api/documents/${id}/file?download=1`,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("PDF OCR processing failed:", error);
    const message = error instanceof Error ? error.message : "OCR processing failed. Please retry.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
