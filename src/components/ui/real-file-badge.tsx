import React from "react";
import {
  PdfFileBadgeIcon,
  WordFileBadgeIcon,
  ExcelFileBadgeIcon,
  PowerpointFileBadgeIcon,
  HtmlFileBadgeIcon,
  JpgFileBadgeIcon,
} from "@/components/ui/convert-icons";

export function RealFileBadge({
  filename,
  className = "size-12 shrink-0",
}: {
  filename: string;
  className?: string;
}) {
  const ext = filename.toLowerCase().split(".").pop() ?? "";

  // PDF
  if (ext === "pdf") {
    return <PdfFileBadgeIcon className={className} />;
  }

  // Word Document
  if (["doc", "docx", "rtf", "odt", "txt"].includes(ext)) {
    return <WordFileBadgeIcon className={className} />;
  }

  // Excel Spreadsheet
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return <ExcelFileBadgeIcon className={className} />;
  }

  // PowerPoint Presentation
  if (["ppt", "pptx"].includes(ext)) {
    return <PowerpointFileBadgeIcon className={className} />;
  }

  // HTML
  if (["html", "htm"].includes(ext)) {
    return <HtmlFileBadgeIcon className={className} />;
  }

  // Image files (JPG, PNG, WebP, etc.)
  if (["jpg", "jpeg", "png", "webp", "gif", "svg", "avif"].includes(ext)) {
    return <JpgFileBadgeIcon className={className} />;
  }

  // Zip & Archives
  if (["zip", "rar", "7z", "tar", "gz"].includes(ext)) {
    return (
      <div className={`relative flex items-center justify-center ${className}`}>
        <svg
          viewBox="0 0 36 44"
          className="w-full h-full drop-shadow-xs"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M3 4C3 2.34315 4.34315 1 6 1H23L33 11V40C33 41.6569 31.6569 43 30 43H6C4.34315 43 3 41.6569 3 40V4Z"
            fill="#FFFFFF"
            className="dark:fill-zinc-900"
            stroke="#FCD34D"
            strokeWidth="1.3"
          />
          <path
            d="M23 1V8.5C23 9.88071 24.1193 11 25.5 11H33"
            fill="#FEF3C7"
            className="dark:fill-zinc-800"
            stroke="#FBBF24"
            strokeWidth="1"
          />
          <rect x="15" y="14" width="6" height="12" rx="1" fill="#D97706" />
          <line
            x1="18"
            y1="14"
            x2="18"
            y2="26"
            stroke="#FEF3C7"
            strokeWidth="1"
            strokeDasharray="1.5 1.5"
          />
          <rect x="6" y="28" width="24" height="11" rx="2.5" fill="#D97706" />
          <text
            x="18"
            y="36.5"
            fill="#FFFFFF"
            fontSize="6.6"
            fontWeight="800"
            fontFamily="system-ui, -apple-system, sans-serif"
            textAnchor="middle"
            letterSpacing="0.3"
          >
            ZIP
          </text>
        </svg>
      </div>
    );
  }

  // Generic Clean File Badge
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <svg
        viewBox="0 0 36 44"
        className="w-full h-full drop-shadow-xs"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M3 4C3 2.34315 4.34315 1 6 1H23L33 11V40C33 41.6569 31.6569 43 30 43H6C4.34315 43 3 41.6569 3 40V4Z"
          fill="#FFFFFF"
          className="dark:fill-zinc-900"
          stroke="#93C5FD"
          strokeWidth="1.3"
        />
        <path
          d="M23 1V8.5C23 9.88071 24.1193 11 25.5 11H33"
          fill="#EFF6FF"
          className="dark:fill-zinc-800"
          stroke="#60A5FA"
          strokeWidth="1"
        />
        <rect x="6" y="28" width="24" height="11" rx="2.5" fill="#2563EB" />
        <text
          x="18"
          y="36.5"
          fill="#FFFFFF"
          fontSize="6.6"
          fontWeight="800"
          fontFamily="system-ui, -apple-system, sans-serif"
          textAnchor="middle"
          letterSpacing="0.3"
        >
          {ext ? ext.toUpperCase().slice(0, 4) : "FILE"}
        </text>
      </svg>
    </div>
  );
}
