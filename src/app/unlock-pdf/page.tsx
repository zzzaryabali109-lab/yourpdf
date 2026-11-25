"use client";

import { useState } from "react";
import ActionButton from "@/components/arc/action-button/action-button";
import Button from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import FileDropzone, { formatFileSize } from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import { SiteHeader } from "@/components/site-header";
import {
  UnlockPdfDropzoneIcon,
  PdfFileBadgeIcon,
} from "@/components/ui/convert-icons";
import { CheckCircle2, Download, Eye, EyeOff, KeyRound, Lock, Pencil, ShieldCheck, X } from "lucide-react";
import styles from "../home.module.css";

const MAX_PDF_SIZE = 100 * 1024 * 1024; // 100 MB

type SelectedPdfItem = {
  id: string;
  file: File;
};

type UnlockResult = {
  id: string;
  filename: string;
  originalSize: number;
  outputSize: number;
  pageCount: number;
  wasEncrypted: boolean;
  restrictionsRemoved: boolean;
  downloadUrl: string;
};

export default function UnlockPdfPage() {
  const [selectedDoc, setSelectedDoc] = useState<SelectedPdfItem | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [unlockResult, setUnlockResult] = useState<UnlockResult | null>(null);
  const [customFileName, setCustomFileName] = useState("");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  const uploadFile: FileDropzoneUpload = (item, { onProgress }) =>
    new Promise((resolve, reject) => {
      if (!item.file) {
        reject(new Error("The selected file could not be read."));
        return;
      }

      setUnlockError(null);
      setUnlockResult(null);
      setPasswordRequired(false);
      setPassword("");

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

  const removeDoc = () => {
    setSelectedDoc(null);
    setPassword("");
    setPasswordRequired(false);
    setUnlockError(null);
    setUnlockResult(null);
  };

  const handleUnlock = async () => {
    if (!selectedDoc || unlocking) return;
    setUnlocking(true);
    setUnlockError(null);

    try {
      const formData = new FormData();
      formData.append("file", selectedDoc.file);
      if (password.trim()) {
        formData.append("password", password.trim());
      }

      const response = await fetch("/api/documents/unlock-pdf", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        if (data.code === "PASSWORD_REQUIRED") {
          setPasswordRequired(true);
          throw new Error("This PDF has an open password. Please enter the password below to unlock it.");
        }
        if (data.code === "INVALID_PASSWORD") {
          setPasswordRequired(true);
          throw new Error("Incorrect password. Please enter the correct password to unlock this PDF.");
        }
        throw new Error(data.error || "Failed to unlock PDF. Please try again.");
      }

      setUnlockResult(data);
      const baseName = data.filename.replace(/\.pdf$/i, "") || "unlocked-document";
      setCustomFileName(baseName);
      setIsDialogOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to unlock PDF.";
      setUnlockError(message);
    } finally {
      setUnlocking(false);
    }
  };

  const handleReset = () => {
    setIsDialogOpen(false);
    setSelectedDoc(null);
    setPassword("");
    setPasswordRequired(false);
    setUnlockResult(null);
    setCustomFileName("");
    setUnlockError(null);
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
            Unlock PDF
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Remove PDF passwords, encryption, and printing/copying restrictions instantly.
          </p>
        </div>

        {/* Center File Dropzone with Unlock PDF Icon */}
        <div className={styles.uploader}>
          <FileDropzone
            className={styles.dropzone}
            borderless
            accept="application/pdf,.pdf"
            multiple={false}
            maxFiles={1}
            maxSize={MAX_PDF_SIZE}
            icon={<UnlockPdfDropzoneIcon className="w-16 h-16 sm:w-20 sm:h-20" />}
            label="Drop your PDF file here to unlock"
            description="or click to browse from your device"
            note="PDF only · Up to 100 MB"
            dropLabel="Release to unlock PDF"
            onUpload={uploadFile}
            onFilesChange={(files) => {
              if (files.length === 0) {
                setSelectedDoc(null);
                setPassword("");
                setPasswordRequired(false);
                setUnlockError(null);
                setUnlockResult(null);
              }
            }}
          />

          {unlockError && (
            <div className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">
              {unlockError}
            </div>
          )}

          {/* Selected PDF Document Preview and Action Area */}
          {selectedDoc && (
            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Lock className="size-3.5 text-rose-500" />
                  <span>PDF selected to unlock and remove restrictions</span>
                </div>
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                >
                  Clear
                </button>
              </div>

              {/* Document Card */}
              <div className="relative group flex items-center gap-3 p-3 rounded-xl bg-card border border-border/80 shadow-xs">
                <PdfFileBadgeIcon className="size-11 shrink-0" />
                <div className="min-w-0 flex-1 pr-6">
                  <p className="text-sm font-semibold truncate text-foreground" title={selectedDoc.file.name}>
                    {selectedDoc.file.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(selectedDoc.file.size)} · PDF Document
                  </p>
                </div>
                <button
                  type="button"
                  onClick={removeDoc}
                  className="absolute top-2.5 right-2.5 size-6 flex items-center justify-center rounded-full bg-muted/80 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors cursor-pointer"
                  title="Remove document"
                >
                  <X className="size-3.5" />
                </button>
              </div>

              {/* Optional/Required Password Input Field */}
              <div className={`p-3.5 rounded-xl border transition-all ${
                passwordRequired
                  ? "bg-rose-500/10 border-rose-500/40"
                  : "bg-muted/30 border-border/60"
              }`}>
                <div className="flex items-center justify-between mb-2">
                  <label
                    htmlFor="pdf-password-input"
                    className="flex items-center gap-1.5 text-xs font-semibold text-foreground"
                  >
                    <KeyRound className={`size-3.5 ${passwordRequired ? "text-rose-500" : "text-muted-foreground"}`} />
                    <span>Password {passwordRequired ? "(Required)" : "(Optional)"}</span>
                  </label>
                  <span className="text-[11px] text-muted-foreground">
                    {passwordRequired ? "Encrypted PDF" : "Leave blank if no open password"}
                  </span>
                </div>

                <div className="relative flex items-center">
                  <input
                    id="pdf-password-input"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={passwordRequired ? "Enter document password..." : "Enter password (if file is password-locked)..."}
                    className="w-full h-10 px-3 pr-10 text-sm rounded-lg border border-input bg-background text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring/30 transition-all"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 p-1 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    title={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground mt-2 leading-relaxed">
                  Permissions restrictions (printing, text copying, modifying) are stripped automatically.
                </p>
              </div>

              {/* Action Button */}
              <div className={styles.processAction}>
                <ActionButton
                  label="Unlock PDF"
                  pendingLabel="Removing Restrictions..."
                  successLabel="Unlocked"
                  onAction={handleUnlock}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Result Dialog Modal Popup */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent
          title="PDF Unlocked Successfully"
          description="Your file is now completely decrypted and restriction-free."
          className="sm:max-w-[440px]"
        >
          {unlockResult && (() => {
            const finalDownloadName = `${customFileName.trim().replace(/\.pdf$/i, "") || "unlocked-document"}.pdf`;
            const downloadHref = unlockResult.downloadUrl
              ? `${unlockResult.downloadUrl}&name=${encodeURIComponent(finalDownloadName)}`
              : `/api/documents/${unlockResult.id}/file?download=1&name=${encodeURIComponent(finalDownloadName)}`;

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
                        {unlockResult.pageCount} {unlockResult.pageCount === 1 ? "page" : "pages"} · {formatFileSize(unlockResult.outputSize)}
                      </p>
                    </div>
                  </div>

                  {/* Summary Status pill */}
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs">
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 font-medium">
                      <ShieldCheck className="size-3.5" />
                      Status
                    </span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="size-3.5" />
                      All Restrictions Removed
                    </span>
                  </div>

                  {/* Permissions unlocked checklist */}
                  <div className="grid grid-cols-2 gap-1.5 p-2.5 rounded-lg bg-muted/40 border border-border/50 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                      ✓ Printing Allowed
                    </span>
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                      ✓ Text Copying Allowed
                    </span>
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                      ✓ Editing Unrestricted
                    </span>
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                      ✓ Password Cleared
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
                        placeholder="unlocked-document"
                        className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden"
                      />
                      <span className="text-xs text-muted-foreground font-mono select-none pl-1">.pdf</span>
                    </div>
                  </div>
                </div>

                {/* Download and Action buttons */}
                <div className="flex flex-col gap-2 pt-1">
                  <Button
                    type="button"
                    variant="primary"
                    className="w-full h-11 justify-center gap-2 text-sm font-semibold rounded-xl cursor-pointer bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => downloadFile(downloadHref, finalDownloadName)}
                  >
                    <Download className="size-4" />
                    Download Unlocked PDF
                  </Button>
                  <a
                    href={`/documents/${unlockResult.id}`}
                    className="w-full"
                  >
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full h-9 justify-center gap-2 text-xs font-medium rounded-xl"
                    >
                      <Pencil className="size-3.5" />
                      Edit in Workspace
                    </Button>
                  </a>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full h-9 justify-center text-xs text-muted-foreground hover:text-foreground rounded-xl"
                    onClick={handleReset}
                  >
                    Unlock Another PDF
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}
