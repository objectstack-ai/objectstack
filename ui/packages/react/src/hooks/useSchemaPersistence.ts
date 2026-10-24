/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useState, useCallback, useRef, useMemo, useInsertionEffect } from 'react';

/**
 * Persistence adapter interface for schema save/load operations.
 * Implement this to connect to any backend (REST API, GraphQL, localStorage, etc.).
 */
export interface SchemaPersistenceAdapter {
  /** Save a schema to the backend. Returns the saved schema ID. */
  save: (id: string, schema: Record<string, unknown>) => Promise<string>;
  /** Load a schema from the backend by ID. */
  load: (id: string) => Promise<Record<string, unknown> | null>;
  /** List all available schemas. */
  list?: () => Promise<Array<{ id: string; name?: string; updatedAt?: string }>>;
  /** Delete a schema from the backend. */
  delete?: (id: string) => Promise<void>;
}

export interface SchemaPersistenceState {
  /** Whether a save/load operation is in progress */
  loading: boolean;
  /** The last error from a save/load operation */
  error: Error | null;
  /** Whether the current schema has unsaved changes */
  isDirty: boolean;
  /** The last saved timestamp */
  lastSavedAt: Date | null;
}

export interface SchemaPersistenceResult extends SchemaPersistenceState {
  /** Save the current schema */
  save: (id: string, schema: Record<string, unknown>) => Promise<string | null>;
  /** Load a schema by ID */
  load: (id: string) => Promise<Record<string, unknown> | null>;
  /** List available schemas */
  list: () => Promise<Array<{ id: string; name?: string; updatedAt?: string }>>;
  /** Delete a schema */
  remove: (id: string) => Promise<boolean>;
  /** Mark the current schema as dirty (has unsaved changes) */
  markDirty: () => void;
  /** Clear the error state */
  clearError: () => void;
}

/**
 * Default localStorage adapter for schema persistence.
 * Useful for development and demos.
 */
export function createLocalStorageAdapter(prefix = 'objectui-schema'): SchemaPersistenceAdapter {
  return {
    async save(id: string, schema: Record<string, unknown>): Promise<string> {
      const key = `${prefix}:${id}`;
      const entry = { schema, updatedAt: new Date().toISOString() };
      localStorage.setItem(key, JSON.stringify(entry));
      // Update the index
      const indexKey = `${prefix}:__index__`;
      const index: string[] = JSON.parse(localStorage.getItem(indexKey) || '[]');
      if (!index.includes(id)) {
        index.push(id);
        localStorage.setItem(indexKey, JSON.stringify(index));
      }
      return id;
    },
    async load(id: string): Promise<Record<string, unknown> | null> {
      const key = `${prefix}:${id}`;
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      return entry.schema ?? null;
    },
    async list(): Promise<Array<{ id: string; name?: string; updatedAt?: string }>> {
      const indexKey = `${prefix}:__index__`;
      const index: string[] = JSON.parse(localStorage.getItem(indexKey) || '[]');
      return index.map((id) => {
        const raw = localStorage.getItem(`${prefix}:${id}`);
        const entry = raw ? JSON.parse(raw) : {};
        return { id, name: id, updatedAt: entry.updatedAt };
      });
    },
    async delete(id: string): Promise<void> {
      const key = `${prefix}:${id}`;
      localStorage.removeItem(key);
      const indexKey = `${prefix}:__index__`;
      const index: string[] = JSON.parse(localStorage.getItem(indexKey) || '[]');
      localStorage.setItem(indexKey, JSON.stringify(index.filter((i) => i !== id)));
    },
  };
}

/**
 * Cap on how many offending paths the refusal message spells out in full. A
 * schema that puts callables on every row would otherwise produce an error
 * string nobody can read; the count is always reported exactly.
 */
const MAX_REPORTED_CALLABLE_PATHS = 20;

