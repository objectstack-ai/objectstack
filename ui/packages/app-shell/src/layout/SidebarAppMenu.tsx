// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * SidebarAppMenu — the app sidebar's first row from 768 px up
 * (objectstack#36112): the app's glyph and name, which open a menu that only
 * switches apps. The viewer's apps, the current one checked, with a search
 * field above them once there are more than {@link APP_MENU_SEARCH_FROM}; the
 * Setup app sits among them for the viewers the server serves it to; and, for
 * the viewers who may build, 「Add app」 at the foot (build with AI or in
 * Studio, start from a template, the marketplace).
 *
 * The list is `useLauncherApps`', the list Home's tiles and the phone's app
 * sheet draw, so every place offers the same apps. The phone keeps
 * `AppSwitcher`'s bottom sheet in its own top bar.
 * @module
 */

import * as React from 'react';
import { Link } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Input,
} from '@object-ui/components';
import { Check, ChevronDown, Hammer, LayoutGrid, Plus, Store } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { useWorkspaceAdminStatus } from '@object-ui/auth';
import { useMetadata } from '../providers/MetadataProvider.js';
import { matchAppBySegment } from '../utils/index.js';
import { appAddressSegment } from '../utils/appRoute.js';
import { useServedAppLabel } from '../hooks/useServedAppLabel.js';
import { useLauncherApps } from '../hooks/useLauncherApps.js';
import { useCanAuthorMetadata } from '../hooks/useCanAuthorMetadata.js';
import { useAiSurfaceEnabled } from '../hooks/useAiSurface.js';
import { isAiStudioEnabled, isMarketplaceEnabled } from '../runtime-config.js';
import { STUDIO_NEW_PACKAGE_PATH } from '../views/studio-design/studioNewPackage.js';
import { AppMark } from './AppMark.js';

/** The app count above which the menu draws a search field over the list. */
export const APP_MENU_SEARCH_FROM = 8;

/** The marketplace, where templates and packages are installed from. */
const MARKETPLACE_PATH = '/apps/setup/system/marketplace';

/** One 「Add app」 choice: where it goes, and how it is named. */
interface AddAppEntry {
  key: string;
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Whether this viewer is offered 「Add app」 at all, by the gates Home's
 * builder chips read: a workspace admin who may author metadata, on a
 * deployment that offers AI authoring or mounts a marketplace.
 */
function useMayAddApp(): boolean {
  const { isAdmin } = useWorkspaceAdminStatus();
  const canAuthor = useCanAuthorMetadata();
  return isAdmin && canAuthor && (isAiStudioEnabled() || isMarketplaceEnabled());
}

/**
 * The 「Add app」 choices: building with AI where the deployment offers AI
 * authoring and serves an agent, else a new package in Studio; templates and
 * the marketplace where a marketplace is mounted. Read only for a viewer
 * {@link useMayAddApp} lets in, so no one else pays the agent-catalog read.
 */
function useAddAppEntries(): AddAppEntry[] {
  const { t } = useObjectTranslation();
  const { enabled: aiEnabled } = useAiSurfaceEnabled();
  const entries: AddAppEntry[] = [];
  if (isAiStudioEnabled()) {
    entries.push(
      aiEnabled
        ? { key: 'build-with-ai', to: '/studio', label: t('home.buildWithAI', { defaultValue: 'Build with AI' }), icon: Hammer }
        : { key: 'new-in-studio', to: STUDIO_NEW_PACKAGE_PATH, label: t('home.build.inStudio', { defaultValue: 'New in Studio' }), icon: Hammer },
    );
  }
  if (isMarketplaceEnabled()) {
    entries.push(
      { key: 'template', to: MARKETPLACE_PATH, label: t('home.template.title', { defaultValue: 'Start with a template' }), icon: LayoutGrid },
      { key: 'marketplace', to: MARKETPLACE_PATH, label: t('layout.systemNav.appMarketplace', { defaultValue: 'App Marketplace' }), icon: Store },
    );
  }
  return entries;
}

/** The menu's foot: 「Add app」 and its choices. */
function AddAppSubmenu() {
  const { t } = useObjectTranslation();
  const entries = useAddAppEntries();
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger className="flex items-center gap-2.5 py-2" data-testid="sidebar-app-menu-add">
          <span className="flex size-[22px] shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
            <Plus className="size-4" />
          </span>
          <span className="flex-1 truncate">{t('layout.appSwitcher.addApp', { defaultValue: 'Add app' })}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-56">
          {entries.map((entry) => (
            <DropdownMenuItem key={entry.key} asChild className="flex items-center gap-2.5 py-2">
              <Link to={entry.to} data-testid={`sidebar-app-menu-add-${entry.key}`}>
                <entry.icon className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate">{entry.label}</span>
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

export interface SidebarAppMenuProps {
  activeAppName: string;
  /** Opens the app at this address segment (the host asks first about unsaved edits). */
  onAppChange: (segment: string) => void;
}

export function SidebarAppMenu({ activeAppName, onAppChange }: SidebarAppMenuProps) {
  const { t } = useObjectTranslation();
  const { appLabel } = useServedAppLabel();
  const { apps: metadataApps } = useMetadata();
  const apps = metadataApps || [];
  const { apps: launcherApps } = useLauncherApps(apps);
  const mayAddApp = useMayAddApp();
  const [query, setQuery] = React.useState('');

  // The route may name an app the launcher does not offer (a direct URL to an
  // app the viewer's permission sets hide): the row still names where they are.
  const activeApp =
    matchAppBySegment(launcherApps, activeAppName) ||
    matchAppBySegment(apps.filter((a: any) => a.active !== false), activeAppName);
  if (!activeApp) return null;
  const activeLabel = appLabel(activeApp);

  const searchable = launcherApps.length > APP_MENU_SEARCH_FROM;
  const needle = query.trim().toLocaleLowerCase();
  const listed = searchable && needle
    ? launcherApps.filter((app: any) => appLabel(app).toLocaleLowerCase().includes(needle))
    : launcherApps;

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setQuery(''); }}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="sidebar-app-menu-trigger"
          title={activeLabel}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left text-sm font-medium text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent"
        >
          <AppMark app={activeApp} size="sm" />
          <span className="min-w-0 truncate">{activeLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="w-64" data-testid="sidebar-app-menu">
        {searchable && (
          <div className="p-1" onKeyDown={(event) => event.stopPropagation()}>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('layout.appSwitcher.searchApps', { defaultValue: 'Search apps…' })}
              aria-label={t('layout.appSwitcher.searchApps', { defaultValue: 'Search apps…' })}
              data-testid="sidebar-app-menu-search"
              className="h-8"
              autoFocus
            />
          </div>
        )}
        <div className="max-h-[min(60vh,28rem)] overflow-y-auto">
          {listed.map((app: any) => {
            const isActive = app.name === activeApp.name;
            return (
              <DropdownMenuItem
                key={app.name}
                onSelect={() => {
                  if (!isActive) onAppChange(appAddressSegment(apps, app) ?? app.name);
                }}
                className="flex items-center gap-2.5 py-2"
                data-testid={`sidebar-app-menu-row-${app.name}`}
              >
                <AppMark app={app} size="sm" />
                <span className="flex-1 truncate">{appLabel(app)}</span>
                {isActive && <Check className="size-3.5 shrink-0 text-primary" aria-hidden />}
              </DropdownMenuItem>
            );
          })}
          {listed.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground" data-testid="sidebar-app-menu-empty">
              {t('layout.appSwitcher.noAppsMatch', { defaultValue: 'No apps match' })}
            </div>
          )}
        </div>
        {mayAddApp && <AddAppSubmenu />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
