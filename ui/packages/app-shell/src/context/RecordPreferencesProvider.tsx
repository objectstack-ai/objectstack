/**
 * RecordPreferencesProvider — a console user's own record-page choices, per
 * object (objectstack#25883).
 *
 * The one choice today is "show empty fields": a section's "Show N empty
 * fields" row used to open that one section until the page unmounted, so a
 * reader who wanted the whole record clicked once per section, on every
 * record, after every reload. It is now the reader's choice for the object:
 * one click shows the empty fields of every section of that object's record
 * page, on every record of it, on any device.
 *
 * ## Where it is kept
 *
 * One `sys_user_preference` row per object, key `ui.record.<object>`, beside
 * the list page's `ui.list.<object>` (objectui#12418) and through the same
 * mechanism: a key family the console's `UserStateBridge` attaches, loaded by
 * prefix in the console's ONE preference read per load, each object's row
 * written on its own.
 *
 * ```json
 * { "showEmptyFields": true,
 *   "relatedLists": { "<child>.<field>": { "sort": {…}, "columnState": {…} } } }
 * ```
 *
 * The renderers read it through `@object-ui/react`'s
 * `RecordPagePreferencesProvider`, the seam a registry-rendered record page
 * can reach without depending on this package.
 *
 * ## With no family attached
 *
 * No signed-in user, or a host without the bridge: the provider hands the
 * renderers no store at all, and each section keeps the toggle in its own
 * state, as before. There is no browser-local copy: the choice is either the
 * user's, stored with their other preferences, or the section's own.
 *
 * @module
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  RecordPagePreferencesProvider,
  type RecordPagePreference,
  type RecordPagePreferencesStore,
  type RelatedListPreference,
} from '@object-ui/react';
import { useRecordStateFamily } from './UserStateAdapters.js';

/** The family's key prefix; an object's row is `ui.record.<object>`. */
export const RECORD_PREFERENCE_PREFIX = 'ui.record.';

/** The row key of one object's record-page state. */
export function recordPreferenceKey(objectName: string): string {
  return `${RECORD_PREFERENCE_PREFIX}${objectName}`;
}

const EMPTY: RecordPagePreference = Object.freeze({}) as RecordPagePreference;

/** Keep only the parts of a stored value this slot declares, well formed. */
export function sanitizeRecordPreference(v: unknown): RecordPagePreference {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: RecordPagePreference = {};
  const show = (v as Record<string, unknown>).showEmptyFields;
  if (typeof show === 'boolean') out.showEmptyFields = show;
  const lists = sanitizeRelatedLists((v as Record<string, unknown>).relatedLists);
  if (lists) out.relatedLists = lists;
  return out;
}

/** The related tab's remembered sort and column widths, per list (objectstack#35601), well formed. */
function sanitizeRelatedLists(v: unknown): Record<string, RelatedListPreference> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const out: Record<string, RelatedListPreference> = {};
  for (const [id, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const entry: RelatedListPreference = {};
    const sort = (raw as Record<string, unknown>).sort as { field?: unknown; order?: unknown } | undefined;
    if (sort && typeof sort.field === 'string' && sort.field !== '' && (sort.order === 'asc' || sort.order === 'desc')) {
      entry.sort = { field: sort.field, order: sort.order };
    }
    const columns = (raw as Record<string, unknown>).columnState as { order?: unknown; widths?: unknown } | undefined;
    if (columns && typeof columns === 'object') {
      const state: NonNullable<RelatedListPreference['columnState']> = {};
      if (Array.isArray(columns.order)) state.order = columns.order.filter((k): k is string => typeof k === 'string');
      if (columns.widths && typeof columns.widths === 'object' && !Array.isArray(columns.widths)) {
        const widths: Record<string, number> = {};
        for (const [k, w] of Object.entries(columns.widths as Record<string, unknown>)) {
          if (typeof w === 'number' && Number.isFinite(w) && w > 0) widths[k] = w;
        }
        state.widths = widths;
      }
      entry.columnState = state;
    }
    if (entry.sort || entry.columnState) out[id] = entry;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function RecordPreferencesProvider({ children }: { children: ReactNode }) {
  const family = useRecordStateFamily<RecordPagePreference>();
  const [states, setStates] = useState<Record<string, RecordPagePreference>>({});
  const statesRef = useRef(states);
  statesRef.current = states;

  // Hydrate when a family attaches (a sign-in, a user switch). What the
  // previous user's session held is dropped first. A choice made before the
  // read answered is newer than the stored row, so it is kept over it.
  useEffect(() => {
    statesRef.current = {};
    setStates({});
    if (!family) return;
    let cancelled = false;
    void family.load().then((rows) => {
      if (cancelled) return;
      const remote: Record<string, RecordPagePreference> = {};
      for (const [key, value] of Object.entries(rows)) {
        if (!key.startsWith(RECORD_PREFERENCE_PREFIX)) continue;
        remote[key.slice(RECORD_PREFERENCE_PREFIX.length)] = sanitizeRecordPreference(value);
      }
      statesRef.current = { ...remote, ...statesRef.current };
      setStates(statesRef.current);
    });
    return () => {
      cancelled = true;
    };
  }, [family]);

  const update = useCallback(
    (objectName: string, patch: RecordPagePreference) => {
      if (!family || !objectName) return;
      const prev = statesRef.current[objectName] ?? EMPTY;
      const next = sanitizeRecordPreference({ ...prev, ...patch });
      statesRef.current = { ...statesRef.current, [objectName]: next };
      setStates(statesRef.current);
      // One click is one write; the family runs the writes to one key in order.
      void family.save(recordPreferenceKey(objectName), next);
    },
    [family],
  );

  const store = useMemo<RecordPagePreferencesStore | null>(
    () => (family ? { get: (objectName) => states[objectName] ?? EMPTY, update } : null),
    [family, states, update],
  );

  return <RecordPagePreferencesProvider value={store}>{children}</RecordPagePreferencesProvider>;
}
