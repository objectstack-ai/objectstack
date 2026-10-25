/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/layout - AppSchema Renderer
 *
 * Consumes an `AppSchema` JSON object and renders a complete application
 * shell with branding, sidebar navigation (including area switching),
 * and mobile navigation modes.
 *
 * This is the main P0.1 deliverable — it allows Console (or any consumer)
 * to render a fully-functional AppShell from a single JSON document.
 *
 * @module AppSchemaRenderer
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Layers } from 'lucide-react';
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarInput,
  Badge,
} from '@object-ui/components';
import type { AppComponentSchema, NavigationItem, NavigationEntryItem, NavigationArea } from '@object-ui/types';
import { menuItemToNavigationItem } from '@object-ui/types';
// Aliased on import, following PR #4169's convention: this repo has its OWN
// `resolveI18nLabel` over a DIFFERENT vocabulary, and neither accepts the
// other's shape. See `resolveAreaLabel` below for which is which.
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';
import { AppShell, type AppShellBranding } from './AppShell';
import {
  NavigationRenderer,
  hasVisibleNavigationItems,
  resolveActiveNavItem,
  resolveHref,
  resolveIcon,
  resolveNavItemLabel,
  type NavigationVisibilityOptions,
  type VisibilityEvaluator,
  type PermissionChecker,
  type CapabilityChecker,
  type DocTargetChecker,
} from './NavigationRenderer';
// Internal module, not re-exported by `index.ts` (objectui#11395).
import { byNavOrder } from './navOrder';

/**
 * The classes this file's sidebar group label carries so that, once the
 * sidebar collapses to icons, the hidden label is nothing a screen reader
 * announces and no keyboard focus stop (objectui#12795). The
 * `SidebarGroupLabel` primitive draws it at `opacity-0` there, which leaves it
 * in the accessibility tree; `invisible` takes it out, under the primitive's
 * own hiding condition, so the expanded sidebar is unchanged. `visibility`
 * joins the primitive's transition list under the same condition, so the label
 * still fades out before it is hidden. `NavigationRenderer` documents the pair
 * in full, and a pin enumerates every `SidebarGroupLabel` call site.
 * The primitive is Shadcn-synced and never edited (AGENTS.md #7), so the pair
 * rides on the call site's `className`. Module-local on purpose: `index.ts`
 * re-exports this file whole.
 */
const HIDDEN_ICON_LABEL_NOT_FOCUSABLE =
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:invisible ' +
  'group-data-[state=collapsed]:group-data-[collapsible=icon]:transition-[margin,opacity,visibility]';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Mobile navigation display mode — the two modes this renderer implements.
 *
 * `drawer` is the default (the sidebar rides in the AppShell's mobile sheet
 * overlay); `bottom_nav` additionally renders the fixed bottom bar. Those are
 * the renderer's only two read points for the prop — the default below and the
 * `=== 'bottom_nav'` comparison that gates the bottom bar — so every value that
 * is not `bottom_nav` produces drawer behaviour.
 *
 * A third member (spelled after the collapsed-sidebar menu button) rode in this
 * union with a JSDoc line promising "collapsed sidebar" and NO read point
 * anywhere, which made it behaviourally identical to `drawer` while reading as
 * a capability. Retired in objectui#3985 under ADR-0049 enforce-or-remove
 * (maintainer ruling 2026-08-10): it never was behaviour, so it is gone from
 * this union and from the published vocabulary rather than being documented as
 * a synonym for the default. Wanting a collapsed-sidebar mode is an
 * implementation card first, and the value comes back with a read point — never
 * as a declaration on its own.
 */
export type MobileNavMode = 'drawer' | 'bottom_nav';

export interface AppSchemaRendererProps {
  /** The AppSchema JSON to render */
  schema: AppComponentSchema;

  /** Base URL prefix for generated hrefs (e.g. "/apps/crm") */
  basePath?: string;

  /** Mobile navigation mode @default "drawer" */
  mobileNavMode?: MobileNavMode;

  /** Optional visibility evaluator passed to NavigationRenderer */
  evaluateVisibility?: VisibilityEvaluator;

  /** Optional permission checker passed to NavigationRenderer */
  checkPermission?: PermissionChecker;

  /** Optional capability checker passed to NavigationRenderer (gates `requiresObject` / `requiresService`) */
  checkCapability?: CapabilityChecker;

