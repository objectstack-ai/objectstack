// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reader's own views of an object's list, My views (objectstack#29635).
 *
 * A personal view is a row of `sys_personal_view`, USER DATA and not view
 * metadata (`@objectstack/platform-objects`' docblock on the object says what
 * the row is and is not): its owner (`user_id`), the object it lists
 * (`object_name`), the name the owner gave it (`label`) and the list body
 * (`config`, spec's `ListView`, which the server validates on every save and
 * refuses with `400` when its `data.object` names another object).
 *
 * The doors, each the one the server offers a member for that act:
 * - **read, create, rename** through the data API as the owner
 *   (`dataSource.find` / `create` / `update` on `sys_personal_view`);
 * - **delete** through the owner's own-row door,
 *   `DELETE /api/v1/personal-views/:id` ({@link PERSONAL_VIEW_DELETE_PATH}).
 *   Never the data door's `delete`: no shipped set grants delete on the
 *   object, so it answers a member `403`.
 *
 * Which view opens by default is not stored here: the reader's existing
 * per-object pin (`LIST_PINNED_VIEW_PREFERENCE`) holds a view id, and a
 * personal view's id is one more value it can hold. The id is the engine's
 * record id, which never carries a `.`, so it is never read as the
 * `object.key` name of a package view.
 *
 * A reader the server grants nothing (an external member today) gets a
 * refused read: the group and Save as my view are then not offered, and no
 * error is drawn.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createAuthenticatedFetch } from '@object-ui/auth';
import type { FilterBuilderRowGroup } from '@object-ui/components';
import { builderRulesOfSpecFilter } from '@object-ui/core';
import type { usePermissions } from '@object-ui/permissions';
import type { DataSource } from '@object-ui/types';
import { foldFilterGroupToSpecRules, type FilterFoldRefusal } from './viewFilterFold.js';
import { buildViewConfigSaveBody } from './objectViewTabs.js';
import type { ListSortRule, ListUrlState } from './userFilterUrlState.js';
import type { ListViewPreference } from '../context/ListPreferencesProvider.js';

/** The object a personal view is a row of. */
export const PERSONAL_VIEW_OBJECT = 'sys_personal_view';

/**
 * The owner's own-row delete door, `DELETE` + `/:id` (plugin-auth's
 * `personal-view-routes.ts`). It removes the caller's own row only: another
 * member's id answers `404`, and it reads no body and refuses any query
 * parameter.
 */
export const PERSONAL_VIEW_DELETE_PATH = '/api/v1/personal-views';

const NO_VIEWS: PersonalView[] = [];

/** How many of the reader's views of one object the list reads. */
const PERSONAL_VIEW_READ_LIMIT = 200;

