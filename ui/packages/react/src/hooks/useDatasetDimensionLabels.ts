/**
 * ObjectUI — useDatasetDimensionLabels
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * The analytics label net's REACT half (objectui#4389) — the fetch-and-memo
 * glue that carries a dataset query's dimension metadata to the pure
 * `@object-ui/core` helpers that decide what a label IS.
 *
 * ## What this is, and what it is not
 *
 * Nothing here decides a label. The resolution rules are all core's, and were
 * never duplicated: `loadDimensionFieldMeta` → `resolveDimensionFieldMeta`, and
 * `deriveDimensionLabelMaps` → `buildDimensionLabelMap`, with the translator
 * bound by `dimensionOptionTranslator` to `{ns}.fieldOptions.<object>.<field>.<value>`
 * — the one convention list and form surfaces already translate select options
 * through. What this hook owns is only the three things core structurally
 * cannot: the host context read, the state, and the memo boundary between them.
 *
 * ## Why it lives HERE
 *
 * objectui#4389 filed the glue as duplicated between `plugin-dashboard`'s
 * `DatasetWidget` and `plugin-report`'s `useDatasetDimensionLabels` (both
 * created by PR #4388), and named `@object-ui/core` as its home. That home was
 * retired by measurement, and the card's PM RULING #2 records the correction:
 * `SchemaRendererContext` is defined in THIS package, which depends on
 * `@object-ui/core`, so core importing it back is a cycle; core is also
 * React-free by declaration, by content, and by AGENTS.md §3. This package is
 * the one place that is downstream of core (the helpers are reachable),
 * downstream of `@object-ui/i18n` (`useSafeFieldLabel` is reachable), the owner
 * of `SchemaRendererContext` (`apiFetch` is a local read), and upstream of both
 * consuming plugins. It already hosts this exact fetch-and-memo-off-`apiFetch`
 * shape three times over — `useViewData`, `useElementDataSource`, `useDiscovery`.
 *
 * ## The two properties this hook exists to state ONCE
 *
 * Both are bug fixes that were previously written out on each surface, which is
 * the drift objectui#4389 was filed to close:
 *
 * 1. **The read rides the host's AUTHENTICATED `apiFetch` (objectui#4121)**, so
 *    `apiFetch` is IN the effect's deps. A bearer-token session carries its
 *    credential in the `Authorization` header, not a cookie, so
 *    `credentials: 'include'` alone left this read unauthenticated in a hosted
 *    console — and because the net is best-effort, the symptom was not an error
 *    but option colours and dimension labels silently never applying. The
 *    context is consulted DIRECTLY rather than through a `useSchemaContext()`
 *    that throws, so a surface rendered outside a host keeps degrading to the
 *    global `fetch` instead of crashing the render.
 * 2. **The fetched metadata stays LOCALE-FREE in state (objectui#4030 /
 *    PR #4324)**, so the locale is NOT in the effect's deps. The bundle is
 *    applied one memo down, in {@link useDatasetDimensionLabels}, which is what
 *    makes a language switch re-label in place instead of re-issuing the
 *    metadata read.
 *
 * Both are pinned in `useDatasetDimensionLabels.test.tsx`, which asserts them
 * at this seam — the level the per-plugin pins cannot state, since neither
 * plugin can observe that the OTHER one inherits the same wiring.
 */

import { useContext, useEffect, useMemo, useState } from 'react';
import {
  deriveDimensionLabelMaps,
  loadDimensionFieldMeta,
  type DimensionFieldMeta,
  type DimensionRelabelTarget,
} from '@object-ui/core';
import { useSafeFieldLabel } from '@object-ui/i18n';
import { SchemaRendererContext } from '../context/SchemaRendererContext.js';

/** `{ dimension → { rowValue → displayLabel } }`, or null when nothing resolved. */
export type DimensionLabelMaps = Record<string, Record<string, string>> | null;

/** What the metadata read resolved, kept locale-free (objectui#4030). */
export interface DatasetDimensionMeta {
  /** `{ fieldPath → { object, field, options } }` for the paths that resolved. */
  metaByPath: Record<string, DimensionFieldMeta>;
  /** The dimensions this surface relabels, paired with their field paths. */
  relabel: DimensionRelabelTarget[];
}

/** Shared options for both hooks below. */
export interface DatasetDimensionLabelOptions {
  /**
   * Set false to issue no read at all. The dashboard's METRIC branch passes
   * this: it renders ONE measure value plus that measure's header label, so a
   * dimension's value never reaches its output in any spelling and resolving
   * would be a metadata read nothing consumes (objectui#4263, pinned).
   */
  enabled?: boolean;
}

/**
 * Resolve one dataset query's dimension field metadata — the LOCALE-FREE half.
 *
 * Use this directly only when the surface derives more from the metadata than
 * label maps; the dashboard does, for its chart-only per-category colours and
 * declared category order. Everything else wants {@link useDatasetDimensionLabels}.
 *
 * @param object the dataset's base object, as the query result reported it
 * @param dimensionFields the result's `dimension → field path` map (a dotted
 *   path resolves against the relationship TARGET, ADR-0071 multi-hop included)
 * @param dimensions the dimension names this surface renders
 */
