"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import Button from "@/components/arc/button/button";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log client error securely for debugging
    console.error("[Application Error Caught]:", error);
  }, [error]);

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4 py-16">
      <div className="w-full max-w-md mx-auto text-center p-8 rounded-2xl bg-card border border-border shadow-xl shadow-black/5 dark:shadow-black/20 animate-in fade-in zoom-in-95 duration-200">
        <div className="size-14 mx-auto mb-5 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center">
          <AlertTriangle className="size-7" />
        </div>

        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground mb-2">
          Something went wrong
        </h1>

        <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
          An unexpected error occurred while processing your request. Please try again or return to the homepage.
        </p>

        {error?.message && (
          <div className="mb-6 p-3 rounded-xl bg-muted/60 border border-border/50 text-xs text-muted-foreground font-mono text-left break-words max-h-32 overflow-y-auto">
            {error.message}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            variant="primary"
            size="md"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2"
            onClick={() => reset()}
          >
            <RefreshCw className="size-4" />
            <span>Try Again</span>
          </Button>

          <Link href="/" className="w-full sm:w-auto">
            <Button
              variant="secondary"
              size="md"
              className="w-full inline-flex items-center justify-center gap-2"
            >
              <Home className="size-4" />
              <span>Back to Home</span>
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
