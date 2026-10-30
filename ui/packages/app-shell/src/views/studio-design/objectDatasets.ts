// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0021 datasets a chart view of one object may bind, and the bound
 * dataset's measures and dimensions: the one reading the console's Create
 * View dialog (objectui#11576) and the Studio list-view panel's chart section
 * (objectstack#27933) both pick from.
 *
 * Built on the metadata-admin readers (`useDatasetCatalog`,
 * `useDatasetSemantics`), with no endpoint or client of its own. Only the
 * datasets whose base `object` is this object are offered, never the whole
 * catalog, and only a dataset among them is ever resolved, so a stale or
 * foreign name never feeds the measure and dimension pickers.
 */

import * as React from 'react';
import {
  useDatasetCatalog,
  useDatasetSemantics,
  type DatasetCatalogEntry,
  type UseDatasetCatalogResult,
  type UseDatasetSemanticsResult,
} from '../metadata-admin/previews/useDatasetCatalog.js';

/**
 * The catalog a caller that cannot use one asks for: none. Handed to
 * `useDatasetCatalog` as its pre-resolved list, so mounting fetches nothing.
 * A module constant, so the hook sees one list rather than a fresh array per
 * render.
 */
const NO_DATASETS: DatasetCatalogEntry[] = [];

export interface ObjectDatasetBinding {
  /** The catalog as read: its `loading` and `error` are the list's. */
  catalog: UseDatasetCatalogResult;
  /** The datasets whose base `object` is this object, in catalog order. */
  datasets: DatasetCatalogEntry[];
  /** `dataset`, when it is one of {@link datasets}; else `undefined`. */
  bound: string | undefined;
  /** The bound dataset's measures and dimensions (empty while none is bound). */
  semantics: UseDatasetSemanticsResult;
}

export function useObjectDatasetBinding(
  objectName: string | undefined,
  dataset: string | undefined,
  options: {
    /** `false` reads nothing (a closed dialog). Default `true`. */
    enabled?: boolean;
    /** Read the draft-overlaid catalog (a Studio author's world). */
    previewDrafts?: boolean;
  } = {},
): ObjectDatasetBinding {
  const read = options.enabled !== false && !!objectName;
  const catalog = useDatasetCatalog(read ? undefined : NO_DATASETS, { previewDrafts: options.previewDrafts === true });
  const datasets = React.useMemo(
    () => (objectName ? catalog.datasets.filter((d) => d.object === objectName) : []),
    [catalog.datasets, objectName],
  );
  const bound = dataset && datasets.some((d) => d.name === dataset) ? dataset : undefined;
  const semantics = useDatasetSemantics(bound, catalog);
  return { catalog, datasets, bound, semantics };
}

/** `LABEL (name)`, or the bare name when the dataset declares no other label. */
export function datasetOptionLabel(d: DatasetCatalogEntry): string {
  return d.label && d.label !== d.name ? `${d.label} (${d.name})` : d.name;
}