  /** Optional member-readability checker for `doc` entries, passed to NavigationRenderer (objectui#10188) */
  checkDocTarget?: DocTargetChecker;

  /** Called when an action-type navigation item is clicked */
  onAction?: (item: NavigationItem) => void;

  /** Slot: top navbar content (rendered beside the sidebar trigger) */
  navbar?: React.ReactNode;

  /** Slot: sidebar header (e.g. app switcher dropdown). Replaces default branding header when provided. */
  sidebarHeader?: React.ReactNode;

  /** Slot: sidebar footer (e.g. user profile menu) */
  sidebarFooter?: React.ReactNode;

  /** Slot: extra sidebar content rendered after navigation (e.g. favorites, recent items) */
  sidebarExtra?: React.ReactNode;

  /** Page content */
  children: React.ReactNode;

  /** Extra class on the shell's content element (inside its one `main` landmark) */
  className?: string;

  /** Whether the sidebar starts open @default true */
  defaultOpen?: boolean;

  // --- P1.7 Navigation Enhancements ---

  /** Show a search input in the sidebar to filter navigation items */
  enableSearch?: boolean;

  /** Enable pin/favorite toggle on navigation items */
  enablePinning?: boolean;

  /** Called when a navigation item is pinned or unpinned */
  onPinToggle?: (itemId: string, pinned: boolean, item?: NavigationItem, basePath?: string) => void;

  // RETIRED (objectui#12059): `enableReorder` / `onReorder`. They only handed
  // `NavigationRenderer`'s menu reorder through, which is retired: an app's
  // menu order is authored in Studio, and every user sees it. Do not re-add.
}

// ---------------------------------------------------------------------------
// AreaSwitcher
// ---------------------------------------------------------------------------

/**
 * Renders the switcher for the areas the current user can still see.
 *
 * Areas carry no authorable gate of their own: `@objectstack/spec` 17.0.0
 * retired `visible` and `requiredPermissions` at area level
 * (`AREA_VISIBLE_RETIRED` / `AREA_REQUIRED_PERMISSIONS_RETIRED`) — an area is
 * a layout grouping, not an access boundary, so gating belongs on the
 * navigation ITEM, which `NavigationRenderer` still enforces via the same
 * `evalVis` / `checkPerm` this component used to apply one level up. The
 * spec's area object is `.strict()`, so no v17-valid app can carry the
 * retired keys.
 *
 * Area visibility is instead DERIVED (objectui#3311): `AppSchemaRenderer`
 * lists an area here iff `hasVisibleNavigationItems` finds at least one item
 * in it that survives the item-level guards. An area whose items are all
 * gated away disappears from the switcher — the same UX the retired keys used
 * to produce — without resurrecting any authorable key for the platform's
 * strict schema to reject. An area with no items at all derives the same way
 * (no visible item → hidden).
 */
/**
 * Resolve a `NavigationArea.label` — the spec's `I18nLabel` — to display text.
 *
 * ## Why the spec's resolver and not this package's `resolveLabel`
 *
 * There are two label vocabularies in play and they are NOT interchangeable
 * (objectui#4167 renamed objectui's own resolver to keep them apart):
 *
 *  - objectui's KEYED ref — a translation key plus a default
 *    (`{ key, defaultValue, params }`) — resolved by `resolveLabel` against an
 *    injected `t`;
 *  - `@objectstack/spec`'s `I18nLabel`, which 17.0.0-rc.6 widened from
 *    `string` to `string | Record<string, string>` — the INLINE per-locale map
 *    the author writes directly in the metadata. `NavigationArea.label` is
 *    this, and since objectui#11299 so is a navigation entry's `label`.
 *
 * Feeding a map to the keyed resolver returns `undefined` (no `key`, no
 * `defaultValue`); feeding it to `String()` renders `[object Object]`. So this
 * uses the producer's own shared resolver, `resolveI18nLabel` from
 * `@objectstack/spec/ui`, which is the single rule for that vocabulary on both
 * ends of the platform (objectstack#6761).
 *
 * ## Why no locale is threaded — a deliberate choice, not an omission
 *
 * `@object-ui/layout` carries **no i18n dependency by design**: this package's
 * whole i18n story is injection (`NavigationRenderer` takes `t`, the target
 * label resolver and — since objectui#11299 — the viewer's `locale` as props,
 * so the layout package is never coupled to i18n), and
 * `AppSchemaRendererProps` exposes no locale, no `t`, and no context that
 * carries one. Reaching for
 * `@object-ui/i18n` here to read the live UI language would add exactly the
 * coupling that design forbids, so the resolver is called with `undefined`,
 * which it documents as "no locale known" and resolves as `en` — the platform's
 * source language.
 *
 * The observable consequence, stated rather than hidden: an area whose label is
 * an inline map renders its `en` entry (then `default`, then any entry) instead
 * of the viewer's language. That is strictly better than `[object Object]`, and
 * it is a floor, not a ceiling — the day a consumer needs per-viewer area
 * labels, the fix is to thread a locale down as a prop from the host that
 * already knows it, and this call is the one place it lands (that prop would
 * also be the one to hand `NavigationRenderer`'s `locale`, which this
 * component does not pass today, so its entries' map labels read the same
 * `en` floor). Deliberately not done pre-emptively: no consumer of
 * `AppSchemaRenderer` in this repo has a locale to give it today — objectui#11299
 * measured it again and left it, since taking one would add a public prop to
 * `AppSchemaRendererProps`.
 */
