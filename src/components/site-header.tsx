"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { NavigationMenuDemo } from "@/components/ui/demo";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Menu,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import {
  JpgToPdfImageIcon,
  WordToPdfImageIcon,
  PowerpointToPdfIcon,
  ExcelToPdfIcon,
  HtmlToPdfIcon,
  PdfToJpgIcon,
  PdfToWordIcon,
  PdfToPowerpointIcon,
  PdfToExcelIcon,
  MergePdfImageIcon,
  SplitPdfImageIcon,
  OcrPdfImageIcon,
  UnlockPdfIcon,
  ProtectPdfIcon,
  ComparePdfIcon,
  CompressPdfImageIcon,
  PdfFileBadgeIcon,
  WordFileBadgeIcon,
} from "@/components/ui/convert-icons";

interface MobileDropdownSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  items: {
    title: string;
    href: string;
    icon: React.ReactNode;
  }[];
}

const mobileSections: MobileDropdownSection[] = [
  {
    id: "convertToPdf",
    title: "Convert to PDF",
    icon: <JpgToPdfImageIcon className="size-6 shrink-0 object-contain" />,
    items: [
      { title: "JPG to PDF", href: "/jpg-to-pdf", icon: <JpgToPdfImageIcon className="w-7 h-4 shrink-0 object-contain" /> },
      { title: "WORD to PDF", href: "/word-to-pdf", icon: <WordToPdfImageIcon className="w-7 h-4 shrink-0 object-contain" /> },
      { title: "POWERPOINT to PDF", href: "/powerpoint-to-pdf", icon: <PowerpointToPdfIcon className="w-7 h-4 shrink-0 object-contain" /> },
      { title: "EXCEL to PDF", href: "/excel-to-pdf", icon: <ExcelToPdfIcon className="w-7 h-4 shrink-0 object-contain" /> },
      { title: "HTML to PDF", href: "/html-to-pdf", icon: <HtmlToPdfIcon className="w-7 h-4 shrink-0 object-contain" /> },
    ],
  },
  {
    id: "convertFromPdf",
    title: "Convert from PDF",
    icon: <PdfToJpgIcon className="size-6 shrink-0 object-contain" />,
    items: [
      { title: "PDF to JPG", href: "/pdf-to-jpg", icon: <PdfToJpgIcon className="w-7 h-4 shrink-0 object-contain" /> },
      { title: "PDF to WORD", href: "/pdf-to-word", icon: <PdfToWordIcon className="w-7 h-4 shrink-0 object-contain" /> },
      { title: "PDF to POWERPOINT", href: "/pdf-to-powerpoint", icon: <PdfToPowerpointIcon className="w-7 h-4 shrink-0 object-contain" /> },
      { title: "PDF to EXCEL", href: "/pdf-to-excel", icon: <PdfToExcelIcon className="w-7 h-4 shrink-0 object-contain" /> },
    ],
  },
  {
    id: "pdfTools",
    title: "PDF Tools & Optimization",
    icon: <CompressPdfImageIcon className="size-6 shrink-0 object-contain" />,
    items: [
      { title: "Compress PDF", href: "/compress-pdf", icon: <CompressPdfImageIcon className="size-5 shrink-0 object-contain" /> },
      { title: "Merge PDF", href: "/merge-pdf", icon: <MergePdfImageIcon className="size-5 shrink-0 object-contain" /> },
      { title: "Split PDF", href: "/split-pdf", icon: <SplitPdfImageIcon className="size-5 shrink-0 object-contain" /> },
      { title: "OCR PDF", href: "/ocr-pdf", icon: <OcrPdfImageIcon className="size-5 shrink-0 object-contain" /> },
    ],
  },
  {
    id: "pdfSecurity",
    title: "PDF Security",
    icon: <ProtectPdfIcon className="size-6 shrink-0 object-contain" />,
    items: [
      { title: "Unlock PDF", href: "/unlock-pdf", icon: <UnlockPdfIcon className="size-4 shrink-0" /> },
      { title: "Protect PDF", href: "/protect-pdf", icon: <ProtectPdfIcon className="size-4 shrink-0" /> },
      { title: "Compare PDF", href: "/compare-pdf", icon: <ComparePdfIcon className="size-4 shrink-0" /> },
    ],
  },
];