/**
 * Collect the path of every function-valued property reachable in `value`.
 *
 * Walks own enumerable properties — the same set `JSON.stringify` serializes —
 * so what this finds is exactly what `JSON.stringify` would fail to preserve.
 * It fails in TWO different ways, and neither says a word. Both are visible in
 * a single document:
 *
 *     JSON.stringify({ columns: [{ name: 'c', cell: fn }, fn] })
 *     // => {"columns":[{"name":"c"},null]}
 *     //    the object key `cell` is DROPPED; the array element is COERCED to null
 *
 * The array case is arguably the worse of the two. A dropped key at least
 * disappears, so a reader of the stored document can see something is missing;
 * a coerced `null` survives as a plausible-looking value and reads as real data
 * on reload. That is why arrays are walked by index (`columns[2].cell`) rather
 * than skipped — and it is the realistic shape besides, since handlers live on
 * column/field entries, not only at the top level.
 *
 * A `seen` set keeps a cyclic schema from recursing forever (`JSON.stringify`
 * throws on those; this guard runs first and must not hang before it can). It
 * also means a subtree reachable by two paths is reported at the first one
 * only — the refusal is still correct, the path list is just not exhaustive for
 * shared references.
 */
function collectCallablePaths(
  value: unknown,
  path: string,
  out: string[],
  seen: Set<object>,
): void {
  if (typeof value === 'function') {
    out.push(path || '(root)');
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectCallablePaths(item, `${path}[${index}]`, out, seen));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectCallablePaths(child, path ? `${path}.${key}` : key, out, seen);
  }
}

/**
 * The paths of the function-valued keys anywhere in a schema, in walk order.
 * Empty means the schema is fully declarative and serializes without loss.
 *
 * Two corners worth knowing, both measured, neither a reason to loosen this:
 *
 * - `Object.entries` INVOKES getters. A schema with a throwing getter therefore
 *   throws inside this guard rather than inside the adapter's `JSON.stringify`.
 *   Different call site, same outcome: `save()` refuses and surfaces the
 *   getter's own error.
 * - A schema carrying its own `toJSON` method is refused, even though
 *   `JSON.stringify` would have serialized it THROUGH that method. That is a
 *   deliberate false positive: the method itself cannot survive the round trip,
 *   so what `load()` hands back would not be the object that was saved.
 */
function findCallablePaths(schema: Record<string, unknown>): string[] {
  const out: string[] = [];
  collectCallablePaths(schema, '', out, new Set());
  return out;
}

/**
 * The refusal an author sees instead of a save that quietly lost their handler.
 *
 * It names the exact offending paths and both escapes, because an error that
 * only says "no" leaves the author guessing at a defect whose symptom would
 * otherwise have surfaced at render or click time, in another component, with
 * no link back to the save that caused it.
 */
function callableRefusalMessage(id: string, paths: string[]): string {
  const shown = paths.slice(0, MAX_REPORTED_CALLABLE_PATHS);
  const listed = shown.join(', ');
  const elided =
    paths.length > shown.length ? ` (and ${paths.length - shown.length} more)` : '';
  const plural = paths.length === 1 ? 'key is' : 'keys are';
  return (
    `useSchemaPersistence: refusing to save schema "${id}" — ` +
    `${paths.length} function-valued ${plural} not serializable: JSON.stringify ` +
    `silently drops an object key, or coerces an array element to null. ` +
    `Offending paths: ${listed}${elided}. ` +
    'Two ways forward: strip the callables before saving (persist only the serializable ' +
    'data and re-attach the handlers after load), or express the behaviour in the ' +
    'declarative form of these keys so it survives the round trip.'
  );
}

/**
 * Hook for persisting designer schemas (save/load/list/delete).
 * Implements schema persistence for @object-ui/plugin-designer.
 *
 * Accepts a pluggable adapter for connecting to any backend.
 * Falls back to a localStorage adapter for development use.
 *
 * `save()` refuses a schema carrying function-valued keys anywhere in it —
 * every adapter ends in a `JSON.stringify`, which drops callables silently, so
 * the save would report success and the reload would hand back a schema that
 * lost them. The refusal sets `error` (naming the offending key paths and both
 * escapes), returns `null`, leaves `lastSavedAt` untouched, and never reaches
 * the adapter. Fully declarative schemas are unaffected.
 *
 * @example
 * ```tsx
 * // With default localStorage adapter
 * const persistence = useSchemaPersistence();
 *
 * // Save current design
 * await persistence.save('my-page', pageSchema);
 *
 * // Load a design
 * const schema = await persistence.load('my-page');
 *
 * // With custom API adapter
 * const apiAdapter: SchemaPersistenceAdapter = {
 *   save: (id, schema) => fetch(`/api/schemas/${id}`, { method: 'PUT', body: JSON.stringify(schema) }).then(r => r.json()),
 *   load: (id) => fetch(`/api/schemas/${id}`).then(r => r.json()),
 *   list: () => fetch('/api/schemas').then(r => r.json()),
 *   delete: (id) => fetch(`/api/schemas/${id}`, { method: 'DELETE' }).then(() => {}),
 * };
 * const persistence = useSchemaPersistence(apiAdapter);
 * ```
 */
