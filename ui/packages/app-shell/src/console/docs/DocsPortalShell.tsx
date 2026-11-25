// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DESIGN MOCKUP (objectstack#37197, stage 1) — scratch branch only, never
 * merged. The docs portal (`/docs…`) in an app-less variant of the app shell:
 * from 768 px up the same `AppShell` and `UnifiedSidebar` chrome as an app's
 * docs pages (search, bell, account footer, collapse button, no top bar), with
 * a neutral 「Documentation」 head that opens the app switcher instead of an
 * app's menu, and the docs tree as the sidebar body (drawn by the page through
 * the docs-navigation slot). No app is guessed, and the current / last app is
 * not written: the navigation context stays `home`, as Home's frame sets it.
 * A phone keeps Home's frame with the docs bar, unchanged.
 *
 * @module
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppShell } from '@object-ui/layout';
import { cn } from '@object-ui/components';
import { useAuth } from '@object-ui/auth';
import { useNavigationContext } from '../../context/NavigationContext.js';
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider.js';
import { CommandPalette } from '../../chrome/CommandPalette.js';
import { useMetadata } from '../../providers/MetadataProvider.js';
import { useAdapter } from '../../providers/AdapterProvider.js';
import { filterActiveApps, matchAppBySegment, resolveHostAppSegment } from '../../utils/index.js';
import { ExpressionProvider } from '../../providers/ExpressionProvider.js';
import { buildExpressionUser } from '../../providers/expressionUser.js';
import { UnifiedSidebar } from '../../layout/UnifiedSidebar.js';
import { SidebarDocsNavSlotProvider } from '../../layout/sidebarDocsNavSlot.js';
import { ShellPageActionsScope, ShellSidebarExpandFallback } from '../../layout/ShellPageActions.js';
import { primeConsoleSidebarOpen } from '../../layout/consoleSidebarRail.js';
import { useResponsiveSidebar } from '../../hooks/useResponsiveSidebar.js';
import { usePhoneViewport } from '../../hooks/usePhoneViewport.js';
import { HomeLayout } from '../home/HomeLayout.js';

const NO_SCOPE_INPUT: Record<string, never> = {};

function Inner({ children }: { children: React.ReactNode }) {
  useResponsiveSidebar();
  return <>{children}</>;
}

function DesktopDocsPortalShell({ children }: { children: React.ReactNode }) {
  useState(primeConsoleSidebarOpen);
  const { setContext, currentAppName } = useNavigationContext();
  const { user } = useAuth();
  const expressionUser = useMemo(() => buildExpressionUser(user), [user]);
  const { apps } = useMetadata();
  const dataSource = useAdapter();
  const navigate = useNavigate();

  // Home's context: the shell is outside every app. Nothing names an app.
  useEffect(() => {
    setContext('home');
  }, [setContext]);

  // The palette's scope, read only (as Home reads it): never written back.
  const activeApps = filterActiveApps(apps);
  const hostApp =
    activeApps.length > 0
      ? matchAppBySegment(activeApps, resolveHostAppSegment(activeApps, currentAppName))
      : undefined;

  return (
    <ExpressionProvider user={expressionUser} app={NO_SCOPE_INPUT} data={NO_SCOPE_INPUT} features={NO_SCOPE_INPUT}>
      <CommandPaletteProvider>
        <SidebarDocsNavSlotProvider>
          <AppShell
            sidebar={<UnifiedSidebar railOverlay docsPortal onAppChange={(segment) => navigate(`/apps/${segment}`)} />}
            showHeader={false}
            navbar={null}
            className={cn('!p-0 overflow-y-auto overflow-x-hidden bg-muted/5 lg:flex lg:flex-col')}
          >
            <Inner>
              <ShellPageActionsScope sidebarExpand>
                <div data-testid="docs-portal-route" className="h-full lg:min-h-0">
                  <ShellSidebarExpandFallback />
                  {children}
                </div>
              </ShellPageActionsScope>
            </Inner>
          </AppShell>
          {hostApp ? (
            <CommandPalette
              apps={apps ?? []}
              activeApp={hostApp}
              objects={[]}
              onAppChange={(segment) => navigate(`/apps/${segment}`)}
              dataSource={dataSource}
            />
          ) : null}
        </SidebarDocsNavSlotProvider>
      </CommandPaletteProvider>
    </ExpressionProvider>
  );
}

/** MOCKUP — `/docs…`'s frame: the app-less shell from 768 px up, Home's docs frame on a phone. */
export function DocsPortalShell({ children }: { children: React.ReactNode }) {
  const phone = usePhoneViewport();
  if (phone) return <HomeLayout variant="docs">{children}</HomeLayout>;
  return <DesktopDocsPortalShell>{children}</DesktopDocsPortalShell>;
}
