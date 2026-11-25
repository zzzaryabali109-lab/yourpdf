import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { randomUUID } from "node:crypto";
import { isSameOriginRequest, consumeRateLimit } from "@/lib/request-guards";
import { createTransientDocument } from "@/lib/storage";

const MAX_PDF_SIZE = 100 * 1024 * 1024;
const MERGE_RATE_LIMIT = 20;
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

  const rateLimit = consumeRateLimit("pdf-merge", MERGE_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "The rate limit has been reached. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  try {
    const formData = await request.formData();
    const files = formData.getAll("files");

    if (!files || files.length < 2) {
      return NextResponse.json(
        { error: "Please select at least 2 PDF files to merge." },
        { status: 400 },
      );
    }

    const mergedDoc = await PDFDocument.create();
    let totalPages = 0;

    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (!(item instanceof Blob)) continue;

      const arrayBuf = await item.arrayBuffer();
      const bytes = Buffer.from(arrayBuf);

      if (bytes.byteLength === 0) {
        return NextResponse.json(
          { error: `File #${i + 1} is empty.` },
          { status: 400 },
        );
      }

      if (bytes.byteLength > MAX_PDF_SIZE) {
        return NextResponse.json(
          { error: `File #${i + 1} exceeds the 100 MB limit.` },
          { status: 400 },
        );
      }

      if (!isPdfSignature(bytes)) {
        return NextResponse.json(
          { error: `File #${i + 1} does not have a valid PDF signature.` },
          { status: 400 },
        );
      }

      try {
        const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pageIndices = srcDoc.getPageIndices();
        const copiedPages = await mergedDoc.copyPages(srcDoc, pageIndices);
        for (const page of copiedPages) {
          mergedDoc.addPage(page);
          totalPages++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.toLowerCase().includes("encrypt") || msg.toLowerCase().includes("password")) {
          return NextResponse.json(
            { error: `File #${i + 1} is password-protected. Please remove password protection before merging.` },
            { status: 400 },
          );
        }
        return NextResponse.json(
          { error: `File #${i + 1} is corrupted or cannot be read.` },
          { status: 400 },
        );
      }
    }

    const mergedBytes = Buffer.from(await mergedDoc.save({ useObjectStreams: true }));
    const id = randomUUID();
    const filename = "merged-document.pdf";

    createTransientDocument(
      {
        id,
        filename,
        size: mergedBytes.byteLength,
        uploadedAt: new Date().toISOString(),
      },
      mergedBytes,
    );

    return NextResponse.json(
      {
        id,
        filename,
        pageCount: totalPages,
        filesMerged: files.length,
        size: mergedBytes.byteLength,
        downloadUrl: `/api/documents/${id}/file?download=1`,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("PDF merge failed:", error);
    const message = error instanceof Error ? error.message : "Merging PDFs failed. Please retry.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

