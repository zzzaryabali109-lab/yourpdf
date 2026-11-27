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
  ShieldCheck,
  FolderDown,
  FolderUp,
  SlidersHorizontal,
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
  FileShareDropzoneIcon,
  PdfDocumentIcon,
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
    icon: <FolderDown className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />,
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
    icon: <FolderUp className="size-4 text-blue-600 dark:text-blue-400 shrink-0" />,
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
    icon: <SlidersHorizontal className="size-4 text-violet-600 dark:text-violet-400 shrink-0" />,
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
    icon: <ShieldCheck className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />,
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
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const pathname = usePathname();
  const [prevPathname, setPrevPathname] = useState(pathname);

  // Close mobile drawer on route navigation
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    setMobileOpen(false);
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
            className="fixed inset-y-0 left-0 z-[10000] flex h-dvh max-h-dvh w-[min(340px,88vw)] flex-col border-r border-border bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-foreground shadow-2xl animate-in slide-in-from-left duration-200 ease-out dark:bg-black"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 bg-background dark:bg-black">
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

            {/* Drawer Scrollable Content */}
            <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3.5 bg-background dark:bg-black [scrollbar-width:none] [-webkit-overflow-scrolling:touch]">
              {/* Quick links */}
              <Link
                href="/file-share"
                onClick={() => setMobileOpen(false)}
                className={`group flex min-h-12 items-center justify-between rounded-xl border px-3 transition-colors cursor-pointer ${pathname === "/file-share"
                  ? "border-primary/20 bg-primary/10 text-primary"
                  : "border-border/70 bg-card/50 text-foreground hover:bg-accent"
                  }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <FileShareDropzoneIcon className="size-4 shrink-0" />
                  </div>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <span>File Share</span>
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">
                        48h
                      </span>
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      Share files up to 100 MB via instant link
                    </p>
                  </div>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>

              {/* Workspace */}
              <Link
                href="/"
                onClick={() => setMobileOpen(false)}
                className={`group flex min-h-12 items-center justify-between rounded-xl border px-3 transition-colors cursor-pointer ${pathname === "/"
                  ? "border-primary/20 bg-primary/10 text-primary"
                  : "border-border/70 bg-card/50 text-foreground hover:bg-accent"
                  }`}
              >
                <div className="flex items-center gap-2.5 text-sm font-semibold">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
                    <PdfDocumentIcon className="size-4 shrink-0" />
                  </div>
                  <span>Edit PDF & Word (Workspace)</span>
                </div>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>

              {/* Collapsed tool groups keep the drawer compact. */}
              <div className="space-y-2 pt-2">
                <p className="px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                  Tools & Converters
                </p>

                {mobileSections.map((section) => {
                  const isOpen = !!openSections[section.id];
                  const hasActiveChild = section.items.some((i) => i.href === pathname);

                  return (
                    <div
                      key={section.id}
                      className={`overflow-hidden rounded-xl border transition-colors ${hasActiveChild
                        ? "border-primary/20 bg-primary/5"
                        : "border-border/70 bg-card/35"
                        }`}
                    >
                      {/* Accordion Dropdown Trigger */}
                      <button
                        type="button"
                        onClick={() => toggleSection(section.id)}
                        className="flex min-h-11 w-full select-none items-center justify-between px-3 text-left text-sm font-medium text-foreground transition-colors hover:bg-accent/70 active:bg-accent cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        aria-expanded={isOpen}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {section.icon}
                          <span className="truncate">{section.title}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {section.items.length}
                          </span>
                          <ChevronDown
                            className={`size-4 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180 text-foreground" : ""
                              }`}
                          />
                        </div>
                      </button>

                      {/* Dropdown Items List */}
                      {isOpen && (
                        <div className="space-y-0.5 border-t border-border/60 bg-background/70 px-2 py-1.5 animate-in fade-in slide-in-from-top-1 duration-150 dark:bg-neutral-950/70">
                          {section.items.map((item) => {
                            const isActive = pathname === item.href;
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileOpen(false)}
                                className={`group flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${isActive
                                  ? "bg-primary/10 text-primary font-semibold"
                                  : "text-foreground/90 hover:bg-accent hover:text-accent-foreground"
                                  }`}
                              >
                                <span className="shrink-0 transition-transform group-hover:scale-105">
                                  {item.icon}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{item.title}</span>
                                {isActive && (
                                  <span className="size-1.5 rounded-full bg-primary shrink-0" />
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
            </div>

            {/* Theme control */}
            <div className="flex shrink-0 items-center justify-between border-t border-border px-4 py-2.5 bg-background dark:bg-black">
              <div className="text-xs font-medium text-muted-foreground">
                Appearance
              </div>
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