function YourPdfLogo({ className }: { className: string }) {
  return (
    <Image
      src="/yourpdf-logo.png"
      alt=""
      width={2096}
      height={533}
      unoptimized
      className={`object-contain ${className}`}
    />
  );
}

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(() => {
    const activeSection = mobileSections.find((section) => section.items.some((item) => item.href === pathname));
    return activeSection ? { [activeSection.id]: true } : {};
  });
  const [prevPathname, setPrevPathname] = useState(pathname);

  // Close mobile drawer on route navigation
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setMobileOpen(false);
    const activeSection = mobileSections.find((section) => section.items.some((item) => item.href === pathname));
    setOpenSections(activeSection ? { [activeSection.id]: true } : {});
  }

  // Prevent background scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const toggleSection = (id: string) => {
    setOpenSections((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  return (
    <header className="sticky top-0 z-50 w-full bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Desktop Header (>= 768px): Centered Navigation Menu + Right Theme Toggle */}
      <div className="relative hidden md:flex h-16 w-full items-center justify-center px-4 sm:px-6">
        <Link
          href="/"
          className="absolute left-4 sm:left-6 top-1/2 z-10 -translate-y-1/2 transition-opacity hover:opacity-90"
          aria-label="YourPDF home"
        >
          <YourPdfLogo className="h-14 w-auto max-w-[220px]" />
        </Link>
        <NavigationMenuDemo />
        <div className="absolute right-4 sm:right-6 top-1/2 -translate-y-1/2 flex items-center z-10">
          <ThemeToggle />
        </div>
      </div>

      {/* Mobile Header (< 768px): Hamburger & Logo on Left, Theme Toggle on Right */}
      <div className="flex md:hidden h-14 w-full items-center justify-between px-4">
        {/* Left: Hamburger & Brand Logo */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="flex size-9 items-center justify-center rounded-xl border border-border/80 bg-card/80 text-foreground hover:bg-accent active:scale-95 transition-all cursor-pointer shadow-2xs"
            aria-label="Open navigation menu"
            aria-expanded={mobileOpen}
          >
            <Menu className="size-5" />
          </button>
          <Link
            href="/"
            className="flex items-center transition-opacity hover:opacity-90 cursor-pointer"
            aria-label="YourPDF home"
            onClick={() => setMobileOpen(false)}
          >
            <YourPdfLogo className="h-11 w-auto max-w-[165px]" />
          </Link>
        </div>

        {/* Right: Theme Toggle */}
        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>

      {/* Mobile Side Drawer & Backdrop Overlay rendered via Portal to document.body */}
      {mobileOpen && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[9999] md:hidden">
          {/* Backdrop: flat translucent scrim without blur for instant 60fps mobile compositing */}
          <div
            className="fixed inset-0 bg-black/40 animate-in fade-in duration-150"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />

          {/* Side Drawer Panel: pure white minimal surface with fast GPU slide-in */}
          <aside
            className="fixed inset-y-0 left-0 z-[10000] flex h-dvh max-h-dvh w-[min(320px,86vw)] flex-col rounded-r-3xl border-r border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 shadow-xl will-change-transform animate-in slide-in-from-left duration-150 ease-out overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Top Header (Back Button on Left, Theme Toggle on Right) */}
            <div className="flex shrink-0 items-center justify-between px-4 pt-4 pb-2">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex size-9 items-center justify-center rounded-full bg-neutral-100/80 hover:bg-neutral-200/70 dark:bg-neutral-900 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200 transition-colors active:scale-95 cursor-pointer touch-manipulation"
                aria-label="Back"
              >
                <ArrowLeft className="size-4" />
              </button>

              <ThemeToggle />
            </div>

            {/* Scrollable Content Container */}
            <nav
              className="flex-1 overflow-y-auto overscroll-contain px-3.5 py-2 space-y-3 [scrollbar-width:none] [-webkit-overflow-scrolling:touch]"
              aria-label="Mobile site navigation"
            >
              {/* Brand Logo Hero */}
              <div className="rounded-2xl bg-white dark:bg-neutral-950 px-4 py-3 flex flex-col items-center justify-center text-center">
                <Link
                  href="/"
                  className="flex items-center justify-center transition-opacity hover:opacity-85 cursor-pointer touch-manipulation"
                  aria-label="YourPDF home"
                  onClick={() => setMobileOpen(false)}
                >
                  <YourPdfLogo className="h-9 w-auto max-w-[170px]" />
                </Link>
                <p className="mt-1 text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                  Free Online PDF Tools & Workspace
                </p>
              </div>

              {/* Quick Actions: File Share & Edit PDF */}
              <div className="rounded-2xl bg-white dark:bg-neutral-950 space-y-0.5">
                {/* File Share Row */}
                <Link
                  href="/file-share"
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors cursor-pointer touch-manipulation ${
                    pathname === "/file-share"
                      ? "bg-neutral-100 dark:bg-neutral-900 text-neutral-950 dark:text-white font-semibold"
                      : "text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-50 dark:bg-neutral-900">
                      <Image
                        src="/file-sharing-network-icon.png"
                        alt=""
                        width={1244}
                        height={1238}
                        unoptimized
                        className="size-5.5 object-contain"
                      />
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate">File Share</p>
                      <p className="text-[11px] text-neutral-400 dark:text-neutral-500 truncate">Instant 48h share link</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                      48h
                    </span>
                    <ChevronRight className="size-4 text-neutral-300 dark:text-neutral-600" />
                  </div>
                </Link>

                {/* Edit PDF Row */}
                <Link
                  href="/"
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl transition-colors cursor-pointer touch-manipulation ${
                    pathname === "/"
                      ? "bg-neutral-100 dark:bg-neutral-900 text-neutral-950 dark:text-white font-semibold"
                      : "text-neutral-800 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-50 dark:bg-neutral-900">
                      <span className="flex items-center gap-0.5" aria-hidden="true">
                        <PdfFileBadgeIcon className="size-[17px] shrink-0" />
                        <WordFileBadgeIcon className="size-[17px] shrink-0" />
                      </span>
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate">Edit PDF & Word</p>
                      <p className="text-[11px] text-neutral-400 dark:text-neutral-500 truncate">Document workspace</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500">
                      Free
                    </span>
                    <ChevronRight className="size-4 text-neutral-300 dark:text-neutral-600" />
                  </div>
                </Link>
              </div>

              <div className="mx-3 h-px bg-neutral-100 dark:bg-neutral-800/70" />

              {/* Tools & Converters Accordion */}
              <div className="rounded-2xl bg-white dark:bg-neutral-950 space-y-0.5">
                {mobileSections.map((section) => {
                  const isOpen = !!openSections[section.id];
                  const hasActiveChild = section.items.some((item) => item.href === pathname);

                  return (
                    <div key={section.id}>
                      <button
                        type="button"
                        onClick={() => toggleSection(section.id)}
                        className={`flex w-full items-center justify-between px-3 py-2.5 text-left rounded-xl transition-colors cursor-pointer select-none touch-manipulation hover:bg-neutral-50 dark:hover:bg-neutral-900/60 ${
                          hasActiveChild ? "text-neutral-950 dark:text-white font-semibold" : "text-neutral-800 dark:text-neutral-200"
                        }`}
                        aria-expanded={isOpen}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-neutral-50 dark:bg-neutral-900">
                            {section.icon}
                          </span>
                          <span className="text-[13px] font-semibold truncate">
                            {section.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[11px] font-medium text-neutral-400 dark:text-neutral-500 tabular-nums">
                            {section.items.length}
                          </span>
                          <ChevronRight
                            className={`size-4 text-neutral-400 dark:text-neutral-500 transition-transform duration-150 ${
                              isOpen ? "rotate-90 text-neutral-700 dark:text-neutral-300" : ""
                            }`}
                          />
                        </div>
                      </button>

                      {isOpen && (
                        <div className="pl-3 pr-1 pb-1.5 pt-0.5 space-y-0.5">
                          {section.items.map((item) => {
                            const isActive = pathname === item.href;
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileOpen(false)}
                                className={`flex items-center justify-between px-3 py-2 rounded-xl text-[12.5px] font-medium transition-colors cursor-pointer touch-manipulation ${
                                  isActive
                                    ? "bg-neutral-100 dark:bg-neutral-900 text-neutral-950 dark:text-white font-semibold"
                                    : "text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-900/60"
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span className="flex size-6 shrink-0 items-center justify-center">
                                    {item.icon}
                                  </span>
                                  <span className="truncate">{item.title}</span>
                                </div>
                                {isActive ? (
                                  <span className="size-1.5 rounded-full bg-neutral-900 dark:bg-white shrink-0" />
                                ) : (
                                  <ChevronRight className="size-3.5 text-neutral-300 dark:text-neutral-600" />
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </nav>
          </aside>
        </div>,
        document.body
      )}
    </header>
  );
}

export default SiteHeader;
