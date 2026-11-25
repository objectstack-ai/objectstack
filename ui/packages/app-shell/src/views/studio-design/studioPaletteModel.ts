// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The command palette on a Studio design page, as data (objectstack#36900;
 * decision 7 of the Studio redesign epic #36890: an author switches items by
 * × back to the list, by ‹ ›, or by ⌘K). Pure, so the rules are pinned without
 * a render; `StudioPaletteGroups.tsx` draws it inside the palette.
 *
 * ## What it lists
 *
 * The left menu's groups, in the menu's order (`buildStudioMenu`, decision
 * 11), each holding:
 *  - the menu's own entries of that group — a type's list, the organization's
 *    flows, the default sharing overview, diagnostics, the environment
 *    catalog — each opening where the menu entry opens;
 *  - on a package, the items of every type the group lists, read from the
 *    package and its `.custom` pair together (ADR-0146 D3, "on top, one
 *    surface"), as the type's list shows them.
 *
 * ## Where an item opens
 *
 * Through the one Studio address builder (`studioAddress.ts`, #36895), never a
 * hand-built path: every type opens its page in the "All metadata" area with
 * the owning package on `?package=`, the address the type's list links the row
 * to (ADR-0048), where an object, a flow and a permission set open their
 * designers full-screen.
 */

import { customizationPackageId } from '@objectstack/spec/kernel';
import { COMMAND_PALETTE_PARAM } from '../../urlParams.js';
import { confirmUnsavedLeave } from '../../chrome/unsavedEdits.js';
import { scopeListRows } from '../metadata-admin/metadataListState.js';
import { studioMetadataItemAddress } from './studioAddress.js';
import type { StudioMenuEntry, StudioMenuGroup, StudioMenuGroupModel } from './studioMenuModel.js';

/** One item a package's palette lists. */
export interface StudioPaletteItem {
  type: string;
  /** Its primary key: the name its list links it by. */
  name: string;
  /** The label as served: a string, or an i18n-keyed label the palette resolves. */
  label: unknown;
  /** The package that owns it: the open package, or its `.custom` pair. */
  packageId: string;
}

/** One group of the palette: the menu's entries of the group, then its items. */
export interface StudioPaletteGroup {
  group: StudioMenuGroup;
  entries: StudioMenuEntry[];
  items: StudioPaletteItem[];
}

/**
 * The types a package's palette reads no item of: a datasource is Setup's
 * runtime configuration (ADR-0146 D1), so the menu's entry for it already
 * leaves Studio and its items have no Studio page.
 */
export const STUDIO_PALETTE_ITEMLESS_TYPES: ReadonlySet<string> = new Set(['datasource']);

/** A package's `.custom` pair, whose items its palette also lists, or `null` when it has none. */
export function studioPalettePairId(packageId: string): string | null {
  const pair = customizationPackageId(packageId);
  return pair.ok ? pair.value : null;
}

/**
 * The items of one type a package's palette lists, from that type's served
 * list read: the rows the type's list page holds for the package
 * (`scopeListRows`, the page's own rule: the package and its pair, through the
 * type's list predicate), each named by the type's primary key, as the list
 * page names its rows. A row with no name is not listed; one name a package
 * serves twice (two members of a bundle) is listed once, as ‹ › step through
 * it.
 */
export function studioPaletteItemsOf(
  type: string,
  served: readonly unknown[],
  options: {
    packageId: string;
    pairId: string | null;
    primaryKey?: string;
    listFilter?: (item: Record<string, unknown>) => boolean;
  },
): StudioPaletteItem[] {
  const key = options.primaryKey ?? 'name';
  // A row may come wrapped as `{ item }`, as the list page unwraps it.
  const rows = served.flatMap((raw) => {
    const item = raw && typeof raw === 'object' && 'item' in raw ? (raw as { item: unknown }).item : raw;
    return item && typeof item === 'object' ? [{ item: item as Record<string, unknown> }] : [];
  });
  const scoped = scopeListRows(rows, {
    listFilter: options.listFilter,
    unscoped: false,
    activePackage: options.packageId,
    pairId: options.pairId,
  });
  const seen = new Set<string>();
  const items: StudioPaletteItem[] = [];
  for (const { item } of scoped) {
    const packageId = item._packageId as string;
    const name = item[key];
    if (typeof name !== 'string' || name === '') continue;
    // A package id never holds `|`, so the pair is one key.
    const id = `${packageId}|${name}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ type, name, label: item.label, packageId });
  }
  return items;
}

/**
 * Where an item the palette lists opens, from the `/studio/:segment` it was
 * listed on: its page in the area, scoped to the package that owns it.
 */
export function studioPaletteItemAddress(segment: string, item: Pick<StudioPaletteItem, 'type' | 'name' | 'packageId'>): string {
  return studioMetadataItemAddress(segment, item.type, item.name, {
    query: `package=${encodeURIComponent(item.packageId)}`,
  });
}

/**
 * The palette's groups: the menu's groups in its order, each with the items
 * of the types it lists. An item whose type has no entry in the menu is not
 * listed: the palette lists what the menu does, and nothing beside it.
 */
export function buildStudioPaletteGroups(
  menu: readonly StudioMenuGroupModel[],
  items: readonly StudioPaletteItem[],
): StudioPaletteGroup[] {
  const groupOfType = new Map<string, StudioMenuGroup>();
  for (const { group, entries } of menu) {
    for (const entry of entries) if (entry.kind === 'type' && entry.type) groupOfType.set(entry.type, group);
  }
  const itemsOf = new Map<StudioMenuGroup, StudioPaletteItem[]>(menu.map(({ group }) => [group, []]));
  for (const item of items) {
    const group = groupOfType.get(item.type);
    if (group) itemsOf.get(group)!.push(item);
  }
  return menu.map(({ group, entries }) => ({ group, entries, items: itemsOf.get(group)! }));
}

/**
 * The palette overlay's own query keys: `CommandPaletteProvider` opens it on
 * `?palette=` and reads the alias `?cmdk=`. Neither is part of a page's query.
 */
const PALETTE_QUERY_KEYS: readonly string[] = [COMMAND_PALETTE_PARAM, 'cmdk'];

function pageQuery(query: string): string {
  const params = new URLSearchParams(query);
  for (const key of PALETTE_QUERY_KEYS) params.delete(key);
  params.sort();
  return params.toString();
}

/**
 * What opening `to` from the palette does on the page at `pathname` +
 * `search` (`search` with its `?`), the way the left menu's entries leave:
 *  - `'leave'`: another page; the surface asks about unsaved work, then goes;
 *  - `'reenter'`: the page already open on another query (the Access pillar
 *    on the default sharing overview); a pillar reads its deep link once, at
 *    mount, so the surface asks, then remounts it on the new query;
 *  - `'stay'`: the page already shown, the palette's own keys aside; nothing
 *    to open, nothing to ask.
 */
export function studioPaletteDeparture(
  to: string,
  at: { pathname: string; search: string },
): 'leave' | 'reenter' | 'stay' {
  const cut = to.indexOf('?');
  const path = cut < 0 ? to : to.slice(0, cut);
  if (path !== at.pathname) return 'leave';
  return pageQuery(cut < 0 ? '' : to.slice(cut + 1)) === pageQuery(at.search) ? 'stay' : 'reenter';
}

/** Whether two searches (`?` optional) name the same page, the palette's own keys and the order aside. */
export function studioSamePageSearch(a: string, b: string): boolean {
  return pageQuery(a) === pageQuery(b);
}

/**
 * Opens `to`, picked in the palette on the page at `at`, the way a menu entry
 * leaves (decision 12 of the Studio redesign): another page asks the shell's
 * unsaved-edits seam first (`confirmUnsavedLeave`: the open page's own edits
 * and every editor below it that registered, the "All metadata" item page
 * among them), then goes; the page already open on another query asks through
 * the host's `reenter` (which remounts the page once the router shows that
 * query), then goes; the page already shown stays.
 */
export function openStudioPaletteAddress(
  to: string,
  at: { pathname: string; search: string },
  act: { navigate: (to: string) => void; reenter: (search: string) => boolean },
): void {
  const departure = studioPaletteDeparture(to, at);
  if (departure === 'stay') return;
  if (departure === 'leave') {
    confirmUnsavedLeave(() => act.navigate(to));
    return;
  }
  const cut = to.indexOf('?');
  if (act.reenter(cut < 0 ? '' : to.slice(cut))) act.navigate(to);
}
