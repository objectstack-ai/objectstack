/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { getRecordDisplayName as defaultDisplayName, withoutDeniedFields } from '@object-ui/core';
import { errorCodeIs } from '@object-ui/types';

// ADR-0079: the global-search default display-name resolver is now the ONE
// shared `getRecordDisplayName` from `@object-ui/core` (honors titleFormat →
// `displayNameField` → type-aware derivation → `Record #<id>`). Callers can
// still pass an explicit `getDisplayName` (app-shell's CommandPalette passes
// the same shared resolver re-exported via `@object-ui/app-shell`).

/**
 * Relevance score for a single record hit against the query. Higher wins.
 *
 * Tiers (designed to be distinct enough to survive small noise):
 *   100  Exact case-insensitive match on display.
 *    80  Display starts with the query.
 *    60  A query-token starts at a word boundary inside the display
 *        (e.g. "ACME" matches "Acme Corp" or "Globex / ACME").
 *    40  Substring contains.
 *     0  No textual evidence — server returned it but we can't justify
 *        ranking it. Still included so the user can see what came back.
 *
 * The hook also nudges score by recordId equality (exact id paste) so
 * "paste an id, hit enter" stays the top hit.
 */
function scoreHit(query: string, display: string, recordId: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const d = (display || '').toLowerCase();
  const id = (recordId || '').toLowerCase();

  if (id === q) return 110; // exact id wins everything
  if (d === q) return 100;
  if (d.startsWith(q)) return 80;
  // Word-boundary start: split on common separators.
  const tokens = d.split(/[\s_\-/.,:;()[\]]+/).filter(Boolean);
  if (tokens.some((tok) => tok.startsWith(q))) return 60;
  if (d.includes(q)) return 40;
  return 0;
}

export interface RecordSearchHit {
  /** Object name the record belongs to. */
  objectName: string;
  /** Human-readable object label (uses `objectDef.label`, falls back to name). */
  objectLabel: string;
  /** Stable record identifier (record.id ?? record._id). */
  recordId: string;
  /** Resolved display name (via objectDef.titleFormat or fallback chain). */
  display: string;
  /** Optional secondary line (e.g. status or email). Always falsy by default. */
  subtitle?: string;
  /** Pass-through icon hint from the object def. */
  icon?: string;
  /**
   * Relevance score (higher = better) used to interleave hits across
   * objects. Stable across runs for the same (query, display) pair.
   */
  score: number;
  /**
   * Raw record payload, for callers that want extra context. It is the row as
   * served: `fieldReadPolicy` gates the `display` label, not this payload.
   */
  raw: any;
}

export interface UseRecordSearchOptions {
  /** Current query string from the input. The hook debounces internally. */
  query: string;
  /** All known object definitions; the hook picks candidates from this list. */
  objects: any[];
  /**
   * The data source to query. When null/undefined the hook returns empty
   * results without firing any requests.
   */
  dataSource: any;
  /**
   * Optional whitelist of object names to search (typically derived from the
   * current app's nav). When non-empty, only these objects are queried — in
   * the order provided. When omitted, the hook falls back to every object
   * where `searchable !== false`, capped at `maxObjectsQueried`.
   */
  objectNames?: string[];
  /**
   * Hard cap on parallel object queries. Defaults to 8. Lower this on
   * slow backends.
   */
  maxObjectsQueried?: number;
  /** Per-object result cap. Defaults to 3. */
  topPerObject?: number;
  /** Min query length before any request fires. Defaults to 2. */
  minLength?: number;
  /** Debounce in ms. Defaults to 250. */
  debounceMs?: number;
  /** Set to false to disable the hook entirely (returns empty, no requests). */
  enabled?: boolean;
  /**
   * Optional display-name resolver. Defaults to the same `titleFormat`
   * fallback chain used by app-shell. Pass `getRecordDisplayName` from
   * `@object-ui/app-shell` to share that implementation exactly.
   *
   * Safe to pass inline: the resolver's identity never re-runs the search.
   * Each run reads the resolver of the latest render, so a swapped resolver
   * labels the hits of the next run; results already shown keep their labels.
   */
  getDisplayName?: (objectDef: any, record: any) => string;
  /**
   * Optional field-level read policy: pass `usePermissions()` from
   * `@object-ui/permissions` (objectui#10500). Once it is loaded, a hit is
   * labelled from its record with the fields the policy denies on the hit's
   * object removed, `id` and `_id` kept. The row is gated BEFORE
   * `getDisplayName` reads it, so a caller-supplied resolver is gated too. A
   * denied field then reads exactly as an absent one and the resolver falls
   * through to its next rung, the label a backend that strips denied fields
   * (ObjectStack's `FieldMasker`) already yields. The rule is
   * `withoutDeniedFields` from `@object-ui/core` (objectui#10594), the one the
   * record title (objectui#10434) and the lookup option label (objectui#10411)
   * call too.
   *
   * Omitted, or not loaded yet, the row is labelled as served. A title the
   * server computed (`searchAll`'s `hit.title`) is the server's answer and is
   * not re-judged here.
   *
   * Safe to pass inline: only `isLoaded` decides whether a run happens. When
   * it changes the search re-runs, so hits labelled before the policy loaded
   * are relabelled from the gated row. Otherwise each run reads the policy of
   * the latest render, as it does `getDisplayName`.
   */
  fieldReadPolicy?: {
    isLoaded: boolean;
    checkField: (object: string, field: string, action: 'read') => boolean;
  };
}

