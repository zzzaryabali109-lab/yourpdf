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
  X,
  ChevronRight,
  ChevronDown,
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
          <aside
            className="fixed inset-y-0 left-0 z-[10000] flex h-dvh max-h-dvh w-[min(320px,88vw)] flex-col rounded-r-2xl border-r border-border bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-foreground shadow-2xl animate-in slide-in-from-left duration-200 ease-out dark:border-white/10 dark:bg-black"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border/70 px-4 bg-background dark:border-white/10 dark:bg-black">
              <Link
                href="/"
                className="flex items-center transition-opacity hover:opacity-90 cursor-pointer"
                aria-label="YourPDF home"
                onClick={() => setMobileOpen(false)}
              >
                <YourPdfLogo className="h-10 w-auto max-w-[150px]" />
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground active:scale-95 cursor-pointer"
                aria-label="Close navigation menu"
              >
                <X className="size-4.5" />
              </button>
            </div>

            {/* Compact navigation */}
            <nav className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 [scrollbar-width:none] [-webkit-overflow-scrolling:touch]" aria-label="Mobile site navigation">
              <Link
                href="/"
                onClick={() => setMobileOpen(false)}
                className={`group flex min-h-[58px] items-center gap-3 rounded-xl px-3.5 transition-colors cursor-pointer ${pathname === "/"
                  ? "bg-primary text-primary-foreground"
                  : "bg-foreground text-background hover:opacity-90"
                  }`}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background/10">
                  <span className="flex items-center gap-0.5" aria-hidden="true">
                    <PdfFileBadgeIcon className="size-[18px] shrink-0" />
                    <WordFileBadgeIcon className="size-[18px] shrink-0" />
                  </span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">Edit PDF & Word</span>
                  <span className="mt-0.5 block text-[11px] opacity-70">Open your workspace</span>
                </span>
                <ChevronRight className="size-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" />
              </Link>

              <Link
                href="/file-share"
                onClick={() => setMobileOpen(false)}
                className={`group mt-2 flex min-h-11 items-center gap-3 rounded-xl px-3.5 transition-colors cursor-pointer ${pathname === "/file-share"
                  ? "bg-pink-500/10 text-pink-600 dark:text-pink-400"
                  : "text-foreground hover:bg-accent"
                  }`}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-pink-500/10" aria-hidden="true">
                  <Image
                    src="/file-sharing-network-icon.png"
                    alt=""
                    width={1244}
                    height={1238}
                    unoptimized
                    className="size-7 object-contain"
                  />
                </span>
                <span className="flex-1 text-sm font-medium">File Share</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">48h</span>
                <ChevronRight className="size-4 shrink-0 opacity-50 transition-transform group-hover:translate-x-0.5" />
              </Link>

              <div className="mt-6 flex items-center justify-between px-1 pb-1.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Tools</p>
              </div>

              <div className="divide-y divide-border/70 border-y border-border/70 dark:divide-white/10 dark:border-white/10">
                {mobileSections.map((section) => {
                  const isOpen = !!openSections[section.id];
                  const hasActiveChild = section.items.some((item) => item.href === pathname);

                  return (
                    <section key={section.id}>
                      <button
                        type="button"
                        onClick={() => toggleSection(section.id)}
                        className={`flex min-h-12 w-full select-none items-center gap-3 px-1 text-left transition-colors hover:text-foreground cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${hasActiveChild ? "text-pink-600 dark:text-pink-400" : "text-foreground/85"}`}
                        aria-expanded={isOpen}
                        aria-controls={`mobile-section-${section.id}`}
                      >
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/70">
                          {section.icon}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{section.title}</span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">{section.items.length}</span>
                          <ChevronDown
                            className={`size-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180 text-foreground" : ""
                              }`}
                          />
                      </button>

                      {isOpen && (
                        <div id={`mobile-section-${section.id}`} className="mb-2 ml-4 space-y-0.5 border-l border-border pl-4 animate-in fade-in slide-in-from-top-1 duration-150 dark:border-white/10">
                          {section.items.map((item) => {
                            const isActive = pathname === item.href;
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileOpen(false)}
                                className={`group flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${isActive
                                  ? "bg-pink-500/10 font-semibold text-pink-600 dark:text-pink-400"
                                  : "text-foreground/75 hover:bg-accent hover:text-foreground"
                                  }`}
                              >
                                <span className="flex size-6 shrink-0 items-center justify-center transition-transform group-hover:scale-105">
                                  {item.icon}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                                {isActive && (
                                  <span className="size-1.5 shrink-0 rounded-full bg-pink-500" />
                                )}
                              </Link>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </nav>

            {/* Theme control */}
            <div className="flex shrink-0 items-center justify-between border-t border-border/70 px-4 py-2 bg-background dark:border-white/10 dark:bg-black">
              <div className="text-xs font-medium text-muted-foreground">Appearance</div>
              <ThemeToggle />
            </div>
          </aside>
        </div>,
        document.body
      )}
    </header>
  );
}

export default SiteHeader;
