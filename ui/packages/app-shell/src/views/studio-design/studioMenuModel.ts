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
 * group's name is the menu's own (`studioMenuGroupLabel`), which draws
 * `system` as Platform and `security` as Access (decision 11) while the shared
 * dictionary keeps System and Security.
 *
 * ## Entries
 *
 * A type entry for each type the package's directory lists (the same rule,
 * `scopeDirectoryEntries`), plus the types a designer creates in
 * ({@link STUDIO_MENU_DESIGNER_TYPES}), so a package without an object, a flow
 * or a permission set can still make its first. Each opens the type's list in
 * the "All metadata" area; an item opened there that a pillar designs still
 * opens its pillar until the pillars become full-screen pages
 * (`areaItemPillarPath`).
 *
 * And four entries that open no type's list, each in the group of what it
 * holds (the amendment's "Entries that are not a type"):
 *  - the organization's own flows (`~org`), under Automation;
 *  - the organization-wide default sharing overview, under Access (today the
 *    Access pillar's `?surface=owd:overview`; its own route is a later card's);
 *  - diagnostics, under Platform;
 *  - the cross-package environment catalog (`~all`), under Access.
 *
 * ## Scopes
 *
 * On a package, all six groups are drawn, an empty one included, so the menu
 * reads the same on every package. The package-less scope (`~org`) and the
 * cross-package leg (`~all`) name no package: their menu is the environment's
 * — the organization's flows and the environment catalog's types — and only
 * the groups that hold an entry are drawn.
 */

import { ENVIRONMENT_SCOPE_QUERY } from '../metadata-admin/catalog-scope.js';
import { SETUP_DATASOURCES_PATH } from '../metadata-admin/metadataAreaHost.js';
import { DESIGNER_SURFACE_PARAM } from '../metadata-admin/nav-selection.js';
import { AREA_PILLAR_FOR_TYPE, isStudioAllPackagesScope } from './metadataArea.js';
import {
  STUDIO_ALL_PACKAGES_SEGMENT,
  STUDIO_METADATA_AREA,
  studioMetadataAreaAddress,
  studioMetadataAreaRoot,
  studioPackagePath,
  studioPillarItemAddress,
} from './studioAddress.js';
import { isStudioOrgScope, studioOrgScopePath } from './studioScope.js';

/** The menu's collapse state, kept apart from the app sidebar's `sidebar_state`. */
export const STUDIO_MENU_COOKIE = 'studio_menu_state';

/** The six groups, in the amendment's order: each is a registered `domain`. */
export const STUDIO_MENU_GROUPS = ['data', 'ui', 'automation', 'system', 'security', 'ai'] as const;
export type StudioMenuGroup = (typeof STUDIO_MENU_GROUPS)[number];

/**
 * The types a designer creates in: listed on every package, holding one or not.
 * objectstack#36904 — the object's designer is on its metadata address, no
 * longer a pillar's, and it is still listed first.
 */
export const STUDIO_MENU_DESIGNER_TYPES: readonly string[] = ['object', ...Object.keys(AREA_PILLAR_FOR_TYPE)];

/** The OWD overview's address on the Access pillar (`AccessPillar`'s deep link). */
const OWD_OVERVIEW_SURFACE = { type: 'owd', name: 'overview' } as const;

export type StudioMenuEntryKind = 'type' | 'orgFlows' | 'owd' | 'diagnostics' | 'environment';

export interface StudioMenuEntry {
  /** Unique within the menu: `type:<type>` for a type, the kind otherwise. */
  key: string;
  kind: StudioMenuEntryKind;
  /** The metadata type a `type` entry lists. */
  type?: string;
  to: string;
  /** A `type` entry's served item count; absent when the sweep did not say. */
  count?: number;
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

/**
 * The menu's groups and entries. `types` are the served type entries the
 * directory rule already scoped to this menu (`scopeDirectoryEntries`), in
 * served order; a type whose domain is none of the six is not drawn.
 */
export function buildStudioMenu(input: {
  scope: StudioMenuScope;
  types: ReadonlyArray<{ type: string; domain?: string }>;
  counts: Readonly<Record<string, number>>;
}): StudioMenuGroupModel[] {
  const { scope, types, counts } = input;
  const groups = new Map<StudioMenuGroup, StudioMenuEntry[]>(STUDIO_MENU_GROUPS.map((g) => [g, []]));
  for (const t of types) {
    const entries = groups.get(t.domain as StudioMenuGroup);
    if (!entries) continue;
    entries.push({ key: `type:${t.type}`, kind: 'type', type: t.type, to: typeEntryPath(scope, t.type), count: counts[t.type] });
  }
  groups.get('automation')!.push({ key: 'orgFlows', kind: 'orgFlows', to: studioOrgScopePath() });
  if (scope.kind === 'package') {
    groups.get('system')!.push({
      key: 'diagnostics',
      kind: 'diagnostics',
      to: studioMetadataAreaAddress(scope.packageId, '_diagnostics'),
    });
    groups.get('security')!.push({
      key: 'owd',
      kind: 'owd',
      to: studioPillarItemAddress(scope.packageId, 'access', OWD_OVERVIEW_SURFACE),
    });
  }
  groups.get('security')!.push({
    key: 'environment',
    kind: 'environment',
    to: studioMetadataAreaRoot(STUDIO_ALL_PACKAGES_SEGMENT),
  });
  return STUDIO_MENU_GROUPS.map((group) => ({ group, entries: groups.get(group)! })).filter(
    (g) => scope.kind === 'package' || g.entries.length > 0,
  );
}

/** The entry keys of the type each pillar designs (the transition's pillar pages). */
const PILLAR_TYPE: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(AREA_PILLAR_FOR_TYPE).map(([type, pillar]) => [pillar, type]),
);

/**
 * The entry the open page is (`aria-current`), or `null` when it is none of
 * them (the area's type directory, a not-found pillar).
 *
 *  - the package-less scope: its flows;
 *  - an area URL: its type, diagnostics, or on the cross-package leg's root
 *    the environment catalog;
 *  - a pillar page: the type the pillar designs — the OWD overview on the
 *    Access pillar while its `?surface=` names it.
 */
export function studioMenuCurrentKey(input: { segment: string; pathname: string; search: string }): string | null {
  const { segment, pathname } = input;
  if (isStudioOrgScope(segment)) return 'orgFlows';
  const search = new URLSearchParams(input.search);
  const areaRoot = studioMetadataAreaRoot(segment);
  if (pathname === areaRoot || pathname.startsWith(`${areaRoot}/`)) {
    const [first] = pathname.slice(areaRoot.length).split('/').filter(Boolean);
    if (!first) return isStudioAllPackagesScope(segment) ? 'environment' : null;
    if (first === '_diagnostics') return isStudioAllPackagesScope(segment) ? null : 'diagnostics';
    return `type:${decodeURIComponent(first)}`;
  }
  const prefix = `${studioPackagePath(segment)}/`;
  const raw = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : '';
  const pillar = raw.split('/')[0];
  if (pillar === STUDIO_METADATA_AREA) return null;
  if (pillar === 'access' && (search.get(DESIGNER_SURFACE_PARAM) ?? '').startsWith(`${OWD_OVERVIEW_SURFACE.type}:`)) {
    return 'owd';
  }
  const type = PILLAR_TYPE[pillar];
  return type ? `type:${type}` : null;
}

/** Whether `entry` matches a menu search, by its label or its type's machine name. */
export function studioMenuEntryMatches(entry: StudioMenuEntry, label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return label.toLowerCase().includes(q) || (entry.type ?? '').toLowerCase().includes(q);
}
