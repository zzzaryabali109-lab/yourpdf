import { NextResponse } from "next/server";
import { createSharedFile } from "@/lib/share-storage";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

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
  try {
    const formData = await request.formData();
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

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const metadata = createSharedFile({
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      data: buffer,
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
    return NextResponse.json(
      { error: "Failed to upload and generate share link. Please try again." },
      { status: 500 }
    );
  }
}
