"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { SiteHeader } from "@/components/site-header";
import FileDropzone, { formatFileSize } from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import {
  Share2,
  Copy,
  Check,
  ExternalLink,
  Clock,
  Sparkles,
  RotateCcw,
  AlertCircle,
} from "lucide-react";
import { RealFileBadge } from "@/components/ui/real-file-badge";
import styles from "../home.module.css";

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

type SharedFileInfo = {
  id: string;
  filename: string;
  size: number;
  mimeType: string;
  uploadedAt: string;
  expiresAt: string;
  downloadCount: number;
  shareUrl: string;
  downloadUrl: string;
};

export default function FileSharePage() {
  const [uploadedShare, setUploadedShare] = useState<SharedFileInfo | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const uploadFile: FileDropzoneUpload = (item, { onProgress, signal }) =>
    new Promise((resolve, reject) => {
      if (!item.file) {
        const err = new Error("The selected file could not be read.");
        reject(err);
        return;
      }

      setUploadError(null);
      setUploadedShare(null);
      setCopied(false);

      const formData = new FormData();
      formData.set("file", item.file);

      const request = new XMLHttpRequest();
      request.open("POST", "/api/share");
      request.responseType = "json";
      request.timeout = 300_000;

      const removeAbortListener = () => signal.removeEventListener("abort", abortRequest);
      const abortRequest = () => request.abort();
      signal.addEventListener("abort", abortRequest);

      request.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress((event.loaded / event.total) * 100);
        }
      };

      request.onload = () => {
        removeAbortListener();
        const response = request.response as (SharedFileInfo & { error?: string }) | null;
        if (request.status >= 200 && request.status < 300 && response?.id) {
          // Ensure shareUrl uses the current browser window origin if needed
          const origin = typeof window !== "undefined" ? window.location.origin : "";
          const resolvedShare: SharedFileInfo = {
            ...response,
            shareUrl: `${origin}/file-share/${response.id}`,
            downloadUrl: `${origin}/api/share/${response.id}/download`,
          };
          setUploadedShare(resolvedShare);
          resolve();
        } else {
          const message = response?.error || "Failed to upload file and create share link.";
          setUploadError(message);
          reject(new Error(message));
        }
      };

      request.onerror = () => {
        removeAbortListener();
        const message = "Network error during upload. Please check your connection and retry.";
        setUploadError(message);
        reject(new Error(message));
      };

      request.ontimeout = () => {
        removeAbortListener();
        const message = "Upload timed out. Please try again with a faster connection.";
        setUploadError(message);
        reject(new Error(message));
      };

      request.send(formData);
    });

  const handleCopy = async () => {
    if (!uploadedShare) return;
    try {
      await navigator.clipboard.writeText(uploadedShare.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback if clipboard API is restricted
      const input = document.getElementById("share-url-input") as HTMLInputElement | null;
      if (input) {
        input.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    }
  };

  const handleReset = () => {
    setUploadedShare(null);
    setUploadError(null);
    setCopied(false);
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <SiteHeader />

      <main className="flex-1 flex flex-col items-center justify-center px-3 sm:px-6 pt-6 pb-14 sm:pt-12 sm:pb-20 lg:px-8">
        <div className="w-full max-w-2xl mx-auto space-y-6 sm:space-y-8">
          {/* Header Title Section */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-transparent text-foreground border border-border/80">
              <Share2 className="size-3.5 text-foreground" />
              <span>Instant File Sharing</span>
            </div>
            <h1 className="text-2xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-foreground">
              Share Any File Easily
            </h1>
            <p className="text-sm sm:text-base text-muted-foreground max-w-md mx-auto">
              Upload any document, image, or archive. We will generate a secure, shareable link instantly.
            </p>
          </div>

          {/* Upload Area or Generated Link View */}
          <div className={styles.uploader + " mx-auto"}>
            {!uploadedShare ? (
              <>
                <FileDropzone
                  className={styles.dropzone}
                  borderless
                  multiple={false}
                  maxFiles={1}
                  maxSize={MAX_FILE_SIZE}
                  icon={
                    <div className="flex items-center justify-center text-foreground mb-1 bg-transparent">
                      <Image
                        src="/file-sharing-network-icon.png"
                        alt=""
                        width={1244}
                        height={1238}
                        unoptimized
                        className="size-[76px] shrink-0 object-contain"
                      />
                    </div>
                  }
                  label="Drop any file here to share"
                  description="or click to browse from your device"
                  note="Any file format · Up to 100 MB · Valid for 48 hours"
                  dropLabel="Release to create your share link"
                  onUpload={uploadFile}
                  onFilesChange={() => {
                    setUploadError(null);
                  }}
                />

                {uploadError && (
                  <div className="mt-4 p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2.5">
                    <AlertCircle className="size-4 shrink-0" />
                    <span>{uploadError}</span>
                  </div>
                )}
              </>
            ) : (
              /* Success / Shareable Link Card */
              <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-background p-4 sm:p-8 shadow-xl space-y-4 sm:space-y-6 animate-in fade-in zoom-in-95 duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-sm">
                    <span className="size-2 rounded-full bg-emerald-500 animate-ping inline-block" />
                    <span>Your file link is ready!</span>
                  </div>
                  <button
                    onClick={handleReset}
                    type="button"
                    className="inline-flex items-center gap-1.5 text-xs text-foreground/70 hover:text-foreground transition-colors cursor-pointer"
                  >
                    <RotateCcw className="size-3.5" />
                    <span>Share another file</span>
                  </button>
                </div>

                {/* File Preview Information */}
                <div className="flex items-center gap-4 p-4 rounded-2xl bg-card border border-border/80 shadow-xs">
                  <div className="size-14 rounded-xl flex items-center justify-center shrink-0">
                    <RealFileBadge filename={uploadedShare.filename} className="size-12 shrink-0" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-base font-bold text-foreground truncate"
                      title={uploadedShare.filename}
                    >
                      {uploadedShare.filename}
                    </p>
                    <div className="flex items-center gap-3 text-xs text-foreground/70 mt-0.5">
                      <span className="font-medium text-foreground">{formatFileSize(uploadedShare.size)}</span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        <span>Available for 48 hours</span>
                      </span>
                    </div>
                  </div>
                </div>

                {/* Shareable Link Input & One-Click Copy */}
                <div className="space-y-2">
                  <label
                    htmlFor="share-url-input"
                    className="block text-xs font-semibold text-foreground uppercase tracking-wider"
                  >
                    Shareable Link
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="share-url-input"
                      type="text"
                      readOnly
                      value={uploadedShare.shareUrl}
                      className="flex-1 px-3.5 py-2.5 rounded-xl border border-border bg-card text-foreground text-sm font-mono select-all focus:outline-none focus:ring-2 focus:ring-primary/40 truncate"
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                    />
                    <button
                      type="button"
                      onClick={handleCopy}
                      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all cursor-pointer shadow-sm ${
                        copied
                          ? "bg-emerald-600 text-white"
                          : "bg-primary text-primary-foreground hover:bg-primary/90"
                      }`}
                    >
                      {copied ? (
                        <>
                          <Check className="size-4" />
                          <span>Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-4" />
                          <span>Copy Link</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* Direct Action Buttons */}
                <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
                  <Link
                    href={uploadedShare.shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-border bg-card hover:bg-accent text-foreground text-sm font-medium transition-colors cursor-pointer"
                  >
                    <ExternalLink className="size-4" />
                    <span>Open Download Page</span>
                  </Link>
                  <button
                    type="button"
                    onClick={handleReset}
                    className="w-full sm:flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-foreground text-background hover:opacity-90 text-sm font-medium transition-opacity cursor-pointer"
                  >
                    <Sparkles className="size-4" />
                    <span>Upload Another File</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
