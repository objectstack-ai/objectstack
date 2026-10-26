/**
 * ListPreferencesProvider — a console user's own list state, per object
 * (objectui#12418).
 *
 * What a user does to a list for themselves — the order of the view tabs, and
 * per view the sort, the Filter panel's conditions, the column order and
 * widths, the row density and the hidden fields (objectui#12474) — is THEIR
 * preference: it follows them to another browser, and it
 * never changes the view for anyone else. It used to live in two wrong places:
 * the tab order and the filters in this browser's localStorage only, and the
 * sort and the column layout written INTO the shared view (`/meta/view`), so
 * one user's header click re-sorted the list for every user, and under a
 * walled posture the write was refused.
 *
 * ## Where it is kept
 *
 * One `sys_user_preference` row per object, key `ui.list.<object>`:
 *
 * ```json
 * { "viewOrder": ["<view id>", …],
 *   "perView": { "<view id>": { "sort": […], "filters": {…}, "columnState": {…},
 *                               "rowHeight": "medium", "hiddenFields": ["<field>", …] } } }
 * ```
 *
 * The rows are loaded by prefix in the console's ONE preference read per load
 * (objectui#12187: `ConsoleShell`'s bridge attaches the family beside the
 * favorites / recents / palette slots, and `@object-ui/data-objectstack`'s
 * shared read carries the prefix). Writes are per object, debounced.
 *
 * localStorage is the write-through cache and the no-adapter fallback, under
 * `list-state:<user>:<object>`. With no adapter attached — a host without the
 * bridge, an anonymous session, a backend without the object — the state is
 * this browser's, as the tab order and the filters were before. The first
 * read of an object with no cached entry folds that object's older keys into
 * it once: `viewOrder:<object>` and the Filter panel's group from
 * `list-filters:<user>:<object>:<view>` (the search term stays there).
 *
 * ## What it is not
 *
 * Not a saved view, and not a change to one: the view's authored `sort`, tab
 * order, filter, columns, `rowHeight` and `hiddenFields` stay the default for
 * every user with no preference. The view editor's explicit save still writes `/meta/view`.
 *
 * @module
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@object-ui/auth';
import { ROW_HEIGHT_TO_DENSITY_MODE, type RowHeight } from '@object-ui/core';
import type { UserPreferenceFamily } from '@object-ui/data-objectstack';
import { useListStateFamily } from './UserStateAdapters.js';

// ---------------------------------------------------------------------------
// The slot's shape
// ---------------------------------------------------------------------------

/** One sort level, as the list emits it (the builder's row `id` is not kept). */
export interface ListSortPreference {
  field: string;
  order: 'asc' | 'desc';
}

/** The Filter panel's group, kept verbatim so the panel can rehydrate it. */
export interface ListFilterGroupPreference {
  id?: string;
  logic?: string;
  conditions?: unknown[];
}

/** The grid's column layout: the order and widths a user dragged. */
export interface ListColumnStatePreference {
  order?: string[];
  widths?: Record<string, number>;
}

/** A user's state for one view of one object. */
export interface ListViewPreference {
  sort?: ListSortPreference[];
  filters?: ListFilterGroupPreference;
  columnState?: ListColumnStatePreference;
  /**
   * objectui#12474 — the toolbar density this user chose, in the spec's
   * `rowHeight` vocabulary (the value the density toggle maps its mode to).
   * The view's authored `rowHeight` is the default while this is absent.
   */
  rowHeight?: RowHeight;
  /**
   * objectui#12474 — the columns this user hid with the Hide Fields popover:
   * a SUBTRACTION from the columns the view declares, never an addition (the
   * list draws `columns` minus these). The whole list the popover emits, so
   * an empty list is kept: it is "show every column", which is not the view's
   * authored `hiddenFields`. The view's own list is the default while this is
   * absent.
   */
  hiddenFields?: string[];
}

/** A user's state for one object: the `ui.list.<object>` row's value. */
export interface ObjectListPreference {
  viewOrder?: string[];
  perView?: Record<string, ListViewPreference>;
}

