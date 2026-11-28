"use client";

import { fetchWithTimeout as fetch } from "@/lib/client-fetch";
import { useEffect, useRef, useState } from "react";
import ActionButton from "@/components/arc/action-button/action-button";
import Button from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import FileDropzone, { formatFileSize } from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import {
  PdfToJpgDropzoneIcon,
  JpgFileBadgeIcon,
} from "@/components/ui/convert-icons";
import { CheckCircle2, Download, Pencil, Share2 } from "lucide-react";
import { ShareModalView } from "@/components/ui/share-modal-view";
import { createZipFromBlobs } from "@/lib/simple-zip";
import styles from "../home.module.css";

const MAX_PDF_SIZE = 100 * 1024 * 1024; // 100 MB

type ConvertedJpgPage = {
  pageNumber: number;
  dataUrl: string;
  blob: Blob;
  filename: string;
  size: number;
};

type ConversionResult = {
  id: string;
  filename: string;
  originalSize: number;
  pageCount: number;
  downloadUrl: string;
  pages: ConvertedJpgPage[];
};

export default function PdfToJpgPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [converting, setConverting] = useState(false);
  const [conversionProgress, setConversionProgress] = useState(0);
  const [conversionResult, setConversionResult] = useState<ConversionResult | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogView, setDialogView] = useState<"result" | "share">("result");
  const [shareData, setShareData] = useState<{ filename: string; size: number; downloadHref: string } | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [qualityDpi, setQualityDpi] = useState<"standard" | "high">("high");

  // Keep track of object URLs to clean them up on unmount or reset
  const createdUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      createdUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      createdUrlsRef.current = [];
    };
  }, []);

  const uploadFile: FileDropzoneUpload = (item, { onProgress }) =>
    new Promise(async (resolve, reject) => {
      if (!item.file) {
        reject(new Error("The selected file could not be read."));
        return;
      }

      setConvertError(null);
      setConversionResult(null);

      const name = item.file.name.toLowerCase();
      const type = item.file.type.toLowerCase();
      const isValidPdf = name.endsWith(".pdf") || type === "application/pdf";

      if (!isValidPdf) {
        reject(new Error("Please upload a valid PDF document (.pdf)."));
        return;
      }

      onProgress(30);

      setSelectedFile(item.file);
      onProgress(100);
      resolve();
    });

  const handleConvert = async () => {
    if (!selectedFile || converting) return;
    setConverting(true);
    setConvertError(null);
    setConversionProgress(10);
    let destroyPdf: (() => Promise<void>) | null = null;

    try {
      // 1. Submit to API to register transient document for workspace editing
      const formData = new FormData();
      formData.append("file", selectedFile);

      const response = await fetch("/api/documents/pdf-to-jpg", {
        method: "POST",
        body: formData,
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "The PDF upload failed. Please try again.");
      }
      const apiData: { id: string } = await response.json();
      setConversionProgress(20);

      // 2. Render after the upload completes, keeping network and canvas work from
      // competing for memory and CPU at the same time.
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const arrayBuf = await selectedFile.arrayBuffer();
      const loadingTask = pdfjs.getDocument({ data: arrayBuf });
      destroyPdf = () => loadingTask.destroy();
      const pdf = await loadingTask.promise;
      const totalPages = pdf.numPages;

      const scale = qualityDpi === "high" ? 2.0 : 1.5; // High resolution rendering
      const convertedPages: ConvertedJpgPage[] = [];
      const baseName = selectedFile.name.replace(/\.pdf$/i, "") || "document";

      // Render each page to an offscreen canvas and export as JPEG
      for (let i = 1; i <= totalPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale });

        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);

        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) {
          page.cleanup();
          canvas.width = 0;
          canvas.height = 0;
          continue;
        }

        // Fill white background for JPEG rendering (PDFs may have transparent canvas backgrounds)
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({
          canvas,
          canvasContext: ctx,
          viewport,
        }).promise;

        const blob = await new Promise<Blob | null>((res) =>
          canvas.toBlob((b) => res(b), "image/jpeg", 0.94),
        );

        if (blob) {
          const url = URL.createObjectURL(blob);
          createdUrlsRef.current.push(url);

          convertedPages.push({
            pageNumber: i,
            dataUrl: url,
            blob,
            filename: `${baseName}-page-${i}.jpg`,
            size: blob.size,
          });
        }

        page.cleanup();
        canvas.width = 0;
        canvas.height = 0;

        const progressPercent = Math.min(90, Math.floor(20 + (i / totalPages) * 70));
        setConversionProgress(progressPercent);
      }

      setConversionProgress(100);
      setConversionResult({
        id: apiData.id,
        filename: selectedFile.name,
        originalSize: selectedFile.size,
        pageCount: convertedPages.length,
        downloadUrl: `/api/documents/${apiData.id}/file?download=1`,
        pages: convertedPages,
      });

      setIsDialogOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF to JPG conversion failed.";
      setConvertError(message);
    } finally {
      if (destroyPdf) await destroyPdf().catch(() => undefined);
      setConverting(false);
      setConversionProgress(0);
    }
  };

  const handleReset = () => {
    setIsDialogOpen(false);
    setDialogView("result");
    setShareData(null);
    setSelectedFile(null);
    setConversionResult(null);
    setConvertError(null);
    createdUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    createdUrlsRef.current = [];
  };

  const handleShareAll = async () => {
    if (!conversionResult || conversionResult.pages.length === 0) return;
    if (conversionResult.pages.length === 1) {
      const page = conversionResult.pages[0];
      setShareData({
        filename: page.filename,
        size: page.size,
        downloadHref: page.dataUrl,
      });
      setDialogView("share");
      return;
    }

    try {
      const zipBlob = await createZipFromBlobs(
        conversionResult.pages.map((p) => ({ name: p.filename, blob: p.blob }))
      );
      const zipUrl = URL.createObjectURL(zipBlob);
      createdUrlsRef.current.push(zipUrl);
      const baseName = conversionResult.filename.replace(/\.pdf$/i, "");
      setShareData({
        filename: `${baseName}-images.zip`,
        size: zipBlob.size,
        downloadHref: zipUrl,
      });
      setDialogView("share");
    } catch (err) {
      console.error("Failed to package images for sharing:", err);
    }
  };

  const downloadSinglePage = (page: ConvertedJpgPage) => {
    const link = document.createElement("a");
    link.href = page.dataUrl;
    link.download = page.filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  };

  const downloadAllPages = () => {
    if (!conversionResult || conversionResult.pages.length === 0) return;

    conversionResult.pages.forEach((page, index) => {
      setTimeout(() => {
        downloadSinglePage(page);
      }, index * 250);
    });
  };

  return (
    <div className="relative min-h-screen flex flex-col bg-background text-foreground transition-colors">
      {/* Top Center Navbar with Theme Switcher at Top-Right */}
      <SiteHeader />

      {/* Main Section */}
      <main className="flex-1 flex flex-col items-center justify-start pt-6 sm:pt-12 pb-12 sm:pb-16 px-3 sm:px-4">
        {/* Heading Section Above Dropzone */}
        <div className="text-center max-w-xl mx-auto mb-6 space-y-2">
          <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            PDF to JPG
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Convert PDF pages to high-quality JPG images in seconds.
          </p>
        </div>

        {/* Center File Dropzone with PDF to JPG Icon */}
        <div className={styles.uploader}>
          <FileDropzone
            className={styles.dropzone}
            borderless
            accept="application/pdf,.pdf"
            multiple={false}
            maxFiles={1}
            maxSize={MAX_PDF_SIZE}
            icon={<PdfToJpgDropzoneIcon className="w-20 h-20 sm:w-28 sm:h-28" />}
            label="Drop your PDF file here"
            description="or click to browse from your device"
            note="PDF only · Up to 100 MB"
            dropLabel="Release to convert PDF to JPG"
            onUpload={uploadFile}
            onFilesChange={(files) => {
              if (files.length === 0) {
                setSelectedFile(null);
                setConvertError(null);
                setConversionResult(null);
              }
            }}
          />

          {convertError && (
            <div className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">
              {convertError}
            </div>
          )}

          {/* Controls and Action Area */}
          {selectedFile && (
            <div className="mt-5 space-y-4">
              {/* Quality Selector */}
              <div className="flex items-center justify-between p-2.5 rounded-xl bg-muted/40 border border-border/50 text-xs">
                <span className="font-medium text-muted-foreground">Image Quality:</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setQualityDpi("standard")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      qualityDpi === "standard"
                        ? "bg-background text-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Standard (150 DPI)
                  </button>
                  <button
                    type="button"
                    onClick={() => setQualityDpi("high")}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                      qualityDpi === "high"
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    High (300 DPI)
                  </button>
                </div>
              </div>

              {/* Action Button */}
              <div className={styles.processAction}>
                <ActionButton
                  label="Convert to JPG"
                  pendingLabel={
                    conversionProgress > 0
                      ? `Converting (${conversionProgress}%)...`
                      : "Extracting Images..."
                  }
                  successLabel="Converted"
                  onAction={handleConvert}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      <SiteFooter />

      {/* Result Dialog Modal Popup */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setDialogView("result");
            setShareData(null);
          }
        }}
      >
        <DialogContent
          title={dialogView === "share" ? "Share Converted JPG Images" : "PDF Converted to JPG"}
          description={
            dialogView === "share"
              ? "Your converted images are ready to share with an instant link."
              : "Your JPG images are ready to download."
          }
          className="sm:max-w-[480px]"
        >
          {conversionResult && (
            dialogView === "share" && shareData ? (
              <ShareModalView
                filename={shareData.filename}
                fileSize={shareData.size}
                downloadHref={shareData.downloadHref}
                onBackToDownload={() => setDialogView("result")}
                onReset={handleReset}
                resetLabel="Convert Another PDF"
              />
            ) : (
            <div className="space-y-4 pt-1">
              {/* Summary Status pill */}
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs">
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
                  <CheckCircle2 className="size-3.5" />
                  Status
                </span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  Successfully Converted ({conversionResult.pages.length}{" "}
                  {conversionResult.pages.length === 1 ? "image" : "images"})
                </span>
              </div>

              {/* Summary Card with JpgFileBadgeIcon */}
              <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-card/60">
                <JpgFileBadgeIcon className="size-11 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate text-foreground">
                    {conversionResult.filename.replace(/\.pdf$/i, "")}.jpg
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {conversionResult.pages.length} {conversionResult.pages.length === 1 ? "page converted" : "pages converted"}
                  </p>
                </div>
              </div>

              {/* Converted JPG Pages Gallery */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
                  Extracted Pages ({conversionResult.pages.length})
                </p>
                <div className="max-h-60 overflow-y-auto space-y-2 pr-1 rounded-xl">
                  {conversionResult.pages.map((page) => (
                    <div
                      key={page.pageNumber}
                      className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-border bg-card/70 hover:bg-card transition-colors"
                    >
                      {/* Image Thumbnail and Details */}
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="relative size-12 rounded-lg overflow-hidden border border-border bg-muted/40 shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={page.dataUrl}
                            alt={`Page ${page.pageNumber}`}
                            className="size-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate text-foreground" title={page.filename}>
                            {page.filename}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Page {page.pageNumber} · {formatFileSize(page.size)}
                          </p>
                        </div>
                      </div>

                      {/* Download Single JPG Button */}
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 px-2.5 text-xs font-medium gap-1.5 shrink-0 rounded-lg cursor-pointer"
                        onClick={() => downloadSinglePage(page)}
                        title={`Download Page ${page.pageNumber}`}
                      >
                        <Download className="size-3.5" />
                        <span>JPG</span>
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Download All and Workspace Action Buttons */}
              <div className="flex flex-col gap-2 pt-1 border-t border-border/50">
                <Button
                  type="button"
                  variant="primary"
                  className="w-full h-11 justify-center gap-2 text-sm font-semibold rounded-xl cursor-pointer bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={downloadAllPages}
                >
                  <Download className="size-4" />
                  Download All JPGs ({conversionResult.pages.length})
                </Button>
                <a
                  href={`/documents/${conversionResult.id}`}
                  className="w-full"
                >
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full h-9 justify-center gap-2 text-xs font-medium rounded-xl"
                  >
                    <Pencil className="size-3.5" />
                    Edit PDF in Workspace
                  </Button>
                </a>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1 h-9 justify-center text-xs text-muted-foreground hover:text-foreground rounded-xl"
                    onClick={handleReset}
                  >
                    Convert Another PDF
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="flex-1 h-9 justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded-xl"
                    onClick={handleShareAll}
                  >
                    <Share2 className="size-3.5" />
                    File Share
                  </Button>
                </div>
              </div>
            </div>
            )
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
