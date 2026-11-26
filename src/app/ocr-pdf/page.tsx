"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Copy,
  Download,
  FileCheck2,
  Pencil,
  Share2,
  Sparkles,
} from "lucide-react";
import ActionButton from "@/components/arc/action-button/action-button";
import Button from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import FileDropzone, { formatFileSize } from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import { SiteHeader } from "@/components/site-header";
import { OcrPdfImageIcon, PdfFileBadgeIcon } from "@/components/ui/convert-icons";
import { ShareModalView } from "@/components/ui/share-modal-view";
import styles from "../home.module.css";

const MAX_PDF_SIZE = 100 * 1024 * 1024;

type UploadedDocument = {
  id: string;
  filename: string;
  size: number;
  uploadedAt: string;
};

type OcrResult = {
  id: string;
  filename: string;
  originalFilename: string;
  originalSize: number;
  ocrSize: number;
  pageCount: number;
  textCharacters: number;
  recognizedText: string;
  downloadUrl: string;
};

type OcrProgressState = {
  completedPages: number;
  totalPages: number;
  percentage: number;
  message: string;
};

export default function OcrPdfPage() {
  const [uploadedDocument, setUploadedDocument] = useState<UploadedDocument | null>(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<OcrProgressState | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [customFileName, setCustomFileName] = useState("document-searchable");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogView, setDialogView] = useState<"result" | "share">("result");
  const [copiedText, setCopiedText] = useState(false);
  const [ocrError, setOcrError] = useState<string | null>(null);

  const uploadFile: FileDropzoneUpload = (item, { onProgress, signal }) =>
    new Promise((resolve, reject) => {
      if (!item.file) {
        reject(new Error("The selected file could not be read."));
        return;
      }

      setOcrError(null);
      setOcrResult(null);
      setProgress(null);

      const formData = new FormData();
      formData.set("file", item.file);

      const request = new XMLHttpRequest();
      request.open("POST", "/api/documents");
      request.responseType = "json";
      request.timeout = 180_000;

      const removeAbortListener = () => signal.removeEventListener("abort", abortRequest);
      const abortRequest = () => request.abort();

      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
      };

      request.onload = () => {
        removeAbortListener();
        const response = request.response as (UploadedDocument & { error?: string }) | null;
        if (request.status >= 200 && request.status < 300 && response?.id) {
          setUploadedDocument(response);
          const baseName = response.filename.replace(/\.pdf$/i, "") || "document";
          setCustomFileName(`${baseName}-searchable`);
          resolve();
          return;
        }
        reject(new Error(response?.error ?? "The upload failed. Please try again."));
      };

      request.onerror = () => {
        removeAbortListener();
        reject(new Error("The server could not be reached. Check your connection and retry."));
      };

      request.ontimeout = () => {
        removeAbortListener();
        reject(new Error("The upload took too long. Please retry."));
      };

      request.onabort = () => {
        removeAbortListener();
        reject(new Error("The upload was canceled."));
      };

      if (signal.aborted) {
        request.abort();
        return;
      }
      signal.addEventListener("abort", abortRequest, { once: true });
      request.send(formData);
    });

  const handleRunOcr = async () => {
    if (!uploadedDocument || processing) return;
    setProcessing(true);
    setOcrError(null);
    setProgress({
      completedPages: 0,
      totalPages: 1,
      percentage: 5,
      message: "Starting OCR analysis...",
    });

    try {
      // Trigger the existing backend OCR workflow
      const triggerRes = await fetch(`/api/documents/${uploadedDocument.id}/process`, {
        method: "POST",
      });

      if (!triggerRes.ok && triggerRes.status !== 409 && triggerRes.status !== 200 && triggerRes.status !== 202) {
        const errJson = await triggerRes.json().catch(() => ({}));
        throw new Error(errJson.error || "Could not start OCR processing.");
      }

      // Poll existing backend OCR status endpoint for live progress
      let isDone = false;
      let attempts = 0;
      const maxAttempts = 150; // up to ~90s max polling

      while (!isDone && attempts < maxAttempts) {
        attempts++;
        await new Promise((resolve) => setTimeout(resolve, 600));

        const statusRes = await fetch(`/api/documents/${uploadedDocument.id}/process`);
        if (!statusRes.ok) {
          throw new Error("Failed to check processing status.");
        }

        const statusData = await statusRes.json();

        if (statusData.status === "completed") {
          isDone = true;
          const total = statusData.totalPages || 1;
          setProgress({
            completedPages: total,
            totalPages: total,
            percentage: 100,
            message: "OCR processing complete!",
          });

          setOcrResult({
            id: uploadedDocument.id,
            filename: `${uploadedDocument.filename.replace(/\.pdf$/i, "")}-searchable.pdf`,
            originalFilename: uploadedDocument.filename,
            originalSize: uploadedDocument.size,
            ocrSize: statusData.outputSize || uploadedDocument.size,
            pageCount: total,
            textCharacters: statusData.textCharacters || 0,
            recognizedText: statusData.recognizedText || "",
            downloadUrl: `/api/documents/${uploadedDocument.id}/clean?download=1`,
          });

          const baseName = uploadedDocument.filename.replace(/\.pdf$/i, "") || "document";
          setCustomFileName(`${baseName}-searchable`);
          setIsDialogOpen(true);
          return;
        }

        if (statusData.status === "failed") {
          throw new Error(statusData.error || "OCR processing failed. Please retry.");
        }

        if (statusData.status === "processing") {
          const total = statusData.totalPages || 1;
          const completed = statusData.completedPages || 0;
          const pct = Math.max(10, Math.min(95, Math.round((completed / total) * 100)));
          setProgress({
            completedPages: completed,
            totalPages: total,
            percentage: pct,
            message: completed > 0
              ? `Processing page ${completed} of ${total} (${pct}%)...`
              : `Analyzing pages (${pct}%)...`,
          });
        }
      }

      if (!isDone) {
        throw new Error("OCR processing timed out. Please retry.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "OCR processing could not be completed.";
      setOcrError(message);
      throw err;
    } finally {
      setProcessing(false);
    }
  };

  const handleCopyText = async () => {
    if (!ocrResult?.recognizedText) return;
    try {
      await navigator.clipboard.writeText(ocrResult.recognizedText);
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    } catch {
      // Clipboard fallback
    }
  };

  const handleReset = () => {
    setIsDialogOpen(false);
    setDialogView("result");
    setUploadedDocument(null);
    setOcrResult(null);
    setOcrError(null);
    setProgress(null);
    setCustomFileName("document-searchable");
    setCopiedText(false);
  };

  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      {/* Top Navbar with Centered Nav & Top-Right Theme Toggle */}
      <SiteHeader />

      {/* Main OCR PDF Section */}
      <main className="flex-1 flex flex-col items-center justify-start pt-6 sm:pt-12 pb-12 sm:pb-16 px-3 sm:px-4">
        {/* OCR PDF Heading Section Above Dropzone */}
        <div className="text-center max-w-xl mx-auto mb-6 space-y-2">
          <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            OCR PDF
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Convert scanned and image PDFs into searchable, selectable, and copyable text documents.
          </p>
        </div>

        {/* Dropzone with Center OCR PDF Icon */}
        <div className={styles.uploader}>
          <FileDropzone
            className={styles.dropzone}
            borderless
            accept="application/pdf,.pdf"
            multiple={false}
            maxFiles={1}
            maxSize={MAX_PDF_SIZE}
            icon={<OcrPdfImageIcon className="w-16 h-16 object-contain sm:w-20 sm:h-20" />}
            label="Drop your scanned PDF here for OCR"
            description="or click to browse files from your device"
            note="PDF only · Up to 100 MB"
            dropLabel="Release to add your PDF"
            onUpload={uploadFile}
            onFilesChange={(files) => {
              if (files.length === 0) {
                setUploadedDocument(null);
                setOcrError(null);
                setOcrResult(null);
                setProgress(null);
              }
            }}
          />

          {ocrError && (
            <div className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">
              {ocrError}
            </div>
          )}

          {uploadedDocument && (
            <div className={styles.processAction}>
              <ActionButton
                label="Recognize & Make Searchable"
                pendingLabel="Performing OCR..."
                successLabel="OCR Complete"
                onAction={handleRunOcr}
                disabled={processing}
              />

              {/* Real Processing Progress */}
              {processing && progress && (
                <div className="mt-4 w-full max-w-md mx-auto space-y-2 p-3.5 rounded-xl border border-border bg-card/70 shadow-xs">
                  <div className="flex items-center justify-between text-xs text-muted-foreground font-medium">
                    <span className="flex items-center gap-2 text-foreground font-medium">
                      <span className="size-2 rounded-full bg-red-600 animate-ping" />
                      {progress.message}
                    </span>
                    <span className="font-semibold text-foreground">{progress.percentage}%</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-600 transition-all duration-300 ease-out rounded-full"
                      style={{ width: `${progress.percentage}%` }}
                    />
                  </div>
                  {progress.totalPages > 1 && (
                    <div className="text-[11px] text-muted-foreground text-center">
                      Page {progress.completedPages} of {progress.totalPages}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* OCR Result Modal Dialog */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) setDialogView("result");
        }}
      >
        <DialogContent
          title={dialogView === "share" ? "Share Searchable PDF" : "OCR Processed Successfully"}
          description={dialogView === "share" ? "Your searchable PDF is ready to share with an instant link." : "Your document is now searchable, selectable, and copyable."}
          className="sm:max-w-[480px]"
        >
          {ocrResult && (() => {
            const finalDownloadName = `${
              customFileName.trim().replace(/\.pdf$/i, "") || "document-searchable"
            }.pdf`;
            const downloadHref = `${ocrResult.downloadUrl}&name=${encodeURIComponent(finalDownloadName)}`;

            if (dialogView === "share") {
              return (
                <ShareModalView
                  filename={finalDownloadName}
                  fileIcon={<PdfFileBadgeIcon className="size-11 shrink-0" />}
                  fileSize={ocrResult.ocrSize}
                  downloadHref={downloadHref}
                  onBackToDownload={() => setDialogView("result")}
                  onReset={handleReset}
                  resetLabel="OCR Another PDF"
                />
              );
            }

            return (
              <div className="space-y-4 pt-1">
                {/* File details card */}
                <div className="p-4 rounded-xl border border-border bg-card/60 space-y-3.5">
                  <div className="flex items-center gap-3">
                    <PdfFileBadgeIcon className="size-11" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate text-foreground" title={finalDownloadName}>
                        {finalDownloadName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(ocrResult.ocrSize)} · {ocrResult.pageCount} {ocrResult.pageCount === 1 ? "page" : "pages"}
                      </p>
                    </div>
                  </div>

                  {/* Details stats */}
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/50 text-center">
                    <div className="p-2 rounded-lg bg-muted/40">
                      <span className="text-[11px] text-muted-foreground block uppercase tracking-wider font-medium">Characters</span>
                      <span className="text-sm font-semibold text-foreground/80">
                        {ocrResult.textCharacters.toLocaleString()}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400 block uppercase tracking-wider font-semibold">Status</span>
                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-1">
                        <Sparkles className="size-3" />
                        Searchable
                      </span>
                    </div>
                  </div>

                  {/* Status badge */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 text-xs">
                    <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                      Text Layer
                    </span>
                    <span className="font-bold text-foreground">
                      Selectable & Copyable
                    </span>
                  </div>

                  {/* Editable File Name Input */}
                  <div className="space-y-1.5 pt-1 border-t border-border/50">
                    <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                      <span className="flex items-center gap-1.5">
                        <Pencil className="size-3 text-muted-foreground" />
                        File Name
                      </span>
                      <span className="text-[10px] text-muted-foreground/70 font-normal lowercase">editable</span>
                    </div>
                    <div className="relative flex items-center">
                      <input
                        type="text"
                        value={customFileName}
                        onChange={(e) => setCustomFileName(e.target.value)}
                        placeholder="Enter file name"
                        className="w-full h-9 px-3 pr-12 text-xs sm:text-sm font-medium rounded-lg border border-border bg-background/80 hover:bg-background focus:bg-background focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-foreground transition-all shadow-xs"
                      />
                      <span className="absolute right-3 text-xs font-bold text-muted-foreground/80 select-none pointer-events-none">
                        .pdf
                      </span>
                    </div>
                  </div>

                  {/* Recognized Text Snippet / Copy */}
                  {ocrResult.recognizedText && (
                    <div className="space-y-1.5 pt-1 border-t border-border/50">
                      <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                        <span className="flex items-center gap-1.5">
                          <FileCheck2 className="size-3 text-muted-foreground" />
                          Recognized Text Preview
                        </span>
                        <button
                          type="button"
                          onClick={handleCopyText}
                          className="text-[10px] text-red-600 dark:text-red-400 font-semibold flex items-center gap-1 hover:underline cursor-pointer"
                        >
                          <Copy className="size-3" />
                          {copiedText ? "Copied!" : "Copy Text"}
                        </button>
                      </div>
                      <div className="max-h-28 overflow-y-auto p-2.5 rounded-lg bg-muted/40 border border-border/50 text-[11px] font-mono text-foreground/90 whitespace-pre-wrap leading-relaxed select-text">
                        {ocrResult.recognizedText.slice(0, 500)}
                        {ocrResult.recognizedText.length > 500 ? "..." : ""}
                      </div>
                    </div>
                  )}
                </div>

                {/* Actions: Download Button & OCR Another */}
                <div className="space-y-2">
                  <a
                    href={downloadHref}
                    download={finalDownloadName}
                    className="block w-full no-underline"
                  >
                    <Button
                      variant="primary"
                      size="lg"
                      className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-medium py-2.5 cursor-pointer shadow-xs"
                    >
                      <Download className="size-4" />
                      Download Searchable PDF
                    </Button>
                  </a>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={handleReset}
                      className="flex-1 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      OCR Another PDF
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => setDialogView("share")}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <Share2 className="size-3.5" />
                      File Share
                    </Button>
                  </div>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