/** The family's key prefix; an object's row is `ui.list.<object>`. */
export const LIST_PREFERENCE_PREFIX = 'ui.list.';

/** The row key of one object's list state. */
export function listPreferenceKey(objectName: string): string {
  return `${LIST_PREFERENCE_PREFIX}${objectName}`;
}

const LOCAL_PREFIX = 'list-state';
const EMPTY: ObjectListPreference = Object.freeze({}) as ObjectListPreference;

// ---------------------------------------------------------------------------
// Pure helpers (exported for the pins)
// ---------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

function sanitizeSort(v: unknown): ListSortPreference[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: ListSortPreference[] = [];
  for (const item of v) {
    if (!isRecord(item) || typeof item.field !== 'string' || !item.field) continue;
    out.push({ field: item.field, order: item.order === 'desc' ? 'desc' : 'asc' });
  }
  return out;
}

function sanitizeFilters(v: unknown): ListFilterGroupPreference | undefined {
  if (!isRecord(v) || !Array.isArray(v.conditions) || v.conditions.length === 0) return undefined;
  return v as ListFilterGroupPreference;
}

function sanitizeColumnState(v: unknown): ListColumnStatePreference | undefined {
  if (!isRecord(v)) return undefined;
  const out: ListColumnStatePreference = {};
  if (isStringArray(v.order) && v.order.length > 0) out.order = [...v.order];
  if (isRecord(v.widths)) {
    const widths: Record<string, number> = {};
    for (const [k, w] of Object.entries(v.widths)) {
      if (typeof w === 'number' && Number.isFinite(w)) widths[k] = w;
    }
    if (Object.keys(widths).length > 0) out.widths = widths;
  }
  return out.order || out.widths ? out : undefined;
}

/** One of the spec's five row heights, or nothing. */
function sanitizeRowHeight(v: unknown): RowHeight | undefined {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ROW_HEIGHT_TO_DENSITY_MODE, v)
    ? (v as RowHeight)
    : undefined;
}

function sanitizeHiddenFields(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))];
}

function sanitizeView(v: unknown): ListViewPreference | undefined {
  if (!isRecord(v)) return undefined;
  const out: ListViewPreference = {};
  const sort = sanitizeSort(v.sort);
  if (sort) out.sort = sort;
  const filters = sanitizeFilters(v.filters);
  if (filters) out.filters = filters;
  const columnState = sanitizeColumnState(v.columnState);
  if (columnState) out.columnState = columnState;
  const rowHeight = sanitizeRowHeight(v.rowHeight);
  if (rowHeight) out.rowHeight = rowHeight;
  const hiddenFields = sanitizeHiddenFields(v.hiddenFields);
  if (hiddenFields) out.hiddenFields = hiddenFields;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Keep only the parts of a stored value this slot declares, well formed. */
export function sanitizeObjectListPreference(v: unknown): ObjectListPreference {
  if (!isRecord(v)) return {};
  const out: ObjectListPreference = {};
  if (isStringArray(v.viewOrder) && v.viewOrder.length > 0) out.viewOrder = [...v.viewOrder];
  if (isRecord(v.perView)) {
    const perView: Record<string, ListViewPreference> = {};
    for (const [viewId, view] of Object.entries(v.perView)) {
      const clean = sanitizeView(view);
      if (clean) perView[viewId] = clean;
    }
    if (Object.keys(perView).length > 0) out.perView = perView;
  }
  return out;
}

/**
 * A patch to one view's entry. A key present with `undefined` or `null` CLEARS
 * that part, and so does a filter group with no condition or a column state
 * with no order and no width. An empty sort is NOT a clear: `sort: []` is kept,
 * because a user who removed every sort level (the Sort builder emits `[]`)
 * chose "no sort", which is not the view's authored sort. The same holds for
 * `hiddenFields: []` ("show every column"). "Reset view" is the way back to
 * the view's own. A view left with nothing is removed.
 */
export type ListViewPreferencePatch = {
  sort?: ReadonlyArray<{ field: string; order?: string }> | null;
  filters?: ListFilterGroupPreference | null;
  columnState?: ListColumnStatePreference | null;
  rowHeight?: RowHeight | null;
  hiddenFields?: readonly string[] | null;
};

const VIEW_PREFERENCE_PARTS = ['sort', 'filters', 'columnState', 'rowHeight', 'hiddenFields'] as const;

/** Apply a patch to one view's entry of an object's state. Pure. */
export function patchViewPreference(
  state: ObjectListPreference,
  viewId: string,
  patch: ListViewPreferencePatch,
): ObjectListPreference {
  const current: Record<string, unknown> = { ...(state.perView?.[viewId] ?? {}) };
  for (const key of VIEW_PREFERENCE_PARTS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined || value === null) delete current[key];
    else current[key] = value;
  }
  const clean = sanitizeView(current);
  const perView = { ...(state.perView ?? {}) };
  if (clean) perView[viewId] = clean;
  else delete perView[viewId];
  const next: ObjectListPreference = { ...state };
  if (Object.keys(perView).length > 0) next.perView = perView;
  else delete next.perView;
  return next;
}

