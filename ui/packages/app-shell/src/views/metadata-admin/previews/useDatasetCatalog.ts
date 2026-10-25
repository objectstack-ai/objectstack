// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useDatasetCatalog — loads the analytics dataset catalog for the Report
 * inspector's dataset binding controls (ADR-0021 single-form).
 *
 * A 9.0 report binds a semantic-layer `dataset` and selects its `values`
 * (measure names) grouped by `rows` (dimension names) — so the editor needs
 * (a) the list of datasets to bind, and (b) the bound dataset's
 * dimensions/measures to offer as picker options.
 *
 * Mirrors {@link useObjectFields}: defensive (a 404 or transport error
 * resolves to an empty catalog with `error` set, the inspector falls back to
 * manual entry) and override-friendly (hosts that already hold the catalog
 * pass it to keep the inspector network-free, e.g. tests and the runtime
 * config panel).
 *
 * ## The author's text (objectui#11161)
 *
 * A dataset document declares text for the author beside its machine names:
 * each member's `label` and the dataset's own `label` and `description`, all
 * `I18nLabel` in `@objectstack/spec` (a string, or an inline per-locale map).
 * `toCatalogEntry` keeps them, resolved through the spec's `resolveI18nLabel`
 * in the locale it is handed — the one rule for all four, never `String()` of
 * a label. The hooks below keep the documents AS SERVED and resolve where they
 * return, in `useMetadataLocale()`, so a language switch re-reads every label
 * without a refetch (the objectui#10862 pattern the not-found sentence in
 * `useDatasetSemantics` already follows). A catalog entry therefore carries
 * display-ready strings only: no consumer can render a raw locale map.
 *
 * The text is display only. A picker shows it beside the machine name; what a
 * binding stores is still the name.
 */

import * as React from 'react';
import { resolveI18nLabel, type I18nLabel } from '@objectstack/spec/ui';
import { useMetadataClient } from '../useMetadata.js';
import { t, useMetadataLocale } from '../i18n.js';

export interface DatasetDimensionInfo {
  /** Dimension name (snake_case, referenced by `report.rows`). */
  name: string;
  /**
   * The author's label, resolved in the designer locale. Absent when the
   * dimension declares none — a picker then shows the name alone.
   */
  label?: string;
  /** Raw field type id when declared (e.g. 'text', 'date'). */
  type?: string;
}

export interface DatasetMeasureInfo {
  /** Measure name (snake_case, referenced by `report.values`). */
  name: string;
  /**
   * The author's label, resolved in the designer locale. Absent when the
   * measure declares none — a picker then shows the name alone.
   */
  label?: string;
  /** Aggregate function (sum / avg / count / …) — display hint only. */
  aggregate?: string;
}

export interface DatasetCatalogEntry {
  /** Dataset unique name (what `report.dataset` stores). */
  name: string;
  /**
   * The dataset's base object (the spec's `DatasetSchema.object`, the FROM), as
   * served. Absent when the served document carries none, e.g. a list endpoint
   * that answers names only. The console's Create View dialog offers a chart
   * view only the datasets whose base object is the view's own object
   * (objectui#11576); an entry without one is therefore never offered there.
   */
  object?: string;
  /** Human label, resolved in the designer locale (falls back to the name). */
  label: string;
  /**
   * The dataset's description, resolved in the designer locale. Absent when
   * the dataset declares none.
   */
  description?: string;
  dimensions: DatasetDimensionInfo[];
  measures: DatasetMeasureInfo[];
}

export interface UseDatasetCatalogResult {
  datasets: DatasetCatalogEntry[];
  loading: boolean;
  error: string | null;
}

/**
 * An `I18nLabel` read off a served document, resolved in `locale` through the
 * spec's own resolver. Only the two arms `I18nLabel` declares reach it — a
 * string, or a plain object (the per-locale map; its untagged `default` entry
 * included). Anything else, and text that resolves blank, reads as undeclared.
 */
function authoredText(value: unknown, locale: string): string | undefined {
  if (typeof value !== 'string' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    return undefined;
  }
  const text = resolveI18nLabel(value as I18nLabel, locale);
  return text && text.trim() ? text : undefined;
}

/**
 * Normalize a raw dataset document into a catalog entry, its author-facing
 * text resolved in `locale` (the designer locale — see the file header).
 */
