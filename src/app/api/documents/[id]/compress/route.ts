import { NextResponse } from "next/server";
import { compressTransientDocument } from "@/lib/adobe-compress";
import { getTransientDocument } from "@/lib/storage";
import { consumeRateLimit, isSameOriginRequest } from "@/lib/request-guards";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPRESS_RATE_LIMIT = 20;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json(
      { error: "This compression request was rejected." },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid document identifier." }, { status: 400 });
  }

  const document = getTransientDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Document not found or temporary session expired." }, { status: 404 });
  }

  const rateLimit = consumeRateLimit("pdf-compress", COMPRESS_RATE_LIMIT, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "The compression rate limit has been reached. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds), "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await compressTransientDocument(id);
    return NextResponse.json(result, { status: 200, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("PDF compression failed:", error);
    const message = error instanceof Error ? error.message : "PDF compression could not be completed. Please retry.";
    return NextResponse.json({ error: message }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid document identifier." }, { status: 400 });
  }

  const document = getTransientDocument(id);
  if (!document) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  if (!document.compressionStats) {
    return NextResponse.json({ status: "not_compressed" }, { status: 200 });
  }

  return NextResponse.json(
    {
      id,
      filename: document.metadata.filename,
      ...document.compressionStats,
      downloadUrl: `/api/documents/${id}/compressed?download=1`,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

