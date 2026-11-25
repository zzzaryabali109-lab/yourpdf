"use client";

import { useSyncExternalStore } from "react";
import {
  ThemeSwitch,
  type Theme,
  type ThemeSwitchVariant,
} from "@/components/arc/theme-switch/theme-switch";

function subscribeTheme(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", callback);
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    media.removeEventListener("change", callback);
  };
}

function getThemeSnapshot(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function getServerThemeSnapshot(): Theme {
  return "light";
}

function subscribeMounted() {
  return () => {};
}

function getMountedSnapshot() {
  return true;
}

function getServerMountedSnapshot() {
  return false;
}

export function ThemeToggle({
  variant = "reveal",
  className,
}: {
  variant?: ThemeSwitchVariant;
  className?: string;
}) {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const mounted = useSyncExternalStore(subscribeMounted, getMountedSnapshot, getServerMountedSnapshot);

  const handleThemeChange = (next: Theme, _variant: ThemeSwitchVariant, trigger: HTMLElement) => {
    const isDark = next === "dark";

    const applyTheme = () => {
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("theme", next);
        window.dispatchEvent(new Event("storage"));
      } catch {
        // ignore storage write errors
      }
    };

    // If browser supports View Transitions API, execute smooth radial transition
    if (typeof document !== "undefined" && "startViewTransition" in document) {
      try {
        const rect = trigger.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const right = window.innerWidth - x;
        const bottom = window.innerHeight - y;
        const maxRadius = Math.hypot(Math.max(x, right), Math.max(y, bottom));

        const transition = (document as unknown as { startViewTransition: (cb: () => void) => { ready: Promise<void> } }).startViewTransition(() => {
          applyTheme();
        });

        transition.ready
          .then(() => {
            document.documentElement.animate(
              {
                clipPath: [
                  `circle(0px at ${x}px ${y}px)`,
                  `circle(${maxRadius}px at ${x}px ${y}px)`,
                ],
              },
              {
                duration: 380,
                easing: "ease-in-out",
                pseudoElement: "::view-transition-new(root)",
              },
            );
          })
          .catch(() => {
            applyTheme();
          });
        return;
      } catch {
        applyTheme();
        return;
      }
    }

    applyTheme();
  };

  if (!mounted) {
    return (
      <div
        className={`w-[38px] h-[38px] rounded-xl bg-muted/40 animate-pulse ${className ?? ""}`}
        aria-hidden="true"
      />
    );
  }

  return (
    <div className={className}>
      <ThemeSwitch
        theme={theme}
        variant={variant}
        iconOnly
        onThemeChange={handleThemeChange}
        label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
      />
    </div>
  );
}

export default ThemeToggle;