/**
 * Remove one view's entry — every part of it: the sort, filters, column state,
 * density and hidden fields (objectui#12474). Pure.
 */
export function resetViewPreference(state: ObjectListPreference, viewId: string): ObjectListPreference {
  if (!state.perView || !(viewId in state.perView)) return state;
  const perView = { ...state.perView };
  delete perView[viewId];
  const next: ObjectListPreference = { ...state };
  if (Object.keys(perView).length > 0) next.perView = perView;
  else delete next.perView;
  return next;
}

/** Set (or, with an empty list, clear) the object's tab order. Pure. */
export function setViewOrderPreference(state: ObjectListPreference, ids: readonly string[]): ObjectListPreference {
  const next: ObjectListPreference = { ...state };
  if (ids.length > 0) next.viewOrder = [...ids];
  else delete next.viewOrder;
  return next;
}

// ---------------------------------------------------------------------------
// localStorage: the write-through cache and the no-adapter fallback
// ---------------------------------------------------------------------------

/** The cache key of one user's state for one object. */
export function localListStateKey(userId: string | null | undefined, objectName: string): string {
  return `${LOCAL_PREFIX}:${userId || 'anon'}:${objectName}`;
}

/**
 * The object's older keys, folded into one state: the tab order the reorder
 * used to write (`viewOrder:<object>`, per browser) and each view's Filter
 * panel group (`list-filters:<user>:<object>:<view>`, `listFilterStorage`).
 */
function foldLegacy(userId: string | null | undefined, objectName: string): ObjectListPreference {
  let state: ObjectListPreference = {};
  try {
    const rawOrder = localStorage.getItem(`viewOrder:${objectName}`);
    const order = rawOrder ? JSON.parse(rawOrder) : undefined;
    if (isStringArray(order)) state = setViewOrderPreference(state, order);
  } catch {
    /* unreadable — nothing to fold */
  }
  try {
    const prefix = `list-filters:${userId || 'anon'}:${objectName}:`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const viewId = key.slice(prefix.length);
      const raw = localStorage.getItem(key);
      const parsed = raw ? JSON.parse(raw) : undefined;
      if (viewId && isRecord(parsed)) {
        state = patchViewPreference(state, viewId, { filters: parsed.filters as ListFilterGroupPreference });
      }
    }
  } catch {
    /* unreadable — nothing to fold */
  }
  return state;
}

/**
 * This browser's cached state for the object. With no cached entry yet, the
 * object's older keys are folded instead (read only: the fold is written the
 * first time the state changes, so it stays the fold until then).
 */
export function readLocalListState(userId: string | null | undefined, objectName: string): ObjectListPreference {
  if (!objectName || typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(localListStateKey(userId, objectName));
    if (raw != null) return sanitizeObjectListPreference(JSON.parse(raw));
  } catch {
    return {};
  }
  return foldLegacy(userId, objectName);
}