function resolveAreaLabel(label: NavigationArea['label']): string {
  return resolveInlineI18nLabel(label, undefined) ?? '';
}

function AreaSwitcher({
  areas,
  activeAreaId,
  onAreaChange,
}: {
  areas: NavigationArea[];
  activeAreaId: string;
  onAreaChange: (id: string) => void;
}) {
  if (areas.length <= 1) return null;

  return (
    <SidebarGroup>
      <SidebarGroupLabel className={`flex items-center gap-1.5 ${HIDDEN_ICON_LABEL_NOT_FOCUSABLE}`}>
        <Layers className="h-3.5 w-3.5" />
        Area
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {areas.map((area) => {
            const AreaIcon = resolveIcon(area.icon);
            // `NavigationArea.label` is the spec's `I18nLabel`, which since
            // `@objectstack/spec` 17.0.0-rc.6 is `string | Record<string, string>` —
            // an author may inline `{ en: 'Sales', 'zh-CN': '销售' }` here.
            const areaLabel = resolveAreaLabel(area.label);
            return (
              <SidebarMenuItem key={area.id}>
                <SidebarMenuButton
                  isActive={area.id === activeAreaId}
                  tooltip={areaLabel}
                  onClick={() => onAreaChange(area.id)}
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
  );
}

// ---------------------------------------------------------------------------
// MobileBottomNav
// ---------------------------------------------------------------------------

function MobileBottomNav({
  items,
  basePath,
  guards,
  onAction,
}: {
  items: NavigationItem[];
  basePath: string;
  /** The guard inputs the sidebar and the area derivation get (objectui#11362). */
  guards: NavigationVisibilityOptions;
  onAction?: (item: NavigationItem) => void;
}) {
  const location = useLocation();
  // Show up to 5 entries the sidebar draws. Flatten group children so apps that
  // organise navigation into groups (e.g. Setup → Overview / Administration /
  // …) still surface real links in the mobile bottom nav.
  // Separators are skipped, so what comes back is entries only — each carries
  // the `label` the bottom nav draws (objectui#10867).
  //
  // objectui#11362: a tab is drawn only when its sidebar row is. Each node asks
  // `hasVisibleNavigationItems` about itself alone, which is the sidebar's own
  // per-node answer: `passesNavItemGuards` (`visible`, `requiredPermissions`,
  // the capability gates, a `doc` entry's target), then a group survives only
  // through a visible child and an `action` entry only when `onAction` is
  // wired. A gated group therefore takes its children with it, as it does in
  // the sidebar, and the guard runs before the five-tab cap, so a hidden entry
  // never takes a slot. ⛔ No copy of the guard here.
  //
  // objectui#11395: each level is sorted by `byNavOrder` before it is walked —
  // the top level, then each group's children as the walk reaches them — which
  // is the sidebar's one comparator at the sidebar's two sort sites. The tabs
  // therefore come out in the sidebar's reading order, and the guard and the cap
  // run after the sort, so the five tabs are the sidebar's first five drawn
  // entries. ⛔ No copy of the sort here.
  const collectLeaves = (list: NavigationItem[]): NavigationEntryItem[] => {
    const out: NavigationEntryItem[] = [];
    for (const item of list.slice().sort(byNavOrder)) {
      if (!hasVisibleNavigationItems([item], guards)) continue;
      if (item.type === 'separator') continue;
      if (item.type === 'group') {
        out.push(...collectLeaves(item.children || []));
      } else {
        out.push(item);
      }
    }
    return out;
  };
  const leaves = collectLeaves(items).slice(0, 5);

  if (leaves.length === 0) return null;

  // objectui#11211: a tab opens the page its sidebar row opens, so it asks the
  // sidebar's own rule pair with the sidebar's own arguments — `resolveHref`
  // for where it goes and `resolveActiveNavItem` (its inverse) for whether it
  // lights — never a per-type spelling of either. The arguments are the ones
  // `InternalSidebar` hands `NavigationRenderer`: `basePath` and no template
  // context, which `AppSchemaRendererProps` does not carry. The election runs
  // over the whole tree, as the sidebar's does, so at most one tab lights and
  // it is the row the sidebar highlights.
  const activeId =
    resolveActiveNavItem(items, location.pathname, location.search, basePath)?.id ?? null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t bg-background/95 backdrop-blur-sm px-2 py-1 sm:hidden safe-area-bottom"
      role="navigation"
      aria-label="Mobile navigation"
    >
      {leaves.map((item) => {
        const NavIcon = resolveIcon(item.icon);
        const { href, external } = resolveHref(item, basePath);
        const className = `relative flex flex-col items-center gap-0.5 px-2 py-1.5 transition-colors min-w-[44px] min-h-[44px] justify-center ${
          item.id === activeId ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
        }`;
        const content = (
          <>
            <NavIcon className="h-5 w-5" />
            {/* `resolveNavItemLabel`, not a raw `item.label` read: an entry's label may be
                absent since objectui#9868, and this host has no metadata, so it shows the
                same machine-name backstop its `NavigationRenderer` does. */}
            <span className="text-[10px] truncate max-w-[60px]">{resolveNavItemLabel(item)}</span>
            {/* objectui#11395: the spec-declared `badge` and `badgeVariant`, drawn when the
                sidebar row draws them, with the same `Badge` and the same variant (an absent
                `badgeVariant` is `Badge`'s own default, which is the sidebar's). Placed over
                the icon's corner; last in the DOM so the tab reads in the sidebar row's order. */}
            {item.badge != null && (
              <Badge
                variant={item.badgeVariant}
                className="absolute top-0.5 left-1/2 ml-1.5 px-1 py-0 text-[9px] leading-tight"
              >
                {item.badge}
              </Badge>
            )}
          </>
        );

        // An `action` entry runs, it does not navigate: the sidebar draws it as
        // a button that hands the whole item to `onAction`, and so does the bar
        // (objectui#11362). `collectLeaves` keeps one only when `onAction` is
        // wired; its `resolveHref` answer is `#`, a dead tab.
        if (item.type === 'action') {
          return (
            <button key={item.id} type="button" onClick={() => onAction?.(item)} className={className}>
              {content}
            </button>
          );
        }

        // An `external` answer opens in a new tab, the way the sidebar draws it.
        return external ? (
          <a key={item.id} href={href} target="_blank" rel="noopener noreferrer" className={className}>
            {content}
          </a>
        ) : (
          <Link key={item.id} to={href} className={className}>
            {content}
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InternalSidebar (wraps Sidebar primitive + header + navigation)
// ---------------------------------------------------------------------------

function InternalSidebar({
  schema,
  basePath,
  evalVis,
  checkPerm,
  checkCap,
  checkDocTarget,
  onAction,
  sidebarHeader,
  sidebarFooter,
  sidebarExtra,
  visibleAreas,
  activeAreaId,
  setActiveAreaId,
  resolvedNavigation,
  enableSearch,
  enablePinning,
  onPinToggle,
}: {
  schema: AppComponentSchema;
  basePath: string;
  evalVis: VisibilityEvaluator;
  checkPerm: PermissionChecker;
  checkCap: CapabilityChecker;
  checkDocTarget?: DocTargetChecker;
  onAction?: (item: NavigationItem) => void;
  sidebarHeader?: React.ReactNode;
  sidebarFooter?: React.ReactNode;
  sidebarExtra?: React.ReactNode;
  /** Areas with at least one visible item — derived, not authored (#3311). */
  visibleAreas: NavigationArea[];
  activeAreaId: string | null;
  setActiveAreaId: (id: string) => void;
  resolvedNavigation: NavigationItem[];
  enableSearch?: boolean;
  enablePinning?: boolean;
  onPinToggle?: (itemId: string, pinned: boolean, item?: NavigationItem, basePath?: string) => void;
}) {
  // The app logo is `branding.logo`, an image URL (objectui#10827) — the one
  // spelling `@objectstack/spec` declares. An icon NAME comes from `icon`, the
  // key every other app surface reads; the retired top-level `logo` carried
  // both and is read by nothing.
  const logo = schema.branding?.logo;
  const Icon = resolveIcon(schema.icon);
  const [searchQuery, setSearchQuery] = useState('');

  return (
    <Sidebar collapsible="icon">
      {/* Header: custom slot or default branding */}
      <SidebarHeader>
        {sidebarHeader ?? (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" tooltip={schema.title ?? schema.name}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  {logo ? (
                    <img
                      src={logo}
                      alt={schema.title ?? ''}
                      className="size-6 object-contain"
                    />
                  ) : (
                    // eslint-disable-next-line react-hooks/static-components -- resolveIcon returns a stable icon component from a static registry, not a component created during render
                    <Icon className="size-4" />
                  )}
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">
                    {schema.title ?? schema.name ?? 'App'}
                  </span>
                  {schema.description && (
                    <span className="truncate text-xs text-muted-foreground">
                      {schema.description}
                    </span>
                  )}
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
        {/* Search input */}
        {enableSearch && (
          <SidebarInput
            placeholder="Search navigation…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search navigation"
          />
        )}
      </SidebarHeader>

      <SidebarContent>
        {/* Area Switcher — only areas with a visible item, and only when
            there is more than one of them left to switch between (#3311) */}
        {visibleAreas.length > 1 && activeAreaId && (
          <AreaSwitcher
            areas={visibleAreas}
            activeAreaId={activeAreaId}
            onAreaChange={setActiveAreaId}
          />
        )}

        {/* Navigation tree */}
        <NavigationRenderer
          items={resolvedNavigation}
          basePath={basePath}
          evaluateVisibility={evalVis}
          checkPermission={checkPerm}
          checkCapability={checkCap}
          checkDocTarget={checkDocTarget}
          onAction={onAction}
          searchQuery={searchQuery}
          enablePinning={enablePinning}
          onPinToggle={onPinToggle}
        />

        {/* Extra sidebar content slot (e.g. favorites, recent items) */}
        {sidebarExtra}
      </SidebarContent>

      {/* Optional footer slot */}
      {sidebarFooter && <SidebarFooter>{sidebarFooter}</SidebarFooter>}
    </Sidebar>
  );
}

// ---------------------------------------------------------------------------
// AppSchemaRenderer (main export)
// ---------------------------------------------------------------------------

/**
 * Renders a complete application shell from an `AppSchema` JSON document.
 *
 * Responsibilities:
 * - Reads `name`, `title`, `description`, `icon`, `branding.logo`, `branding.favicon` for branding
 * - Renders sidebar navigation from `navigation` or `areas[].navigation`
 * - Area switcher when multiple areas are VISIBLE — area visibility is
 *   derived from the items inside, not authored (objectui#3311): an area
 *   whose items are all gated away is hidden and never auto-activated
 * - Mobile modes: `drawer` (sheet overlay, default) and `bottom_nav` (fixed
 *   bottom bar) — see `MobileNavMode` for why that list is two long
 * - Evaluates `visible` expressions and `requiredPermissions` on every item
 *
 * @example
 * ```tsx
 * <AppSchemaRenderer
 *   schema={appJson}
 *   basePath="/apps/sales"
 *   mobileNavMode="bottom_nav"
 *   evaluateVisibility={(expr) => evaluateVisibility(expr, evaluator)}
 *   checkPermission={(perms) => perms.every(p => can(p))}
 * >
 *   <Outlet />
 * </AppSchemaRenderer>
 * ```
 */
export function AppSchemaRenderer({
  schema,
  basePath = '',
  mobileNavMode = 'drawer',
  evaluateVisibility: evalVisProp,
  checkPermission: checkPermProp,
  checkCapability: checkCapProp,
  checkDocTarget,
  onAction,
  navbar,
  sidebarHeader,
  sidebarFooter,
  sidebarExtra,
  children,
  className,
  defaultOpen = true,
  enableSearch,
  enablePinning,
  onPinToggle,
}: AppSchemaRendererProps) {
  // Default evaluators
  const evalVis: VisibilityEvaluator = evalVisProp ?? ((expr) => {
    if (expr === false || expr === 'false') return false;
    return true;
  });
  const checkPerm: PermissionChecker = checkPermProp ?? (() => true);
  const checkCap: CapabilityChecker = checkCapProp ?? (() => true);

  // --- Resolve navigation from legacy `menu` or modern `navigation`/`areas` ---
  const legacyNavigation = useMemo(
    () => (schema.menu ?? []).map((m, i) => menuItemToNavigationItem(m, i)),
    [schema.menu],
  );
  const flatNavigation = schema.navigation ?? legacyNavigation;

  // --- Area management ---
  //
  // Area visibility is DERIVED from the items inside (objectui#3311): an area
  // is visible iff at least one of its navigation items survives the same
  // item-level guards `NavigationRenderer` applies (`visible`,
  // `requiredPermissions`, runtime capabilities, action-dispatcher presence).
  // Spec 17.0.0 retired the authorable area-level keys; this derivation
  // restores the "fully gated area disappears" UX without any authorable key.
  // The active area is elected among the VISIBLE areas only, so the user is
  // never landed in — or stranded on — an area that renders nothing.
  //
  // The mobile tab bar reads this same object (objectui#11362), built from the
  // arguments `InternalSidebar` hands `NavigationRenderer`, so the area list,
  // the sidebar and the bar judge an entry by the same inputs.
  const navGuards: NavigationVisibilityOptions = {
    evaluateVisibility: evalVis,
    checkPermission: checkPerm,
    checkCapability: checkCap,
    checkDocTarget,
    hasActionHandler: !!onAction,
  };
  const areas = schema.areas ?? [];
  const visibleAreas = areas.filter((area) =>
    hasVisibleNavigationItems(area.navigation, navGuards),
  );
  const [activeAreaId, setActiveAreaId] = useState<string | null>(
    () => visibleAreas.length > 0 ? visibleAreas[0].id : null,
  );

  const visibleAreaIds = visibleAreas.map((a) => a.id).join(',');

  useEffect(() => {
    if (visibleAreas.length > 0) {
      setActiveAreaId((prev) =>
        visibleAreas.some((a) => a.id === prev) ? prev : visibleAreas[0].id,
      );
    } else {
      setActiveAreaId(null);
    }
  }, [schema.name, visibleAreaIds]);

  // Resolve the EFFECTIVE active area at render time rather than trusting the
  // state: when a gating change hides the currently active area, the effect
  // above re-elects on the next tick — this fallback keeps the in-between
  // frame from rendering the hidden area's (empty) navigation.
  const activeArea =
    visibleAreas.find((a) => a.id === activeAreaId) ?? visibleAreas[0];
  const resolvedNavigation: NavigationItem[] = activeArea?.navigation ?? flatNavigation;

  // --- Branding ---
  // The favicon is `branding.favicon` (objectui#10842), the one spelling
  // `@objectstack/spec` declares and the one the console already reads.
  const branding: AppShellBranding = {
    title: schema.title,
    favicon: schema.branding?.favicon,
  };

  // --- Build sidebar element ---
  const sidebarElement = (
    <InternalSidebar
      schema={schema}
      basePath={basePath}
      evalVis={evalVis}
      checkPerm={checkPerm}
      checkCap={checkCap}
      checkDocTarget={checkDocTarget}
      onAction={onAction}
      sidebarHeader={sidebarHeader}
      sidebarFooter={sidebarFooter}
      sidebarExtra={sidebarExtra}
      visibleAreas={visibleAreas}
      activeAreaId={activeArea?.id ?? null}
      setActiveAreaId={setActiveAreaId}
      resolvedNavigation={resolvedNavigation}
      enableSearch={enableSearch}
      enablePinning={enablePinning}
      onPinToggle={onPinToggle}
    />
  );

  // --- Mobile bottom nav (shown alongside drawer sidebar on mobile) ---
  const showBottomNav = mobileNavMode === 'bottom_nav';

  return (
    <>
      <AppShell
        sidebar={sidebarElement}
        navbar={navbar}
        className={className}
        defaultOpen={defaultOpen}
        branding={branding}
      >
        {children}
      </AppShell>
      {showBottomNav && (
        <MobileBottomNav
          items={resolvedNavigation}
          basePath={basePath}
          guards={navGuards}
          onAction={onAction}
        />
      )}
    </>
  );
}