export function toCatalogEntry(doc: Record<string, unknown>, locale: string): DatasetCatalogEntry | null {
  const name = typeof doc.name === 'string' ? doc.name : '';
  if (!name) return null;
  const dimensions: DatasetDimensionInfo[] = Array.isArray(doc.dimensions)
    ? (doc.dimensions as Array<Record<string, unknown>>)
        .filter((d) => d && typeof d.name === 'string' && d.name)
        .map((d) => ({
          name: d.name as string,
          label: authoredText(d.label, locale),
          type: typeof d.type === 'string' ? (d.type as string) : undefined,
        }))
    : [];
  const measures: DatasetMeasureInfo[] = Array.isArray(doc.measures)
    ? (doc.measures as Array<Record<string, unknown>>)
        .filter((m) => m && typeof m.name === 'string' && m.name)
        .map((m) => ({
          name: m.name as string,
          label: authoredText(m.label, locale),
          aggregate: typeof m.aggregate === 'string' ? (m.aggregate as string) : undefined,
        }))
    : [];
  return {
    name,
    ...(typeof doc.object === 'string' && doc.object ? { object: doc.object } : {}),
    label: authoredText(doc.label, locale) ?? name,
    description: authoredText(doc.description, locale),
    dimensions,
    measures,
  };
}

export function useDatasetCatalog(
  /**
   * Pre-resolved catalog. When supplied the hook skips the network fetch
   * entirely and returns this list verbatim.
   */
  override?: DatasetCatalogEntry[],
): UseDatasetCatalogResult {
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  // The documents as served; their text is resolved below, where the hook
  // returns, so a language switch needs no refetch.
  const [state, setState] = React.useState<{
    docs: Array<Record<string, unknown>>;
    loading: boolean;
    error: string | null;
  }>({ docs: [], loading: !override, error: null });

  React.useEffect(() => {
    if (override) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    client
      .list<Record<string, unknown>>('dataset')
      .then((docs) => {
        if (cancelled) return;
        setState({ docs: Array.isArray(docs) ? docs : [], loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ docs: [], loading: false, error: err?.message ?? String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [client, override]);

  const datasets = React.useMemo(
    () =>
      override ??
      state.docs
        .map((doc) => toCatalogEntry(doc, locale))
        .filter((e): e is DatasetCatalogEntry => e !== null),
    [override, state.docs, locale],
  );
  const loading = override ? false : state.loading;
  const error = override ? null : state.error;
  return React.useMemo(() => ({ datasets, loading, error }), [datasets, loading, error]);
}

export interface UseDatasetSemanticsResult {
  dimensions: DatasetDimensionInfo[];
  measures: DatasetMeasureInfo[];
  loading: boolean;
  error: string | null;
}

/**
 * Resolve the bound dataset's dimensions/measures from the catalog, lazily
 * hydrating via `client.get('dataset', name)` when the list endpoint returned
 * a summary without them (some servers list names only).
 */
export function useDatasetSemantics(
  name: string | undefined,
  catalog: UseDatasetCatalogResult,
): UseDatasetSemanticsResult {
  const client = useMetadataClient();
  // The designer locale the hook's own not-found sentence reads in
  // (objectui#10862), read where the hook returns; a transport error passes
  // through as the transport's message. A hydrated document's labels resolve
  // in it too (objectui#11161).
  const locale = useMetadataLocale();
  const entry = name ? catalog.datasets.find((d) => d.name === name) : undefined;
  const needsFetch =
    !!name && !catalog.loading &&
    (!entry || (entry.dimensions.length === 0 && entry.measures.length === 0));

  const [fetched, setFetched] = React.useState<{
    name: string;
    /** The document as served; its text is resolved where the hook returns. */
    doc: Record<string, unknown> | null;
    /** The server answered with no document for `name`. */
    notFound: boolean;
    /** The transport's own message. */
    error: string | null;
  } | null>(null);

  React.useEffect(() => {
    if (!needsFetch || !name) return;
    if (fetched?.name === name) return;
    let cancelled = false;
    client
      .get<Record<string, unknown>>('dataset', name)
      .then((doc) => {
        if (cancelled) return;
        setFetched({ name, doc: doc ?? null, notFound: !doc, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setFetched({ name, doc: null, notFound: false, error: err?.message ?? String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [client, name, needsFetch, fetched]);

  const own = needsFetch && fetched?.name === name ? fetched : null;
  const ownDoc = own?.doc ?? null;
  const ownEntry = React.useMemo(
    () => (ownDoc ? toCatalogEntry(ownDoc, locale) : null),
    [ownDoc, locale],
  );
  const resolved = own ? ownEntry : entry;
  return {
    dimensions: resolved?.dimensions ?? [],
    measures: resolved?.measures ?? [],
    loading: catalog.loading || (needsFetch && fetched?.name !== name),
    error: (own ? (own.notFound ? t('engine.form.datasetNotFound', locale) : own.error) : null) ?? catalog.error,
  };
}
