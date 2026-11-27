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
      { title: "JPG to PDF", href: "/jpg-to-pdf", icon: <JpgToPdfImageIcon className="size-5 shrink-0 object-contain" /> },
      { title: "WORD to PDF", href: "/word-to-pdf", icon: <WordToPdfImageIcon className="size-4 shrink-0 object-contain" /> },
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
      { title: "PDF to WORD", href: "/pdf-to-word", icon: <PdfToWordIcon className="size-4 shrink-0" /> },
      { title: "PDF to POWERPOINT", href: "/pdf-to-powerpoint", icon: <PdfToPowerpointIcon className="size-4 shrink-0" /> },
      { title: "PDF to EXCEL", href: "/pdf-to-excel", icon: <PdfToExcelIcon className="size-4 shrink-0" /> },
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
          {/* Backdrop with quick fade animation */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />

          {/* Side Drawer Panel with fast slide-in animation from LEFT */}
          {/* Side Drawer Panel with fast slide-in animation from LEFT */}
          <aside
            className="fixed inset-y-0 left-0 z-[10000] flex h-dvh max-h-dvh w-[min(345px,90vw)] flex-col rounded-r-[32px] border-r border-pink-100/70 dark:border-white/[0.08] shadow-[0_12px_50px_rgba(244,63,94,0.12)] animate-in slide-in-from-left duration-250 ease-out overflow-hidden bg-white dark:bg-[#121014] text-neutral-900 dark:text-neutral-100"
            style={{
              background:
                "radial-gradient(circle at 85% 6%, rgba(244, 63, 94, 0.22) 0%, rgba(236, 72, 153, 0.12) 35%, rgba(253, 242, 248, 0.70) 65%, #FFFFFF 100%), #FFFFFF",
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Top Header (Back Button on Left, Theme Toggle on Right) */}
            <div className="flex shrink-0 items-center justify-between px-5 pt-5 pb-2">
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex size-10 items-center justify-center rounded-full bg-white dark:bg-[#1C1C1E] shadow-[0_2px_10px_rgba(244,63,94,0.08)] border border-pink-100/70 dark:border-white/[0.08] text-neutral-800 dark:text-neutral-200 transition-all active:scale-95 hover:scale-105 cursor-pointer"
                aria-label="Back"
              >
                <ArrowLeft className="size-4.5" />
              </button>

              <ThemeToggle />
            </div>

            {/* Scrollable Content Container */}
            <nav
              className="flex-1 overflow-y-auto overscroll-contain px-4 py-2 space-y-3.5 [scrollbar-width:none] [-webkit-overflow-scrolling:touch]"
              aria-label="Mobile site navigation"
            >
              {/* Brand Logo Hero Card (Replaces previous PDF Edit profile card: only clean logo displayed) */}
              <div className="relative overflow-hidden rounded-[26px] bg-white/95 dark:bg-[#1C1C1E]/95 p-5 shadow-[0_4px_24px_rgba(244,63,94,0.06)] border border-pink-100/70 dark:border-pink-950/40 flex flex-col items-center justify-center text-center">
                <Link
                  href="/"
                  className="flex items-center justify-center transition-opacity hover:opacity-90 cursor-pointer"
                  aria-label="YourPDF home"
                  onClick={() => setMobileOpen(false)}
                >
                  <YourPdfLogo className="h-11 w-auto max-w-[190px] drop-shadow-xs" />
                </Link>
                <p className="mt-1.5 text-xs font-semibold text-neutral-500 dark:text-neutral-400">
                  Free Online PDF Tools & Workspace
                </p>
              </div>

              {/* Grouped Floating White Card 1: Features (File Share & Edit PDF replacing Appearance) */}
              <div className="overflow-hidden rounded-[24px] bg-white dark:bg-[#1C1C1E] p-1.5 shadow-[0_4px_20px_rgba(244,63,94,0.04)] border border-pink-100/60 dark:border-white/[0.06] divide-y divide-pink-50/80 dark:divide-white/5">
                {/* File Share Row */}
                <Link
                  href="/file-share"
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center justify-between p-3.5 rounded-[18px] transition-colors cursor-pointer group ${
                    pathname === "/file-share"
                      ? "bg-pink-500/10 text-pink-600 dark:text-pink-400 font-semibold"
                      : "text-neutral-800 dark:text-neutral-200 hover:bg-pink-50/50 dark:hover:bg-neutral-800/50"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-pink-500/10 dark:bg-pink-950/40">
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
                      <p className="text-[13.5px] font-semibold truncate">File Share</p>
                      <p className="text-[11px] text-neutral-400 dark:text-neutral-500 truncate">Instant 48h share link</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="rounded-full bg-pink-100/80 dark:bg-pink-900/40 px-2 py-0.5 text-[10px] font-bold text-pink-600 dark:text-pink-300">
                      48h
                    </span>
                    <ChevronRight className="size-4 text-neutral-400 dark:text-neutral-500 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </Link>

                {/* Edit PDF Row (Replaces Appearance) */}
                <Link
                  href="/"
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center justify-between p-3.5 rounded-[18px] transition-colors cursor-pointer group ${
                    pathname === "/"
                      ? "bg-pink-500/10 text-pink-600 dark:text-pink-400 font-semibold"
                      : "text-neutral-800 dark:text-neutral-200 hover:bg-pink-50/50 dark:hover:bg-neutral-800/50"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-pink-500/10 dark:bg-pink-950/40">
                      <span className="flex items-center gap-0.5" aria-hidden="true">
                        <PdfFileBadgeIcon className="size-[18px] shrink-0 drop-shadow-xs" />
                        <WordFileBadgeIcon className="size-[18px] shrink-0 drop-shadow-xs" />
                      </span>
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-semibold truncate">Edit PDF & Word</p>
                      <p className="text-[11px] text-neutral-400 dark:text-neutral-500 truncate">Document workspace</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="rounded-full bg-pink-100/80 dark:bg-pink-900/40 px-2 py-0.5 text-[10px] font-bold text-pink-600 dark:text-pink-300">
                      Free
                    </span>
                    <ChevronRight className="size-4 text-neutral-400 dark:text-neutral-500 group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </Link>
              </div>

              {/* Grouped Floating White Card 2: Tools & Converters (Accordion Groups) */}
              <div className="overflow-hidden rounded-[24px] bg-white dark:bg-[#1C1C1E] p-1.5 shadow-[0_4px_20px_rgba(244,63,94,0.04)] border border-pink-100/60 dark:border-white/[0.06] divide-y divide-pink-50/80 dark:divide-white/5">
                {mobileSections.map((section) => {
                  const isOpen = !!openSections[section.id];
                  const hasActiveChild = section.items.some((item) => item.href === pathname);

                  return (
                    <div key={section.id}>
                      <button
                        type="button"
                        onClick={() => toggleSection(section.id)}
                        className={`flex w-full items-center justify-between p-3.5 text-left rounded-[18px] transition-colors cursor-pointer select-none hover:bg-pink-50/50 dark:hover:bg-neutral-800/50 ${
                          hasActiveChild ? "text-pink-600 dark:text-pink-400 font-semibold" : "text-neutral-800 dark:text-neutral-200"
                        }`}
                        aria-expanded={isOpen}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-pink-50/70 dark:bg-neutral-800">
                            {section.icon}
                          </span>
                          <span className="text-[13.5px] font-semibold truncate">
                            {section.title}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="rounded-full bg-pink-100/80 dark:bg-pink-950/60 px-2 py-0.5 text-[10px] font-bold text-pink-600 dark:text-pink-400">
                            {section.items.length}
                          </span>
                          <ChevronRight
                            className={`size-4 text-neutral-400 dark:text-neutral-500 transition-transform duration-200 ${
                              isOpen ? "rotate-90 text-pink-600 dark:text-pink-400" : ""
                            }`}
                          />
                        </div>
                      </button>

                      {isOpen && (
                        <div className="px-2 pb-2.5 pt-1 space-y-1 animate-in fade-in slide-in-from-top-1 duration-150">
                          {section.items.map((item) => {
                            const isActive = pathname === item.href;
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileOpen(false)}
                                className={`flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer group ${
                                  isActive
                                    ? "bg-pink-500/10 text-pink-600 dark:text-pink-400 font-bold"
                                    : "text-neutral-700 dark:text-neutral-300 hover:bg-pink-50/60 dark:hover:bg-neutral-800/60"
                                }`}
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <span className="flex size-6 shrink-0 items-center justify-center group-hover:scale-110 transition-transform">
                                    {item.icon}
                                  </span>
                                  <span className="truncate">{item.title}</span>
                                </div>
                                {isActive ? (
                                  <span className="size-2 rounded-full bg-pink-500 shrink-0" />
                                ) : (
                                  <ChevronRight className="size-3.5 text-neutral-300 dark:text-neutral-600 group-hover:translate-x-0.5 transition-transform" />
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
