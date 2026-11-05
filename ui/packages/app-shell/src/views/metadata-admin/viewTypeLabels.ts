// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The human name of a list view `type` (grid, kanban, …), shared by every
 * metadata-admin control that offers view types, so they cannot disagree:
 *
 *  - the view-type select in `ViewVariantInspector`;
 *  - the `multiselect` chips over the same enum
 *    (`appearance.allowedVisualizations`, objectstack#30358).
 */

import { t } from './i18n.js';

/** English fallback labels for the spec view-type enum (used when the i18n
 * catalog has no entry for a view type the spec introduces later). */
const VIEW_TYPE_FALLBACK_LABELS: Record<string, string> = {
  grid: 'Table / List',
  kanban: 'Kanban',
  calendar: 'Calendar',
  gallery: 'Gallery',
  gantt: 'Gantt',
  timeline: 'Timeline',
  map: 'Map',
  chart: 'Chart',
  tree: 'Tree',
};

/** Whether `value` is a view type this module has a name for. */
export function isKnownViewType(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(VIEW_TYPE_FALLBACK_LABELS, value);
}

/** Localized label for a view `type`, falling back to the English map (and
 * then the raw value) when the i18n catalog has no entry. */
export function viewTypeLabel(value: string, locale?: string): string {
  const key = `engine.inspector.view.type.${value}`;
  const translated = t(key, locale);
  return translated === key ? (VIEW_TYPE_FALLBACK_LABELS[value] ?? value) : translated;
}
