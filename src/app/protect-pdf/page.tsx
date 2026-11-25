"use client";

import { useId, useMemo, useState } from "react";
import Button from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import FileDropzone, { formatFileSize } from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import { SiteHeader } from "@/components/site-header";
import {
  ProtectPdfDropzoneIcon,
  PdfFileBadgeIcon,
} from "@/components/ui/convert-icons";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Pencil,
  Shield,
  ShieldCheck,
  X,
} from "lucide-react";
import styles from "../home.module.css";

const MAX_PDF_SIZE = 100 * 1024 * 1024; // 100 MB

type SelectedPdfItem = {
  id: string;
  file: File;
};

type ProtectResult = {
  id: string;
  filename: string;
  originalSize: number;
  outputSize: number;
  pageCount: number;
  algorithm: string;
  downloadUrl: string;
};

function calculatePasswordStrength(pwd: string): {
  score: number;
  label: "Too short" | "Weak" | "Fair" | "Strong";
  color: string;
} {
  if (!pwd || pwd.length < 4) {
    return { score: 10, label: "Too short", color: "bg-red-500" };
  }
  let score = 25;
  if (pwd.length >= 8) score += 25;
  if (/[0-9]/.test(pwd)) score += 20;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score += 20;
  if (/[^a-zA-Z0-9]/.test(pwd)) score += 10;

  if (score < 40) return { score: 35, label: "Weak", color: "bg-amber-500" };
  if (score < 75) return { score: 65, label: "Fair", color: "bg-yellow-500" };
  return { score: 100, label: "Strong", color: "bg-emerald-500" };
}