/** Write the object's state to this browser's cache. Never throws. */
export function writeLocalListState(
  userId: string | null | undefined,
  objectName: string,
  state: ObjectListPreference,
): void {
  if (!objectName || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(localListStateKey(userId, objectName), JSON.stringify(state));
  } catch {
    /* quota / private mode — the cache is best-effort */
  }
}

// ---------------------------------------------------------------------------
// Context + provider
// ---------------------------------------------------------------------------

interface ListPreferencesContextValue {
  /** Objects whose state this session holds (remote rows and local writes). */
  states: Record<string, ObjectListPreference>;
  /**
   * The signed-in user's state has been read: the attached family's first load
   * has settled, or the wait for it ran out. Always true with no user.
   */
  ready: boolean;
  update(objectName: string, fn: (prev: ObjectListPreference) => ObjectListPreference): void;
}

const ListPreferencesContext = createContext<ListPreferencesContextValue | null>(null);

/**
 * How long a list waits for the preference read before it opens on this
 * browser's cache. The read is the console's one load-time read, sent at boot
 * beside the metadata reads, so it has normally answered before a list can
 * render; this only bounds a stalled request.
 */
export const LIST_PREFERENCES_WAIT_MS = 2500;

const SAVE_DEBOUNCE_MS = 500;

type ListFamily = UserPreferenceFamily<ObjectListPreference>;

export function ListPreferencesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const family = useListStateFamily<ObjectListPreference>();

  const [states, setStates] = useState<Record<string, ObjectListPreference>>({});
  const statesRef = useRef(states);
  statesRef.current = states;
  // The family whose first load has settled (or whose wait ran out).
  const [settledFor, setSettledFor] = useState<ListFamily | null>(null);

  // Hydrate when a family attaches (a sign-in, a user switch): the remote rows
  // are the user's state on every device, written through to this browser's
  // cache. What the previous user's session held is dropped first.
  useEffect(() => {
    statesRef.current = {};
    setStates({});
    if (!family) return;
    let cancelled = false;
    const wait = setTimeout(() => {
      if (!cancelled) setSettledFor((prev) => (prev === family ? prev : family));
    }, LIST_PREFERENCES_WAIT_MS);
    void family.load().then((rows) => {
      if (cancelled) return;
      const remote: Record<string, ObjectListPreference> = {};
      for (const [key, value] of Object.entries(rows)) {
        if (!key.startsWith(LIST_PREFERENCE_PREFIX)) continue;
        const objectName = key.slice(LIST_PREFERENCE_PREFIX.length);
        const clean = sanitizeObjectListPreference(value);
        remote[objectName] = clean;
        writeLocalListState(userId, objectName, clean);
      }
      statesRef.current = { ...statesRef.current, ...remote };
      setStates((prev) => ({ ...prev, ...remote }));
      setSettledFor(family);
    });
    return () => {
      cancelled = true;
      clearTimeout(wait);
    };
  }, [family, userId]);

  // Debounced remote writes, one per object, each bound to the family that
  // was attached when it was made (a user switch flushes to the right user).
  const pendingRef = useRef(
    new Map<string, { timer: ReturnType<typeof setTimeout>; value: ObjectListPreference; family: ListFamily }>(),
  );
  const flushOne = useCallback((objectName: string) => {
    const pending = pendingRef.current.get(objectName);
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingRef.current.delete(objectName);
    void pending.family.save(listPreferenceKey(objectName), pending.value);
  }, []);
  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const objectName of [...pending.keys()]) flushOne(objectName);
    };
  }, [family, flushOne]);

  const update = useCallback(
    (objectName: string, fn: (prev: ObjectListPreference) => ObjectListPreference) => {
      if (!objectName) return;
      const prev = statesRef.current[objectName] ?? readLocalListState(userId, objectName);
      const next = fn(prev);
      if (next === prev) return;
      statesRef.current = { ...statesRef.current, [objectName]: next };
      setStates((s) => ({ ...s, [objectName]: next }));
      writeLocalListState(userId, objectName, next);
      if (!family) return;
      const existing = pendingRef.current.get(objectName);
      if (existing) clearTimeout(existing.timer);
      pendingRef.current.set(objectName, {
        value: next,
        family,
        timer: setTimeout(() => flushOne(objectName), SAVE_DEBOUNCE_MS),
      });
    },
    [userId, family, flushOne],
  );

  // A signed-in user's family is attached by the console's bridge in the
  // first commit's effects, so the page's first render runs before it: until
  // it attaches (or the same wait runs out, for a host with no bridge), there
  // is no state to open a list on yet. With no user there is none to wait for.
  const [noFamilyWaitOverFor, setNoFamilyWaitOverFor] = useState<string | null>(null);
  useEffect(() => {
    if (family || !userId) return;
    const wait = setTimeout(() => setNoFamilyWaitOverFor(userId), LIST_PREFERENCES_WAIT_MS);
    return () => clearTimeout(wait);
  }, [family, userId]);

  const ready = !userId
    ? true
    : family
      ? settledFor === family
      : noFamilyWaitOverFor === userId;
  const value = useMemo<ListPreferencesContextValue>(
    () => ({ states, ready, update }),
    [states, ready, update],
  );

  return <ListPreferencesContext.Provider value={value}>{children}</ListPreferencesContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface ObjectListPreferences {
  /**
   * The user's stored state for this object has been read (or there is none
   * to wait for). A list opens on its stored state, so it waits for this.
   */
  ready: boolean;
  /** The user's state for this object; `{}` when they have none. */
  preference: ObjectListPreference;
  /** Store the user's tab order. */
  setViewOrder(ids: readonly string[]): void;
  /** Store (or clear, see {@link ListViewPreferencePatch}) part of one view's state. */
  patchView(viewId: string, patch: ListViewPreferencePatch): void;
  /** Drop one view's whole entry (sort, filters, columns, density, hidden fields): back to the view's own. */
  resetView(viewId: string): void;
}