export function useDatasetDimensionMeta(
  object: string | undefined,
  dimensionFields: Record<string, string> | undefined,
  dimensions: readonly string[] | undefined,
  options?: DatasetDimensionLabelOptions,
): DatasetDimensionMeta | null {
  // The host's AUTHENTICATED fetch (objectui#4121) — see property 1 in the
  // file header for why it is read off the context directly.
  const context = useContext(SchemaRendererContext);
  const apiFetch = context?.apiFetch;
  // The host data source, when it can answer `getObjectSchema` (objectui#13039):
  // the data layer's shared request-key cache, so N dataset widgets over one
  // object make ONE `meta/object/NAME` request instead of one each.
  const dataSource = context?.dataSource;
  const enabled = options?.enabled ?? true;

  // LOCALE-FREE state (objectui#4030) — see property 2 in the file header.
  const [meta, setMeta] = useState<DatasetDimensionMeta | null>(null);

  const dims = (dimensions ?? []).filter(Boolean);
  // A string signature, for the same reason `useDatasetRows` uses one: the
  // dimension list and field map reach a renderer as arrays/objects rebuilt on
  // every render, so keying the effect on their identity would refetch forever.
  // NOTE what is deliberately ABSENT from it: the locale. That absence is
  // property 2, and it is pinned.
  const signature = [
    enabled ? '1' : '0',
    object ?? '',
    dims.join(','),
    JSON.stringify(dimensionFields ?? null),
  ].join('|');

  useEffect(() => {
    if (!enabled || !object || dims.length === 0) {
      setMeta(null);
      return;
    }
    const fieldOf = (dim: string) => (dimensionFields && dimensionFields[dim]) || dim;
    let cancelled = false;
    (async () => {
      try {
        const doFetch = apiFetch ?? fetch;
        // objectui#13039 — through the data source's `getObjectSchema` when one
        // that answers it is in scope: the read the dashboard's chart, metric
        // and table widgets make, which the adapter's metadata cache joins while
        // it is in flight. It answers the bare object document, which is what
        // the raw leg's unwrap yields, so core gets one shape from either leg.
        // The raw read stays as the fallback for a surface with no such source.
        const loadObjectSchema = typeof dataSource?.getObjectSchema === 'function'
          ? (name: string): Promise<unknown> => dataSource.getObjectSchema(name)
          : async (name: string) => {
            const r = await doFetch(`/api/v1/meta/object/${encodeURIComponent(name)}`, {
              headers: { accept: 'application/json' },
              credentials: 'include',
            });
            const doc = await r.json().catch(() => null);
            return doc?.item ?? doc?.data ?? doc;
          };
        // ONE walk for every dimension, memoized per call inside core — sibling
        // dimensions sharing a relationship prefix read that object once, and
        // the base object is seeded so it is never re-read.
        const metaByPath = await loadDimensionFieldMeta(loadObjectSchema, object, dims.map(fieldOf));
        if (!cancelled) {
          setMeta({ metaByPath, relabel: dims.map((dim) => ({ dim, path: fieldOf(dim) })) });
        }
      } catch {
        // Best-effort by construction: a failed read leaves the rows exactly as
        // the server sent them, which is what these surfaces rendered before.
        if (!cancelled) setMeta(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `apiFetch` joins the deps (objectui#4121); the locale does NOT
    // (objectui#4030 / PR #4324). `apiFetch` comes from the provider's
    // memoized context value, and this hook's own `setState` cannot re-render
    // the provider, so its identity is stable across the effect's own updates.
    // `dataSource` joins for the same reason and from the same value
    // (objectui#13039): it decides which leg the read takes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, apiFetch, dataSource]);

  return meta;
}

/**
 * Resolve the `{ dimension → { value → displayLabel } }` maps for one dataset
 * query's dimensions, with the locale bundle applied.
 *
 * The full glue: {@link useDatasetDimensionMeta} for the locale-free read, then
 * core's `deriveDimensionLabelMaps` in a render memo. Feed the result to
 * `relabelDimensions`. A language switch re-runs only the memo.
 *
 * Parameters are as {@link useDatasetDimensionMeta}.
 */
export function useDatasetDimensionLabels(
  object: string | undefined,
  dimensionFields: Record<string, string> | undefined,
  dimensions: readonly string[] | undefined,
  options?: DatasetDimensionLabelOptions,
): DimensionLabelMaps {
  const { fieldOptionLabel } = useSafeFieldLabel();
  const meta = useDatasetDimensionMeta(object, dimensionFields, dimensions, options);
  return useMemo(
    () => deriveDimensionLabelMaps(meta?.metaByPath, meta?.relabel, fieldOptionLabel),
    [meta, fieldOptionLabel],
  );
}
