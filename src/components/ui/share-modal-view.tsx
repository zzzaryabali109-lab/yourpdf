"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Button from "@/components/arc/button/button";
import { formatFileSize } from "@/components/arc/file-dropzone/file-dropzone";
import { RealFileBadge } from "@/components/ui/real-file-badge";
import { Check, Copy, ExternalLink, RotateCcw } from "lucide-react";

export interface ShareModalViewProps {
  filename: string;
  fileIcon?: ReactNode;
  fileSize?: number;
  downloadHref: string;
  onBackToDownload?: () => void;
  onReset?: () => void;
  resetLabel?: string;
}

type ShareResult = {
  id: string;
  filename: string;
  size: number;
  shareUrl: string;
  downloadUrl: string;
};

export function ShareModalView({
  filename,
  fileIcon,
  fileSize,
  downloadHref,
  onBackToDownload,
  onReset,
  resetLabel = "Convert Another Document",
}: ShareModalViewProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareResult, setShareResult] = useState<ShareResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let isCancelled = false;

    async function runUpload() {
      try {
        // Fetch file blob from downloadHref
        const res = await fetch(downloadHref);
        if (!res.ok) {
          throw new Error("Could not read the converted file for sharing.");
        }
        const blob = await res.blob();
        if (isCancelled) return;

        const ext = filename.toLowerCase().split(".").pop() ?? "";
        let mimeType = blob.type;
        if (!mimeType || mimeType === "application/octet-stream") {
          if (ext === "pdf") mimeType = "application/pdf";
          else if (["doc", "docx"].includes(ext)) mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
          else if (["xls", "xlsx"].includes(ext)) mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
          else if (["ppt", "pptx"].includes(ext)) mimeType = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
          else if (["jpg", "jpeg"].includes(ext)) mimeType = "image/jpeg";
          else if (ext === "png") mimeType = "image/png";
          else if (ext === "zip") mimeType = "application/zip";
        }

        const file = new File([blob], filename, { type: mimeType });
        const formData = new FormData();
        formData.set("file", file);

        const uploadRes = await fetch("/api/share", {
          method: "POST",
          body: formData,
        });

        const data = await uploadRes.json();
        if (isCancelled) return;

        if (!uploadRes.ok || data.error) {
          throw new Error(data.error || "Failed to generate share link.");
        }

        // Ensure shareUrl uses browser origin without 0.0.0.0
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const cleanOrigin = origin.replace(/^http:\/\/0\.0\.0\.0/, "http://localhost");
        const resolvedShareUrl = `${cleanOrigin}/file-share/${data.id}`;

        setShareResult({
          ...data,
          shareUrl: resolvedShareUrl,
        });
      } catch (err: unknown) {
        if (isCancelled) return;
        console.error("[ShareModalView Error]:", err);
        const msg = err instanceof Error ? err.message : "Failed to create share link.";
        setError(msg);
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    runUpload();

    return () => {
      isCancelled = true;
    };
  }, [downloadHref, filename, retryCount]);

  const handleCopy = async () => {
    if (!shareResult?.shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareResult.shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const input = document.getElementById("share-link-input-modal") as HTMLInputElement | null;
      if (input) {
        input.select();
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    }
  };

  return (
    <div className="space-y-4 pt-1">
      {loading ? (
        <div className="p-8 text-center space-y-3">
          <div className="size-8 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto" />
          <p className="text-xs text-foreground/70">Generating share link...</p>
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm space-y-3 text-center">
          <p>{error}</p>
          <div className="flex items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError(null);
                setRetryCount((c) => c + 1);
              }}
              className="px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground text-xs font-semibold cursor-pointer"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={onBackToDownload}
              className="px-3 py-1.5 rounded-lg border border-border text-xs font-semibold hover:bg-accent cursor-pointer"
            >
              Back to Download
            </button>
          </div>
        </div>
      ) : shareResult ? (
        <div className="space-y-4">
          {/* File info card with Real File Badge */}
          <div className="p-3.5 rounded-xl border border-border/80 bg-card flex items-center gap-3">
            {fileIcon ?? <RealFileBadge filename={shareResult.filename || filename} className="size-11 shrink-0" />}
            <div className="min-w-0 flex-1">
              <p
                className="text-sm font-bold truncate text-foreground"
                title={shareResult.filename || filename}
              >
                {shareResult.filename || filename}
              </p>
              <p className="text-xs text-foreground/70">
                {formatFileSize(shareResult.size || fileSize || 0)} · Valid for 48 hours
              </p>
            </div>
          </div>

          {/* Share Link input & copy */}
          <div className="space-y-1.5">
            <label
              htmlFor="share-link-input-modal"
              className="block text-[11px] font-semibold text-foreground uppercase tracking-wider"
            >
              Shareable Link
            </label>
            <div className="flex items-center gap-2">
              <input
                id="share-link-input-modal"
                type="text"
                readOnly
                value={shareResult.shareUrl}
                className="flex-1 px-3 py-2 rounded-xl border border-border bg-card text-foreground text-xs font-mono select-all focus:outline-none focus:ring-2 focus:ring-primary/40 truncate"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                type="button"
                onClick={handleCopy}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-medium text-xs transition-all cursor-pointer shadow-sm ${
                  copied
                    ? "bg-emerald-600 text-white"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
              >
                {copied ? (
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
            {onBackToDownload ? (
              <Button
                type="button"
                variant="secondary"
                className="flex-1 h-9 justify-center text-xs text-foreground/80 hover:text-foreground rounded-xl"
                onClick={onBackToDownload}
              >
                Back to Download
              </Button>
            ) : onReset ? (
              <Button
                type="button"
                variant="secondary"
                className="flex-1 h-9 justify-center text-xs text-foreground/80 hover:text-foreground rounded-xl"
                onClick={onReset}
              >
                {resetLabel || "Close"}
              </Button>
            ) : null}
          </div>

          {onBackToDownload && onReset && (
            <div className="pt-1">
              <Button
                type="button"
                variant="secondary"
                className="w-full h-8 justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground rounded-lg"
                onClick={onReset}
              >
                <RotateCcw className="size-3" />
                {resetLabel}
              </Button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
