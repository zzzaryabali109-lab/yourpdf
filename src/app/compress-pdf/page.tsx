"use client";

import { useState } from "react";
import ActionButton from "@/components/arc/action-button/action-button";
import Button from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import FileDropzone, { formatFileSize } from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import { SiteHeader } from "@/components/site-header";
import { CompressDropzoneIcon, PdfFileBadgeIcon } from "@/components/ui/convert-icons";
import { CheckCircle2, Download, Pencil } from "lucide-react";
import styles from "../home.module.css";

const MAX_PDF_SIZE = 100 * 1024 * 1024;

type UploadedDocument = {
  id: string;
  filename: string;
  size: number;
  uploadedAt: string;
};

type CompressionResult = {
  id: string;
  filename: string;
  originalSize: number;
  compressedSize: number;
  bytesSaved: number;
  percentage: number;
  downloadUrl: string;
  method: string;
};

export default function CompressPdfPage() {
  const [uploadedDocument, setUploadedDocument] = useState<UploadedDocument | null>(null);
  const [compressing, setCompressing] = useState(false);
  const [compressionResult, setCompressionResult] = useState<CompressionResult | null>(null);
  const [customFileName, setCustomFileName] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [compressError, setCompressError] = useState<string | null>(null);

  const uploadFile: FileDropzoneUpload = (item, { onProgress, signal }) =>
    new Promise((resolve, reject) => {
      if (!item.file) {
        reject(new Error("The selected file could not be read."));
        return;
      }

      setCompressError(null);
      setCompressionResult(null);

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

  const handleCompress = async () => {
    if (!uploadedDocument || compressing) return;
    setCompressing(true);
    setCompressError(null);

    try {
      const response = await fetch(`/api/documents/${uploadedDocument.id}/compress`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Compression failed. Please try again.");
      }

      setCompressionResult(data);
      const baseName = data.filename.replace(/\.pdf$/i, "") || "document";
      setCustomFileName(`${baseName}-compressed`);
      setIsDialogOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF compression could not be completed.";
      setCompressError(message);
    } finally {
      setCompressing(false);
    }
  };

  const handleReset = () => {
    setIsDialogOpen(false);
    setUploadedDocument(null);
    setCompressionResult(null);
    setCustomFileName("");
    setCompressError(null);
  };


  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      {/* Top Navbar with Centered Nav & Top-Right Theme Toggle */}
      <SiteHeader />

      {/* Main Compress PDF Section */}
      <main className="flex-1 flex flex-col items-center justify-start pt-6 sm:pt-12 pb-12 sm:pb-16 px-3 sm:px-4">
        {/* Compress PDF Heading Section */}
        <div className="text-center max-w-xl mx-auto mb-6 space-y-2">
          <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            Compress PDF
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Reduce PDF file size while optimizing for maximal document quality and clarity.
          </p>
        </div>

        {/* Dropzone with Center Compress PDF Icon */}
        <div className={styles.uploader}>
          <FileDropzone
            className={styles.dropzone}
            borderless
            accept="application/pdf,.pdf"
            multiple={false}
            maxFiles={1}
            maxSize={MAX_PDF_SIZE}
            icon={<CompressDropzoneIcon className="w-36 h-16" />}
            label="Drop your PDF here to compress"
            description="or click to browse files from your device"
            note="PDF only · Up to 100 MB"
            dropLabel="Release to compress your PDF"
            onUpload={uploadFile}
            onFilesChange={() => {
              setUploadedDocument(null);
              setCompressError(null);
              setCompressionResult(null);
            }}
          />

          {compressError && (
            <div className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">
              {compressError}
            </div>
          )}

          {uploadedDocument && (
            <div className={styles.processAction}>
              <ActionButton
                label="Compress PDF"
                pendingLabel="Compressing..."
                successLabel="Compressed"
                onAction={handleCompress}
              />
            </div>
          )}
        </div>
      </main>

      {/* Compression Result Modal Popup */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent
          title="PDF Compressed"
          description="Your document has been optimized and is ready to download."
          className="sm:max-w-[440px]"
        >
          {compressionResult && (() => {
            const finalDownloadName = `${customFileName.trim().replace(/\.pdf$/i, "") || "document-compressed"}.pdf`;
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
                      <p className="text-xs text-muted-foreground truncate" title={compressionResult.filename}>
                        Original: {compressionResult.filename}
                      </p>
                    </div>
                  </div>

                  {/* Size comparison pill & stats */}
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/50 text-center">
                    <div className="p-2 rounded-lg bg-muted/40">
                      <span className="text-[11px] text-muted-foreground block uppercase tracking-wider font-medium">Before</span>
                      <span className="text-sm font-semibold text-foreground/80">
                        {formatFileSize(compressionResult.originalSize)}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                      <span className="text-[11px] text-emerald-600 dark:text-emerald-400 block uppercase tracking-wider font-semibold">After</span>
                      <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
                        {formatFileSize(compressionResult.compressedSize)}
                      </span>
                    </div>
                  </div>

                  {/* Percentage saved badge */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 text-xs">
                    <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                      {compressionResult.percentage > 0 ? "Saved" : "Status"}
                    </span>
                    <span className="font-bold text-foreground">
                      {compressionResult.percentage > 0
                        ? `−${compressionResult.percentage}% (${formatFileSize(compressionResult.bytesSaved)} saved)`
                        : "Already 100% Optimized"}
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
                </div>

                {/* Actions: Download Button & Compress Another */}
                <div className="space-y-2">
                  <a
                    href={`${compressionResult.downloadUrl}&name=${encodeURIComponent(finalDownloadName)}`}
                    download={finalDownloadName}
                    className="block w-full no-underline"
                  >
                    <Button variant="primary" size="lg" className="w-full flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-medium py-2.5">
                      <Download className="size-4" />
                      Download Compressed PDF
                    </Button>
                  </a>
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={handleReset}
                    className="w-full text-xs text-muted-foreground hover:text-foreground"
                  >
                    Compress Another PDF
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

