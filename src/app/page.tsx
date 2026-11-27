"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ActionButton from "@/components/arc/action-button/action-button";
import Button from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import FileDropzone, { formatFileSize } from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import { SiteHeader } from "@/components/site-header";
import { Lock, KeyRound, Eye, EyeOff, AlertCircle, Unlock, Loader2 } from "lucide-react";
import styles from "./home.module.css";

const MAX_DOCUMENT_SIZE = 100 * 1024 * 1024;

type UploadedDocument = {
  id: string;
  filename: string;
  size: number;
  uploadedAt: string;
};

export default function Home() {
  const router = useRouter();
  const [uploadedDocument, setUploadedDocument] = useState<UploadedDocument | null>(null);
  const [pendingProtectedFile, setPendingProtectedFile] = useState<File | null>(null);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [pdfPassword, setPdfPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const uploadFile: FileDropzoneUpload = (item, { onProgress, signal }) =>
    new Promise((resolve, reject) => {
      if (!item.file) {
        reject(new Error("The selected file could not be read."));
        return;
      }

      const file = item.file;
      const formData = new FormData();
      formData.set("file", file);

      const request = new XMLHttpRequest();
      request.open("POST", "/api/documents");
      request.responseType = "json";
      request.timeout = 300_000;

      const removeAbortListener = () => signal.removeEventListener("abort", abortRequest);
      const abortRequest = () => request.abort();

      request.upload.onprogress = (event) => {
        // Leave the final progress slice for server-side validation/storage.
        if (event.lengthComputable) onProgress(Math.min(95, (event.loaded / event.total) * 95));
      };
      request.onload = () => {
        removeAbortListener();
        const response = request.response as (UploadedDocument & { error?: string; code?: string }) | null;
        if (request.status >= 200 && request.status < 300 && response?.id) {
          setUploadedDocument(response);
          resolve();
          return;
        }
        if (response?.code === "PASSWORD_REQUIRED") {
          setPendingProtectedFile(file);
          setPdfPassword("");
          setPasswordError(null);
          setPasswordModalOpen(true);
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

  const handleUnlockAndOpen = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!pendingProtectedFile || !pdfPassword.trim() || isUnlocking) return;
    setIsUnlocking(true);
    setPasswordError(null);

    try {
      const formData = new FormData();
      formData.set("file", pendingProtectedFile);
      formData.set("password", pdfPassword.trim());

      const res = await fetch("/api/documents", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.code === "INVALID_PASSWORD") {
          setPasswordError("Incorrect password. Please enter the correct password.");
          return;
        }
        throw new Error(data.error || "Failed to unlock document.");
      }

      // Successfully unlocked! Close dialog and open directly in workspace!
      setPasswordModalOpen(false);
      setPendingProtectedFile(null);
      router.push(`/documents/${data.id}`);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Failed to unlock PDF.");
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleProcess = async () => {
    if (uploadedDocument) router.push(`/documents/${uploadedDocument.id}`);
  };

  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      {/* Top Navbar with Centered Nav & Top-Right Theme Toggle */}
      <SiteHeader />

      {/* Main Upload Dropzone */}
      <main className="flex-1 flex flex-col items-center justify-start pt-6 sm:pt-12 pb-12 sm:pb-16 px-3 sm:px-4">
        {/* PDF Edit Heading Section */}
        <div className="text-center max-w-xl mx-auto mb-6 space-y-2">
          <h1 className="text-2xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            Edit PDF & Word
          </h1>
          <p className="text-xs sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Upload your PDF or Word document (.docx, .doc) to edit text, annotate, organize pages, or convert files with ease — right in your browser.
          </p>
        </div>

        <div className={styles.uploader}>
          <FileDropzone
            className={styles.dropzone}
            borderless
            accept="application/pdf,.pdf,.docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword"
            multiple={false}
            maxFiles={1}
            maxSize={MAX_DOCUMENT_SIZE}
            label="Drop your PDF or Word document here"
            description="or click to browse files from your device"
            note="PDF, DOCX, DOC · Up to 100 MB"
            dropLabel="Release to edit your document"
            onUpload={uploadFile}
            onFilesChange={(files) => {
              if (files.length === 0) {
                setUploadedDocument(null);
                setPendingProtectedFile(null);
                setPasswordModalOpen(false);
                setPdfPassword("");
                setPasswordError(null);
              }
            }}
          />
          {uploadedDocument && (
            <div className={styles.processAction}>
              <ActionButton
                label="Process"
                pendingLabel="Opening"
                successLabel="Opening"
                onAction={handleProcess}
              />
            </div>
          )}
        </div>
      </main>

      {/* Password Required Modal Dialog */}
      <Dialog
        open={passwordModalOpen}
        onOpenChange={(open) => {
          if (!isUnlocking) {
            setPasswordModalOpen(open);
            if (!open) {
              setPendingProtectedFile(null);
              setPdfPassword("");
              setPasswordError(null);
            }
          }
        }}
      >
        <DialogContent
          title="Password Protected PDF"
          description="This PDF is protected with a password. Please enter the password to open and edit it in the workspace."
          className="sm:max-w-[420px]"
        >
          <form onSubmit={handleUnlockAndOpen} className="space-y-4 pt-1">
            {/* File info pill */}
            {pendingProtectedFile && (
              <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-muted/40 border border-border/60 text-xs">
                <Lock className="size-4 text-amber-500 shrink-0" />
                <span className="font-medium truncate text-foreground flex-1">
                  {pendingProtectedFile.name}
                </span>
                <span className="text-muted-foreground shrink-0">
                  {formatFileSize(pendingProtectedFile.size)}
                </span>
              </div>
            )}

            {/* Error Message if any */}
            {passwordError && (
              <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs flex items-center gap-2">
                <AlertCircle className="size-3.5 shrink-0" />
                <span>{passwordError}</span>
              </div>
            )}

            {/* Password input */}
            <div className="space-y-1.5">
              <label htmlFor="modal-pdf-password" className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <KeyRound className="size-3.5 text-muted-foreground" />
                <span>Document Password</span>
              </label>
              <div className="relative">
                <input
                  id="modal-pdf-password"
                  type={showPassword ? "text" : "password"}
                  value={pdfPassword}
                  onChange={(e) => setPdfPassword(e.target.value)}
                  placeholder="Enter PDF password"
                  autoFocus
                  disabled={isUnlocking}
                  className="w-full h-10 px-3 pr-10 text-sm rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors p-1 cursor-pointer"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Dialog Footer Actions */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPasswordModalOpen(false);
                  setPendingProtectedFile(null);
                  setPdfPassword("");
                  setPasswordError(null);
                }}
                disabled={isUnlocking}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={!pdfPassword.trim() || isUnlocking}
                className="gap-1.5 cursor-pointer"
              >
                {isUnlocking ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Unlocking...</span>
                  </>
                ) : (
                  <>
                    <Unlock className="size-3.5" />
                    <span>Unlock & Open</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
