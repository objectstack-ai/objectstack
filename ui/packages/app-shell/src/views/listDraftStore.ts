// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#35955 — the list's DRAFT: what a reader changed on a Console list
 * and has not saved. It applies at once and is kept nowhere durable — not in
 * the reader's preferences, not in the view. The reader keeps it with Save
 * (into the open view, or as a view of their own) or drops it with Discard.
 *
 * What a draft holds: the sort, the Filter panel's group, the grouping, the
 * search term, the columns shown (hidden ones, added ones), the column order
 * and the Display panel's layout and row colour. What it never holds: the
 * column widths and the row height, which are remembered for the reader
 * (`ListPreferencesProvider`), and the view tab order.
 *
 * ## How long it lives
 *
 * ONE draft at a time, for one reader, object and view (its `scope`), in this
 * tab's memory:
 *
 * - opening a record (as a page or in the side panel) and coming back keeps
 *   it: the record page draws no list of this store, so nothing replaces it;
 * - opening another view or another object replaces it (`claimListDraft` with
 *   another scope), with no prompt;
 * - a reload loses it, the module's memory with it. When the reloaded page
 *   is the list itself, the address's `uf_*` copy of the toolbar state is
 *   dropped too (`takeDocumentReload`, read by the list's seed), so the list
 *   opens as its view declares it. A reload of another page does not touch a
 *   list an in-app link opens later.
 *
 * Not React state: the list page unmounts while a record is open as a page,
 * and the draft must outlive it. Readers subscribe through
 * {@link useListDraft}.
 *
 * @module
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { GroupingConfig } from '@objectstack/spec/ui';
import type {
  ListFilterGroupPreference,
  ListSortPreference,
  ListViewPreference,
} from '../context/ListPreferencesProvider.js';

/** A list's unsaved changes. An absent part is the view's own. */
export interface ListDraft {
  sort?: ListSortPreference[];
  filters?: ListFilterGroupPreference;
  grouping?: GroupingConfig;
  search?: string;
  /** The grid's column order, as the reader dragged it. */
  columnOrder?: string[];
  /** The columns the reader hid: the whole list the Hide Fields popover emits. */
  hiddenFields?: string[];
  /** The object's fields the reader added as columns. */
  addedFields?: string[];
  /** The visualization the reader switched to (`ListView`'s layout control, `onViewChange`). */
  viewType?: string;
  /**
   * The row colour the reader picked (`ListView`'s `onRowColorChange`), or
   * `null` for "none" over a view that colours its rows.
   */
  rowColor?: { field: string; colors?: Record<string, string> } | null;
}

/** A patch: a part set to `undefined` is dropped back to the view's own. */
export type ListDraftPatch = { [K in keyof ListDraft]?: ListDraft[K] | undefined };

interface Slot {
  scope: string;
  draft: ListDraft;
}

const EMPTY_DRAFT: ListDraft = Object.freeze({}) as ListDraft;
let slot: Slot = { scope: '', draft: EMPTY_DRAFT };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** The scope of one list's draft: the reader, the object and the view. */
export function listDraftScope(userId: string | null | undefined, objectName: string, viewId: string): string {
  return JSON.stringify([userId ?? '', objectName, viewId]);
}

/** The draft held for `scope`, else the empty draft. */
export function readListDraft(scope: string): ListDraft {
  return slot.scope === scope ? slot.draft : EMPTY_DRAFT;
}

/**
 * The list for `scope` is the one on screen now: a draft held for any other
 * list is dropped (another view or object was opened). Called once per list
 * identity, where the list takes its seed. Does not notify: the caller is
 * rendering, and a list that changed scope reads its own (empty) draft.
 */
export function claimListDraft(scope: string): void {
  if (slot.scope !== scope) slot = { scope, draft: EMPTY_DRAFT };
}

function isEmptyPart(value: unknown): boolean {
  return value === undefined;
}

/**
 * A part as the draft keeps it: a sort is its fields and directions (a grid
 * reports row ids beside them), and a filter group with no condition is no
 * filter (the Filter panel's "Clear all" reports an empty group).
 */
function normalizePart(key: string, value: unknown): unknown {
  if (key === 'sort' && Array.isArray(value)) {
    return value
      .filter((item): item is { field: string; order?: string } => !!item && typeof item.field === 'string' && !!item.field)
      .map((item) => ({ field: item.field, order: item.order === 'desc' ? 'desc' : 'asc' }));
  }
  if (key === 'filters') {
    const conditions = (value as { conditions?: unknown } | null | undefined)?.conditions;
    return Array.isArray(conditions) && conditions.length > 0 ? value : undefined;
  }
  return value;
}

/** Lay `patch` over the draft of `scope`, claiming the scope when it is not held. */
export function patchListDraft(scope: string, patch: ListDraftPatch): void {
  const base = slot.scope === scope ? slot.draft : EMPTY_DRAFT;
  const next: Record<string, unknown> = { ...base };
  let changed = slot.scope !== scope;
  for (const [key, raw] of Object.entries(patch)) {
    const value = normalizePart(key, raw);
    const before = (base as Record<string, unknown>)[key];
    if (isEmptyPart(value)) {
      if (key in next) {
        delete next[key];
        changed = true;
      }
      continue;
    }
    if (JSON.stringify(before) !== JSON.stringify(value)) {
      next[key] = value;
      changed = true;
    }
  }
  if (!changed) return;
  slot = { scope, draft: next as ListDraft };
  emit();
}

/** Drop the draft of `scope` (Discard, or once it was saved). */
export function discardListDraft(scope: string): void {
  if (slot.scope !== scope || slot.draft === EMPTY_DRAFT) return;
  slot = { scope, draft: EMPTY_DRAFT };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The draft of one list, and its writers. */
export function useListDraft(scope: string): {
  draft: ListDraft;
  patch: (patch: ListDraftPatch) => void;
  discard: () => void;
} {
  const draft = useSyncExternalStore(
    subscribe,
    () => readListDraft(scope),
    () => readListDraft(scope),
  );
  const patch = useCallback((p: ListDraftPatch) => patchListDraft(scope, p), [scope]);
  const discard = useCallback(() => discardListDraft(scope), [scope]);
  return { draft, patch, discard };
}

/**
 * Was THIS list's address the one a reload opened? Read once per document:
 * only the first list this page seeds can be the one the reload asked for
 * again, and only when the reloaded address is the address that list opens
 * on (path and query; the hash is ignored). A reload of another page (the AI
 * chat page, say) followed by an in-app link to a list with `uf_*` state is
 * NOT a reload of that list: the link's state applies.
 */
let reloadConsumed = false;
export function takeDocumentReload(currentHref?: string): boolean {
  if (reloadConsumed) return false;
  reloadConsumed = true;
  try {
    const entry = typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function'
      ? (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)
      : undefined;
    if (entry?.type !== 'reload') return false;
    const here = currentHref ?? (typeof window !== 'undefined' ? window.location.href : '');
    return sameAddress(entry.name, here);
  } catch {
    return false;
  }
}

/** Two absolute addresses name the same page: origin, path and query alike. */
function sameAddress(a: string, b: string): boolean {
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname && x.search === y.search;
  } catch {
    return false;
  }
}

/**
 * The list's state in the reader-state shape the list relay and the view
 * builders read (`ListViewPreference`): the draft's columns, their order and
 * its sort and filters, with the two parts kept for the reader — the column
 * widths and the row height — from what they stored. Nothing else they
 * stored is read: a sort, filter, column order or hidden column stored
 * before objectstack#35955 no longer applies.
 */
export function listDraftPreference(
  draft: ListDraft,
  stored: ListViewPreference | undefined,
): ListViewPreference | undefined {
  const widths = stored?.columnState?.widths;
  const out: ListViewPreference = {};
  if (draft.sort) out.sort = draft.sort;
  if (draft.filters) out.filters = draft.filters;
  if (draft.hiddenFields) out.hiddenFields = draft.hiddenFields;
  if (draft.addedFields?.length) out.addedFields = draft.addedFields;
  if (draft.columnOrder || widths) {
    out.columnState = {
      ...(draft.columnOrder ? { order: draft.columnOrder } : {}),
      ...(widths ? { widths } : {}),
    };
  }
  if (stored?.rowHeight) out.rowHeight = stored.rowHeight;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Test seam: forget the held draft and the reload read. */
export function resetListDraftStoreForTests(): void {
  slot = { scope: '', draft: EMPTY_DRAFT };
  reloadConsumed = false;
  emit();
}
