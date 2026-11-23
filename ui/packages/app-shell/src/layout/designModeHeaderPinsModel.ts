// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The header's action arrangement under the design mode (objectstack#36366):
 * which of a scope's actions its header draws as buttons, at most three, in
 * order, and the order of the rest in its 「More」 menu. Pure functions of the
 * object as served; the panel (`DesignModeHeaderPins.tsx`) draws them and the
 * save (`designModeHeaderPinsSave.ts`) writes them.
 *
 * The setting is the object's `actionLayout` (`@objectstack/spec`), one arm
 * per action scope, `{ pinned, more }`: `list` for the list page toolbar,
 * `record` for the record header (record page, side preview, phone bar). An
 * arm the object does not set leaves that header's own choice: the first three
 * of its buttons by each action's `order`, which is what the panel shows as
 * pinned until the administrator changes it, and the rest in that order.
 *
 * @module
 */

import {
  OBJECT_ACTION_LAYOUT_BUILTINS,
  OBJECT_ACTION_LAYOUT_PINNED_LIMIT,
  type ObjectActionLayoutScope,
} from '@objectstack/spec/data';
import { actionRendersAt, readActionLayoutArm, type ActionLayoutArm } from '@object-ui/types';

export type PinPage = ObjectActionLayoutScope;

/** One scope's arrangement: the buttons, then the 「More」 menu's order. */
export type PinArm = ActionLayoutArm;

/** An object's arrangement for both scopes: the `actionLayout` value written. */
export interface ObjectPins {
  readonly list?: PinArm;
  readonly record?: PinArm;
}

/** One scope's arrangement as the panel shows it: every candidate, either pinned or in 「More」. */
export interface ShownArrangement {
  readonly pinned: string[];
  readonly more: string[];
}

/** One thing the panel can arrange: an action of the object, or a scope built-in (`$import`). */
export interface PinCandidate {
  readonly id: string;
  readonly label: string;
}

/** The most a header pins (`OBJECT_ACTION_LAYOUT_PINNED_LIMIT`, 3). */
export const PIN_LIMIT = OBJECT_ACTION_LAYOUT_PINNED_LIMIT;

/** The design mode's key for the arrangement of `objectName`: one staged change per object, both scopes in it. */
export function pinsChangeKey(objectName: string): string {
  return `object-pins:${objectName}`;
}

type PinnableAction = {
  readonly name?: unknown;
  readonly label?: unknown;
  readonly locations?: readonly string[];
  readonly order?: unknown;
  readonly variant?: unknown;
  readonly component?: unknown;
};

/** The locations whose actions a scope's header places. */
const PAGE_LOCATIONS: Readonly<Record<PinPage, readonly ('list_toolbar' | 'record_header' | 'record_more')[]>> = {
  list: ['list_toolbar'],
  record: ['record_header', 'record_more'],
};

/** Whether `action` is placed in `page`'s scope. */
export function placedOnPage(action: PinnableAction, page: PinPage): boolean {
  return PAGE_LOCATIONS[page].some((location) => actionRendersAt(action as never, location));
}

/** The object's `actionLayout` as served (`{}` when it arranges nothing). */
export function servedPins(objectDef: unknown): ObjectPins {
  const raw = (objectDef as { actionLayout?: unknown } | null | undefined)?.actionLayout;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const list = readActionLayoutArm((raw as Record<string, unknown>).list);
  const record = readActionLayoutArm((raw as Record<string, unknown>).record);
  return { ...(list ? { list } : {}), ...(record ? { record } : {}) };
}

/** The header's own sort: `order` ascending (unset 0), `variant: 'primary'` first among equals, then incoming order. */
function headerSort<T extends PinnableAction>(actions: readonly T[]): T[] {
  const rank = (a: PinnableAction) => (typeof a.order === 'number' ? a.order : 0);
  return [...actions].sort((a, b) => {
    const byOrder = rank(a) - rank(b);
    if (byOrder !== 0) return byOrder;
    return (a.variant === 'primary' ? 0 : 1) - (b.variant === 'primary' ? 0 : 1);
  });
}

/**
 * What the header draws as buttons while the object sets no arm for `page`:
 * the first three of its row's actions by the header's own sort. On the record
 * page the row's actions are those placed at `record_header` (one placed at
 * `record_more` only is in ⋯ already); an action authored into ⋯
 * (`component: 'action:menu'`) is never a button.
 */
export function defaultPins(actions: readonly PinnableAction[], page: PinPage): string[] {
  const row = actions.filter(
    (a) =>
      typeof a.name === 'string' &&
      a.component !== 'action:menu' &&
      (page === 'list' ? actionRendersAt(a as never, 'list_toolbar') : actionRendersAt(a as never, 'record_header')),
  );
  return headerSort(row)
    .slice(0, PIN_LIMIT)
    .map((a) => a.name as string);
}

/**
 * Everything the panel offers for `page`, in the header's own order (the
 * default order of 「More」): the scope's placed actions, then its built-ins
 * that this reader is offered.
 */
