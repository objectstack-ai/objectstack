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
 *
 * ## Two tiers on a package (ADR-0084, amended 2026-11-25; objectstack#37201)
 *
 * A group's label is a small muted heading: no count, not a link, not
 * focusable. Only entries look clickable, and an entry's muted number means
 * one thing, its items. The 常用 Common groups come first; below a divider,
 * one 「高级」 button folds every 高级 Advanced entry under the same labels.
 *  - The fold is closed by default and remembered per browser under its own
 *    cookie, {@link STUDIO_MENU_ADVANCED_COOKIE}; only a click writes it.
 *  - It opens itself while the open page is one of its entries (a bookmark to
 *    the hook list), without writing the cookie.
 *  - A search ignores it: the matches of both tiers are listed flat.
 *  - `~org` and `~all` draw no fold: their entries are listed flat.
 */

import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight, PanelLeft } from 'lucide-react';
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
  SidebarSeparator,
  useSidebar,
} from '@object-ui/components';
import {
  STUDIO_MENU_ENTRY_LABEL_KEYS,
  STUDIO_MENU_GROUP_ICONS,
  StudioMenuDataContext,
  useStudioMenuData,
  useStudioMenuTypes,
  type StudioMenuData,
} from './studioMenuData.js';
import { t, tFormat, translateMetadataType } from '../metadata-admin/i18n.js';
import { studioMenuGroupLabel } from './studioMenuGroupLabel.js';
import { STUDIO_HEADER_ICON_BUTTON } from './studio-tokens.js';
import {
  STUDIO_MENU_ADVANCED_COOKIE,
  STUDIO_MENU_COOKIE,
  buildStudioMenu,
  readStudioMenuAdvancedCookie,
  studioMenuCurrentKey,
  studioMenuEntryMatches,
  studioMenuScope,
  studioMenuTiers,
  type StudioMenuEntry,
  type StudioMenuGroupModel,
  type StudioMenuTier,
} from './studioMenuModel.js';

/** The fold's cookie lives as long as the menu's own collapse cookie (the sidebar primitive's 7 days). */
const ADVANCED_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;

function readAdvancedCookie(): boolean {
  return typeof document === 'undefined' ? false : readStudioMenuAdvancedCookie(document.cookie);
}

function writeAdvancedCookie(open: boolean): void {
  document.cookie = `${STUDIO_MENU_ADVANCED_COOKIE}=${open}; path=/; max-age=${ADVANCED_COOKIE_MAX_AGE}`;
}


/**
 * objectui#12795 — every `SidebarGroupLabel` call site hides its label from
 * focus and the accessibility tree in the icon sidebar (the primitive's own
 * `opacity-0` leaves it reachable). This menu is `offcanvas`, never `icon`, so
 * the classes never apply here; it carries them as every call site does.
 */
const HIDDEN_ICON_LABEL_NOT_FOCUSABLE =
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:invisible ' +
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:transition-[margin,opacity,visibility]';


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

/** Reads the menu's data for `segment` once and hands it to the menu and the palette below. */
export function StudioMenuDataProvider({
  segment,
  children,
}: {
  segment: string;
  children: React.ReactNode;
}): React.ReactElement {
  const data = useStudioMenuTypes(segment);
  return <StudioMenuDataContext.Provider value={data}>{children}</StudioMenuDataContext.Provider>;
}

export interface StudioMenuProps {
  /** The `/studio/:segment` route segment: a package id, `~org` or `~all`. */
  segment: string;
  locale: string;
  /**
   * An entry re-enters the page already open on another query (the default
   * sharing overview, on the Access pillar). The host asks about unsaved work
   * and remounts that page once the router shows `search` (the entry's query,
   * `?` included); `false` keeps the author where they are.
   */
  onReenterPillar?: (search: string) => boolean;
}

/**
 * The menu. Under a {@link StudioMenuDataProvider} for the same segment it
 * draws the provider's data; on its own it reads its data itself.
 */
export function StudioMenu(props: StudioMenuProps): React.ReactElement {
  const shared = useStudioMenuData();
  return shared && shared.segment === props.segment ? (
    <StudioMenuBody {...props} data={shared} />
  ) : (
    <StudioMenuOwnRead {...props} />
  );
}

function StudioMenuOwnRead(props: StudioMenuProps): React.ReactElement {
  const data = useStudioMenuTypes(props.segment);
  return <StudioMenuBody {...props} data={data} />;
}

