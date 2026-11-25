import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { randomUUID } from "node:crypto";
import { isSameOriginRequest, consumeRateLimit } from "@/lib/request-guards";
import { createTransientDocument } from "@/lib/storage";

const MAX_PDF_SIZE = 100 * 1024 * 1024;
const SPLIT_RATE_LIMIT = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function isPdfSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 5) return false;
  return Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from("%PDF-"));
}

/**
 * Parses user page range input like "1-3, 5, 7-9" into an array of 0-based page indices.
 */
function parsePageRanges(rangeStr: string, totalPages: number): number[] {
  const indices = new Set<number>();
  const parts = rangeStr.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);

  if (parts.length === 0) {
    // Default to all pages if empty
    for (let i = 0; i < totalPages; i++) indices.add(i);
    return Array.from(indices);
  }

  for (const part of parts) {
    if (part.includes("-")) {
      const [startStr, endStr] = part.split("-").map((s) => s.trim());
      const start = Math.max(1, Math.min(totalPages, parseInt(startStr, 10) || 1));
      const end = Math.max(1, Math.min(totalPages, parseInt(endStr, 10) || totalPages));
      const from = Math.min(start, end);
      const to = Math.max(start, end);
      for (let p = from; p <= to; p++) {
        indices.add(p - 1); // 0-based
      }
    } else {
      const p = parseInt(part, 10);
      if (!isNaN(p) && p >= 1 && p <= totalPages) {
        indices.add(p - 1); // 0-based
      }
    }
  }

  const sorted = Array.from(indices).sort((a, b) => a - b);
  return sorted.length > 0 ? sorted : Array.from({ length: totalPages }, (_, i) => i);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "This request was rejected." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rateLimit = consumeRateLimit("pdf-split", SPLIT_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "The rate limit has been reached. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const rangeInput = formData.get("range")?.toString()?.trim() || "";
    const fromPageStr = formData.get("fromPage")?.toString()?.trim();
    const toPageStr = formData.get("toPage")?.toString()?.trim();
    const splitAllParam = formData.get("splitAll")?.toString();

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: "Please select a PDF file to split." },
        { status: 400 },
      );
    }

    const arrayBuf = await file.arrayBuffer();
    const bytes = Buffer.from(arrayBuf);

    if (bytes.byteLength === 0) {
      return NextResponse.json(
        { error: "The selected file is empty." },
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

    let srcDoc: PDFDocument;
    try {
      srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("encrypt") || msg.toLowerCase().includes("password")) {
        return NextResponse.json(
          { error: "This PDF is password-protected. Please unlock the file before splitting." },
          { status: 400 },
        );
      }
      return NextResponse.json(
        { error: "This PDF is corrupted or cannot be read." },
        { status: 400 },
      );
    }

    const totalPages = srcDoc.getPageCount();
    if (totalPages === 0) {
      return NextResponse.json(
        { error: "This PDF contains no pages." },
        { status: 400 },
      );
    }

    let selectedIndices: number[];

    if (splitAllParam === "true" || (!fromPageStr && !toPageStr && !rangeInput)) {
      // Split each and every page into a separate PDF
      selectedIndices = Array.from({ length: totalPages }, (_, i) => i);
    } else if (fromPageStr && toPageStr) {
      const from = Math.max(1, Math.min(totalPages, parseInt(fromPageStr, 10) || 1));
      const to = Math.max(1, Math.min(totalPages, parseInt(toPageStr, 10) || totalPages));
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      selectedIndices = [];
      for (let p = start; p <= end; p++) {
        selectedIndices.push(p - 1);
      }
    } else if (rangeInput) {
      selectedIndices = parsePageRanges(rangeInput, totalPages);
    } else {
      selectedIndices = Array.from({ length: totalPages }, (_, i) => i);
    }

    const originalName = typeof file.name === "string" ? file.name : "document.pdf";
    const baseName = originalName.replace(/\.pdf$/i, "").trim() || "document";

    type CreatedFileInfo = {
      id: string;
      filename: string;
      pageNumber: number;
      size: number;
      downloadUrl: string;
    };

    const createdFiles: CreatedFileInfo[] = [];

    // Split each selected page into its own individual PDF document
    for (const pageIdx of selectedIndices) {
      const singleDoc = await PDFDocument.create();
      const [copiedPage] = await singleDoc.copyPages(srcDoc, [pageIdx]);
      singleDoc.addPage(copiedPage);

      const splitBytes = Buffer.from(await singleDoc.save({ useObjectStreams: true }));
      const pageId = randomUUID();
      const pageNum = pageIdx + 1;
      const pageFilename = `${baseName}-page-${pageNum}.pdf`;

      createTransientDocument(
        {
          id: pageId,
          filename: pageFilename,
          size: splitBytes.byteLength,
          uploadedAt: new Date().toISOString(),
        },
        splitBytes,
      );

      createdFiles.push({
        id: pageId,
        filename: pageFilename,
        pageNumber: pageNum,
        size: splitBytes.byteLength,
        downloadUrl: `/api/documents/${pageId}/file?download=1`,
      });
    }

    const firstFile = createdFiles[0];
    const totalSplitSize = createdFiles.reduce((acc, f) => acc + f.size, 0);

    return NextResponse.json(
      {
        success: true,
        id: firstFile?.id || "",
        filename: firstFile?.filename || `${baseName}-page-1.pdf`,
        originalFilename: originalName,
        originalPageCount: totalPages,
        splitPageCount: createdFiles.length,
        pageRange:
          createdFiles.length === totalPages
            ? `All ${totalPages} Pages`
            : `Pages ${createdFiles.map((f) => f.pageNumber).join(", ")}`,
        size: totalSplitSize,
        downloadUrl: firstFile?.downloadUrl || "",
        createdCount: createdFiles.length,
        files: createdFiles,
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("PDF split failed:", error);
    const message = error instanceof Error ? error.message : "Splitting PDF failed. Please retry.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
