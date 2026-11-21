/**
 * ConsoleLayout
 *
 * Root layout shell for the console application. Composes the AppShell
 * with the UnifiedSidebar, header, and main content area, and hosts the AI
 * assistant's drawer (objectstack#34608: the right rail, opened by the top-bar
 * robot). Sets navigation context to 'app' for app-specific routes.
 * @module
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { AppShell } from '@object-ui/layout';
import { cn } from '@object-ui/components';
import { useObjectLabel, useObjectTranslation } from '@object-ui/i18n';

// The drawer's chrome is eager; the chat graph (plugin-chatbot, shiki,
// streamdown, mermaid, @ai-sdk) loads with its body, when it first opens.
import { useConsoleChatDock } from './useConsoleChatDock.js';
import { ChatDockControlProvider } from './chatDockControl.js';
import { consoleChatSurface } from './chatSurfaceContext.js';
import { DraftPreviewBar } from '../preview/DraftPreviewBar.js';
import { UnpublishedAppBar } from '../preview/UnpublishedAppBar.js';
import { ConsoleNotificationBanners } from './ConsoleNotificationBanners.js';
import { UnifiedSidebar } from './UnifiedSidebar.js';
import { PhoneAppNavBar, isPhoneTabRoute } from './PhoneAppNavBar.js';
import { PhoneAppHomeSlotProvider } from './PhoneAppHome.js';
import { PhonePageBarProvider } from './PhonePageBar.js';
import { useLastApp } from '../context/LastAppProvider.js';
import { useMetadata } from '../providers/MetadataProvider.js';
import { appAddressSegment } from '../utils/appRoute.js';
import { ShellPageActionsScope, ShellSidebarExpandFallback } from './ShellPageActions.js';
import { ChromeBannerHost } from './chromeBannerHost.js';
import { ConnectionBanner } from './ConnectionBanner.js';
import { useGoHomeShortcut } from '../chrome/goHomeShortcut.js';
import { useHomePath } from '../hooks/useHomePath.js';
import { AppHeader } from './AppHeader.js';
import { useResponsiveSidebar } from '../hooks/useResponsiveSidebar.js';
import { usePhoneNavDrawerHistory } from './usePhoneNavDrawerHistory.js';
import { usePhoneViewport } from '../hooks/usePhoneViewport.js';
import { primeConsoleSidebarOpen } from './consoleSidebarRail.js';
import { useAiSurfaceEnabled } from '../hooks/useAiSurface.js';
import { servedObjectLabel } from '../hooks/servedObjectLabel.js';
import { useNavigationContext } from '../context/NavigationContext.js';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider.js';
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
  /**
   * objectstack#30043 — the paths of the host's extra app routes
   * (`AppContent`'s `extraRoutes`). A page one of them draws names no surface
   * to the dock, the way it shadows `:objectName` in `<Routes>`.
   */
  hostRoutePaths?: readonly string[];
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

/**
 * Is `pathname` a record page, the console route `RecordDetailView` draws:
 * `/apps/APP/OBJECT/record/ID`, or the same record on a named record page
 * (`.../page/PAGE`)? The record's edit form (`.../edit`) is not one.
 */
export function isRecordPagePath(pathname: string): boolean {
  return /^\/apps\/[^/]+\/[^/]+\/record\/[^/]+(?:\/page\/[^/]+)?\/?$/.test(pathname);
}

/**
 * Is `pathname` one of an app's documentation pages, `/apps/APP/docs` and
 * everything under it (objectstack#35424)? A reader there has one navigation,
 * the docs' own, so the app's menu is not drawn beside it.
 */
export function isAppDocsPath(pathname: string): boolean {
  return /^\/apps\/[^/]+\/docs(?:\/|$)/.test(pathname);
}

