/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Dataset catalog types for the dashboard widget config panel (ADR-0021).
 *
 * `WidgetConfigPanel` authors the semantic-layer shape (`dataset` +
 * `dimensions` + `values`) and needs (a) the list of datasets to bind and
 * (b) the bound dataset's dimensions/measures to offer as picker options.
 *
 * The shape mirrors app-shell's `DatasetCatalogEntry`
 * (`views/metadata-admin/previews/useDatasetCatalog.ts`). It is duplicated here
 * — not imported — because `@object-ui/plugin-dashboard` must not depend on
 * `@object-ui/app-shell` (layering). Hosts resolve the catalog (e.g. via the
 * metadata client's `list('dataset')`) and inject it through the panel's
 * `datasets` prop, keeping the plugin network-free and testable.
 */

export interface WidgetDatasetDimension {
  /** Dimension name (snake_case, referenced by `widget.dimensions`). */
  name: string;
  /** Human label (falls back to the name). */
  label?: string;
  /** Raw field type id when declared (e.g. 'text', 'date'). */
  type?: string;
}

export interface WidgetDatasetMeasure {
  /** Measure name (snake_case, referenced by `widget.values`). */
  name: string;
  /** Human label (falls back to the name). */
  label?: string;
  /** Aggregate function (sum / avg / count / …) — display hint only. */
  aggregate?: string;
}

export interface WidgetDatasetCatalogEntry {
  /** Dataset unique name (what `widget.dataset` stores). */
  name: string;
  /** Human label (falls back to the name). */
  label?: string;
  dimensions: WidgetDatasetDimension[];
  measures: WidgetDatasetMeasure[];
}
