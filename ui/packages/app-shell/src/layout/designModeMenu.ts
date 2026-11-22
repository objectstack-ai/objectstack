// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The app's menu under the design mode (objectstack#36363): the edits the
 * sidebar's menu editor (`DesignModeMenu.tsx`) makes to the app's
 * `navigation`, as pure functions of the tree. Every function answers a new
 * tree and leaves the one it was given untouched, so a staged menu is never
 * changed in place.
 *
 * An entry is addressed by its `id`. The served tree may hold an entry
 * without one (the spec makes it optional): {@link withEntryIds} gives each
 * such entry an id by its place before the first edit, so an edit never
 * addresses an entry by a place that a previous edit moved.
 *
 * A group is an entry of `type: 'group'` holding `children`. Groups are not
 * added, removed or renamed here (out of the card); entries move within a
 * group, between groups and to the menu's top level.
 *
 * @module
 */

/** One menu entry, as the app document holds it. */
export type MenuEntry = Readonly<Record<string, unknown>> & { readonly id?: unknown; readonly type?: unknown };

/** A menu: the app's `navigation`. */
export type Menu = ReadonlyArray<MenuEntry>;

/** Where an entry sits: the group holding it (`null` for the top level) and its index there. */
export interface MenuPlace {
  readonly parentId: string | null;
  readonly index: number;
}

/** The kinds of existing thing the picker adds (objectstack#36363 item 2). */
export const MENU_TARGET_KINDS = ['object', 'view', 'dashboard', 'report', 'page', 'url'] as const;
export type MenuTargetKind = (typeof MENU_TARGET_KINDS)[number];

export function isGroup(entry: MenuEntry): boolean {
  return entry.type === 'group';
}

function childrenOf(entry: MenuEntry): Menu {
  return Array.isArray(entry.children) ? (entry.children as Menu) : [];
}

function idOf(entry: MenuEntry): string | null {
  return typeof entry.id === 'string' && entry.id ? entry.id : null;
}

/**
 * The tree with an id on every entry: an entry without one gets
 * `nav_item_<n>`, the first `n` from 1 that no entry of the tree holds. The
 * answer is the tree given when every entry already has an id.
 */
export function withEntryIds(menu: Menu): Menu {
  const taken = new Set<string>();
  const collect = (entries: Menu) => {
    for (const entry of entries) {
      const id = idOf(entry);
      if (id) taken.add(id);
      collect(childrenOf(entry));
    }
  };
  collect(menu);
  let next = 1;
  let changed = false;
  const fresh = () => {
    while (taken.has(`nav_item_${next}`)) next += 1;
    const id = `nav_item_${next}`;
    taken.add(id);
    return id;
  };
  const walk = (entries: Menu): Menu => {
    const next = entries.map((entry) => {
      const kids = Array.isArray(entry.children) ? walk(entry.children as Menu) : null;
      const id = idOf(entry);
      if (id && (kids === null || kids === entry.children)) return entry;
      changed = true;
      return { ...entry, ...(id ? {} : { id: fresh() }), ...(kids ? { children: kids } : {}) };
    });
    return next.every((entry, i) => entry === entries[i]) ? entries : next;
  };
  const answer = walk(menu);
  return changed ? answer : menu;
}

/** A new entry id no entry of `menu` holds. */
export function newEntryId(menu: Menu, stem = 'nav_item'): string {
  const taken = new Set<string>();
  const collect = (entries: Menu) => {
    for (const entry of entries) {
      const id = idOf(entry);
      if (id) taken.add(id);
      collect(childrenOf(entry));
    }
  };
  collect(menu);
  let n = 1;
  while (taken.has(`${stem}_${n}`)) n += 1;
  return `${stem}_${n}`;
}

/** Where the entry `id` sits, or `null` when no entry has it. */
export function placeOf(menu: Menu, id: string): MenuPlace | null {
  const walk = (entries: Menu, parentId: string | null): MenuPlace | null => {
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (idOf(entry) === id) return { parentId, index: i };
      if (isGroup(entry)) {
        const found = walk(childrenOf(entry), idOf(entry));
        if (found) return found;
      }
    }
    return null;
  };
  return walk(menu, null);
}

