// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio's left menu, as data (objectstack ADR-0084, amended 2026-11-24;
 * #36899): which groups it draws, the entries under each, where each entry
 * goes, and which entry the open page is. Pure, so the rules are pinned
 * without a render; `StudioMenu.tsx` draws it.
 *
 * ## Groups
 *
 * Six, one per domain the spec registers a metadata type under, in the
 * amendment's order. A type's group is its served registry `domain`; the
 * group's name is the shared domain dictionary's (`studioMenuGroupLabel`), which
 * draws `system` as Platform and `security` as Access (decision 11), the same
 * names as the directory's headings and chips and a type page's badge.
 *
 * ## Entries
 *
 * A type entry for each type the package's directory lists (the same rule,
 * `scopeDirectoryEntries`), plus every 常用 Common type
 * ({@link STUDIO_MENU_ALWAYS_TYPES}), so a package that holds no app, page,
 * dashboard, report, flow, permission set or agent still shows where the
 * first is made. Each opens the type's list in the "All metadata" area,
 * where an object, a flow and a permission set open their designers
 * full-screen (objectstack#36903-36905; objectstack#36909 retired the last of
 * the pillar redirects).
 *
 * And four entries that open no type's list, each in the group of what it
 * holds (the amendment's "Entries that are not a type"):
 *  - the organization's own flows (`~org`), under Automation;
 *  - the organization-wide default sharing overview, under Access, on its own
 *    route (`/studio/<package>/owd`, objectstack#36905);
 *  - diagnostics, under Platform;
 *  - the cross-package environment catalog (`~all`), under Access.
 *
 * And on a package one entry under no group, 全部类型 All types
 * ({@link studioMenuAllTypesEntry}; ADR-0084, amended 2026-11-25,
 * objectstack#37360): the 高级 fold's last row, below its groups. It opens the
 * area's type directory, which lists every type of the six groups, the ones
 * the package holds no item of yet included, so the first item of a 高级 type
 * the fold does not draw has a door on screen. It is not part of
 * {@link buildStudioMenu}'s groups: the fold's rule — a 高级 type is drawn when
 * the package holds one — does not change.
 *
 * ## Order and tier (ADR-0084, amended 2026-11-25; objectstack#37201)
 *
 * Inside a group the type entries follow the placement table
 * (`STUDIO_MENU_PLACEMENT`, `studioMenuPlacement.ts`), and each entry carries
 * its row's tier. A type with no row is 高级 Advanced and is drawn after the
 * placed types of its group, in served order. The four entries that are not a
 * type are 高级 and follow the types of their group, in the order above.
 *
 * A 常用 entry the diagnostics sweep has answered for, holding no item, is
 * `empty`: drawn dimmed, with no number, and still a link. Before the sweep
 * answers (`settled`), nothing is empty: "not counted yet" is not "none".
 *
 * ## 概览 Overview (ADR-0084, amended 2026-11-26; objectstack#37454)
 *
 * On a package, one more entry that opens no type's list and sits under no
 * group and in no tier: 概览 Overview, the package's own page, the menu's
 * first row, above the groups ({@link studioMenuOverviewEntry}). It carries
 * the open package's pending-draft count as a badge, drawn only while
 * something is pending; the badge leads to the overview's Pending tab. It is
 * not part of {@link buildStudioMenu}'s groups.
 *
 * ## Scopes
 *
 * On a package, a group is drawn in a tier only where it holds an entry of
 * that tier: the 常用 groups first, then one 高级 fold (`StudioMenu.tsx`).
 * The package-less scope (`~org`) and the cross-package leg (`~all`) name no
 * package: their menu is the environment's — the organization's flows and the
 * environment catalog's types — drawn flat, in the same order, with no fold;
 * only the groups that hold an entry are drawn.
 */

import { ENVIRONMENT_SCOPE_QUERY } from '../metadata-admin/catalog-scope.js';
import { SETUP_DATASOURCES_PATH } from '../metadata-admin/metadataAreaHost.js';
import { isStudioAllPackagesScope } from './metadataArea.js';
import {
  STUDIO_ALL_PACKAGES_SEGMENT,
  STUDIO_OVERVIEW_SECTION,
  STUDIO_OWD_SECTION,
  studioMetadataAreaAddress,
  studioMetadataAreaRoot,
  studioOwdOverviewPath,
  studioPackagePath,
} from './studioAddress.js';
import { studioPackageOverviewPath } from './studioOverviewAddress.js';
import { isStudioOrgScope, studioOrgScopePath } from './studioScope.js';
import { STUDIO_MENU_PLACEMENT, type StudioMenuTier } from './studioMenuPlacement.js';

export type { StudioMenuTier } from './studioMenuPlacement.js';

/** The menu's collapse state, kept apart from the app sidebar's `sidebar_state`. */
export const STUDIO_MENU_COOKIE = 'studio_menu_state';

/**
 * The 高级 Advanced fold's open state, per browser (objectstack#37201). Its own
 * cookie: opening the fold never touches the menu's collapse state.
 */
export const STUDIO_MENU_ADVANCED_COOKIE = 'studio_menu_advanced';

/**
 * The fold's remembered state from a cookie jar (`document.cookie`): `true`
 * or `false` as the menu writes it, else `false` — closed by default. Only
 * the two literals the menu writes are read; any other value is no
 * preference.
 */
export function readStudioMenuAdvancedCookie(jar: string): boolean {
  for (const part of jar.split(';')) {
    const at = part.indexOf('=');
    if (at === -1 || part.slice(0, at).trim() !== STUDIO_MENU_ADVANCED_COOKIE) continue;
    return part.slice(at + 1).trim() === 'true';
  }
  return false;
}

/** The six groups, in the amendment's order: each is a registered `domain`. */
export const STUDIO_MENU_GROUPS = ['data', 'ui', 'automation', 'system', 'security', 'ai'] as const;
export type StudioMenuGroup = (typeof STUDIO_MENU_GROUPS)[number];

/**
 * The types a package's menu always lists, holding one or not: the 常用 Common
 * types of the placement table, in its order (ADR-0084, amended 2026-11-25).
 * Read off the table, so a type moved between the tiers there moves here.
 */
export const STUDIO_MENU_ALWAYS_TYPES: readonly string[] = Object.freeze(
  STUDIO_MENU_PLACEMENT.filter((row) => row.tier === 'common').map((row) => row.type),
);

export type StudioMenuEntryKind = 'type' | 'orgFlows' | 'owd' | 'diagnostics' | 'environment' | 'allTypes';

export interface StudioMenuEntry {
  /** Unique within the menu: `type:<type>` for a type, the kind otherwise. */
  key: string;
  kind: StudioMenuEntryKind;
  /** The metadata type a `type` entry lists. */
  type?: string;
  to: string;
  /** A `type` entry's served item count; absent when the sweep did not say. */
  count?: number;
  /** 常用 Common or 高级 Advanced: the placement table's row, else Advanced. */
  tier: StudioMenuTier;
  /**
   * A 常用 type the settled sweep counts no item of, on a package: drawn
   * dimmed, with no number, and still a link (where the first is made).
   */
  empty?: boolean;
}

export interface StudioMenuGroupModel {
  group: StudioMenuGroup;
  entries: StudioMenuEntry[];
}

/** Which scope the menu is drawn for, from the `/studio/:segment` route segment. */
export type StudioMenuScope = { kind: 'package'; packageId: string } | { kind: 'org' } | { kind: 'all' };

export function studioMenuScope(segment: string): StudioMenuScope {
  if (isStudioOrgScope(segment)) return { kind: 'org' };
  if (isStudioAllPackagesScope(segment)) return { kind: 'all' };
  return { kind: 'package', packageId: segment };
}

function typeEntryPath(scope: StudioMenuScope, type: string): string {
  if (scope.kind !== 'package') {
    return studioMetadataAreaAddress(STUDIO_ALL_PACKAGES_SEGMENT, encodeURIComponent(type), { query: ENVIRONMENT_SCOPE_QUERY });
  }
  // ADR-0146 D1 — a datasource is Setup's runtime configuration, as its directory tile says.
  if (type === 'datasource') return SETUP_DATASOURCES_PATH;
  return studioMetadataAreaAddress(scope.packageId, encodeURIComponent(type), {
    query: `package=${encodeURIComponent(scope.packageId)}`,
  });
}

/** Each placed type's row index: its order inside its group. */
const PLACEMENT_INDEX: ReadonlyMap<string, number> = new Map(STUDIO_MENU_PLACEMENT.map((row, i) => [row.type, i]));
const PLACEMENT_TIER: ReadonlyMap<string, StudioMenuTier> = new Map(STUDIO_MENU_PLACEMENT.map((row) => [row.type, row.tier]));

/**
 * The menu's groups and entries. `types` are the served type entries the
 * directory rule already scoped to this menu (`scopeDirectoryEntries`); a type
 * whose domain is none of the six is not drawn. Inside a group the types
 * follow the placement table, an unplaced type after the placed ones in
 * served order, then the entries that are not a type. `settled` says the
 * diagnostics sweep has answered, so a missing count means none.
 */
export function buildStudioMenu(input: {
  scope: StudioMenuScope;
  types: ReadonlyArray<{ type: string; domain?: string }>;
  counts: Readonly<Record<string, number>>;
  settled?: boolean;
}): StudioMenuGroupModel[] {
  const { scope, types, counts, settled = false } = input;
  const groups = new Map<StudioMenuGroup, StudioMenuEntry[]>(STUDIO_MENU_GROUPS.map((g) => [g, []]));
  // An unplaced type ranks after every row; the sort is stable, so those keep served order.
  const rank = (type: string) => PLACEMENT_INDEX.get(type) ?? STUDIO_MENU_PLACEMENT.length;
  const placed = [...types].sort((a, b) => rank(a.type) - rank(b.type));
  for (const t of placed) {
    const entries = groups.get(t.domain as StudioMenuGroup);
    if (!entries) continue;
    const tier = PLACEMENT_TIER.get(t.type) ?? 'advanced';
    const count = counts[t.type];
    const entry: StudioMenuEntry = { key: `type:${t.type}`, kind: 'type', type: t.type, to: typeEntryPath(scope, t.type), count, tier };
    if (scope.kind === 'package' && tier === 'common' && settled && !((count ?? 0) > 0)) entry.empty = true;
    entries.push(entry);
  }
  groups.get('automation')!.push({ key: 'orgFlows', kind: 'orgFlows', to: studioOrgScopePath(), tier: 'advanced' });
  if (scope.kind === 'package') {
    groups.get('system')!.push({
      key: 'diagnostics',
      kind: 'diagnostics',
      to: studioMetadataAreaAddress(scope.packageId, '_diagnostics'),
      tier: 'advanced',
    });
    groups.get('security')!.push({
      key: 'owd',
      kind: 'owd',
      to: studioOwdOverviewPath(scope.packageId),
      tier: 'advanced',
    });
  }
  groups.get('security')!.push({
    key: 'environment',
    kind: 'environment',
    to: studioMetadataAreaRoot(STUDIO_ALL_PACKAGES_SEGMENT),
    tier: 'advanced',
  });
  return STUDIO_MENU_GROUPS.map((group) => ({ group, entries: groups.get(group)! })).filter((g) => g.entries.length > 0);
}

/**
 * The 高级 fold's last row on a package, 全部类型 All types, which sits under no
 * group (objectstack#37360): it opens the area's type directory. `null` on
 * `~org` and `~all`, which draw no fold.
 */
export function studioMenuAllTypesEntry(scope: StudioMenuScope): StudioMenuEntry | null {
  if (scope.kind !== 'package') return null;
  return { key: 'allTypes', kind: 'allTypes', to: studioMetadataAreaRoot(scope.packageId), tier: 'advanced' };
}

/** The key of 概览 Overview's row, and what {@link studioMenuCurrentKey} answers on its page. */
export const STUDIO_MENU_OVERVIEW_KEY = 'overview';

/**
 * 概览 Overview's row (objectstack#37454): the package's own page, above the
 * groups. Not a {@link StudioMenuEntry}: it lists no type, belongs to no group
 * and no tier, and its number is not an item count.
 */
export interface StudioMenuOverviewEntry {
  key: typeof STUDIO_MENU_OVERVIEW_KEY;
  /** The overview, on its Info tab. */
  to: string;
  /**
   * The open package's pending drafts, drawn as the row's badge; absent while
   * nothing is pending, and while the count is not known yet.
   */
  pending?: number;
  /** Where the badge leads: the overview's Pending tab. */
  pendingTo: string;
}

/**
 * 概览 Overview's row on a package, or `null` on `~org` and `~all`, which name
 * no package (ADR-0084, amended 2026-11-26). `pending` is the open package's
 * pending-draft count as the surface reads it (`null` while unknown): the badge
 * is drawn only while it is above zero.
 */
export function studioMenuOverviewEntry(scope: StudioMenuScope, pending: number | null | undefined): StudioMenuOverviewEntry | null {
  if (scope.kind !== 'package') return null;
  const entry: StudioMenuOverviewEntry = {
    key: STUDIO_MENU_OVERVIEW_KEY,
    to: studioPackageOverviewPath(scope.packageId),
    pendingTo: studioPackageOverviewPath(scope.packageId, { tab: 'pending' }),
  };
  if (typeof pending === 'number' && pending > 0) entry.pending = pending;
  return entry;
}

/**
 * The menu split into its two tiers on a package: the 常用 groups and the
 * 高级 fold's groups, each holding only that tier's entries, and a group only
 * where it holds one (ADR-0084, amended 2026-11-25, §3.3).
 */
export function studioMenuTiers(menu: readonly StudioMenuGroupModel[]): Record<StudioMenuTier, StudioMenuGroupModel[]> {
  const of = (tier: StudioMenuTier) =>
    menu
      .map(({ group, entries }) => ({ group, entries: entries.filter((e) => e.tier === tier) }))
      .filter((g) => g.entries.length > 0);
  return { common: of('common'), advanced: of('advanced') };
}

/**
 * The entry the open page is (`aria-current`), or `null` when it is none of
 * them (a not-found pillar).
 *
 *  - the package-less scope: its flows;
 *  - an area URL: its type, diagnostics, or at the area's root the type
 *    directory — 全部类型 All types on a package (objectstack#37360), the
 *    environment catalog on the cross-package leg;
 *  - the sharing overview's route: the OWD overview;
 *  - the package's own page: 概览 Overview (objectstack#37454);
 *  - a retired pillar's address: none, since it draws no page
 *    (objectstack#36909: it redirects, `studioPillarRedirectModel.ts`).
 */
export function studioMenuCurrentKey(input: { segment: string; pathname: string; search: string }): string | null {
  const { segment, pathname } = input;
  if (isStudioOrgScope(segment)) return 'orgFlows';
  const areaRoot = studioMetadataAreaRoot(segment);
  if (pathname === areaRoot || pathname.startsWith(`${areaRoot}/`)) {
    const [first] = pathname.slice(areaRoot.length).split('/').filter(Boolean);
    if (!first) return isStudioAllPackagesScope(segment) ? 'environment' : 'allTypes';
    if (first === '_diagnostics') return isStudioAllPackagesScope(segment) ? null : 'diagnostics';
    return `type:${decodeURIComponent(first)}`;
  }
  const prefix = `${studioPackagePath(segment)}/`;
  const raw = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
  const section = raw.split('/')[0];
  if (section === STUDIO_OWD_SECTION) return 'owd';
  return section === STUDIO_OVERVIEW_SECTION ? STUDIO_MENU_OVERVIEW_KEY : null;
}

/** Whether `entry` matches a menu search, by its label or its type's machine name. */
export function studioMenuEntryMatches(entry: StudioMenuEntry, label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q) || (entry.type ?? '').toLowerCase().includes(q);
}

/** Whether 概览 Overview's row, which lists no type, matches a menu search: by its label alone. */
export function studioMenuOverviewMatches(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || label.toLowerCase().includes(q);
}
