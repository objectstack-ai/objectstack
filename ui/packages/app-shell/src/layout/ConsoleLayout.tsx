/**
 * ConsoleLayout
 *
 * Root layout shell for the console application. Composes the AppShell
 * with the UnifiedSidebar, header, and main content area.
 * Includes the global floating chatbot (FAB) widget.
 * Sets navigation context to 'app' for app-specific routes.
 * @module
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AppShell } from '@object-ui/layout';
import { useIsMobile } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';

// Lightweight FAB stub — the heavy chat chunk graph (plugin-chatbot,
// shiki, streamdown, mermaid, @ai-sdk, ~20MB) only downloads on first
// hover/click. See ConsoleChatbotFab.tsx.
import { ConsoleChatbotFab } from './ConsoleChatbotFab.js';
import { useChatDockState, ChatDockPanel, ChatDockMobileSheet } from './ChatDock.js';
import {
  matchChatDockShortcut,
  rememberDockReturnLocation,
  DOCK_EXPANDED_STORAGE_KEY,
} from './chatDockState.js';
import { DraftPreviewBar } from '../preview/DraftPreviewBar.js';
import { UnpublishedAppBar } from '../preview/UnpublishedAppBar.js';
import { ConsoleNotificationBanners } from './ConsoleNotificationBanners.js';
import { UnifiedSidebar } from './UnifiedSidebar.js';
import { AppHeader } from './AppHeader.js';
import { MobileViewSwitcherProvider } from './MobileViewSwitcherContext.js';
import { useResponsiveSidebar } from '../hooks/useResponsiveSidebar.js';
import { useAiSurfaceEnabled } from '../hooks/useAiSurface.js';
import { useNavigationContext } from '../context/NavigationContext.js';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider.js';
import { confirmUnsavedLeave } from '../chrome/unsavedEdits.js';
import {
  useAdvertiseShortcut,
  type AdvertisedShortcut,
  type ShortcutLabelTranslate,
} from '../chrome/advertisedShortcuts.js';
import { resolveKeyedI18nLabel } from '../utils/index.js';
import { getProductName } from '../runtime-config.js';
import type { ConnectionState } from '@object-ui/data-objectstack';

/** Minimal object shape used by the chatbot context */
interface ConsoleObject {
  name: string;
  label?: string;
}

interface ConsoleLayoutProps {
  children: React.ReactNode;
  activeAppName: string;
  activeApp: any;
  onAppChange: (name: string) => void;
  objects: any[];
  connectionState?: ConnectionState;
  /**
   * Signed-in user id. Forwarded to the floating chatbot so it can hydrate
   * server-backed conversation history. Omit for unauthenticated/local-only.
   */
  userId?: string;
}

/**
 * `⌘B` / `Ctrl+B` toggles the sidebar. The listener is `SidebarProvider`'s own
 * (`@object-ui/components`' synced Shadcn primitive, mounted by `AppShell`):
 * it matches `b` with ⌘ or Ctrl, and a bare `B` does nothing. That code is not
 * ours to edit, so the shortcut is advertised from inside the provider it
 * belongs to, by {@link ConsoleLayoutInner} (objectui#11674).
 */
const TOGGLE_SIDEBAR_SHORTCUT: AdvertisedShortcut = {
  id: 'toggle-sidebar',
  group: 'navigation',
  chord: { key: 'b', mod: true },
  label: (t: ShortcutLabelTranslate) => t('console.shortcuts.toggleSidebar'),
};

/**
 * The id of the console's route slot, the element that holds the page: the
 * skip link's target (objectui#13130).
 */
const CONSOLE_MAIN_CONTENT_ID = 'console-main-content';

/**
 * objectui#13130 — the shell's first Tab stop: "Skip to content", hidden until
 * it has keyboard focus. Without it a keyboard user walked the whole app bar
 * and every sidebar entry (two stops each: the link and its "More actions"
 * button) before reaching anything on the page.
 *
 * It moves focus to the route slot rather than navigating to the fragment:
 * the console is a routed app, and a hash written into the URL would be a
 * history entry and URL state nobody asked for (objectui AGENTS.md §5 #8). The
 * `href` keeps it a link, and is the fallback when the slot is not mounted.
 *
 * The target is the route slot, not the `<main>` around it: `<main>` belongs
 * to `@object-ui/layout`'s `AppShell`, which takes no id or ref for it, while
 * the slot is this layout's own element and is the one holding the page.
 */
