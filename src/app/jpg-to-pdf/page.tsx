"use client";

import { fetchWithTimeout as fetch } from "@/lib/client-fetch";
import { useEffect, useRef, useState } from "react";
import ActionButton from "@/components/arc/action-button/action-button";
import Button from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import FileDropzone, { formatFileSize } from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import { SiteHeader } from "@/components/site-header";
import { JpgToPdfImageIcon, PdfDocumentImageIcon } from "@/components/ui/convert-icons";
import { CheckCircle2, Download, Layers, Pencil, X, Share2, Copy, Check, ExternalLink } from "lucide-react";
import styles from "../home.module.css";

const MAX_IMAGE_SIZE = 100 * 1024 * 1024; // 100 MB
const MAX_TOTAL_IMAGE_SIZE = 100 * 1024 * 1024; // Keep multi-image conversion within the app's memory budget.

type SelectedImageItem = {
  id: string;
  file: File;
  previewUrl: string;
};

type ConversionResult = {
  id: string;
  filename: string;
  originalSize: number;
  outputSize: number;
  pageCount: number;
  downloadUrl: string;
};

export default function JpgToPdfPage() {
  const [selectedImages, setSelectedImages] = useState<SelectedImageItem[]>([]);
  const previewUrlsRef = useRef(new Set<string>());
  const [converting, setConverting] = useState(false);
  const [conversionResult, setConversionResult] = useState<ConversionResult | null>(null);
  const [customFileName, setCustomFileName] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [dialogView, setDialogView] = useState<"result" | "share">("result");
  const [isSharingPdf, setIsSharingPdf] = useState(false);
  const [shareResult, setShareResult] = useState<{ id: string; filename: string; size: number; shareUrl: string } | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [copiedShare, setCopiedShare] = useState(false);
  const [currentShareName, setCurrentShareName] = useState("");
  const [currentShareHref, setCurrentShareHref] = useState("");

  useEffect(() => () => {
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    previewUrlsRef.current.clear();
  }, []);

  const uploadFile: FileDropzoneUpload = (item, { onProgress }) =>
    new Promise((resolve, reject) => {
      if (!item.file) {
        reject(new Error("The selected file could not be read."));
        return;
      }

      setConvertError(null);
      setConversionResult(null);

      // Verify file is a supported image
      const type = item.file.type.toLowerCase();
      const name = item.file.name.toLowerCase();
      const isValidImage =
        type.startsWith("image/") ||
        name.endsWith(".jpg") ||
        name.endsWith(".jpeg") ||
        name.endsWith(".png") ||
        name.endsWith(".webp");

      if (!isValidImage) {
        reject(new Error("Please upload valid image files (JPG, JPEG, PNG, WebP)."));
        return;
      }

      onProgress(50);
      const previewUrl = URL.createObjectURL(item.file);
      previewUrlsRef.current.add(previewUrl);
      const newItem: SelectedImageItem = {
        id: `${item.file.name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        file: item.file,
        previewUrl,
      };

      setSelectedImages((prev) => [...prev, newItem]);
      onProgress(100);
      resolve();
    });

  const removeImage = (idToRemove: string) => {
    setSelectedImages((prev) => {
      const target = prev.find((i) => i.id === idToRemove);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((i) => i.id !== idToRemove);
    });
    setConvertError(null);
  };

  const handleConvert = async () => {
    if (selectedImages.length === 0 || converting) return;
    setConverting(true);
    setConvertError(null);

    try {
      const formData = new FormData();
      for (const item of selectedImages) {
        formData.append("files", item.file);
      }

      const response = await fetch("/api/documents/jpg-to-pdf", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "JPG to PDF conversion failed. Please try again.");
      }

      setConversionResult(data);
      const baseName = data.filename.replace(/\.pdf$/i, "") || "converted-images";
      setCustomFileName(baseName);
      setDialogView("result");
      setIsDialogOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "JPG to PDF conversion failed.";
      setConvertError(message);
    } finally {
      setConverting(false);
    }
  };

  const handleReset = () => {
    for (const item of selectedImages) {
      if (item.previewUrl) {
        URL.revokeObjectURL(item.previewUrl);
        previewUrlsRef.current.delete(item.previewUrl);
      }
    }
    setIsDialogOpen(false);
    setDialogView("result");
    setSelectedImages([]);
    setConversionResult(null);
    setCustomFileName("");
    setConvertError(null);
    setShareResult(null);
    setShareError(null);
    setCopiedShare(false);
  };

  const handleSharePdf = async (name: string, href: string) => {
    setCurrentShareName(name);
    setCurrentShareHref(href);
    setDialogView("share");

    if (shareResult && shareResult.filename === name) {
      return;
    }

    setIsSharingPdf(true);
    setShareError(null);
    setCopiedShare(false);

    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error("Could not fetch the converted PDF.");
      const blob = await res.blob();

      const formData = new FormData();
      formData.set("file", new File([blob], name, { type: "application/pdf" }));

      const uploadRes = await fetch("/api/share", {
        method: "POST",
        body: formData,
      });

      const data = await uploadRes.json();
      if (!uploadRes.ok || data.error) {
        throw new Error(data.error || "Failed to generate share link.");
      }

      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const cleanOrigin = origin.replace(/^http:\/\/0\.0\.0\.0/, "http://localhost");
      const shareUrl = `${cleanOrigin}/file-share/${data.id}`;

      setShareResult({
        ...data,
        shareUrl,
      });
    } catch (err: unknown) {
      console.error("Failed to share PDF:", err);
      const msg = err instanceof Error ? err.message : "Failed to create share link.";
      setShareError(msg);
    } finally {
      setIsSharingPdf(false);
    }
  };

  const handleCopyShareLink = async () => {
    if (!shareResult?.shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareResult.shareUrl);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2500);
    } catch {
      const input = document.getElementById("jpg-share-link") as HTMLInputElement | null;
      if (input) {
        input.select();
        document.execCommand("copy");
        setCopiedShare(true);
        setTimeout(() => setCopiedShare(false), 2500);
      }
    }
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
            JPG to PDF
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Convert your JPG, JPEG, and PNG images into clean, high-quality PDF documents in seconds.
          </p>
        </div>

        {/* Center File Dropzone with JPG to PDF Icon */}
        <div className={styles.uploader}>
          <FileDropzone
            className={styles.dropzone}
            borderless
            accept="image/jpeg,image/png,image/webp,image/jpg,.jpg,.jpeg,.png,.webp"
            multiple={true}
            maxFiles={50}
            maxSize={MAX_IMAGE_SIZE}
            maxTotalSize={MAX_TOTAL_IMAGE_SIZE}
            icon={<JpgToPdfImageIcon className="w-20 h-20 object-contain sm:w-28 sm:h-28" />}
            label="Drop your JPG or image files here"
            description="or click to browse multiple images from your device"
            note="JPG, JPEG, PNG, WebP · Up to 50 images · 100 MB total"
            dropLabel="Release to add images to convert"
            onUpload={uploadFile}
            onFilesChange={(files) => {
              if (files.length === 0) {
                setSelectedImages([]);
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

          {/* Selected Images List and Action Area */}
          {selectedImages.length > 0 && (
            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Layers className="size-3.5 text-yellow-500" />
                  <span>
                    {selectedImages.length} {selectedImages.length === 1 ? "image ready" : "images ready"} to convert
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  Clear all
                </button>
              </div>

              {/* Thumbnail Strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[260px] overflow-y-auto p-1 rounded-xl border border-border/50 bg-muted/20">
                {selectedImages.map((img, idx) => (
                  <div
                    key={img.id}
                    className="relative group flex items-center gap-2.5 p-2 rounded-lg bg-card border border-border/60 hover:border-border transition-colors shadow-xs"
                  >
                    <div className="relative size-11 rounded-md overflow-hidden bg-muted/60 shrink-0 border border-border/40">
                      {/* Image Thumbnail */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={img.previewUrl}
                        alt={img.file.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1 pr-4">
                      <p className="text-xs font-medium truncate text-foreground" title={img.file.name}>
                        {img.file.name}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatFileSize(img.file.size)} · Page {idx + 1}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeImage(img.id)}
                      className="absolute top-1.5 right-1.5 size-5 flex items-center justify-center rounded-full bg-muted/80 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
                      title="Remove image"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Action Button */}
              <div className={styles.processAction}>
                <ActionButton
                  label={`Convert ${selectedImages.length} ${selectedImages.length === 1 ? "Image" : "Images"} to PDF`}
                  pendingLabel="Converting to PDF..."
                  successLabel="Converted"
                  onAction={handleConvert}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Result & Share Dialog Modal Popup */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setDialogView("result");
          }
        }}
      >
        <DialogContent
          title={dialogView === "share" ? "Share Converted PDF" : "Images Converted to PDF"}
          description={
            dialogView === "share"
              ? "Your PDF is ready to share with an instant link."
              : "Your PDF document is ready to download."
          }
          className="sm:max-w-[440px]"
        >
          {conversionResult && (() => {
            const finalDownloadName = `${customFileName.trim().replace(/\.pdf$/i, "") || "converted-images"}.pdf`;
            const downloadHref = conversionResult.downloadUrl
              ? `${conversionResult.downloadUrl}&name=${encodeURIComponent(finalDownloadName)}`
              : `/api/documents/${conversionResult.id}/file?download=1&name=${encodeURIComponent(finalDownloadName)}`;

            if (dialogView === "share") {
              return (
                <div className="space-y-4 pt-1">
                  {isSharingPdf ? (
                    <div className="p-8 text-center space-y-3">
                      <div className="size-8 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto" />
                      <p className="text-xs text-foreground/70">Generating share link...</p>
                    </div>
                  ) : shareError ? (
                    <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm space-y-3 text-center">
                      <p>{shareError}</p>
                      <div className="flex items-center justify-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleSharePdf(currentShareName, currentShareHref)}
                          className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold cursor-pointer"
                        >
                          Retry
                        </button>
                        <button
                          type="button"
                          onClick={() => setDialogView("result")}
                          className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent cursor-pointer"
                        >
                          Back to Download
                        </button>
                      </div>
                    </div>
                  ) : shareResult ? (
                    <div className="space-y-4">
                      {/* File info card */}
                      <div className="p-3.5 rounded-xl border border-border/80 bg-card flex items-center gap-3">
                        <PdfDocumentImageIcon className="size-11 shrink-0 object-contain" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold truncate text-foreground" title={shareResult.filename}>
                            {shareResult.filename}
                          </p>
                          <p className="text-xs text-foreground/70">
                            {formatFileSize(shareResult.size)} · Valid for 48 hours
                          </p>
                        </div>
                      </div>

                      {/* Share Link input & copy */}
                      <div className="space-y-1.5">
                        <label
                          htmlFor="jpg-share-link"
                          className="block text-[11px] font-semibold text-foreground uppercase tracking-wider"
                        >
                          Shareable Link
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id="jpg-share-link"
                            type="text"
                            readOnly
                            value={shareResult.shareUrl}
                            className="flex-1 px-3 py-2 rounded-xl border border-border bg-card text-foreground text-xs font-mono select-all focus:outline-none focus:ring-2 focus:ring-primary/40 truncate"
                            onClick={(e) => (e.target as HTMLInputElement).select()}
                          />
                          <button
                            type="button"
                            onClick={handleCopyShareLink}
                            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-medium text-xs transition-all cursor-pointer shadow-sm ${
                              copiedShare
                                ? "bg-emerald-600 text-white"
                                : "bg-primary text-primary-foreground hover:bg-primary/90"
                            }`}
                          >
                            {copiedShare ? (
                              <>
                                <Check className="size-3.5" />
                                <span>Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="size-3.5" />
                                <span>Copy Link</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Direct Action buttons */}
                      <div className="flex items-center gap-2 pt-1">
                        <a
                          href={shareResult.shareUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-card hover:bg-accent text-foreground text-xs font-semibold transition-colors cursor-pointer"
                        >
                          <ExternalLink className="size-3.5" />
                          <span>Open Link</span>
                        </a>
                        <Button
                          type="button"
                          variant="secondary"
                          className="flex-1 h-9 justify-center text-xs text-foreground/80 hover:text-foreground rounded-xl"
                          onClick={() => setDialogView("result")}
                        >
                          Back to Download
                        </Button>
                      </div>

                      <div className="pt-1">
                        <Button
                          type="button"
                          variant="secondary"
                          className="w-full h-8 justify-center text-xs text-muted-foreground hover:text-foreground rounded-lg"
                          onClick={handleReset}
                        >
                          Convert More Images
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            }

            return (
              <div className="space-y-4 pt-1">
                {/* File details card */}
                <div className="p-4 rounded-xl border border-border bg-card/60 space-y-3.5">
                  <div className="flex items-center gap-3">
                    <PdfDocumentImageIcon className="size-11 object-contain" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate text-foreground" title={finalDownloadName}>
                        {finalDownloadName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {conversionResult.pageCount} {conversionResult.pageCount === 1 ? "page" : "pages"} · {formatFileSize(conversionResult.outputSize)}
                      </p>
                    </div>
                  </div>

                  {/* Summary Status pill */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs">
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
                      <CheckCircle2 className="size-3.5" />
                      Status
                    </span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      Successfully Created ({conversionResult.pageCount} {conversionResult.pageCount === 1 ? "page" : "pages"})
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
                    <div className="flex items-center rounded-lg border border-input bg-background px-3 py-1.5 focus-within:ring-2 focus-within:ring-ring/30 focus-within:border-ring transition-all">
                      <input
                        type="text"
                        value={customFileName}
                        onChange={(e) => setCustomFileName(e.target.value)}
                        placeholder="converted-images"
                        className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden"
                      />
                      <span className="text-xs text-muted-foreground font-mono select-none pl-1">.pdf</span>
                    </div>
                  </div>
                </div>

                {/* Download and Action buttons */}
                <div className="flex flex-col gap-2 pt-1">
                  <a
                    href={downloadHref}
                    download={finalDownloadName}
                    className="w-full"
                  >
                    <Button
                      type="button"
                      variant="primary"
                      className="w-full h-11 justify-center gap-2 text-sm font-semibold rounded-xl"
                    >
                      <Download className="size-4" />
                      Download PDF
                    </Button>
                  </a>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="flex-1 h-9 justify-center text-xs text-muted-foreground hover:text-foreground rounded-xl"
                      onClick={handleReset}
                    >
                      Convert More Images
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      className="flex-1 h-9 justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded-xl"
                      onClick={() => handleSharePdf(finalDownloadName, downloadHref)}
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
