"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle, FileUp, RefreshCw } from "lucide-react";
import Button from "@/components/arc/button/button";

export default function DocumentWorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Document Workspace Error]:", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="max-w-md w-full text-center p-8 rounded-2xl bg-card border border-border shadow-xl">
        <div className="size-16 mx-auto mb-5 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center">
          <AlertCircle className="size-8" />
        </div>

        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground mb-2">
          Unable to Open Document
        </h1>

        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          {error?.message || "This PDF document could not be rendered or may have expired. Please try uploading it again."}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            variant="primary"
            size="md"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2"
            onClick={() => reset()}
          >
            <RefreshCw className="size-4" />
            <span>Retry</span>
          </Button>

          <Link href="/" className="w-full sm:w-auto">
            <Button
              variant="secondary"
              size="md"
              className="w-full inline-flex items-center justify-center gap-2"
            >
              <FileUp className="size-4" />
              <span>Upload New PDF</span>
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
