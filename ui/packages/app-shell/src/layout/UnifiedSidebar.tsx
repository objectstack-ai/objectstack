/**
 * UnifiedSidebar
 *
 * Airtable-style contextual sidebar that dynamically switches between Home and App navigation.
 * Features:
 * - Persistent across all authenticated routes
 * - Context-aware navigation (Home vs App)
 * - Pinned bottom area (Settings, Help, User Profile)
 * - Smooth transitions between contexts
 * - Back to Home navigation from App context
 * - App switcher dropdown
 *
 * @module
 */

import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getIcon } from '../utils/getIcon.js';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  useSidebar,
} from '@object-ui/components';
import {
  Clock,
  Star,
  StarOff,
  ChevronRight,
  LayoutGrid,
  Layers,
  BarChart3,
} from 'lucide-react';
import { NavigationRenderer, hasVisibleNavigationItems, type NavItemActionContext } from '@object-ui/layout';
import type { NavigationArea, NavigationItem } from '@object-ui/types';
import { useMetadata } from '../providers/MetadataProvider.js';
import { useAuth, useWorkspaceAdminStatus } from '@object-ui/auth';
import { useRecentItems } from '../hooks/useRecentItems.js';
import { useRecentItemLabel } from '../hooks/useRecentItemLabel.js';
import { useFavorites } from '../hooks/useFavorites.js';
import { useNavPins } from '../hooks/useNavPins.js';
import { useNavActionDispatch } from '../hooks/useNavActionDispatch.js';
import { useNavTargetLabel } from '../hooks/useNavTargetLabel.js';
import { useNavDocTargetCheck } from '../hooks/useNavDocTargetCheck.js';
import { useNavMemberGates } from '../hooks/useNavMemberGates.js';
import { matchAppBySegment, appRouteSegment, resolveKeyedI18nLabel } from '../utils/index.js';
import { withoutUnreadableObjectEntries } from '../utils/navObjectReadGate.js';
import { useHomePath } from '../hooks/useHomePath.js';
// Aliased for symmetry with objectui's own `resolveKeyedI18nLabel` above (the
// names stopped colliding in objectui#4167): this is the spec's resolver (new in
// @objectstack/spec 17.0.0-rc.6) for the INLINE per-locale map form of
// `I18nLabel`, not for a translation-key ref.
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';
import { useObjectTranslation, useObjectLabel } from '@object-ui/i18n';
// useObjectLabel provides appLabel/appDescription for convention-based
// i18n lookup — `{ns}.apps.{name}.label` resolves to the translated label
// loaded from /api/v1/i18n/translations/:locale.
import { useNavigationContext } from '../context/NavigationContext.js';
import {
  useAppContextSelectors,
  contextSelectorQueryKey,
  STUDIO_PACKAGE_SELECTOR_ID,
} from './ContextSelectors.js';
import { AppMark } from './AppMark.js';
import { CONSOLE_BELOW_TOP_BAR } from './consoleTopBar.js';
import { SidebarItemMenu, sidebarItemDesignPath, favoriteDesignPath } from './SidebarItemMenu.js';

/**
 * The class the Recent group's label carries so that, once the sidebar
 * collapses to icons, the hidden label takes no pointer events
 * (objectui#12744). The `SidebarGroupLabel` primitive hides a label there with
 * `opacity-0` and `-mt-8` only, so the invisible label lies over the lower half
 * of the navigation row just above it; this label has a click handler, so a
 * click on that row's icon toggled Recent instead of navigating. The variant is
 * the primitive's own hiding condition: in the expanded sidebar the label is
 * visible and still opens and closes Recent. `NavigationRenderer` (in
 * `@object-ui/layout`) gives its group labels the same class.
 */
const HIDDEN_ICON_LABEL_NO_POINTER =
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:pointer-events-none';

/**
 * The classes every group label here carries so that, once the sidebar
 * collapses to icons, a hidden label is no keyboard focus stop and nothing a
 * screen reader announces (objectui#12795). The primitive draws the label at
 * `opacity-0` there, which leaves it in the tab order and in the accessibility
 * tree; `invisible` takes it out of both, under the primitive's own hiding
 * condition, so the expanded sidebar is unchanged. `visibility` joins the
 * primitive's transition list under the same condition, so the label still
 * fades out before it is hidden, and on expand it is visible at once and fades
 * in. `NavigationRenderer` (in `@object-ui/layout`) gives its group labels the
 * same pair, and a pin enumerates every `SidebarGroupLabel` call site.
 */
const HIDDEN_ICON_LABEL_NOT_FOCUSABLE =
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:invisible ' +
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:transition-[margin,opacity,visibility]';

