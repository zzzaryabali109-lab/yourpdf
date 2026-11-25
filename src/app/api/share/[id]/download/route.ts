import { NextResponse } from "next/server";
import { getSharedFile, incrementDownloadCount } from "@/lib/share-storage";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const record = getSharedFile(id);

    if (!record) {
      return NextResponse.json(
        { error: "This shared file does not exist or has expired." },
        { status: 404 }
      );
    }

    incrementDownloadCount(id);

    // Encode filename for Content-Disposition (RFC 5987 standard)
    const encodedFilename = encodeURIComponent(record.filename).replace(/['()]/g, escape).replace(/\*/g, "%2A");

    return new Response(new Uint8Array(record.data), {
      status: 200,
      headers: {
        "Content-Type": record.mimeType,
        "Content-Length": record.size.toString(),
        "Content-Disposition": `attachment; filename="${record.filename.replace(/"/g, "")}"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[File Share Download Error]:", error);
    return NextResponse.json(
      { error: "Failed to download the shared file." },
      { status: 500 }
    );
  }
}
