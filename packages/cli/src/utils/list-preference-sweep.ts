// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The plan behind `os migrate list-preferences`: the `sys_user_preference`
 * rows an earlier Console kept a reader's list state in, one per object, keyed
 * `ui.list.<object>` (#35955).
 *
 * The Console stopped reading and writing that key family when the column
 * widths, the row height and the view-tab order moved into the reader's
 * browser (the sorts, filters and columns it also held had become a list's
 * unsaved draft before that). The maintainer ruled that the stored rows are
 * not migrated anywhere: they are cleared («清掉»), by an upgrade command, and
 * this module is that command's reading of them.
 *
 * ## The family, and nothing beside it
 *
 * A row belongs to the family when its key STARTS WITH `ui.list.`, the dot
 * included ({@link isListPreferenceKey}), compared byte for byte. Measured on
 * the Console that wrote the family (`ListPreferencesProvider`, removed by the
 * change that retired it): every key it wrote was that prefix plus an object
 * name, and no other preference key the platform writes starts with it —
 * `ui.record.<object>`, `ui.recent`, `ui.favorites`, `ui.app.last` and
 * `ui.flow.palette.recents` are other families and are never touched.
 *
 * The read may ask the driver for the prefix (`$startsWith`), which narrows
 * what is read and decides nothing: a SQL `LIKE` can match more than the
 * prefix (SQLite compares ASCII without case), so every row read is judged
 * again by {@link isListPreferenceKey}, and only rows that predicate admits
 * are counted, exported or deleted.
 *
 * Read-only by construction: nothing here holds a write verb.
 */

/** The key prefix of the retired family; an object's row was `ui.list.<object>`. */
export const LIST_PREFERENCE_PREFIX = 'ui.list.';

/** The object the family is stored in. */
export const LIST_PREFERENCE_OBJECT = 'sys_user_preference';

/** Does this stored key belong to the retired family? Byte-exact, the trailing dot included. */
export function isListPreferenceKey(key: unknown): key is string {
  return typeof key === 'string' && key.startsWith(LIST_PREFERENCE_PREFIX);
}

/** The read port the plan needs: a driver's `find`. */
export interface ListPreferenceReader {
  find(object: string, query: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

/**
 * Every stored row of the family, read from the driver and UNSCOPED: every
 * organization and every user. A filter in front of this read subtracts rows,
 * and a row missing from it is a row the report never mentions.
 */
export async function readListPreferenceRows(reader: ListPreferenceReader): Promise<Record<string, unknown>[]> {
  const rows = await reader.find(LIST_PREFERENCE_OBJECT, {
    where: { key: { $startsWith: LIST_PREFERENCE_PREFIX } },
  });
  return rows.filter((row) => isListPreferenceKey(row.key));
}

/** One key of the family and how many rows and readers hold it. */
export interface ListPreferenceKeyCount {
  key: string;
  rows: number;
  users: number;
}

/** What the family holds on this database: counts only, never a value. */
export interface ListPreferencePlan {
  object: typeof LIST_PREFERENCE_OBJECT;
  prefix: typeof LIST_PREFERENCE_PREFIX;
  counts: { rows: number; users: number; organizations: number };
  /** Per key, sorted by key. */
  byKey: ListPreferenceKeyCount[];
}

/** Count what the rows hold, per key and in total. */
export function planListPreferenceSweep(rows: readonly Record<string, unknown>[]): ListPreferencePlan {
  const users = new Set<string>();
  const organizations = new Set<string>();
  const perKey = new Map<string, { rows: number; users: Set<string> }>();
  for (const row of rows) {
    const key = String(row.key);
    const user = String(row.user_id ?? '');
    users.add(user);
    organizations.add(String(row.organization_id ?? ''));
    const entry = perKey.get(key) ?? { rows: 0, users: new Set<string>() };
    entry.rows += 1;
    entry.users.add(user);
    perKey.set(key, entry);
  }
  return {
    object: LIST_PREFERENCE_OBJECT,
    prefix: LIST_PREFERENCE_PREFIX,
    counts: { rows: rows.length, users: users.size, organizations: organizations.size },
    byKey: [...perKey.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => ({ key, rows: entry.rows, users: entry.users.size })),
  };
}

/** The pre-delete export: every row the run deletes, as the driver stored it. */
export interface ListPreferenceExport {
  format: 'objectstack.list-preferences.pre-delete-export.v1';
  generatedAt: string;
  producedBy: string;
  object: typeof LIST_PREFERENCE_OBJECT;
  prefix: typeof LIST_PREFERENCE_PREFIX;
  warning: string;
  rows: Record<string, unknown>[];
}

export function buildListPreferenceExport(input: {
  rows: readonly Record<string, unknown>[];
  producedBy: string;
  now?: () => Date;
}): ListPreferenceExport {
  return {
    format: 'objectstack.list-preferences.pre-delete-export.v1',
    generatedAt: (input.now?.() ?? new Date()).toISOString(),
    producedBy: input.producedBy,
    object: LIST_PREFERENCE_OBJECT,
    prefix: LIST_PREFERENCE_PREFIX,
    warning:
      'This file holds every sys_user_preference row the run deleted, as stored: each reader\'s list state, which '
      + 'can include filter values. Nothing reads it back into the platform. Protect it as you protect a database '
      + 'backup, and delete it once you are certain the sweep was correct.',
    rows: [...input.rows],
  };
}

/** The ids a read-back export holds — the check made before the first delete. */
export function exportedIds(doc: Partial<ListPreferenceExport> | null | undefined): Set<string> {
  const ids = new Set<string>();
  for (const row of doc?.rows ?? []) {
    if (row && typeof row === 'object' && row.id !== undefined && row.id !== null && isListPreferenceKey(row.key)) {
      ids.add(String(row.id));
    }
  }
  return ids;
}
