// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35981 — the frame an app route boots in once the session is
 * confirmed, and the route slot's skeleton while its metadata loads.
 *
 * Between the session answer and the console chrome, an `/apps/:app/*` open
 * waits on four more gates in a row: the data adapter, the organization list,
 * `/auth/me/permissions` (seconds, server-side, on a hosted environment) and
 * `AppContent`'s readiness gate (the app list and the admin verdict,
 * objectui#5619). Each used to draw the full-screen splash. They now draw
 * {@link ConsoleBootShell}: the chrome's frame (the sidebar at the width the
 * reader left it, with its head and foot from 768 px up; the 48 px top bar on
 * a phone and on a docs page; the route slot) with grey blocks in it and
 * the skeleton of the route the URL names in the slot. The real chrome takes
 * its place when the gates pass, at the same geometry.
 *
 * ⭐ What the frame withholds is what the gates exist for. It draws no app
 * name, icon or colour (the app list decides which app this is, and a URL can
 * name one the session may not open), no navigation entry (the permission
 * answer and the admin verdict decide which exist), and it decides nothing: it
 * never navigates, so the redirects the gates own still happen from the same
 * inputs, once.
 *
 * THE MARKER. The frame carries `data-boot-splash`, the splash's
 * language-independent marker (`LoadingScreen`): it is still the boot wait.
 * Readiness waits and the reads deferred to the first paint past the splash
 * (objectui#12980: the chrome's feeds, the locale list) keep meaning what they
 * meant. `data-boot-shell` tells the frame from the splash.
 */

import { useState } from 'react';
import { useInRouterContext, useLocation } from 'react-router-dom';
import { useAuth } from '@object-ui/auth';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  Skeleton,
} from '@object-ui/components';
import { AppShell } from '@object-ui/layout';
import { LoadingScreen } from '../chrome/LoadingScreen.js';
import { CONSOLE_BELOW_TOP_BAR } from '../layout/consoleTopBar.js';
import { primeConsoleSidebarOpen } from '../layout/consoleSidebarRail.js';
import { isAppDocsPath, isRecordPagePath } from '../layout/consoleRoutePaths.js';
import { usePhoneViewport } from '../hooks/usePhoneViewport.js';
import { SkeletonDashboard, SkeletonDetail, SkeletonGrid } from '../skeletons/index.js';
import { metadataReadsForAppRoute } from './appRouteMetadataReads.js';

/** An app route: `/apps/:app` and everything under it. */
const APP_ROUTE = /^\/apps\/[^/]+(?:\/|$)/;

/**
 * The route slot while its metadata loads, shaped like what will land there
 * (objectui#12809). `boot` marks it as the boot wait (see the file header):
 * set while the first route of this page load has not drawn yet.
 */
export function RouteMetadataSkeleton({ reads, boot = false }: { reads: string; boot?: boolean }) {
  const types = reads.split(',');
  return (
    <div data-testid="route-metadata-skeleton" data-boot-splash={boot ? '' : undefined} className="h-full">
      {types[0] === 'dashboard' ? <SkeletonDashboard /> : types.includes('page') ? <SkeletonDetail /> : <SkeletonGrid />}
    </div>
  );
}

/** Widths of the sidebar's grey rows, fixed so two frames draw the same rows. */
const SIDEBAR_ROWS = ['w-[72%]', 'w-[58%]', 'w-[80%]', 'w-[64%]', 'w-[50%]', 'w-[68%]'];

/**
 * The console chrome's frame, empty: see the file header. Drawn on an app
 * route only, after the session answer.
 */
