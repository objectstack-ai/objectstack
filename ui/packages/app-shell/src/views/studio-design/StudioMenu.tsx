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
 * ## Drawn as the app's menu (objectstack#37452)
 *
 * A group is the app menu's collapsible group (`NavigationGroupSection` from
 * `@object-ui/layout`): its label is a disclosure button with a chevron, open
 * by default and while a search lists matches, and it carries no count. An
 * entry is the app menu's row: a line icon with no tile, its name, and its
 * muted item count; the open page's entry is the app menu's inset pill with a
 * bar on its left edge. Studio's own accent, graphite ({@link STUDIO_ACCENT}),
 * tints the pill and the bar, never the app's theme colour.
 *
 * ## Two tiers on a package (ADR-0084, amended 2026-11-25; objectstack#37201)
 *
 * An entry's muted number means one thing, its items. The 常用 Common groups
 * come first; below a divider, one 「高级」 button folds every 高级 Advanced
 * entry under the same labels.
 *  - The fold is closed by default and remembered per browser under its own
 *    cookie, {@link STUDIO_MENU_ADVANCED_COOKIE}; only a click writes it.
 *  - It opens itself while the open page is one of its entries (a bookmark to
 *    the hook list), without writing the cookie.
 *  - A search ignores it: the matches of both tiers are listed flat.
 *  - `~org` and `~all` draw no fold: their entries are listed flat.
 *
 * The fold's last row, below its groups and under no group's label, is
 * 全部类型 All types (ADR-0084, amended 2026-11-25; objectstack#37360): it
 * opens the area's type directory, where every type of the six groups is
 * listed, the ones the package holds none of yet included. A search lists it
 * last, after the matching groups.
 *
 * ## 概览 Overview (ADR-0084, amended 2026-11-26; objectstack#37454)
 *
 * On a package the first row, above the groups and under no group's label,
 * is 概览 Overview, the package's own page. While drafts wait for a publish it
 * carries their count as a badge (the surface's pending ledger,
 * `StudioPendingDraftsContext`), and one click on the badge opens the
 * overview's Pending tab. A search lists it first when its name matches.
 */

import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Activity,
  AppWindow,
  BarChart3,
  BookOpen,
  Bot,
  Boxes,
  Brain,
  Building2,
  CalendarClock,
  ChevronRight,
  Database,
  File,
  FileText,
  Gauge,
  Globe,
  Inbox,
  Languages,
  LayoutGrid,
  ListChecks,
  ListTree,
  Mail,
  MousePointerClick,
  Package,
  PanelLeft,
  Puzzle,
  Rows3,
  Share2,
  Shield,
  Sparkles,
  Sprout,
  Table2,
  Unplug,
  UserCog,
  Users,
  Webhook,
  Workflow,
  Wrench,
  ArrowLeftRight,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import {
  cn,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from '@object-ui/components';
import { NavigationGroupSection } from '@object-ui/layout';
import {
  STUDIO_MENU_ENTRY_LABEL_KEYS,
  STUDIO_MENU_GROUP_ICONS,
  STUDIO_MENU_OVERVIEW_LABEL_KEY,
  STUDIO_MENU_OVERVIEW_PENDING_KEY,
  STUDIO_MENU_OVERVIEW_PENDING_ONE_KEY,
  StudioMenuDataContext,
  useStudioMenuData,
  useStudioMenuTypes,
  type StudioMenuData,
} from './studioMenuData.js';
import { t, tFormat, translateMetadataType } from '../metadata-admin/i18n.js';
import { studioMenuGroupLabel } from './studioMenuGroupLabel.js';
import { StudioPendingDraftsContext } from './studioItemDraftStatus.js';
import { useStudioEntryPermissions } from './studioEntryPermissions.js';
import { holdsSetupAccess } from '../setup/accessDirectory.js';
import { STUDIO_ACCENT, STUDIO_HEADER_ICON_BUTTON } from './studio-tokens.js';
import {
  STUDIO_MENU_ADVANCED_COOKIE,
  STUDIO_MENU_COOKIE,
  buildStudioMenu,
  readStudioMenuAdvancedCookie,
  studioMenuAllTypesEntry,
  studioMenuCurrentKey,
  studioMenuEntryMatches,
  studioMenuOverviewEntry,
  studioMenuOverviewMatches,
  studioMenuScope,
  studioMenuTiers,
  type StudioMenuEntry,
  type StudioMenuGroup,
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
 * Each listed type's line icon, drawn bare (no tile) before its name, as the
 * app menu draws an entry's. A type with no row here draws its group's icon.
 */
const STUDIO_MENU_TYPE_ICONS: Readonly<Record<string, LucideIcon>> = {
  object: Table2,
  app: LayoutGrid,
  page: File,
  dashboard: Gauge,
  report: BarChart3,
  flow: Workflow,
  permission: Shield,
  agent: Bot,
  tool: Wrench,
  skill: Sparkles,
  picklist: ListChecks,
  hook: Webhook,
  mapping: ArrowLeftRight,
  object_extension: Puzzle,
  seed: Sprout,
  view: Rows3,
  action: MousePointerClick,
  dataset: Boxes,
  job: CalendarClock,
  doc: FileText,
  book: BookOpen,
  email_template: Mail,
  translation: Languages,
  api: Globe,
  datasource: Database,
  external_catalog: Unplug,
  position: Users,
  assignment_rule: UserCog,
  sharing_rule: Share2,
  queue: Inbox,
  capability: ListTree,
  ai_context: Brain,
};

/** The icon of each entry that is not a type: the page it opens. */
const STUDIO_MENU_KIND_ICONS: Readonly<Record<Exclude<StudioMenuEntry['kind'], 'type'>, LucideIcon>> = {
  orgFlows: Building2,
  owd: ShieldCheck,
  diagnostics: Activity,
  allTypes: AppWindow,
};

function studioMenuEntryIcon(entry: StudioMenuEntry, group: StudioMenuGroup | null): LucideIcon {
  if (entry.kind !== 'type') return STUDIO_MENU_KIND_ICONS[entry.kind];
  return STUDIO_MENU_TYPE_ICONS[entry.type ?? ''] ?? (group ? STUDIO_MENU_GROUP_ICONS[group] : LayoutGrid);
}

/**
 * One group of the menu: the app menu's collapsible group, open until the
 * author closes it. While a search lists matches the group is drawn open,
 * chevron included, and a click on its label changes nothing: the author's
 * own choice comes back when the search is cleared. In the phone drawer its
 * label is the app menu's 44 px tap target.
 */
function ignoreOpenChange(): void {}

function StudioMenuGroupSection({
  label,
  labelId,
  searching,
  isMobile,
  testId,
  children,
}: {
  label: string;
  labelId: string;
  searching: boolean;
  isMobile: boolean;
  testId: string;
  children: React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = React.useState(true);
  return (
    <NavigationGroupSection
      label={label}
      labelId={labelId}
      open={open || searching}
      onOpenChange={searching ? ignoreOpenChange : setOpen}
      isMobile={isMobile}
      data-testid={testId}
    >
      {children}
    </NavigationGroupSection>
  );
}


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
  // objectstack#37565 — the catalog's lists open on Setup's page only for whoever may open Setup.
  const setupDirectory = holdsSetupAccess(useStudioEntryPermissions());
  const menu = buildStudioMenu({ scope, types, counts, settled: data.countsAnswered, setupDirectory });
  const searching = query.trim().length > 0;
  const matching = menu
    .map((g) => ({ ...g, entries: g.entries.filter((e) => studioMenuEntryMatches(e, labelOf(e), query)) }))
    .filter((g) => g.entries.length > 0);
  // objectstack#37360 — 全部类型 All types: a package's, under no group.
  const allTypes = studioMenuAllTypesEntry(scope);
  const allTypesMatches = !!allTypes && studioMenuEntryMatches(allTypes, labelOf(allTypes), query);
  // objectstack#37454 — 概览 Overview, a package's first row, with the pending count as its badge.
  const pendingDrafts = React.useContext(StudioPendingDraftsContext);
  const overview = studioMenuOverviewEntry(scope, pendingDrafts?.count ?? null);
  const overviewLabel = t(STUDIO_MENU_OVERVIEW_LABEL_KEY, locale);
  const overviewMatches = !!overview && studioMenuOverviewMatches(overviewLabel, query);
  // The fold is a package's: a search, `~org` and `~all` list their entries flat.
  const folded = scope.kind === 'package' && !searching;
  const tiers = studioMenuTiers(menu);

  // The fold: the browser's remembered state, opened besides while the open
  // page is one of its entries — until the author closes it on that page.
  const [remembered, setRemembered] = React.useState(readAdvancedCookie);
  const [closedOn, setClosedOn] = React.useState<string | null>(null);
  const currentIsAdvanced =
    tiers.advanced.some((g) => g.entries.some((e) => e.key === current)) || (!!allTypes && allTypes.key === current);
  const advancedOpen = remembered || (currentIsAdvanced && closedOn !== current);
  const toggleAdvanced = () => {
    const next = !advancedOpen;
    setRemembered(next);
    setClosedOn(next ? null : current);
    writeAdvancedCookie(next);
  };

  const renderEntry = (entry: StudioMenuEntry, group: StudioMenuGroup | null) => {
    const label = labelOf(entry);
    const isCurrent = entry.key === current;
    const Icon = studioMenuEntryIcon(entry, group);
    return (
      <SidebarMenuItem key={entry.key}>
        <SidebarMenuButton asChild isActive={isCurrent}>
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
            <Icon aria-hidden="true" data-testid={`studio-menu-icon-${entry.key}`} />
            <span className={cn('min-w-0 flex-1 truncate', entry.empty && !isCurrent && 'text-muted-foreground')}>{label}</span>
            {entry.count !== undefined && !entry.empty && (
              <span
                className={cn('tabular-nums text-xs', !isCurrent && 'text-muted-foreground')}
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
    groups.map(({ group, entries }) => (
      <StudioMenuGroupSection
        key={group}
        label={studioMenuGroupLabel(group, locale)}
        labelId={`${searchId}-${tier}-${group}`}
        searching={searching}
        isMobile={isMobile}
        testId={tier === 'advanced' ? `studio-menu-advanced-group-${group}` : `studio-menu-group-${group}`}
      >
        {entries.map((entry) => renderEntry(entry, group))}
      </StudioMenuGroupSection>
    ));

  // objectstack#37454 — the menu's first row, under no group. The badge is a
  // link of its own beside the row's (a link holds no link), to the Pending tab.
  const renderOverview = () => {
    if (!overview) return null;
    const isCurrent = current === overview.key;
    const pendingLabel = (count: number) =>
      tFormat(count === 1 ? STUDIO_MENU_OVERVIEW_PENDING_ONE_KEY : STUDIO_MENU_OVERVIEW_PENDING_KEY, locale, { count });
    const closeDrawer = () => {
      if (isMobile) setOpenMobile(false);
    };
    return (
      <div className="px-2 pb-1 pt-2" data-testid="studio-menu-overview">
        <SidebarMenu aria-label={overviewLabel}>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={isCurrent}>
              <Link
                to={overview.to}
                aria-current={isCurrent ? 'page' : undefined}
                data-testid="studio-menu-entry-overview"
                onClick={(e) => {
                  if (!e.defaultPrevented) closeDrawer();
                }}
              >
                <Package aria-hidden="true" data-testid="studio-menu-icon-overview" />
                <span className={cn('min-w-0 flex-1 truncate', overview.pending !== undefined && 'pr-7')}>{overviewLabel}</span>
              </Link>
            </SidebarMenuButton>
            {overview.pending !== undefined && (
              <Link
                to={overview.pendingTo}
                data-testid="studio-menu-overview-pending"
                aria-label={pendingLabel(overview.pending)}
                title={pendingLabel(overview.pending)}
                onClick={(e) => {
                  if (!e.defaultPrevented) closeDrawer();
                }}
                className="absolute right-2 top-1/2 inline-flex h-[18px] min-w-[18px] -translate-y-1/2 items-center justify-center rounded-full bg-amber-400/20 px-1.5 text-[11px] font-semibold tabular-nums text-amber-700 outline-none ring-sidebar-ring hover:bg-amber-400/30 focus-visible:ring-2 dark:text-amber-300"
              >
                {overview.pending}
              </Link>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </div>
    );
  };

  // The fold's last row, under no group: no label above it, no group around it.
  const renderAllTypes = (entry: StudioMenuEntry) => (
    <div className="px-2 py-1" data-testid="studio-menu-all-types">
      <SidebarMenu aria-label={labelOf(entry)}>{renderEntry(entry, null)}</SidebarMenu>
    </div>
  );

  return (
    <Sidebar
      collapsible="offcanvas"
      // Docked below the surface's header, inside the body row, rather than
      // fixed to the window's full height as the app sidebar is.
      className="!absolute !h-full"
    >
      {/* Studio's accent over everything the menu draws, docked or in the
          phone drawer (the primitive puts its own class on the docked frame only). */}
      <div data-studio-accent="" data-testid="studio-menu-accent" className={cn('flex min-h-0 flex-1 flex-col', STUDIO_ACCENT)}>
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
            {(!searching || overviewMatches) && renderOverview()}
            {matching.length === 0 && !allTypesMatches && !overviewMatches && (
              <p role="status" className="px-4 py-3 text-xs text-muted-foreground" data-testid="studio-menu-no-matches">
                {t('engine.studio.menu.noMatches', locale)}
              </p>
            )}
            {!folded && renderGroups(matching, 'flat')}
            {!folded && allTypes && allTypesMatches && renderAllTypes(allTypes)}
            {folded && renderGroups(tiers.common, 'common')}
            {folded && (tiers.advanced.length > 0 || allTypes) && (
              <>
                <div aria-hidden="true" data-testid="studio-menu-advanced-divider" className="mx-2 my-1 h-px bg-sidebar-border" />
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
                  {allTypes && renderAllTypes(allTypes)}
                </div>
              </>
            )}
          </nav>
        </SidebarContent>
      </div>
    </Sidebar>
  );
}
