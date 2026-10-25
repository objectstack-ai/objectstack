import React, { useEffect } from 'react';
import {
  SidebarProvider,
  SidebarInset
} from '@object-ui/components';
import { cn } from '@object-ui/components';

/**
 * Branding configuration for the AppShell.
 * Applies CSS custom properties to the document root for theme customization.
 */
export interface AppShellBranding {
  /** Primary brand color (hex, e.g. "#3B82F6") */
  primaryColor?: string;
  /** Accent brand color (hex, e.g. "#10B981") */
  accentColor?: string;
  /** Favicon URL — replaces the <link rel="icon"> href */
  favicon?: string;
  /**
   * Assigned to `document.title` as given. It is the whole title, not a suffix:
   * the caller composes the string it wants (the console passes
   * `"App label — Product name"`).
   */
  title?: string;
}

export interface AppShellProps {
  sidebar?: React.ReactNode;
  navbar?: React.ReactNode; // Top navbar content
  children: React.ReactNode;
  className?: string;
  defaultOpen?: boolean;
  /** App branding — applies CSS custom properties for theming */
  branding?: AppShellBranding;
  /**
   * Optional right-side rail rendered as a flex sibling of the main content, so
   * it reflows the content beside it (VS Code / Cursor idiom) rather than
   * overlaying it (ADR-0057 P3a ChatDock). Absent → unchanged single-pane layout;
   * this is purely additive.
   */
  rightRail?: React.ReactNode;
}

/**
 * Convert a hex color (#RRGGBB) to a parsed HSL triple.
 */
