import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { randomUUID } from "node:crypto";
import { isSameOriginRequest, consumeRateLimit } from "@/lib/request-guards";
import { createTransientDocument } from "@/lib/storage";

const MAX_IMAGE_SIZE = 100 * 1024 * 1024; // 100 MB per file
const RATE_LIMIT_COUNT = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "This conversion request was rejected." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rateLimit = consumeRateLimit("jpg-to-pdf", RATE_LIMIT_COUNT, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Conversion rate limit reached. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  try {
    const formData = await request.formData();
    const files = formData.getAll("files");

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: "Please select at least one JPG or PNG image to convert." },
        { status: 400 },
      );
    }

    if (files.length > 50) {
      return NextResponse.json(
        { error: "You can convert up to 50 images at once." },
        { status: 400 },
      );
    }

    const doc = await PDFDocument.create();
    let totalInputBytes = 0;
    let addedPages = 0;

    for (let i = 0; i < files.length; i++) {
      const item = files[i];
      if (!(item instanceof Blob)) continue;

      const arrayBuf = await item.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      totalInputBytes += bytes.byteLength;

      if (bytes.byteLength === 0) {
        return NextResponse.json(
          { error: `Image #${i + 1} is empty.` },
          { status: 400 },
        );
      }

      if (bytes.byteLength > MAX_IMAGE_SIZE) {
        return NextResponse.json(
          { error: `Image #${i + 1} exceeds the 100 MB size limit.` },
          { status: 400 },
        );
      }

      let embeddedImage;
      if (isJpeg(bytes)) {
        embeddedImage = await doc.embedJpg(bytes);
      } else if (isPng(bytes)) {
        embeddedImage = await doc.embedPng(bytes);
      } else {
        // Attempt JPEG embedding first, then PNG as fallback
        try {
          embeddedImage = await doc.embedJpg(bytes);
        } catch {
          try {
            embeddedImage = await doc.embedPng(bytes);
          } catch {
            return NextResponse.json(
              { error: `File #${i + 1} is not a supported JPG or PNG image.` },
              { status: 400 },
            );
          }
        }
      }

      const imgWidth = embeddedImage.width;
      const imgHeight = embeddedImage.height;

      // Choose page orientation matching the image
      const isLandscape = imgWidth > imgHeight;
      const standardWidth = isLandscape ? 841.89 : 595.28; // A4 standard
      const standardHeight = isLandscape ? 595.28 : 841.89;

      const margin = 20; // 20pt padding
      const maxAvailableW = standardWidth - margin * 2;
      const maxAvailableH = standardHeight - margin * 2;

      // Scale to fit page cleanly while preserving natural aspect ratio
      const scale = Math.min(maxAvailableW / imgWidth, maxAvailableH / imgHeight);
      const renderW = imgWidth * scale;
      const renderH = imgHeight * scale;

      const x = (standardWidth - renderW) / 2;
      const y = (standardHeight - renderH) / 2;

      const page = doc.addPage([standardWidth, standardHeight]);
      page.drawImage(embeddedImage, {
        x,
        y,
        width: renderW,
        height: renderH,
      });

      addedPages++;
    }

    if (addedPages === 0) {
      return NextResponse.json(
        { error: "No valid images could be processed." },
        { status: 400 },
      );
    }

    const pdfBytes = await doc.save({ useObjectStreams: true });
    const outputBuffer = Buffer.from(pdfBytes);
    const id = randomUUID();

    const firstFileName = (files[0] as File)?.name || "image";
    const baseName = firstFileName.replace(/\.[^/.]+$/, "");
    const outputFilename = files.length === 1 ? `${baseName}.pdf` : `${baseName}-converted.pdf`;

    // Save as transient document so it can be downloaded via standard API
    createTransientDocument(
      {
        id,
        filename: outputFilename,
        size: outputBuffer.byteLength,
        uploadedAt: new Date().toISOString(),
      },
      outputBuffer,
    );

    return NextResponse.json(
      {
        id,
        filename: outputFilename,
        originalSize: totalInputBytes,
        outputSize: outputBuffer.byteLength,
        pageCount: addedPages,
        downloadUrl: `/api/documents/${id}/file?download=1`,
      },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[JPG to PDF] Conversion failed:", error);
    const message = error instanceof Error ? error.message : "JPG to PDF conversion failed. Please retry.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