export interface UseRecordSearchResult {
  results: RecordSearchHit[];
  isSearching: boolean;
  error?: Error;
}

/**
 * Search records across multiple objects in parallel, fanning out to
 * `dataSource.find(name, { $search, $top })`. Designed for the Cmd-K
 * command palette and similar global-search affordances.
 *
 * The hook:
 *
 *  - Debounces `query` so fast typing doesn't generate one request per
 *    keystroke.
 *  - Skips requests when the trimmed query is shorter than `minLength`,
 *    when `enabled` is false, when `dataSource` is null, or when there are
 *    no candidate objects.
 *  - Uses a monotonically-increasing `runId` to discard stale results — if
 *    the user keeps typing while requests are still in flight, only the
 *    newest run mutates state.
 *  - Tolerates per-object failures (404, etc) via `Promise.allSettled`; a
 *    backend that doesn't know about one object doesn't poison the rest of
 *    the result set.
 *
 * The hook trusts `$search` — backends that silently ignore it would
 * return top-N records unrelated to the query. The ObjectStack mock + REST
 * adapters both honor `$search`; if you need to integrate with a backend
 * that doesn't, set `enabled` to false or wrap the data source to add
 * `$filter` translation.
 */
export function useRecordSearch(opts: UseRecordSearchOptions): UseRecordSearchResult {
  const {
    query,
    objects,
    dataSource,
    objectNames,
    maxObjectsQueried = 8,
    topPerObject = 3,
    minLength = 2,
    debounceMs = 250,
    enabled = true,
    getDisplayName = defaultDisplayName,
    fieldReadPolicy,
  } = opts;

  // The one member of the read policy that decides whether a run happens: a
  // primitive, so an inline policy object never re-runs the search by identity.
  const policyLoaded = fieldReadPolicy?.isLoaded === true;

  const [results, setResults] = useState<RecordSearchHit[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Stable signature derived from the object metadata fields we actually
  // touch. Prevents pointless re-runs when the parent re-renders with a
  // new array reference but identical content.
  //
  // Deliberately UNCAPPED: `maxObjectsQueried` bounds the number of parallel
  // per-object requests on the fanout path (applied there), not the search
  // scope itself. Capping here also truncated the `objects` whitelist sent to
  // the single-request `/api/v1/search` call, so the palette silently searched
  // only the first N nav objects — records in every later object were
  // unfindable no matter what the user typed. Measured symptom: ⌘K in an app
  // with 40+ searchable objects only ever queried the first 8 nav entries,
  // so which sidebar group happened to come first decided what was findable.
  const candidates = useMemo(() => {
    if (!Array.isArray(objects) || objects.length === 0) return [];
    // Assigned in both branches below before it's read; no dead initializer.
    let pool: any[];
    if (Array.isArray(objectNames) && objectNames.length > 0) {
      const byName = new Map<string, any>();
      for (const obj of objects) {
        const name = obj?.name;
        if (typeof name === 'string') byName.set(name, obj);
      }
      pool = objectNames
        .map((n) => byName.get(n))
        .filter((obj): obj is any => obj != null);
    } else {
      pool = objects.filter((o) => o?.searchable !== false);
    }
    return pool;
  }, [objects, objectNames]);

  // The object NAME is the whole signature: it is the only field of an object
  // definition this effect consumes (`dataSource.find(obj.name, …)` and the
  // `objects` whitelist sent to `searchAll`); `label` / `icon` are read per hit
  // at render time and never decide whether the fanout re-runs.
  //
  // An `o?.titleField ?? ''` half used to be appended to each entry. It could
  // never vary: `@objectstack/spec`'s object schema is a `strictObject` that
  // REJECTS `titleField` with `unrecognized_keys` (objectui#6531), so no legal
  // object metadata carries it and the half was permanently `''` — a constant
  // suffix in a cache key, which also read as evidence that some producer ships
  // the key. Removed in objectui#6557; the display name comes from
  // `getRecordDisplayName`, which does not consult it either.
  const candidateSignature = useMemo(() => {
    return candidates.map((o) => String(o?.name)).join('|');
  }, [candidates]);

  // Run ID for racing-request guarding. Stable across renders.
  const runIdRef = useRef(0);

  // `getDisplayName` is caller-supplied and read only INSIDE a run, to label
  // hits — it never decides whether a run happens. So the search effect reads
  // the latest resolver through this ref and does not key on its identity
  // (AGENTS.md §5 #10, objectui#10044). Keyed on it, an inline resolver (a new
  // function every render) re-ran the effect on each render, and the cleanup
  // cleared the pending debounce timer: renders faster than `debounceMs` never
  // searched, and sparser renders issued a second identical request. Declared
  // before the search effect, so it is current before any timer is armed.
  //
  // `fieldReadPolicy` is read the same way (objectui#10500): the run reads the
  // latest policy through a ref, and only its `isLoaded` primitive
  // (`policyLoaded`) is a dependency of the search effect.
  const getDisplayNameRef = useRef(getDisplayName);
  const fieldReadPolicyRef = useRef(fieldReadPolicy);
  useEffect(() => {
    getDisplayNameRef.current = getDisplayName;
    fieldReadPolicyRef.current = fieldReadPolicy;
  });

  useEffect(() => {
    if (!enabled || !dataSource || candidates.length === 0) {
      setResults([]);
      setIsSearching(false);
      setError(undefined);
      return;
    }

    const trimmed = (query ?? '').trim();
    if (trimmed.length < minLength) {
      setResults([]);
      setIsSearching(false);
      setError(undefined);
      return;
    }

    const myRunId = ++runIdRef.current;
    setIsSearching(true);
    setError(undefined);

    const timer = setTimeout(() => {
      // Skip if a newer run started during the debounce window.
      if (runIdRef.current !== myRunId) return;

      // Prefer the platform's unified global-search endpoint when the data
      // source exposes it (ObjectStackAdapter → GET /api/v1/search?q=). The
      // per-object `find({ $search })` fanout below only runs each object's
      // metadata-driven search (ADR-0061) and can miss records the global
      // search index knows about — the command-palette symptom in framework
      // objectstack-ai/objectstack#3371, where `/api/v1/search` returned an account/opportunity the
      // palette never showed. When `searchAll` is absent (mock/test adapters,
      // non-ObjectStack backends) we fall back to the fanout.
      const searchAll = (dataSource as { searchAll?: unknown }).searchAll;
      if (typeof searchAll === 'function') {
        // Scope to the candidate objects (the app's searchable nav objects) so
        // the palette doesn't surface records from objects the current app
        // can't route to. We both ask the server to scope (`objects`) and
        // re-filter locally, guarding servers that ignore the param.
        const byName = new Map<string, any>();
        for (const obj of candidates) {
          if (typeof obj?.name === 'string') byName.set(obj.name, obj);
        }

        Promise.resolve()
          .then(() =>
            (searchAll as (q: string, o?: any) => Promise<any>).call(dataSource, trimmed, {
              limit: maxObjectsQueried * topPerObject,
              objects: Array.from(byName.keys()),
            }),
          )
          .then((res: any) => {
            // Discard if a newer run started while we were waiting.
            if (runIdRef.current !== myRunId) return;

            const rawHits: any[] = Array.isArray(res?.hits)
              ? res.hits
              : Array.isArray(res)
                ? res
                : [];

            const hits: RecordSearchHit[] = [];
            for (const h of rawHits) {
              const objectName = h?.object ?? h?.objectName;
              if (typeof objectName !== 'string') continue;
              // Keep only whitelisted objects (no-op when the server already
              // honored `objects`).
              if (byName.size > 0 && !byName.has(objectName)) continue;
              const recordId = h?.id ?? h?.record?.id ?? h?.record?._id;
              if (recordId == null) continue;

              const objDef = byName.get(objectName) ?? { name: objectName };
              const title =
                typeof h?.title === 'string' && h.title.trim() !== '' ? h.title.trim() : '';
              const display =
                title ||
                getDisplayNameRef.current(
                  objDef,
                  withoutDeniedFields(h?.record ?? {}, fieldReadPolicyRef.current, objectName),
                ) ||
                `Record #${recordId}`;
              const snippet = typeof h?.snippet === 'string' ? h.snippet.trim() : '';

              hits.push({
                objectName,
                objectLabel:
                  typeof objDef.label === 'string' && objDef.label.length > 0
                    ? objDef.label
                    : objectName,
                recordId: String(recordId),
                display,
                // Only surface a snippet when it adds information beyond the title.
                subtitle: snippet && snippet !== display ? snippet : undefined,
                icon: objDef?.icon,
                score: scoreHit(trimmed, display, String(recordId)),
                raw: h?.record ?? h,
              });
            }

            // The server already ranks hits across objects; preserve that order.
            // Only float an exact-id paste to the very top (parity with the
            // fanout path). Array.prototype.sort is stable, so every other hit
            // keeps the server ordering.
            hits.sort((a, b) => (b.score === 110 ? 1 : 0) - (a.score === 110 ? 1 : 0));

            setResults(hits);
            setIsSearching(false);
            setError(undefined);
          })
          .catch((err: any) => {
            if (runIdRef.current !== myRunId) return;
            setResults([]);
            setIsSearching(false);
            setError(err instanceof Error ? err : new Error(String(err)));
          });
        return;
      }

      // Fanout fallback only: one request per object, so THIS is where the
      // parallel-request cap applies.
      const requests = candidates.slice(0, maxObjectsQueried).map((obj) =>
        Promise.resolve()
          .then(() =>
            dataSource.find(obj.name, {
              $search: trimmed,
              $top: topPerObject,
            }),
          )
          .then((res: any) => ({ obj, res, err: null as any }))
          .catch((err: any) => ({ obj, res: null, err })),
      );

      Promise.allSettled(requests).then((settled) => {
        // Discard if a newer run started while we were waiting.
        if (runIdRef.current !== myRunId) return;

        const hits: RecordSearchHit[] = [];
        let lastError: Error | undefined;
        for (const s of settled) {
          if (s.status !== 'fulfilled') continue;
          const { obj, res, err } = s.value;
          if (err) {
            // Tolerate 404 / object_not_found / similar; only surface the
            // last real error so the UI can show a non-blocking hint.
            const status = err?.httpStatus ?? err?.status;
            const code = err?.code;
            if (status === 404 || errorCodeIs(err, 'OBJECT_NOT_FOUND')) continue;
            lastError = err instanceof Error ? err : new Error(String(err));
            continue;
          }
          const rows: any[] = Array.isArray(res?.data)
            ? res.data
            : Array.isArray(res)
              ? res
              : [];
          for (const record of rows.slice(0, topPerObject)) {
            const recordId = record?.id ?? record?._id;
            if (recordId == null) continue;
            const display = getDisplayNameRef.current(
              obj,
              withoutDeniedFields(record, fieldReadPolicyRef.current, obj.name),
            );
            hits.push({
              objectName: obj.name,
              objectLabel:
                typeof obj.label === 'string' && obj.label.length > 0
                  ? obj.label
                  : obj.name,
              recordId: String(recordId),
              display,
              icon: obj?.icon,
              score: scoreHit(trimmed, display, String(recordId)),
              raw: record,
            });
          }
        }

        // Stable sort by score desc, then by original (object-fanout)
        // order so ties preserve the upstream candidate ordering.
        hits.sort((a, b) => b.score - a.score);

        setResults(hits);
        setIsSearching(false);
        setError(lastError);
      });
    }, debounceMs);

    return () => {
      clearTimeout(timer);
    };
  }, [
    query,
    enabled,
    dataSource,
    candidateSignature,
    topPerObject,
    maxObjectsQueried,
    minLength,
    debounceMs,
    policyLoaded,
  ]);

  return { results, isSearching, error };
}