/** One of the reader's views, as the list reads it. */
export interface PersonalView {
  id: string;
  label: string;
  /** The stored `ListView` body. */
  config: Record<string, unknown>;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** A lookup column arrives as the id, or as the expanded record. */
function refId(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value;
  if (isRecord(value) && typeof value.id === 'string' && value.id) return value.id;
  return undefined;
}

/** A JSON column can arrive as text (a driver round trip): read it as JSON. */
function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The rows that are the reader's own views of this object, in the order read.
 * A row of another owner or another object is dropped: the platform
 * administrator's wildcard reads every member's rows, and this list is the
 * reader's own.
 */
export function readPersonalViewRows(rows: unknown, objectName: string, userId: string): PersonalView[] {
  if (!Array.isArray(rows)) return [];
  const views: PersonalView[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (row.object_name !== objectName || refId(row.user_id) !== userId) continue;
    const config = jsonRecord(row.config);
    if (typeof row.id !== 'string' || !row.id || typeof row.label !== 'string' || !config) continue;
    views.push({ id: row.id, label: row.label, config });
  }
  return views;
}

/**
 * A personal view as an entry of the list's views: its stored body, keyed by
 * its row id and named by the name its owner gave it. A body that declares no
 * `type` is a grid, as `ListViewSchema` reads it.
 */
export function personalViewEntry(view: PersonalView): Record<string, any> {
  return {
    ...view.config,
    type: typeof view.config.type === 'string' ? view.config.type : 'grid',
    id: view.id,
    label: view.label,
  };
}

/**
 * A personal view's own conditions as Filter panel rows (objectstack#30073):
 * the view is the reader's own, so its conditions are shown and edited where
 * the reader filters, and a 保存 writes the panel back as the view's filter.
 *
 * `undefined` keeps the conditions where every other view keeps them, applied
 * under the list and not drawn as rows:
 * - the view declares no condition;
 * - the stored list is one the panel cannot hold (`builderRulesOfSpecFilter`
 *   reads `null`: an any-of group beside other conditions), or an element is
 *   not a flat rule naming a field;
 * - a condition names a field `acceptField` refuses (one the object no longer
 *   declares, or the reader cannot read). The list state the panel writes is
 *   read back through that same gate, which would drop the row, and the view
 *   would then select more records than it declares.
 *
 * The rows carry the stored operator and value as authored; the fold that
 * saves them (`foldFilterGroupToSpecRules`) writes them back unchanged.
 */
export function personalViewPanelFilters(
  config: Record<string, unknown> | undefined,
  acceptField: (field: string) => boolean,
): FilterBuilderRowGroup | undefined {
  const stored = config?.filter;
  if (!Array.isArray(stored) || stored.length === 0) return undefined;
  const shown = builderRulesOfSpecFilter(stored);
  if (!shown || shown.rules.length === 0) return undefined;
  const conditions: FilterBuilderRowGroup['conditions'] = [];
  for (const [i, rule] of shown.rules.entries()) {
    if (!isRecord(rule) || typeof rule.field !== 'string' || !rule.field || !acceptField(rule.field)) return undefined;
    conditions.push({
      id: `view-${i}`,
      field: rule.field,
      operator: typeof rule.operator === 'string' ? rule.operator : 'equals',
      value: (rule.value ?? '') as FilterBuilderRowGroup['conditions'][number]['value'],
    } as FilterBuilderRowGroup['conditions'][number]);
  }
  return { id: 'root', logic: shown.logic, conditions };
}

/** What the list on screen holds beyond its view's own body. */
export interface PersonalViewListState {
  /** The toolbar state the address carries (`uf_*`); an absent part is the view's own. */
  url: Pick<ListUrlState, 'filters' | 'sort' | 'grouping'>;
  /** The reader's stored state for the view (`ui.list.<object>`), if any. */
  preference?: ListViewPreference;
  /**
   * The open view's own conditions when the Filter panel holds them as rows
   * ({@link personalViewPanelFilters}): the panel is then the WHOLE filter,
   * the view's conditions included, and is not laid over them a second time.
   */
  panelFilters?: FilterBuilderRowGroup;
}

/** The column a `columns` entry names: a bare name, or an entry's `field`. */
function columnName(column: unknown): string | undefined {
  if (typeof column === 'string') return column;
  if (isRecord(column) && typeof column.field === 'string') return column.field;
  return undefined;
}

/**
 * The `ListView` body Save as my view stores: the open view's own body with
 * the list on screen laid over it.
 *
 * - **filter**: the view's own conditions AND the Filter panel's, folded to
 *   spec rules by the one fold every explicit save uses
 *   (`foldFilterGroupToSpecRules`). A group it cannot fold losslessly (a
 *   nested group) refuses the save instead of storing another record set.
 *   When the panel holds the view's own conditions (`state.panelFilters`),
 *   the panel alone is the filter: the reader may have edited or removed one.
 * - **sort** and **grouping**: the ones the address carries; absent there,
 *   the view's own.
 * - **columns**: the view's, in the reader's dragged order, without the
 *   columns they hid (so `hiddenFields` and `fieldOrder` are applied, not
 *   carried). **rowHeight**: the reader's density, else the view's.
 *
 * The body is narrowed to the keys spec's closed `ListViewSchema` declares and
 * bound to this object (`config.data.object`) by `buildViewConfigSaveBody`,
 * the shape the view config panel saves, so it is the body the server
 * validates. The search term and the chips are a session's, and not stored.
 */
export function buildPersonalViewConfig(
  objectName: string,
  view: Record<string, any>,
  state: PersonalViewListState,
): { ok: true; config: Record<string, unknown> } | { ok: false; reason: FilterFoldRefusal } {
  const own: unknown[] = Array.isArray(view.filter) ? view.filter : [];
  let filter: unknown[];
  if (state.panelFilters && state.url.filters === undefined) {
    // The panel holds the view's own conditions and the reader has not
    // touched it: the stored list is kept as it is.
    filter = own;
  } else {
    const folded = foldFilterGroupToSpecRules(state.url.filters);
    if (!folded.ok) return { ok: false, reason: folded.reason };
    filter = state.panelFilters ? folded.rules : [...own, ...folded.rules];
  }

  const pref = state.preference;
  const hidden = new Set<string>(pref?.hiddenFields ?? (Array.isArray(view.hiddenFields) ? view.hiddenFields : []));
  const order = pref?.columnState?.order ?? (Array.isArray(view.fieldOrder) ? view.fieldOrder : undefined);
  let columns: unknown[] | undefined = Array.isArray(view.columns) ? [...view.columns] : undefined;
  if (columns) {
    if (order && order.length > 0) {
      const rank = new Map(order.map((name: string, i: number) => [name, i]));
      const at = (c: unknown) => rank.get(columnName(c) ?? '') ?? Number.MAX_SAFE_INTEGER;
      columns = columns
        .map((c, i) => ({ c, i }))
        .sort((a, b) => at(a.c) - at(b.c) || a.i - b.i)
        .map(({ c }) => c);
    }
    columns = columns.filter((c) => !hidden.has(columnName(c) ?? ''));
  }

  const sort: ListSortRule[] | undefined = state.url.sort ?? view.sort;
  const draft: Record<string, unknown> = {
    ...view,
    id: view.id,
    filter: filter.length > 0 ? filter : undefined,
    sort,
    grouping: state.url.grouping ?? view.grouping,
    columns,
    hiddenFields: undefined,
    fieldOrder: undefined,
    rowHeight: pref?.rowHeight ?? view.rowHeight,
  };
  return { ok: true, config: buildViewConfigSaveBody(objectName, draft).config };
}

/** The read's state: `off` (nothing read), `loading`, `ready`, or `refused`. */
export type PersonalViewsStatus = 'off' | 'loading' | 'ready' | 'refused';

/** The server's own words for a refused door call, else its status. */
async function doorRefusal(res: Response): Promise<Error> {
  let message: string | undefined;
  try {
    const body: unknown = await res.json();
    const error = isRecord(body) ? body.error : undefined;
    if (isRecord(error) && typeof error.message === 'string') message = error.message;
    else if (isRecord(body) && typeof body.message === 'string') message = body.message;
  } catch {
    // No JSON body: the status says it.
  }
  return new Error(message ?? `HTTP ${res.status}`);
}

/**
 * The reader's own views of `objectName`, and the three writes on them.
 *
 * Read once per object and reader, and again after each of these writes
 * (nothing else writes the reader's rows from this page). Nothing is read without a signed-in reader, or when
 * the reader's loaded permissions refuse `read` on the object; a read the
 * server refuses reads as `refused`, never as an error on screen.
 */
export function usePersonalViews({
  dataSource,
  objectName,
  userId,
  perms,
}: {
  dataSource: DataSource;
  objectName: string | undefined;
  userId: string | undefined;
  perms: ReturnType<typeof usePermissions>;
}) {
  const readable =
    !!objectName
    && !!userId
    && typeof dataSource?.find === 'function'
    && !(perms.isLoaded && !perms.can(PERSONAL_VIEW_OBJECT, 'read'));
  const [generation, setGeneration] = useState(0);
  // The object and reader a read answers for, and the read itself (a refresh
  // or a write reads the same scope again).
  const scopeKey = readable ? JSON.stringify([objectName, userId]) : '';
  const readKey = readable ? JSON.stringify([objectName, userId, generation]) : '';
  const [read, setRead] = useState<{ scope: string; status: PersonalViewsStatus; views: PersonalView[] }>({
    scope: '',
    status: 'off',
    views: [],
  });

  useEffect(() => {
    if (!readKey) return;
    // A read of a new scope reads as `loading` until it lands (the derived
    // `status` below); a read again of the same scope keeps its views on
    // screen meanwhile.
    let cancelled = false;
    dataSource
      .find(PERSONAL_VIEW_OBJECT, {
        $filter: { object_name: objectName, user_id: userId },
        $orderby: { created_at: 'asc' },
        $top: PERSONAL_VIEW_READ_LIMIT,
      })
      .then((res: { data?: unknown } | undefined) => {
        if (cancelled) return;
        setRead({ scope: scopeKey, status: 'ready', views: readPersonalViewRows(res?.data, objectName!, userId!) });
      })
      .catch(() => {
        // A refused read (no grant on the object) hides the feature; it is
        // not the list's error.
        if (!cancelled) setRead({ scope: scopeKey, status: 'refused', views: [] });
      });
    return () => {
      cancelled = true;
    };
    // `readKey` carries every input the read is keyed on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readKey, dataSource]);

  // A read for another object or reader is not this one's answer.
  const status: PersonalViewsStatus = !readable ? 'off' : read.scope === scopeKey ? read.status : 'loading';
  const views = status === 'ready' ? read.views : NO_VIEWS;

  const authFetch = useMemo(() => createAuthenticatedFetch({ sameOriginOnly: true }), []);
  /**
   * A write the server accepted shows at once (so the list can open a view
   * it just saved), then the rows are read again: the read is the answer.
   */
  const settle = useCallback(
    (change: (views: PersonalView[]) => PersonalView[]) => {
      setRead((prev) => (prev.scope === scopeKey && prev.status === 'ready' ? { ...prev, views: change(prev.views) } : prev));
      setGeneration((g) => g + 1);
    },
    [scopeKey],
  );

  /** Save a new view; resolves its row id. */
  const save = useCallback(
    async (label: string, config: Record<string, unknown>): Promise<string> => {
      const created: { id?: unknown } | undefined = await dataSource.create(PERSONAL_VIEW_OBJECT, {
        user_id: userId,
        object_name: objectName,
        label,
        config,
      });
      const id = created?.id;
      if (typeof id !== 'string' || !id) {
        settle((views) => views);
        throw new Error('The view was saved without an id, so it cannot be opened.');
      }
      settle((views) => [...views.filter((v) => v.id !== id), { id, label, config }]);
      return id;
    },
    [dataSource, objectName, userId, settle],
  );

  /**
   * Save the list on screen back into one of the reader's views (保存,
   * objectstack#30073): the row's `config` replaced by a body built the way
   * Save as my view builds one, so the stored shape is the same.
   */
  const update = useCallback(
    async (id: string, config: Record<string, unknown>): Promise<void> => {
      await dataSource.update(PERSONAL_VIEW_OBJECT, id, { config });
      settle((views) => views.map((v) => (v.id === id ? { ...v, config } : v)));
    },
    [dataSource, settle],
  );

  /** Rename one of the reader's views. */
  const rename = useCallback(
    async (id: string, label: string): Promise<void> => {
      await dataSource.update(PERSONAL_VIEW_OBJECT, id, { label });
      settle((views) => views.map((v) => (v.id === id ? { ...v, label } : v)));
    },
    [dataSource, settle],
  );

  /** Delete one of the reader's views, through the owner's own-row door. */
  const remove = useCallback(
    async (id: string): Promise<void> => {
      const res = await authFetch(
        `${import.meta.env?.VITE_SERVER_URL || ''}${PERSONAL_VIEW_DELETE_PATH}/${encodeURIComponent(id)}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw await doorRefusal(res);
      settle((views) => views.filter((v) => v.id !== id));
    },
    [authFetch, settle],
  );

  return { status, views, save, update, rename, remove };
}