/** The entry `id`, or `null`. */
export function entryOf(menu: Menu, id: string): MenuEntry | null {
  const place = placeOf(menu, id);
  return place ? siblingsAt(menu, place.parentId)?.[place.index] ?? null : null;
}

/** The entries of the group `parentId` (the top level for `null`), or `null` when there is no such group. */
export function siblingsAt(menu: Menu, parentId: string | null): Menu | null {
  if (parentId === null) return menu;
  const group = entryOf(menu, parentId);
  return group && isGroup(group) ? childrenOf(group) : null;
}

/** `menu` with the entries of the group `parentId` (the top level for `null`) replaced. */
function withSiblings(menu: Menu, parentId: string | null, entries: Menu): Menu {
  if (parentId === null) return entries;
  const walk = (list: Menu): Menu =>
    list.map((entry) => {
      if (!isGroup(entry)) return entry;
      if (idOf(entry) === parentId) return { ...entry, children: entries };
      const kids = childrenOf(entry);
      const next = walk(kids);
      return next === kids || next.every((e, i) => e === kids[i]) ? entry : { ...entry, children: next };
    });
  return walk(menu);
}

/** Every group of the menu, in reading order, with its depth (0 for a top-level group). */
export function groupsOf(menu: Menu): Array<{ id: string; entry: MenuEntry; depth: number }> {
  const out: Array<{ id: string; entry: MenuEntry; depth: number }> = [];
  const walk = (entries: Menu, depth: number) => {
    for (const entry of entries) {
      const id = idOf(entry);
      if (isGroup(entry) && id) {
        out.push({ id, entry, depth });
        walk(childrenOf(entry), depth + 1);
      }
    }
  };
  walk(menu, 0);
  return out;
}

/** `menu` without the entry `id` (and, for a group, what it holds). */
export function removeEntry(menu: Menu, id: string): Menu {
  const place = placeOf(menu, id);
  if (!place) return menu;
  const siblings = siblingsAt(menu, place.parentId) ?? [];
  return withSiblings(menu, place.parentId, siblings.filter((_, i) => i !== place.index));
}

/** `menu` with `entry` put in the group `parentId` (the top level for `null`) at `index`, clamped to the group's ends. */
export function insertEntry(menu: Menu, parentId: string | null, index: number, entry: MenuEntry): Menu {
  const siblings = siblingsAt(menu, parentId);
  if (!siblings) return menu;
  const at = Math.max(0, Math.min(index, siblings.length));
  return withSiblings(menu, parentId, [...siblings.slice(0, at), entry, ...siblings.slice(at)]);
}

/** `menu` with the entry `id` moved one place up (`-1`) or down (`1`) among its group's entries. */
export function moveBy(menu: Menu, id: string, delta: -1 | 1): Menu {
  const place = placeOf(menu, id);
  if (!place) return menu;
  const siblings = siblingsAt(menu, place.parentId) ?? [];
  const to = place.index + delta;
  if (to < 0 || to >= siblings.length) return menu;
  const next = [...siblings];
  [next[place.index], next[to]] = [next[to], next[place.index]];
  return withSiblings(menu, place.parentId, next);
}

/** Whether the entry `id` can move up (`-1`) or down (`1`) in its group. */
export function canMoveBy(menu: Menu, id: string, delta: -1 | 1): boolean {
  const place = placeOf(menu, id);
  if (!place) return false;
  const to = place.index + delta;
  return to >= 0 && to < (siblingsAt(menu, place.parentId)?.length ?? 0);
}

/** Whether `groupId` is `id` itself or a group inside it: an entry cannot move into itself. */
function holds(menu: Menu, id: string, groupId: string): boolean {
  if (id === groupId) return true;
  const entry = entryOf(menu, id);
  if (!entry || !isGroup(entry)) return false;
  return placeOf(childrenOf(entry), groupId) !== null;
}