function hexToHSLParts(hex: string): { h: number; s: number; l: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;

  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

/**
 * Convert a hex color (#RRGGBB) to HSL string "H S% L%"
 * for use in Tailwind CSS custom properties.
 */
function hexToHSL(hex: string): string | null {
  const parts = hexToHSLParts(hex);
  if (!parts) return null;
  return `${Math.round(parts.h)} ${Math.round(parts.s)}% ${Math.round(parts.l)}%`;
}

/**
 * Compute a dark-mode-friendly variant of a brand color. Raises lightness
 * so brand-tinted text/icons stay readable against dark backgrounds while
 * preserving the original hue. No-op when the source is already light enough.
 */
function hexToDarkModeHSL(hex: string): string | null {
  const parts = hexToHSLParts(hex);
  if (!parts) return null;
  // Target a minimum lightness of ~65% on dark surfaces (WCAG-friendly for
  // body text and accents on near-black backgrounds). Slightly desaturate
  // very saturated brand colors so they don't vibrate on dark.
  const l = Math.max(parts.l, 65);
  const s = parts.s > 80 ? Math.max(parts.s - 10, 70) : parts.s;
  return `${Math.round(parts.h)} ${Math.round(s)}% ${Math.round(l)}%`;
}

/**
 * Compute readable foreground (white or near-black) for a hex color
 * using the WCAG relative luminance formula. Returns an HSL string.
 */
function foregroundForHex(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return '0 0% 100%';
  const toLin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = toLin(parseInt(result[1], 16));
  const g = toLin(parseInt(result[2], 16));
  const b = toLin(parseInt(result[3], 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // Threshold tuned for typical brand colors. Use near-black for very light
  // brands and pure white otherwise.
  return luminance > 0.6 ? '222 47% 11%' : '0 0% 100%';
}

/**
 * Apply branding CSS custom properties to the document root.
 * This is extracted as a standalone hook so it can be re-used independently.
 *
 * It is also the ONE writer of `document.title` for as long as a shell is
 * mounted (objectui#8637). Ownership is scoped, not permanent: the hook
 * captures whatever the tab already said, writes `title` over it, and puts the
 * captured string back when the shell unmounts or `title` changes. So a host
 * that mounts a shell for part of its route tree gets the specific title while
 * it is there and its previous title back when it leaves, without a second
 * writer keyed on navigation — which is what the console used to do, and what
 * reverted the composed title to the bare product name on every in-app
 * navigation.
 *
 * ⚠️ The capture is a read of the live `document.title`, so a host that lets
 * something else write the tab title WHILE a shell is mounted hands this hook a
 * value it did not put there, and that value is what comes back on unmount.
 * Nesting a second title-writing surface inside a mounted shell is the shape to
 * avoid; the console's own auth surfaces sit outside the shell for this reason.
 *
 * The favicon is scoped the same way (objectui#10040): when `branding.favicon`
 * is set and the page has an icon link, the hook captures that link's `href`
 * attribute, writes the branded URL, and puts the captured attribute back (or
 * removes it, if there was none) when the shell unmounts or the effect re-runs
 * on changed inputs. The same replay caveat applies — an icon written by something else
 * while the shell is mounted is overwritten by the restore.
 */
export function useAppShellBranding(branding?: AppShellBranding, title?: string) {
  useEffect(() => {
    const root = document.documentElement;

    const isDark = () => root.classList.contains('dark');

    const apply = () => {
      // Primary color
      // Per ObjectStack spec, AppSchema.branding.primaryColor is a hex code.
      // We translate it to the Shadcn theme tokens (`--primary` + foreground)
      // so that all `bg-primary` / `text-primary` / `ring-primary` consumers
      // throughout the UI inherit the brand color automatically.
      if (branding?.primaryColor) {
        const hsl = hexToHSL(branding.primaryColor);
        const hslDark = hexToDarkModeHSL(branding.primaryColor);
        const effective = isDark() ? hslDark || hsl : hsl;
        if (effective) {
          // Backward-compat alias (may be removed once no consumers depend on it)
          root.style.setProperty('--brand-primary', branding.primaryColor);
          root.style.setProperty('--brand-primary-hsl', hsl || effective);

          // Override Shadcn theme tokens — this is what makes the brand color
          // actually visible on buttons, focus rings, sidebar highlights, etc.
          // In dark mode we use a brighter variant for readable contrast.
          root.style.setProperty('--primary', effective);
          root.style.setProperty(
            '--primary-foreground',
            isDark() ? '222 47% 11%' : foregroundForHex(branding.primaryColor)
          );
          root.style.setProperty('--ring', effective);
          root.style.setProperty('--sidebar-primary', effective);
          root.style.setProperty('--sidebar-ring', effective);
        }
      } else {
        root.style.removeProperty('--brand-primary');
        root.style.removeProperty('--brand-primary-hsl');
        root.style.removeProperty('--primary');
        root.style.removeProperty('--primary-foreground');
        root.style.removeProperty('--ring');
        root.style.removeProperty('--sidebar-primary');
        root.style.removeProperty('--sidebar-ring');
      }

      // Accent color
      if (branding?.accentColor) {
        const hsl = hexToHSL(branding.accentColor);
        const hslDark = hexToDarkModeHSL(branding.accentColor);
        const effective = isDark() ? hslDark || hsl : hsl;
        if (effective) {
          root.style.setProperty('--brand-accent', branding.accentColor);
          root.style.setProperty('--brand-accent-hsl', hsl || effective);
          // Map accent to Shadcn `--accent` so secondary highlights pick it up.
          root.style.setProperty('--accent', effective);
          root.style.setProperty(
            '--accent-foreground',
            isDark() ? '222 47% 11%' : foregroundForHex(branding.accentColor)
          );
        }
      } else {
        root.style.removeProperty('--brand-accent');
        root.style.removeProperty('--brand-accent-hsl');
        root.style.removeProperty('--accent');
        root.style.removeProperty('--accent-foreground');
      }
    };

    apply();

    // Re-apply when the theme class on <html> changes (light/dark toggle),
    // so the brand color stays readable across modes without a remount.
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'class') {
          apply();
          break;
        }
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });

    // Favicon — scoped the same way as the title below (objectui#10040): the
    // link this effect writes, and the `href` it replaced, are captured so the
    // cleanup can hand the previous icon back. `faviconLink` stays `null` when
    // this hook writes nothing (no `favicon`, or no icon link to write to), so
    // that case restores nothing either.
    //
    // The capture reads the ATTRIBUTE, not the `link.href` property: the
    // property is the URL resolved against the document, so an icon link that
    // ships `href=""` (the console's does, until an operator favicon is
    // configured) would read back as the page's own URL and be "restored" to a
    // value it never had. `null` means the attribute was absent, and the
    // cleanup removes it rather than inventing an empty one.
    let faviconLink: HTMLLinkElement | null = null;
    let previousFaviconHref: string | null = null;
    if (branding?.favicon) {
      const link = document.querySelector<HTMLLinkElement>('#favicon')
        || document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (link) {
        faviconLink = link;
        previousFaviconHref = link.getAttribute('href');
        link.href = branding.favicon;
      }
    }

    // Page title. `previousTitle` stays `null` when this hook writes nothing,
    // so the no-`title` case restores nothing either — a shell without a title
    // leaves the tab entirely alone in both directions.
    let previousTitle: string | null = null;
    if (title) {
      previousTitle = document.title;
      document.title = title;
    }

    return () => {
      observer.disconnect();
      if (previousTitle !== null) {
        document.title = previousTitle;
      }
      if (faviconLink) {
        if (previousFaviconHref === null) {
          faviconLink.removeAttribute('href');
        } else {
          faviconLink.setAttribute('href', previousFaviconHref);
        }
      }
      root.style.removeProperty('--brand-primary');
      root.style.removeProperty('--brand-primary-hsl');
      root.style.removeProperty('--brand-accent');
      root.style.removeProperty('--brand-accent-hsl');
      root.style.removeProperty('--primary');
      root.style.removeProperty('--primary-foreground');
      root.style.removeProperty('--ring');
      root.style.removeProperty('--sidebar-primary');
      root.style.removeProperty('--sidebar-ring');
      root.style.removeProperty('--accent');
      root.style.removeProperty('--accent-foreground');
    };
  }, [branding?.primaryColor, branding?.accentColor, branding?.favicon, title]);
}