export function useSchemaPersistence(
  adapter?: SchemaPersistenceAdapter,
): SchemaPersistenceResult {
  // Built once per hook instance. `useRef(createLocalStorageAdapter())` ran the
  // factory on EVERY render and discarded all but the first result; `useMemo`
  // runs it once and — unlike a ref — needs no `.current` read during render.
  // Re-creating it would be harmless either way: the adapter is a stateless
  // facade over `localStorage`, so a fresh one behaves identically to the one
  // it replaces, and nothing outside this hook ever sees its identity.
  const defaultAdapter = useMemo(() => createLocalStorageAdapter(), []);
  const resolvedAdapter = adapter ?? defaultAdapter;

  // The four callbacks below are created once (`[]` deps) and read the adapter
  // at CALL time, so the latest adapter must reach them without changing their
  // identity. That is the whole job of this ref.
  //
  // The write lives in `useInsertionEffect` — not in the render body, where it
  // used to be, and not in `useEffect`/`useLayoutEffect`:
  //
  //   - Render body: a render React discards or replays (StrictMode, a
  //     Suspense retry, a concurrent interruption) still performed the write,
  //     so a save could be routed through an adapter from a render that never
  //     committed. That is what `react-hooks/refs` flags.
  //   - `useEffect`: runs after paint, so a call made from any layout effect in
  //     the same commit would still reach the PREVIOUS adapter.
  //   - `useLayoutEffect`: a child's layout effects run BEFORE its parent's, so
  //     a child calling `save()` from its own layout effect would still see the
  //     previous adapter.
  //
  // Insertion effects run in the mutation phase — before every layout effect in
  // the tree, before paint, and before any event handler can fire — so every
  // call site that may legally invoke `save`/`load`/`list`/`remove` observes
  // exactly what the old render-body write gave it. The single window that did
  // change is a read during the render phase itself, which no legal consumer
  // has: these calls are side effects and are never allowed during render.
  //
  // `useSchemaPersistence.adapterTracking.test.tsx` pins both halves — that a
  // changed `adapter` prop is tracked, and that it is already in place by the
  // time a child's layout effect runs in that same commit.
  const adapterRef = useRef(resolvedAdapter);
  useInsertionEffect(() => {
    adapterRef.current = resolvedAdapter;
  }, [resolvedAdapter]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const save = useCallback(
    async (id: string, schema: Record<string, unknown>): Promise<string | null> => {
      setLoading(true);
      setError(null);
      try {
        // Refuse BEFORE the adapter runs, so the guard covers a host-injected or
        // REST adapter too — every one of them ends in a `JSON.stringify` that
        // drops callables without a word (objectui#6658).
        const callablePaths = findCallablePaths(schema);
        if (callablePaths.length > 0) {
          throw new Error(callableRefusalMessage(id, callablePaths));
        }
        const result = await adapterRef.current.save(id, schema);
        setIsDirty(false);
        setLastSavedAt(new Date());
        return result;
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const load = useCallback(async (id: string): Promise<Record<string, unknown> | null> => {
    setLoading(true);
    setError(null);
    try {
      const result = await adapterRef.current.load(id);
      setIsDirty(false);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const list = useCallback(async (): Promise<Array<{ id: string; name?: string; updatedAt?: string }>> => {
    setLoading(true);
    setError(null);
    try {
      if (adapterRef.current.list) {
        return await adapterRef.current.list();
      }
      return [];
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    setLoading(true);
    setError(null);
    try {
      if (adapterRef.current.delete) {
        await adapterRef.current.delete(id);
        return true;
      }
      return false;
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const markDirty = useCallback(() => setIsDirty(true), []);
  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({
      loading,
      error,
      isDirty,
      lastSavedAt,
      save,
      load,
      list,
      remove,
      markDirty,
      clearError,
    }),
    [loading, error, isDirty, lastSavedAt, save, load, list, remove, markDirty, clearError],
  );
}
