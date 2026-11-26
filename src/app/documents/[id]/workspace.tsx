"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, CSSProperties, FormEvent as ReactFormEvent, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from "react";
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist";
import { useRouter } from "next/navigation";
import NextImage from "next/image";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FilePlus,
  FileText,
  ArrowRight,
  Circle,
  Eraser,
  Highlighter,
  Image as ImageIcon,
  Maximize,
  MessageSquarePlus,
  Minus,
  MousePointer2,
  PanelLeft,
  PanelRight,
  Pencil,
  PenLine,
  Plus,
  Printer,
  Shapes,
  Share2,
  Square,
  Stamp,
  Trash2,
  Search,
  Type,
  TextCursorInput,
  Undo2,
  Redo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Button from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { ShareModalView } from "@/components/ui/share-modal-view";
import ExpandingButtonGroup from "@/components/arc/expanding-button-group/expanding-button-group";
import type { ExpandingButtonGroupItem } from "@/components/arc/expanding-button-group/expanding-button-group";
import { ThemeToggle } from "@/components/theme-toggle";
import styles from "./workspace.module.css";

type DocumentMetadata = {
  id: string;
  filename: string;
  size: number;
  uploadedAt: string;
};

type OcrStatus = {
  status: "not_started" | "processing" | "completed" | "failed";
  startedAt?: string;
  completedAt?: string;
  totalPages?: number;
  completedPages?: number;
  failedPages?: number;
  warning?: string;
  error?: string;
};

type PdfRect = { x: number; y: number; width: number; height: number };

type PdfTextRun = {
  key: string;
  pageNumber: number;
  fontName: string;
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  fontWeight: number;
  fontItalic: boolean;
  rotation: number;
  rect: PdfRect;
  backgroundColor?: string;
  textColor?: string;
  manual?: boolean;
};
type PdfPageText = { document: PDFDocumentProxy; pageNumber: number; runs: PdfTextRun[]; text: string };

type PdfTextEdit = PdfTextRun & { value: string };
type BlankPageSize = {
  width: number;
  height: number;
  kind?: "blank" | "image" | "pdf";
  imageUrl?: string;
  sourcePdfBytes?: Uint8Array;
  sourcePdfPageIndex?: number;
};
type WorkspaceTool = "select" | "editText" | "editImage" | "addText" | "signature" | "highlight" | "comment" | "shape" | "redact" | "watermark";
type ShapeKind = "rectangle" | "circle" | "line" | "arrow";
type DetectedPdfImage = {
  id: string;
  pageNumber: number;
  rect: PdfRect;
  dataUrl?: string;
};
type PdfMarkup = {
  id: string;
  pageNumber: number;
  kind: "image" | "text" | "signature" | "highlight" | "comment" | "shape" | "redact" | "erase" | "watermark";
  rect?: PdfRect;
  text?: string;
  dataUrl?: string;
  shape?: ShapeKind;
  points?: Array<{ x: number; y: number }>;
  isWatermark?: boolean;
  color?: string;
  fontSize?: number;
  opacity?: number;
  rotation?: number;
  scale?: number;
  layer?: "behind" | "front";
  originalRect?: PdfRect;
};
type MarkupDraft = { kind: "text" | "comment"; pageNumber: number; rect: PdfRect; value: string };
type MarkupDrag = { id: string; pointer: { x: number; y: number }; rect: PdfRect; resizing: boolean };
type PdfTransform = [number, number, number, number, number, number];

type DocumentHistorySnapshot = {
  edits: Record<string, PdfTextEdit>;
  markups: PdfMarkup[];
  addedBlankPages: BlankPageSize[];
};

type PdfJsFontObject = {
  data?: Uint8Array | ArrayBuffer | null;
  bold?: boolean;
  italic?: boolean;
  name?: string;
  cssFontInfo?: { fontFamily?: string; fontWeight?: number; italicAngle?: number };
};

function cleanFontName(fontName: string): string {
  if (!fontName) return "";
  let clean = fontName.replace(/^[A-Z]{6}\+/, "").trim();
  clean = clean.replace(/['"]/g, "").trim();
  return clean;
}

function resolveFontFamily(pdfFont: PdfJsFontObject | undefined, fallback: string | undefined): string {
  const rawSource = pdfFont?.cssFontInfo?.fontFamily || pdfFont?.name || fallback || "";
  const clean = cleanFontName(rawSource);
  const normalized = clean.toLowerCase();

  if (normalized.includes("aptos")) {
    return "'Aptos', 'Calibri', 'Segoe UI', Arial, sans-serif";
  }
  if (normalized.includes("calibri")) {
    return "'Calibri', 'Segoe UI', Arial, -apple-system, BlinkMacSystemFont, sans-serif";
  }
  if (normalized.includes("cambria")) {
    return "'Cambria', Georgia, 'Times New Roman', serif";
  }
  if (normalized.includes("segoe")) {
    return "'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif";
  }
  if (normalized.includes("georgia")) {
    return "Georgia, 'Times New Roman', serif";
  }
  if (normalized.includes("verdana")) {
    return "Verdana, Geneva, sans-serif";
  }
  if (normalized.includes("tahoma")) {
    return "Tahoma, Verdana, sans-serif";
  }
  if (normalized.includes("garamond")) {
    return "Garamond, 'Times New Roman', serif";
  }
  if (normalized.includes("century gothic") || normalized.includes("centurygothic")) {
    return "'Century Gothic', 'Tw Cen MT', Arial, sans-serif";
  }
  if (normalized.includes("trebuchet")) {
    return "'Trebuchet MS', Arial, sans-serif";
  }
  if (/consolas|courier|mono|typewriter|menlo|source\s*code/.test(normalized)) {
    return "Consolas, 'Courier New', Courier, monospace";
  }
  if (/times|palatino|bookman|serif/.test(normalized)) {
    return "'Times New Roman', Times, Georgia, serif";
  }
  if (/arial|helvetica|sans/.test(normalized)) {
    return "Arial, Helvetica, 'Segoe UI', sans-serif";
  }
  if (clean) {
    const base = clean.split("-")[0].split(",")[0].trim();
    if (base) {
      return `'${base}', 'Calibri', 'Segoe UI', Arial, sans-serif`;
    }
  }
  return "'Calibri', 'Segoe UI', Arial, sans-serif";
}

function getPdfFontBytes(pdfFont: PdfJsFontObject | undefined): Uint8Array | undefined {
  if (!pdfFont?.data) return undefined;
  return pdfFont.data instanceof Uint8Array ? pdfFont.data : new Uint8Array(pdfFont.data);
}

const embeddedPdfFontLoads = new Map<string, Promise<string>>();

function cssFontFamilyForPdfFont(documentId: string, fontName: string, pdfFont: PdfJsFontObject | undefined, fallback: string | undefined): string {
  const fontBytes = getPdfFontBytes(pdfFont);
  if (!fontBytes?.byteLength || typeof FontFace === "undefined" || typeof document === "undefined") {
    return resolveFontFamily(pdfFont, fallback);
  }

  const family = `YourPdfEmbedded-${documentId.replaceAll("-", "")}-${fontName.replace(/[^a-z0-9]/gi, "")}`;
  let load = embeddedPdfFontLoads.get(family);
  if (!load) {
    try {
      const fontSource = new ArrayBuffer(fontBytes.byteLength);
      new Uint8Array(fontSource).set(fontBytes);
      load = new FontFace(family, fontSource)
        .load()
        .then((loaded) => {
          document.fonts.add(loaded);
          return family;
        })
        .catch(() => resolveFontFamily(pdfFont, fallback));
      embeddedPdfFontLoads.set(family, load);
    } catch {
      return resolveFontFamily(pdfFont, fallback);
    }
  }
  return `"${family}", ${resolveFontFamily(pdfFont, fallback)}`;
}

function parseHexColor(hex: string | undefined): [number, number, number] | undefined {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  return [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) as [number, number, number];
}

let pdfTextMeasureCanvas: HTMLCanvasElement | null = null;

function measurePdfTextWidth(text: string, run: PdfTextRun): number {
  if (typeof document === "undefined") return text.length * run.fontSize * 0.52;
  pdfTextMeasureCanvas ??= document.createElement("canvas");
  const context = pdfTextMeasureCanvas.getContext("2d");
  if (!context) return text.length * run.fontSize * 0.52;
  context.font = `${run.fontItalic ? "italic " : ""}${run.fontWeight} ${run.fontSize}px ${run.fontFamily}`;
  return context.measureText(text).width;
}

function getPdfJsFont(page: PDFPageProxy, fontName: string): Promise<PdfJsFontObject | undefined> {
  const pool = fontName.startsWith("g_") ? page.commonObjs : page.objs;
  return new Promise((resolve) => {
    try {
      if (pool.has(fontName)) { resolve(pool.get(fontName) as PdfJsFontObject); return; }
      let settled = false;
      const timeout = window.setTimeout(() => { settled = true; resolve(undefined); }, 1500);
      pool.get(fontName, (font: unknown) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve(font as PdfJsFontObject);
      }, () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        resolve(undefined);
      });
    } catch {
      resolve(undefined);
    }
  });
}

function pdfPointToScreen(point: { x: number; y: number }, transform: PdfTransform, scale: number) {
  const [a, b, c, d, e, f] = transform;
  return { x: (a * point.x + c * point.y + e) * scale, y: (b * point.x + d * point.y + f) * scale };
}

function pdfRectToScreen(rect: PdfRect, transform: PdfTransform, scale: number) {
  const corners = [
    pdfPointToScreen({ x: rect.x, y: rect.y }, transform, scale),
    pdfPointToScreen({ x: rect.x + rect.width, y: rect.y }, transform, scale),
    pdfPointToScreen({ x: rect.x + rect.width, y: rect.y + rect.height }, transform, scale),
    pdfPointToScreen({ x: rect.x, y: rect.y + rect.height }, transform, scale),
  ];
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  return { left: Math.min(...xs), top: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function screenPointToPdf(point: { x: number; y: number }, transform: PdfTransform, scale: number) {
  const [a, b, c, d, e, f] = transform;
  const determinant = a * d - b * c;
  if (Math.abs(determinant) < 0.00001 || scale <= 0) return { x: 0, y: 0 };
  const x = point.x / scale - e;
  const y = point.y / scale - f;
  return { x: (d * x - c * y) / determinant, y: (-b * x + a * y) / determinant };
}

function screenRectToPdf(rect: { left: number; top: number; width: number; height: number }, transform: PdfTransform, scale: number): PdfRect {
  const corners = [
    screenPointToPdf({ x: rect.left, y: rect.top }, transform, scale),
    screenPointToPdf({ x: rect.left + rect.width, y: rect.top }, transform, scale),
    screenPointToPdf({ x: rect.left + rect.width, y: rect.top + rect.height }, transform, scale),
    screenPointToPdf({ x: rect.left, y: rect.top + rect.height }, transform, scale),
  ];
  const xs = corners.map(({ x }) => x);
  const ys = corners.map(({ y }) => y);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

function decodeImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("An image annotation could not be loaded."));
    image.src = dataUrl;
  });
}

function extractDataUrlFromCanvas(
  rect: PdfRect,
  canvas: HTMLCanvasElement,
  transform: PdfTransform,
  scale: number,
  renderSize: { width: number; height: number },
): string | null {
  try {
    const box = pdfRectToScreen(rect, transform, scale);
    const ratioX = canvas.width / (renderSize.width || 1);
    const ratioY = canvas.height / (renderSize.height || 1);
    const sx = Math.max(0, Math.floor(box.left * ratioX));
    const sy = Math.max(0, Math.floor(box.top * ratioY));
    const sw = Math.min(canvas.width - sx, Math.ceil(box.width * ratioX));
    const sh = Math.min(canvas.height - sy, Math.ceil(box.height * ratioY));
    if (sw <= 2 || sh <= 2) return null;
    const off = document.createElement("canvas");
    off.width = sw;
    off.height = sh;
    const ctx = off.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    return off.toDataURL("image/png");
  } catch {
    return null;
  }
}

