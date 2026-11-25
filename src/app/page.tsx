"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ActionButton from "@/components/arc/action-button/action-button";
import FileDropzone from "@/components/arc/file-dropzone/file-dropzone";
import type { FileDropzoneUpload } from "@/components/arc/file-dropzone/file-dropzone";
import { SiteHeader } from "@/components/site-header";
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

  const uploadFile: FileDropzoneUpload = (item, { onProgress, signal }) =>
    new Promise((resolve, reject) => {
      if (!item.file) {
        reject(new Error("The selected file could not be read."));
        return;
      }

      const formData = new FormData();
      formData.set("file", item.file);

      const request = new XMLHttpRequest();
      request.open("POST", "/api/documents");
      request.responseType = "json";
      request.timeout = 180_000;

      const removeAbortListener = () => signal.removeEventListener("abort", abortRequest);
      const abortRequest = () => request.abort();

      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
      };
      request.onload = () => {
        removeAbortListener();
        const response = request.response as (UploadedDocument & { error?: string }) | null;
        if (request.status >= 200 && request.status < 300 && response?.id) {
          setUploadedDocument(response);
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
            onFilesChange={() => {
              setUploadedDocument(null);
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
    </div>
  );
}