/**
 * `menu` with the entry `id` moved to the group `parentId` (the top level for
 * `null`) at `index` of that group as it reads AFTER the entry has left its
 * old place (`Infinity` for its end). A move into the entry itself is no move.
 */
export function moveEntry(menu: Menu, id: string, parentId: string | null, index: number): Menu {
  const entry = entryOf(menu, id);
  if (!entry) return menu;
  if (parentId !== null && holds(menu, id, parentId)) return menu;
  const without = removeEntry(menu, id);
  if (!siblingsAt(without, parentId)) return menu;
  return insertEntry(without, parentId, index, entry);
}

/** `menu` with `patch` merged into the entry `id`; a key patched to `undefined` is removed. */
export function patchEntry(menu: Menu, id: string, patch: Record<string, unknown>): Menu {
  const place = placeOf(menu, id);
  if (!place) return menu;
  const siblings = siblingsAt(menu, place.parentId) ?? [];
  const next: Record<string, unknown> = { ...siblings[place.index], ...patch };
  for (const [key, value] of Object.entries(patch)) if (value === undefined) delete next[key];
  return withSiblings(
    menu,
    place.parentId,
    siblings.map((e, i) => (i === place.index ? next : e)),
  );
}

/**
 * What an entry opens, as one key per thing: `object/<name>`,
 * `view/<view name>` (an object entry that lands on a view), `dashboard/`,
 * `report/`, `page/`, `url/`; `null` for a group, a separator or an entry
 * that names no target. The picker compares these only with each other
 * (`targetKeyFor`); they are no cache key, and are spelled with `/` so they
 * never read as the data adapter's `view:` keys.
 */
export function targetKeyOf(entry: MenuEntry): string | null {
  const str = (key: string) => (typeof entry[key] === 'string' && entry[key] ? (entry[key] as string) : null);
  switch (entry.type) {
    case 'object': {
      const view = str('viewName');
      if (view) return `view/${view}`;
      const object = str('objectName');
      // An entry that opens a record or a form is not the object's list.
      return object && !str('recordId') && !str('form') ? `object/${object}` : null;
    }
    case 'dashboard':
      return str('dashboardName') ? `dashboard/${str('dashboardName')}` : null;
    case 'report':
      return str('reportName') ? `report/${str('reportName')}` : null;
    case 'page':
      return str('pageName') ? `page/${str('pageName')}` : null;
    case 'url':
      return str('url') ? `url/${str('url')}` : null;
    default:
      return null;
  }
}

/** Every target the menu opens ({@link targetKeyOf}), at every depth. */
export function menuTargets(menu: Menu): Set<string> {
  const out = new Set<string>();
  const walk = (entries: Menu) => {
    for (const entry of entries) {
      const key = targetKeyOf(entry);
      if (key) out.add(key);
      walk(childrenOf(entry));
    }
  };
  walk(menu);
  return out;
}

/** The menu entry that opens `name` of `kind`, with `id`; a link takes its `label` and `url`. */
export function entryFor(
  kind: MenuTargetKind,
  name: string,
  id: string,
  link?: { label: string; url: string },
): MenuEntry {
  switch (kind) {
    case 'object':
      return { id, type: 'object', objectName: name };
    case 'view': {
      // A view item is named `<object>.<key>`.
      const dot = name.indexOf('.');
      return { id, type: 'object', objectName: dot > 0 ? name.slice(0, dot) : name, viewName: name };
    }
    case 'dashboard':
      return { id, type: 'dashboard', dashboardName: name };
    case 'report':
      return { id, type: 'report', reportName: name };
    case 'page':
      return { id, type: 'page', pageName: name };
    case 'url':
      return { id, type: 'url', label: link?.label ?? name, url: link?.url ?? name };
  }
}

/** The {@link targetKeyOf} key the picker's row `name` of `kind` would add. */
export function targetKeyFor(kind: MenuTargetKind, name: string): string {
  return `${kind}/${name}`;
}
