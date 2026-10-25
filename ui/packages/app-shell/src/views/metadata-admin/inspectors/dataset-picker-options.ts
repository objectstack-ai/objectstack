// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dataset catalog as picker options — the ONE place every dataset picker
 * reads the author's text from (objectui#11161).
 *
 * Moved out of `ReportDefaultInspector.tsx` for objectui#11601, unchanged: the
 * spec-form `ref:dataset` widget in `widgets.tsx` offers the same options, and
 * importing them from the inspector would close a cycle (the inspector renders
 * `SchemaForm`, which imports the widget registry). Pure functions, no React,
 * so both the inspectors and the widget registry can import this module.
 *
 * An option's VALUE is always the dataset's machine name: the label and the
 * description are display only, and never reach what a binding stores.
 */

import type { DatasetCatalogEntry } from '../previews/useDatasetCatalog.js';

/** `LABEL (name)`, or the bare name when no label is declared or it repeats the name. */
export function labelBesideName(name: string, label: string | undefined): string {
  return label && label !== name ? `${label} (${name})` : name;
}

/** The catalog as dataset-picker options: `LABEL (name)`, the description as `hint`. */
export function datasetPickerOptions(
  datasets: DatasetCatalogEntry[],
): Array<{ value: string; label: string; hint?: string }> {
  return datasets.map((d) => ({
    value: d.name,
    label: labelBesideName(d.name, d.label),
    ...(d.description ? { hint: d.description } : {}),
  }));
}

/**
 * The same options for a slot that renders TEXT ONLY — a select item: a
 * declared description follows the label after ` — ` (the objectui#11028 form).
 */
export function datasetSelectOptions(
  datasets: DatasetCatalogEntry[],
): Array<{ value: string; label: string }> {
  return datasetPickerOptions(datasets).map((o) => ({
    value: o.value,
    label: o.hint ? `${o.label} — ${o.hint}` : o.label,
  }));
}
