// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * historyActors — the names behind the actor ids an item's history records
 * (ADR-0146 D1).
 *
 * A history event's `actor` is `sys_metadata_history.recorded_by`, a lookup to
 * `sys_user` that stores the user's id (`null` for a write no person made). The
 * timeline used to print that id, which tells an administrator choosing a
 * version to roll back to nothing about who changed it. This hook asks the
 * directory once for every distinct id on the timeline and answers, per id:
 *
 *   - `{ kind: 'resolved', name }` — the user's row came back with a name;
 *   - `{ kind: 'unresolved' }` — the read answered without that row (the user
 *     was deleted), or the read itself failed, or there is no adapter to ask.
 *     The panel then shows the id, marked as unresolved. It never says "deleted":
 *     a refused read and a missing row look the same from here, and naming the
 *     wrong one would be a made-up fact on an audit surface;
 *   - absent from the map — still being asked. The panel shows the plain id.
 *
 * One read per set of ids not yet answered, batched with `$in`, the shape
 * `useApproverDirectory` reads `sys_user` with. Answers are kept for the
 * lifetime of the panel, so a refresh that brings one new event asks only for
 * the id that event adds.
 *
 * @module
 */

import { useEffect, useMemo, useState } from 'react';
import { useAdapter } from '@object-ui/react';
import { PERSON_DISPLAY_FIELDS, rowLabel } from '../../utils/approverIdentity.js';

export type HistoryActorName = { kind: 'resolved'; name: string } | { kind: 'unresolved' };

const PERSON_OBJECT = 'sys_user';

/** The rows of a `find` answer: the adapter's `{ data }` page, or a bare array from a fake. */
const rowsOf = (res: unknown): unknown[] =>
  Array.isArray(res) ? res : Array.isArray((res as { data?: unknown } | null)?.data) ? (res as { data: unknown[] }).data : [];

export function useHistoryActorNames(actorIds: readonly string[]): ReadonlyMap<string, HistoryActorName> {
  const adapter = useAdapter();
  // Per adapter: the answers, and the ids already asked about (answered or in
  // flight), so no id is asked twice of one directory.
  const cache = useMemo(
    () => ({ answered: new Map<string, HistoryActorName>(), asked: new Set<string>() }),
    [adapter],
  );
  const [names, setNames] = useState<ReadonlyMap<string, HistoryActorName>>(() => new Map());
  // One key for the set, so the effect runs when the set changes, not when the
  // caller hands an equal array of a new identity.
  const key = JSON.stringify([...new Set(actorIds)].sort());

  useEffect(() => {
    const wanted = JSON.parse(key) as string[];
    const missing = wanted.filter((id) => !cache.asked.has(id));
    if (missing.length === 0) return;
    for (const id of missing) cache.asked.add(id);
    // Published even when the panel moved on to another set meanwhile: the
    // answers are kept in `answered`, and the next set's read skips them.
    const settle = (resolved: ReadonlyMap<string, string>) => {
      for (const id of missing) {
        const name = resolved.get(id);
        cache.answered.set(id, name ? { kind: 'resolved', name } : { kind: 'unresolved' });
      }
      setNames(new Map(cache.answered));
    };
    if (!adapter || typeof adapter.find !== 'function') {
      settle(new Map());
      return;
    }
    (async () => {
      const resolved = new Map<string, string>();
      try {
        const rows = rowsOf(await adapter.find(PERSON_OBJECT, { $filter: { id: { $in: missing } }, $top: missing.length }));
        for (const row of rows) {
          const id = (row as { id?: unknown } | null)?.id;
          const name = rowLabel(row, PERSON_DISPLAY_FIELDS);
          if (id != null && name) resolved.set(String(id), name);
        }
      } catch {
        // A refused or failed directory read: every id it asked about is
        // shown as the id, marked unresolved (see the module header).
      }
      settle(resolved);
    })();
  }, [adapter, cache, key]);

  return names;
}