/**
 * The classes the sidebar content carries so that, once the sidebar collapses
 * to icons, the rail scrolls vertically when its rows overflow (objectui#12794).
 * The `SidebarContent` primitive sets `overflow-hidden` under this variant, so
 * the rows below the fold could not be reached until the sidebar expanded.
 *
 * `cn` (tailwind-merge) drops the primitive's same-variant `overflow-hidden`
 * only for a later same-variant `overflow-*` shorthand; an `overflow-y-*` alone
 * leaves it in place and lets stylesheet order decide. So the shorthand here
 * is `overflow-auto`, and `overflow-x-hidden` keeps the horizontal axis
 * clipped: the rail's rows are wider than the 3rem rail, and it never scrolls
 * sideways. The rail draws no scrollbar: a classic bar takes its width out of
 * the 3rem rail, so the icon buttons would run under it and sit off-centre.
 * The wheel, touch and keyboard focus still scroll it. Marked important
 * because a host may theme every scrollbar with an unlayered `*` rule (the
 * console does), which outranks any layered utility. Off icon mode nothing
 * changes: the expanded sidebar and the mobile sheet keep the primitive's own
 * `overflow-auto` and the host's scrollbar.
 */
const ICON_RAIL_SCROLLS_VERTICALLY =
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:overflow-auto ' +
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:overflow-x-hidden ' +
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:[scrollbar-width:none]!';

/**
 * Lazy-resolved Lucide icon — see ../utils/getIcon for impl.
 * The local symbol is kept for backwards compat with existing call sites
 * within this file.
 */

interface UnifiedSidebarProps {
  /** When in app context, the active app name */
  activeAppName?: string;
  /** Callback when user switches apps */
  onAppChange?: (name: string) => void;
}

function isMetadataDirectoryItem(item: NavigationItem): boolean {
  return (item as any).componentRef === 'metadata:directory';
}

function isPackagesItem(item: NavigationItem): boolean {
  return (item as any).componentRef === 'developer:packages';
}

function isOverviewGroup(item: NavigationItem): boolean {
  if (item.type !== 'group') return false;
  const id = String(item.id ?? '').toLowerCase();
  const label = typeof item.label === 'string' ? item.label.toLowerCase() : '';
  return id === 'overview' || label === 'overview';
}