/** Inner component that can access SidebarProvider context */
function ConsoleLayoutInner({ children }: { children: React.ReactNode }) {
  useResponsiveSidebar();
  usePhoneNavDrawerHistory();
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
  hostRoutePaths,
}: ConsoleLayoutProps) {
  const appLabel = resolveKeyedI18nLabel(activeApp?.label) || activeAppName;
  // objectstack#28077 — once, before `AppShell`'s sidebar provider reads its
  // cookie: a narrow window's first frame is already the rail.
  useState(primeConsoleSidebarOpen);
  // Runtime, server-pushed AI gating (shared with the `/ai` route guard and the
  // top-bar robot): the drawer exists only when the server actually serves AI,
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

  const location = useLocation();
  // ⌘⇧H home from any app page, at every width (objectui#12605).
  const homePath = useHomePath();
  useGoHomeShortcut(true, homePath);
  // objectstack#28483 (ruling letter A) — on a phone a record page has one
  // bar, its own top bar (「‹ <object plural>」 and the stepper), so the app
  // bar is not mounted there. The app menu, search, notifications and account
  // stay on every other route, one 「‹」 away. From 768 px up every route keeps
  // the app bar. The width is read synchronously, at the breakpoint the record
  // page draws its phone face at, so the two never disagree for a frame.
  const phone = usePhoneViewport();
  const recordPageOwnsTopBar = phone && isRecordPagePath(location.pathname);
  // objectstack#35882 — on a phone the bottom bar (Home, Notifications,
  // Approvals, search) is drawn on the three pages it opens and on no page
  // below them: a list, a record or a form has the page to itself, and 「‹」 at
  // the top left goes back. The route slot leaves the bar's height free at its
  // end.
  const phoneNavBar = phone && isPhoneTabRoute(location.pathname);
  // objectstack#35424 — a docs page draws its own left column (the app's
  // books and a way back to the app), so the app menu is not mounted there.
  const docsPage = isAppDocsPath(location.pathname);
  // objectstack#35881 — the app this person last had open, where a phone
  // lands after sign-in. Recorded at every width: it is the person's last app.
  const { rememberApp } = useLastApp();
  useEffect(() => {
    if (activeAppName) rememberApp(activeAppName);
  }, [activeAppName, rememberApp]);
  const { apps: metadataApps } = useMetadata();
  const appBasePath = `/apps/${appAddressSegment(metadataApps, activeApp) ?? activeAppName}`;
  // objectstack#30043 — the page in view, handed to the dock as its
  // `context.surface` (cloud#1610's shape): the object of a list, the object
  // and record id of a record page, the dashboard, report or page. Read off the
  // URL each render, so the next send after a navigation carries the new page.
  // objectstack#28106 — the query string too: a record open in a list's
  // detail drawer (`?recordId=`) is the record in view.
  const dockSurface = useMemo(
    () => consoleChatSurface(location.pathname, hostRoutePaths, location.search),
    [location.pathname, location.search, hostRoutePaths],
  );
  // The chip's label for an object surface: the object's own translated
  // label, the one its page shows: the served label as given, the bundle only
  // when none is served. Display only; it never enters `context.surface`. No
  // definition in hand → the chip reads `type · name`.
  const { objectLabel } = useObjectLabel();
  const { language } = useObjectTranslation();
  const dockSurfaceLabel = useMemo(() => {
    const artifact = dockSurface?.artifact;
    if (artifact?.type !== 'object') return undefined;
    const def = (objects as ConsoleObject[] | undefined)?.find((o) => o?.name === artifact.name);
    return def ? servedObjectLabel(def, language, objectLabel) || undefined : undefined;
  }, [dockSurface, objects, objectLabel, language]);
  // objectstack#34608 — the console's one chat container. Same AI-surface gate
  // as every entry point, so it renders nothing on OSS / agent-less runtimes.
  // The dock honors the app's own default agent through the ONE resolver
  // (bounded to ask/build there); a build thread binds to this app when its
  // package is authorable (objectui#10926, the dock decides).
  const chatDock = useConsoleChatDock({
    enabled: showChatbot,
    userId,
    defaultAgent: activeApp?.defaultAgent,
    appPackageId: activeApp?._packageId,
    surfaceContext: dockSurface,
    surfaceArtifactLabel: dockSurfaceLabel,
  });

  // Set navigation context to 'app' when this layout mounts
  useEffect(() => {
    setContext('app');
    setCurrentAppName(activeAppName);
  }, [setContext, setCurrentAppName, activeAppName]);

  return (
    // The drawer's handle, for the top-bar robot and the pages (objectstack#34608).
    <ChatDockControlProvider value={chatDock.control}>
    {/* One shared, URL-addressable command-palette open state for both the
        AppHeader trigger (navbar) and the CommandPalette (children) — ADR-0054. */}
    <CommandPaletteProvider>
    {/* objectui#13130 — first in the DOM, so it is the first Tab stop. */}
    <SkipToContentLink targetRef={mainContentRef} />
    {/* objectstack#35881 — the phone app home's slot, shared by the sidebar
        (which draws the menu into it) and the route (which holds it). */}
    <PhoneAppHomeSlotProvider>
    {/* objectstack#35883 — a page's own phone top row, drawn by the app bar. */}
    <PhonePageBarProvider>
    <AppShell
      sidebar={
        docsPage ? undefined : (
         <UnifiedSidebar
           activeAppName={activeAppName}
           onAppChange={onAppChange}
           railOverlay
         />
        )
      }
      // objectstack#36112 — from 768 px up an app draws no top bar: the app
      // menu, search, bell and account are the sidebar's, the page's buttons
      // its own header's. A phone keeps its bar (and its record page draws its
      // own instead, objectstack#28483). An app's docs pages keep it at every
      // width: they mount no sidebar (objectstack#35424), so the bar is still
      // where their account, search and bell are.
      showHeader={(phone || docsPage) && !recordPageOwnsTopBar}
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
      //
      // objectstack#34594 — while the phone bottom bar is drawn, the inset keeps
      // the bar's height (h-12, its 4 px padding each side, plus the safe
      // area; objectstack#35882) free at its bottom: a page
      // that bounds itself to the inset ends above the bar (the inset's
      // content box is that much shorter), and a taller page scrolls its last
      // row out from under the bar (a scroll container's end padding scrolls).
      className={cn(
        '!p-0 overflow-y-auto overflow-x-hidden bg-muted/5 lg:flex lg:flex-col',
        phoneNavBar && '!pb-[calc(3.5rem+env(safe-area-inset-bottom))]',
      )}
      rightRail={chatDock.rail}
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
        {/* objectstack#36111 — the pages under the shell draw its top-right
            button group; objectstack#36112 — and the sidebar's expand button
            at their headers' left edge while it is collapsed. */}
        <ShellPageActionsScope sidebarExpand={!docsPage}>
        {/* ADR-0037: unmistakable watermark while rendering the draft overlay
            (?preview=draft) — with one-click exit and one-click Publish. */}
        {/* objectui#12463 — the banners sit in one non-shrinking box, so in
            the `lg` flex column above only the route page gives up height. */}
        <div data-testid="console-banners" className="shrink-0">
        {/* objectstack#36112 — from 768 px up the shell's standing banners
            (impersonation, read rate, storage) and the connection notice sit
            here, the content's width, since no top bar carries them. */}
        {!phone && <ChromeBannerHost />}
        {/* A docs page's bar draws the connection state itself. */}
        {!phone && !docsPage && <ConnectionBanner state={connectionState} />}
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
        <ShellSidebarExpandFallback />
        {children}
        </div>
        </ShellPageActionsScope>
      </ConsoleLayoutInner>

      {/* objectstack#35882 — the phone's bottom bar, after the page in reading order. */}
      {phoneNavBar && <PhoneAppNavBar basePath={appBasePath} activeAppName={activeAppName} />}

      {/* Under `md` the drawer is a bottom sheet (no room for a rail on a phone). */}
      {chatDock.sheet}
    </AppShell>
    </PhonePageBarProvider>
    </PhoneAppHomeSlotProvider>
    </CommandPaletteProvider>
    </ChatDockControlProvider>
  );
}
