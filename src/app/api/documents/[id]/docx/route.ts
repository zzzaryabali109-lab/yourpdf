import { getTransientDocument } from "@/lib/storage";
import { exportDocumentToDocx, type TextEditPayload } from "@/lib/docx-exporter";
import { NextResponse } from "next/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getDocxFilename(filename: string): string {
  const baseName = filename.replace(/\.(pdf|docx?|dotx?|docm)$/i, "") || "document";
  return `${baseName}.docx`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const document = getTransientDocument(id);
  if (!document) {
    return NextResponse.json(
      { error: "Document not found or temporary session expired." },
      { status: 404 },
    );
  }

  let edits: TextEditPayload[] = [];
  let customPdfBytes: Buffer | undefined;

  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/pdf") || contentType.includes("application/octet-stream")) {
      const arrayBuffer = await request.arrayBuffer();
      if (arrayBuffer.byteLength > 0) {
        customPdfBytes = Buffer.from(arrayBuffer);
      }
    } else if (contentType.includes("application/json")) {
      const body = await request.json();
      if (body) {
        if (Array.isArray(body.edits)) {
          edits = body.edits;
        }
        if (typeof body.pdfBase64 === "string" && body.pdfBase64.length > 0) {
          customPdfBytes = Buffer.from(body.pdfBase64, "base64");
        }
      }
    }
  } catch {
    // Body parsing optional, fallback to empty edits
  }

  try {
    const docxBuffer = await exportDocumentToDocx({
      sourceDocx: customPdfBytes ? undefined : document.sourceDocx,
      pdfBytes: customPdfBytes || document.clean || document.original,
      edits,
    });

    const docxFilename = getDocxFilename(document.metadata.filename);
    const safeName = encodeURIComponent(docxFilename).replaceAll("'", "%27");

    return new NextResponse(new Uint8Array(docxBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${safeName}`,
        "Content-Length": String(docxBuffer.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[POST /api/documents/[id]/docx] Export failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "DOCX export failed." },
      { status: 500 },
    );
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const document = getTransientDocument(id);
  if (!document) {
    return NextResponse.json(
      { error: "Document not found or temporary session expired." },
      { status: 404 },
    );
  }

  try {
    const docxBuffer = await exportDocumentToDocx({
      sourceDocx: document.sourceDocx,
      pdfBytes: document.clean || document.original,
      edits: [],
    });

    const docxFilename = getDocxFilename(document.metadata.filename);
    const safeName = encodeURIComponent(docxFilename).replaceAll("'", "%27");

    return new NextResponse(new Uint8Array(docxBuffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${safeName}`,
        "Content-Length": String(docxBuffer.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[GET /api/documents/[id]/docx] Export failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "DOCX export failed." },
      { status: 500 },
    );
  }
}
