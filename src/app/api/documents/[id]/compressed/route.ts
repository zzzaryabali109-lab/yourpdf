import { NextResponse } from "next/server";
import { getCompressedPdf } from "@/lib/storage";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getSafeCompressedFilename(filename: string): string {
  const base = filename.replace(/\.pdf$/i, "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 160) || "document";
  return `${base}-compressed.pdf`;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Invalid document identifier." }, { status: 400 });
  }

  const compressedData = getCompressedPdf(id);
  if (!compressedData) {
    return NextResponse.json(
      { error: "The compressed PDF is not ready or temporary session has expired." },
      { status: 404 },
    );
  }

  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const customNameParam = url.searchParams.get("name")?.trim();
  const chosenName = customNameParam || compressedData.metadata.filename;
  const safeName = encodeURIComponent(getSafeCompressedFilename(chosenName)).replaceAll("'", "%27");

  return new NextResponse(new Uint8Array(compressedData.bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${safeName}`,
      "Content-Length": String(compressedData.bytes.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