function StudioMenuBody({
  segment,
  locale,
  onReenterPillar,
  data,
}: StudioMenuProps & { data: StudioMenuData }): React.ReactElement {
  const scope = studioMenuScope(segment);
  const { types, counts } = data;
  const { pathname, search } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const [query, setQuery] = React.useState('');
  const searchId = React.useId();
  const advancedId = `${searchId}-advanced`;

  const labels = new Map(types.map((e) => [e.type, translateMetadataType(e.type, locale, (e as { label?: string }).label)]));
  const labelOf = (entry: StudioMenuEntry) =>
    entry.kind === 'type' ? (labels.get(entry.type ?? '') ?? entry.type ?? '') : t(STUDIO_MENU_ENTRY_LABEL_KEYS[entry.kind], locale);

  const current = studioMenuCurrentKey({ segment, pathname, search });
  const menu = buildStudioMenu({ scope, types, counts, settled: data.countsAnswered });
  const searching = query.trim().length > 0;
  const matching = menu
    .map((g) => ({ ...g, entries: g.entries.filter((e) => studioMenuEntryMatches(e, labelOf(e), query)) }))
    .filter((g) => g.entries.length > 0);
  // The fold is a package's: a search, `~org` and `~all` list their entries flat.
  const folded = scope.kind === 'package' && !searching;
  const tiers = studioMenuTiers(menu);

  // The fold: the browser's remembered state, opened besides while the open
  // page is one of its entries — until the author closes it on that page.
  const [remembered, setRemembered] = React.useState(readAdvancedCookie);
  const [closedOn, setClosedOn] = React.useState<string | null>(null);
  const currentIsAdvanced = tiers.advanced.some((g) => g.entries.some((e) => e.key === current));
  const advancedOpen = remembered || (currentIsAdvanced && closedOn !== current);
  const toggleAdvanced = () => {
    const next = !advancedOpen;
    setRemembered(next);
    setClosedOn(next ? null : current);
    writeAdvancedCookie(next);
  };

  const renderEntry = (entry: StudioMenuEntry) => {
    const label = labelOf(entry);
    const isCurrent = entry.key === current;
    return (
      <SidebarMenuItem key={entry.key}>
        <SidebarMenuButton asChild isActive={isCurrent} size="sm">
          <Link
            to={entry.to}
            aria-current={isCurrent ? 'page' : undefined}
            data-testid={`studio-menu-entry-${entry.key}`}
            data-empty={entry.empty ? 'true' : undefined}
            title={entry.empty ? t('engine.studio.menu.emptyType', locale) : undefined}
            onClick={(e) => {
              if (e.defaultPrevented) return;
              const [to, query = ''] = entry.to.split('?');
              const reenters = to === pathname && `?${query}` !== search;
              if (reenters && onReenterPillar && !onReenterPillar(query ? `?${query}` : '')) {
                e.preventDefault();
                return;
              }
              if (isMobile) setOpenMobile(false);
            }}
          >
            <span className={cn('min-w-0 flex-1 truncate', entry.empty && !isCurrent && 'text-muted-foreground')}>{label}</span>
            {entry.count !== undefined && !entry.empty && (
              <span
                className="tabular-nums text-[11px] text-muted-foreground"
                title={tFormat('engine.studio.menu.itemCount', locale, { count: entry.count })}
                data-testid={`studio-menu-count-${entry.key}`}
              >
                {entry.count}
              </span>
            )}
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  const renderGroups = (groups: readonly StudioMenuGroupModel[], tier: StudioMenuTier | 'flat') =>
    groups.map(({ group, entries }) => {
      const Icon = STUDIO_MENU_GROUP_ICONS[group];
      const labelId = `${searchId}-${tier}-${group}`;
      return (
        <SidebarGroup
          key={group}
          className="py-1"
          data-testid={tier === 'advanced' ? `studio-menu-advanced-group-${group}` : `studio-menu-group-${group}`}
        >
          <SidebarGroupLabel
            id={labelId}
            className={cn('h-6 gap-1.5 text-[11px] font-normal text-muted-foreground', HIDDEN_ICON_LABEL_NOT_FOCUSABLE)}
          >
            <Icon className="!h-3 !w-3 opacity-60" aria-hidden="true" />
            <span className="flex-1 truncate">{studioMenuGroupLabel(group, locale)}</span>
          </SidebarGroupLabel>
          <SidebarMenu aria-labelledby={labelId}>{entries.map(renderEntry)}</SidebarMenu>
        </SidebarGroup>
      );
    });

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
          {matching.length === 0 && (
            <p role="status" className="px-4 py-3 text-xs text-muted-foreground" data-testid="studio-menu-no-matches">
              {t('engine.studio.menu.noMatches', locale)}
            </p>
          )}
          {!folded && renderGroups(matching, 'flat')}
          {folded && renderGroups(tiers.common, 'common')}
          {folded && tiers.advanced.length > 0 && (
            <>
              <SidebarSeparator className="my-1" />
              <div className="px-2 py-1">
                <button
                  type="button"
                  data-testid="studio-menu-advanced-toggle"
                  aria-expanded={advancedOpen}
                  aria-controls={advancedId}
                  onClick={toggleAdvanced}
                  className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium text-sidebar-foreground/80 outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2"
                >
                  <ChevronRight
                    className={cn('h-3.5 w-3.5 shrink-0 transition-transform', advancedOpen && 'rotate-90')}
                    aria-hidden="true"
                  />
                  <span className="flex-1 truncate">{t('engine.studio.menu.advanced', locale)}</span>
                </button>
              </div>
              <div id={advancedId} data-testid="studio-menu-advanced" hidden={!advancedOpen} className="pl-2">
                {renderGroups(tiers.advanced, 'advanced')}
              </div>
            </>
          )}
        </nav>
      </SidebarContent>
    </Sidebar>
  );
}
