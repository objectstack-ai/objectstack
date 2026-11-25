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
 * objectstack#36485 — and the door into the design mode (`designMode.tsx`,
 * objectstack#36362), under the list, in one group with 「Add app」, for the
 * viewers the page header's door was drawn for (the header draws none any
 * more). The sidebar's head is drawn from 768 px up only, docked or floated
 * over the content while the sidebar is collapsed, so a phone gets no way in,
 * as before.
 *
 * objectstack#36758 — the design mode edits the app's layout only (its menu,
 * header pins and page arrangement), so its door reads 「Design layout」, the
 * word its bar shows. 「Edit app」 beside it opens this app's package in
 * Studio: the app switcher's Studio row, on its target and posture
 * (`useAppStudioEntry`), so the two cannot disagree. An installed
 * (read-only) package's app reads 「View in Studio」 there, behind an eye.
 * Each row keeps its own gate.
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
import { BookOpen, Check, ChevronDown, Eye, Pencil, PencilRuler, Plus } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { useAuth } from '@object-ui/auth';
import { useMetadata } from '../providers/MetadataProvider.js';
import { matchAppBySegment } from '../utils/index.js';
import { appAddressSegment, appStudioDesignPath } from '../utils/appRoute.js';
import { useServedAppLabel } from '../hooks/useServedAppLabel.js';
import { useLauncherApps } from '../hooks/useLauncherApps.js';
import { useStudioEntryGate } from '../hooks/useStudioDesignGate.js';
import { useAddAppEntries, useMayAddApp } from '../hooks/useAddAppEntries.js';
import { AppMark } from './AppMark.js';
import { useDesignMode } from './designMode.js';
import { useAppStudioEntry } from './ShellPageActions.js';
import type { StudioEntry } from '../hooks/useStudioDesignGate.js';
import { postureHasOrgWall, useTenancyPosture } from '../hooks/useTenancyPosture.js';

/** The app count above which the menu draws a search field over the list. */
export const APP_MENU_SEARCH_FROM = 8;

/**
 * What 「Design layout」 does for this viewer, or `null` where it is not
 * drawn: it turns the shell's design mode on for the app on screen, in place.
 *
 * Drawn on the page header's button's condition, unchanged: a workspace admin
 * holding `manage_metadata`, on an app whose package Studio lists
 * (`useStudioEntryGate`, the gate `useAppStudioEntry` reads; it judges the
 * package the path names, so the app's own Studio path is read), so the
 * console's own apps get none. A read-only (installed) package's app gets it too
 * (objectstack#36363: its changes are saved as this environment's
 * customization), except where the customization door is walled off for this
 * caller. Not drawn where no shell holds the mode, nor while the mode is on.
 *
 * objectstack#36692 — while a dashboard's or a report's own editor is open
 * it stays drawn, and choosing it refuses, saying to save or cancel those
 * changes first: the mode's `enter` refuses while an editor holds it out
 * (`useHoldDesignModeOut`), so the screen never shows two Save/Cancel sets.
 */
function useEnterDesignMode(apps: Parameters<typeof matchAppBySegment>[0], activeAppName: string): (() => void) | null {
  const entry = useStudioEntryGate(appStudioDesignPath(matchAppBySegment(apps, activeAppName), true));
  const designMode = useDesignMode();
  const posture = useTenancyPosture();
  const { user } = useAuth();
  const customizable = !postureHasOrgWall(posture) || user?.isPlatformAdmin === true;
  if (!entry || !designMode || designMode.active) return null;
  if (entry.posture === 'view' && !customizable) return null;
  return designMode.enter;
}

