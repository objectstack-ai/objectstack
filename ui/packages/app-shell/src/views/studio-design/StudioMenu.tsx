// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio's one navigation: the left menu of six domain groups (objectstack
 * ADR-0084, amended 2026-11-24; #36899). What it lists and where each entry
 * goes is `studioMenuModel.ts`; this file draws it.
 *
 * It is the app sidebar's primitive (`SidebarProvider` / `Sidebar` from
 * `@object-ui/components`), so it collapses the way the app's sidebar does and
 * becomes a drawer below 768 px. Its collapse state is kept under its own
 * cookie, {@link STUDIO_MENU_COOKIE}, never the app sidebar's: collapsing one
 * must not collapse the other. The surface mounts the provider
 * (`StudioMenuProvider`) around its header and body, so the header's
 * {@link StudioMenuTrigger} and the menu share one state.
 *
 * Every entry is a plain link: a page holding unsaved work is registered with
 * the shell's leave guard (`useRegisterUnsavedEdits`), whose capture-phase
 * link guard asks before any of them leaves.
 */

import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Database, Layers, PanelLeft, Settings, ShieldCheck, Sparkles, Workflow, type LucideIcon } from 'lucide-react';
import {
  cn,
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from '@object-ui/components';
import { useGlobalDiagnostics, useMetadataClient, useMetadataTypes } from '../metadata-admin/useMetadata.js';
import { scopeDirectoryEntries } from '../metadata-admin/directoryScope.js';
import { t, tFormat, translateMetadataDomain, translateMetadataType } from '../metadata-admin/i18n.js';
import { useMetadataRefreshNonce } from './useMetadataRefreshNonce.js';
import { STUDIO_HEADER_ICON_BUTTON } from './studio-tokens.js';
import {
  STUDIO_MENU_COOKIE,
  STUDIO_MENU_DESIGNER_TYPES,
  buildStudioMenu,
  studioMenuCurrentKey,
  studioMenuEntryMatches,
  studioMenuScope,
  type StudioMenuEntry,
  type StudioMenuGroup,
} from './studioMenuModel.js';

const GROUP_ICONS: Record<StudioMenuGroup, LucideIcon> = {
  data: Database,
  ui: Layers,
  automation: Workflow,
  system: Settings,
  security: ShieldCheck,
  ai: Sparkles,
};

const ENTRY_LABEL_KEYS: Record<Exclude<StudioMenuEntry['kind'], 'type'>, string> = {
  orgFlows: 'engine.studio.menu.orgFlows',
  owd: 'engine.studio.menu.owd',
  diagnostics: 'engine.studio.menu.diagnostics',
  environment: 'engine.studio.menu.environment',
};

/**
 * The provider the surface mounts around its header and body: the app
 * sidebar's, under Studio's own cookie. `className` lays out the frame it
 * draws (the provider renders the surface's outer box).
 */
export function StudioMenuProvider({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <SidebarProvider cookieName={STUDIO_MENU_COOKIE} className={className}>
      {children}
    </SidebarProvider>
  );
}

/** The header's show / hide control: the drawer's on a phone, the docked menu's otherwise. */
export function StudioMenuTrigger({ locale }: { locale: string }): React.ReactElement {
  const { open, openMobile, isMobile, toggleSidebar } = useSidebar();
  const shown = isMobile ? openMobile : open;
  const label = t(shown ? 'engine.studio.menu.collapse' : 'engine.studio.menu.expand', locale);
  return (
    <button
      type="button"
      data-testid="studio-menu-toggle"
      onClick={toggleSidebar}
      aria-expanded={shown}
      aria-label={label}
      title={label}
      className={cn(STUDIO_HEADER_ICON_BUTTON, shown && 'text-foreground')}
    >
      <PanelLeft className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

/**
 * The menu's served data: the registry's type entries, scoped by the
 * directory's rule, and each type's item count from the diagnostics sweep the
 * directory reads. Read again on the metadata-refresh pulse (a publish, a new
 * item), so the counts follow.
 */
function useStudioMenuTypes(packageId: string | null, environment: boolean) {
  const client = useMetadataClient();
  const { entries } = useMetadataTypes(client);
  const { countsByType, packagesByType, reload } = useGlobalDiagnostics(client, 'error', packageId ?? undefined);
  const refresh = useMetadataRefreshNonce();
  const reloadRef = React.useRef(reload);
  React.useLayoutEffect(() => {
    reloadRef.current = reload;
  });
  React.useEffect(() => {
    if (refresh > 0) reloadRef.current();
  }, [refresh]);
  const types = React.useMemo(
    () =>
      scopeDirectoryEntries(entries, {
        environment,
        packageId,
        packagesByType,
        always: STUDIO_MENU_DESIGNER_TYPES,
      }),
    [entries, environment, packageId, packagesByType],
  );
  return { types, counts: countsByType };
}

export interface StudioMenuProps {
  /** The `/studio/:segment` route segment: a package id, `~org` or `~all`. */
  segment: string;
  locale: string;
  /**
   * An entry re-enters the page already open on another query (the default
   * sharing overview, on the Access pillar). The host asks about unsaved work
   * and remounts that page; `false` keeps the author where they are.
   */
  onReenterPillar?: () => boolean;
}

export function StudioMenu({ segment, locale, onReenterPillar }: StudioMenuProps): React.ReactElement {
  const scope = studioMenuScope(segment);
  const packageId = scope.kind === 'package' ? scope.packageId : null;
  const { types, counts } = useStudioMenuTypes(packageId, scope.kind !== 'package');
  const { pathname, search } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const [query, setQuery] = React.useState('');
  const searchId = React.useId();

  const labels = new Map(types.map((e) => [e.type, translateMetadataType(e.type, locale, (e as { label?: string }).label)]));
  const labelOf = (entry: StudioMenuEntry) =>
    entry.kind === 'type' ? (labels.get(entry.type ?? '') ?? entry.type ?? '') : t(ENTRY_LABEL_KEYS[entry.kind], locale);

  const current = studioMenuCurrentKey({ segment, pathname, search });
  const groups = buildStudioMenu({ scope, types, counts })
    .map((g) => ({ ...g, entries: g.entries.filter((e) => studioMenuEntryMatches(e, labelOf(e), query)) }))
    .filter((g) => !query.trim() || g.entries.length > 0);

  return (
    <Sidebar
      collapsible="offcanvas"
      // Docked below the surface's header, inside the body row, rather than
      // fixed to the window's full height as the app sidebar is.
      className="!absolute !h-full"
    >
      <SidebarHeader className="border-b p-2">
        <label htmlFor={searchId} className="sr-only">
          {t('engine.studio.menu.search', locale)}
        </label>
        <SidebarInput
          id={searchId}
          type="search"
          data-testid="studio-menu-search"
          placeholder={t('engine.studio.menu.search', locale)}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </SidebarHeader>
      <SidebarContent>
        <nav aria-label={t('engine.studio.menu.label', locale)} data-testid="studio-menu">
          {groups.length === 0 && (
            <p role="status" className="px-4 py-3 text-xs text-muted-foreground" data-testid="studio-menu-no-matches">
              {t('engine.studio.menu.noMatches', locale)}
            </p>
          )}
          {groups.map(({ group, entries }) => {
            const Icon = GROUP_ICONS[group];
            const labelId = `${searchId}-${group}`;
            const typeCount = entries.filter((e) => e.kind === 'type').length;
            return (
              <SidebarGroup key={group} className="py-1" data-testid={`studio-menu-group-${group}`}>
                <SidebarGroupLabel id={labelId} className="gap-1.5">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="flex-1 truncate">{translateMetadataDomain(group, locale)}</span>
                  <span
                    className="tabular-nums text-[11px] font-normal text-muted-foreground"
                    title={tFormat('engine.studio.menu.typeCount', locale, { count: typeCount })}
                    data-testid={`studio-menu-group-count-${group}`}
                  >
                    {typeCount}
                  </span>
                </SidebarGroupLabel>
                <SidebarMenu aria-labelledby={labelId}>
                  {entries.map((entry) => {
                    const label = labelOf(entry);
                    const isCurrent = entry.key === current;
                    return (
                      <SidebarMenuItem key={entry.key}>
                        <SidebarMenuButton asChild isActive={isCurrent} size="sm">
                          <Link
                            to={entry.to}
                            aria-current={isCurrent ? 'page' : undefined}
                            data-testid={`studio-menu-entry-${entry.key}`}
                            onClick={(e) => {
                              if (e.defaultPrevented) return;
                              const [to, query = ''] = entry.to.split('?');
                              const reenters = to === pathname && `?${query}` !== search;
                              if (reenters && onReenterPillar && !onReenterPillar()) {
                                e.preventDefault();
                                return;
                              }
                              if (isMobile) setOpenMobile(false);
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                            {entry.count !== undefined && (
                              <span
                                className="tabular-nums text-[11px] text-muted-foreground"
                                title={tFormat('engine.studio.menu.itemCount', locale, { count: entry.count })}
                              >
                                {entry.count}
                              </span>
                            )}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroup>
            );
          })}
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}
