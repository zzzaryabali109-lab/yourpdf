"use client";

import { fetchWithTimeout as fetch } from "@/lib/client-fetch";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Download, Layers, RotateCcw, Scissors, Share2, Trash2, X } from "lucide-react";
import ActionButton from "@/components/arc/action-button/action-button";
import Button from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import FileDropzone, { formatFileSize } from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import { SiteHeader } from "@/components/site-header";
import { PdfFileBadgeIcon, SplitPdfImageIcon } from "@/components/ui/convert-icons";
import { ShareModalView } from "@/components/ui/share-modal-view";
import styles from "../home.module.css";

const MAX_PDF_SIZE = 100 * 1024 * 1024;

type SplitFileItem = {
  id: string;
  filename: string;
  pageNumber: number;
  size: number;
  downloadUrl: string;
};

export default function SplitPdfPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [splitFiles, setSplitFiles] = useState<SplitFileItem[]>([]);
  const [splitError, setSplitError] = useState<string | null>(null);
  const [isSplitDone, setIsSplitDone] = useState(false);
  const [combining, setCombining] = useState(false);
  const [shareTarget, setShareTarget] = useState<{ filename: string; size: number; downloadUrl: string } | null>(null);

  // Split Mode: "all" splits every page into a separate PDF (default)
  const [splitMode, setSplitMode] = useState<"all" | "range" | "custom">("all");
  const [fromPage, setFromPage] = useState("1");
  const [toPage, setToPage] = useState("1");
  const [customRange, setCustomRange] = useState("1");

  // Canvas map to render previews for each resulting page
  const canvasMapRef = useRef<Map<number, HTMLCanvasElement>>(new Map());

  const uploadFile: FileDropzoneUpload = (item, { onProgress }) =>
    new Promise((resolve, reject) => {
      if (!item.file) {
        reject(new Error("The selected file could not be read."));
        return;
      }

      setSplitError(null);
      setSplitFiles([]);
      setIsSplitDone(false);
      setSelectedFile(item.file);

      onProgress(100);
      resolve();
    });

  const handleSplit = async () => {
    if (!selectedFile || splitting) return;
    setSplitting(true);
    setSplitError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);

      if (splitMode === "all") {
        formData.append("splitAll", "true");
      } else if (splitMode === "range") {
        formData.append("fromPage", fromPage.trim() || "1");
        formData.append("toPage", toPage.trim() || fromPage.trim() || "1");
      } else {
        formData.append("range", customRange.trim() || "1");
      }

      const response = await fetch("/api/documents/split", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Splitting failed. Please try again.");
      }

      if (Array.isArray(data.files) && data.files.length > 0) {
        setSplitFiles(data.files);
        setIsSplitDone(true);
      } else if (data.id) {
        setSplitFiles([
          {
            id: data.id,
            filename: data.filename || "split-page-1.pdf",
            pageNumber: 1,
            size: data.size || 0,
            downloadUrl: data.downloadUrl || `/api/documents/${data.id}/file?download=1`,
          },
        ]);
        setIsSplitDone(true);
      } else {
        throw new Error("No PDFs were created from this document.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF splitting could not be completed.";
      setSplitError(message);
    } finally {
      setSplitting(false);
    }
  };

  // Render small previews of each resulting page onto its canvas
  useEffect(() => {
    if (splitFiles.length === 0 || !selectedFile) return;

    let active = true;

    const renderThumbnails = async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const buffer = await selectedFile.arrayBuffer();
        if (!active) return;

        const pdf = await pdfjs.getDocument({ data: buffer }).promise;
        if (!active) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (const item of splitFiles) {
          if (!active) break;
          const canvas = canvasMapRef.current.get(item.pageNumber);
          if (!canvas) continue;

          const page = await pdf.getPage(item.pageNumber);
          if (!active) break;

          const unscaledViewport = page.getViewport({ scale: 1 });
          const targetWidth = 160;
          const scale = (targetWidth / unscaledViewport.width) * dpr;
          const viewport = page.getViewport({ scale });

          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);

          const ctx = canvas.getContext("2d");
          if (!ctx) continue;

          await page.render({
            canvas,
            canvasContext: ctx,
            viewport,
          }).promise;
        }
      } catch (err) {
        console.error("Failed to render PDF page previews:", err);
      }
    };

    void renderThumbnails();

    return () => {
      active = false;
    };
  }, [splitFiles, selectedFile]);

  const handleDownloadAll = () => {
    splitFiles.forEach((file, index) => {
      setTimeout(() => {
        const a = document.createElement("a");
        a.href = file.downloadUrl;
        a.download = file.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }, index * 200);
    });
  };

  const handleRemovePage = (fileId: string) => {
    setSplitFiles((prev) => prev.filter((file) => file.id !== fileId));
  };

  const handleDownloadCombined = async () => {
    if (!selectedFile || splitFiles.length === 0 || combining) return;
    setCombining(true);
    try {
      const { PDFDocument } = await import("pdf-lib");
      const buffer = await selectedFile.arrayBuffer();
      const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
      const newDoc = await PDFDocument.create();

      const pageIndices = splitFiles
        .map((f) => f.pageNumber - 1)
        .filter((idx) => idx >= 0 && idx < srcDoc.getPageCount());

      if (pageIndices.length === 0) return;

      const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach((p) => newDoc.addPage(p));

      const pdfBytes = await newDoc.save();
      const blob = new Blob([pdfBytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const base = selectedFile.name.replace(/\.pdf$/i, "");
      a.download = `${base}-pages-removed.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to generate combined PDF:", err);
    } finally {
      setCombining(false);
    }
  };

  const handleReset = () => {
    setSplitFiles([]);
    setSelectedFile(null);
    setSplitError(null);
    setSplitMode("all");
    setFromPage("1");
    setToPage("1");
    setCustomRange("1");
    setIsSplitDone(false);
    setShareTarget(null);
  };

  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      {/* Top Navbar with Centered Nav & Top-Right Theme Toggle */}
      <SiteHeader />

      {/* Main Split & Remove Pages Container */}
      <main className="flex-1 flex flex-col items-center justify-start pt-6 sm:pt-12 pb-12 sm:pb-16 px-3 sm:px-4">
        {!isSplitDone ? (
          /* --- View 1: Upload Section --- */
          <>
            <div className="text-center max-w-xl mx-auto mb-6 space-y-2">
              <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground">
                Split & Remove PDF Pages
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
                Separate pages into independent PDF files, or remove unwanted pages from your document with ease.
              </p>
            </div>

            <div className={styles.uploader}>
              {!selectedFile ? (
                <FileDropzone
                  className={styles.dropzone}
                  borderless
                  accept="application/pdf,.pdf"
                  multiple={false}
                  maxFiles={1}
                  maxSize={MAX_PDF_SIZE}
                  icon={<SplitPdfImageIcon className="w-16 h-16 object-contain sm:w-20 sm:h-20" />}
                  label="Drop your PDF file here to split or remove pages"
                  description="or click to browse a file from your device to separate or remove pages"
                  note="PDF only · Up to 100 MB · Split & Remove Pages"
                  dropLabel="Release to split or remove pages from your PDF"
                  onUpload={uploadFile}
                  onFilesChange={(files) => {
                    if (files.length === 0) {
                      setSelectedFile(null);
                      setSplitError(null);
                      setSplitFiles([]);
                      setIsSplitDone(false);
                    }
                  }}
                />
              ) : (
                <div className="w-full max-w-lg mx-auto p-5 rounded-2xl border border-border bg-card/90 shadow-sm space-y-4">
                  {/* File Info Header with Remove/Change button */}
                  <div className="flex items-center justify-between gap-3 p-3 rounded-xl bg-muted/40 border border-border/50">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <PdfFileBadgeIcon className="size-10 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate text-foreground" title={selectedFile.name}>
                          {selectedFile.name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatFileSize(selectedFile.size)} · Ready to split or remove pages
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFile(null);
                        setSplitError(null);
                      }}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer shrink-0"
                      title="Choose another file"
                    >
                      <X className="size-4" />
                    </button>
                  </div>

                  {splitError && (
                    <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">
                      {splitError}
                    </div>
                  )}

                  {/* Mode Toggle */}
                  <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-muted/50 border border-border/50 text-xs font-semibold">
                    <button
                      type="button"
                      onClick={() => setSplitMode("all")}
                      className={`py-1.5 px-2 rounded-lg transition-all cursor-pointer ${
                        splitMode === "all"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      All Pages
                    </button>
                    <button
                      type="button"
                      onClick={() => setSplitMode("range")}
                      className={`py-1.5 px-2 rounded-lg transition-all cursor-pointer ${
                        splitMode === "range"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Page Range
                    </button>
                    <button
                      type="button"
                      onClick={() => setSplitMode("custom")}
                      className={`py-1.5 px-2 rounded-lg transition-all cursor-pointer ${
                        splitMode === "custom"
                          ? "bg-background text-foreground shadow-xs"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Custom
                    </button>
                  </div>

                  {/* Split Mode Description / Inputs */}
                  {splitMode === "all" ? (
                    <div className="px-3 py-2 rounded-lg bg-muted/40 border border-border/40 text-xs text-muted-foreground flex items-center gap-2">
                      <Scissors className="size-3.5 text-red-500 shrink-0" />
                      <span>Every page will be displayed so you can download individually or remove unwanted pages.</span>
                    </div>
                  ) : splitMode === "range" ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                          From Page
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={fromPage}
                          onChange={(e) => setFromPage(e.target.value)}
                          className="w-full h-9 px-3 text-sm font-medium rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-foreground"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                          To Page
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={toPage}
                          onChange={(e) => setToPage(e.target.value)}
                          className="w-full h-9 px-3 text-sm font-medium rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-foreground"
                        />
                      </div>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                        Pages to Extract (e.g. 1-3, 5)
                      </label>
                      <input
                        type="text"
                        value={customRange}
                        onChange={(e) => setCustomRange(e.target.value)}
                        placeholder="1-3, 5"
                        className="w-full h-9 px-3 text-sm font-medium rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-500 text-foreground"
                      />
                    </div>
                  )}

                  {/* Action Button */}
                  <div className="pt-2">
                    <ActionButton
                      label="Split & Remove Pages"
                      pendingLabel="Processing PDF..."
                      successLabel="Processing Complete"
                      onAction={handleSplit}
                    />
                  </div>
                </div>
              )}
            </div>
          </>
        ) : splitFiles.length === 0 ? (
          /* --- All Pages Removed Empty State --- */
          <div className="w-full max-w-md mx-auto my-12 p-8 rounded-2xl border border-dashed border-border bg-card/70 text-center space-y-4 shadow-xs">
            <div className="size-14 rounded-full bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
              <Trash2 className="size-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-foreground">All Pages Removed</h2>
              <p className="text-xs text-muted-foreground">You have removed all pages from this document.</p>
            </div>
            <Button
              variant="primary"
              size="md"
              onClick={handleReset}
              className="bg-red-600 hover:bg-red-700 text-white text-xs font-medium gap-1.5 cursor-pointer mx-auto"
            >
              <RotateCcw className="size-3.5" />
              <span>Split Another PDF</span>
            </Button>
          </div>
        ) : (
          /* --- View 2: Small Previews of Resulting PDFs Displayed Side by Side --- */
          <div className="w-full max-w-6xl mx-auto space-y-6">
            {/* Top Results Header and Action Bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-2xl border border-border bg-card shadow-xs">
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 mb-1.5">
                  <CheckCircle2 className="size-3.5" />
                  <span>Split & Pages Managed</span>
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  Resulting PDFs ({splitFiles.length})
                </h1>
                <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
                  Preview, download individual pages, or click <strong className="text-red-600 dark:text-red-400">(Remove)</strong> on any card to delete unwanted pages from <strong className="text-foreground">{selectedFile?.name}</strong>.
                </p>
              </div>

              <div className="flex items-center gap-2.5 w-full sm:w-auto flex-wrap">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={handleReset}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs font-medium cursor-pointer"
                >
                  <RotateCcw className="size-3.5" />
                  <span>Split Another PDF</span>
                </Button>

                {splitFiles.length > 1 && (
                  <Button
                    variant="secondary"
                    size="md"
                    onClick={() => void handleDownloadCombined()}
                    disabled={combining}
                    className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs font-medium cursor-pointer text-foreground hover:text-red-600"
                    title="Download all remaining pages merged into one single PDF without the removed pages"
                  >
                    <Layers className="size-3.5 text-red-600" />
                    <span>Download Cleaned PDF</span>
                  </Button>
                )}

                <Button
                  variant="primary"
                  size="md"
                  onClick={handleDownloadAll}
                  className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium shadow-xs cursor-pointer"
                >
                  <Download className="size-3.5" />
                  <span>Download All ({splitFiles.length})</span>
                </Button>
              </div>
            </div>

            {/* Side-by-side Small Previews Gallery */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-5">
              {splitFiles.map((file) => (
                <div
                  key={file.id}
                  className="group relative flex flex-col justify-between bg-card hover:bg-accent/30 border border-border/80 hover:border-red-500/40 rounded-xl p-3 shadow-xs hover:shadow-md transition-all duration-200"
                >
                  {/* Card Header: Red (Remove) Button & Page Info */}
                  <div className="flex items-center justify-between gap-1 mb-2">
                    <button
                      type="button"
                      onClick={() => handleRemovePage(file.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold bg-red-500/10 hover:bg-red-600 text-red-600 dark:text-red-400 hover:text-white border border-red-500/25 hover:border-red-600 transition-all cursor-pointer shadow-2xs group/btn"
                      title={`Remove Page ${file.pageNumber}`}
                      aria-label={`Remove Page ${file.pageNumber}`}
                    >
                      <Trash2 className="size-3 group-hover/btn:scale-110 transition-transform" />
                      <span>(Remove)</span>
                    </button>
                    <span className="text-[10px] font-semibold text-muted-foreground truncate" title={`Page ${file.pageNumber}`}>
                      Page {file.pageNumber} · {formatFileSize(file.size)}
                    </span>
                  </div>

                  {/* Small Preview Box (Canvas) */}
                  <div className="relative aspect-[3/4] w-full rounded-lg overflow-hidden bg-white border border-slate-200/90 shadow-xs flex items-center justify-center mb-3">
                    <canvas
                      ref={(el) => {
                        if (el) canvasMapRef.current.set(file.pageNumber, el);
                        else canvasMapRef.current.delete(file.pageNumber);
                      }}
                      className="w-full h-full object-contain"
                    />
                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 pointer-events-none transition-colors" />
                  </div>

                  {/* File Name */}
                  <div className="mb-3">
                    <p
                      className="text-xs font-semibold text-foreground truncate"
                      title={file.filename}
                    >
                      {file.filename}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      1 Page PDF
                    </p>
                  </div>

                  {/* Individual Download & Share Buttons */}
                  <div className="flex items-center gap-1.5 mt-auto">
                    <a
                      href={file.downloadUrl}
                      download={file.filename}
                      className="flex-1 no-underline"
                    >
                      <Button
                        variant="secondary"
                        size="sm"
                        className="w-full flex items-center justify-center gap-1.5 text-xs font-medium group-hover:bg-red-600 group-hover:text-white transition-colors py-1.5 cursor-pointer"
                      >
                        <Download className="size-3.5" />
                        <span>Download</span>
                      </Button>
                    </a>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShareTarget({ filename: file.filename, size: file.size, downloadUrl: file.downloadUrl })}
                      className="p-1.5 text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 border border-border cursor-pointer shrink-0"
                      title="Share file link"
                      aria-label="Share file link"
                    >
                      <Share2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Bottom Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-border/50 text-xs text-muted-foreground">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors cursor-pointer"
              >
                <ArrowLeft className="size-3.5" />
                <span>Return to Upload Section</span>
              </button>
              <span>{splitFiles.length} {splitFiles.length === 1 ? "document" : "documents"} remaining</span>
            </div>
          </div>
        )}

        {/* File Share Modal Popup */}
        <Dialog open={!!shareTarget} onOpenChange={(open) => !open && setShareTarget(null)}>
          <DialogContent
            title="Share Document"
            description="Your split file is ready to share with an instant link."
            className="sm:max-w-[440px]"
          >
            {shareTarget && (
              <ShareModalView
                filename={shareTarget.filename}
                fileSize={shareTarget.size}
                downloadHref={shareTarget.downloadUrl}
                onReset={() => setShareTarget(null)}
                resetLabel="Close"
              />
            )}
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
