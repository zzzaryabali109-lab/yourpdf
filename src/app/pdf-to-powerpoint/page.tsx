"use client";

import { fetchWithTimeout as fetch } from "@/lib/client-fetch";
import { useState } from "react";
import ActionButton from "@/components/arc/action-button/action-button";
import Button from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import FileDropzone, { formatFileSize } from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import { SiteHeader } from "@/components/site-header";
import {
  PdfToPowerpointDropzoneIcon,
  PowerpointFileBadgeIcon,
} from "@/components/ui/convert-icons";
import { CheckCircle2, Download, Pencil, Share2 } from "lucide-react";
import { ShareModalView } from "@/components/ui/share-modal-view";
import styles from "../home.module.css";

const MAX_PDF_SIZE = 100 * 1024 * 1024; // 100 MB

type SelectedPdfItem = {
  id: string;
  file: File;
};

type ConversionResult = {
  id: string;
  filename: string;
  originalSize: number;
  outputSize: number;
  pageCount: number;
  method: string;
  downloadUrl: string;
};

export default function PdfToPowerpointPage() {
  const [selectedDoc, setSelectedDoc] = useState<SelectedPdfItem | null>(null);
  const [converting, setConverting] = useState(false);
  const [conversionResult, setConversionResult] = useState<ConversionResult | null>(null);
  const [customFileName, setCustomFileName] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogView, setDialogView] = useState<"result" | "share">("result");
  const [convertError, setConvertError] = useState<string | null>(null);

  const uploadFile: FileDropzoneUpload = (item, { onProgress }) =>
    new Promise((resolve, reject) => {
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

      onProgress(50);
      setSelectedDoc({
        id: `${item.file.name}_${Date.now()}`,
        file: item.file,
      });
      onProgress(100);
      resolve();
    });

  const handleConvert = async () => {
    if (!selectedDoc || converting) return;
    setConverting(true);
    setConvertError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedDoc.file);

      const response = await fetch("/api/documents/pdf-to-powerpoint", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "PDF to PowerPoint conversion failed. Please try again.");
      }

      setConversionResult(data);
      const baseName = data.filename.replace(/\.pptx$/i, "") || "converted-presentation";
      setCustomFileName(baseName);
      setIsDialogOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "PDF to PowerPoint conversion failed.";
      setConvertError(message);
    } finally {
      setConverting(false);
    }
  };

  const handleReset = () => {
    setIsDialogOpen(false);
    setDialogView("result");
    setSelectedDoc(null);
    setConversionResult(null);
    setCustomFileName("");
    setConvertError(null);
  };

  const downloadFile = (url: string, filename: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
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
            PDF to POWERPOINT
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Convert PDF presentations to editable PowerPoint PPTX slides.
          </p>
        </div>

        {/* Center File Dropzone with PDF to PowerPoint Icon */}
        <div className={styles.uploader}>
          <FileDropzone
            className={styles.dropzone}
            borderless
            accept="application/pdf,.pdf"
            multiple={false}
            maxFiles={1}
            maxSize={MAX_PDF_SIZE}
            icon={<PdfToPowerpointDropzoneIcon className="w-20 h-20 sm:w-28 sm:h-28" />}
            label="Drop your PDF file here"
            description="or click to browse from your device"
            note="PDF only · Up to 100 MB"
            dropLabel="Release to convert PDF to PowerPoint"
            onUpload={uploadFile}
            onFilesChange={(files) => {
              if (files.length === 0) {
                setSelectedDoc(null);
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

          {/* Action Button */}
          {selectedDoc && (
            <div className={`mt-5 ${styles.processAction}`}>
              <ActionButton
                label="Convert to POWERPOINT"
                pendingLabel="Converting to PowerPoint..."
                successLabel="Converted"
                onAction={handleConvert}
              />
            </div>
          )}
        </div>
      </main>

      {/* Result Dialog Modal Popup */}
      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) setDialogView("result");
        }}
      >
        <DialogContent
          title={dialogView === "share" ? "Share Presentation" : "PDF Converted to PowerPoint"}
          description={
            dialogView === "share"
              ? "Your presentation is ready to share with an instant link."
              : "Your PowerPoint presentation (.pptx) is ready to download."
          }
          className="sm:max-w-[440px]"
        >
          {conversionResult && (() => {
            const finalDownloadName = `${customFileName.trim().replace(/\.pptx$/i, "") || "converted-presentation"}.pptx`;
            const downloadHref = conversionResult.downloadUrl
              ? `${conversionResult.downloadUrl}&name=${encodeURIComponent(finalDownloadName)}`
              : `/api/documents/${conversionResult.id}/file?download=1&name=${encodeURIComponent(finalDownloadName)}`;

            if (dialogView === "share") {
              return (
                <ShareModalView
                  filename={finalDownloadName}
                  fileSize={conversionResult.outputSize}
                  downloadHref={downloadHref}
                  onBackToDownload={() => setDialogView("result")}
                  onReset={handleReset}
                  resetLabel="Convert Another PDF"
                />
              );
            }

            return (
              <div className="space-y-4 pt-1">
                {/* File details card */}
                <div className="p-4 rounded-xl border border-border bg-card/60 space-y-3.5">
                  <div className="flex items-center gap-3">
                    <PowerpointFileBadgeIcon className="size-11" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate text-foreground" title={finalDownloadName}>
                        {finalDownloadName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {conversionResult.pageCount} {conversionResult.pageCount === 1 ? "slide" : "slides"} · {formatFileSize(conversionResult.outputSize)}
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
                      Successfully Converted ({conversionResult.pageCount} {conversionResult.pageCount === 1 ? "slide" : "slides"})
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
                        placeholder="converted-presentation"
                        className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden"
                      />
                      <span className="text-xs text-muted-foreground font-mono select-none pl-1">.pptx</span>
                    </div>
                  </div>
                </div>

                {/* Download and Action buttons */}
                <div className="flex flex-col gap-2 pt-1">
                  <Button
                    type="button"
                    variant="primary"
                    className="w-full h-11 justify-center gap-2 text-sm font-semibold rounded-xl cursor-pointer bg-orange-600 hover:bg-orange-700 text-white"
                    onClick={() => downloadFile(downloadHref, finalDownloadName)}
                  >
                    <Download className="size-4" />
                    Download PowerPoint Presentation
                  </Button>
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
                      onClick={() => setDialogView("share")}
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