export function pinCandidates(
  actions: readonly PinnableAction[],
  page: PinPage,
  builtins: readonly PinCandidate[],
): PinCandidate[] {
  const seen = new Set<string>();
  const out: PinCandidate[] = [];
  for (const action of headerSort(actions.filter((a) => placedOnPage(a, page)))) {
    const name = typeof action.name === 'string' ? action.name : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ id: name, label: typeof action.label === 'string' && action.label ? action.label : name });
  }
  const allowed = new Set(OBJECT_ACTION_LAYOUT_BUILTINS[page]);
  for (const builtin of builtins) if (allowed.has(builtin.id) && !seen.has(builtin.id)) out.push(builtin);
  return out;
}

/**
 * The arrangement as the panel shows it, over `candidates` (in their default
 * order): the arm set (staged or served), else the header's default. Pinned
 * are the arm's `pinned` this reader is offered; 「More」 is every other
 * candidate, the ones the arm's `more` names first, in that order, then the
 * rest in the default order.
 */
export function shownArrangement(
  pins: ObjectPins,
  page: PinPage,
  actions: readonly PinnableAction[],
  candidates: readonly PinCandidate[],
): ShownArrangement {
  const ids = new Set(candidates.map((c) => c.id));
  const arm = pins[page];
  const pinned = (arm ? [...arm.pinned] : defaultPins(actions, page)).filter((id) => ids.has(id));
  const taken = new Set(pinned);
  const more: string[] = [];
  for (const id of [...(arm?.more ?? []), ...candidates.map((c) => c.id)]) {
    if (!ids.has(id) || taken.has(id)) continue;
    taken.add(id);
    more.push(id);
  }
  return { pinned: [...new Set(pinned)], more };
}

/**
 * The names the arm for `page` sets that this scope no longer offers (an
 * action the package removed, or one no longer placed here): the panel says
 * they are left out, and a save writes the arrangement without them. The
 * `$` built-ins are not judged: one this reader is not offered (no import
 * permission) is still the scope's.
 */
export function staleNames(pins: ObjectPins, page: PinPage, candidates: readonly PinCandidate[]): string[] {
  const arm = pins[page];
  if (!arm) return [];
  const ids = new Set(candidates.map((c) => c.id));
  return [...new Set([...arm.pinned, ...(arm.more ?? [])])].filter((name) => !name.startsWith('$') && !ids.has(name));
}

/**
 * `shown` with `id` moved between its two parts: a pinned one to the top of
 * 「More」, one in 「More」 to the end of the pinned ones. `null` when the
 * header is full.
 */
export function togglePin(shown: ShownArrangement, id: string): ShownArrangement | null {
  if (shown.pinned.includes(id)) {
    return { pinned: shown.pinned.filter((pin) => pin !== id), more: [id, ...shown.more.filter((m) => m !== id)] };
  }
  if (shown.pinned.length >= PIN_LIMIT) return null;
  return { pinned: [...shown.pinned, id], more: shown.more.filter((m) => m !== id) };
}

/** `list` with the entry at `from` moved to `to`. */
export function movePin(list: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Why `pins` cannot be saved on `objectDef` as served, or `null`: a name, in
 * either part of an arm, that is no action of the object, or one not placed
 * in the scope its arm arranges (`@objectstack/lint`'s
 * `validateObjectActionLayout`, asked of the object as served, every
 * package's actions included). `$` built-ins are the schema's.
 */
export function pinsRefusal(
  objectDef: unknown,
  pins: ObjectPins,
  texts: { unknown: (name: string) => string; notPlaced: (name: string) => string },
): string | null {
  const actions = Array.isArray((objectDef as { actions?: unknown } | null)?.actions)
    ? ((objectDef as { actions: PinnableAction[] }).actions)
    : [];
  for (const page of ['list', 'record'] as const) {
    const arm = pins[page];
    for (const name of [...(arm?.pinned ?? []), ...(arm?.more ?? [])]) {
      if (name.startsWith('$')) continue;
      const action = actions.find((a) => a.name === name);
      if (!action) return texts.unknown(name);
      if (!placedOnPage(action, page)) return texts.notPlaced(name);
    }
  }
  return null;
}

/**
 * Whether a record page's header reads the object's pins: the synthesized
 * header (no authored page, or one with no `page:header` node of its own, as
 * a slotted page that leaves its header slot alone), or an authored
 * `page:header` with `placedActions: true`. A `page:header` authored with its
 * own `actions` list keeps that list, and one with neither draws none of the
 * object's actions: neither reads pins, so the design mode offers no
 * 「Header buttons」 on them.
 */
export function headerReadsPins(page: unknown): boolean {
  const headers: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (rec.type === 'page:header') headers.push(rec);
    Object.values(rec).forEach(walk);
  };
  walk(page);
  return headers.every((h) => {
    const props = (h.properties ?? {}) as Record<string, unknown>;
    return (h.placedActions ?? props.placedActions) === true && (h.actions ?? props.actions) === undefined;
  });
}
