"use client";

import { useState } from "react";
import ActionButton from "@/components/arc/action-button/action-button";
import Button from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import FileDropzone, { formatFileSize } from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import { SiteHeader } from "@/components/site-header";
import { MergePdfImageIcon, PdfFileBadgeIcon } from "@/components/ui/convert-icons";
import { ShareModalView } from "@/components/ui/share-modal-view";
import { CheckCircle2, Download, Layers, Pencil, Share2 } from "lucide-react";
import styles from "../home.module.css";

const MAX_PDF_SIZE = 100 * 1024 * 1024;

type MergedResult = {
  id: string;
  filename: string;
  pageCount: number;
  filesMerged: number;
  size: number;
  downloadUrl: string;
};

export default function MergePdfPage() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergedResult, setMergedResult] = useState<MergedResult | null>(null);
  const [customFileName, setCustomFileName] = useState("merged-document");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogView, setDialogView] = useState<"result" | "share">("result");
  const [mergeError, setMergeError] = useState<string | null>(null);

  const uploadFile: FileDropzoneUpload = (item, { onProgress }) =>
    new Promise((resolve, reject) => {
      if (!item.file) {
        reject(new Error("The selected file could not be read."));
        return;
      }

      setMergeError(null);
      setMergedResult(null);

      setSelectedFiles((prev) => {
        const fileExists = prev.some((f) => f.name === item.file?.name && f.size === item.file?.size);
        if (fileExists) return prev;
        return [...prev, item.file!];
      });

      onProgress(100);
      resolve();
    });

  const handleMerge = async () => {
    if (selectedFiles.length < 2 || merging) return;
    setMerging(true);
    setMergeError(null);

    try {
      const formData = new FormData();
      for (const file of selectedFiles) {
        formData.append("files", file);
      }

      const response = await fetch("/api/documents/merge", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Merging failed. Please try again.");
      }

      setMergedResult(data);
      setCustomFileName("merged-document");
      setIsDialogOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF merging could not be completed.";
      setMergeError(message);
    } finally {
      setMerging(false);
    }
  };

  const handleReset = () => {
    setIsDialogOpen(false);
    setDialogView("result");
    setSelectedFiles([]);
    setMergedResult(null);
    setCustomFileName("merged-document");
    setMergeError(null);
  };

  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      {/* Top Navbar with Centered Nav & Top-Right Theme Toggle */}
      <SiteHeader />

      {/* Main Merge PDF Section */}
      <main className="flex-1 flex flex-col items-center justify-start pt-6 sm:pt-12 pb-12 sm:pb-16 px-3 sm:px-4">
        {/* Merge PDF Heading Section */}
        <div className="text-center max-w-xl mx-auto mb-6 space-y-2">
          <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            Merge PDF Files
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Combine multiple PDF documents into a single, organized document in seconds.
          </p>
        </div>

        {/* Dropzone with Center Merge PDF Icon */}
        <div className={styles.uploader}>
          <FileDropzone
            className={styles.dropzone}
            borderless
            accept="application/pdf,.pdf"
            multiple={true}
            maxFiles={20}
            maxSize={MAX_PDF_SIZE}
            icon={<MergePdfImageIcon className="w-16 h-16 sm:w-20 sm:h-20 object-contain" />}
            label="Drop your PDF files here to merge"
            description="or click to browse multiple files from your device"
            note="2 or more PDFs · Up to 100 MB each"
            dropLabel="Release to add your PDF files"
            onUpload={uploadFile}
            onFilesChange={(files) => {
              if (files.length === 0) {
                setSelectedFiles([]);
                setMergeError(null);
                setMergedResult(null);
              }
            }}
          />

          {mergeError && (
            <div className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">
              {mergeError}
            </div>
          )}

          {selectedFiles.length > 0 && (
            <div className="mt-4 flex flex-col items-center gap-3">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-full border border-border/50">
                <Layers className="size-3.5 text-blue-500" />
                <span>
                  {selectedFiles.length} {selectedFiles.length === 1 ? "file selected" : "files ready to merge"}
                  {selectedFiles.length === 1 && " (add at least 1 more)"}
                </span>
              </div>

              {selectedFiles.length >= 2 && (
                <div className={styles.processAction}>
                  <ActionButton
                    label={`Merge ${selectedFiles.length} PDFs`}
                    pendingLabel="Merging PDFs..."
                    successLabel="Merged"
                    onAction={handleMerge}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Merged Result Modal Popup */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) setDialogView("result");
        }}
      >
        <DialogContent
          title={dialogView === "share" ? "Share Merged PDF" : "PDFs Merged Successfully"}
          description={dialogView === "share" ? "Your merged PDF is ready to share with an instant link." : "Your documents have been combined and are ready to download."}
          className="sm:max-w-[440px]"
        >
          {mergedResult && (() => {
            const finalDownloadName = `${customFileName.trim().replace(/\.pdf$/i, "") || "merged-document"}.pdf`;
            const downloadHref = `${mergedResult.downloadUrl}&name=${encodeURIComponent(finalDownloadName)}`;

            if (dialogView === "share") {
              return (
                <ShareModalView
                  filename={finalDownloadName}
                  fileIcon={<PdfFileBadgeIcon className="size-11 shrink-0" />}
                  fileSize={mergedResult.size}
                  downloadHref={downloadHref}
                  onBackToDownload={() => setDialogView("result")}
                  onReset={handleReset}
                  resetLabel="Merge Another Set of PDFs"
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
                        {mergedResult.filesMerged} documents combined · {mergedResult.pageCount} pages
                      </p>
                    </div>
                  </div>

                  {/* Details pill & stats */}
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/50 text-center">
                    <div className="p-2 rounded-lg bg-muted/40">
                      <span className="text-[11px] text-muted-foreground block uppercase tracking-wider font-medium">Pages</span>
                      <span className="text-sm font-semibold text-foreground/80">
                        {mergedResult.pageCount} Pages
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <span className="text-[11px] text-blue-600 dark:text-blue-400 block uppercase tracking-wider font-semibold">Total Size</span>
                      <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                        {formatFileSize(mergedResult.size)}
                      </span>
                    </div>
                  </div>

                  {/* Status badge */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 text-xs">
                    <span className="text-muted-foreground flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                      Status
                    </span>
                    <span className="font-bold text-foreground">
                      Combined {mergedResult.filesMerged} PDF files
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
                        className="w-full h-9 px-3 pr-12 text-xs sm:text-sm font-medium rounded-lg border border-border bg-background/80 hover:bg-background focus:bg-background focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 text-foreground transition-all shadow-xs"
                      />
                      <span className="absolute right-3 text-xs font-bold text-muted-foreground/80 select-none pointer-events-none">
                        .pdf
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions: Download Button & Merge Another */}
                <div className="space-y-2">
                  <a
                    href={downloadHref}
                    download={finalDownloadName}
                    className="block w-full no-underline"
                  >
                    <Button variant="primary" size="lg" className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5">
                      <Download className="size-4" />
                      Download Merged PDF
                    </Button>
                  </a>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={handleReset}
                      className="flex-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      Merge Another Set of PDFs
                    </Button>
                    <Button
                      variant="secondary"
                      size="md"
                      onClick={() => setDialogView("share")}
                      className="flex-1 inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
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

