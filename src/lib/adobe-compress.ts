/**
 * adobe-compress.ts
 *
 * Backend compression handler for transient documents.
 * Integrates the official ConvertAPI Python SDK via our server-side client
 * (src/lib/convertapi-client.ts) and private worker (compress-worker/compress.py).
 *
 * Maintains 100% backward compatibility with the existing API route
 * (/api/documents/[id]/compress) and frontend compression page.
 */

import {
  getTransientDocument,
  saveCompressedPdf,
} from "@/lib/storage";
import { compressPdfWithConvertApi } from "@/lib/convertapi-client";

export type CompressDocumentResult = {
  id: string;
  filename: string;
  originalSize: number;
  compressedSize: number;
  bytesSaved: number;
  percentage: number;
  downloadUrl: string;
  method: string;
  pageCount: number;
};

/**
 * Executes PDF compression for an uploaded transient document using ConvertAPI.
 * Server-side cloud-based processing via the official ConvertAPI Python SDK.
 */
export async function compressTransientDocument(
  id: string,
): Promise<CompressDocumentResult> {
  const document = getTransientDocument(id);
  if (!document) {
    throw new Error(
      "Document not found or temporary session expired. Please re-upload your PDF.",
    );
  }

  if (document.processing) {
    throw new Error(
      "This document is currently being processed. Please wait a moment.",
    );
  }

  document.processing = true;

  try {
    const originalBytes = document.original;
    const filename = document.metadata.filename;

    const result = await compressPdfWithConvertApi(originalBytes, filename);

    // Save compressed result to memory registry
    saveCompressedPdf(id, result.compressedBytes, result.stats);

    return {
      id,
      filename,
      originalSize: result.stats.originalSize,
      compressedSize: result.stats.compressedSize,
      bytesSaved: result.stats.bytesSaved,
      percentage: result.stats.percentage,
      downloadUrl: `/api/documents/${id}/compressed?download=1`,
      method: result.stats.method,
      pageCount: result.stats.pageCount ?? 1,
    };
  } finally {
    document.processing = false;
  }
}
