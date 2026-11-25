import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isSameOriginRequest, consumeRateLimit } from "@/lib/request-guards";
import { createTransientDocument } from "@/lib/storage";
import {
  convertPowerpointToPdf,
  validatePowerpointDocument,
  MAX_POWERPOINT_FILE_SIZE,
  PowerpointConversionError,
  sanitizeErrorMessage,
} from "@/lib/powerpoint-converter";

const RATE_LIMIT_COUNT = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "This conversion request was rejected." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rateLimit = consumeRateLimit("powerpoint-to-pdf", RATE_LIMIT_COUNT, RATE_LIMIT_WINDOW_MS);
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
        { error: "Please select a PowerPoint presentation (.pptx or .ppt) to convert." },
        { status: 400 },
      );
    }

    const filename = (file as File).name || "presentation.pptx";
    const arrayBuf = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);

    if (bytes.byteLength === 0) {
      return NextResponse.json(
        { error: "The uploaded file is empty." },
        { status: 400 },
      );
    }

    if (bytes.byteLength > MAX_POWERPOINT_FILE_SIZE) {
      return NextResponse.json(
        { error: "The presentation exceeds the 100 MB file size limit." },
        { status: 400 },
      );
    }

    const validation = validatePowerpointDocument(bytes, filename);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Please upload a valid PowerPoint presentation (.pptx or .ppt)." },
        { status: 400 },
      );
    }

    // Convert PowerPoint document to PDF using self-hosted high-fidelity engine
    const conversion = await convertPowerpointToPdf(bytes, filename);

    const id = randomUUID();
    const baseName = filename.replace(/\.(pptx?|ppsx?|potx?)$/i, "") || "presentation";
    const outputFilename = `${baseName}.pdf`;

    // Save as transient document so it can be edited in workspace or downloaded
    createTransientDocument(
      {
        id,
        filename: outputFilename,
        size: conversion.pdfBuffer.byteLength,
        uploadedAt: new Date().toISOString(),
      },
      conversion.pdfBuffer,
    );

    const url = new URL(request.url);
    const downloadDirectly =
      url.searchParams.get("download") === "1" || url.searchParams.get("direct") === "1";

    if (downloadDirectly) {
      const safeName = encodeURIComponent(outputFilename).replaceAll("'", "%27");
      return new NextResponse(new Uint8Array(conversion.pdfBuffer), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename*=UTF-8''${safeName}`,
          "Content-Length": String(conversion.pdfBuffer.byteLength),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    return NextResponse.json(
      {
        id,
        filename: outputFilename,
        originalSize: bytes.byteLength,
        outputSize: conversion.pdfBuffer.byteLength,
        pageCount: conversion.pageCount,
        method: conversion.method,
        warnings: conversion.warnings,
        featuresDetected: conversion.featuresDetected,
        latencyMs: conversion.latencyMs,
        downloadUrl: `/api/documents/${id}/file?download=1`,
      },
      { status: 200, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    console.error("[PowerPoint to PDF] Conversion failed:", error);
    if (error instanceof PowerpointConversionError) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(error.message) },
        { status: error.statusCode },
      );
    }
    const message = sanitizeErrorMessage(
      error instanceof Error ? error.message : "PowerPoint to PDF conversion failed. Please retry."
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
