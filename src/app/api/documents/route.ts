import { randomUUID } from "node:crypto";
import { createTransientDocument, type UploadMetadata } from "@/lib/storage";
import { NextResponse } from "next/server";
import { consumeRateLimit, isSameOriginRequest } from "@/lib/request-guards";
import {
  convertWordToPdf,
  validateWordDocument,
  WordConversionError,
  sanitizeErrorMessage,
} from "@/lib/word-converter";

const MAX_DOCUMENT_SIZE = 100 * 1024 * 1024;
const MAX_MULTIPART_SIZE = MAX_DOCUMENT_SIZE + 1024 * 1024;
const UPLOAD_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

class UploadTooLargeError extends Error {}

async function parseMultipartWithinLimit(request: Request, limit: number) {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    throw new Error("The upload request must use multipart form data.");
  }

  const source = request.body;
  if (!source) throw new Error("The upload body is empty.");
  const reader = source.getReader();
  let totalBytes = 0;
  const boundedStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        totalBytes += value.byteLength;
        if (totalBytes > limit) {
          const error = new UploadTooLargeError("Documents must be 100 MB or smaller.");
          controller.error(error);
          await reader.cancel(error).catch(() => undefined);
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel(reason) {
      await reader.cancel(reason);
    },
  });

  const parseRequest = new Request("http://localhost/upload", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: boundedStream,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  return parseRequest.formData();
}

function safeFilename(filename: string) {
  const basename = filename.replaceAll("\\", "/").split("/").pop() ?? "document.pdf";
  return basename.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 180) || "document.pdf";
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: "This upload request was rejected." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  }

  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader && /^\d+$/.test(contentLengthHeader) ? Number(contentLengthHeader) : null;
  if (contentLengthHeader && contentLength === null) {
    return NextResponse.json({ error: "The upload request has an invalid content length." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength > MAX_MULTIPART_SIZE)) {
    return NextResponse.json({ error: "Documents must be 100 MB or smaller." }, { status: 413 });
  }

  const rateLimit = consumeRateLimit("document-upload", UPLOAD_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "The upload limit has been reached. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  let form: FormData;
  try {
    // Preview proxies may omit Content-Length, so enforce the request cap on the stream.
    form = await parseMultipartWithinLimit(request, MAX_MULTIPART_SIZE);
  } catch (error) {
    if (error instanceof UploadTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "The upload could not be read. Check the document size and retry." }, { status: 400 });
  }

  const entry = form.get("file");
  if (!(entry instanceof File)) {
    return NextResponse.json({ error: "Choose a PDF or Word document to upload." }, { status: 400 });
  }

  const filename = safeFilename(entry.name);
  const lowerName = filename.toLowerCase();
  const isPdf = lowerName.endsWith(".pdf");
  const isWord =
    lowerName.endsWith(".docx") ||
    lowerName.endsWith(".doc") ||
    lowerName.endsWith(".dotx") ||
    lowerName.endsWith(".docm") ||
    lowerName.endsWith(".dot");

  if (!isPdf && !isWord) {
    return NextResponse.json({ error: "Only PDF and Word documents (.docx, .doc) are accepted." }, { status: 415 });
  }
  if (entry.size === 0) {
    return NextResponse.json({ error: "This document is empty." }, { status: 400 });
  }
  if (entry.size > MAX_DOCUMENT_SIZE) {
    return NextResponse.json({ error: "Documents must be 100 MB or smaller." }, { status: 413 });
  }

  const bytes = Buffer.from(await entry.arrayBuffer());

  let finalPdfBuffer: Buffer;
  let finalFilename = filename;

  if (isWord) {
    const validation = validateWordDocument(bytes, filename);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error ?? "Invalid Word document signature." },
        { status: 415 },
      );
    }

    try {
      const conversion = await convertWordToPdf(bytes, filename);
      finalPdfBuffer = conversion.pdfBuffer;
      const baseName = filename.replace(/\.(docx?|dotx?|docm)$/i, "") || "document";
      finalFilename = `${baseName}.pdf`;
    } catch (error) {
      console.error("[POST /api/documents] Word conversion failed:", error);
      if (error instanceof WordConversionError) {
        return NextResponse.json(
          { error: sanitizeErrorMessage(error.message) },
          { status: error.statusCode },
        );
      }
      return NextResponse.json(
        { error: sanitizeErrorMessage(error instanceof Error ? error.message : "Word document conversion failed.") },
        { status: 500 },
      );
    }
  } else {
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) {
      return NextResponse.json({ error: "The selected file does not contain a valid PDF header." }, { status: 415 });
    }
    finalPdfBuffer = bytes;
  }

  const metadata: UploadMetadata = {
    id: randomUUID(),
    filename: finalFilename,
    size: finalPdfBuffer.byteLength,
    uploadedAt: new Date().toISOString(),
  };

  try {
    createTransientDocument(metadata, finalPdfBuffer, isWord ? bytes : undefined);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The document could not be held temporarily. Please retry the upload." },
      { status: 507 },
    );
  }

  return NextResponse.json(metadata, { status: 201 });
}
