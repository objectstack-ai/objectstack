// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ShellPageActions — the page's top-right button group (objectstack#36111,
 * phase 1 of the top-bar removal, objectstack#36107): from left to right the
 * comments slot, the AI assistant and help, at the same place on every in-app
 * page — a list, a record, a dashboard, a report, a custom page.
 *
 * The group carries nothing that edits the app (objectstack#36485): the
 * design mode is entered from the app-name menu's 「Edit app」
 * (`SidebarAppMenu`), for an app built here and an installed one alike, and
 * no 「Open {app} in Studio」 is drawn here.
 *
 * The SHELL decides whether it is drawn, not the page: `ConsoleLayout` mounts
 * `ShellPageActionsScope`, which hands the group to the headers through the
 * slot in `shellPageActionsSlot.ts` (a header imports the slot, never this
 * module and its metadata, Studio and AI reads), and each header draws it
 * where its top-right is — the console `PageHeader` after the page's own
 * actions (reports and every custom page draw that header too), the record
 * page's navigation row before its ✕.
 *
 * From 768 px up the app shell draws no top bar (objectstack#36112), so the
 * group is the page's only home for these buttons; the scope is on unless a
 * caller turns it off.
 *
 * The scope also hands the headers the sidebar's 「Expand」 button for their
 * left edge, drawn while the sidebar is collapsed; a route with none of those
 * headers gets the same button at the content's top-left corner
 * (`ShellSidebarExpandFallback`).
 *
 * Outside a scope (Home, the organization pages, Studio, the docs frame, a
 * test that mounts a page bare) the group is never drawn, and on a phone
 * neither: the phone has its own bar.
 *
 * The parts are the top bar's own: the AI button IS `AssistantTopBarButton`,
 * and the help menu IS `HelpMenu`.
 */

import * as React from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { cn, useSidebar } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useNavigationContext } from '../context/NavigationContext.js';
import { matchAppBySegment, appStudioRoutePath } from '../utils/index.js';
import { useStudioEntryGate, type StudioEntry } from '../hooks/useStudioDesignGate.js';
import { useAiSurfaceEnabled } from '../hooks/useAiSurface.js';
import {
  ShellPageActionsSlotContext,
  ShellSidebarExpandSlotContext,
  useShellPageActionsSlot,
  type ShellPageActionsSlotProps,
} from './shellPageActionsSlot.js';
import { LocalizedSidebarTrigger } from './LocalizedSidebarTrigger.js';
import { AssistantTopBarButton } from './AssistantTopBarButton.js';
import { HelpMenu } from './HelpMenu.js';

/**
 * Counts the headers under a scope that place the expand button, so the
 * fallback corner button is drawn only where no header does.
 */
interface ExpandHeaderRegistry {
  add: () => () => void;
  subscribe: (listener: () => void) => () => void;
  count: () => number;
}

function createExpandHeaderRegistry(): ExpandHeaderRegistry {
  let count = 0;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    add: () => {
      count += 1;
      emit();
      return () => {
        count -= 1;
        emit();
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    count: () => count,
  };
}

const ExpandHeaderRegistryContext = React.createContext<ExpandHeaderRegistry | null>(null);

/**
 * The shell's decision for the pages under it: the group, on unless `on` is
 * `false`; and, with `sidebarExpand` (only inside the sidebar provider), the
 * expand button for the headers' left edge. Both reach the headers through
 * the slots in `shellPageActionsSlot.ts`, so a header never imports them.
 */
export function ShellPageActionsScope({
  on = true,
  sidebarExpand = false,
  children,
}: {
  on?: boolean;
  sidebarExpand?: boolean;
  children: React.ReactNode;
}) {
  const [registry] = React.useState(createExpandHeaderRegistry);
  return (
    <ExpandHeaderRegistryContext.Provider value={sidebarExpand ? registry : null}>
      <ShellSidebarExpandSlotContext.Provider value={sidebarExpand ? renderShellSidebarExpand : null}>
        <ShellPageActionsSlotContext.Provider value={on ? renderShellPageActionsGroup : null}>
          {children}
        </ShellPageActionsSlotContext.Provider>
      </ShellSidebarExpandSlotContext.Provider>
    </ExpandHeaderRegistryContext.Provider>
  );
}

/** The expand slot's value: one stable function, never remade. */
function renderShellSidebarExpand(): React.ReactNode {
  return <ShellSidebarExpandButton />;
}

/** The trigger, named for what it does here: the sidebar is collapsed. */
function SidebarExpandTrigger({ className }: { className?: string }) {
  const { t } = useObjectTranslation();
  return (
    <LocalizedSidebarTrigger
      className={cn('shrink-0', className)}
      aria-label={t('sidebar.expand', { defaultValue: 'Expand sidebar' })}
      data-testid="shell-sidebar-expand"
    />
  );
}

/**
 * A header's expand button: drawn while the desktop sidebar is collapsed. A
 * header that places it counts as one for the fallback, drawn or not.
 */
function ShellSidebarExpandButton() {
  const registry = React.useContext(ExpandHeaderRegistryContext);
  React.useLayoutEffect(() => registry?.add(), [registry]);
  const { open, isMobile } = useSidebar();
  if (isMobile || open) return null;
  return <SidebarExpandTrigger />;
}

const noHeaders = () => 0;
const noSubscription = () => () => {};

/**
 * The expand button for a route whose page draws none of the shell's headers
 * (search results, a component page, the app editor): pinned at the content's
 * top-left corner while the sidebar is collapsed. It takes no room of its own.
 */
export function ShellSidebarExpandFallback() {
  const registry = React.useContext(ExpandHeaderRegistryContext);
  const headers = React.useSyncExternalStore(
    registry?.subscribe ?? noSubscription,
    registry?.count ?? noHeaders,
    noHeaders,
  );
  const { open, isMobile } = useSidebar();
  if (!registry || headers > 0 || isMobile || open) return null;
  return (
    <div className="sticky top-0 z-20 h-0" data-testid="shell-sidebar-expand-fallback">
      <SidebarExpandTrigger className="absolute left-2 top-2 bg-background/80 backdrop-blur" />
    </div>
  );
}

/** Whether the group is drawn here: inside a scope that turned it on, and not on a phone. */
export function useShellPageActionsOn(): boolean {
  return useShellPageActionsSlot() !== null;
}

/**
 * The app → Studio entry for the current route (ADR-0080): the app the route
 * is in, and the gate's answer for the Studio path the route opens — the
 * object, view or record route opens the package's Data tab, a dashboard,
 * page or report route its design surface (`appStudioRoutePath`). `null` when
 * this principal or this package gets no entry (`useStudioEntryGate`).
 *
 * The top bar's 「Edit app」 pencil reads it, and the app-name menu's
 * 「Edit app」 reads its gate (objectstack#36485), so the two cannot offer
 * the app to different people.
 */
export function useAppStudioEntry(enabled: boolean, activeAppName?: string): {
  currentApp: unknown;
  entry: StudioEntry | null;
} {
  const location = useLocation();
  const params = useParams();
  const metadata = useMetadata();
  const { currentAppName } = useNavigationContext();
  const pathParts = location.pathname.split('/').filter(Boolean);
  const appNameKey = activeAppName || currentAppName || params.appName || pathParts[1];
  // ADR-0048 (A) — the key may be a package id (route segment); match by it.
  const currentApp = matchAppBySegment(metadata.apps || [], appNameKey);
  const entry = useStudioEntryGate(
    enabled ? appStudioRoutePath(currentApp, true, { type: pathParts[2], name: pathParts[3] }) : null,
  );
  return { currentApp, entry };
}

export type ShellPageActionsProps = ShellPageActionsSlotProps;

/** The group, where the shell turned it on; nothing anywhere else. */
export function ShellPageActions({ comments }: ShellPageActionsProps) {
  const renderGroup = useShellPageActionsSlot();
  return renderGroup ? renderGroup({ comments }) : null;
}

/** The slot's value while the group is on: one stable function, never remade. */
function renderShellPageActionsGroup(props: ShellPageActionsSlotProps): React.ReactNode {
  return <ShellPageActionsGroup {...props} />;
}

function ShellPageActionsGroup({ comments }: ShellPageActionsProps) {
  // The app only: the group draws no Studio entry, so it reads no gate.
  const { currentApp } = useAppStudioEntry(false);
  const { enabled: aiEnabled } = useAiSurfaceEnabled();
  const appPackageId = (currentApp as { _packageId?: string } | undefined)?._packageId;
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-testid="shell-page-actions">
      {comments}
      {aiEnabled && <AssistantTopBarButton className="max-md:size-8" />}
      <HelpMenu inApp appPackageId={appPackageId} triggerClassName="h-8 w-8 shrink-0" triggerTestId="shell-page-actions-help" />
    </div>
  );
}