export function AppShell({
  sidebar,
  navbar,
  children,
  className,
  defaultOpen = true,
  branding,
  rightRail,
}: AppShellProps) {
  // Apply branding CSS custom properties
  useAppShellBranding(branding, branding?.title);

  return (
    <SidebarProvider defaultOpen={defaultOpen} className="!flex-col h-svh overflow-hidden">
      {/* 1. Full-width top bar spanning entire screen. 48 px, the height of
          every console frame's bar (objectui#12639): the class is the one
          `@object-ui/app-shell` spells as `CONSOLE_TOP_BAR`, and that
          package's `consoleTopBar.height-12639` test holds this copy equal
          to it. */}
      <header className="sticky top-0 z-30 flex h-12 w-full shrink-0 items-center gap-2 border-b bg-background px-2 sm:px-4">
        {navbar}
      </header>

      {/* 2. Lower section: sidebar + main content (+ optional right rail) */}
      <div className="flex flex-1 min-h-0 w-full">
        {sidebar}
        {/* `SidebarInset` is the page's one `main` landmark (it renders a
            `<main>`), so the content element inside it is a plain `<div>`: a
            second `<main>` here made every console page announce two main
            regions (objectui#13334). */}
        <SidebarInset className="min-w-0">
          <div className={cn("flex-1 min-w-0 overflow-auto p-3 sm:p-4 md:p-6 pb-20 sm:pb-4 md:pb-6", className)}>
            {children}
          </div>
        </SidebarInset>
        {/* ADR-0057 P3a — additive right rail (ChatDock); absent → unchanged. */}
        {rightRail}
      </div>
    </SidebarProvider>
  );
}
