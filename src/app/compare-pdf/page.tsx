"use client";

import { useState } from "react";
import Button from "@/components/arc/button/button";
import FileDropzone from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import { SiteHeader } from "@/components/site-header";
import { CompareDropzoneIcon } from "@/components/ui/convert-icons";
import { CompareViewer } from "@/components/compare/compare-viewer";
import { ArrowRight, FileText } from "lucide-react";
import styles from "@/components/compare/compare.module.css";

const MAX_PDF_SIZE = 100 * 1024 * 1024; // 100 MB

export default function ComparePdfPage() {
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [isComparing, setIsComparing] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadFile1: FileDropzoneUpload = (item, { onProgress, signal }) =>
    new Promise((resolve, reject) => {
      if (!item.file) {
        reject(new Error("The selected file could not be read."));
        return;
      }
      const isPdf = item.file.type === "application/pdf" || item.file.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        reject(new Error("Please upload a valid PDF document."));
        return;
      }
      setUploadError(null);

      // Smooth progress animation so @uiarc/file-dropzone's progress bar and upload animation run
      let p = 15;
      onProgress(p);
      const interval = setInterval(() => {
        if (signal.aborted) {
          clearInterval(interval);
          return;
        }
        p += 25;
        if (p >= 100) {
          clearInterval(interval);
          onProgress(100);
          setFile1(item.file!);
          resolve();
        } else {
          onProgress(p);
        }
      }, 70);
    });

  const uploadFile2: FileDropzoneUpload = (item, { onProgress, signal }) =>
    new Promise((resolve, reject) => {
      if (!item.file) {
        reject(new Error("The selected file could not be read."));
        return;
      }
      const isPdf = item.file.type === "application/pdf" || item.file.name.toLowerCase().endsWith(".pdf");
      if (!isPdf) {
        reject(new Error("Please upload a valid PDF document."));
        return;
      }
      setUploadError(null);

      // Smooth progress animation so @uiarc/file-dropzone's progress bar and upload animation run
      let p = 15;
      onProgress(p);
      const interval = setInterval(() => {
        if (signal.aborted) {
          clearInterval(interval);
          return;
        }
        p += 25;
        if (p >= 100) {
          clearInterval(interval);
          onProgress(100);
          setFile2(item.file!);
          resolve();
        } else {
          onProgress(p);
        }
      }, 70);
    });

  const handleReset = () => {
    setIsComparing(false);
    setFile1(null);
    setFile2(null);
    setUploadError(null);
    setResetKey((prev) => prev + 1);
  };

  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      {/* Site Header */}
      <SiteHeader />

      <main className="flex-1 flex flex-col items-center justify-start pt-6 sm:pt-12 pb-12 sm:pb-16 px-3 sm:px-4">
        {!isComparing ? (
          <div className={styles.compareContainer}>
            {/* Header Title Section */}
            <div className="text-center space-y-3 mb-2 max-w-2xl">
              <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground">
                Compare PDF Documents
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
                Upload two PDF files side by side to visually inspect differences and highlight every change.
              </p>
            </div>

            {/* Error Message */}
            {uploadError && (
              <div className="w-full max-w-md mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">
                {uploadError}
              </div>
            )}

            {/* Side-by-Side Dropzones Section */}
            <div className={styles.dropzonesGrid}>
              {/* Dropzone 1 (Original / Before) */}
              <div className={styles.dropzoneCard}>
                <div className={styles.dropzoneHeader}>
                  <span className={styles.dropzoneTitle}>
                    <FileText className="size-4 text-rose-500" /> Original Document
                  </span>
                  <span className={styles.badgeBefore}>PDF 1 (Before)</span>
                </div>

                <FileDropzone
                  key={`dropzone-1-${resetKey}`}
                  className={styles.dropzoneCustom}
                  borderless
                  accept="application/pdf,.pdf"
                  multiple={false}
                  maxFiles={1}
                  maxSize={MAX_PDF_SIZE}
                  icon={<CompareDropzoneIcon className="w-14 h-14 sm:w-16 sm:h-16" />}
                  label="Drop original PDF here"
                  description="or click to browse from device"
                  note="PDF only · Up to 100 MB"
                  dropLabel="Release original PDF"
                  onUpload={uploadFile1}
                  onFilesChange={(files) => {
                    if (files.length === 0) {
                      setFile1(null);
                    }
                  }}
                />
              </div>

              {/* Dropzone 2 (Modified / After) */}
              <div className={styles.dropzoneCard}>
                <div className={styles.dropzoneHeader}>
                  <span className={styles.dropzoneTitle}>
                    <FileText className="size-4 text-emerald-500" /> Modified Document
                  </span>
                  <span className={styles.badgeAfter}>PDF 2 (After)</span>
                </div>

                <FileDropzone
                  key={`dropzone-2-${resetKey}`}
                  className={styles.dropzoneCustom}
                  borderless
                  accept="application/pdf,.pdf"
                  multiple={false}
                  maxFiles={1}
                  maxSize={MAX_PDF_SIZE}
                  icon={<CompareDropzoneIcon className="w-14 h-14 sm:w-16 sm:h-16" />}
                  label="Drop modified PDF here"
                  description="or click to browse from device"
                  note="PDF only · Up to 100 MB"
                  dropLabel="Release modified PDF"
                  onUpload={uploadFile2}
                  onFilesChange={(files) => {
                    if (files.length === 0) {
                      setFile2(null);
                    }
                  }}
                />
              </div>
            </div>

            {/* Compare Action Button - Only appears after both files are uploaded */}
            {file1 && file2 && (
              <div className="mt-8 flex flex-col items-center gap-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={() => setIsComparing(true)}
                  className="px-8 py-6 text-base font-bold shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30 transition-all rounded-xl"
                >
                  Compare PDF Documents <ArrowRight className="size-5 ml-2" />
                </Button>
                <p className="text-xs text-muted-foreground text-center">
                  Both documents ready · Click to compare differences side by side
                </p>
              </div>
            )}
          </div>
        ) : (
          /* Side-by-Side Comparison Viewer with Difference Highlights */
          <CompareViewer file1={file1!} file2={file2!} onReset={handleReset} />
        )}
      </main>
    </div>
  );
}