export function ConsoleBootShell() {
  // Before the sidebar provider reads its cookie, as `ConsoleLayout` does
  // (objectstack#28077): a narrow window's first frame is already the rail,
  // so the frame and the chrome draw the sidebar at the same width.
  useState(primeConsoleSidebarOpen);
  const { pathname } = useLocation();
  const appSubPath = pathname.split('/').filter(Boolean).slice(2).join('/');
  const reads = metadataReadsForAppRoute(appSubPath, []);
  // The shape the chrome will have on this route, from the same predicates
  // `ConsoleLayout` reads, so nothing the frame draws is removed when the
  // chrome lands. From 768 px up an app draws no top bar: the app menu, the
  // search and the bell sit in the sidebar's head and the account at its foot
  // (objectstack#36112). A phone keeps the bar, except on a record page,
  // which draws its own (objectstack#28483). A docs page mounts no sidebar
  // and keeps the bar at every width (objectstack#35424).
  const phone = usePhoneViewport();
  const docsPage = isAppDocsPath(pathname);
  const recordPageOwnsTopBar = phone && isRecordPagePath(pathname);
  const desktopSidebar = !phone && !docsPage;
  return (
    <div data-boot-splash="" data-boot-shell="" aria-busy="true" className="contents">
      <AppShell
        showHeader={(phone || docsPage) && !recordPageOwnsTopBar}
        navbar={
          <div className="flex w-full items-center gap-3">
            <Skeleton className="h-7 w-28 rounded-md" />
            <Skeleton className="ml-auto hidden h-8 w-64 rounded-md sm:block" />
            <Skeleton className="ml-auto size-8 rounded-full sm:ml-0" />
          </div>
        }
        sidebar={
          docsPage ? undefined : (
          <Sidebar collapsible="offcanvas" className={phone ? CONSOLE_BELOW_TOP_BAR : undefined}>
            {desktopSidebar && (
              // Where the app menu (and the collapse button), the search and
              // the bell will be: grey, since the app list decides the app.
              <SidebarHeader className="gap-1 p-2 pb-1" data-boot-sidebar-head="">
                <div className="flex h-8 items-center gap-2 px-1.5">
                  <Skeleton className="size-5 rounded-md" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="ml-auto size-7 rounded-md" />
                </div>
                <div className="flex items-center gap-1">
                  <Skeleton className="h-8 flex-1 rounded-md" />
                  <Skeleton className="size-8 rounded-md" />
                </div>
              </SidebarHeader>
            )}
            <SidebarContent className="pt-2">
              <SidebarGroup>
                <SidebarMenu>
                  {SIDEBAR_ROWS.map((width, i) => (
                    <div key={i} className="flex h-8 items-center gap-2 rounded-md px-2">
                      <Skeleton className="size-4 rounded-md" />
                      <Skeleton className={`h-4 ${width}`} />
                    </div>
                  ))}
                </SidebarMenu>
              </SidebarGroup>
            </SidebarContent>
            {desktopSidebar && (
              // Where the account menu will be.
              <SidebarFooter className="gap-1 border-t border-sidebar-border p-2" data-boot-sidebar-foot="">
                <div className="flex h-12 items-center gap-2 px-2">
                  <Skeleton className="size-8 rounded-lg" />
                  <Skeleton className="h-4 w-28" />
                </div>
              </SidebarFooter>
            )}
          </Sidebar>
          )
        }
        className="!p-0 overflow-y-auto overflow-x-hidden bg-muted/5 lg:flex lg:flex-col"
      >
        <div className="h-full lg:min-h-0">
          <RouteMetadataSkeleton reads={reads.join(',') || 'object'} />
        </div>
      </AppShell>
    </div>
  );
}

/**
 * The console's boot-gate fallback: {@link ConsoleBootShell} on an app route
 * once the session has answered with a user, the splash everywhere else (the
 * session read itself, `/home`, the auth surfaces, a host with no router).
 */
export function ConsoleBootFallback() {
  return useInRouterContext() ? <RoutedBootFallback /> : <LoadingScreen />;
}

function RoutedBootFallback() {
  const { pathname } = useLocation();
  const { isLoading, user } = useAuth();
  if (isLoading || !user || !APP_ROUTE.test(pathname)) return <LoadingScreen />;
  return <ConsoleBootShell />;
}
