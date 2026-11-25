import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { FileQuestion, Home, Layers, Scissors, Minimize2, Split } from "lucide-react";
import Button from "@/components/arc/button/button";

export default function NotFound() {
  const popularTools = [
    { href: "/merge-pdf", label: "Merge PDF", icon: Layers, desc: "Combine multiple PDFs into one" },
    { href: "/compress-pdf", label: "Compress PDF", icon: Minimize2, desc: "Reduce file size without quality loss" },
    { href: "/split-pdf", label: "Split PDF", icon: Scissors, desc: "Extract or separate PDF pages" },
    { href: "/compare-pdf", label: "Compare PDF", icon: Split, desc: "Side-by-side visual difference check" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <SiteHeader />

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-16 text-center">
        <div className="w-full max-w-xl mx-auto">
          <div className="inline-flex items-center justify-center size-20 rounded-3xl bg-primary/10 text-primary mb-6 shadow-sm">
            <FileQuestion className="size-10" />
          </div>

          <div className="text-xs uppercase font-bold tracking-widest text-primary mb-2">
            404 Error
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground mb-3">
            Page Not Found
          </h1>

          <p className="text-sm sm:text-base text-muted-foreground mb-8 max-w-md mx-auto leading-relaxed">
            The page or document you are trying to reach doesn&apos;t exist, has expired, or may have been moved.
          </p>

          <div className="flex justify-center mb-10">
            <Link href="/">
              <Button variant="primary" size="lg" className="inline-flex items-center gap-2">
                <Home className="size-4" />
                <span>Return to Home</span>
              </Button>
            </Link>
          </div>

          {/* Quick Shortcuts */}
          <div className="border-t border-border pt-8 text-left">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4 text-center">
              Popular PDF Tools
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {popularTools.map((tool) => {
                const Icon = tool.icon;
                return (
                  <Link
                    key={tool.href}
                    href={tool.href}
                    className="flex items-start gap-3 p-3.5 rounded-xl border border-border/60 bg-card hover:bg-muted/60 hover:border-primary/40 transition-all duration-200 group"
                  >
                    <div className="p-2 rounded-lg bg-primary/10 text-primary group-hover:scale-105 transition-transform duration-200">
                      <Icon className="size-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
                        {tool.label}
                      </div>
                      <div className="text-xs text-muted-foreground line-clamp-1">
                        {tool.desc}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
