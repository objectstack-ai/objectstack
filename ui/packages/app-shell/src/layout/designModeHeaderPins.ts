// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The page header's pinned actions under the design mode (objectstack#36366):
 * which of a page's actions its header draws as buttons, at most three, in
 * order, and which go to its 「More」 menu. Pure functions of the object as
 * served; the panel (`DesignModeHeaderPins.tsx`) draws them and the save
 * (`designModeHeaderPinsSave.ts`) writes them.
 *
 * The setting is the object's `pinnedActions` (`@objectstack/spec`), one arm
 * per page type: `list` for its list page, `record` for its record page. An
 * arm the object does not set leaves that header's own choice: the first three
 * of its buttons by each action's `order`, which is what the panel shows as
 * pinned until the administrator changes it.
 *
 * @module
 */

import {
  OBJECT_PINNED_ACTION_LIMIT,
  OBJECT_PINNED_BUILTIN_ACTIONS,
  type ObjectPinnedActionPage,
} from '@objectstack/spec/data';
import { actionRendersAt } from '@object-ui/types';

export type PinPage = ObjectPinnedActionPage;

/** An object's pins for both pages: the `pinnedActions` value written. */
export interface ObjectPins {
  readonly list?: readonly string[];
  readonly record?: readonly string[];
}

/** One thing the panel can pin: an action of the object, or a page built-in (`$import`). */
export interface PinCandidate {
  readonly id: string;
  readonly label: string;
}

/** The most a header pins (`OBJECT_PINNED_ACTION_LIMIT`, 3). */
export const PIN_LIMIT = OBJECT_PINNED_ACTION_LIMIT;

/** The design mode's key for the pins of `objectName`: one staged change per object, both pages in it. */
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

/** The locations whose actions a page's header places. */
const PAGE_LOCATIONS: Readonly<Record<PinPage, readonly ('list_toolbar' | 'record_header' | 'record_more')[]>> = {
  list: ['list_toolbar'],
  record: ['record_header', 'record_more'],
};

/** Whether `action` is placed on `page`'s header. */
export function placedOnPage(action: PinnableAction, page: PinPage): boolean {
  return PAGE_LOCATIONS[page].some((location) => actionRendersAt(action as never, location));
}

/** The object's `pinnedActions` as served (`{}` when it pins nothing). */
export function servedPins(objectDef: unknown): ObjectPins {
  const raw = (objectDef as { pinnedActions?: unknown } | null | undefined)?.pinnedActions;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const arm = (value: unknown) =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
  const list = arm((raw as ObjectPins).list);
  const record = arm((raw as ObjectPins).record);
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
 * Everything the panel offers for `page`, in the header's own order: the
 * page's placed actions, then its built-ins that this reader is offered.
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
  const allowed = new Set(OBJECT_PINNED_BUILTIN_ACTIONS[page]);
  for (const builtin of builtins) if (allowed.has(builtin.id) && !seen.has(builtin.id)) out.push(builtin);
  return out;
}

/** The pins as the panel shows them: the arm set (staged or served), else the header's default. */
export function shownPins(pins: ObjectPins, page: PinPage, actions: readonly PinnableAction[]): string[] {
  const arm = pins[page];
  return arm ? [...arm] : defaultPins(actions, page);
}

/** `pins` with `id` toggled on `page`: off when pinned, on at the end when not. `null` when the header is full. */
export function togglePin(shown: readonly string[], id: string): string[] | null {
  if (shown.includes(id)) return shown.filter((pin) => pin !== id);
  if (shown.length >= PIN_LIMIT) return null;
  return [...shown, id];
}

/** `shown` with the pin at `from` moved to `to`. */
export function movePin(shown: readonly string[], from: number, to: number): string[] {
  if (from === to || from < 0 || to < 0 || from >= shown.length || to >= shown.length) return [...shown];
  const next = [...shown];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Why `pins` cannot be saved on `objectDef` as served, or `null`: a name that
 * is no action of the object, or one not placed on the page its arm pins
 * (`@objectstack/lint`'s `validateObjectPinnedActions`, asked of the object as
 * served, every package's actions included). `$` built-ins are the schema's.
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
    for (const pin of pins[page] ?? []) {
      if (pin.startsWith('$')) continue;
      const action = actions.find((a) => a.name === pin);
      if (!action) return texts.unknown(pin);
      if (!placedOnPage(action, page)) return texts.notPlaced(pin);
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
