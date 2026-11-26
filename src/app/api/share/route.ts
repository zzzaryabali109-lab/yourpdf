import { NextResponse } from "next/server";
import { createSharedFile, SharedStorageFullError } from "@/lib/share-storage";
import { MultipartTooLargeError, parseMultipartWithinLimit } from "@/lib/limited-form-data";
import { isSameOriginRequest } from "@/lib/request-guards";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_MULTIPART_SIZE = MAX_FILE_SIZE + 1024 * 1024;
const MAX_CONCURRENT_SHARE_UPLOADS = 2;

type ShareUploadRegistry = typeof globalThis & { __clearpdfShareUploadsInProgress?: number };
const uploadRegistry = globalThis as ShareUploadRegistry;

export const runtime = "nodejs";

function getPublicOrigin(request: Request): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const hostHeader = request.headers.get("host");
  const rawHost = forwardedHost || hostHeader || new URL(request.url).host;
  const cleanHost = rawHost.replace(/^0\.0\.0\.0/, "localhost");
  const proto =
    request.headers.get("x-forwarded-proto") ||
    (request.url.startsWith("https") ? "https" : "http");
  return `${proto}://${cleanHost}`;
}

export async function POST(request: Request) {
  let reservedUploadSlot = false;
  try {
    if (!isSameOriginRequest(request)) {
      return NextResponse.json({ error: "This upload request was rejected." }, { status: 403, headers: { "Cache-Control": "no-store" } });
    }

    const activeUploads = uploadRegistry.__clearpdfShareUploadsInProgress ?? 0;
    if (activeUploads >= MAX_CONCURRENT_SHARE_UPLOADS) {
      return NextResponse.json(
        { error: "Several files are being uploaded right now. Please retry in a few seconds." },
        { status: 503, headers: { "Retry-After": "5", "Cache-Control": "no-store" } },
      );
    }
    uploadRegistry.__clearpdfShareUploadsInProgress = activeUploads + 1;
    reservedUploadSlot = true;

    const contentLengthHeader = request.headers.get("content-length");
    const contentLength = contentLengthHeader && /^\d+$/.test(contentLengthHeader) ? Number(contentLengthHeader) : null;
    if (contentLengthHeader && contentLength === null) {
      return NextResponse.json({ error: "The upload request has an invalid content length." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    if (contentLength !== null && (!Number.isSafeInteger(contentLength) || contentLength > MAX_MULTIPART_SIZE)) {
      return NextResponse.json({ error: "Files must be 100 MB or smaller." }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }

    const formData = await parseMultipartWithinLimit(
      request,
      MAX_MULTIPART_SIZE,
      "Files must be 100 MB or smaller.",
    );
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "No file was provided for sharing. Please select a file." },
        { status: 400 }
      );
    }

    if (file.size === 0) {
      return NextResponse.json(
        { error: "The uploaded file is empty." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: "Files must be 100 MB or smaller." },
        { status: 413 }
      );
    }

    const metadata = await createSharedFile({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      stream: file.stream(),
      size: file.size,
    });

    const origin = getPublicOrigin(request);
    const shareUrl = `${origin}/file-share/${metadata.id}`;
    const downloadUrl = `${origin}/api/share/${metadata.id}/download`;

    return NextResponse.json({
      ...metadata,
      shareUrl,
      downloadUrl,
    });
  } catch (error) {
    console.error("[File Share API Upload Error]:", error);
    if (error instanceof MultipartTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413, headers: { "Cache-Control": "no-store" } });
    }
    if (error instanceof SharedStorageFullError) {
      return NextResponse.json({ error: error.message }, { status: 507, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(
      { error: "Failed to upload and generate share link. Please try again." },
      { status: 500 }
    );
  } finally {
    if (reservedUploadSlot) {
      uploadRegistry.__clearpdfShareUploadsInProgress = Math.max(0, (uploadRegistry.__clearpdfShareUploadsInProgress ?? 1) - 1);
    }
  }
}
