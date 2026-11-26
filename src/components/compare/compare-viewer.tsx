"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Button from "@/components/arc/button/button";
import type { ComparisonResult, DiffBox } from "./pdf-diff-engine";
import { comparePdfDocuments } from "./pdf-diff-engine";
import { ArrowLeft, ChevronLeft, ChevronRight, AlertCircle } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import styles from "./compare.module.css";

interface CompareViewerProps {
  file1: File;
  file2: File;
  onReset: () => void;
}

export function CompareViewer({ file1, file2, onReset }: CompareViewerProps) {
  const [loading, setLoading] = useState(true);
  const [progressPercent, setProgressPercent] = useState(10);
  const [progressStatus, setProgressStatus] = useState("Analyzing documents...");
  const [error, setError] = useState<string | null>(null);

  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [documentsReady, setDocumentsReady] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [renderedPreview, setRenderedPreview] = useState<{ file1: File; file2: File; page: number } | null>(null);

  const canvas1Ref = useRef<HTMLCanvasElement | null>(null);
  const canvas2Ref = useRef<HTMLCanvasElement | null>(null);

  const doc1ProxyRef = useRef<PDFDocumentProxy | null>(null);
  const doc2ProxyRef = useRef<PDFDocumentProxy | null>(null);
  const renderTasksRef = useRef<RenderTask[]>([]);
  const renderRequestRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      for (const task of renderTasksRef.current) task.cancel();
      renderTasksRef.current = [];
    };
  }, []);

  // Run the diff comparison on mount
  useEffect(() => {
    let isCancelled = false;

    async function runComparison() {
      setLoading(true);
      setError(null);

      try {
        const result = await comparePdfDocuments(file1, file2, (pct, status) => {
          if (!isCancelled) {
            setProgressPercent(pct);
            setProgressStatus(status);
          }
        });

        if (!isCancelled) {
          setComparison(result);
          setCurrentPage(1);
          setLoading(false);
        }
      } catch (err) {
        if (!isCancelled) {
          setError(err instanceof Error ? err.message : "Failed to compare PDF documents.");
          setLoading(false);
        }
      }
    }

    runComparison();

    return () => {
      isCancelled = true;
    };
  }, [file1, file2]);

  // Load PDF Document proxies for active page rendering
  useEffect(() => {
    let isCancelled = false;

    async function loadProxies() {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const [bytes1, bytes2] = await Promise.all([file1.arrayBuffer(), file2.arrayBuffer()]);

        const [p1, p2] = await Promise.all([
          pdfjs.getDocument({ data: bytes1 }).promise,
          pdfjs.getDocument({ data: bytes2 }).promise,
        ]);

        if (isCancelled) return;

        doc1ProxyRef.current = p1;
        doc2ProxyRef.current = p2;
        setDocumentsReady(true);
        setPreviewError(null);
      } catch (e) {
        console.error("Failed to load PDF proxies for rendering", e);
        if (!isCancelled) {
          setPreviewError("Could not load the PDF previews. Please try uploading the files again.");
        }
      }
    }

    loadProxies();

    return () => {
      isCancelled = true;
    };
  }, [file1, file2]);

  // Render current page onto both canvases at crisp high resolution
  const renderCurrentPage = useCallback(async () => {
    const renderRequest = ++renderRequestRef.current;

    const previousTasks = renderTasksRef.current;
    renderTasksRef.current = [];
    for (const task of previousTasks) task.cancel();
    await Promise.allSettled(previousTasks.map((task) => task.promise));

    if (renderRequest !== renderRequestRef.current || !isMountedRef.current || !documentsReady) return;

    const d1 = doc1ProxyRef.current;
    const d2 = doc2ProxyRef.current;
    if (!d1 || !d2) return;
    const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    const renderScale = 1.6 * dpr;

    try {
      const [page1, page2]: [PDFPageProxy | null, PDFPageProxy | null] = await Promise.all([
        currentPage <= d1.numPages ? d1.getPage(currentPage) : Promise.resolve(null),
        currentPage <= d2.numPages ? d2.getPage(currentPage) : Promise.resolve(null),
      ]);
      if (renderRequest !== renderRequestRef.current || !isMountedRef.current) return;

      const tasks: RenderTask[] = [];
      const renderPage = (page: PDFPageProxy | null, canvas: HTMLCanvasElement | null, missingPageLabel: string) => {
        if (!canvas) return;

        if (page) {
          const viewport = page.getViewport({ scale: renderScale });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not create a canvas for the PDF preview.");
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          tasks.push(page.render({ canvas, canvasContext: context, viewport }));
          return;
        }

        canvas.width = 600 * dpr;
        canvas.height = 800 * dpr;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Could not create a canvas for the PDF preview.");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "#94a3b8";
        context.font = `${16 * dpr}px system-ui, sans-serif`;
        context.textAlign = "center";
        context.fillText(missingPageLabel, canvas.width / 2, canvas.height / 2);
      };

      renderPage(page1, canvas1Ref.current, `No page ${currentPage} in original document`);
      renderPage(page2, canvas2Ref.current, `No page ${currentPage} in modified document`);
      renderTasksRef.current = tasks;
      const renderResults = await Promise.allSettled(tasks.map((task) => task.promise));
      const failedRender = renderResults.find((result) => result.status === "rejected");
      if (failedRender?.status === "rejected") throw failedRender.reason;

      if (renderRequest === renderRequestRef.current && isMountedRef.current) {
        setRenderedPreview({ file1, file2, page: currentPage });
        setPreviewError(null);
      }
    } catch (err) {
      if (renderRequest === renderRequestRef.current && isMountedRef.current) {
        setPreviewError(err instanceof Error ? err.message : "Could not render the PDF previews.");
      }
    } finally {
      if (renderRequest === renderRequestRef.current) renderTasksRef.current = [];
    }
  }, [currentPage, documentsReady, file1, file2]);

  const previewIsCurrent =
    renderedPreview?.file1 === file1 &&
    renderedPreview.file2 === file2 &&
    renderedPreview.page === currentPage;

  useEffect(() => {
    if (loading || !comparison || !documentsReady) return;

    const frameId = window.requestAnimationFrame(() => {
      void renderCurrentPage();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [loading, comparison, documentsReady, currentPage, renderCurrentPage]);

  const pageData = comparison?.pages.find((p) => p.pageNumber === currentPage);

  if (loading) {
    return (
      <div className="w-full max-w-lg mx-auto py-20 px-4 flex flex-col items-center justify-center text-center space-y-6">
        <div className="size-12 rounded-full border-3 border-purple-600 border-t-transparent animate-spin" />
        <div className="space-y-2">
          <h3 className="text-lg font-bold text-foreground">Comparing Documents</h3>
          <p className="text-sm text-muted-foreground">{progressStatus}</p>
        </div>
        <div className="w-64 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-purple-600 transition-all duration-300 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <p className="text-xs text-muted-foreground">{progressPercent}% complete</p>
      </div>
    );
  }

  if (error || !comparison) {
    return (
      <div className="w-full max-w-md mx-auto py-16 px-4 flex flex-col items-center text-center space-y-4">
        <div className="size-14 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
          <AlertCircle className="size-7" />
        </div>
        <h3 className="text-lg font-bold text-foreground">Comparison Error</h3>
        <p className="text-sm text-muted-foreground">{error || "Could not compare the provided documents."}</p>
        <Button variant="secondary" onClick={onReset} className="mt-4">
          <ArrowLeft className="size-4 mr-2" /> Try Again
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.viewerWrapper}>
      {/* Clean Minimal Top Navigation Bar (No bulky zoom/highlight bar) */}
      <div className={styles.viewerNav}>
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onReset} title="Upload different files">
            <ArrowLeft className="size-4 mr-1.5" /> Back
          </Button>

          <span
            className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${
              comparison.totalDifferences === 0
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
                : "bg-purple-500/10 text-purple-600 border-purple-500/20"
            }`}
          >
            {comparison.totalDifferences === 0
              ? "Identical"
              : `${comparison.totalDifferences} Differences`}
          </span>
        </div>

        {/* Multi-page Navigation */}
        {comparison.totalPages > 1 && (
          <div className="flex items-center gap-2 bg-muted/50 px-2 py-0.5 rounded-full border border-border/50">
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              className="size-7 p-0"
              title="Previous Page"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs font-semibold px-2 text-foreground">
              Page {currentPage} of {comparison.totalPages}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage >= comparison.totalPages}
              onClick={() => setCurrentPage((p) => Math.min(comparison.totalPages, p + 1))}
              className="size-7 p-0"
              title="Next Page"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        )}

        {/* Legend indicator */}
        <div className="flex items-center gap-3 text-xs font-medium">
          <span className="flex items-center gap-1.5 text-rose-500">
            <span className="size-2 rounded-full bg-rose-500" /> Removed
          </span>
          <span className="flex items-center gap-1.5 text-amber-500">
            <span className="size-2 rounded-full bg-amber-500" /> Modified
          </span>
          <span className="flex items-center gap-1.5 text-emerald-500">
            <span className="size-2 rounded-full bg-emerald-500" /> Added
          </span>
        </div>
      </div>

      {previewError && (
        <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive" role="alert">
          {previewError}
        </div>
      )}

      {/* Side-by-Side 2 PDF Previews (Full width, clean background, no grey box) */}
      <div className={styles.splitViewContainer}>
        {/* Left Column: Original Document */}
        <div className={styles.docColumn}>
          <div className={styles.docColumnHeader}>
            <div className="flex items-center gap-2 min-w-0">
              <span className={styles.badgeBefore}>Original</span>
              <span className="text-xs font-semibold truncate text-foreground" title={file1.name}>
                {file1.name}
              </span>
            </div>
          </div>

          <div className={styles.canvasWrapper}>
            <canvas ref={canvas1Ref} />

            {/* Difference Highlight Overlays for Document 1 */}
            <div className={styles.highlightLayer}>
              {previewIsCurrent && pageData?.diffsDoc1.map((box: DiffBox) => (
                <div
                  key={box.id}
                  className={box.type === "modified" ? styles.diffHighlightModified : styles.diffHighlightDeleted}
                  style={{
                    left: `${box.x}%`,
                    top: `${box.y}%`,
                    width: `${box.width}%`,
                    height: `${box.height}%`,
                  }}
                  title={box.text ? `Removed: "${box.text}"` : box.type === "modified" ? "Changed visual content" : "Removed visual content"}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Modified Document */}
        <div className={styles.docColumn}>
          <div className={styles.docColumnHeader}>
            <div className="flex items-center gap-2 min-w-0">
              <span className={styles.badgeAfter}>Modified</span>
              <span className="text-xs font-semibold truncate text-foreground" title={file2.name}>
                {file2.name}
              </span>
            </div>
          </div>

          <div className={styles.canvasWrapper}>
            <canvas ref={canvas2Ref} />

            {/* Difference Highlight Overlays for Document 2 */}
            <div className={styles.highlightLayer}>
              {previewIsCurrent && pageData?.diffsDoc2.map((box: DiffBox) => (
                <div
                  key={box.id}
                  className={box.type === "modified" ? styles.diffHighlightModified : styles.diffHighlightAdded}
                  style={{
                    left: `${box.x}%`,
                    top: `${box.y}%`,
                    width: `${box.width}%`,
                    height: `${box.height}%`,
                  }}
                  title={box.text ? `Added: "${box.text}"` : box.type === "modified" ? "Changed visual content" : "Added visual content"}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
