// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ShellPageActions — the page's top-right button group (objectstack#36111,
 * phase 1 of the top-bar removal, objectstack#36107): from left to right the
 * comments slot, 「Edit app」, the AI assistant and help, at the same place on
 * every in-app page — a list, a record, a dashboard, a report, a custom page.
 *
 * The SHELL decides whether it is drawn, not the page: `ConsoleLayout` mounts
 * `ShellPageActionsScope`, and each page's header draws `<ShellPageActions/>`
 * where its top-right is — the console `PageHeader` after the page's own
 * actions, the record page's navigation row before its ✕, a custom page's
 * authored `page:header` through the host slot `PageHeaderTrailingContext`.
 *
 * While the top bar still draws the same three buttons the group is OFF, so
 * nothing doubles: `SHELL_PAGE_ACTIONS_DEFAULT` is `false`, and the one way to
 * turn it on outside a test is the browser switch below. The card that removes
 * the top bar turns the default on and deletes the switch.
 *
 * Outside a scope (Home, the organization pages, Studio, the docs frame, a
 * test that mounts a page bare) the group is never drawn, and on a phone
 * neither: the phone has its own bar.
 *
 * The parts are the top bar's own: 「Edit app」 reads the same gate and opens
 * the same target as the top bar's pencil (`useAppStudioEntry`), the AI button
 * IS `AssistantTopBarButton`, and the help menu IS `HelpMenu`.
 */

import * as React from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { Blocks, Eye } from 'lucide-react';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useNavigationContext } from '../context/NavigationContext.js';
import { matchAppBySegment, appStudioRoutePath } from '../utils/index.js';
import { useStudioEntryGate, type StudioEntry } from '../hooks/useStudioDesignGate.js';
import { useServedAppLabel } from '../hooks/useServedAppLabel.js';
import { useAiSurfaceEnabled } from '../hooks/useAiSurface.js';
import { usePhoneViewport } from '../hooks/usePhoneViewport.js';
import { AssistantTopBarButton } from './AssistantTopBarButton.js';
import { HelpMenu } from './HelpMenu.js';

/** Whether the group is drawn while the top bar still stands: off. */
export const SHELL_PAGE_ACTIONS_DEFAULT = false;

/**
 * The browser switch that turns the group on before the top bar goes:
 * `localStorage['os:shell:page-actions'] = 'on'`. For checking the group in a
 * running console; every access is guarded, so a blocked storage reads off.
 */
export const SHELL_PAGE_ACTIONS_SWITCH_KEY = 'os:shell:page-actions';

/** The shell's answer: the default, unless the browser switch says `on`. */
export function readShellPageActionsSwitch(): boolean {
  try {
    if (typeof window === 'undefined') return SHELL_PAGE_ACTIONS_DEFAULT;
    return window.localStorage?.getItem(SHELL_PAGE_ACTIONS_SWITCH_KEY) === 'on' || SHELL_PAGE_ACTIONS_DEFAULT;
  } catch {
    return SHELL_PAGE_ACTIONS_DEFAULT;
  }
}

const ShellPageActionsContext = React.createContext<boolean>(false);

/** The shell's decision for the pages under it. `on` absent: the switch's answer. */
export function ShellPageActionsScope({ on, children }: { on?: boolean; children: React.ReactNode }) {
  const [switched] = React.useState(readShellPageActionsSwitch);
  return <ShellPageActionsContext.Provider value={on ?? switched}>{children}</ShellPageActionsContext.Provider>;
}

/** Whether the group is drawn here: inside a scope that turned it on, and not on a phone. */
export function useShellPageActionsOn(): boolean {
  const on = React.useContext(ShellPageActionsContext);
  const phone = usePhoneViewport();
  return on && !phone;
}

/**
 * The app → Studio entry for the current route (ADR-0080): the app the route
 * is in, and the gate's answer for the Studio path the route opens — the
 * object, view or record route opens the package's Data tab, a dashboard,
 * page or report route its design surface (`appStudioRoutePath`). `null` when
 * this principal or this package gets no entry (`useStudioEntryGate`).
 *
 * The top bar's 「Edit app」 pencil and the group's 「Edit app」 both read it,
 * so the two cannot open different places.
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

/**
 * 「Edit app」 in the group: its words beside an icon that is not the pencil
 * (the record's 「Edit」 carries the pencil), the words dropped below `lg` with
 * the tooltip keeping them. A read-only package's app gets the top bar's eye
 * and 「Open {app} in Studio」 (ADR-0146 D5) at the same place.
 */
function EditAppButton({ entry, appText }: { entry: StudioEntry; appText: string }) {
  const { t } = useObjectTranslation();
  if (entry.posture === 'view') {
    const viewText = t('topbar.openAppInStudio', { defaultValue: 'Open {{app}} in Studio', app: appText });
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 shrink-0 gap-1.5 px-2 max-w-[14rem]"
        asChild
        data-testid="shell-page-actions-view-app"
        title={viewText}
      >
        <Link to={entry.path} aria-label={viewText}>
          <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="hidden lg:inline truncate text-xs font-medium">{viewText}</span>
        </Link>
      </Button>
    );
  }
  const label = t('topbar.editApp', { defaultValue: 'Edit app' });
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-8 shrink-0 gap-1.5 px-2"
      asChild
      data-testid="shell-page-actions-edit-app"
      title={label}
    >
      <Link to={entry.path} aria-label={label}>
        <Blocks className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="hidden lg:inline text-xs font-medium">{label}</span>
      </Link>
    </Button>
  );
}

export interface ShellPageActionsProps {
  /**
   * The comments entry, first in the group: handed by the list and record
   * pages only, nothing until the comments work puts its icon here.
   */
  comments?: React.ReactNode;
}

/** The group, where the shell turned it on; nothing anywhere else. */
export function ShellPageActions({ comments }: ShellPageActionsProps) {
  const on = useShellPageActionsOn();
  if (!on) return null;
  return <ShellPageActionsGroup comments={comments} />;
}

function ShellPageActionsGroup({ comments }: ShellPageActionsProps) {
  const { entry, currentApp } = useAppStudioEntry(true);
  const { appLabel } = useServedAppLabel();
  const { enabled: aiEnabled } = useAiSurfaceEnabled();
  const appPackageId = (currentApp as { _packageId?: string } | undefined)?._packageId;
  return (
    <div className="flex shrink-0 items-center gap-0.5" data-testid="shell-page-actions">
      {comments}
      {entry && <EditAppButton entry={entry} appText={currentApp ? appLabel(currentApp as any) : ''} />}
      {aiEnabled && <AssistantTopBarButton className="max-md:size-8" />}
      <HelpMenu inApp appPackageId={appPackageId} triggerClassName="h-8 w-8 shrink-0" triggerTestId="shell-page-actions-help" />
    </div>
  );
}
