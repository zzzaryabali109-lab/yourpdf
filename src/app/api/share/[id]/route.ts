import { NextResponse } from "next/server";
import { getSharedMetadata } from "@/lib/share-storage";

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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const metadata = getSharedMetadata(id);

    if (!metadata) {
      return NextResponse.json(
        { error: "This shared file does not exist or has expired." },
        { status: 404 }
      );
    }

    const origin = getPublicOrigin(request);
    const shareUrl = `${origin}/file-share/${metadata.id}`;
    const downloadUrl = `${origin}/api/share/${metadata.id}/download`;

    return NextResponse.json({
      ...metadata,
      shareUrl,
      downloadUrl,
    });
  } catch (error) {
    console.error("[File Share Metadata Error]:", error);
    return NextResponse.json(
      { error: "Could not retrieve shared file info." },
      { status: 500 }
    );
  }
}