async function paintMarkupCanvas(context: CanvasRenderingContext2D, markup: PdfMarkup, transform: PdfTransform, scale: number) {
  if (!markup.rect) return;
  const box = pdfRectToScreen(markup.rect, transform, scale);
  context.save();
  if (markup.kind === "highlight") {
    context.globalAlpha = 0.36;
    context.fillStyle = "#ffe45c";
    context.fillRect(box.left, box.top, box.width, box.height);
  } else if (markup.kind === "redact") {
    context.fillStyle = "#080808";
    context.fillRect(box.left, box.top, box.width, box.height);
  } else if (markup.kind === "erase") {
    context.fillStyle = "#ffffff";
    context.fillRect(box.left, box.top, box.width, box.height);
  } else if (markup.kind === "shape") {
    context.strokeStyle = "#315fe8";
    context.lineWidth = Math.max(1, 1.5 * scale);
    if (markup.shape === "circle") {
      context.beginPath();
      context.ellipse(box.left + box.width / 2, box.top + box.height / 2, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
      context.stroke();
    } else if (markup.shape === "line" || markup.shape === "arrow") {
      const start = markup.points?.[0] ? pdfPointToScreen(markup.points[0], transform, scale) : { x: box.left, y: box.top };
      const end = markup.points?.[1] ? pdfPointToScreen(markup.points[1], transform, scale) : { x: box.left + box.width, y: box.top + box.height };
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      if (markup.shape === "arrow") {
        const angle = Math.atan2(end.y - start.y, end.x - start.x);
        const head = 9 * scale;
        context.beginPath();
        context.moveTo(end.x, end.y);
        context.lineTo(end.x - head * Math.cos(angle - Math.PI / 6), end.y - head * Math.sin(angle - Math.PI / 6));
        context.moveTo(end.x, end.y);
        context.lineTo(end.x - head * Math.cos(angle + Math.PI / 6), end.y - head * Math.sin(angle + Math.PI / 6));
        context.stroke();
      }
    } else context.strokeRect(box.left, box.top, box.width, box.height);
  } else if ((markup.kind === "image" || markup.kind === "signature") && markup.dataUrl) {
    if (markup.originalRect) {
      const origBox = pdfRectToScreen(markup.originalRect, transform, scale);
      context.fillStyle = "#fff";
      context.fillRect(origBox.left, origBox.top, origBox.width, origBox.height);
    } else if (markup.kind === "image") {
      context.fillStyle = "#fff";
      context.fillRect(box.left, box.top, box.width, box.height);
    }
    const image = await decodeImage(markup.dataUrl);
    context.drawImage(image, box.left, box.top, box.width, box.height);
  } else if (markup.kind === "watermark" || markup.isWatermark) {
    context.save();
    context.globalAlpha = markup.opacity ?? 0.25;
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    context.translate(cx, cy);
    context.rotate(((markup.rotation ?? -45) * Math.PI) / 180);
    if (markup.text) {
      const fontSize = Math.max(12, Math.min(box.height * 0.55, (box.width / Math.max(1, markup.text.length * 0.7))));
      context.font = `800 ${fontSize}px system-ui, -apple-system, sans-serif`;
      context.fillStyle = markup.color ?? "#64748b";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(markup.text.toUpperCase(), 0, 0);
    } else if (markup.dataUrl) {
      try {
        const image = await decodeImage(markup.dataUrl);
        context.drawImage(image, -box.width / 2, -box.height / 2, box.width, box.height);
      } catch { }
    }
    context.restore();
  } else if (markup.kind === "text" || markup.kind === "comment") {
    if (markup.kind === "comment") {
      context.fillStyle = "#fff5c9";
      context.strokeStyle = "#e3c65b";
      context.lineWidth = 1;
      context.fillRect(box.left, box.top, box.width, box.height);
      context.strokeRect(box.left, box.top, box.width, box.height);
    }
    context.fillStyle = "#20242a";
    context.font = `${Math.max(9, Math.min(14, box.height * 0.35)) * scale}px Arial, sans-serif`;
    context.textBaseline = "top";
    const fontHeight = Math.max(9, Math.min(14, box.height * 0.35)) * scale;
    (markup.text ?? "").split("\n").forEach((line, index) => context.fillText(line, box.left + 5, box.top + 5 + index * fontHeight * 1.25, Math.max(1, box.width - 10)));
  }
  context.restore();
}

function formatSize(size: number) {
  return size >= 1024 * 1024
    ? `${(size / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(size / 1024))} KB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function PdfThumbnail({
  document,
  pageNumber,
  active,
  onSelect,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  active: boolean;
  onSelect: (pageNumber: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let canceled = false;
    let renderTask: RenderTask | undefined;
    const draw = async () => {
      try {
        const page = await document.getPage(pageNumber);
        if (canceled || !canvasRef.current) return;
        const viewport = page.getViewport({ scale: 0.19 });
        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
      } catch {
        // The main document view still works if a thumbnail cannot render.
      }
    };
    void draw();
    return () => {
      canceled = true;
      renderTask?.cancel();
    };
  }, [document, pageNumber]);

  return (
    <button
      type="button"
      className={`${styles.thumbnailButton} ${active ? styles.thumbnailActive : ""}`}
      aria-current={active ? "page" : undefined}
      aria-label={`Go to page ${pageNumber}`}
      onClick={() => onSelect(pageNumber)}
    >
      <span className={styles.thumbnailPaper}>
        <canvas ref={canvasRef} />
      </span>
      <span className={styles.thumbnailNumber}>{pageNumber}</span>
    </button>
  );
}

function BlankPageThumbnail({
  pageNumber,
  pageData,
  active,
  onSelect,
}: {
  pageNumber: number;
  pageData?: BlankPageSize;
  active: boolean;
  onSelect: (pageNumber: number) => void;
}) {
  return (
    <button
      type="button"
      className={`${styles.thumbnailButton} ${active ? styles.thumbnailActive : ""}`}
      aria-current={active ? "page" : undefined}
      aria-label={`Go to page ${pageNumber}`}
      onClick={() => onSelect(pageNumber)}
    >
      <span className={`${styles.thumbnailPaper} ${!pageData?.imageUrl ? styles.blankThumbnailPaper : ""}`}>
        {pageData?.imageUrl ? (
          <NextImage
            src={pageData.imageUrl}
            alt={`Page ${pageNumber}`}
            width={96}
            height={112}
            unoptimized
            style={{ width: "100%", height: "auto", maxHeight: "102px", objectFit: "contain", pointerEvents: "none" }}
          />
        ) : (
          <span className={styles.blankThumbnailMark}><Plus size={13} aria-hidden="true" /><span>Blank page</span></span>
        )}
      </span>
      <span className={styles.thumbnailNumber}>{pageNumber}</span>
    </button>
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const lower = text.toLocaleLowerCase();
  const needle = query.trim().toLocaleLowerCase();
  const result: ReactNode[] = [];
  let cursor = 0;
  let index = lower.indexOf(needle);
  while (index !== -1) {
    if (index > cursor) result.push(text.slice(cursor, index));
    result.push(<mark key={`${index}-${result.length}`}>{text.slice(index, index + needle.length)}</mark>);
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  result.push(text.slice(cursor));
  return <>{result}</>;
}

export default function Workspace({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [metadata, setMetadata] = useState<DocumentMetadata | null>(null);
  const [ocrStatus, setOcrStatus] = useState<OcrStatus>({ status: "not_started" });
  const [viewSelection, setViewSelection] = useState<{ documentId: string; mode: "original" | "clean" }>({ documentId, mode: "original" });
  const viewMode = viewSelection.documentId === documentId ? viewSelection.mode : "original";
  const setViewMode = useCallback((mode: "original" | "clean") => setViewSelection({ documentId, mode }), [documentId]);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pageAddition, setPageAddition] = useState<{ documentId: string; pages: BlankPageSize[] }>({ documentId, pages: [] });
  const addedBlankPages = useMemo(
    () => pageAddition.documentId === documentId ? pageAddition.pages : [],
    [documentId, pageAddition],
  );
  const totalPageCount = pageCount + addedBlankPages.length;
  const [zoom, setZoom] = useState(1);
  const [debouncedZoom, setDebouncedZoom] = useState(1);
  const rotation = 0;
  const [fitToPage, setFitToPage] = useState(true);
  const [shownThumbnails, setShownThumbnails] = useState(12);
  const [pageTextData, setPageTextData] = useState<PdfPageText | null>(null);
  const currentPageText = pageTextData?.document === pdfDocument && pageTextData.pageNumber === pageNumber ? pageTextData : null;
  const pageText = currentPageText?.text ?? "";
  const textRuns = currentPageText?.runs ?? [];
  const [detectedImages, setDetectedImages] = useState<DetectedPdfImage[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedZoom(zoom);
    }, 120);
    return () => clearTimeout(timer);
  }, [zoom]);

  const [renderScale, setRenderScale] = useState(1);
  const scaleRatio = useMemo(() => {
    if (fitToPage || renderScale <= 0) return 1;
    return Math.round((zoom / renderScale) * 1000) / 1000;
  }, [fitToPage, zoom, renderScale]);
  const [renderSize, setRenderSize] = useState({ width: 0, height: 0 });
  const [editMode, setEditMode] = useState(false);
  const [editState, setEditState] = useState<{ documentId: string; items: Record<string, PdfTextEdit> }>({ documentId, items: {} });
  const edits = useMemo(
    () => editState.documentId === documentId ? editState.items : {},
    [documentId, editState],
  );
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draftRun, setDraftRun] = useState<PdfTextRun | null>(null);
  const [draftText, setDraftText] = useState("");
  const draftTextRef = useRef("");
  const [editNotice, setEditNotice] = useState("");
  const [selectionPreview, setSelectionPreview] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [activeTool, setActiveTool] = useState<WorkspaceTool>("select");
  const [markupState, setMarkupState] = useState<{ documentId: string; items: PdfMarkup[] }>({ documentId, items: [] });
  const documentMarkups = useMemo(
    () => markupState.documentId === documentId ? markupState.items : [],
    [documentId, markupState],
  );
  const pageMarkups = documentMarkups.filter((markup) => markup.pageNumber === pageNumber);
  const [selectedMarkupId, setSelectedMarkupId] = useState<string | null>(null);
  const [markupDraft, setMarkupDraft] = useState<MarkupDraft | null>(null);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareHref, setShareHref] = useState("");
  const [shareFileName, setShareFileName] = useState("");
  const [shareFileSize, setShareFileSize] = useState<number | undefined>(undefined);
  const [signatureHasInk, setSignatureHasInk] = useState(false);
  const [pendingSignature, setPendingSignature] = useState<string | null>(null);
  const [shapeKind, setShapeKind] = useState<ShapeKind>("rectangle");
  const [shapeMenuOpen, setShapeMenuOpen] = useState(false);
  const [redactKind, setRedactKind] = useState<"redact" | "erase">("redact");
  const [redactMenuOpen, setRedactMenuOpen] = useState(false);
  const [watermarkMenuOpen, setWatermarkMenuOpen] = useState(false);
  const [watermarkModalOpen, setWatermarkModalOpen] = useState(false);
  const [watermarkType, setWatermarkType] = useState<"text" | "image">("text");
  const [wmText, setWmText] = useState("CONFIDENTIAL");
  const [wmFontSize, setWmFontSize] = useState(54);
  const [wmOpacity, setWmOpacity] = useState(25);
  const [wmColor, setWmColor] = useState("#64748b");
  const [wmRotation, setWmRotation] = useState(-45);
  const [wmPages, setWmPages] = useState<"all" | "current">("all");
  const [wmImageDataUrl, setWmImageDataUrl] = useState<string | null>(null);
  const [wmImageScale, setWmImageScale] = useState(50);
  const [wmImageOpacity, setWmImageOpacity] = useState(25);
  const [wmImageRotation, setWmImageRotation] = useState(0);
  const [wmLayer, setWmLayer] = useState<"behind" | "front">("behind");
  const [addPageMenuOpen, setAddPageMenuOpen] = useState(false);
  const addPageMenuRef = useRef<HTMLDivElement>(null);
  const uploadPageInputRef = useRef<HTMLInputElement>(null);
  const watermarkImageInputRef = useRef<HTMLInputElement>(null);
  const activeRenderTaskRef = useRef<RenderTask | null>(null);
  const [pageTransform, setPageTransform] = useState<PdfTransform>([1, 0, 0, -1, 0, 0]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showThumbnails, setShowThumbnails] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 768;
    }
    return true;
  });
  const [showDetails, setShowDetails] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pageSurfaceRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const imageTargetRef = useRef<PdfRect | null>(null);
  const pageTransformRef = useRef<PdfTransform>([1, 0, 0, -1, 0, 0]);
  const markupDragRef = useRef<MarkupDrag | null>(null);
  const signatureCanvasRef = useRef<HTMLCanvasElement>(null);
  const transformStartMarkupsRef = useRef<PdfMarkup[] | null>(null);

  const [undoStack, setUndoStack] = useState<DocumentHistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<DocumentHistorySnapshot[]>([]);

  const pushHistory = useCallback((snapshot: DocumentHistorySnapshot) => {
    setUndoStack((prev) => [...prev.slice(-49), snapshot]);
    setRedoStack([]);
  }, []);

  const originalFileUrl = `/api/documents/${documentId}/file`;
  const cleanFileUrl = `/api/documents/${documentId}/clean`;
  const fileUrl = viewMode === "clean" ? cleanFileUrl : originalFileUrl;

  const startOcrProcessing = useCallback(async (signal?: AbortSignal) => {
    try {
      const startResponse = await fetch(`/api/documents/${documentId}/process`, { method: "POST", signal, cache: "no-store" });
      const startStatus = await startResponse.json() as OcrStatus;
      setOcrStatus(startStatus);
      if (startStatus.status === "failed") return;
      if (startStatus.status === "completed") {
        setViewMode("clean");
        return;
      }

      while (!signal?.aborted) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        if (signal?.aborted) return;
        const statusResponse = await fetch(`/api/documents/${documentId}/process`, { cache: "no-store", signal });
        if (!statusResponse.ok) throw new Error("OCR status could not be loaded. Reload the page to retry.");
        const nextStatus = await statusResponse.json() as OcrStatus;
        setOcrStatus(nextStatus);
        if (nextStatus.status === "completed") {
          setViewMode("clean");
          setFitToPage(true);
          return;
        }
        if (nextStatus.status === "failed") return;
      }
    } catch (reason) {
      if (signal?.aborted) return;
      setOcrStatus({
        status: "failed",
        error: reason instanceof Error ? reason.message : "OCR status could not be loaded. Reload the page to retry.",
      });
    }
  }, [documentId, setViewMode]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void startOcrProcessing(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [startOcrProcessing]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let items: Record<string, PdfTextEdit> = {};
      try {
        const saved = localStorage.getItem(`clearpdf:edits:${documentId}`);
        if (saved) items = JSON.parse(saved) as Record<string, PdfTextEdit>;
      } catch {
        try { localStorage.removeItem(`clearpdf:edits:${documentId}`); } catch { /* Storage may be unavailable in private browsing. */ }
      }
      setEditState({ documentId, items });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [documentId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      let items: PdfMarkup[] = [];
      try {
        const saved = localStorage.getItem(`clearpdf:markups:${documentId}`);
        if (saved) items = JSON.parse(saved) as PdfMarkup[];
      } catch {
        try { localStorage.removeItem(`clearpdf:markups:${documentId}`); } catch { /* Storage may be unavailable in private browsing. */ }
      }
      setMarkupState({ documentId, items });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [documentId]);

  useEffect(() => {
    let active = true;
    let loadingTask: { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } | null = null;

    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const [metadataResponse, pdfjs] = await Promise.all([
          fetch(`/api/documents/${documentId}`, { cache: "no-store" }),
          import("pdfjs-dist"),
        ]);
        if (!metadataResponse.ok) throw new Error("This document could not be found. Upload it again to continue.");
        const documentMetadata = (await metadataResponse.json()) as DocumentMetadata;
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        loadingTask = pdfjs.getDocument({ url: fileUrl });
        const pdf = await loadingTask.promise;
        if (!active) return;
        setMetadata(documentMetadata);
        setPdfDocument(pdf);
        setPageCount(pdf.numPages);
        setLoading(false);
      } catch (reason) {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : "This document could not be opened.");
        setLoading(false);
      }
    };

    void load();
    return () => {
      active = false;
      if (loadingTask) void loadingTask.destroy().catch(() => undefined);
    };
  }, [documentId, fileUrl]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(max-width: 768px)");
    const handler = (event: MediaQueryListEvent) => {
      if (event.matches) setShowThumbnails(false);
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdfDocument || !canvasRef.current) return;
    let canceled = false;

    const render = async () => {
      try {
        if (pageNumber > pdfDocument.numPages) {
          const blankPage = addedBlankPages[pageNumber - pdfDocument.numPages - 1];
          const canvas = canvasRef.current;
          const context = canvas?.getContext("2d");
          if (!blankPage || !canvas || !context) return;
          const rotated = rotation % 180 !== 0;
          const baseWidth = rotated ? blankPage.height : blankPage.width;
          const baseHeight = rotated ? blankPage.width : blankPage.height;
          const blankTransform: PdfTransform = [1, 0, 0, -1, 0, blankPage.height];
          pageTransformRef.current = blankTransform;
          setPageTransform(blankTransform);
          const isMobile = stageSize.width < 640;
          const paddingX = isMobile ? 12 : 112;
          const paddingY = isMobile ? 48 : 130;
          const fittedScale = fitToPage && stageSize.width
            ? Math.min((stageSize.width - paddingX) / baseWidth, (stageSize.height - paddingY) / baseHeight, 1.4)
            : debouncedZoom;
          const scale = Math.max(0.25, fittedScale);
          const width = baseWidth * scale;
          const height = baseHeight * scale;
          const outputScale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
          setRenderScale(scale);
          setRenderSize({ width, height });
          canvas.width = Math.floor(width * outputScale);
          canvas.height = Math.floor(height * outputScale);
          context.setTransform(1, 0, 0, 1, 0, 0);
          context.fillStyle = "#fff";
          context.fillRect(0, 0, canvas.width, canvas.height);
          if (blankPage.imageUrl) {
            try {
              const img = await decodeImage(blankPage.imageUrl);
              if (canceled) return;
              if (rotation % 360 !== 0) {
                context.save();
                context.translate(canvas.width / 2, canvas.height / 2);
                context.rotate((rotation * Math.PI) / 180);
                const drawW = rotated ? canvas.height : canvas.width;
                const drawH = rotated ? canvas.width : canvas.height;
                context.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
                context.restore();
              } else {
                context.drawImage(img, 0, 0, canvas.width, canvas.height);
              }
            } catch {
              // fallback remains plain white
            }
          }
          return;
        }

        const page = await pdfDocument.getPage(pageNumber);
        if (canceled || !canvasRef.current) return;
        const pageRotation = (page.rotate + rotation) % 360;
        const baseViewport = page.getViewport({ scale: 1, rotation: pageRotation });
        const currentTransform = [...baseViewport.transform] as PdfTransform;
        pageTransformRef.current = currentTransform;
        setPageTransform(currentTransform);
        const isMobile = stageSize.width < 640;
        const paddingX = isMobile ? 12 : 112;
        const paddingY = isMobile ? 48 : 130;
        const fittedScale = fitToPage && stageSize.width
          ? Math.min((stageSize.width - paddingX) / baseViewport.width, (stageSize.height - paddingY) / baseViewport.height, 1.4)
          : debouncedZoom;
        const scale = Math.max(0.25, fittedScale);
        const viewport = page.getViewport({ scale, rotation: pageRotation });
        setRenderScale(scale);
        setRenderSize({ width: viewport.width, height: viewport.height });

        // Cancel previous active render task if any
        if (activeRenderTaskRef.current) {
          try {
            activeRenderTaskRef.current.cancel();
          } catch { }
          try {
            await activeRenderTaskRef.current.promise;
          } catch { }
        }
        if (canceled || !canvasRef.current) return;

        // Double-buffered rendering via offscreen canvas:
        // Keeps previous frame visible during smooth zoom animation, eliminating blank flashes.
        const outputScale = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
        const offscreen = document.createElement("canvas");
        offscreen.width = Math.floor(viewport.width * outputScale);
        offscreen.height = Math.floor(viewport.height * outputScale);
        const offscreenContext = offscreen.getContext("2d");
        if (!offscreenContext) return;

        const currentTask = page.render({
          canvas: offscreen,
          canvasContext: offscreenContext,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        activeRenderTaskRef.current = currentTask;

        await currentTask.promise;
        if (activeRenderTaskRef.current === currentTask) {
          activeRenderTaskRef.current = null;
        }
        if (canceled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const context = canvas.getContext("2d");
        if (!context) return;
        canvas.width = offscreen.width;
        canvas.height = offscreen.height;
        context.drawImage(offscreen, 0, 0);
      } catch (reason: unknown) {
        const isCancelled =
          canceled ||
          (reason && typeof reason === "object" && (
            ("name" in reason && (reason as { name: string }).name === "RenderingCancelledException") ||
            ("message" in reason && String((reason as { message: string }).message).toLowerCase().includes("cancel")) ||
            ("message" in reason && String((reason as { message: string }).message).toLowerCase().includes("render task in progress")) ||
            ("message" in reason && String((reason as { message: string }).message).toLowerCase().includes("already in use"))
          ));

        if (!isCancelled) {
          console.warn("Non-fatal PDF render warning during zoom/resize:", reason);
        }
      }
    };

    void render();
    return () => {
      canceled = true;
      if (activeRenderTaskRef.current) {
        try {
          activeRenderTaskRef.current.cancel();
        } catch { }
      }
    };
  }, [pdfDocument, pageNumber, addedBlankPages, debouncedZoom, rotation, fitToPage, stageSize.width, stageSize.height]);

  useEffect(() => {
    if (!pdfDocument) return;
    let active = true;
    if (pageNumber > pdfDocument.numPages) return () => { active = false; };
    const readPageText = async () => {
      try {
        const [page, pdfjs] = await Promise.all([pdfDocument.getPage(pageNumber), import("pdfjs-dist")]);
        const pageRotation = (page.rotate + rotation) % 360;
        const viewport = page.getViewport({ scale: 1, rotation: pageRotation });
        const content = await page.getTextContent();
        const fontNames = Array.from(new Set(content.items.flatMap((item) => "str" in item ? [item.fontName] : [])));
        const fontEntries = await Promise.all(fontNames.map(async (fontName) => [fontName, await getPdfJsFont(page, fontName)] as const));
        const pdfFonts = new Map(fontEntries);
        const familyEntries = fontNames.map((fontName) => {
          const font = content.styles[fontName];
          const family = cssFontFamilyForPdfFont(documentId, fontName, pdfFonts.get(fontName), font?.fontFamily);
          return [fontName, family] as const;
        });
        const pdfFontFamilies = new Map(familyEntries);
        const runs: PdfTextRun[] = content.items.flatMap((item, index) => {
          if (!("str" in item) || !item.str.trim()) return [];
          const transform = pdfjs.Util.transform(viewport.transform, item.transform);
          const fontSize = Math.max(5, Math.hypot(transform[2], transform[3]));
          const font = content.styles[item.fontName];
          const pdfFont = pdfFonts.get(item.fontName);
          const left = transform[4];
          const top = transform[5] - fontSize * (font?.ascent ?? 0.8);
          const width = Math.max(Math.abs(item.width), fontSize * 0.55);
          const height = Math.max(fontSize * 1.14, Math.abs(item.height) * 0.85);
          const padX = Math.max(0.7, fontSize * 0.05);
          const padY = Math.max(0.5, fontSize * 0.04);
          const corners = [
            viewport.convertToPdfPoint(left - padX, top - padY),
            viewport.convertToPdfPoint(left + width + padX, top - padY),
            viewport.convertToPdfPoint(left + width + padX, top + height + padY),
            viewport.convertToPdfPoint(left - padX, top + height + padY),
          ];
          const xs = corners.map(([x]) => x);
          const ys = corners.map(([, y]) => y);
          const x = Math.min(...xs);
          const y = Math.min(...ys);
          return [{
            key: `page-${pageNumber}-text-${index}`,
            pageNumber,
            fontName: item.fontName,
            text: item.str,
            left,
            top,
            width,
            height,
            fontSize,
            fontFamily: pdfFontFamilies.get(item.fontName) ?? resolveFontFamily(pdfFont, font?.fontFamily),
            fontWeight: pdfFont?.cssFontInfo?.fontWeight ?? (pdfFont?.bold ? 700 : 400),
            fontItalic: pdfFont?.italic ?? Boolean(pdfFont?.cssFontInfo?.italicAngle),
            rotation: Math.atan2(transform[1], transform[0]),
            rect: { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) },
          }];
        });
        if (active) {
          setPageTextData({ document: pdfDocument, pageNumber, runs, text: runs.map((run) => run.text).join(" ") });
        }

        try {
          const ops = await page.getOperatorList();
          let ctm: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
          const ctmStack: Array<[number, number, number, number, number, number]> = [];
          const detectedImgList: DetectedPdfImage[] = [];
          const pWidth = page.view[2] - page.view[0];
          const pHeight = page.view[3] - page.view[1];

          for (let i = 0; i < ops.fnArray.length; i++) {
            const fn = ops.fnArray[i];
            const args = ops.argsArray[i];

            if (fn === pdfjs.OPS.save) {
              ctmStack.push([...ctm]);
            } else if (fn === pdfjs.OPS.restore) {
              if (ctmStack.length > 0) ctm = ctmStack.pop()!;
            } else if (fn === pdfjs.OPS.transform) {
              ctm = pdfjs.Util.transform(ctm, args as [number, number, number, number, number, number]) as [number, number, number, number, number, number];
            } else if (
              fn === pdfjs.OPS.paintImageXObject ||
              fn === pdfjs.OPS.paintInlineImageXObject ||
              fn === pdfjs.OPS.paintImageMaskXObject
            ) {
              const xs = [ctm[4], ctm[0] + ctm[4], ctm[0] + ctm[2] + ctm[4], ctm[2] + ctm[4]];
              const ys = [ctm[5], ctm[1] + ctm[5], ctm[1] + ctm[3] + ctm[5], ctm[3] + ctm[5]];
              const minX = Math.min(...xs);
              const maxX = Math.max(...xs);
              const minY = Math.min(...ys);
              const maxY = Math.max(...ys);
              const imgW = maxX - minX;
              const imgH = maxY - minY;
              const isFullPage = imgW >= pWidth * 0.98 && imgH >= pHeight * 0.98;

              if (imgW >= 12 && imgH >= 12 && !isFullPage) {
                detectedImgList.push({
                  id: `pdf-img-${pageNumber}-${i}`,
                  pageNumber,
                  rect: { x: minX, y: minY, width: imgW, height: imgH },
                });
              }
            }
          }
          if (active) {
            setDetectedImages(detectedImgList);
          }
        } catch {
          if (active) setDetectedImages([]);
        }
      } catch {
        if (active) {
          setPageTextData({ document: pdfDocument, pageNumber, runs: [], text: "" });
          setDetectedImages([]);
        }
      }
    };
    void readPageText();
    return () => { active = false; };
  }, [pdfDocument, pageNumber, rotation, documentId]);

  const goToPage = useCallback((next: number) => {
    setPageNumber(Math.min(totalPageCount || 1, Math.max(1, next)));
    setSelectedMarkupId(null);
    setMarkupDraft(null);
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setShowThumbnails(false);
    }
  }, [totalPageCount]);

  const searchDocument = useCallback(async () => {
    const query = searchQuery.trim();
    if (!query || !pdfDocument) return;
    setSearchMessage("Searching…");
    for (let offset = 0; offset < pdfDocument.numPages; offset += 1) {
      const candidate = ((pageNumber - 1 + offset) % pdfDocument.numPages) + 1;
      const page = await pdfDocument.getPage(candidate);
      const content = await page.getTextContent();
      const text = content.items.map((item) => ("str" in item ? item.str : "")).join(" ");
      if (text.toLocaleLowerCase().includes(query.toLocaleLowerCase())) {
        goToPage(candidate);
        setSearchMessage(`Match found on page ${candidate}.`);
        return;
      }
    }
    setSearchMessage("No match found in selectable PDF text.");
  }, [goToPage, pageNumber, pdfDocument, searchQuery]);

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") void searchDocument();
  };

  const zoomIn = useCallback(() => {
    setFitToPage(false);
    setZoom((prev) => {
      const current = fitToPage ? renderScale : prev;
      return Math.min(3, Math.round((current + 0.15) * 100) / 100);
    });
  }, [fitToPage, renderScale]);

  const zoomOut = useCallback(() => {
    setFitToPage(false);
    setZoom((prev) => {
      const current = fitToPage ? renderScale : prev;
      return Math.max(0.25, Math.round((current - 0.15) * 100) / 100);
    });
  }, [fitToPage, renderScale]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const delta = -event.deltaY;
        const zoomStep = delta > 0 ? 0.12 : -0.12;
        setFitToPage(false);
        setZoom((prev) => {
          const current = fitToPage ? renderScale : prev;
          return Math.min(3, Math.max(0.25, Math.round((current + zoomStep) * 100) / 100));
        });
      }
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [fitToPage, renderScale]);

  useEffect(() => {
    if (!addPageMenuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (addPageMenuRef.current && !addPageMenuRef.current.contains(e.target as Node)) {
        setAddPageMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleClick);
    return () => window.removeEventListener("mousedown", handleClick);
  }, [addPageMenuOpen]);

  const viewItems = useMemo<ExpandingButtonGroupItem[]>(() => [
    { id: "original", label: "Original PDF", icon: <FileText />, onSelect: () => { setViewMode("original"); setFitToPage(true); } },
    { id: "clean", label: "Clean View", icon: <CheckCircle2 />, disabled: ocrStatus.status !== "completed", onSelect: () => { setViewMode("clean"); setFitToPage(true); } },
  ], [ocrStatus.status, setViewMode]);

  const handleCopyText = async () => {
    if (!pageText) {
      setSearchMessage("This page has no selectable text. Scanned pages need completed OCR before their text can be copied.");
      return;
    }

    const legacyCopy = () => {
      const textArea = document.createElement("textarea");
      textArea.value = pageText;
      textArea.setAttribute("readonly", "");
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      const copied = document.execCommand("copy");
      textArea.remove();
      if (!copied) throw new Error("Clipboard access was blocked.");
    };

    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(pageText);
      else legacyCopy();
      setSearchMessage("Page text copied to clipboard.");
    } catch {
      try {
        legacyCopy();
        setSearchMessage("Page text copied to clipboard.");
      } catch {
        setSearchMessage("Copy was blocked. Select the text in the Page text panel and copy it manually.");
      }
    }
  };

  const sampleTextBackground = (run: PdfTextRun) => {
    const canvas = canvasRef.current;
    if (!canvas || !renderSize.width || !renderSize.height) return "#ffffff";
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return "#ffffff";

    const pixelRatio = canvas.width / renderSize.width;
    const left = run.left * renderScale * pixelRatio;
    const top = run.top * renderScale * pixelRatio;
    const width = Math.max(run.width * renderScale * pixelRatio, 2);
    const height = Math.max(run.height * renderScale * pixelRatio, 2);
    const inset = Math.max(2, Math.min(5, run.fontSize * renderScale * pixelRatio * 0.18));
    const samples: Array<[number, number]> = [];
    const step = Math.max(4, Math.floor(Math.min(width, 80) / 8));
    for (let x = left; x <= left + width; x += step) {
      samples.push([x, top - inset], [x, top + height + inset]);
    }
    for (let y = top; y <= top + height; y += step) {
      samples.push([left - inset, y], [left + width + inset, y]);
    }

    const buckets = new Map<string, { count: number; rgb: [number, number, number] }>();
    for (const [x, y] of samples) {
      const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
      const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
      try {
        const data = context.getImageData(px, py, 1, 1).data;
        if (data[3] < 240) continue;
        const rgb: [number, number, number] = [data[0], data[1], data[2]];
        const key = rgb.map((value) => Math.round(value / 24)).join(":");
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.count += 1;
          bucket.rgb = bucket.rgb.map((value, index) => Math.round((value * (bucket.count - 1) + rgb[index]) / bucket.count)) as [number, number, number];
        } else {
          buckets.set(key, { count: 1, rgb });
        }
      } catch {
        return "#ffffff";
      }
    }

    const dominant = Array.from(buckets.values()).sort((a, b) => b.count - a.count)[0];
    return dominant ? `#${dominant.rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}` : "#ffffff";
  };

  const sampleTextColor = (run: PdfTextRun, backgroundColor: string) => {
    const canvas = canvasRef.current;
    if (!canvas || !renderSize.width || !renderSize.height) return "#15181c";
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const background = parseHexColor(backgroundColor);
    if (!context || !background) return "#15181c";
    const pixelRatio = canvas.width / renderSize.width;
    const left = Math.max(0, Math.floor(run.left * renderScale * pixelRatio));
    const top = Math.max(0, Math.floor(run.top * renderScale * pixelRatio));
    const width = Math.max(1, Math.ceil(run.width * renderScale * pixelRatio));
    const height = Math.max(1, Math.ceil(run.height * renderScale * pixelRatio));
    const sampleWidth = Math.min(width, canvas.width - left);
    const sampleHeight = Math.min(height, canvas.height - top);
    if (sampleWidth <= 0 || sampleHeight <= 0) return "#15181c";
    const step = Math.max(1, Math.floor(Math.min(width, height) / 16));
    const buckets = new Map<string, { count: number; rgb: [number, number, number] }>();
    try {
      const pixels = context.getImageData(left, top, sampleWidth, sampleHeight).data;
      for (let y = 0; y < sampleHeight; y += step) {
        for (let x = 0; x < sampleWidth; x += step) {
          const offset = (y * sampleWidth + x) * 4;
          if (pixels[offset + 3] < 240) continue;
          const rgb: [number, number, number] = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
          if (rgb.reduce((distance, value, index) => distance + Math.abs(value - background[index] * 255), 0) < 100) continue;
          const key = rgb.map((value) => Math.round(value / 32)).join(":");
          const bucket = buckets.get(key);
          if (bucket) {
            bucket.count += 1;
            bucket.rgb = bucket.rgb.map((value, index) => Math.round((value * (bucket.count - 1) + rgb[index]) / bucket.count)) as [number, number, number];
          } else {
            buckets.set(key, { count: 1, rgb });
          }
        }
      }
    } catch {
      return "#15181c";
    }
    const dominant = Array.from(buckets.values()).sort((a, b) => b.count - a.count)[0];
    return dominant ? `#${dominant.rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}` : "#15181c";
  };

  const beginInlineEdit = (run: PdfTextRun) => {
    const saved = edits[run.key];
    const backgroundColor = saved?.backgroundColor ?? run.backgroundColor ?? sampleTextBackground(run);
    const editableRun = {
      ...run,
      ...(saved ?? {}),
      backgroundColor,
      textColor: saved?.textColor ?? run.textColor ?? sampleTextColor(run, backgroundColor),
    };
    const initialText = saved?.value ?? run.text;
    setDraftRun(editableRun);
    draftTextRef.current = initialText;
    setDraftText(initialText);
    setEditingKey(run.key);
    setEditNotice("Edit the text, then press Enter or click outside the field to save.");
  };

  const cancelInlineEdit = useCallback(() => {
    setEditingKey(null);
    setDraftRun(null);
    draftTextRef.current = "";
    setDraftText("");
    setSelectionPreview(null);
  }, []);

  const commitInlineEdit = useCallback(() => {
    if (!editingKey || !draftRun) return;
    const nextDraftText = draftTextRef.current;
    const next = { ...edits };
    if (!draftRun.manual && nextDraftText === draftRun.text) {
      delete next[editingKey];
    } else {
      const measuredWidth = measurePdfTextWidth(nextDraftText, draftRun);
      const newWidth = Math.max(draftRun.width, measuredWidth + 2);
      const newRectWidth = Math.max(draftRun.rect.width, draftRun.rect.width + Math.max(0, newWidth - draftRun.width));
      next[editingKey] = {
        ...draftRun,
        width: newWidth,
        rect: { ...draftRun.rect, width: newRectWidth },
        value: nextDraftText,
      };
    }
    const currentVal = edits[editingKey]?.value ?? (draftRun.manual ? "" : draftRun.text);
    if (nextDraftText !== currentVal) {
      pushHistory({ edits, markups: documentMarkups, addedBlankPages });
    }
    setEditState({ documentId, items: next });
    try { localStorage.setItem(`clearpdf:edits:${documentId}`, JSON.stringify(next)); } catch { /* The edit remains available for export in this tab. */ }
    setEditingKey(null);
    setDraftRun(null);
    draftTextRef.current = "";
    setDraftText("");
    setEditNotice(draftRun.manual ? "Replacement saved for this page." : "Text replacement saved with the source font and page background.");
    setSelectionPreview(null);
  }, [editingKey, draftRun, edits, pushHistory, documentMarkups, addedBlankPages, documentId]);

  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    if (editingKey) cancelInlineEdit();

    const previous = undoStack[undoStack.length - 1];
    const newUndo = undoStack.slice(0, -1);
    const currentSnapshot: DocumentHistorySnapshot = {
      edits,
      markups: documentMarkups,
      addedBlankPages,
    };

    setRedoStack((prev) => [...prev, currentSnapshot]);
    setUndoStack(newUndo);

    setEditState({ documentId, items: previous.edits });
    try { localStorage.setItem(`clearpdf:edits:${documentId}`, JSON.stringify(previous.edits)); } catch { }

    setMarkupState({ documentId, items: previous.markups });
    try { localStorage.setItem(`clearpdf:markups:${documentId}`, JSON.stringify(previous.markups)); } catch { }

    setPageAddition({ documentId, pages: previous.addedBlankPages });

    const restoredTotalPages = pageCount + previous.addedBlankPages.length;
    setPageNumber((curr) => Math.min(curr, Math.max(1, restoredTotalPages)));

    if (selectedMarkupId && !previous.markups.some((m) => m.id === selectedMarkupId)) {
      setSelectedMarkupId(null);
    }
    setSearchMessage("Action undone.");
  }, [undoStack, editingKey, cancelInlineEdit, edits, documentMarkups, addedBlankPages, documentId, pageCount, selectedMarkupId]);

  const handleRedo = useCallback(() => {
    if (redoStack.length === 0) return;
    if (editingKey) cancelInlineEdit();

    const next = redoStack[redoStack.length - 1];
    const newRedo = redoStack.slice(0, -1);
    const currentSnapshot: DocumentHistorySnapshot = {
      edits,
      markups: documentMarkups,
      addedBlankPages,
    };

    setUndoStack((prev) => [...prev, currentSnapshot]);
    setRedoStack(newRedo);

    setEditState({ documentId, items: next.edits });
    try { localStorage.setItem(`clearpdf:edits:${documentId}`, JSON.stringify(next.edits)); } catch { }

    setMarkupState({ documentId, items: next.markups });
    try { localStorage.setItem(`clearpdf:markups:${documentId}`, JSON.stringify(next.markups)); } catch { }

    setPageAddition({ documentId, pages: next.addedBlankPages });

    const restoredTotalPages = pageCount + next.addedBlankPages.length;
    setPageNumber((curr) => Math.min(curr, Math.max(1, restoredTotalPages)));

    setSearchMessage("Action redone.");
  }, [redoStack, editingKey, cancelInlineEdit, edits, documentMarkups, addedBlankPages, documentId, pageCount]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInput = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        if (!event.shiftKey) {
          if (!isInput) {
            event.preventDefault();
            handleUndo();
          }
        } else {
          if (!isInput) {
            event.preventDefault();
            handleRedo();
          }
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        if (!isInput) {
          event.preventDefault();
          handleRedo();
        }
      } else if ((event.ctrlKey || event.metaKey) && (event.key === "=" || event.key === "+")) {
        if (!isInput) {
          event.preventDefault();
          zoomIn();
        }
      } else if ((event.ctrlKey || event.metaKey) && (event.key === "-" || event.key === "_")) {
        if (!isInput) {
          event.preventDefault();
          zoomOut();
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key === "0") {
        if (!isInput) {
          event.preventDefault();
          setFitToPage(true);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleUndo, handleRedo, zoomIn, zoomOut]);

  const saveMarkups = (next: PdfMarkup[]) => {
    setMarkupState({ documentId, items: next });
    try { localStorage.setItem(`clearpdf:markups:${documentId}`, JSON.stringify(next)); } catch { setSearchMessage("Markup is available in this tab but could not be saved for reopening."); }
  };

  const appendMarkup = (markup: Omit<PdfMarkup, "id"> & { id?: string }) => {
    pushHistory({ edits, markups: documentMarkups, addedBlankPages });
    const id = markup.id ?? crypto.randomUUID();
    const next = [...documentMarkups, { ...markup, id }];
    saveMarkups(next);
    setSelectedMarkupId(id);
    setSearchMessage("Markup added. Download the edited PDF to keep it.");
    return id;
  };

  const activateTool = (tool: WorkspaceTool) => {
    if (editingKey) commitInlineEdit();
    setActiveTool(tool);
    setMarkupDraft(null);
    setSelectedMarkupId(null);
    setSelectionPreview(null);
    setEditMode(tool === "editText");
    if (tool === "editText") setEditNotice(textRuns.length ? "Click text on the page to replace it." : "Scanned page: drag around text to set replacement bounds.");
    else if (tool === "editImage") setSearchMessage("Drag around an image on the page, then choose its replacement image.");
    else if (tool === "addText") setSearchMessage("Click on the page where the new text should start.");
    else if (tool === "highlight") setSearchMessage("Drag over text to highlight it.");
    else if (tool === "comment") setSearchMessage("Click on the page to add a comment.");
    else if (tool === "shape") setSearchMessage(`Drag to draw a ${shapeKind}. Choose another shape from the shape menu.`);
    else if (tool === "signature") setSearchMessage("Draw a signature, then drag to place it on the page.");
    else if (tool === "redact") setSearchMessage(redactKind === "redact" ? "Drag over content to permanently redact it in the exported copy." : "Drag over content to erase it in the exported copy.");
    else setSearchMessage("");
  };

  const getMarkupPoint = (event: ReactPointerEvent<HTMLElement>) => {
    const bounds = pageSurfaceRef.current?.getBoundingClientRect();
    if (!bounds) return null;
    const currentScale = scaleRatio > 0 ? scaleRatio : 1;
    return {
      x: Math.min(bounds.width / currentScale, Math.max(0, (event.clientX - bounds.left) / currentScale)),
      y: Math.min(bounds.height / currentScale, Math.max(0, (event.clientY - bounds.top) / currentScale)),
    };
  };

  const onMarkupPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeTool === "select" || activeTool === "editText" || editingKey || event.target !== event.currentTarget) return;
    const point = getMarkupPoint(event);
    if (!point) return;
    pointerStartRef.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!["addText", "comment"].includes(activeTool)) setSelectionPreview({ left: point.x, top: point.y, width: 0, height: 0 });
  };

  const onMarkupPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = getMarkupPoint(event);
    const start = pointerStartRef.current;
    if (!point || !start) return;
    if (["addText", "comment"].includes(activeTool)) return;
    setSelectionPreview({ left: Math.min(start.x, point.x), top: Math.min(start.y, point.y), width: Math.abs(point.x - start.x), height: Math.abs(point.y - start.y) });
  };

  const onMarkupPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    const end = getMarkupPoint(event);
    pointerStartRef.current = null;
    if (!start || !end) { setSelectionPreview(null); return; }
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);
    const isLine = activeTool === "shape" && (shapeKind === "line" || shapeKind === "arrow");
    const minDrag = (width > 8 && height > 8) || (isLine && Math.hypot(width, height) > 10);
    if (activeTool === "addText" || activeTool === "comment") {
      const point = screenPointToPdf(start, pageTransformRef.current, renderScale);
      const box = activeTool === "comment" ? { left: start.x, top: start.y, width: 220, height: 88 } : { left: start.x, top: start.y, width: 240, height: 30 };
      setMarkupDraft({ kind: activeTool === "comment" ? "comment" : "text", pageNumber, rect: screenRectToPdf(box, pageTransformRef.current, renderScale), value: "" });
      if (activeTool === "comment") setSearchMessage("Write the comment in the page note, then save it.");
      else setSearchMessage(`Text placement ready near ${Math.round(point.x)}, ${Math.round(point.y)} pt.`);
      return;
    }
    if (!minDrag) {
      setSelectionPreview(null);
      if (activeTool === "editImage") setSearchMessage("Drag around the image area so its replacement fits.");
      else if (activeTool === "signature") setSearchMessage("Drag to choose where the signature should appear.");
      else if (["highlight", "shape", "redact"].includes(activeTool)) setSearchMessage("Drag across an area on the page to place this markup.");
      return;
    }
    const cssRect = { left, top, width, height };
    const rect = screenRectToPdf(cssRect, pageTransformRef.current, renderScale);
    setSelectionPreview(null);
    if (activeTool === "editImage") {
      imageTargetRef.current = rect;
      const cropped = canvasRef.current ? extractDataUrlFromCanvas(rect, canvasRef.current, pageTransformRef.current, renderScale, renderSize) : null;
      if (cropped) {
        const markupId = appendMarkup({
          pageNumber,
          kind: "image",
          rect,
          originalRect: rect,
          dataUrl: cropped,
        });
        setSelectedMarkupId(markupId);
        setActiveTool("select");
        setSearchMessage("Image selected! Drag to move, or pull the corner handle to resize.");
      } else {
        imageInputRef.current?.click();
      }
    } else if (activeTool === "highlight") {
      appendMarkup({ pageNumber, kind: "highlight", rect });
    } else if (activeTool === "shape") {
      const startPoint = screenPointToPdf(start, pageTransformRef.current, renderScale);
      const endPoint = screenPointToPdf(end, pageTransformRef.current, renderScale);
      appendMarkup({ pageNumber, kind: "shape", shape: shapeKind, rect, points: [startPoint, endPoint] });
    } else if (activeTool === "redact") {
      appendMarkup({ pageNumber, kind: redactKind, rect });
    } else if (activeTool === "signature" && pendingSignature) {
      appendMarkup({ pageNumber, kind: "signature", rect, dataUrl: pendingSignature });
      setPendingSignature(null);
      setActiveTool("select");
    }
  };

  const onMarkupPointerCancel = () => { pointerStartRef.current = null; setSelectionPreview(null); };

  const startMarkupTransform = (event: ReactPointerEvent<HTMLElement>, markup: PdfMarkup, resizing: boolean) => {
    if (activeTool !== "select" && activeTool !== "editImage") return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedMarkupId(markup.id);
    const point = getMarkupPoint(event);
    if (point && markup.rect) {
      transformStartMarkupsRef.current = documentMarkups;
      markupDragRef.current = { id: markup.id, pointer: screenPointToPdf(point, pageTransformRef.current, renderScale), rect: markup.rect, resizing };
    }
  };

  const onMarkupTransformMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = markupDragRef.current;
    const point = getMarkupPoint(event);
    if (!drag || !point) return;
    const current = screenPointToPdf(point, pageTransformRef.current, renderScale);
    const dx = current.x - drag.pointer.x;
    const dy = current.y - drag.pointer.y;
    const nextHeight = Math.max(8, drag.rect.height - dy);
    const actualDy = drag.rect.height - nextHeight;
    const nextY = drag.rect.y + actualDy;
    const nextWidth = Math.max(8, drag.rect.width + dx);
    const nextRect = drag.resizing
      ? { ...drag.rect, x: drag.rect.x, y: nextY, width: nextWidth, height: nextHeight }
      : { ...drag.rect, x: drag.rect.x + dx, y: drag.rect.y + dy };
    saveMarkups(documentMarkups.map((markup) => markup.id === drag.id ? { ...markup, rect: nextRect } : markup));
    markupDragRef.current = { ...drag, pointer: current, rect: nextRect };
  };

  const onMarkupTransformEnd = () => {
    if (markupDragRef.current && transformStartMarkupsRef.current) {
      const prevMarkups = transformStartMarkupsRef.current;
      transformStartMarkupsRef.current = null;
      if (JSON.stringify(prevMarkups) !== JSON.stringify(documentMarkups)) {
        pushHistory({ edits, markups: prevMarkups, addedBlankPages });
      }
    }
    markupDragRef.current = null;
  };

  const activateDetectedImage = (event: ReactPointerEvent<HTMLElement>, detected: DetectedPdfImage) => {
    event.stopPropagation();
    let dataUrl = detected.dataUrl;
    if (!dataUrl && canvasRef.current) {
      dataUrl = extractDataUrlFromCanvas(detected.rect, canvasRef.current, pageTransformRef.current, renderScale, renderSize) ?? undefined;
    }
    if (!dataUrl) return;

    const newMarkup: PdfMarkup = {
      id: detected.id,
      pageNumber,
      kind: "image",
      rect: detected.rect,
      originalRect: detected.rect,
      dataUrl,
    };

    pushHistory({ edits, markups: documentMarkups, addedBlankPages });
    const nextMarkups = [...documentMarkups, newMarkup];
    saveMarkups(nextMarkups);
    setSelectedMarkupId(newMarkup.id);
    transformStartMarkupsRef.current = nextMarkups;
    const point = getMarkupPoint(event);
    if (point) {
      markupDragRef.current = {
        id: newMarkup.id,
        pointer: screenPointToPdf(point, pageTransformRef.current, renderScale),
        rect: detected.rect,
        resizing: false,
      };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    setSearchMessage("Image selected. Drag to move, or pull the corner handle to resize.");
  };

  const onImageSelected = async (event: ReactChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const rect = imageTargetRef.current;
    event.target.value = "";
    if (!file || !rect) return;
    if (!file.type.startsWith("image/")) { setSearchMessage("Choose a PNG, JPG, or WEBP image."); return; }
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The selected image could not be prepared.");
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      const dataUrl = canvas.toDataURL("image/png");
      if (selectedMarkupId && documentMarkups.some((m) => m.id === selectedMarkupId && m.kind === "image")) {
        pushHistory({ edits, markups: documentMarkups, addedBlankPages });
        saveMarkups(documentMarkups.map((m) => m.id === selectedMarkupId ? { ...m, dataUrl } : m));
        setSearchMessage("Image replaced.");
      } else {
        appendMarkup({ pageNumber, kind: "image", rect, dataUrl });
        setSearchMessage("Image added. Drag to move, or pull the corner handle to resize.");
      }
      setActiveTool("select");
    } catch (reason) {
      setSearchMessage(reason instanceof Error ? reason.message : "The image could not be added.");
    }
  };

  const chooseMarkupDraft = (event: ReactFormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!markupDraft?.value.trim()) { setSearchMessage("Enter some text before saving this annotation."); return; }
    appendMarkup({ pageNumber: markupDraft.pageNumber, kind: markupDraft.kind, rect: markupDraft.rect, text: markupDraft.value.trim() });
    setMarkupDraft(null);
    setActiveTool("select");
  };

  const onWatermarkImageSelected = (event: ReactChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setSearchMessage("Choose a PNG, JPG, or WEBP image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setWmImageDataUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const applyWatermark = () => {
    const targetPages = wmPages === "all"
      ? Array.from({ length: totalPageCount }, (_, i) => i + 1)
      : [pageNumber];

    const stageWidth = renderSize.width || (612 * renderScale);
    const stageHeight = renderSize.height || (792 * renderScale);
    const cx = stageWidth / 2;
    const cy = stageHeight / 2;

    let initScreenWidth = Math.min(stageWidth * 0.7, 400);
    let initScreenHeight = Math.min(stageHeight * 0.35, 180);

    if (watermarkType === "image") {
      const scaleMul = (wmImageScale || 50) / 50;
      initScreenWidth = Math.min(stageWidth * 0.6 * scaleMul, stageWidth * 0.9);
      initScreenHeight = Math.min(stageHeight * 0.4 * scaleMul, stageHeight * 0.9);
    }

    const screenBox = {
      left: cx - initScreenWidth / 2,
      top: cy - initScreenHeight / 2,
      width: initScreenWidth,
      height: initScreenHeight,
    };

    const initialRect = screenRectToPdf(screenBox, pageTransformRef.current, renderScale);

    const newMarkups: PdfMarkup[] = targetPages.map((pageNum) => ({
      id: `wm-${crypto.randomUUID()}-${pageNum}`,
      pageNumber: pageNum,
      kind: "watermark",
      isWatermark: true,
      rect: initialRect,
      text: watermarkType === "text" ? wmText : undefined,
      dataUrl: watermarkType === "image" ? (wmImageDataUrl ?? undefined) : undefined,
      fontSize: wmFontSize,
      opacity: (watermarkType === "text" ? wmOpacity : wmImageOpacity) / 100,
      color: wmColor,
      rotation: watermarkType === "text" ? wmRotation : wmImageRotation,
      scale: wmImageScale,
      layer: wmLayer,
    }));

    pushHistory({ edits, markups: documentMarkups, addedBlankPages });
    saveMarkups([...documentMarkups, ...newMarkups]);
    setWatermarkModalOpen(false);
    setActiveTool("select");
    if (newMarkups.length > 0) {
      setSelectedMarkupId(newMarkups[0].id);
    }
    setSearchMessage(`Watermark applied. Click and drag to move, or pull the corner handle to resize.`);
  };

  const deleteSelectedMarkup = () => {
    if (!selectedMarkupId) return;
    const target = documentMarkups.find((m) => m.id === selectedMarkupId);
    pushHistory({ edits, markups: documentMarkups, addedBlankPages });
    if (target?.originalRect) {
      const eraseMarkup: PdfMarkup = {
        id: crypto.randomUUID(),
        pageNumber: target.pageNumber,
        kind: "erase",
        rect: target.originalRect,
      };
      saveMarkups([...documentMarkups.filter((markup) => markup.id !== selectedMarkupId), eraseMarkup]);
    } else {
      saveMarkups(documentMarkups.filter((markup) => markup.id !== selectedMarkupId));
    }
    setSelectedMarkupId(null);
    setSearchMessage("Selected object removed.");
  };

  const beginSignatureStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const bounds = canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * canvas.width / bounds.width;
    const y = (event.clientY - bounds.top) * canvas.height / bounds.height;
    canvas.setPointerCapture(event.pointerId);
    context.beginPath();
    context.moveTo(x, y);
    context.lineWidth = 3;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#172036";
    setSignatureHasInk(true);
  };

  const continueSignatureStroke = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!(event.buttons & 1)) return;
    const canvas = signatureCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const bounds = canvas.getBoundingClientRect();
    context.lineTo((event.clientX - bounds.left) * canvas.width / bounds.width, (event.clientY - bounds.top) * canvas.height / bounds.height);
    context.stroke();
  };

  const clearSignatureCanvas = () => {
    const canvas = signatureCanvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    setSignatureHasInk(false);
  };

  const saveSignature = () => {
    const canvas = signatureCanvasRef.current;
    if (!canvas || !signatureHasInk) return;
    setPendingSignature(canvas.toDataURL("image/png"));
    setSignatureModalOpen(false);
    setActiveTool("signature");
    setSearchMessage("Drag where the signature should appear.");
  };

  const addBlankPage = async () => {
    if (!pdfDocument) return;
    if (editingKey) commitInlineEdit();
    try {
      let pageSize = addedBlankPages[addedBlankPages.length - 1];
      if (!pageSize) {
        const lastPage = await pdfDocument.getPage(pdfDocument.numPages);
        pageSize = {
          width: lastPage.view[2] - lastPage.view[0],
          height: lastPage.view[3] - lastPage.view[1],
          kind: "blank",
        };
      } else {
        pageSize = {
          width: pageSize.width,
          height: pageSize.height,
          kind: "blank",
        };
      }
      if (pageSize.width <= 0 || pageSize.height <= 0) throw new Error("The current document page size is invalid.");

      pushHistory({ edits, markups: documentMarkups, addedBlankPages });
      const nextPages = [...addedBlankPages, pageSize];
      const nextPageNumber = pdfDocument.numPages + nextPages.length;
      setPageAddition({ documentId, pages: nextPages });
      setPageNumber(nextPageNumber);
      setShownThumbnails((count) => Math.max(count, nextPageNumber));
      setFitToPage(true);
      setSearchMessage("Blank page added. Download the edited PDF to keep it.");
    } catch {
      setSearchMessage("A blank page could not be added to this document.");
    }
  };

  const onUploadPageSelected = async (event: ReactChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (editingKey) commitInlineEdit();

    try {
      let defaultWidth = 612;
      let defaultHeight = 792;
      if (pdfDocument) {
        try {
          const p = await pdfDocument.getPage(1);
          defaultWidth = p.view[2] - p.view[0];
          defaultHeight = p.view[3] - p.view[1];
        } catch {
          // fallback
        }
      }

      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        setSearchMessage("Reading uploaded PDF pages…");
        const arrayBuffer = await file.arrayBuffer();
        const pdfjs = await import("pdfjs-dist");
        const donorDoc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer.slice(0)) }).promise;
        const donorPagesCount = donorDoc.numPages;
        if (donorPagesCount === 0) throw new Error("The uploaded PDF has no pages.");

        const newPages: BlankPageSize[] = [];
        for (let i = 1; i <= donorPagesCount; i++) {
          const page = await donorDoc.getPage(i);
          const vp = page.getViewport({ scale: 1.5 });
          const offscreen = document.createElement("canvas");
          offscreen.width = Math.ceil(vp.width);
          offscreen.height = Math.ceil(vp.height);
          const ctx = offscreen.getContext("2d");
          if (ctx) {
            await page.render({ canvas: offscreen, canvasContext: ctx, viewport: vp }).promise;
          }
          const pageImageUrl = offscreen.toDataURL("image/jpeg", 0.9);
          const pWidth = page.view[2] - page.view[0];
          const pHeight = page.view[3] - page.view[1];

          newPages.push({
            width: pWidth > 0 ? pWidth : defaultWidth,
            height: pHeight > 0 ? pHeight : defaultHeight,
            kind: "pdf",
            imageUrl: pageImageUrl,
            sourcePdfBytes: new Uint8Array(arrayBuffer),
            sourcePdfPageIndex: i - 1,
          });
        }

        pushHistory({ edits, markups: documentMarkups, addedBlankPages });
        const nextPages = [...addedBlankPages, ...newPages];
        const targetPage = (pdfDocument?.numPages ?? 0) + addedBlankPages.length + 1;
        setPageAddition({ documentId, pages: nextPages });
        setPageNumber(targetPage);
        setShownThumbnails((count) => Math.max(count, targetPage + newPages.length));
        setFitToPage(true);
        setSearchMessage(`${donorPagesCount} ${donorPagesCount === 1 ? "page" : "pages"} added from uploaded PDF.`);
      } else if (file.type.startsWith("image/")) {
        setSearchMessage("Processing uploaded image page…");
        const reader = new FileReader();
        const dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const img = await decodeImage(dataUrl);
        const imgAspect = img.width / img.height;
        let pWidth = defaultWidth;
        let pHeight = defaultHeight;
        if (imgAspect > 1.2) {
          pWidth = Math.max(defaultWidth, defaultHeight);
          pHeight = Math.min(defaultWidth, defaultHeight);
        }

        const newPage: BlankPageSize = {
          width: pWidth,
          height: pHeight,
          kind: "image",
          imageUrl: dataUrl,
        };

        pushHistory({ edits, markups: documentMarkups, addedBlankPages });
        const nextPages = [...addedBlankPages, newPage];
        const targetPage = (pdfDocument?.numPages ?? 0) + nextPages.length;
        setPageAddition({ documentId, pages: nextPages });
        setPageNumber(targetPage);
        setShownThumbnails((count) => Math.max(count, targetPage));
        setFitToPage(true);
        setSearchMessage("Image page uploaded and appended to document.");
      } else {
        setSearchMessage("Please choose a PDF or image file (PNG, JPG, WEBP).");
      }
    } catch (err) {
      setSearchMessage(err instanceof Error ? err.message : "Failed to add pages from uploaded file.");
    }
  };

  const toggleEditMode = () => {
    if (editMode) {
      if (editingKey) commitInlineEdit();
      setEditMode(false);
      setActiveTool("select");
      setEditNotice("");
      return;
    }
    setEditMode(true);
    setActiveTool("editText");
    setEditNotice(textRuns.length ? "Click any selectable text on the page to edit it." : "Scanned page: drag over the text you want to replace, then enter the replacement.");
  };

  const onEditPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!editMode || editingKey || event.target !== event.currentTarget || !pageSurfaceRef.current) return;
    const bounds = pageSurfaceRef.current.getBoundingClientRect();
    const currentScale = scaleRatio > 0 ? scaleRatio : 1;
    pointerStartRef.current = { x: (event.clientX - bounds.left) / currentScale, y: (event.clientY - bounds.top) / currentScale };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectionPreview({ left: pointerStartRef.current.x, top: pointerStartRef.current.y, width: 0, height: 0 });
  };

  const onEditPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointerStartRef.current || !pageSurfaceRef.current) return;
    const bounds = pageSurfaceRef.current.getBoundingClientRect();
    const currentScale = scaleRatio > 0 ? scaleRatio : 1;
    const end = { x: (event.clientX - bounds.left) / currentScale, y: (event.clientY - bounds.top) / currentScale };
    const start = pointerStartRef.current;
    setSelectionPreview({ left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) });
  };

  const onEditPointerUp = async (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    const surface = pageSurfaceRef.current;
    pointerStartRef.current = null;
    if (!start || !surface || !pdfDocument) return;
    const bounds = surface.getBoundingClientRect();
    const currentScale = scaleRatio > 0 ? scaleRatio : 1;
    const end = { x: (event.clientX - bounds.left) / currentScale, y: (event.clientY - bounds.top) / currentScale };
    const box = { left: Math.min(start.x, end.x), top: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
    if (box.width < 8 || box.height < 8) {
      setSelectionPreview(null);
      setEditNotice("Drag around a text area to set its replacement bounds.");
      return;
    }
    try {
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + rotation) % 360 });
      const corners = [
        viewport.convertToPdfPoint(box.left / renderScale, box.top / renderScale),
        viewport.convertToPdfPoint((box.left + box.width) / renderScale, box.top / renderScale),
        viewport.convertToPdfPoint((box.left + box.width) / renderScale, (box.top + box.height) / renderScale),
        viewport.convertToPdfPoint(box.left / renderScale, (box.top + box.height) / renderScale),
      ];
      const xs = corners.map(([x]) => x);
      const ys = corners.map(([, y]) => y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      const run: PdfTextRun = {
        key: `manual-${pageNumber}-${Date.now()}`,
        pageNumber,
        fontName: "",
        text: "",
        left: box.left / renderScale,
        top: box.top / renderScale,
        width: box.width / renderScale,
        height: box.height / renderScale,
        fontSize: Math.max(7, Math.min(18, box.height / renderScale * 0.72)),
        fontFamily: "Arial, sans-serif",
        fontWeight: 400,
        fontItalic: false,
        rotation: 0,
        manual: true,
        rect: { x, y, width: Math.max(1, Math.max(...xs) - x), height: Math.max(1, Math.max(...ys) - y) },
      };
      setDraftRun(run);
      draftTextRef.current = "";
      setDraftText("");
      setEditingKey(run.key);
      setSelectionPreview(null);
      setEditNotice("Type the replacement for the selected area, then press Enter to save.");
    } catch {
      setSelectionPreview(null);
      setEditNotice("This area could not be selected. Try again on the current page.");
    }
  };

  const buildEditedPdfBytes = async (currentEdits: PdfTextEdit[]): Promise<{ bytes: Uint8Array; usedFallbackFont: boolean; isFlattened: boolean }> => {
    const [{ PDFDocument, StandardFonts, rgb, degrees }, fontkitModule, response] = await Promise.all([
      import("pdf-lib"),
      import("@pdf-lib/fontkit"),
      fetch(fileUrl, { cache: "no-store" }),
    ]);
    if (!response.ok) throw new Error("The original PDF could not be loaded for export.");
    const sourceBytes = new Uint8Array(await response.arrayBuffer());

    // Rasterize the edited copy when a destructive erase/redaction is present.
    // This removes the covered source text and pixels rather than hiding them under a rectangle.
    const destructiveMarkup = documentMarkups.some((markup) => markup.kind === "redact" || markup.kind === "erase");
    if (destructiveMarkup) {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const sourceTask = pdfjs.getDocument({ data: sourceBytes });
      const sourcePdf = await sourceTask.promise;
      const flattenedPdf = await PDFDocument.create();
      for (let index = 1; index <= sourcePdf.numPages; index += 1) {
        const sourcePage = await sourcePdf.getPage(index);
        const baseViewport = sourcePage.getViewport({ scale: 1 });
        const scale = 2;
        const viewport = sourcePage.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("The redacted PDF could not be rendered for secure export.");
        await sourcePage.render({ canvas, canvasContext: context, viewport }).promise;
        const transform = [...baseViewport.transform] as PdfTransform;
        for (const edit of currentEdits.filter((entry) => entry.pageNumber === index)) {
          const box = pdfRectToScreen(edit.rect, transform, scale);
          if (edit.value) {
            context.font = `${Math.max(8, edit.fontSize * scale)}px ${edit.fontFamily}`;
            const textMetrics = context.measureText(edit.value);
            const boxWidth = Math.max(box.width, textMetrics.width + 8);
            context.fillStyle = edit.backgroundColor ?? "#fff";
            context.fillRect(box.left, box.top, boxWidth, box.height);
            context.fillStyle = edit.textColor ?? "#15181c";
            context.textBaseline = "middle";
            context.fillText(edit.value, box.left + 2, box.top + box.height / 2);
          } else {
            context.fillStyle = edit.backgroundColor ?? "#fff";
            context.fillRect(box.left, box.top, box.width, box.height);
          }
        }
        for (const markup of documentMarkups.filter((entry) => entry.pageNumber === index)) await paintMarkupCanvas(context, markup, transform, scale);
        const pagePng = new Uint8Array(await (await fetch(canvas.toDataURL("image/png"))).arrayBuffer());
        const image = await flattenedPdf.embedPng(pagePng);
        const page = flattenedPdf.addPage([baseViewport.width, baseViewport.height]);
        page.drawImage(image, { x: 0, y: 0, width: baseViewport.width, height: baseViewport.height });
        canvas.width = 0;
        canvas.height = 0;
      }
      await sourceTask.destroy();
      for (const pageSize of addedBlankPages) {
        if (pageSize.imageUrl) {
          try {
            const imgBytes = new Uint8Array(await (await fetch(pageSize.imageUrl)).arrayBuffer());
            const isJpg = pageSize.imageUrl.startsWith("data:image/jpeg") || pageSize.imageUrl.startsWith("data:image/jpg");
            const image = isJpg ? await flattenedPdf.embedJpg(imgBytes) : await flattenedPdf.embedPng(imgBytes).catch(async () => await flattenedPdf.embedJpg(imgBytes));
            const page = flattenedPdf.addPage([pageSize.width, pageSize.height]);
            page.drawImage(image, { x: 0, y: 0, width: pageSize.width, height: pageSize.height });
          } catch {
            flattenedPdf.addPage([pageSize.width, pageSize.height]);
          }
        } else {
          flattenedPdf.addPage([pageSize.width, pageSize.height]);
        }
      }
      const flattenedBytes = await flattenedPdf.save();
      return { bytes: flattenedBytes, usedFallbackFont: false, isFlattened: true };
    }

    const pdf = await PDFDocument.load(sourceBytes);
    const donorPdfDocs = new Map<Uint8Array, Awaited<ReturnType<typeof PDFDocument.load>>>();
    for (const pageSize of addedBlankPages) {
      if (pageSize.sourcePdfBytes && pageSize.sourcePdfPageIndex !== undefined) {
        try {
          let donor = donorPdfDocs.get(pageSize.sourcePdfBytes);
          if (!donor) {
            donor = await PDFDocument.load(pageSize.sourcePdfBytes);
            donorPdfDocs.set(pageSize.sourcePdfBytes, donor);
          }
          const [copiedPage] = await pdf.copyPages(donor, [pageSize.sourcePdfPageIndex]);
          pdf.addPage(copiedPage);
          continue;
        } catch (copyErr) {
          console.error("Failed to copy PDF page:", copyErr);
        }
      }
      if (pageSize.imageUrl) {
        try {
          const imgBytes = new Uint8Array(await (await fetch(pageSize.imageUrl)).arrayBuffer());
          const isJpg = pageSize.imageUrl.startsWith("data:image/jpeg") || pageSize.imageUrl.startsWith("data:image/jpg");
          const image = isJpg ? await pdf.embedJpg(imgBytes) : await pdf.embedPng(imgBytes).catch(async () => await pdf.embedJpg(imgBytes));
          const page = pdf.addPage([pageSize.width, pageSize.height]);
          page.drawImage(image, { x: 0, y: 0, width: pageSize.width, height: pageSize.height });
          continue;
        } catch (imgErr) {
          console.error("Failed to embed image page:", imgErr);
        }
      }
      pdf.addPage([pageSize.width, pageSize.height]);
    }
    pdf.registerFontkit(fontkitModule.default);
    const fontCache = new Map<string, Awaited<ReturnType<typeof pdf.embedFont>>>();
    let usedFallbackFont = false;
    for (const edit of currentEdits) {
      const page = pdf.getPage(edit.pageNumber - 1);
      if (!page) continue;
      const { x, y, width, height } = edit.rect;
      const backgroundRgb = parseHexColor(edit.backgroundColor) ?? [1, 1, 1];
      const textRgb = parseHexColor(edit.textColor) ?? [0.08, 0.09, 0.11];
      if (!edit.value) {
        page.drawRectangle({ x, y, width, height, color: rgb(...backgroundRgb) });
        continue;
      }
      const cacheKey = edit.fontName || `${edit.fontFamily}-${edit.fontWeight}-${edit.fontItalic}`;
      let font = fontCache.get(cacheKey);
      if (!font) {
        let embeddedFontData: Uint8Array | undefined;
        if (edit.fontName && pdfDocument) {
          const sourcePage = await pdfDocument.getPage(edit.pageNumber);
          await sourcePage.getOperatorList();
          embeddedFontData = getPdfFontBytes(await getPdfJsFont(sourcePage, edit.fontName));
        }
        if (embeddedFontData?.length) {
          try {
            font = await pdf.embedFont(embeddedFontData, { subset: true });
          } catch {
            usedFallbackFont = true;
          }
        }
        if (!font) {
          if (edit.fontName) usedFallbackFont = true;
          const family = edit.fontFamily.toLocaleLowerCase();
          const bold = edit.fontWeight >= 600;
          const italic = edit.fontItalic;
          const isCourier = /courier|mono|typewriter|consolas/.test(family);
          const isTimes = !isCourier && !/sans/.test(family) && /times|cambria|georgia|serif/.test(family);
          const standardFont = isCourier
            ? (bold ? (italic ? StandardFonts.CourierBoldOblique : StandardFonts.CourierBold) : (italic ? StandardFonts.CourierOblique : StandardFonts.Courier))
            : isTimes
              ? (bold ? (italic ? StandardFonts.TimesRomanBoldItalic : StandardFonts.TimesRomanBold) : (italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman))
              : (bold ? (italic ? StandardFonts.HelveticaBoldOblique : StandardFonts.HelveticaBold) : (italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica));
          font = await pdf.embedFont(standardFont);
          if (embeddedFontData?.length) usedFallbackFont = true;
        }
        fontCache.set(cacheKey, font);
      }
      const fontSize = Math.max(6, edit.fontSize);
      const textWidth = font.widthOfTextAtSize(edit.value, fontSize);
      const rectWidth = Math.max(width, textWidth + 4);
      page.drawRectangle({ x, y, width: rectWidth, height, color: rgb(...backgroundRgb) });
      page.drawText(edit.value, {
        x: x + 1,
        y: y + Math.max(0.5, (height - fontSize) / 2),
        size: fontSize,
        font,
        color: rgb(...textRgb),
        rotate: degrees(-edit.rotation * 180 / Math.PI),
      });
    }
    const annotationFont = await pdf.embedFont(StandardFonts.Helvetica);
    const annotationFontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (const markup of documentMarkups) {
      const page = pdf.getPage(markup.pageNumber - 1);
      if (!page) continue;

      if (markup.isWatermark || markup.kind === "watermark") {
        const pageWidth = page.getWidth();
        const pageHeight = page.getHeight();
        const rot = markup.rotation ?? -45;
        const opacity = markup.opacity ?? 0.25;

        const rect = markup.rect ?? {
          x: pageWidth * 0.15,
          y: pageHeight * 0.35,
          width: pageWidth * 0.7,
          height: pageHeight * 0.3,
        };

        if (markup.text) {
          const text = markup.text;
          const font = annotationFontBold;
          const estFontSize = Math.max(12, Math.min(rect.height * 0.55, (rect.width / Math.max(1, font.widthOfTextAtSize(text, 1))) * 0.9));
          const fontSize = markup.rect ? estFontSize : (markup.fontSize || 54);
          const textWidth = font.widthOfTextAtSize(text, fontSize);
          const textHeight = font.heightAtSize(fontSize);

          let r = 0.4, g = 0.45, b = 0.55;
          const col = (markup.color || "").toLowerCase();
          if (col.includes("ef4444") || col === "red") { r = 0.93; g = 0.26; b = 0.26; }
          else if (col.includes("3b82f6") || col === "blue") { r = 0.23; g = 0.51; b = 0.96; }
          else if (col.includes("0f172a") || col.includes("000000") || col === "black") { r = 0.05; g = 0.05; b = 0.05; }
          else if (col.includes("f59e0b") || col === "orange") { r = 0.96; g = 0.62; b = 0.04; }

          const rad = (rot * Math.PI) / 180;
          const cx = rect.x + rect.width / 2;
          const cy = rect.y + rect.height / 2;
          const x = cx - (textWidth / 2) * Math.cos(rad) + (textHeight / 2) * Math.sin(rad);
          const y = cy - (textWidth / 2) * Math.sin(rad) - (textHeight / 2) * Math.cos(rad);

          page.drawText(text, {
            x,
            y,
            size: fontSize,
            font,
            color: rgb(r, g, b),
            opacity,
            rotate: degrees(rot),
          });
        } else if (markup.dataUrl) {
          try {
            const imageBytes = new Uint8Array(await (await fetch(markup.dataUrl)).arrayBuffer());
            const isJpg = markup.dataUrl.startsWith("data:image/jpeg") || markup.dataUrl.startsWith("data:image/jpg");
            const image = isJpg ? await pdf.embedJpg(imageBytes) : await pdf.embedPng(imageBytes).catch(async () => await pdf.embedJpg(imageBytes));

            const imgWidth = rect.width;
            const imgHeight = rect.height;
            const imgX = rect.x;
            const imgY = rect.y;

            if (rot !== 0) {
              const rad = (rot * Math.PI) / 180;
              const cx = imgX + imgWidth / 2;
              const cy = imgY + imgHeight / 2;
              const drawX = cx - (imgWidth / 2) * Math.cos(rad) + (imgHeight / 2) * Math.sin(rad);
              const drawY = cy - (imgWidth / 2) * Math.sin(rad) - (imgHeight / 2) * Math.cos(rad);
              page.drawImage(image, {
                x: drawX,
                y: drawY,
                width: imgWidth,
                height: imgHeight,
                opacity,
                rotate: degrees(rot),
              });
            } else {
              page.drawImage(image, {
                x: imgX,
                y: imgY,
                width: imgWidth,
                height: imgHeight,
                opacity,
              });
            }
          } catch (imgErr) {
            console.error("Watermark embed error:", imgErr);
          }
        }

        if (markup.layer === "behind") {
          try {
            const contents = page.node.Contents();
            if (contents && "asArray" in contents && typeof (contents as { asArray: unknown }).asArray === "function") {
              const arr = (contents as { asArray: () => unknown[] }).asArray();
              if (arr.length >= 4) {
                const wmStream = arr.pop();
                if (wmStream) {
                  arr.splice(1, 0, wmStream);
                }
              }
            }
          } catch (err) {
            console.warn("Could not reorder watermark behind text:", err);
          }
        }
        continue;
      }

      if (!markup.rect) continue;
      const { x, y, width, height } = markup.rect;
      if (markup.kind === "highlight") {
        page.drawRectangle({ x, y, width, height, color: rgb(1, 0.88, 0.28), opacity: 0.36 });
      } else if (markup.kind === "erase" || markup.kind === "redact") {
        page.drawRectangle({ x, y, width, height, color: markup.kind === "redact" ? rgb(0.03, 0.03, 0.03) : rgb(1, 1, 1) });
      } else if (markup.kind === "image" || markup.kind === "signature") {
        if (markup.originalRect) {
          page.drawRectangle({
            x: markup.originalRect.x,
            y: markup.originalRect.y,
            width: markup.originalRect.width,
            height: markup.originalRect.height,
            color: rgb(1, 1, 1),
          });
        } else if (markup.kind === "image") {
          page.drawRectangle({ x, y, width, height, color: rgb(1, 1, 1) });
        }
        if (markup.dataUrl) {
          const imageBytes = new Uint8Array(await (await fetch(markup.dataUrl)).arrayBuffer());
          const isJpg = markup.dataUrl.startsWith("data:image/jpeg") || markup.dataUrl.startsWith("data:image/jpg");
          const image = isJpg ? await pdf.embedJpg(imageBytes) : await pdf.embedPng(imageBytes).catch(async () => await pdf.embedJpg(imageBytes));
          page.drawImage(image, { x, y, width, height });
        }
      } else if (markup.kind === "text" || markup.kind === "comment") {
        if (markup.kind === "comment") page.drawRectangle({ x, y, width, height, color: rgb(1, 0.96, 0.79), borderColor: rgb(0.83, 0.71, 0.31), borderWidth: 0.8 });
        page.drawText(markup.text ?? "", { x: x + 5, y: y + height - 17, size: 11, font: markup.kind === "comment" ? annotationFont : annotationFontBold, color: rgb(0.12, 0.14, 0.18), maxWidth: Math.max(1, width - 10), lineHeight: 14 });
      } else if (markup.kind === "shape") {
        const color = rgb(0.19, 0.37, 0.91);
        if (markup.shape === "circle") page.drawEllipse({ x: x + width / 2, y: y + height / 2, xScale: width / 2, yScale: height / 2, borderColor: color, borderWidth: 1.4 });
        else if (markup.shape === "line" || markup.shape === "arrow") {
          const start = markup.points?.[0] ?? { x, y };
          const end = markup.points?.[1] ?? { x: x + width, y: y + height };
          page.drawLine({ start, end, color, thickness: 1.4 });
          if (markup.shape === "arrow") {
            const angle = Math.atan2(end.y - start.y, end.x - start.x);
            const head = 8;
            page.drawLine({ start: end, end: { x: end.x - head * Math.cos(angle - Math.PI / 6), y: end.y - head * Math.sin(angle - Math.PI / 6) }, color, thickness: 1.4 });
            page.drawLine({ start: end, end: { x: end.x - head * Math.cos(angle + Math.PI / 6), y: end.y - head * Math.sin(angle + Math.PI / 6) }, color, thickness: 1.4 });
          }
        } else page.drawRectangle({ x, y, width, height, borderColor: color, borderWidth: 1.4 });
      }
    }
    const bytes = await pdf.save();
    return { bytes, usedFallbackFont, isFlattened: false };
  };

  const exportEditedPdf = async () => {
    const currentEditMap = { ...edits };
    if (editingKey && draftRun) currentEditMap[editingKey] = { ...draftRun, value: draftTextRef.current };
    const currentEdits = Object.values(currentEditMap).filter((edit) => edit.manual || edit.value !== edit.text);
    if (!currentEdits.length && !documentMarkups.length && !addedBlankPages.length) return;
    if (editingKey) commitInlineEdit();
    try {
      const result = await buildEditedPdfBytes(currentEdits);
      const blob = new Blob([result.bytes.buffer as ArrayBuffer], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${metadata?.filename.replace(/\.pdf$/i, "") || "document"} (edited).pdf`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      const pageNote = addedBlankPages.length ? ` ${addedBlankPages.length} blank page${addedBlankPages.length === 1 ? "" : "s"} appended.` : "";
      if (result.isFlattened) {
        setEditNotice("Edited PDF downloaded. Erase/redaction is permanently applied to the exported copy; pages are flattened to prevent covered source text from being recovered. The uploaded original is unchanged.");
      } else {
        setEditNotice(result.usedFallbackFont
          ? `Edited PDF downloaded.${pageNote} A close standard font was used where the source font could not be embedded. The original is unchanged.`
          : `Edited PDF downloaded.${pageNote} Your original file is unchanged.`);
      }
    } catch (reason) {
      setEditNotice(reason instanceof Error ? reason.message : "The edited PDF could not be exported.");
    }
  };

  const [exportingDocx, setExportingDocx] = useState(false);

  const exportWordDocument = async () => {
    if (exportingDocx) return;
    const currentEditMap = { ...edits };
    if (editingKey && draftRun) currentEditMap[editingKey] = { ...draftRun, value: draftTextRef.current };
    if (editingKey) commitInlineEdit();

    setExportingDocx(true);
    setSearchMessage("Converting PDF to Word (.docx) with 1:1 fidelity…");
    try {
      const currentEdits = Object.values(currentEditMap).filter((edit) => edit.manual || edit.value !== edit.text);
      const hasAnyEdits = currentEdits.length > 0 || documentMarkups.length > 0 || addedBlankPages.length > 0;

      let response: Response;

      const textOnlyEdits = currentEdits.length > 0
        && currentEdits.every((edit) => !edit.manual && Boolean(edit.text))
        && documentMarkups.length === 0
        && addedBlankPages.length === 0;

      if (textOnlyEdits) {
        // Let the DOCX exporter replace text in the source Word runs so their
        // original font, size, and character formatting survive the edit.
        response = await fetch(`/api/documents/${documentId}/docx`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ edits: currentEdits }),
        });
      } else if (hasAnyEdits) {
        // Build the edited PDF so the exported Word document includes all changes, text edits, and markups
        const result = await buildEditedPdfBytes(currentEdits);
        const payloadBlob = new Blob([result.bytes.buffer as ArrayBuffer], { type: "application/pdf" });
        response = await fetch(`/api/documents/${documentId}/docx`, {
          method: "POST",
          headers: { "Content-Type": "application/pdf" },
          body: payloadBlob,
        });
      } else {
        // No edits made: convert the original PDF directly into Word!
        response = await fetch(`/api/documents/${documentId}/docx`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ edits: [] }),
        });
      }

      if (!response.ok) {
        const errorJson = await response.json().catch(() => ({}));
        throw new Error(errorJson.error || "Failed to generate Word document.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      const baseName = metadata?.filename.replace(/\.(pdf|docx?|dotx?|docm)$/i, "") || "document";
      anchor.download = hasAnyEdits ? `${baseName} (edited).docx` : `${baseName}.docx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setEditNotice(hasAnyEdits
        ? "Word document (.docx) downloaded successfully with your edits."
        : "Word document (.docx) downloaded successfully.");
      setSearchMessage("Word document (.docx) downloaded.");
    } catch (error) {
      console.error("[exportWordDocument] failed:", error);
      setSearchMessage(error instanceof Error ? error.message : "Failed to export Word document.");
    } finally {
      setExportingDocx(false);
    }
  };

  const exportPdfDocument = async () => {
    const currentEditMap = { ...edits };
    if (editingKey && draftRun) currentEditMap[editingKey] = { ...draftRun, value: draftTextRef.current };
    const currentEdits = Object.values(currentEditMap).filter((edit) => edit.manual || edit.value !== edit.text);

    if (!currentEdits.length && !documentMarkups.length && !addedBlankPages.length) {
      downloadOriginal();
      return;
    }

    await exportEditedPdf();
  };

  const handleOpenShareModal = async () => {
    const currentEditMap = { ...edits };
    if (editingKey && draftRun) currentEditMap[editingKey] = { ...draftRun, value: draftTextRef.current };
    const currentEdits = Object.values(currentEditMap).filter((edit) => edit.manual || edit.value !== edit.text);
    const hasChanges = currentEdits.length > 0 || documentMarkups.length > 0 || addedBlankPages.length > 0;

    const baseName = metadata?.filename ? metadata.filename.replace(/\.pdf$/i, "") : "document";
    const finalName = hasChanges ? `${baseName} (edited).pdf` : `${baseName}.pdf`;

    if (hasChanges) {
      try {
        const result = await buildEditedPdfBytes(currentEdits);
        const blob = new Blob([result.bytes.buffer as ArrayBuffer], { type: "application/pdf" });
        const url = URL.createObjectURL(blob);
        setShareHref(url);
        setShareFileName(finalName);
        setShareFileSize(blob.size);
        setShareModalOpen(true);
      } catch (err) {
        console.error("Failed to build edited PDF for share:", err);
        setShareHref(`/api/documents/${documentId}/file?download=1`);
        setShareFileName(metadata?.filename || "document.pdf");
        setShareFileSize(metadata?.size);
        setShareModalOpen(true);
      }
    } else {
      setShareHref(`/api/documents/${documentId}/file?download=1`);
      setShareFileName(metadata?.filename || "document.pdf");
      setShareFileSize(metadata?.size);
      setShareModalOpen(true);
    }
  };

  const downloadFile = (url: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = "";
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
  };
  const downloadOriginal = () => downloadFile(`${originalFileUrl}?download=1`);
  const downloadCurrentPdf = () => downloadFile(`${fileUrl}?download=1`);
  const closeDocument = () => {
    void fetch(`/api/documents/${documentId}`, { method: "DELETE", cache: "no-store", keepalive: true });
    router.push("/");
  };
  const printOriginal = () => {
    const printWindow = window.open(`/documents/${documentId}/print`, "_blank");
    if (!printWindow) {
      setSearchMessage("Allow pop-ups for this site to open the print dialog.");
      return;
    }
    printWindow.opener = null;
  };
  const focusSearch = () => searchInputRef.current?.focus();
  const pageEdits = Object.values(edits).filter((edit) => edit.pageNumber === pageNumber);
  const pageHasEdits = pageEdits.length > 0;
  const pageHasMarkups = pageMarkups.length > 0;
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen?.();
  };

  if (error && !loading) {
    return (
      <main className={styles.errorPage}>
        <div className={styles.errorCard}>
          <AlertCircle size={24} aria-hidden="true" />
          <h1>Unable to open this PDF</h1>
          <p>{error}</p>
          <Button variant="secondary" onClick={closeDocument}>Back to upload</Button>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.workspace} data-view={viewMode}>
      <header className={styles.topbar}>
        <Button variant="secondary" size="sm" className={styles.backHomeButton} aria-label="Back to upload page" title="Back to upload page" onClick={closeDocument}>
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Back</span>
        </Button>

        <div className={styles.documentIdentity}>
          <FileText size={17} aria-hidden="true" />
          <span><strong title={metadata?.filename}>{metadata?.filename ?? "Loading document…"}</strong><small>{metadata ? formatSize(metadata.size) : `${totalPageCount || "—"} pages`}</small></span>
        </div>

        <div className={styles.topbarControls}>
          <div className={`${styles.toolbarGroup} ${styles.pageControls}`}>
            <Button variant="ghost" size="sm" aria-label="Previous page" title="Previous page" disabled={pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)}>
              <ChevronLeft size={16} aria-hidden="true" />
            </Button>
            <label className={styles.pageNumberLabel}>
              <span className={styles.srOnly}>Current page</span>
              <input type="number" min={1} max={totalPageCount || 1} value={pageNumber} onChange={(event) => goToPage(Number(event.target.value) || 1)} />
            </label>
            <span className={styles.pageCount}>/ {totalPageCount || "—"}</span>
            <Button variant="ghost" size="sm" aria-label="Next page" title="Next page" disabled={!totalPageCount || pageNumber >= totalPageCount} onClick={() => goToPage(pageNumber + 1)}>
              <ChevronRight size={16} aria-hidden="true" />
            </Button>
          </div>

          <div className={`${styles.toolbarGroup} ${styles.zoomControls}`}>
            <Button variant="ghost" size="sm" aria-label="Zoom out" title="Zoom out" onClick={zoomOut}><ZoomOut size={15} aria-hidden="true" /></Button>
            <span className={styles.zoomValue}>{fitToPage ? "Fit" : `${Math.round(zoom * 100)}%`}</span>
            <Button variant="ghost" size="sm" aria-label="Zoom in" title="Zoom in" onClick={zoomIn}><ZoomIn size={15} aria-hidden="true" /></Button>
            <Button variant="ghost" size="sm" aria-label="Fit page" title="Fit page" onClick={() => setFitToPage(true)}><Maximize size={14} aria-hidden="true" /></Button>
          </div>

          <ExpandingButtonGroup label="Document viewing mode" items={viewItems} defaultExpanded={viewMode} className={styles.viewTabs} />

          <div className={styles.toolbarSearch}>
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchInputRef}
              aria-label="Search in document"
              placeholder="Search in document…"
              value={searchQuery}
              onChange={(event) => { setSearchQuery(event.target.value); setSearchMessage(""); }}
              onKeyDown={onSearchKeyDown}
            />
            {searchQuery && <Button type="button" variant="ghost" size="sm" onClick={() => { setSearchQuery(""); setSearchMessage(""); }} aria-label="Clear search" title="Clear search">×</Button>}
          </div>

          <div className={styles.topbarActions}>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Share document link"
              title="Share File Link"
              onClick={() => void handleOpenShareModal()}
            >
              <Share2 size={16} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" aria-label={viewMode === "clean" ? "Download cleaned PDF" : "Download original PDF"} title={viewMode === "clean" ? "Download cleaned PDF" : "Download original PDF"} onClick={downloadCurrentPdf} disabled={!metadata || (viewMode === "clean" && ocrStatus.status !== "completed")}><Download size={16} aria-hidden="true" /></Button>
            <Button variant="ghost" size="sm" aria-label="Open original PDF for printing" title="Print original PDF" onClick={printOriginal} disabled={!metadata}><Printer size={16} aria-hidden="true" /></Button>
            <Button variant="ghost" size="sm" aria-label="Toggle document details" title="Document details and extracted text" onClick={() => setShowDetails((shown) => !shown)}><PanelRight size={16} aria-hidden="true" /></Button>
            <div className={styles.topbarThemeToggle}>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className={styles.toolStrip}>
        <div className={styles.toolStripActions} role="toolbar" aria-label="PDF editing tools">
          <Button
            variant="ghost"
            size="sm"
            className={styles.toolIconButton}
            aria-label="Undo (Ctrl+Z)"
            title={undoStack.length > 0 ? "Undo (Ctrl+Z)" : "Undo"}
            disabled={undoStack.length === 0}
            onClick={handleUndo}
          >
            <Undo2 size={17} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={styles.toolIconButton}
            aria-label="Redo (Ctrl+Y)"
            title={redoStack.length > 0 ? "Redo (Ctrl+Y)" : "Redo"}
            disabled={redoStack.length === 0}
            onClick={handleRedo}
          >
            <Redo2 size={17} aria-hidden="true" />
          </Button>
          <span className={styles.toolStripDivider} aria-hidden="true" />
          <Button variant="ghost" size="sm" className={`${styles.toolIconButton} ${activeTool === "select" ? styles.toolIconButtonActive : ""}`} aria-pressed={activeTool === "select"} aria-label="Select Tool — Select text, objects, images, and annotations" title="Select Tool" onClick={() => activateTool("select")}><MousePointer2 size={17} aria-hidden="true" /></Button>
          <Button variant="ghost" size="sm" className={`${styles.toolIconButton} ${activeTool === "editText" ? styles.toolIconButtonActive : ""}`} aria-pressed={activeTool === "editText"} aria-label="Edit Text — Replace existing PDF text" title="Edit Text" onClick={() => activeTool === "editText" ? activateTool("select") : activateTool("editText")}><TextCursorInput size={17} aria-hidden="true" /></Button>
          <Button variant="ghost" size="sm" className={`${styles.toolIconButton} ${activeTool === "editImage" ? styles.toolIconButtonActive : ""}`} aria-pressed={activeTool === "editImage"} aria-label="Edit Image — Select an image area and replace it" title="Edit Image" onClick={() => activateTool("editImage")}><ImageIcon size={17} aria-hidden="true" /></Button>
          <Button variant="ghost" size="sm" className={`${styles.toolIconButton} ${activeTool === "addText" ? styles.toolIconButtonActive : ""}`} aria-pressed={activeTool === "addText"} aria-label="Add Text — Place new text on the page" title="Add Text" onClick={() => activateTool("addText")}><Type size={17} aria-hidden="true" /></Button>
          <Button variant="ghost" size="sm" className={styles.toolIconButton} aria-label="Add Signature — Draw a signature stamp" title="Add Signature" onClick={() => { activateTool("signature"); clearSignatureCanvas(); setSignatureModalOpen(true); }}><PenLine size={17} aria-hidden="true" /></Button>
          <Button variant="ghost" size="sm" className={`${styles.toolIconButton} ${activeTool === "highlight" ? styles.toolIconButtonActive : ""}`} aria-pressed={activeTool === "highlight"} aria-label="Highlight — Drag to highlight page content" title="Highlight" onClick={() => activateTool("highlight")}><Highlighter size={17} aria-hidden="true" /></Button>
          <Button variant="ghost" size="sm" className={`${styles.toolIconButton} ${activeTool === "comment" ? styles.toolIconButtonActive : ""}`} aria-pressed={activeTool === "comment"} aria-label="Add Comment — Place a note on the page" title="Add Comment" onClick={() => activateTool("comment")}><MessageSquarePlus size={17} aria-hidden="true" /></Button>
          <div className={styles.toolMenuWrap}>
            <Button variant="ghost" size="sm" className={`${styles.toolIconButton} ${activeTool === "shape" ? styles.toolIconButtonActive : ""}`} aria-pressed={activeTool === "shape"} aria-label="Shapes — Choose rectangle, circle, line, or arrow" title="Shapes" aria-expanded={shapeMenuOpen} onClick={() => { setShapeMenuOpen((open) => !open); setRedactMenuOpen(false); activateTool("shape"); }}><Shapes size={17} aria-hidden="true" /></Button>
            {shapeMenuOpen && <div className={styles.toolPopover} role="group" aria-label="Shape types">
              <Button variant="ghost" size="sm" className={styles.toolIconButton} aria-label="Rectangle shape" title="Rectangle" onClick={() => { setShapeKind("rectangle"); setShapeMenuOpen(false); setSearchMessage("Drag to draw a rectangle."); }}><Square size={17} aria-hidden="true" /></Button>
              <Button variant="ghost" size="sm" className={styles.toolIconButton} aria-label="Circle shape" title="Circle" onClick={() => { setShapeKind("circle"); setShapeMenuOpen(false); setSearchMessage("Drag to draw an ellipse."); }}><Circle size={17} aria-hidden="true" /></Button>
              <Button variant="ghost" size="sm" className={styles.toolIconButton} aria-label="Line shape" title="Line" onClick={() => { setShapeKind("line"); setShapeMenuOpen(false); setSearchMessage("Drag to draw a line."); }}><Minus size={17} aria-hidden="true" /></Button>
              <Button variant="ghost" size="sm" className={styles.toolIconButton} aria-label="Arrow shape" title="Arrow" onClick={() => { setShapeKind("arrow"); setShapeMenuOpen(false); setSearchMessage("Drag to draw an arrow."); }}><ArrowRight size={17} aria-hidden="true" /></Button>
            </div>}
          </div>
          <div className={styles.toolMenuWrap}>
            <Button variant="ghost" size="sm" className={`${styles.toolIconButton} ${activeTool === "redact" ? styles.toolIconButtonActive : ""}`} aria-pressed={activeTool === "redact"} aria-label="Erase or permanently redact page content" title="Erase / Redact" aria-expanded={redactMenuOpen} onClick={() => { setRedactMenuOpen((open) => !open); setShapeMenuOpen(false); setWatermarkMenuOpen(false); }}><Eraser size={17} aria-hidden="true" /></Button>
            {redactMenuOpen && <div className={styles.toolPopover} role="group" aria-label="Erase and redaction modes">
              <Button variant="ghost" size="sm" className={styles.toolIconButton} aria-label="Erase selected area" title="Erase area" onClick={() => { setRedactKind("erase"); setRedactMenuOpen(false); activateTool("redact"); }}><Eraser size={17} aria-hidden="true" /></Button>
              <Button variant="ghost" size="sm" className={styles.toolIconButton} aria-label="Permanently redact selected area" title="Permanent redaction" onClick={() => { setRedactKind("redact"); setRedactMenuOpen(false); activateTool("redact"); }}><Square size={17} aria-hidden="true" /></Button>
            </div>}
          </div>
          <div className={styles.toolMenuWrap}>
            <Button
              variant="ghost"
              size="sm"
              className={`${styles.toolIconButton} ${activeTool === "watermark" ? styles.toolIconButtonActive : ""}`}
              aria-pressed={activeTool === "watermark"}
              aria-label="Add Watermark"
              title="Add Watermark"
              aria-expanded={watermarkMenuOpen}
              onClick={() => {
                setWatermarkMenuOpen((open) => !open);
                setShapeMenuOpen(false);
                setRedactMenuOpen(false);
              }}
            >
              <Stamp size={17} aria-hidden="true" />
            </Button>
            {watermarkMenuOpen && (
              <div className={styles.toolPopover} role="group" aria-label="Watermark types">
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.toolIconButton}
                  aria-label="Text Watermark"
                  title="Text Watermark"
                  onClick={() => {
                    setWatermarkMenuOpen(false);
                    setWatermarkType("text");
                    setWatermarkModalOpen(true);
                  }}
                >
                  <Type size={17} aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={styles.toolIconButton}
                  aria-label="Image Watermark"
                  title="Image Watermark"
                  onClick={() => {
                    setWatermarkMenuOpen(false);
                    setWatermarkType("image");
                    setWatermarkModalOpen(true);
                  }}
                >
                  <ImageIcon size={17} aria-hidden="true" />
                </Button>
              </div>
            )}
          </div>
          {selectedMarkupId && <Button variant="ghost" size="sm" className={styles.toolIconButton} aria-label="Delete selected annotation" title="Delete selected annotation" onClick={deleteSelectedMarkup}><Trash2 size={17} aria-hidden="true" /></Button>}
        </div>
        <div className={styles.toolStripEnd}>
          {editMode && <span className={styles.editHint} role="status">{editNotice || (textRuns.length ? "Click text to edit" : "Drag over text to replace it")}</span>}
          <div className={styles.exportGroup}>
            <Button
              variant="ghost"
              size="sm"
              className={`${styles.toolIconButton} ${styles.exportDocxButton}`}
              aria-label="Download Word document (.docx)"
              title="Download Word (.docx)"
              disabled={exportingDocx}
              onClick={() => void exportWordDocument()}
            >
              <NextImage src="/icons/word-workspace.png" alt="" width={26} height={26} className={styles.exportFileIcon} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={`${styles.toolIconButton} ${styles.exportPdfButton}`}
              aria-label="Download PDF document (.pdf)"
              title="Download PDF (.pdf)"
              onClick={() => void exportPdfDocument()}
            >
              <NextImage src="/flat-pdf-document-icon.webp" alt="" width={26} height={26} className={styles.exportFileIcon} />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={styles.toolIconButton}
              aria-label="Share document link"
              title="Share File Link"
              onClick={() => void handleOpenShareModal()}
            >
              <Share2 size={17} aria-hidden="true" />
            </Button>
          </div>
          {!editMode && !pageHasEdits && documentMarkups.length === 0 && addedBlankPages.length === 0 && <div className={styles.toolStripStatus}><span className={styles.statusDot} /><span>{ocrStatus.status === "failed" ? "OCR failed" : viewMode === "clean" ? "Clean OCR PDF" : ocrStatus.status === "processing" ? "OCR processing" : "Original PDF"}</span><span className={styles.statusDivider} />{ocrStatus.status === "failed" ? "Open Page text for details" : viewMode === "clean" ? "Searchable text added; original preserved" : "The uploaded file remains unchanged"}</div>}
          {!editMode && (pageHasEdits || documentMarkups.length > 0 || addedBlankPages.length > 0) && <div className={styles.toolStripStatus}><span className={styles.statusDot} /><span>Edited preview</span><span className={styles.statusDivider} />Original file is unchanged</div>}
        </div>
      </div>

      <input ref={imageInputRef} className={styles.hiddenInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Choose a replacement image" onChange={(event) => void onImageSelected(event)} />
      <input
        ref={watermarkImageInputRef}
        className={styles.hiddenInput}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="Choose watermark image"
        onChange={onWatermarkImageSelected}
      />
      {signatureModalOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSignatureModalOpen(false); }}>
        <section className={styles.signatureModal} role="dialog" aria-modal="true" aria-labelledby="signature-title">
          <div className={styles.signatureModalHeader}><div><h2 id="signature-title">Draw signature</h2><p>This inserts a visual signature stamp into the edited copy.</p></div><Button variant="ghost" size="sm" aria-label="Close signature dialog" title="Close" onClick={() => setSignatureModalOpen(false)}>×</Button></div>
          <canvas ref={signatureCanvasRef} className={styles.signatureCanvas} width={480} height={160} aria-label="Signature drawing area" onPointerDown={beginSignatureStroke} onPointerMove={continueSignatureStroke} />
          <div className={styles.signatureModalActions}><Button variant="ghost" size="sm" onClick={clearSignatureCanvas}><Eraser size={14} aria-hidden="true" /> Clear</Button><span /><Button variant="secondary" size="sm" onClick={() => setSignatureModalOpen(false)}>Cancel</Button><Button variant="primary" size="sm" disabled={!signatureHasInk} onClick={saveSignature}>Place signature</Button></div>
        </section>
      </div>}

      {watermarkModalOpen && (
        <div
          className={styles.modalBackdrop}
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setWatermarkModalOpen(false);
          }}
        >
          <section className={styles.watermarkModal} role="dialog" aria-modal="true" aria-labelledby="watermark-title">
            <div className={styles.signatureModalHeader}>
              <div>
                <h2 id="watermark-title" style={{ fontSize: "16px", fontWeight: 700 }}>
                  {watermarkType === "text" ? "Add Text Watermark" : "Add Image Watermark"}
                </h2>
                <p style={{ fontSize: "12px", color: "var(--muted-foreground, #71717a)" }}>
                  Configure watermark style, position & target pages
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                aria-label="Close watermark dialog"
                title="Close"
                onClick={() => setWatermarkModalOpen(false)}
              >
                ×
              </Button>
            </div>

            <div className={styles.watermarkPreviewBox}>
              {watermarkType === "text" ? (
                <span
                  style={{
                    transform: `rotate(${wmRotation}deg)`,
                    fontSize: `${Math.min(30, Math.max(15, wmFontSize * 0.42))}px`,
                    fontWeight: 800,
                    color: wmColor,
                    opacity: wmOpacity / 100,
                    letterSpacing: "0.15em",
                    textTransform: "uppercase",
                    userSelect: "none",
                  }}
                >
                  {wmText || "WATERMARK"}
                </span>
              ) : wmImageDataUrl ? (
                <NextImage
                  src={wmImageDataUrl}
                  alt="Watermark preview"
                  width={200}
                  height={80}
                  unoptimized
                  style={{
                    transform: `rotate(${wmImageRotation}deg)`,
                    maxWidth: "80%",
                    maxHeight: "80px",
                    objectFit: "contain",
                    opacity: wmImageOpacity / 100,
                  }}
                />
              ) : (
                <span style={{ fontSize: "12px", color: "#888" }}>No image selected yet</span>
              )}
            </div>

            {watermarkType === "text" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                <div className={styles.watermarkSection}>
                  <label style={{ display: "block", fontWeight: 600, fontSize: "12px" }}>Watermark Text</label>
                  <input
                    type="text"
                    value={wmText}
                    onChange={(e) => setWmText(e.target.value)}
                    className={styles.watermarkInput}
                    placeholder="CONFIDENTIAL, DRAFT, etc."
                  />
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "2px" }}>
                    {["CONFIDENTIAL", "DRAFT", "COPY", "DO NOT SHARE"].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setWmText(preset)}
                        className={`${styles.watermarkPill} ${wmText === preset ? styles.watermarkPillActive : ""}`}
                      >
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>

                <div className={styles.watermarkSection}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <label style={{ fontWeight: 600, fontSize: "12px" }}>Font Size</label>
                        <span style={{ fontSize: "12px", color: "#71717a" }}>{wmFontSize}pt</span>
                      </div>
                      <input
                        type="range"
                        min={24}
                        max={120}
                        step={2}
                        value={wmFontSize}
                        onChange={(e) => setWmFontSize(Number(e.target.value))}
                        className={styles.watermarkSlider}
                      />
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <label style={{ fontWeight: 600, fontSize: "12px" }}>Opacity</label>
                        <span style={{ fontSize: "12px", color: "#71717a" }}>{wmOpacity}%</span>
                      </div>
                      <input
                        type="range"
                        min={5}
                        max={100}
                        step={5}
                        value={wmOpacity}
                        onChange={(e) => setWmOpacity(Number(e.target.value))}
                        className={styles.watermarkSlider}
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.watermarkSection}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", alignItems: "center" }}>
                    <div>
                      <label style={{ display: "block", marginBottom: "6px", fontWeight: 600, fontSize: "12px" }}>Color</label>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        {[
                          { name: "Gray", val: "#64748b" },
                          { name: "Red", val: "#ef4444" },
                          { name: "Blue", val: "#3b82f6" },
                          { name: "Black", val: "#0f172a" },
                          { name: "Orange", val: "#f59e0b" },
                        ].map((c) => (
                          <button
                            key={c.val}
                            type="button"
                            onClick={() => setWmColor(c.val)}
                            style={{
                              width: "22px",
                              height: "22px",
                              borderRadius: "50%",
                              background: c.val,
                              border: wmColor === c.val ? "2px solid #fff" : "1px solid #d1d5db",
                              outline: wmColor === c.val ? "2px solid #09090b" : "none",
                              cursor: "pointer",
                              transition: "transform 0.15s ease",
                              transform: wmColor === c.val ? "scale(1.15)" : "scale(1)",
                            }}
                            title={c.name}
                          />
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={{ display: "block", marginBottom: "6px", fontWeight: 600, fontSize: "12px" }}>Rotation</label>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          onClick={() => setWmRotation(-45)}
                          className={`${styles.watermarkSegmentBtn} ${wmRotation === -45 ? styles.watermarkSegmentBtnActive : ""}`}
                        >
                          Diagonal (-45°)
                        </button>
                        <button
                          type="button"
                          onClick={() => setWmRotation(0)}
                          className={`${styles.watermarkSegmentBtn} ${wmRotation === 0 ? styles.watermarkSegmentBtnActive : ""}`}
                        >
                          Horizontal (0°)
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                <div className={styles.watermarkSection}>
                  <label style={{ display: "block", marginBottom: "4px", fontWeight: 600, fontSize: "12px" }}>Image File</label>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => watermarkImageInputRef.current?.click()}
                    style={{ width: "100%", justifyContent: "center", borderRadius: "10px" }}
                  >
                    <ImageIcon size={15} style={{ marginRight: "6px" }} />
                    {wmImageDataUrl ? "Change Image…" : "Select Image (PNG, JPG, WEBP)…"}
                  </Button>
                </div>

                <div className={styles.watermarkSection}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <label style={{ fontWeight: 600, fontSize: "12px" }}>Scale</label>
                        <span style={{ fontSize: "12px", color: "#71717a" }}>{wmImageScale}%</span>
                      </div>
                      <input
                        type="range"
                        min={10}
                        max={100}
                        step={5}
                        value={wmImageScale}
                        onChange={(e) => setWmImageScale(Number(e.target.value))}
                        className={styles.watermarkSlider}
                      />
                    </div>
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                        <label style={{ fontWeight: 600, fontSize: "12px" }}>Opacity</label>
                        <span style={{ fontSize: "12px", color: "#71717a" }}>{wmImageOpacity}%</span>
                      </div>
                      <input
                        type="range"
                        min={5}
                        max={100}
                        step={5}
                        value={wmImageOpacity}
                        onChange={(e) => setWmImageOpacity(Number(e.target.value))}
                        className={styles.watermarkSlider}
                      />
                    </div>
                  </div>
                </div>

                <div className={styles.watermarkSection}>
                  <label style={{ display: "block", marginBottom: "6px", fontWeight: 600, fontSize: "12px" }}>Rotation</label>
                  <div style={{ display: "flex", gap: "6px" }}>
                    <button
                      type="button"
                      onClick={() => setWmImageRotation(0)}
                      className={`${styles.watermarkSegmentBtn} ${wmImageRotation === 0 ? styles.watermarkSegmentBtnActive : ""}`}
                    >
                      Straight (0°)
                    </button>
                    <button
                      type="button"
                      onClick={() => setWmImageRotation(-45)}
                      className={`${styles.watermarkSegmentBtn} ${wmImageRotation === -45 ? styles.watermarkSegmentBtnActive : ""}`}
                    >
                      Diagonal (-45°)
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Placement Layer Option: Behind vs In Front */}
            <div className={styles.watermarkSection}>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: 600, fontSize: "11px" }}>
                Placement (Layer)
              </label>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => setWmLayer("behind")}
                  className={`${styles.watermarkSegmentBtn} ${wmLayer === "behind" ? styles.watermarkSegmentBtnActive : ""}`}
                >
                  Behind Text (Peeche)
                </button>
                <button
                  type="button"
                  onClick={() => setWmLayer("front")}
                  className={`${styles.watermarkSegmentBtn} ${wmLayer === "front" ? styles.watermarkSegmentBtnActive : ""}`}
                >
                  In Front of Text (Aage)
                </button>
              </div>
            </div>

            <div className={styles.watermarkSection}>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: 600, fontSize: "11px" }}>Apply To</label>
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  type="button"
                  onClick={() => setWmPages("all")}
                  className={`${styles.watermarkSegmentBtn} ${wmPages === "all" ? styles.watermarkSegmentBtnActive : ""}`}
                >
                  All Pages ({totalPageCount || 1})
                </button>
                <button
                  type="button"
                  onClick={() => setWmPages("current")}
                  className={`${styles.watermarkSegmentBtn} ${wmPages === "current" ? styles.watermarkSegmentBtnActive : ""}`}
                >
                  Current Page (p. {pageNumber})
                </button>
              </div>
            </div>

            <div className={styles.signatureModalActions}>
              <span />
              <Button variant="secondary" size="sm" style={{ borderRadius: "10px" }} onClick={() => setWatermarkModalOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                style={{ borderRadius: "10px" }}
                disabled={watermarkType === "text" ? !wmText.trim() : !wmImageDataUrl}
                onClick={applyWatermark}
              >
                Apply Watermark
              </Button>
            </div>
          </section>
        </div>
      )}

      <div className={styles.workspaceBody}>
        <nav className={styles.sideRail} aria-label="Workspace tools">
          <Button variant="ghost" size="sm" className={`${styles.railButton} ${showThumbnails ? styles.railButtonActive : ""}`} aria-label="Toggle pages panel" aria-pressed={showThumbnails} title="Pages" onClick={() => setShowThumbnails((shown) => !shown)}><PanelLeft size={18} aria-hidden="true" /></Button>
          <Button variant="ghost" size="sm" className={`${styles.railButton} ${editMode ? styles.railButtonActive : ""}`} aria-pressed={editMode} aria-label={editMode ? "Finish editing PDF" : "Edit PDF text"} title={editMode ? "Finish editing" : "Edit PDF text"} onClick={toggleEditMode}><Pencil size={18} aria-hidden="true" /></Button>
          <Button variant="ghost" size="sm" className={`${styles.railButton} ${showDetails ? styles.railButtonActive : ""}`} aria-label="Toggle text and document information" aria-pressed={showDetails} title="Text and document information" onClick={() => setShowDetails((shown) => !shown)}><FileText size={18} aria-hidden="true" /></Button>
          <Button variant="ghost" size="sm" className={styles.railButton} aria-label="Find text" title="Find text" onClick={focusSearch}><Search size={18} aria-hidden="true" /></Button>
          <Button variant="ghost" size="sm" className={styles.railButton} aria-label="Download original PDF" title="Download original PDF" onClick={downloadOriginal} disabled={!metadata}><Download size={18} aria-hidden="true" /></Button>
        </nav>

        <div className={styles.contentGrid}>
          {showThumbnails && (
            <aside className={styles.thumbnailRail} aria-label="PDF pages">
              <div className={styles.railHeading}>
                <h2>Thumbnails</h2>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>{totalPageCount || "—"}</span>
                  <button
                    type="button"
                    className={styles.railCloseButton}
                    aria-label="Close thumbnails"
                    title="Close thumbnails"
                    onClick={() => setShowThumbnails(false)}
                  >
                    ×
                  </button>
                </div>
              </div>
              {pdfDocument ? (
                <div className={styles.thumbnailList}>
                  {Array.from({ length: Math.min(totalPageCount, shownThumbnails) }, (_, index) => index + 1).map((page) => page <= pdfDocument.numPages ? (
                    <PdfThumbnail key={page} document={pdfDocument} pageNumber={page} active={page === pageNumber} onSelect={goToPage} />
                  ) : (
                    <BlankPageThumbnail key={page} pageData={addedBlankPages[page - pdfDocument.numPages - 1]} pageNumber={page} active={page === pageNumber} onSelect={goToPage} />
                  ))}
                  {shownThumbnails < totalPageCount && (
                    <Button variant="ghost" size="sm" onClick={() => setShownThumbnails((count) => Math.min(totalPageCount, count + 12))}>
                      Show more pages
                    </Button>
                  )}
                </div>
              ) : (
                <div className={styles.thumbnailLoading}>{loading ? "Loading pages…" : "No pages to show"}</div>
              )}
              <div className={styles.addPageWrap} ref={addPageMenuRef}>
                {addPageMenuOpen && (
                  <div className={styles.addPageMenu} role="menu" aria-label="Add page options">
                    <button
                      type="button"
                      className={styles.addPageMenuItem}
                      role="menuitem"
                      onClick={() => {
                        setAddPageMenuOpen(false);
                        void addBlankPage();
                      }}
                    >
                      <FilePlus size={15} aria-hidden="true" />
                      <span>Blank Page</span>
                    </button>
                    <button
                      type="button"
                      className={styles.addPageMenuItem}
                      role="menuitem"
                      onClick={() => {
                        setAddPageMenuOpen(false);
                        uploadPageInputRef.current?.click();
                      }}
                    >
                      <Upload size={15} aria-hidden="true" />
                      <span>Upload Page</span>
                    </button>
                  </div>
                )}
                <input
                  ref={uploadPageInputRef}
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp"
                  style={{ display: "none" }}
                  onChange={onUploadPageSelected}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  className={styles.addPageButton}
                  aria-label="Add a page to the PDF"
                  title="Add a page to the PDF"
                  disabled={!pdfDocument}
                  onClick={() => setAddPageMenuOpen((open) => !open)}
                >
                  <Plus size={14} aria-hidden="true" />
                  <span>Add Page</span>
                </Button>
              </div>
            </aside>
          )}

          <section className={styles.documentStage} ref={stageRef} aria-label="PDF preview">
            <div className={styles.stageHeading}>
              <span className={styles.stageMode}><span /> {pageHasEdits || pageHasMarkups || addedBlankPages.length > 0 ? "EDITED PREVIEW" : editMode ? "EDIT MODE" : viewMode === "clean" ? "CLEAN OCR PDF" : "ORIGINAL PDF"}</span>
              <span className={styles.stageNote}>{metadata?.filename ?? "PDF document"}</span>
            </div>
            <div ref={viewportRef} className={styles.pageViewport}>
              {loading && <div className={styles.loadingMessage}><span className={styles.spinner} />Loading your PDF…</div>}
              {pdfDocument && (
                <div
                  className={styles.pageSurfaceWrapper}
                  style={{
                    width: renderSize.width ? Math.floor(renderSize.width * scaleRatio) : undefined,
                    height: renderSize.height ? Math.floor(renderSize.height * scaleRatio) : undefined,
                  }}
                >
                  <div
                    ref={pageSurfaceRef}
                    className={styles.pageSurface}
                    style={{
                      width: renderSize.width || undefined,
                      height: renderSize.height || undefined,
                      transform: scaleRatio !== 1 ? `scale(${scaleRatio})` : undefined,
                      transformOrigin: "top center",
                      transition: scaleRatio !== 1 ? "transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)" : "none",
                    }}
                  >
                    <canvas ref={canvasRef} className={styles.pageCanvas} aria-label={`Page ${pageNumber} of ${totalPageCount}`} />
                    {documentMarkups
                      .filter((m) => m.pageNumber === pageNumber && (m.kind === "watermark" || m.isWatermark) && !m.rect)
                      .map((wm) => (
                        <div key={wm.id} className={styles.watermarkOverlay}>
                          {wm.text ? (
                            <span
                              style={{
                                transform: `rotate(${wm.rotation ?? -45}deg)`,
                                fontSize: `${(wm.fontSize ?? 54) * renderScale}px`,
                                fontWeight: 800,
                                color: wm.color ?? "#64748b",
                                opacity: wm.opacity ?? 0.25,
                                letterSpacing: "0.15em",
                                textTransform: "uppercase",
                                whiteSpace: "nowrap",
                                fontFamily: "system-ui, -apple-system, sans-serif",
                              }}
                            >
                              {wm.text}
                            </span>
                          ) : wm.dataUrl ? (
                            <NextImage
                              src={wm.dataUrl}
                              alt="Watermark"
                              width={400}
                              height={400}
                              unoptimized
                              style={{
                                transform: `rotate(${wm.rotation ?? 0}deg)`,
                                width: `${wm.scale ?? 50}%`,
                                height: "auto",
                                maxHeight: "80%",
                                objectFit: "contain",
                                opacity: wm.opacity ?? 0.25,
                                pointerEvents: "none",
                              }}
                            />
                          ) : null}
                        </div>
                      ))}
                    {!editMode && !pageHasEdits && activeTool === "select" && textRuns.length > 0 && (
                      <div className={styles.textSelectionLayer} aria-hidden="true">
                        {textRuns.map((run) => (
                          <span
                            key={run.key}
                            className={styles.selectableText}
                            style={{
                              left: run.left * renderScale,
                              top: run.top * renderScale,
                              width: Math.max(run.width, run.fontSize * 0.55) * renderScale,
                              height: Math.max(run.height, run.fontSize) * renderScale,
                              fontSize: run.fontSize * renderScale,
                              fontFamily: run.fontFamily,
                              fontWeight: run.fontWeight,
                              fontStyle: run.fontItalic ? "italic" : "normal",
                              transform: `rotate(${run.rotation}rad)`,
                            }}
                          >
                            {run.text}
                          </span>
                        ))}
                      </div>
                    )}
                    {(editMode || pageHasEdits) && (
                      <div
                        className={`${styles.textEditLayer} ${editMode ? styles.textEditLayerActive : ""}`}
                        aria-label={editMode ? "Editable PDF text layer" : "Edited text preview"}
                        onPointerDown={onEditPointerDown}
                        onPointerMove={onEditPointerMove}
                        onPointerUp={(event) => void onEditPointerUp(event)}
                        onPointerCancel={() => { pointerStartRef.current = null; setSelectionPreview(null); }}
                      >
                        {(editMode ? [...textRuns, ...pageEdits.filter((edit) => edit.manual), ...(draftRun?.manual && draftRun.pageNumber === pageNumber && !pageEdits.some((edit) => edit.key === draftRun.key) ? [draftRun] : [])] : pageEdits).map((run) => {
                          const saved = edits[run.key];
                          const isEditing = editingKey === run.key;
                          const value = isEditing ? draftText : (saved?.value ?? run.text);
                          const naturalWidth = (saved || isEditing) ? Math.max(run.width, measurePdfTextWidth(value, run)) : run.width;
                          const baseWidth = naturalWidth * renderScale;
                          const width = isEditing ? Math.max(baseWidth + 24, 40) : baseWidth;
                          const height = Math.max(run.height, run.fontSize) * renderScale;
                          const itemStyle: CSSProperties = {
                            left: run.left * renderScale,
                            top: run.top * renderScale,
                            width,
                            height,
                            fontSize: run.fontSize * renderScale,
                            fontFamily: run.fontFamily,
                            fontWeight: run.fontWeight,
                            fontStyle: run.fontItalic ? "italic" : "normal",
                            transform: `rotate(${run.rotation}rad)`,
                            backgroundColor: isEditing ? (saved?.backgroundColor ?? draftRun?.backgroundColor ?? run.backgroundColor ?? "#fff") : undefined,
                            color: isEditing ? (saved?.textColor ?? draftRun?.textColor ?? run.textColor ?? "#15181c") : undefined,
                          };
                          if (isEditing) {
                            return <input key={run.key} ref={editInputRef} autoFocus className={styles.inlineTextInput} style={itemStyle} defaultValue={draftText} aria-label={`Edit PDF text ${run.text || "replacement"}`} onChange={(event) => { draftTextRef.current = event.target.value; event.currentTarget.style.width = `${Math.max(40, measurePdfTextWidth(event.target.value, run) * renderScale + 24)}px`; }} onBlur={commitInlineEdit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") { event.preventDefault(); cancelInlineEdit(); } }} />;
                          }
                          if (editMode) {
                            return <button key={run.key} type="button" className={`${styles.editTextHit} ${saved ? styles.changedTextHit : ""} ${run.manual ? styles.manualTextHit : ""}`} style={{ ...itemStyle, backgroundColor: saved?.backgroundColor ?? run.backgroundColor, color: saved?.textColor ?? run.textColor }} title="Click to edit this text" onClick={() => beginInlineEdit(run)}>{value}</button>;
                          }
                          return <span key={run.key} className={`${styles.editTextHit} ${styles.changedTextHit} ${styles.editedTextPreview}`} style={{ ...itemStyle, backgroundColor: saved?.backgroundColor ?? run.backgroundColor, color: saved?.textColor ?? run.textColor }} >{value}</span>;
                        })}
                        {selectionPreview && <span className={styles.selectionPreview} style={selectionPreview} />}
                      </div>
                    )}
                    {(pageHasMarkups || detectedImages.length > 0 || !["select", "editText"].includes(activeTool)) && <div
                      className={`${styles.markupLayer} ${!["select", "editText"].includes(activeTool) ? styles.markupLayerActive : ""}`}
                      aria-label="PDF annotations"
                      onPointerDown={onMarkupPointerDown}
                      onPointerMove={(event) => { onMarkupPointerMove(event); onMarkupTransformMove(event); }}
                      onPointerUp={(event) => { onMarkupPointerUp(event); onMarkupTransformEnd(); }}
                      onPointerCancel={() => { onMarkupPointerCancel(); onMarkupTransformEnd(); }}
                    >
                      {pageMarkups.map((markup) => {
                        if (!markup.originalRect) return null;
                        const origBox = pdfRectToScreen(markup.originalRect, pageTransform, renderScale);
                        return (
                          <div
                            key={`cover-${markup.id}`}
                            className={styles.imageOriginalCover}
                            style={{
                              left: origBox.left,
                              top: origBox.top,
                              width: Math.max(3, origBox.width),
                              height: Math.max(3, origBox.height),
                            }}
                          />
                        );
                      })}
                      {detectedImages
                        .filter((d) => d.pageNumber === pageNumber && !documentMarkups.some((m) => m.pageNumber === pageNumber && m.originalRect && m.id === d.id))
                        .map((detected) => {
                          const box = pdfRectToScreen(detected.rect, pageTransform, renderScale);
                          const canSelect = activeTool === "select" || activeTool === "editImage";
                          return (
                            <div
                              key={detected.id}
                              className={styles.detectedImageOverlay}
                              style={{
                                left: box.left,
                                top: box.top,
                                width: Math.max(8, box.width),
                                height: Math.max(8, box.height),
                                pointerEvents: canSelect ? "auto" : "none",
                                cursor: canSelect ? "move" : "default",
                                zIndex: 2,
                              }}
                              title="Click and drag to move or resize this image/logo"
                              onPointerDown={(event) => activateDetectedImage(event, detected)}
                            />
                          );
                        })}
                      {pageMarkups.map((markup) => {
                        if (!markup.rect) return null;
                        const box = pdfRectToScreen(markup.rect, pageTransform, renderScale);
                        const selected = selectedMarkupId === markup.id;
                        const canSelect = activeTool === "select" || activeTool === "editImage";
                        const isBehindWatermark = (markup.kind === "watermark" || markup.isWatermark) && markup.layer === "behind";
                        const markupStyle: CSSProperties = {
                          left: box.left,
                          top: box.top,
                          width: Math.max(3, box.width),
                          height: Math.max(3, box.height),
                          borderRadius: markup.kind === "shape" && markup.shape === "circle" ? "50%" : undefined,
                          pointerEvents: canSelect ? "auto" : "none",
                          zIndex: isBehindWatermark ? (selected ? 3 : 1) : 4,
                        };
                        const points = markup.points?.map((point) => pdfPointToScreen(point, pageTransform, renderScale));
                        return <div
                          key={markup.id}
                          className={`${styles.markupObject} ${selected ? styles.markupObjectSelected : ""} ${styles[`markup${markup.kind[0].toLocaleUpperCase()}${markup.kind.slice(1)}`]}`}
                          style={markupStyle}
                          role="button"
                          tabIndex={canSelect ? 0 : -1}
                          aria-label={`${markup.kind} annotation${selected ? ", selected" : ""}`}
                          title={markup.kind === "image" ? "Drag to move image/logo, pull corner handle to resize (double-click to replace)" : (markup.kind === "watermark" || markup.isWatermark) ? "Drag to move watermark, drag corner handle to resize" : "Select and drag to move this annotation"}
                          onPointerDown={(event) => {
                            startMarkupTransform(event, markup, false);
                          }}
                          onDoubleClick={(event) => {
                            if (markup.kind === "image") {
                              event.stopPropagation();
                              imageTargetRef.current = markup.rect ?? null;
                              imageInputRef.current?.click();
                            }
                          }}
                          onPointerMove={(event) => onMarkupTransformMove(event)}
                          onPointerUp={onMarkupTransformEnd}
                        >
                          {(markup.kind === "image" || markup.kind === "signature") && markup.dataUrl ? <NextImage fill unoptimized className={styles.markupImage} src={markup.dataUrl} alt={markup.kind === "signature" ? "Added signature" : "Replacement image"} draggable={false} /> : null}
                          {markup.kind === "text" || markup.kind === "comment" ? <span className={styles.markupText}>{markup.text}</span> : null}
                          {(markup.kind === "watermark" || markup.isWatermark) && (
                            <div
                              style={{
                                width: "100%",
                                height: "100%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                overflow: "hidden",
                                pointerEvents: "none",
                                userSelect: "none",
                                mixBlendMode: markup.layer === "behind" ? "multiply" : "normal",
                              }}
                            >
                              {markup.text ? (
                                <span
                                  style={{
                                    transform: `rotate(${markup.rotation ?? -45}deg)`,
                                    fontSize: `${Math.max(12, Math.min(box.height * 0.55, (box.width / Math.max(1, (markup.text?.length || 10) * 0.7))))}px`,
                                    fontWeight: 800,
                                    color: markup.color ?? "#64748b",
                                    opacity: markup.opacity ?? 0.25,
                                    letterSpacing: "0.15em",
                                    textTransform: "uppercase",
                                    whiteSpace: "nowrap",
                                    userSelect: "none",
                                    fontFamily: "system-ui, -apple-system, sans-serif",
                                    lineHeight: 1,
                                  }}
                                >
                                  {markup.text}
                                </span>
                              ) : markup.dataUrl ? (
                                <NextImage
                                  src={markup.dataUrl}
                                  alt="Watermark"
                                  fill
                                  unoptimized
                                  style={{
                                    transform: `rotate(${markup.rotation ?? 0}deg)`,
                                    objectFit: "contain",
                                    opacity: markup.opacity ?? 0.25,
                                    pointerEvents: "none",
                                    userSelect: "none",
                                  }}
                                />
                              ) : null}
                            </div>
                          )}
                          {markup.kind === "shape" && (markup.shape === "line" || markup.shape === "arrow") && points?.length === 2 ? <svg className={styles.markupShapeSvg} viewBox={`0 0 ${Math.max(1, box.width)} ${Math.max(1, box.height)}`} preserveAspectRatio="none" aria-hidden="true"><defs><marker id={`arrow-${markup.id}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#315fe8" /></marker></defs><line x1={points[0].x - box.left} y1={points[0].y - box.top} x2={points[1].x - box.left} y2={points[1].y - box.top} stroke="#315fe8" strokeWidth="1.6" vectorEffect="non-scaling-stroke" markerEnd={markup.shape === "arrow" ? `url(#arrow-${markup.id})` : undefined} /></svg> : null}
                          {selected && <span className={styles.resizeHandle} role="button" aria-label="Resize selected annotation" title="Drag to resize" onPointerDown={(event) => startMarkupTransform(event, markup, true)} />}
                        </div>;
                      })}
                      {selectionPreview && <span className={styles.markupSelectionPreview} style={selectionPreview} />}
                      {markupDraft?.pageNumber === pageNumber && <form className={styles.markupDraft} style={pdfRectToScreen(markupDraft.rect, pageTransform, renderScale)} onSubmit={chooseMarkupDraft} onPointerDown={(event) => event.stopPropagation()}>
                        <textarea autoFocus aria-label={markupDraft.kind === "comment" ? "Comment text" : "New PDF text"} placeholder={markupDraft.kind === "comment" ? "Write a comment…" : "Type new text…"} value={markupDraft.value} onChange={(event) => setMarkupDraft((draft) => draft ? { ...draft, value: event.target.value } : null)} onKeyDown={(event) => { if (event.key === "Escape") setMarkupDraft(null); if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
                        <div><Button variant="secondary" size="sm" type="button" onClick={() => setMarkupDraft(null)}>Cancel</Button><Button variant="primary" size="sm" type="submit">Save</Button></div>
                      </form>}
                    </div>}
                  </div>
                </div>
              )}
              <div className={styles.floatingControls} aria-label="Page and zoom controls">
                <Button variant="ghost" size="sm" aria-label="Previous page" title="Previous page" disabled={pageNumber <= 1} onClick={() => goToPage(pageNumber - 1)}><ChevronLeft size={16} aria-hidden="true" /></Button>
                <span>{pageNumber} <small>/ {totalPageCount || "—"}</small></span>
                <Button variant="ghost" size="sm" aria-label="Next page" title="Next page" disabled={!totalPageCount || pageNumber >= totalPageCount} onClick={() => goToPage(pageNumber + 1)}><ChevronRight size={16} aria-hidden="true" /></Button>
                <span className={styles.floatingDivider} />
                <Button variant="ghost" size="sm" aria-label="Zoom out" title="Zoom out" onClick={zoomOut}><ZoomOut size={15} aria-hidden="true" /></Button>
                <span className={styles.floatingZoom}>{fitToPage ? "Fit" : `${Math.round(zoom * 100)}%`}</span>
                <Button variant="ghost" size="sm" aria-label="Zoom in" title="Zoom in" onClick={zoomIn}><ZoomIn size={15} aria-hidden="true" /></Button>
                <Button variant="ghost" size="sm" aria-label="Toggle full screen" title="Toggle full screen" onClick={toggleFullscreen}><Maximize size={15} aria-hidden="true" /></Button>
              </div>
            </div>
            {searchMessage && <div className={styles.stageFooter} role="status">{searchMessage}</div>}
          </section>

          {showDetails && (
            <aside className={styles.detailsPanel} aria-label="Document details">
              <div className={styles.detailsHeader}>
                <h2>Document details</h2>
                <Button variant="ghost" size="sm" aria-label="Close details panel" title="Close details panel" onClick={() => setShowDetails(false)}>×</Button>
              </div>

              <section className={styles.detailSection}>
                <h3>Document information</h3>
                <dl className={styles.infoList}>
                  <div><dt>File name</dt><dd title={metadata?.filename}>{metadata?.filename ?? "Loading…"}</dd></div>
                  <div><dt>Pages</dt><dd>{totalPageCount || "—"}</dd></div>
                  <div><dt>File size</dt><dd>{metadata ? formatSize(metadata.size) : "—"}</dd></div>
                  <div><dt>Uploaded</dt><dd>{metadata ? formatDate(metadata.uploadedAt) : "—"}</dd></div>
                </dl>
              </section>

              <section className={styles.detailSection}>
                <div className={styles.sectionHeading}>
                  <h3>Text on this page</h3>
                  {pageText && <Button variant="ghost" size="sm" aria-label="Copy page text" title="Copy page text" onClick={() => void handleCopyText()}><Copy size={14} aria-hidden="true" /></Button>}
                </div>
                {pageText ? (
                  <div className={styles.extractedText} tabIndex={0} aria-label="Selectable text from the PDF page">
                    <HighlightedText text={pageText} query={searchQuery} />
                  </div>
                ) : (
                  <p className={styles.emptyText}>{loading ? "Reading page text…" : "No selectable text found on this page. Scanned pages need OCR."}</p>
                )}
              </section>

              <section className={styles.detailSection}>
                <h3>OCR status</h3>
                <div className={styles.ocrStatus}><span className={styles.statusDot} /><strong>{ocrStatus.status === "completed" ? "Completed" : ocrStatus.status === "processing" ? "Processing" : ocrStatus.status === "failed" ? "Failed" : "Waiting"}</strong></div>
                <p className={styles.ocrNote} role={ocrStatus.status === "failed" ? "alert" : undefined}>
                  {ocrStatus.status === "completed"
                    ? `${ocrStatus.completedPages ?? pageCount} of ${ocrStatus.totalPages ?? pageCount} pages processed. ${ocrStatus.warning ?? ""}`
                    : ocrStatus.status === "processing"
                      ? "Adobe is recognizing the scan and rebuilding its text and page layout into a selectable PDF."
                      : ocrStatus.status === "failed"
                        ? ocrStatus.error ?? "OCR could not process this PDF."
                        : "Adobe PDF Services OCR will start automatically."}
                </p>
                {ocrStatus.status === "failed" && <Button variant="secondary" size="sm" onClick={() => void startOcrProcessing()}>Retry OCR</Button>}
              </section>
            </aside>
          )}
        </div>
      </div>

      {/* File Share Modal Popup */}
      <Dialog open={shareModalOpen} onOpenChange={setShareModalOpen}>
        <DialogContent
          title="Share Document"
          description="Your file is ready to share with an instant link."
          className="sm:max-w-[440px]"
        >
          {shareHref && (
            <ShareModalView
              filename={shareFileName}
              fileSize={shareFileSize}
              downloadHref={shareHref}
              onReset={() => setShareModalOpen(false)}
              resetLabel="Close"
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}
