import Image from "next/image";
import Link from "next/link";
import { Mail } from "lucide-react";

const footerLinks = [
  { label: "Edit PDF", href: "/" },
  { label: "Compress", href: "/compress-pdf" },
  { label: "Merge", href: "/merge-pdf" },
  { label: "PDF to Word", href: "/pdf-to-word" },
  { label: "File Share", href: "/file-share" },
];

export function SiteFooter() {
  return (
    <footer className="w-full border-t border-border/40 bg-background/95">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-4 py-4 md:flex-row sm:px-6 sm:py-5">
        <nav
          className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5"
          aria-label="Footer navigation"
        >
          {footerLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs font-medium text-muted-foreground">
          <a
            href="mailto:helloidentity.co@gmail.com"
            aria-label="Contact Identity via email"
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors hover:bg-muted/70 hover:text-foreground"
          >
            <Mail className="size-3.5 shrink-0" aria-hidden="true" />
            <span>helloidentity.co@gmail.com</span>
          </a>

          <span className="hidden h-3.5 w-px bg-border/70 sm:inline-block" aria-hidden="true" />

          <div className="flex items-center gap-2.5">
            <div className="flex items-center gap-2">
              <span>© 2026 Copyright by</span>
              <a
                href="https://helloidentity.co/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Visit Identity website"
                className="inline-flex items-center transition-opacity hover:opacity-80"
              >
                <Image
                  src="/identity-logo-light.webp"
                  alt="Identity"
                  width={3840}
                  height={1265}
                  unoptimized
                  className="h-[22px] w-auto object-contain dark:hidden sm:h-6"
                />
                <Image
                  src="/identity-logo-dark.webp"
                  alt="Identity"
                  width={3840}
                  height={1265}
                  unoptimized
                  className="hidden h-[22px] w-auto object-contain dark:block sm:h-6"
                />
              </a>
            </div>

            <span className="h-3.5 w-px bg-border/70" aria-hidden="true" />

            <a
              href="https://www.instagram.com/helloidentity.co/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Identity on Instagram"
              title="Instagram"
              className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/70 hover:text-[#E1306C]"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-4"
                aria-hidden="true"
              >
                <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
              </svg>
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default SiteFooter;
