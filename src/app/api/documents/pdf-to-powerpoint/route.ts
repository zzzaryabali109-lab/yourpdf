import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isSameOriginRequest, consumeRateLimit } from "@/lib/request-guards";
import { createTransientDocument } from "@/lib/storage";
import {
  convertPdfToPowerpoint,
  validatePdfForPowerpointConversion,
  MAX_PDF_TO_POWERPOINT_SIZE,
  PdfToPowerpointConversionError,
  sanitizeErrorMessage,
} from "@/lib/pdf-to-powerpoint-converter";

const RATE_LIMIT_COUNT = 30;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "This conversion request was rejected." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const rateLimit = consumeRateLimit("pdf-to-powerpoint", RATE_LIMIT_COUNT, RATE_LIMIT_WINDOW_MS);
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
        { error: "Please select a PDF document (.pdf) to convert to PowerPoint." },
        { status: 400 },
      );
    }

    const filename = (file as File).name || "presentation.pdf";
    const arrayBuf = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);

    if (bytes.byteLength === 0) {
      return NextResponse.json(
        { error: "The uploaded file is empty." },
        { status: 400 },
      );
    }

    if (bytes.byteLength > MAX_PDF_TO_POWERPOINT_SIZE) {
      return NextResponse.json(
        { error: "The PDF document exceeds the 100 MB file size limit." },
        { status: 400 },
      );
    }

    const validation = await validatePdfForPowerpointConversion(bytes, filename);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error || "Please upload a valid PDF document." },
        { status: 400 },
      );
    }

    // Convert PDF to PowerPoint (.pptx) using native slide engine
    const conversion = await convertPdfToPowerpoint(bytes, filename);

    const id = randomUUID();
    const baseName = filename.replace(/\.pdf$/i, "") || "presentation";
    const outputFilename = `${baseName}.pptx`;

    // Save as transient document so it can be downloaded
    createTransientDocument(
      {
        id,
        filename: outputFilename,
        size: conversion.pptxBuffer.byteLength,
        uploadedAt: new Date().toISOString(),
      },
      conversion.pptxBuffer,
    );

    const url = new URL(request.url);
    const downloadDirectly =
      url.searchParams.get("download") === "1" || url.searchParams.get("direct") === "1";

    if (downloadDirectly) {
      const safeName = encodeURIComponent(outputFilename).replaceAll("'", "%27");
      return new NextResponse(new Uint8Array(conversion.pptxBuffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "Content-Disposition": `attachment; filename*=UTF-8''${safeName}`,
          "Content-Length": String(conversion.pptxBuffer.byteLength),
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
        outputSize: conversion.pptxBuffer.byteLength,
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
    console.error("[PDF to PowerPoint] Conversion failed:", error);
    if (error instanceof PdfToPowerpointConversionError) {
      return NextResponse.json(
        { error: sanitizeErrorMessage(error.message) },
        { status: error.statusCode },
      );
    }
    const message = sanitizeErrorMessage(
      error instanceof Error ? error.message : "PDF to PowerPoint conversion failed. Please retry.",
    );
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