export default function ProtectPdfPage() {
  const passwordInputId = useId();
  const confirmPasswordInputId = useId();

  const [selectedDoc, setSelectedDoc] = useState<SelectedPdfItem | null>(null);

  // Password popup state
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Advanced security permissions
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [allowPrinting, setAllowPrinting] = useState(true);
  const [allowCopying, setAllowCopying] = useState(true);
  const [allowModifying, setAllowModifying] = useState(false);

  // Protect execution state
  const [protecting, setProtecting] = useState(false);
  const [protectError, setProtectError] = useState<string | null>(null);

  // Result dialog state
  const [protectResult, setProtectResult] = useState<ProtectResult | null>(null);
  const [isSuccessDialogOpen, setIsSuccessDialogOpen] = useState(false);
  const [customFileName, setCustomFileName] = useState("");

  const pwdStrength = useMemo(() => calculatePasswordStrength(password), [password]);

  const uploadFile: FileDropzoneUpload = (item, { onProgress }) =>
    new Promise((resolve, reject) => {
      if (!item.file) {
        reject(new Error("The selected file could not be read."));
        return;
      }

      setProtectError(null);
      setPasswordError(null);
      setProtectResult(null);
      setPassword("");
      setConfirmPassword("");

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
    setConfirmPassword("");
    setPasswordError(null);
    setProtectError(null);
    setProtectResult(null);
    setIsPasswordModalOpen(false);
  };

  const openPasswordModal = () => {
    if (!selectedDoc) return;
    setPasswordError(null);
    setProtectError(null);
    setIsPasswordModalOpen(true);
  };

  const handleProtect = async () => {
    if (!selectedDoc || protecting) return;

    // Validate passwords
    if (!password) {
      setPasswordError("Please enter a password to protect your PDF.");
      return;
    }

    if (password.length < 3) {
      setPasswordError("Password must be at least 3 characters long.");
      return;
    }

    if (password !== confirmPassword) {
      setPasswordError("Passwords do not match. Please verify your password.");
      return;
    }

    setPasswordError(null);
    setProtectError(null);
    setProtecting(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedDoc.file);
      formData.append("password", password);
      formData.append("allowPrinting", String(allowPrinting));
      formData.append("allowCopying", String(allowCopying));
      formData.append("allowModifying", String(allowModifying));

      const response = await fetch("/api/documents/protect-pdf", {
        method: "POST",
        body: formData,
      });

      const data = await response.json();
      if (!response.ok) {
        if (data.code === "ALREADY_ENCRYPTED") {
          throw new Error("This PDF is already encrypted with a password. Please unlock it first using Unlock PDF.");
        }
        throw new Error(data.error || "Failed to protect PDF. Please try again.");
      }

      setProtectResult(data);
      const baseName = data.filename.replace(/\.pdf$/i, "") || "protected-document";
      setCustomFileName(baseName);

      // Close password popup and open success dialog
      setIsPasswordModalOpen(false);
      setIsSuccessDialogOpen(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to protect PDF.";
      setPasswordError(message);
      setProtectError(message);
    } finally {
      setProtecting(false);
    }
  };

  const handleReset = () => {
    setIsSuccessDialogOpen(false);
    setIsPasswordModalOpen(false);
    setSelectedDoc(null);
    setPassword("");
    setConfirmPassword("");
    setPasswordError(null);
    setProtectResult(null);
    setCustomFileName("");
    setProtectError(null);
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
            Protect PDF
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground max-w-lg mx-auto leading-relaxed">
            Encrypt your PDF with a strong password to prevent unauthorized access.
          </p>
        </div>

        {/* Center File Dropzone with Protect PDF Icon */}
        <div className={styles.uploader}>
          <FileDropzone
            className={styles.dropzone}
            borderless
            accept="application/pdf,.pdf"
            multiple={false}
            maxFiles={1}
            maxSize={MAX_PDF_SIZE}
            icon={<ProtectPdfDropzoneIcon className="w-16 h-16 sm:w-20 sm:h-20" />}
            label="Drop your PDF file here to protect"
            description="or click to browse from your device"
            note="PDF only · Up to 100 MB"
            dropLabel="Release to protect PDF"
            onUpload={uploadFile}
            onFilesChange={(files) => {
              if (files.length === 0) {
                setSelectedDoc(null);
                setPassword("");
                setConfirmPassword("");
                setPasswordError(null);
                setProtectError(null);
                setProtectResult(null);
              }
            }}
          />

          {protectError && (
            <div className="mt-4 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm text-center">
              {protectError}
            </div>
          )}

          {/* Selected PDF Document Preview and Action Area */}
          {selectedDoc && (
            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
                  <Shield className="size-3.5 text-emerald-500" />
                  <span>Selected Document</span>
                </div>
                <button
                  type="button"
                  onClick={removeDoc}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors font-medium flex items-center gap-1 cursor-pointer"
                >
                  <X className="size-3" />
                  Remove file
                </button>
              </div>

              {/* Single File Card */}
              <div className="flex items-center gap-3.5 p-3.5 rounded-2xl bg-card border border-border/80 shadow-xs">
                <PdfFileBadgeIcon className="size-11 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate text-foreground leading-snug">
                    {selectedDoc.file.name}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      {formatFileSize(selectedDoc.file.size)}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-medium">
                      Ready to Protect
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={removeDoc}
                  className="size-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
                  title="Remove file"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Protect PDF Action Button */}
              <div className="pt-2">
                <Button
                  variant="primary"
                  className="w-full h-11 text-sm font-semibold shadow-md flex items-center justify-center gap-2 cursor-pointer"
                  onClick={openPasswordModal}
                >
                  <Lock className="size-4" />
                  Protect PDF
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 1. PASSWORD POPUP MODAL DIALOG */}
      <Dialog open={isPasswordModalOpen} onOpenChange={setIsPasswordModalOpen}>
        <DialogContent
          title="Protect PDF with Password"
          description="Set a password to encrypt this document. Anyone opening the file will be required to enter this password."
          className="max-w-md w-full"
        >
          <div className="space-y-4 pt-1">
            {/* Header Icon + Document Details */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/40 border border-border/50">
              <div className="size-9 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
                <KeyRound className="size-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-muted-foreground">Target File</p>
                <p className="text-sm font-semibold text-foreground truncate">
                  {selectedDoc?.file.name}
                </p>
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-1.5">
              <label
                htmlFor={passwordInputId}
                className="text-xs font-semibold text-foreground flex items-center justify-between"
              >
                <span>Password</span>
                {password.length > 0 && (
                  <span className={`text-[10px] font-medium px-1.5 py-0.2 rounded ${pwdStrength.label === "Strong" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                    {pwdStrength.label}
                  </span>
                )}
              </label>
              <div className="relative">
                <input
                  id={passwordInputId}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError(null);
                  }}
                  placeholder="Enter document password"
                  autoFocus
                  className="w-full h-10 px-3 pr-10 text-sm rounded-lg border border-border bg-background focus:outline-hidden focus:ring-2 focus:ring-primary/40 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 cursor-pointer"
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>

              {/* Password strength bar */}
              {password.length > 0 && (
                <div className="w-full bg-muted rounded-full h-1 mt-1 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${pwdStrength.color}`}
                    style={{ width: `${pwdStrength.score}%` }}
                  />
                </div>
              )}
            </div>

            {/* Confirm Password Input */}
            <div className="space-y-1.5">
              <label
                htmlFor={confirmPasswordInputId}
                className="text-xs font-semibold text-foreground"
              >
                Confirm Password
              </label>
              <div className="relative">
                <input
                  id={confirmPasswordInputId}
                  type={showConfirmPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setPasswordError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      handleProtect();
                    }
                  }}
                  placeholder="Re-enter password"
                  className="w-full h-10 px-3 pr-10 text-sm rounded-lg border border-border bg-background focus:outline-hidden focus:ring-2 focus:ring-primary/40 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1 cursor-pointer"
                  title={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>

            {/* Optional Advanced Permissions Accordion */}
            <div className="border border-border/60 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="w-full flex items-center justify-between p-2.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-muted/20 hover:bg-muted/40 transition-colors cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5" />
                  Security Options (256-bit AES)
                </span>
                {showAdvanced ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>

              {showAdvanced && (
                <div className="p-3 space-y-2.5 bg-background text-xs border-t border-border/40">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={allowPrinting}
                      onChange={(e) => setAllowPrinting(e.target.checked)}
                      className="rounded border-border text-primary focus:ring-primary/40 size-3.5"
                    />
                    <span>Allow Printing</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={allowCopying}
                      onChange={(e) => setAllowCopying(e.target.checked)}
                      className="rounded border-border text-primary focus:ring-primary/40 size-3.5"
                    />
                    <span>Allow Copying Text & Images</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={allowModifying}
                      onChange={(e) => setAllowModifying(e.target.checked)}
                      className="rounded border-border text-primary focus:ring-primary/40 size-3.5"
                    />
                    <span>Allow Modifying & Editing</span>
                  </label>
                </div>
              )}
            </div>

            {/* Error Message inside Popup */}
            {passwordError && (
              <div className="p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs leading-relaxed">
                {passwordError}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setIsPasswordModalOpen(false)}
                disabled={protecting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="gap-2 cursor-pointer"
                onClick={handleProtect}
                disabled={protecting || !password}
                loading={protecting}
              >
                <Lock className="size-3.5" />
                Set Password & Protect
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 2. SUCCESS / RESULT DIALOG */}
      <Dialog open={isSuccessDialogOpen} onOpenChange={setIsSuccessDialogOpen}>
        <DialogContent
          title="PDF Protected Successfully"
          description="Your PDF is now securely encrypted with 256-bit AES standard protection."
          className="max-w-md w-full"
        >
          <div className="space-y-4 pt-1">
            {/* Success Check Banner */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div className="text-xs">
                <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                  Password protection applied
                </p>
                <p className="text-emerald-600/90 dark:text-emerald-400/90">
                  Opening this file requires your chosen password.
                </p>
              </div>
            </div>

            {/* Protected Document Details */}
            {protectResult && (
              <div className="p-3.5 rounded-2xl bg-card border border-border/80 shadow-xs space-y-3">
                <div className="flex items-center gap-3">
                  <PdfFileBadgeIcon className="size-11 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">Protected File</p>
                    <p className="text-sm font-semibold truncate text-foreground">
                      {protectResult.filename}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {formatFileSize(protectResult.outputSize)} · {protectResult.pageCount} {protectResult.pageCount === 1 ? "page" : "pages"} · {protectResult.algorithm}
                    </p>
                  </div>
                </div>

                {/* Editable file name */}
                <div className="pt-1 border-t border-border/40">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <input
                        type="text"
                        value={customFileName}
                        onChange={(e) => setCustomFileName(e.target.value)}
                        placeholder="File name"
                        className="w-full h-8 px-2.5 text-xs rounded-md border border-border bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/40 font-mono"
                      />
                      <Pencil className="size-3 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                    <span className="text-xs text-muted-foreground font-mono">.pdf</span>
                  </div>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="space-y-2 pt-2">
              {protectResult && (
                <Button
                  variant="primary"
                  className="w-full h-10 text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer"
                  onClick={() => {
                    const finalName = customFileName.trim()
                      ? customFileName.trim().endsWith(".pdf")
                        ? customFileName.trim()
                        : `${customFileName.trim()}.pdf`
                      : protectResult.filename;
                    const url = `${protectResult.downloadUrl}&name=${encodeURIComponent(finalName)}`;
                    downloadFile(url, finalName);
                  }}
                >
                  <Download className="size-4" />
                  Download Protected PDF
                </Button>
              )}

              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                  onClick={handleReset}
                >
                  Protect Another PDF
                </Button>
                {protectResult && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="text-xs cursor-pointer"
                    onClick={() => {
                      window.open(`/workspace?id=${protectResult.id}`, "_blank");
                    }}
                  >
                    Open in Workspace
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