/**
 * The signed-in user's list state for one object.
 *
 * Inside {@link ListPreferencesProvider} it is the cloud-synced state. Outside
 * one (a host without the console shell, unit tests) it is this browser's
 * cache alone, the same localStorage the provider writes through.
 */
export function useObjectListPreferences(objectName: string | undefined): ObjectListPreferences {
  const ctx = useContext(ListPreferencesContext);
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const name = objectName ?? '';

  // What the session holds for the object, else this browser's cache. The
  // cache read is keyed on what it reads, and re-read after a fallback write.
  const held = ctx?.states[name];
  const [localWrites, setLocalWrites] = useState(0);
  const cached = useMemo(
    () => (held ? EMPTY : readLocalListState(userId, name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `localWrites` re-reads after a fallback write
    [held, userId, name, localWrites],
  );
  const preference = held ?? cached;

  const update = useCallback(
    (fn: (prev: ObjectListPreference) => ObjectListPreference) => {
      if (!name) return;
      if (ctx) {
        ctx.update(name, fn);
        return;
      }
      const prev = readLocalListState(userId, name);
      const next = fn(prev);
      if (next === prev) return;
      writeLocalListState(userId, name, next);
      setLocalWrites((n) => n + 1);
    },
    [ctx, name, userId],
  );

  const setViewOrder = useCallback(
    (ids: readonly string[]) => update((prev) => setViewOrderPreference(prev, ids)),
    [update],
  );
  const patchView = useCallback(
    (viewId: string, patch: ListViewPreferencePatch) => {
      if (!viewId) return;
      update((prev) => patchViewPreference(prev, viewId, patch));
    },
    [update],
  );
  const resetView = useCallback(
    (viewId: string) => update((prev) => resetViewPreference(prev, viewId)),
    [update],
  );

  return {
    ready: ctx ? ctx.ready : true,
    preference,
    setViewOrder,
    patchView,
    resetView,
  };
}