function SkipToContentLink({ targetRef }: { targetRef: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useObjectTranslation();
  return (
    <a
      href={`#${CONSOLE_MAIN_CONTENT_ID}`}
      data-testid="console-skip-to-content"
      onClick={(event) => {
        const target = targetRef.current;
        if (!target) return;
        event.preventDefault();
        target.focus();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {t('console.skipToContent')}
    </a>
  );
}

/** Inner component that can access SidebarProvider context */
function ConsoleLayoutInner({ children }: { children: React.ReactNode }) {
  useResponsiveSidebar();
  useAdvertiseShortcut(TOGGLE_SIDEBAR_SHORTCUT);
  return <>{children}</>;
}

export function ConsoleLayout({
  children,
  activeAppName,
  activeApp,
  onAppChange,
  objects,
  connectionState,
  userId,
}: ConsoleLayoutProps) {
  const appLabel = resolveKeyedI18nLabel(activeApp?.label) || activeAppName;
  // Runtime, server-pushed AI gating (shared with the `/ai` route guard and the
  // top-bar AI link): show the chatbot only when the server actually serves AI,
  // or when an explicit `VITE_AI_BASE_URL` opt-in points at an external server.
  const { enabled: showChatbot } = useAiSurfaceEnabled();
  // ADR-0057 P2: the AI-Studio-off downgrade (a `build` default falls back to
  // `ask` when authoring is deployment-disabled) is no longer spelled here — it
  // is folded into the ONE `resolveSurfaceAgent` resolver, applied to the raw
  // `app.defaultAgent` below. This was the special case that existed nowhere
  // else; it now lives in exactly one place.
  const { setContext, setCurrentAppName } = useNavigationContext();
  // objectui#13130 — the skip link's target (see `SkipToContentLink`).
  const mainContentRef = useRef<HTMLDivElement>(null);

  // ADR-0057 P3 — the right-docked chat rail, the console's canonical chat
  // presentation (rollout complete; the FAB below is its launcher). Gated on
  // the same AI-surface signal as every entry point, so it renders nothing on
  // OSS / agent-less runtimes. The expanded state round-trips through
  // sessionStorage so the rail survives in-tab navigation, and so the `/ai`
  // page's collapse-to-dock affordance can arm it before navigating back here
  // (the maximize ⇄ tuck loop).
  const dock = useChatDockState({ persistExpandedKey: DOCK_EXPANDED_STORAGE_KEY });
  const dockEnabled = showChatbot;
  const navigate = useNavigate();
  const location = useLocation();
  // Under `md` there is no horizontal room for the rail — the dock presents as
  // a bottom sheet instead (same conversation, chrome only). The hook (not the
  // rail's `hidden md:` classes alone) decides which one MOUNTS, so the phone
  // never pays for an invisible rail's chat graph.
  const isMobile = useIsMobile();
  // "/ai = the dock maximized": record where we maximized FROM at click time,
  // so the page's collapse-to-dock returns exactly here (history-back could
  // land on a prior /ai URL after in-page conversation switches).
  // objectui#10926 — a build thread bound to this app maximizes to that app's
  // build surface, which resolves the same `app:PKG:build` thread.
  // objectui#13253 — maximizing leaves the page from a dock button, which no
  // page's link guard sees, so it asks first while the page holds unsaved
  // edits. On Cancel nothing is recorded and the page stays.
  const openDockFullPage = useCallback(
    (boundPackageId?: string) => {
      confirmUnsavedLeave(() => {
        rememberDockReturnLocation(`${location.pathname}${location.search}`);
        if (!boundPackageId) {
          navigate('/ai');
          return;
        }
        navigate(`/ai/build?package=${encodeURIComponent(boundPackageId)}`);
      });
    },
    [location.pathname, location.search, navigate],
  );

  // Set navigation context to 'app' when this layout mounts
  useEffect(() => {
    setContext('app');
    setCurrentAppName(activeAppName);
  }, [setContext, setCurrentAppName, activeAppName]);

  // ⌘/Ctrl+Shift+I toggles the dock (composer-safe; see matchChatDockShortcut).
  useEffect(() => {
    if (!dockEnabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (matchChatDockShortcut(e) !== 'toggle') return;
      e.preventDefault();
      dock.toggle();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [dockEnabled, dock]);

  return (
    // One shared, URL-addressable command-palette open state for both the
    // AppHeader trigger (navbar) and the CommandPalette (children) — ADR-0054.
    <CommandPaletteProvider>
    <MobileViewSwitcherProvider>
    {/* objectui#13130 — first in the DOM, so it is the first Tab stop. */}
    <SkipToContentLink targetRef={mainContentRef} />
    <AppShell
      sidebar={
         <UnifiedSidebar
           activeAppName={activeAppName}
           onAppChange={onAppChange}
         />
      }
      navbar={
          <AppHeader
            variant="app"
            appName={appLabel}
            objects={objects}
            connectionState={connectionState}
            activeAppName={activeAppName}
            onAppChange={onAppChange}
          />
      }
      // objectui#12463 — from `lg` up the inset is a flex column: the banners
      // box (`shrink-0`, below) keeps its height and the route slot (below)
      // gives up the rest. Before, the route content (the console's `h-full`
      // route fader) was 100% of the inset ON TOP of any banner, so a page
      // that bounds itself and scrolls in its own box (the object list page)
      // overflowed the inset by the banner's height: a second scroller over
      // the table's, the record-count footer below the fold. The phone keeps
      // block layout.
      className="!p-0 overflow-y-auto overflow-x-hidden bg-muted/5 lg:flex lg:flex-col"
      rightRail={
        dockEnabled && dock.expanded && !isMobile ? (
          <ChatDockPanel
            dock={dock}
            userId={userId}
            // The dock honors the app's own default agent exactly like the FAB
            // did — through the ONE resolver (bounded to ask/build there).
            defaultAgent={activeApp?.defaultAgent}
            // objectui#10926 — the app a build thread binds to (authorable
            // packages only; the dock decides).
            appPackageId={activeApp?._packageId}
            // ADR-0057 P3c — "/ai = the dock maximized": the maximize button
            // opens the full-page surface on THE SAME THREAD this rail shows —
            // `/ai` for an app-less thread (canonicalized to the default agent,
            // same `(user, product)` scope), `/ai/build?package=PKG` for one
            // bound to this app.
            onMaximize={openDockFullPage}
          />
        ) : undefined
      }
      branding={
        activeApp?.branding
          ? {
              primaryColor: activeApp.branding.primaryColor,
              accentColor: activeApp.branding.accentColor,
              favicon: activeApp.branding.favicon,
              title: activeApp.label
                ? `${resolveKeyedI18nLabel(activeApp.label)} — ${getProductName()}`
                : undefined,
            }
          : undefined
      }
    >
      <ConsoleLayoutInner>
        {/* ADR-0037: unmistakable watermark while rendering the draft overlay
            (?preview=draft) — with one-click exit and one-click Publish. */}
        {/* objectui#12463 — the banners sit in one non-shrinking box, so in
            the `lg` flex column above only the route page gives up height. */}
        <div data-testid="console-banners" className="shrink-0">
        <DraftPreviewBar />
        {/* ADR-0045: materialized-but-unlisted app — real and interactive,
            invisible to end users until the Publish visibility flip. */}
        <UnpublishedAppBar />
        {/* #3014: `displayType: 'banner'` notifications. In flow, above the
            route content and below the two preview bars — a banner states a
            standing condition, same as its neighbours here. */}
        <ConsoleNotificationBanners />
        </div>
        {/* objectui#12463 — the route slot: the ONE flex item allowed below its
            content height (`min-h-0`). An `h-full` box whose overflow is
            visible has an automatic minimum height of its own 100%, so without
            it the slot would not shrink below the banners. It is a block box,
            so a natural-height page inside it (search results, marketplace)
            keeps its full height and overflows the slot; the inset scrolls it
            exactly as before, and a `sticky` element inside the page still has
            the whole page to stick within. ⛔ Never force `min-h-0` on every
            inset child instead: a page root placed directly in a flex column
            with `min-h-0` is squeezed to the inset's height.
            objectui#13130 — the skip link's target: focusable by script
            (`tabIndex={-1}`), never a Tab stop of its own. */}
        <div
          id={CONSOLE_MAIN_CONTENT_ID}
          ref={mainContentRef}
          tabIndex={-1}
          data-testid="console-route"
          className="h-full lg:min-h-0 focus:outline-none"
        >
        {children}
        </div>
      </ConsoleLayoutInner>

      {/* The dock's launcher — rendered when AI service is available OR when
          `VITE_AI_BASE_URL` has been explicitly configured. Dependency-free;
          the chat graph loads with the dock, on demand.
          It is the dock's COLLAPSED affordance (ADR-0057 open question 2), so
          it leaves while the dock is open: a fixed bottom-right button over an
          expanded rail sat on the composer's send button (objectui#10899). The
          rail and the sheet carry their own collapse / close controls. */}
      {showChatbot && !dock.expanded && (
        <ConsoleChatbotFab appLabel={appLabel} onOpenDock={dock.expand} />
      )}

      {/* Under `md` the FAB opens the dock as a bottom sheet (no room for a
          rail on a phone) — same conversation, chrome only. */}
      {dockEnabled && isMobile && (
        <ChatDockMobileSheet
          open={dock.expanded}
          onOpenChange={(open) => (open ? dock.expand() : dock.collapse())}
          userId={userId}
          defaultAgent={activeApp?.defaultAgent}
          appPackageId={activeApp?._packageId}
          // Bridge to full-page /ai (history + share live there on mobile). The
          // sheet defers the navigation until it has cleanly closed.
          onMaximize={openDockFullPage}
        />
      )}
    </AppShell>
    </MobileViewSwitcherProvider>
    </CommandPaletteProvider>
  );
}