export function UnifiedSidebar({ activeAppName }: UnifiedSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar();
  const location = useLocation();
  const { t, language } = useObjectTranslation();
  const { appLabel } = useObjectLabel();
  const { context, currentAppName } = useNavigationContext();
  const { user, activeOrganization } = useAuth();
  const { isAdmin: isWorkspaceAdmin } = useWorkspaceAdminStatus();
  // `type: 'action'` nav items dispatch through here (framework#4509). The
  // sidebar renders inside ConsoleShell's GlobalActionRuntimeProvider, so this
  // resolves to the fully-wired console runner — confirm/param/result dialogs
  // included — with no provider of its own.
  const dispatchNavAction = useNavActionDispatch();
  // An entry with no `label` shows its target's CURRENT label, read from the
  // metadata cache at render time (objectui#9868). `nav:menu` wires the same
  // hook, so the two surfaces cannot name one entry two ways.
  const resolveNavTargetLabel = useNavTargetLabel();

  // Swipe-from-left-edge gesture to open sidebar on mobile
  React.useEffect(() => {
    const EDGE_THRESHOLD = 30;
    const SWIPE_DISTANCE = 50;
    let touchStartX = 0;
    const handleTouchStart = (e: TouchEvent) => {
      touchStartX = e.touches[0].clientX;
    };
    const handleTouchEnd = (e: TouchEvent) => {
      const deltaX = e.changedTouches[0].clientX - touchStartX;
      if (touchStartX < EDGE_THRESHOLD && deltaX > SWIPE_DISTANCE && isMobile) {
        // Idempotent direct open (ADR-0054 C1) — no synthetic click dispatch.
        setOpenMobile(true);
      }
    };
    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isMobile, setOpenMobile]);

  const { recentItems: allRecentItems } = useRecentItems();
  // A Studio package entry is labelled from the package list (objectui#11863),
  // which this sidebar does not load, so it is left out here rather than drawn
  // as its id. The Studio landing lists the recent packages.
  const recentItems = allRecentItems.filter(item => item.type !== 'package');
  // A recent entry's text is the item's own, resolved on this render
  // (objectui#11678); the entry stores identity only.
  const recentLabel = useRecentItemLabel();
  const { favorites, removeFavorite } = useFavorites();

  const { apps: metadataApps } = useMetadata();
  const apps = metadataApps || [];
  // objectui#7256 — every "Home" row below follows the product's DECLARED
  // landing, so the sidebar cannot offer a second home the top bar disowns.
  const homePath = useHomePath();
  // Filter switcher to non-hidden apps; active-app lookup spans all so
  // direct navigation to /apps/account still renders.
  const activeApps = apps.filter((a: any) => a.active !== false && a.hidden !== true);
  // ADR-0048 (A) — route segment may be a package id; match by it (name fallback).
  const activeApp = matchAppBySegment(apps.filter((a: any) => a.active !== false), activeAppName || currentAppName) || activeApps[0];
  // The app's identity — `branding.logo`, or its `icon` on a tile — is drawn
  // by the top bar's app pill on desktop, so this sidebar draws no logo header
  // there (objectui#12201, which retired the one objectui#10827 added). On a
  // phone the top bar hides the pill, and the drawer header below names the
  // app instead.

  // Pin persistence, and the pinned section's order (objectui#12059). The app's
  // own menu is drawn in the order the app authors: arranging it is Studio's
  // job, so this sidebar offers no menu reorder and keeps no personal menu
  // order. A stored `objectui-nav-order-<app>` key from before is not read.
  const { togglePin, applyPins, pinnedIds, reorderPins } = useNavPins();

  // The member's gates: `visible`, `requiredPermissions`, runtime
  // capabilities, and the object-read verdict the tree is pruned by. Built in
  // `useNavMemberGates`, which the app root's landing reads too, so the first
  // entry a member is sent to is one this sidebar draws (objectui#12426).
  const {
    evaluateVisibility: evalVis,
    checkPermission: checkPerm,
    checkCapability: checkCap,
    can,
  } = useNavMemberGates();

  // Area management.
  //
  // Area visibility is DERIVED from the items inside (objectui#3311 /
  // objectui#3319): the switcher offers an area iff at least one of its
  // navigation items survives the same item-level guards NavigationRenderer
  // applies (`visible`, `requiredPermissions`, runtime capabilities,
  // action-dispatcher presence). The active area is elected among the
  // VISIBLE areas only, so the user is never landed in — or stranded on —
  // an area that renders nothing. Same derivation as `AppSchemaRenderer`
  // (@object-ui/layout); the predicate is shared, not re-implemented.
  const areas: NavigationArea[] = activeApp?.areas || [];
  // An entry bound to an object the caller may not read is not drawn
  // (objectui#12109): the tree is pruned HERE, before it reaches the layout,
  // because no callback the layout asks answers "may this member read this
  // object" (see `withoutUnreadableObjectEntries`). Every area's tree and the
  // flat tree are pruned the same way, so the area election below and the drawn
  // menu read the same tree. Not memoised: a tree with nothing to prune comes
  // back as the very array it was, so a caller who may read everything hands
  // the layout the authored tree, and nothing downstream keys on the identity
  // of a pruned one (AGENTS.md #10).
  const readableAreas = areas.map((area) => {
    if (!area.navigation) return area;
    const navigation = withoutUnreadableObjectEntries(area.navigation, can);
    return navigation === area.navigation ? area : { ...area, navigation };
  });
  const readableAppNavigation: NavigationItem[] | undefined = activeApp?.navigation
    ? withoutUnreadableObjectEntries(activeApp.navigation, can)
    : activeApp?.navigation;
  // A `doc` entry the member may not read is not drawn (objectui#10188) —
  // defence in depth behind the server's app read, which already drops it
  // (objectstack#19790). Asked only in an app: on Home `activeApp` is merely
  // the first app, whose menu this sidebar does not draw.
  const checkDocTarget = useNavDocTargetCheck(
    context === 'app' ? [activeApp?.navigation, ...areas.map((area) => area.navigation)] : [],
  );
  const visibleAreas = readableAreas.filter((area) =>
    hasVisibleNavigationItems(area.navigation, {
      evaluateVisibility: evalVis,
      checkPermission: checkPerm,
      checkCapability: checkCap,
      checkDocTarget,
      // This sidebar always wires `onAction={dispatchNavAction}` on its
      // NavigationRenderer (framework#4509), so `action` items render and
      // count as area content.
      hasActionHandler: !!dispatchNavAction,
    }),
  );
  const [activeAreaId, setActiveAreaId] = React.useState<string | null>(
    () => visibleAreas.length > 0 ? visibleAreas[0].id : null,
  );

  const visibleAreaIds = visibleAreas.map((a) => a.id).join(',');

  // Re-elect when the app changes or the visible-area set changes. Keeping
  // `prev` whenever it is still visible means merely REVEALING a new area
  // never steals the user's current selection.
  React.useEffect(() => {
    if (visibleAreas.length > 0) {
      setActiveAreaId(prev => visibleAreas.some((a) => a.id === prev) ? prev : visibleAreas[0].id);
    } else {
      setActiveAreaId(null);
    }
  }, [activeApp?.name, visibleAreaIds]);

  // Resolve navigation items. The render-time `?? visibleAreas[0]` fallback
  // covers the frame between a gating change hiding the active area and the
  // effect above re-electing.
  const activeArea = visibleAreas.find((a) => a.id === activeAreaId) ?? visibleAreas[0];
  const appNavigation: NavigationItem[] = activeArea?.navigation || readableAppNavigation || [];

  // App-level context selectors (e.g. Studio's package scope). Their
  // values are injected into nav items as `{<id>}` template vars so a
  // single dropdown transparently scopes every secondary menu.
  const { contextValues, element: contextSelectorsUI } = useAppContextSelectors(
    activeApp?.name || 'home',
    activeApp?.contextSelectors,
    t,
  );

  // Home navigation items. For workspace admins we surface the full system
  // ("Administration") nav right here on /home — previously the home context
  // showed ONLY a "Home" link, so a fresh env (no apps yet) rendered a bare
  // centered page with the real menu nowhere in sight.
  // Non-admins get just Home — system administration is owner/admin-gated.
  const homeNavigation: NavigationItem[] = React.useMemo(() => {
    const items: NavigationItem[] = [
      { id: 'home-dashboard', label: t('home.nav', { defaultValue: 'Home' }), type: 'url' as const, url: homePath, icon: 'home' },
      // Package documentation portal (ADR-0046) — visible to all users, not
      // just workspace admins, so it lives in the base items rather than the
      // admin cluster below.
      { id: 'docs', label: t('layout.systemNav.documentation', { defaultValue: 'Documentation' }), type: 'url' as const, url: '/docs', icon: 'book-open' },
    ];
    if (isWorkspaceAdmin) {
      // #3590 — `sys-settings` targets the system hub `/apps/setup/system`, not
      // the bare `/apps/setup`. This cluster exists FOR the fresh env described
      // above (no apps yet), and that is precisely where bare `/apps/setup` is a
      // dead link: with zero apps it renders `AppContent`'s "No Apps Configured"
      // empty state (`isSystemRoute` keys on a `/system` segment), so an admin
      // landing on `/home` — `resolveLandingPath([])` — had no way through. The
      // `/system` form resolves in BOTH branches (`extraRoutesNoApp` with no
      // active app, `extraRoutes` once one exists), so an app-bearing deployment
      // now reaches the hub here instead of whatever app `/apps/setup` fell back
      // to. Every sibling below already spelled `/apps/setup/system/...` — the
      // two metadata-admin entries excepted, and only since: they name the
      // engine's canonical `/apps/setup/metadata/:type` routes (#3660, #3739),
      // because for THOSE two the `system/...` spelling is a redirect rather
      // than a page.
      const adminItems: NavigationItem[] = [
        { id: 'sys-settings', label: t('layout.systemNav.systemSettings', { defaultValue: 'System Settings' }), type: 'url' as const, url: '/apps/setup/system', icon: 'settings' },
        { id: 'sys-apps', label: t('layout.systemNav.applications', { defaultValue: 'Applications' }), type: 'url' as const, url: '/apps/setup/system/apps', icon: 'layout-grid' },
        { id: 'sys-marketplace', label: t('layout.systemNav.appMarketplace', { defaultValue: 'App Marketplace' }), type: 'url' as const, url: '/apps/setup/system/marketplace', icon: 'store' },
        // #3739 — canonical `…/metadata/object`, not the legacy
        // `…/system/metadata/object` alias. The alias is served by
        // `apps/console`'s `MetadataRedirect`, a bare `<Navigate>` onto this
        // very URL, so pointing here removes a hop without moving the landing
        // page. The alias routes themselves are untouched.
        { id: 'sys-objects', label: t('layout.systemNav.objectManager', { defaultValue: 'Object Manager' }), type: 'url' as const, url: '/apps/setup/metadata/object', icon: 'database' },
        // #3660 — canonical `…/metadata/datasource`, not the legacy
        // `…/component/metadata/resource?type=datasource` alias. The alias
        // renders `LegacyMetadataRedirect`, a bare `<Navigate>` onto this very
        // URL, so pointing here removes a hop without moving the landing page.
        // The alias route itself is untouched.
        { id: 'sys-datasources', label: t('layout.systemNav.datasources', { defaultValue: 'Datasources' }), type: 'url' as const, url: '/apps/setup/metadata/datasource', icon: 'database' },
        { id: 'sys-users', label: t('layout.systemNav.users', { defaultValue: 'Users' }), type: 'url' as const, url: '/apps/setup/system/users', icon: 'users' },
        { id: 'sys-orgs', label: t('layout.systemNav.organizations', { defaultValue: 'Organizations' }), type: 'url' as const, url: '/apps/setup/system/organizations', icon: 'building-2' },
        { id: 'sys-roles', label: t('layout.systemNav.roles', { defaultValue: 'Roles' }), type: 'url' as const, url: '/apps/setup/system/roles', icon: 'shield' },
        { id: 'sys-config', label: t('layout.systemNav.configuration', { defaultValue: 'Configuration' }), type: 'url' as const, url: '/apps/setup/system/settings', icon: 'sliders-horizontal' },
      ];
      items.push({
        id: 'sys-administration',
        label: t('layout.systemNav.administration', { defaultValue: 'Administration' }),
        type: 'group' as const,
        icon: 'shield',
        // Opened by default (objectui#3609). On `/home` this group IS the
        // admin's navigation, and this cluster exists for the zero-app
        // deployment whose whole complaint was "no way through" — its entries
        // behind a closed disclosure would re-create that. `NavigationRenderer`
        // opens a group that declares nothing (objectui#13336), so this line
        // restates that default; it is kept so the intent is written on the
        // group itself rather than left to whatever the renderer defaults to.
        expanded: true,
        children: adminItems,
      });
    }
    return items;
  }, [t, isWorkspaceAdmin, homePath]);

  // Determine which navigation to show based on context
  const navigationItems = context === 'home' ? homeNavigation : appNavigation;
  const basePath = context === 'app' && activeApp ? `/apps/${appRouteSegment(activeApp)}` : '';
  const isStudioApp = context === 'app' && activeApp?.name === 'studio';
  // Studio's package-management link carries the active package scope. Read
  // (and re-emit) it through the SAME per-selector key derivation the selector
  // writes with, instead of assuming the literal `package` key — for
  // `active_package` the derivation resolves to `package`, so existing links
  // are byte-identical, and the two halves can no longer drift apart
  // (objectui#3500).
  const studioScopeKey = contextSelectorQueryKey(STUDIO_PACKAGE_SELECTOR_ID);
  const studioScopeValue = contextValues[STUDIO_PACKAGE_SELECTOR_ID];
  const studioScopeSearch = React.useMemo(() => {
    if (!isStudioApp) return '';
    const packageId = new URLSearchParams(location.search).get(studioScopeKey) || studioScopeValue;
    return packageId ? `?${studioScopeKey}=${encodeURIComponent(packageId)}` : '';
  }, [studioScopeValue, isStudioApp, location.search, studioScopeKey]);

  const studioNavigationItems = React.useMemo(() => {
    if (context !== 'app' || activeApp?.name !== 'studio') return navigationItems;
    const packageManagementLabel = t('sidebar.packageManagement', {
      defaultValue: 'Package management',
    });
    const walk = (items: NavigationItem[]): NavigationItem[] =>
      items.flatMap((item): NavigationItem[] => {
        if (isMetadataDirectoryItem(item)) return [];
        // A separator has no children and is never the packages entry, and
        // carries none of the keys rewritten below (objectui#10867).
        if (item.type === 'separator') return [item];
        const children = item.children?.length ? walk(item.children) : item.children;
        if (item.type === 'group' && children?.length === 0) return [];
        if (isPackagesItem(item)) {
          return [{
            ...item,
            type: 'url' as const,
            label: packageManagementLabel,
            url: `${basePath}/component/developer/packages${studioScopeSearch}`,
            children,
          }];
        }
        if (children !== item.children) {
          return [{ ...item, children }];
        }
        return [item];
      });
    return walk(navigationItems).flatMap((item) => {
      if (!isOverviewGroup(item)) return [item];
      return item.children ?? [];
    });
  }, [activeApp?.name, basePath, context, navigationItems, studioScopeSearch, t]);

  // Apply pin state
  const processedNavigation = React.useMemo(
    () => applyPins(studioNavigationItems),
    [studioNavigationItems, applyPins],
  );

  // Recent section collapsed by default
  const [recentExpanded, setRecentExpanded] = React.useState(false);

  // One ⋯ menu on every entry, in place of the pin action (objectui#12427):
  // its first entry adds the entry to Favorites or removes it, through the
  // same pin store the pin action wrote. Not on a phone, where the sidebar
  // draws no per-entry control (objectui#1055) and pinning stays off. Its
  // Design entry opens what the app bar's Edit app opens for the entry, in the
  // app whose navigation this is (objectui#12520).
  const renderNavItemAction = (item: NavigationItem, row: NavItemActionContext) => (
    <SidebarItemMenu
      label={row.label}
      href={row.href}
      external={row.external}
      isFavorite={!!item.pinned}
      onToggleFavorite={() => togglePin(item.id, !item.pinned, item, row.basePath)}
      designPath={sidebarItemDesignPath(item, activeApp)}
    />
  );

  // The favorites that are not navigation entries (an object, a record, a
  // dashboard, a page or an app the user starred) are rows of the same
  // Favorites section, after the pinned entries, at the top of the sidebar
  // (objectui#12427). They used to be a group of their own after Recent, below
  // the fold on a long menu. Each row shows its stored label (the store's
  // `refreshLabel` keeps it current) and carries the same ⋯ menu, whose
  // favorites entry removes it. Its Design entry reads the app the favorite's
  // own address names, which need not be this one (objectui#12520). A phone
  // keeps the control it had (no hover).
  const contentFavorites = favorites.filter(f => f.type !== 'nav').slice(0, 8);
  const contentFavoriteRows = contentFavorites.length > 0
    ? contentFavorites.map(item => (
        <SidebarMenuItem key={item.id}>
          <SidebarMenuButton asChild tooltip={item.label}>
            <Link to={item.href}>
              <span className="text-muted-foreground">
                {item.type === 'dashboard' ? '📊' : item.type === 'report' ? '📈' : item.type === 'page' ? '📄' : '📋'}
              </span>
              <span className="truncate">{item.label}</span>
            </Link>
          </SidebarMenuButton>
          <SidebarItemMenu
            label={item.label}
            href={item.href}
            isFavorite
            onToggleFavorite={() => removeFavorite(item.id)}
            designPath={favoriteDesignPath(item, apps)}
          />
        </SidebarMenuItem>
      ))
    : null;

  return (
    <>
    <Sidebar collapsible="icon" className={CONSOLE_BELOW_TOP_BAR}>
      {/* Mobile-only drawer header — the app's glyph and name (objectui#12201
          item 3). On a phone the top bar hides the app pill, so this is the
          one place that says which app the user is in. It replaces the old
          Home row, and keeps that row's job: the trailing 「All apps」
          button is the way back out of the app, since a phone has no
          path-separator, no back arrow and no top-bar pill to open. Render
          it inside the sheet header so it survives the SidebarHeader vs
          SidebarContent split. */}
      {isMobile && context === 'app' && activeApp && (
        <SidebarHeader className="border-b p-1.5">
          <div className="flex min-h-[44px] items-center gap-2.5 px-2" data-testid="mobile-sidebar-app">
            <AppMark app={activeApp} size="md" />
            <span className="flex-1 truncate text-[15px] font-semibold">
              {appLabel({ name: activeApp.name, label: resolveKeyedI18nLabel(activeApp.label, t) })}
            </span>
            <Link to={homePath} onClick={() => setOpenMobile(false)} data-testid="mobile-sidebar-home" aria-label={t('layout.appSwitcher.allApps', { defaultValue: 'All apps' })} title={t('layout.appSwitcher.allApps', { defaultValue: 'All apps' })} className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
              <LayoutGrid className="h-5 w-5" />
            </Link>
          </div>
        </SidebarHeader>
      )}
      <SidebarContent className={`pt-2 ${ICON_RAIL_SCROLLS_VERTICALLY}`}>
        <div className="transition-opacity duration-200 ease-in-out">
          {context === 'app' && activeApp ? (
           <>
          {/* App-level context selectors (e.g. package scope) */}
          {contextSelectorsUI && (
            <SidebarGroup className="group-data-[state=collapsed]:hidden px-2 pb-1">
              <div className="rounded-lg border border-sidebar-border/70 bg-sidebar-accent/25 p-1.5 shadow-xs">
                <SidebarGroupContent>
                  {contextSelectorsUI}
                </SidebarGroupContent>
              </div>
            </SidebarGroup>
          )}

          {/* Area Switcher — offered only when MULTIPLE areas are visible;
              area visibility is derived from the items inside (#3319) */}
           {visibleAreas.length > 1 && (
             <SidebarGroup>
               <SidebarGroupLabel className={`flex items-center gap-1.5 ${HIDDEN_ICON_LABEL_NOT_FOCUSABLE}`}>
                 <Layers className="h-3.5 w-3.5" />
                 {t('sidebar.area', { defaultValue: 'Area' })}
               </SidebarGroupLabel>
               <SidebarGroupContent>
                 <SidebarMenu>
                   {visibleAreas.map((area) => {
                     const AreaIcon = getIcon(area.icon);
                     const isActiveArea = area.id === activeArea?.id;
                     // `NavigationArea.label` is the spec's `I18nLabel`,
                     // widened in @objectstack/spec 17.0.0-rc.6 to
                     // `string | Record<string, string>`, so the inline
                     // per-locale form has to be resolved before it reaches a
                     // text slot or it renders as `[object Object]`.
                     const areaLabel = resolveInlineI18nLabel(area.label, language);
                     return (
                       <SidebarMenuItem key={area.id}>
                         <SidebarMenuButton
                           isActive={isActiveArea}
                           tooltip={areaLabel}
                           onClick={() => setActiveAreaId(area.id)}
                         >
                           <AreaIcon className="h-4 w-4" />
                           <span>{areaLabel}</span>
                         </SidebarMenuButton>
                       </SidebarMenuItem>
                     );
                   })}
                 </SidebarMenu>
               </SidebarGroupContent>
             </SidebarGroup>
           )}

           {/* App Navigation tree. `locale` is the same `language` the area
               labels above resolve in, so an entry label written as an inline
               locale map reads the viewer's entry too (objectui#11299). */}
           <NavigationRenderer
             items={processedNavigation}
             basePath={basePath}
             evaluateVisibility={evalVis}
             checkPermission={checkPerm}
             checkCapability={checkCap}
             checkDocTarget={checkDocTarget}
             enablePinning={!isMobile}
             renderItemAction={isMobile ? undefined : renderNavItemAction}
             extraFavorites={contentFavoriteRows}
             pinnedOrder={pinnedIds}
             onPinnedReorder={reorderPins}
             resolveTargetLabel={resolveNavTargetLabel}
             locale={language}
             onAction={dispatchNavAction}
             t={t}
             templateContext={{ currentUserId: user?.id ?? null, currentOrgId: activeOrganization?.id ?? null, contextValues }}
           />

           {/* The app's report index (objectui#13020): every report the app
               ships that the member may open, its navigation's or not, so no
               report is left with only a typed URL. A static entry: the
               sidebar reads no report list for it (objectui#12980), and the
               index says so when there are none. Not in Studio, whose
               navigation is its own design surface. */}
           {!isStudioApp && (
             <SidebarGroup>
               <SidebarGroupContent>
                 <SidebarMenu>
                   <SidebarMenuItem>
                     <SidebarMenuButton
                       asChild
                       isActive={location.pathname === `${basePath}/reports`}
                       tooltip={t('sidebar.allReports', { defaultValue: 'All reports' })}
                     >
                       <Link to={`${basePath}/reports`} data-testid="sidebar-report-index">
                         <BarChart3 className="h-4 w-4" />
                         <span>{t('sidebar.allReports', { defaultValue: 'All reports' })}</span>
                       </Link>
                     </SidebarMenuButton>
                   </SidebarMenuItem>
                 </SidebarMenu>
               </SidebarGroupContent>
             </SidebarGroup>
           )}

           {/* Recent Items */}
           {recentItems.length > 0 && (
             <SidebarGroup>
               <SidebarGroupLabel
                 className={`flex items-center gap-1.5 cursor-pointer select-none ${HIDDEN_ICON_LABEL_NO_POINTER} ${HIDDEN_ICON_LABEL_NOT_FOCUSABLE}`}
                 onClick={() => setRecentExpanded(prev => !prev)}
               >
                 <ChevronRight className={`h-3 w-3 transition-transform duration-150 ${recentExpanded ? 'rotate-90' : ''}`} />
                 <Clock className="h-3.5 w-3.5" />
                 {t('sidebar.recent', { defaultValue: 'Recent' })}
               </SidebarGroupLabel>
               {recentExpanded && (
               <SidebarGroupContent>
                 <SidebarMenu>
                   {recentItems.slice(0, 5).map(item => (
                     <SidebarMenuItem key={item.id}>
                       <SidebarMenuButton asChild tooltip={recentLabel(item)}>
                         <Link to={item.href}>
                           <span className="text-muted-foreground">
                             {item.type === 'dashboard' ? '📊' : item.type === 'report' ? '📈' : '📄'}
                           </span>
                           <span className="truncate">{recentLabel(item)}</span>
                         </Link>
                       </SidebarMenuButton>
                     </SidebarMenuItem>
                   ))}
                 </SidebarMenu>
               </SidebarGroupContent>
               )}
             </SidebarGroup>
           )}
           </>
         ) : (
           /* Home Navigation */
           <>
           {/* ONE navigation renderer, both arms (objectui#3609).

               This arm used to hand-roll
               `homeNavigation.map(item => <Link to={item.url || '/home'}>)`.
               That map does not recurse, so `type: 'group'` was simply
               unsupported here — and home navigation is the only navigation
               that groups. The nine-entry Administration cluster collapsed into
               a single row; a group carries no `url` of its own, so
               `|| '/home'` pointed that row back at the page the user was
               already standing on, and not one child ever reached the DOM.
               `resolveLandingPath([])` sends a fresh-deployment admin to
               exactly this screen, and `HomePage` deliberately dropped its own
               System card because "the system entries are already in the nav" —
               so the net effect was an admin with no route into system
               administration at all.

               Routing this arm through the SAME `NavigationRenderer` the app
               arm uses (above) removes the divergence instead of teaching a
               second renderer to recurse: groups render as Collapsibles, and
               every entry passes the same item-level `visible` /
               `requiredPermissions` / runtime-capability guards. The component
               takes `basePath` as a prop and reads only `useLocation()` — it
               has no `activeApp` coupling — so nothing had to be loosened to
               reuse it here.

               `basePath=""` is what this arm's `basePath` already computes to
               (`context === 'app' && activeApp ? … : ''`), and every home entry
               is `type: 'url'`, whose href resolution is verbatim — so the two
               surviving top-level links keep byte-identical hrefs.

               Deliberately NOT forwarded from the app arm:
               - `enablePinning` (and the pinned section's order) — a pinned
                 section would land directly above this arm's own "Starred"
                 group. A separate product decision, not part of unflattening
                 a group. (The app arm's menu reorder, also left out here, is
                 retired: objectui#12059.)
               (Until `9c60144b5` this list also named `resolveGroupLabel` /
               `resolveItemLabel`. Those props are gone from the renderer
               entirely — they were unreachable for every real nav entry, and
               app-nav localization belongs to the server `/meta` boundary.) */}
           <NavigationRenderer
             items={homeNavigation}
             basePath=""
             evaluateVisibility={evalVis}
             checkPermission={checkPerm}
             checkCapability={checkCap}
             resolveTargetLabel={resolveNavTargetLabel}
             locale={language}
             onAction={dispatchNavAction}
             t={t}
             templateContext={{ currentUserId: user?.id ?? null, currentOrgId: activeOrganization?.id ?? null, contextValues }}
           />

           {/* Starred Apps */}
           {favorites.filter(f => f.type === 'object' || f.type === 'dashboard' || f.type === 'page').length > 0 && (
             <SidebarGroup>
               <SidebarGroupLabel className={`flex items-center gap-1.5 ${HIDDEN_ICON_LABEL_NOT_FOCUSABLE}`}>
                 <Star className="h-3.5 w-3.5" />
                 {t('sidebar.starred', { defaultValue: 'Starred' })}
               </SidebarGroupLabel>
               <SidebarGroupContent>
                 <SidebarMenu>
                   {favorites.filter(f => f.type === 'object' || f.type === 'dashboard' || f.type === 'page').slice(0, 8).map(item => (
                     <SidebarMenuItem key={item.id}>
                       <SidebarMenuButton asChild tooltip={item.label}>
                         <Link to={item.href}>
                           <span className="text-muted-foreground">
                             {item.type === 'dashboard' ? '📊' : item.type === 'page' ? '📄' : '📋'}
                           </span>
                           <span className="truncate">{item.label}</span>
                         </Link>
                       </SidebarMenuButton>
                       <SidebarMenuAction
                         showOnHover
                         onClick={(e: any) => { e.stopPropagation(); removeFavorite(item.id); }}
                         aria-label={t('sidebar.removeFromFavorites', { defaultValue: 'Remove {{name}} from favorites', name: item.label })}
                       >
                         <StarOff className="h-3 w-3" />
                       </SidebarMenuAction>
                     </SidebarMenuItem>
                   ))}
                 </SidebarMenu>
               </SidebarGroupContent>
             </SidebarGroup>
           )}
           </>
         )}
        </div>
      </SidebarContent>
      {/* No footer trigger: the app bar's left slot holds the shell's one
          sidebar trigger at every width (objectui#12429). */}
    </Sidebar>
    {/* Mobile bottom-tab navigation removed — the drawer (☰) already
        surfaces the full navigation tree, so a bottom strip of the
        first 5 leaves was pure duplication and ate ~52px of vertical
        space. Pattern follows Notion / Linear (drawer-only). */}
    </>
  );
}
