import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isSameOriginRequest, consumeRateLimit } from "@/lib/request-guards";
import { createTransientDocument } from "@/lib/storage";
import {
  protectPdfDocument,
  validatePdfForProtecting,
  MAX_PROTECT_PDF_SIZE,
  ProtectPdfError,
  sanitizeErrorMessage,
} from "@/lib/protect-pdf-service";

const RATE_LIMIT_COUNT = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "This request was rejected." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rateLimit = consumeRateLimit("protect-pdf", RATE_LIMIT_COUNT, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit reached. Please try again later." },
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
        { error: "Please select a PDF document (.pdf) to protect." },
        { status: 400 },
      );
    }

    const password = formData.get("password");
    if (typeof password !== "string" || !password.trim()) {
      return NextResponse.json(
        { error: "Please enter a password to protect your PDF document." },
        { status: 400 },
      );
    }

    const ownerPassword = formData.get("ownerPassword");
    const allowPrinting = formData.get("allowPrinting") !== "false";
    const allowCopying = formData.get("allowCopying") !== "false";
    const allowModifying = formData.get("allowModifying") === "true";

    const filename = (file as File).name || "document.pdf";
    const arrayBuf = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);

    if (bytes.byteLength === 0) {
      return NextResponse.json(
        { error: "The uploaded file is empty." },
        { status: 400 },
      );
    }

    if (bytes.byteLength > MAX_PROTECT_PDF_SIZE) {
      return NextResponse.json(
        { error: "The PDF document exceeds the 100 MB file size limit." },
        { status: 400 },
      );
    }

    const validation = validatePdfForProtecting(bytes, filename);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Please upload a valid PDF document." },
        { status: 400 },
      );
    }

    // Encrypt PDF with 256-bit AES
    const result = await protectPdfDocument(bytes, filename, {
      userPassword: password.trim(),
      ownerPassword: typeof ownerPassword === "string" && ownerPassword.trim() ? ownerPassword.trim() : undefined,
      allowPrinting,
      allowCopying,
      allowModifying,
    });

    const id = randomUUID();
    const baseName = filename.replace(/\.pdf$/i, "") || "document";
    const outputFilename = `${baseName}_protected.pdf`;

    // Save as transient document so it can be edited in workspace or downloaded
    createTransientDocument(
      {
        id,
        filename: outputFilename,
        size: result.pdfBuffer.byteLength,
        uploadedAt: new Date().toISOString(),
      },
      result.pdfBuffer,
    );

    const url = new URL(request.url);
    const directDownload = url.searchParams.get("download") === "1";

    if (directDownload) {
      const uint8 = new Uint8Array(result.pdfBuffer);
      return new NextResponse(uint8, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${encodeURIComponent(outputFilename)}"`,
          "Content-Length": String(result.pdfBuffer.byteLength),
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      });
    }

    return NextResponse.json({
      id,
      filename: outputFilename,
      originalSize: result.originalSize,
      outputSize: result.outputSize,
      pageCount: result.pageCount,
      algorithm: result.algorithm,
      downloadUrl: `/api/documents/${id}/file?download=1`,
      success: true,
    });
  } catch (err: unknown) {
    if (err instanceof ProtectPdfError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode },
      );
    }

    const message = err instanceof Error ? err.message : "PDF protection failed.";
    return NextResponse.json(
      { error: sanitizeErrorMessage(message) },
      { status: 500 },
    );
  }
}
