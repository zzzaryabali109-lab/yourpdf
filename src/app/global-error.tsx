"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertOctagon, Home, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[Global Error Caught]:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center bg-background text-foreground font-sans p-4 m-0">
        <div className="max-w-md w-full text-center p-8 rounded-2xl bg-card border border-border shadow-2xl">
          <div className="size-16 mx-auto mb-6 rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center">
            <AlertOctagon className="size-8" />
          </div>

          <h1 className="text-2xl font-bold mb-3 tracking-tight">System Error</h1>
          <p className="text-sm text-muted-foreground mb-6 leading-relaxed">
            The application encountered a critical problem and could not render.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => reset()}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:opacity-90 transition-opacity cursor-pointer"
            >
              <RefreshCw className="size-4" />
              <span>Reload Application</span>
            </button>

            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-secondary text-secondary-foreground font-medium text-sm hover:bg-secondary/80 transition-colors"
            >
              <Home className="size-4" />
              <span>Go to Home</span>
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}