/** 「Design layout」: the door into the design mode, named as its bar is. */
function DesignLayoutItem({ onEnter }: { onEnter: () => void }) {
  const { t } = useObjectTranslation();
  return (
    <DropdownMenuItem onSelect={onEnter} className="flex items-center gap-2.5 py-2" data-testid="sidebar-app-menu-design-layout">
      <span className="flex size-[22px] shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
        <PencilRuler className="size-4" />
      </span>
      <span className="flex-1 truncate">{t('topbar.designLayout', { defaultValue: 'Design layout' })}</span>
    </DropdownMenuItem>
  );
}

/**
 * 「Edit app」: this app's package in Studio, where the app is built. An
 * installed (read-only) package opens in Studio's browse-only posture, so its
 * row reads 「View in Studio」 behind an eye, never a pencil.
 */
function StudioAppItem({ entry }: { entry: StudioEntry }) {
  const { t } = useObjectTranslation();
  const view = entry.posture === 'view';
  return (
    <DropdownMenuItem asChild className="flex items-center gap-2.5 py-2">
      <Link to={entry.path} data-testid={view ? 'sidebar-app-menu-view-in-studio' : 'sidebar-app-menu-edit-app'}>
        <span className="flex size-[22px] shrink-0 items-center justify-center text-muted-foreground" aria-hidden>
          {view ? <Eye className="size-4" /> : <Pencil className="size-4" />}
        </span>
        <span className="flex-1 truncate">
          {view
            ? t('topbar.viewInStudio', { defaultValue: 'View in Studio' })
            : t('topbar.editApp', { defaultValue: 'Edit app' })}
        </span>
      </Link>
    </DropdownMenuItem>
  );
}

/** 「Add app」 and its choices. */
function AddAppSubmenu() {
  const { t } = useObjectTranslation();
  const entries = useAddAppEntries();
  return (
    <>
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
  const enterDesignMode = useEnterDesignMode(apps, activeAppName);
  const studioEntry = useAppStudioEntry(true, activeAppName).entry;
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
        {(enterDesignMode || studioEntry || mayAddApp) && <DropdownMenuSeparator />}
        {enterDesignMode && <DesignLayoutItem onEnter={enterDesignMode} />}
        {studioEntry && <StudioAppItem entry={studioEntry} />}
        {mayAddApp && <AddAppSubmenu />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * DESIGN MOCKUP (objectstack#37197, stage 1; scratch branch, never merged) —
 * the app-less docs shell's first row: a neutral 「Documentation」 head that
 * opens the same app list, with no app checked (no app is current on
 * `/docs`), and without the app-scoped rows (design layout, edit app).
 */
export function SidebarDocsPortalMenu({ onAppChange }: { onAppChange: (segment: string) => void }) {
  const { t } = useObjectTranslation();
  const { appLabel } = useServedAppLabel();
  const { apps: metadataApps } = useMetadata();
  const apps = metadataApps || [];
  const { apps: launcherApps } = useLauncherApps(apps);
  const mayAddApp = useMayAddApp();
  const label = t('help.documentation', { defaultValue: 'Documentation' });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid="sidebar-docs-portal-menu-trigger"
          title={label}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left text-sm font-medium text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-[state=open]:bg-sidebar-accent"
        >
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-foreground/80" aria-hidden>
            <BookOpen className="size-3.5" />
          </span>
          <span className="min-w-0 truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={4} className="w-64" data-testid="sidebar-docs-portal-menu">
        <div className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">
          {t('layout.appSwitcher.yourApps', { defaultValue: 'Your apps' })}
        </div>
        <div className="max-h-[min(60vh,28rem)] overflow-y-auto">
          {launcherApps.map((app: any) => (
            <DropdownMenuItem
              key={app.name}
              onSelect={() => onAppChange(appAddressSegment(apps, app) ?? app.name)}
              className="flex items-center gap-2.5 py-2"
            >
              <AppMark app={app} size="sm" />
              <span className="flex-1 truncate">{appLabel(app)}</span>
            </DropdownMenuItem>
          ))}
        </div>
        {mayAddApp && <DropdownMenuSeparator />}
        {mayAddApp && <AddAppSubmenu />}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
