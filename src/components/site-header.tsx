"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavigationMenuDemo } from "@/components/ui/demo";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Menu,
  X,
  FileText,
  ChevronRight,
  ChevronDown,
  ShieldCheck,
  FolderDown,
  FolderUp,
  SlidersHorizontal,
} from "lucide-react";
import {
  JpgToPdfIcon,
  WordToPdfIcon,
  PowerpointToPdfIcon,
  ExcelToPdfIcon,
  HtmlToPdfIcon,
  PdfToJpgIcon,
  PdfToWordIcon,
  PdfToPowerpointIcon,
  PdfToExcelIcon,
  MergePdfImageIcon,
  SplitPdfImageIcon,
  OcrPdfIcon,
  UnlockPdfIcon,
  ProtectPdfIcon,
  ComparePdfIcon,
  CompressPdfImageIcon,
  FileShareDropzoneIcon,
} from "@/components/ui/convert-icons";

interface MobileDropdownSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  items: {
    title: string;
    href: string;
    desc?: string;
    icon: React.ReactNode;
  }[];
}

const mobileSections: MobileDropdownSection[] = [
  {
    id: "convertToPdf",
    title: "Convert to PDF",
    icon: <FolderDown className="size-4 text-emerald-600 dark:text-emerald-400 shrink-0" />,
    items: [
      { title: "JPG to PDF", href: "/jpg-to-pdf", icon: <JpgToPdfIcon className="size-4 shrink-0" /> },
      { title: "WORD to PDF", href: "/word-to-pdf", icon: <WordToPdfIcon className="size-4 shrink-0" /> },
      { title: "POWERPOINT to PDF", href: "/powerpoint-to-pdf", icon: <PowerpointToPdfIcon className="size-4 shrink-0" /> },
      { title: "EXCEL to PDF", href: "/excel-to-pdf", icon: <ExcelToPdfIcon className="size-4 shrink-0" /> },
      { title: "HTML to PDF", href: "/html-to-pdf", icon: <HtmlToPdfIcon className="size-4 shrink-0" /> },
    ],
  },
  {
    id: "convertFromPdf",
    title: "Convert from PDF",
    icon: <FolderUp className="size-4 text-blue-600 dark:text-blue-400 shrink-0" />,
    items: [
      { title: "PDF to JPG", href: "/pdf-to-jpg", icon: <PdfToJpgIcon className="size-4 shrink-0" /> },
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
      { title: "Compress PDF", href: "/compress-pdf", desc: "Reduce file size", icon: <CompressPdfImageIcon className="size-5 shrink-0 object-contain" /> },
      { title: "Merge PDF", href: "/merge-pdf", desc: "Combine PDFs", icon: <MergePdfImageIcon className="size-5 shrink-0 object-contain" /> },
      { title: "Split PDF", href: "/split-pdf", desc: "Split & remove pages", icon: <SplitPdfImageIcon className="size-5 shrink-0 object-contain" /> },
      { title: "OCR PDF", href: "/ocr-pdf", desc: "Searchable text", icon: <OcrPdfIcon className="size-4 shrink-0" /> },
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

export function SiteHeader() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    convertToPdf: true,
  });
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
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Desktop Header (>= 768px): Centered Navigation Menu + Right Theme Toggle */}
      <div className="relative hidden md:flex h-16 w-full items-center justify-center px-4 sm:px-6">
        <Link
          href="/"
          className="absolute left-4 sm:left-6 top-1/2 z-10 -translate-y-1/2 transition-opacity hover:opacity-90"
          aria-label="YourPDF home"
        >
          <span
            className="text-[3rem] font-bold italic leading-none tracking-[-0.07em] text-black dark:text-white transition-colors"
            style={{
              fontFamily: '"Brush Script MT", "Segoe Script", cursive',
              WebkitTextStroke: "0.45px currentColor",
            }}
          >
            YourPDF
          </span>
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
            onClick={() => setMobileOpen(false)}
          >
            <span
              className="text-[2.65rem] font-bold italic leading-none tracking-[-0.07em] text-black dark:text-white transition-colors"
              style={{
                fontFamily: '"Brush Script MT", "Segoe Script", cursive',
                WebkitTextStroke: "0.45px currentColor",
              }}
            >
              YourPDF
            </span>
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
            className="fixed inset-y-0 left-0 z-[10000] w-[min(320px,85vw)] h-full bg-white border-r border-border/60 shadow-2xl flex flex-col animate-in slide-in-from-left duration-200 ease-out"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Drawer Header */}
            <div className="flex items-center justify-between h-14 px-4 border-b border-border/50 shrink-0 bg-white">
              <Link
                href="/"
                className="flex items-center transition-opacity hover:opacity-90 cursor-pointer"
                onClick={() => setMobileOpen(false)}
              >
                <span
                  className="text-[2.25rem] font-bold italic leading-none tracking-[-0.07em] text-black dark:text-white transition-colors"
                  style={{
                    fontFamily: '"Brush Script MT", "Segoe Script", cursive',
                    WebkitTextStroke: "0.45px currentColor",
                  }}
                >
                  YourPDF
                </span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="flex size-8 items-center justify-center rounded-lg border border-border/70 bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted active:scale-95 transition-all cursor-pointer"
                aria-label="Close navigation menu"
              >
                <X className="size-4.5" />
              </button>
            </div>

            {/* Drawer Scrollable Content */}
            <div className="flex-1 overflow-y-auto px-3.5 py-3.5 space-y-3.5 bg-white [scrollbar-width:none] [-webkit-overflow-scrolling:touch]">
              {/* Featured: File Share Link */}
              <Link
                href="/file-share"
                onClick={() => setMobileOpen(false)}
                className={`flex items-center justify-between p-3 rounded-xl bg-white border-0 outline-none ring-0 transition-all cursor-pointer group ${pathname === "/file-share"
                  ? "text-primary font-bold"
                  : "text-foreground hover:bg-muted/30"
                  }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="size-8.5 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0 shadow-2xs">
                    <FileShareDropzoneIcon className="size-4 shrink-0" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <span>File Share</span>
                      <span className="text-[9px] uppercase font-extrabold px-1.5 py-0.2 rounded-md bg-primary text-primary-foreground">
                        48h
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      Share files up to 100 MB via instant link
                    </p>
                  </div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0" />
              </Link>

              {/* Direct: PDF & Word Workspace */}
              <Link
                href="/"
                onClick={() => setMobileOpen(false)}
                className={`flex items-center justify-between px-3 py-2.5 rounded-xl bg-white border-0 outline-none ring-0 transition-all text-xs font-semibold cursor-pointer group ${pathname === "/"
                  ? "text-primary font-bold"
                  : "text-foreground hover:bg-muted/30"
                  }`}
              >
                <div className="flex items-center gap-2.5">
                  <div className="size-7 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <FileText className="size-3.5" />
                  </div>
                  <span>Edit PDF & Word (Workspace)</span>
                </div>
                <ChevronRight className="size-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </Link>

              {/* Minimal Dropdown Sections (Pages Accordion) */}
              <div className="space-y-2 pt-1">
                <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80 px-1">
                  Tools & Converters
                </p>

                {mobileSections.map((section) => {
                  const isOpen = !!openSections[section.id];
                  const hasActiveChild = section.items.some((i) => i.href === pathname);

                  return (
                    <div
                      key={section.id}
                      className={`rounded-xl transition-colors overflow-hidden border-0 outline-none ring-0 ${hasActiveChild
                        ? "bg-muted/60"
                        : "bg-muted/30"
                        }`}
                    >
                      {/* Accordion Dropdown Trigger */}
                      <button
                        type="button"
                        onClick={() => toggleSection(section.id)}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left text-xs font-semibold text-foreground hover:bg-muted/60 active:bg-muted transition-colors cursor-pointer select-none border-0 outline-none focus:outline-none ring-0 focus-visible:outline-none focus-visible:ring-0"
                        aria-expanded={isOpen}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {section.icon}
                          <span className="truncate">{section.title}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] font-semibold text-muted-foreground px-1.5 py-0.5 rounded-md bg-muted/80">
                            {section.items.length}
                          </span>
                          <ChevronDown
                            className={`size-3.5 text-muted-foreground transition-transform duration-200 ${isOpen ? "rotate-180 text-foreground" : ""
                              }`}
                          />
                        </div>
                      </button>

                      {/* Dropdown Items List */}
                      {isOpen && (
                        <div className="px-2 pt-1 pb-2 bg-muted/40 space-y-1 animate-in fade-in slide-in-from-top-1 duration-150 border-0 outline-none ring-0">
                          {section.items.map((item) => {
                            const isActive = pathname === item.href;
                            return (
                              <Link
                                key={item.href}
                                href={item.href}
                                onClick={() => setMobileOpen(false)}
                                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs font-medium transition-colors cursor-pointer group border-0 outline-none focus:outline-none ring-0 focus-visible:outline-none focus-visible:ring-0 ${isActive
                                  ? "bg-primary/10 text-primary font-bold"
                                  : "text-foreground/90 hover:bg-muted/80 hover:text-foreground"
                                  }`}
                              >
                                <span className="shrink-0 group-hover:scale-105 transition-transform">
                                  {item.icon}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-semibold">{item.title}</p>
                                  {item.desc && (
                                    <p className="text-[10px] text-muted-foreground truncate">
                                      {item.desc}
                                    </p>
                                  )}
                                </div>
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

            {/* Drawer Minimal Footer */}
            <div className="p-3 border-t border-border/50 bg-white flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span>Fast & Secure PDF Tools</span>
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
