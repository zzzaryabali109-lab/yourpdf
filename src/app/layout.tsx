import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "@/components/arc/foundation.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClearPDF — PDF Document Processing",
  description: "A simple workspace for getting started with scanned and searchable PDFs.",
};

const themeInitScript = `
  (function() {
    try {
      var stored = localStorage.getItem('theme');
      var isDark = stored === 'dark' || (!stored && window.matchMedia('(prefers-color-scheme: dark)').matches);
      if (isDark) {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.setAttribute('data-theme', 'light');
      }
    } catch (e) {}
  })();
`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-full flex flex-col bg-background text-foreground transition-colors duration-150">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
