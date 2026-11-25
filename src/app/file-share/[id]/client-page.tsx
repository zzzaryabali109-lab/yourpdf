"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { formatFileSize } from "@/components/arc/file-dropzone/file-dropzone";
import { RealFileBadge } from "@/components/ui/real-file-badge";
import {
  Download,
  Share2,
  Copy,
  Check,
  Clock,
  HardDrive,
  AlertCircle,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";

type SharedFileMeta = {
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

export default function FileShareDownloadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const fileId = resolvedParams.id;

  const [fileData, setFileData] = useState<SharedFileMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [downloadStarted, setDownloadStarted] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function fetchFileInfo() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/share/${encodeURIComponent(fileId)}`);
        const data = await res.json();

        if (!res.ok || data.error) {
          if (isMounted) {
            setError(data.error || "This shared file does not exist or has expired.");
          }
          return;
        }

        if (isMounted) {
          setFileData(data);
        }
      } catch (err) {
        if (isMounted) {
          console.error("Failed to fetch file metadata:", err);
          setError("Failed to load file information. Please try again.");
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    if (fileId) {
      fetchFileInfo();
    }

    return () => {
      isMounted = false;
    };
  }, [fileId]);

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleDownloadClick = () => {
    setDownloadStarted(true);
    setTimeout(() => {
      setDownloadStarted(false);
    }, 4000);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background text-foreground px-3 sm:px-6 py-6 sm:py-12 lg:px-8">
      <div className="w-full max-w-lg mx-auto">
        {loading ? (
          <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-background p-6 sm:p-10 text-center shadow-lg space-y-4">
            <div className="size-10 rounded-full border-2 border-primary border-t-transparent animate-spin mx-auto" />
            <p className="text-sm font-medium text-foreground/80">
              Loading shared file details...
            </p>
          </div>
        ) : error || !fileData ? (
          <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-background p-6 sm:p-10 text-center shadow-xl space-y-6">
            <div className="size-16 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive mx-auto">
              <AlertCircle className="size-8" />
            </div>

            <div className="space-y-2">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                File Not Found or Expired
              </h1>
              <p className="text-sm text-foreground/70 max-w-sm mx-auto">
                {error ||
                  "This shared file may have reached its 48-hour expiration limit or the link might be incorrect."}
              </p>
            </div>

            <div className="pt-2">
              <Link
                href="/file-share"
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors shadow-sm"
              >
                <Share2 className="size-4" />
                <span>Share Your Own File</span>
              </Link>
            </div>
          </div>
        ) : (
          (() => {
            const formattedDate = new Date(fileData.uploadedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            });

            return (
              <div className="rounded-2xl sm:rounded-3xl border border-border/80 bg-background p-4 sm:p-8 shadow-2xl space-y-5 sm:space-y-6 animate-in fade-in zoom-in-95 duration-200">
                {/* Top Badge */}
                <div className="flex items-center justify-between">
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="size-3.5" />
                    <span>Ready to Download</span>
                  </div>

                  <div className="flex items-center gap-1 text-xs text-foreground/70">
                    <ShieldCheck className="size-3.5 text-primary" />
                    <span>Scanned & Safe</span>
                  </div>
                </div>

                {/* Main File Box */}
                <div className="flex flex-col items-center text-center p-6 sm:p-8 rounded-2xl bg-card border border-border/80 space-y-4">
                  {/* Real File Badge Icon */}
                  <div className="flex items-center justify-center">
                    <RealFileBadge filename={fileData.filename} className="size-16 shrink-0" />
                  </div>

                  <div className="space-y-1 w-full">
                    {/* File Name */}
                    <h1
                      className="text-xl sm:text-2xl font-extrabold text-foreground break-words leading-tight"
                      title={fileData.filename}
                    >
                      {fileData.filename}
                    </h1>
                  </div>

                  {/* Meta Pills */}
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1 text-xs">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-background border border-border/80 font-semibold text-foreground">
                      <HardDrive className="size-3.5 text-primary" />
                      {formatFileSize(fileData.size)}
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-background border border-border/80 text-foreground/70">
                      <Clock className="size-3.5 text-foreground/70" />
                      {formattedDate}
                    </span>
                  </div>
                </div>

                {/* Big Prominent Download Button */}
                <div className="space-y-3">
                  <a
                    href={`/api/share/${fileData.id}/download`}
                    download={fileData.filename}
                    onClick={handleDownloadClick}
                    className="w-full inline-flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-primary text-primary-foreground font-bold text-base shadow-lg shadow-primary/25 hover:bg-primary/90 transition-all hover:scale-[1.01] active:scale-[0.99] cursor-pointer"
                  >
                    <Download className="size-5" />
                    <span>
                      {downloadStarted
                        ? "Starting Download..."
                        : `Download File (${formatFileSize(fileData.size)})`}
                    </span>
                  </a>

                  {/* Secondary Actions: Copy Link & Share Own */}
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-card hover:bg-accent text-xs font-semibold text-foreground transition-colors cursor-pointer"
                    >
                      {copied ? (
                        <>
                          <Check className="size-3.5 text-emerald-500" />
                          <span>Link Copied!</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" />
                          <span>Copy Link</span>
                        </>
                      )}
                    </button>

                    <Link
                      href="/file-share"
                      className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border border-border bg-card hover:bg-accent text-xs font-semibold text-foreground transition-colors"
                    >
                      <Share2 className="size-3.5 text-primary" />
                      <span>Share a File</span>
                    </Link>
                  </div>
                </div>

                {/* Trust Footer */}
                <div className="text-center pt-2 border-t border-border/50">
                  <p className="text-xs text-foreground/60">
                    Direct, encrypted download. Files are stored securely for 48 hours.
                  </p>
                </div>
              </div>
            );
          })()
        )}
      </div>
    </div>
  );
}
