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
 * The edits read a level's ARRAY order as its shown order. The sidebar sorts
 * each level by `order` (objectstack#36591), so the editor is seeded with each
 * level put in that order ({@link inShownOrder}), and a save writes the order
 * back as `order` ({@link withOrderRewritten}).
 *
 * @module
 */

import { inMenuOrder } from '../views/metadata-admin/previews/AppNavCanvas.js';

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

/**
 * The menu with each level, at every depth, in the order the sidebar draws it
 * (objectstack#36591): through `inMenuOrder`, the menu's own rule (`order`
 * ascending, an absent `order` as `0`, ties in array order). A level already
 * in that order (one whose entries carry no `order`, say) is the same array,
 * and an entry whose children are already in it is the same object.
 */
export function inShownOrder(menu: Menu): Menu {
  const sorted = inMenuOrder(menu as ReadonlyArray<MenuEntry & { order?: number }>).map(([entry]) => {
    if (!Array.isArray(entry.children)) return entry;
    const kids = inShownOrder(entry.children as Menu);
    return kids === entry.children ? entry : { ...entry, children: kids };
  });
  return sorted.every((entry, i) => entry === menu[i]) ? menu : sorted;
}

/**
 * The menu with `order` written as each entry's place in its level, at every
 * depth (objectstack#36591): a level in which any entry carries `order` has
 * every entry numbered `0`, `1`, … in array order, so the sidebar's sort
 * (`order` ascending) draws the level as the array reads. A level in which no
 * entry carries `order` is left without it, so a menu authored by array order
 * gains no key. An entry already holding its number is the same object.
 */
export function withOrderRewritten(menu: Menu): Menu {
  const numbered = menu.some((entry) => entry.order !== undefined);
  const next = menu.map((entry, i) => {
    let out: MenuEntry = entry;
    if (Array.isArray(entry.children)) {
      const kids = withOrderRewritten(entry.children as Menu);
      if (kids !== entry.children) out = { ...out, children: kids };
    }
    if (numbered && out.order !== i) out = { ...out, order: i };
    return out;
  });
  return next.every((entry, i) => entry === menu[i]) ? menu : next;
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
      const object = str('objectName');
      // A view is named `<object>.<key>`; an entry may name it by its key
      // alone (`viewName: 'my_projects'`, as HotCRM's menus do), which is
      // the same view of its own object.
      if (view) return `view/${view.includes('.') || !object ? view : `${object}.${view}`}`;
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

/** An entry's own keys, its `children` left out: what a patch compares. */
function ownKeys(entry: MenuEntry): Record<string, unknown> {
  const { children: _children, ...own } = entry as Record<string, unknown>;
  return own;
}

interface Located {
  readonly entry: MenuEntry;
  readonly parentId: string | null;
}

function locate(menu: Menu, keyOf: (entry: MenuEntry) => string | null): Map<string, Located> {
  const out = new Map<string, Located>();
  const walk = (entries: Menu, parentId: string | null) => {
    for (const entry of entries) {
      const key = keyOf(entry);
      if (key) out.set(key, { entry, parentId });
      if (isGroup(entry)) walk(childrenOf(entry), key);
    }
  };
  walk(menu, null);
  return out;
}

/**
 * The key of each stored entry: the id of its served copy, or `null` for a
 * stored entry the reader was never shown.
 *
 * A stored entry with an id is keyed by it only when the served entry of that
 * id is the same thing (the same type and target): the editor gives served
 * entries without an id the first free `nav_item_<n>` of what the reader was
 * shown (`withEntryIds`), which a stored entry pruned from the reader can
 * already hold. A stored entry without an id is matched to an unmatched served
 * entry by its group, type and target, in order.
 */
interface StoredKeyer {
  (entry: MenuEntry): string | null;
  /** Give `copy`, a rebuilt or inserted entry, the key `key`. */
  alias(copy: MenuEntry, key: string | null): MenuEntry;
}

function sameThing(a: MenuEntry, b: MenuEntry): boolean {
  return a.type === b.type && targetKeyOf(a) === targetKeyOf(b);
}

function storedKeyer(served: Menu, stored: Menu): StoredKeyer {
  const servedAt = locate(served, idOf);
  const keys = new Map<MenuEntry, string>();
  const matched = new Set<string>();
  const byId = (entries: Menu) => {
    for (const entry of entries) {
      const id = idOf(entry);
      const copy = id ? servedAt.get(id) : undefined;
      if (id && copy && !matched.has(id) && sameThing(copy.entry, entry)) {
        keys.set(entry, id);
        matched.add(id);
      }
      if (isGroup(entry)) byId(childrenOf(entry));
    }
  };
  byId(stored);
  const unclaimed = [...servedAt.entries()].filter(([id]) => !matched.has(id));
  const claim = (entry: MenuEntry, parentId: string | null): string | null => {
    const at = unclaimed.findIndex(([, s]) => s.parentId === parentId && sameThing(s.entry, entry));
    if (at < 0) return null;
    const [[id]] = unclaimed.splice(at, 1);
    return id;
  };
  // `undefined`: the group was never shown, so nothing in it can be claimed.
  const adopt = (entries: Menu, parentId: string | null | undefined) => {
    for (const entry of entries) {
      let key = keys.get(entry) ?? null;
      if (!key && !idOf(entry) && parentId !== undefined) {
        key = claim(entry, parentId);
        if (key) keys.set(entry, key);
      }
      if (isGroup(entry)) adopt(childrenOf(entry), key ?? undefined);
    }
  };
  adopt(stored, null);
  const keyOf = ((entry: MenuEntry) => keys.get(entry) ?? null) as StoredKeyer;
  keyOf.alias = (copy, key) => {
    if (key) keys.set(copy, key);
    return copy;
  };
  return keyOf;
}

/** The stored entry behind each served entry, by the served entry's id. */
export function storedEntriesById(served: Menu, stored: Menu): Map<string, MenuEntry> {
  const keyOf = storedKeyer(served, stored);
  const out = new Map<string, MenuEntry>();
  locate(stored, keyOf).forEach((located, id) => out.set(id, located.entry));
  return out;
}

/**
 * The served entries that keep their place: in the same group, and in the
 * longest run of that group's entries whose order the edits kept (so a
 * removal or an addition beside an entry does not move it, and of two
 * entries swapped one is moved, the later one in the served order). Only
 * the entries `counted` holds take part: an entry of another package's is
 * neither moved nor a reason to move one.
 */
function staysInOrder(served: Map<string, Located>, edited: Map<string, Located>, counted: (id: string) => boolean): Set<string> {
  const groups = new Map<string | null, { was: string[]; now: string[] }>();
  const groupOf = (parentId: string | null) => {
    let g = groups.get(parentId);
    if (!g) groups.set(parentId, (g = { was: [], now: [] }));
    return g;
  };
  served.forEach((was, id) => {
    if (counted(id) && edited.get(id)?.parentId === was.parentId) groupOf(was.parentId).was.push(id);
  });
  edited.forEach((now, id) => {
    if (counted(id) && served.get(id)?.parentId === now.parentId) groupOf(now.parentId).now.push(id);
  });
  const out = new Set<string>();
  groups.forEach(({ was, now }) => {
    // The longest common subsequence of the two orders.
    const n = was.length;
    const m = now.length;
    const len: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i -= 1) {
      for (let j = m - 1; j >= 0; j -= 1) {
        len[i][j] = was[i] === now[j] ? len[i + 1][j + 1] + 1 : Math.max(len[i + 1][j], len[i][j + 1]);
      }
    }
    for (let i = 0, j = 0; i < n && j < m; ) {
      if (was[i] === now[j]) {
        out.add(was[i]);
        i += 1;
        j += 1;
      } else if (len[i + 1][j] > len[i][j + 1]) i += 1;
      else j += 1;
    }
  });
  return out;
}

/**
 * The edits made to `served` (the tree the editor was seeded from, every
 * entry with an id) that turned it into `edited`, applied by entry id to
 * `stored`, the app's navigation as stored (objectstack#36363).
 *
 * The served tree is not what is stored: its labels are translated for the
 * reader's language (`translateApp`), and entries the reader may not open
 * are pruned from it (`filterNav`). So the save never writes it back. It
 * writes `stored` with the edits replayed on it:
 *
 * - an entry `edited` no longer holds is removed;
 * - an entry `edited` adds is put in its group after the entry before it;
 * - an entry moved (to another group, or out of the order its group's other
 *   entries kept, `staysInOrder`) is taken out and put back after the entry
 *   before it in `edited`, its stored keys kept;
 * - an entry whose own keys changed (a rename, an icon) has those keys
 *   written, and only those: a key it did not change keeps its stored value.
 *
 * Every other stored entry, one the reader was never shown included, stays
 * where it was and is the same object. Stored entries are matched to their
 * served copies by `storedKeyer`.
 *
 * Nothing the stored menu does not hold is ever written from its served
 * copy: an entry another package puts into the menu (`navigationContributions`,
 * appended when the app is served), or one that has left the stored menu
 * since the editor read it, is not moved, patched or written, and takes no
 * part in the order comparison. Only an entry `served` does not hold is an
 * addition; one whose id a stored entry already holds is written under a
 * fresh `nav_item_<n>` that neither menu holds.
 */
export function rebaseMenuEdits(served: Menu, edited: Menu, stored: Menu): Menu {
  const keyOf = storedKeyer(served, stored);
  const s = locate(served, idOf);
  const e = locate(edited, idOf);
  const storedKeys = new Set(locate(stored, keyOf).keys());
  /** A served entry the stored menu does not hold: never written from its served copy. */
  const foreign = (id: string) => s.has(id) && !storedKeys.has(id);
  const removed = new Set([...s.keys()].filter((id) => !e.has(id)));
  const stays = staysInOrder(s, e, (id) => !foreign(id));
  const placed: string[] = [];
  const patches = new Map<string, Record<string, unknown>>();
  e.forEach((now, id) => {
    const was = s.get(id);
    if (!was) {
      placed.push(id);
      return;
    }
    if (foreign(id)) return;
    if (!stays.has(id)) placed.push(id);
    const before = ownKeys(was.entry);
    const after = ownKeys(now.entry);
    const patch: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) patch[key] = after[key];
    }
    if (Object.keys(patch).length > 0) patches.set(id, patch);
  });
  const lifted = new Set(placed);

  // The stored entries a moved one takes along, by key, each with its patch.
  const taken = new Map<string, MenuEntry>();
  const patched = (entry: MenuEntry, key: string | null): MenuEntry => {
    const patch = key ? patches.get(key) : undefined;
    if (!patch) return entry;
    const next: Record<string, unknown> = { ...entry, ...patch };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
    return keyOf.alias(next, key);
  };
  const strip = (entries: Menu): Menu => {
    const out: MenuEntry[] = [];
    let changed = false;
    for (const entry of entries) {
      const key = keyOf(entry);
      if (key && removed.has(key)) {
        changed = true;
        continue;
      }
      let next = entry;
      if (isGroup(entry)) {
        const kids = childrenOf(entry);
        const kept = strip(kids);
        if (kept !== kids) next = keyOf.alias({ ...entry, children: kept }, key);
      }
      next = patched(next, key);
      if (key && lifted.has(key)) {
        taken.set(key, next);
        changed = true;
        continue;
      }
      if (next !== entry) changed = true;
      out.push(next);
    }
    return changed ? out : entries;
  };
  let result = strip(stored);

  // Put each placed entry back, in the edited tree's reading order, after the
  // nearest entry before it in `edited` that the result holds.
  const holdsKey = (menu: Menu, key: string) => {
    const walk = (entries: Menu): boolean => entries.some((x) => keyOf(x) === key || (isGroup(x) && walk(childrenOf(x))));
    return walk(menu);
  };
  const indexIn = (entries: Menu, key: string) => entries.findIndex((x) => keyOf(x) === key);
  const groupEntries = (menu: Menu, parentId: string | null): Menu | null => {
    if (parentId === null) return menu;
    let found: Menu | null = null;
    const walk = (entries: Menu) => {
      for (const x of entries) {
        if (found) return;
        if (keyOf(x) === parentId && isGroup(x)) found = childrenOf(x);
        else if (isGroup(x)) walk(childrenOf(x));
      }
    };
    walk(menu);
    return found;
  };
  const replaceGroup = (menu: Menu, parentId: string | null, entries: Menu): Menu => {
    if (parentId === null) return entries;
    return menu.map((x) => {
      if (!isGroup(x)) return x;
      if (keyOf(x) === parentId) return keyOf.alias({ ...x, children: entries }, parentId);
      const kids = childrenOf(x);
      const next = replaceGroup(kids, parentId, entries);
      return next === kids || next.every((k, i) => k === kids[i]) ? x : keyOf.alias({ ...x, children: next }, keyOf(x));
    });
  };
  const editedSiblings = (parentId: string | null): string[] => {
    const group = parentId === null ? edited : siblingsAt(edited, parentId) ?? [];
    return group.map((x) => idOf(x)).filter((x): x is string => !!x);
  };
  // The ids a written entry may not take: every id either menu holds.
  const heldIds = new Set<string>([...locate(stored, idOf).keys(), ...s.keys(), ...e.keys()]);
  let fresh = 1;
  const freshId = () => {
    while (heldIds.has(`nav_item_${fresh}`)) fresh += 1;
    const id = `nav_item_${fresh}`;
    heldIds.add(id);
    return id;
  };
  const storedIds = new Set(locate(stored, idOf).keys());
  for (const id of placed) {
    const now = e.get(id)!;
    let entry: MenuEntry;
    if (taken.has(id)) entry = taken.get(id)!;
    else if (!s.has(id)) entry = keyOf.alias(storedIds.has(id) ? { ...now.entry, id: freshId() } : now.entry, id);
    else continue;
    // A group the stored menu lacks: the entry goes to the end of the top level.
    const lost = now.parentId !== null && !groupEntries(result, now.parentId);
    const parentId = lost ? null : now.parentId;
    const siblings = groupEntries(result, parentId) ?? [];
    const order = editedSiblings(now.parentId);
    let at = lost ? siblings.length : 0;
    for (let i = lost ? -1 : order.indexOf(id) - 1; i >= 0; i -= 1) {
      const before = indexIn(siblings, order[i]);
      if (before >= 0) {
        at = before + 1;
        break;
      }
    }
    if (holdsKey(result, id)) continue;
    result = replaceGroup(result, parentId, [...siblings.slice(0, at), entry, ...siblings.slice(at)]);
  }
  return result;
}
