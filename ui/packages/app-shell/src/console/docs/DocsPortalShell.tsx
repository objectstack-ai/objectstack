// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DocsPortalShell — the frame of the documentation portal (`/docs…`,
 * ADR-0046 §6), the docs route that names no app.
 *
 * From 768 px up it is an app-less variant of the app shell (ruling B,
 * 7151721568 on objectstack#37150; design approved on objectstack#37197): the
 * same `AppShell` and `UnifiedSidebar` an app's docs pages draw in
 * (objectstack#37150), so the two entry points to the same documents share one
 * frame (ruling A on objectstack#36107). No top bar; the sidebar's head carries
 * search (when there is an app to search) and the bell, its foot the account,
 * and the collapse button works as on every app page. The standing banners
 * (impersonation, read rate, storage) and the connection notice sit at the top
 * of the content area, the content's width, as in an app (`ChromeBannerHost`,
 * `ConnectionBanner`): drawn above the route they would span the sidebar's
 * column and cover its head. Two things differ from an app's docs pages:
 *
 * - the head is a neutral 「Documentation」 menu (`SidebarDocsPortalMenu`)
 *   that lists the viewer's apps and 「Add app」, none of them checked, in
 *   place of an app's name menu;
 * - the body is the portal's docs tree, every book under its app's heading,
 *   which the page draws through the docs-navigation slot
 *   (`sidebarDocsNavSlot.tsx`).
 *
 * ⭐ No app is guessed (objectui#4280 refused a guessed-app sidebar on an
 * app-less route): the navigation context is `home`, as Home's frame sets it;
 * nothing is written to the current or the last app; no app's branding is
 * applied, so the accent is the console's default. Choosing an app in the
 * head opens that app. The command palette is Home's (`HomeCommandPalette`,
 * scoped as on Home and in the portal's phone frame), the AI drawer is Home's
 * (no app, so a build thread starts unbound), and the page header's button
 * group is the app-less one (`ShellPageActionsScope appless`).
 *
 * A phone keeps Home's frame with the docs bar (`HomeLayout variant="docs"`),
 * unchanged.
 *
 * @module
 */

import React, { useEffect, useMemo, useState } from 'react';
import type { ConnectionState } from '@object-ui/data-objectstack';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@object-ui/layout';
import { useAuth } from '@object-ui/auth';
import { useNavigationContext } from '../../context/NavigationContext.js';
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider.js';
import { useMetadata } from '../../providers/MetadataProvider.js';
import { useAdapter } from '../../providers/AdapterProvider.js';
import { filterActiveApps, matchAppBySegment, resolveHostAppSegment } from '../../utils/index.js';
import { ExpressionProvider } from '../../providers/ExpressionProvider.js';
import { buildExpressionUser } from '../../providers/expressionUser.js';
import { useAiSurfaceEnabled } from '../../hooks/useAiSurface.js';
import { useResponsiveSidebar } from '../../hooks/useResponsiveSidebar.js';
import { usePhoneViewport } from '../../hooks/usePhoneViewport.js';
import { useConsoleChatDock } from '../../layout/useConsoleChatDock.js';
import { ChatDockControlProvider } from '../../layout/chatDockControl.js';
import { UnifiedSidebar } from '../../layout/UnifiedSidebar.js';
import { SidebarDocsNavSlotProvider } from '../../layout/sidebarDocsNavSlot.js';
import { ShellPageActionsScope, ShellSidebarExpandFallback } from '../../layout/ShellPageActions.js';
import { primeConsoleSidebarOpen } from '../../layout/consoleSidebarRail.js';
import { ChromeBannerHost } from '../../layout/chromeBannerHost.js';
import { ConnectionBanner } from '../../layout/ConnectionBanner.js';
import { HomeCommandPalette, HomeLayout } from '../home/HomeLayout.js';

/** Home's `app`, `data` and `features`: none (module constants, as Home's). */
const NO_SCOPE_INPUT: Record<string, never> = {};

export interface DocsPortalShellProps {
  children: React.ReactNode;
  /** Signed-in user id, for the AI drawer (as `HomeLayout` takes it). */
  userId?: string;
}

/**
 * The data adapter's connection state, as `AppContent` reads it for an app's
 * layout: its current answer, then each change it reports. `undefined` with no
 * adapter, or one that reports none.
 */
function useAdapterConnectionState(dataSource: unknown): ConnectionState | undefined {
  const adapter = dataSource as {
    getConnectionState?: () => ConnectionState;
    onConnectionStateChange?: (listener: (event: { state: ConnectionState }) => void) => () => void;
  } | null;
  const [state, setState] = useState<ConnectionState | undefined>(() => adapter?.getConnectionState?.());
  useEffect(() => {
    if (!adapter?.onConnectionStateChange) return undefined;
    const unsubscribe = adapter.onConnectionStateChange((event) => setState(event.state));
    setState(adapter.getConnectionState?.());
    return unsubscribe;
  }, [adapter]);
  return state;
}

/** Inside the sidebar provider: the window's width decides the sidebar's start state, as in an app. */
function DocsPortalShellInner({ children }: { children: React.ReactNode }) {
  useResponsiveSidebar();
  return <>{children}</>;
}

function DesktopDocsPortalShell({ children, userId }: DocsPortalShellProps) {
  // Before `AppShell`'s sidebar provider reads its cookie, as `ConsoleLayout`
  // does: a narrow window's first frame is already collapsed.
  useState(primeConsoleSidebarOpen);
  const { setContext, currentAppName } = useNavigationContext();
  const { user } = useAuth();
  const expressionUser = useMemo(() => buildExpressionUser(user), [user]);
  const { apps } = useMetadata();
  const dataSource = useAdapter();
  const connectionState = useAdapterConnectionState(dataSource);
  const navigate = useNavigate();
  const { enabled: showChatbot } = useAiSurfaceEnabled();
  const chatDock = useConsoleChatDock({ enabled: showChatbot, userId: userId ?? user?.id });

  // Outside every app, as Home: the context names none, and the current app
  // is read below, never set.
  useEffect(() => {
    setContext('home');
  }, [setContext]);

  // The app the palette searches: Home's host app, read only. With none (no
  // openable app, or the list still loading) no palette is mounted and the
  // sidebar draws no search field that would open nothing.
  const activeApps = filterActiveApps(apps);
  const hostApp =
    activeApps.length > 0
      ? matchAppBySegment(activeApps, resolveHostAppSegment(activeApps, currentAppName))
      : undefined;
  const openApp = (segment: string) => navigate(`/apps/${segment}`);

  return (
    <ExpressionProvider user={expressionUser} app={NO_SCOPE_INPUT} data={NO_SCOPE_INPUT} features={NO_SCOPE_INPUT}>
      <ChatDockControlProvider value={chatDock.control}>
        <CommandPaletteProvider>
          <SidebarDocsNavSlotProvider>
            <AppShell
              sidebar={<UnifiedSidebar railOverlay docsPortal docsPortalSearch={!!hostApp} onAppChange={openApp} />}
              showHeader={false}
              navbar={null}
              className="!p-0 overflow-y-auto overflow-x-hidden bg-muted/5 lg:flex lg:flex-col"
              rightRail={chatDock.rail}
            >
              <DocsPortalShellInner>
                <ShellPageActionsScope sidebarExpand appless>
                  {/* The standing banners and the connection notice, at the top
                      of the content area and the content's width, as
                      `ConsoleLayout` draws them; the box keeps its height in
                      the inset's `lg` flex column. */}
                  <div data-testid="docs-portal-banners" className="shrink-0">
                    <ChromeBannerHost />
                    <ConnectionBanner state={connectionState} />
                  </div>
                  <div data-testid="docs-portal-shell" className="h-full lg:min-h-0">
                    <ShellSidebarExpandFallback />
                    {children}
                  </div>
                </ShellPageActionsScope>
              </DocsPortalShellInner>
              {chatDock.sheet}
            </AppShell>
            {hostApp ? (
              <HomeCommandPalette apps={apps ?? []} hostApp={hostApp} onAppChange={openApp} dataSource={dataSource} />
            ) : null}
          </SidebarDocsNavSlotProvider>
        </CommandPaletteProvider>
      </ChatDockControlProvider>
    </ExpressionProvider>
  );
}

/**
 * `/docs…`'s frame: the app-less shell from 768 px up, Home's docs frame on a
 * phone (see the module doc).
 */
export function DocsPortalShell({ children, userId }: DocsPortalShellProps) {
  const phone = usePhoneViewport();
  if (phone) {
    return (
      <HomeLayout userId={userId} variant="docs">
        {children}
      </HomeLayout>
    );
  }
  return <DesktopDocsPortalShell userId={userId}>{children}</DesktopDocsPortalShell>;
}
