// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE builder of a new view's list-view `spec` (objectui#11581).
 *
 * The Create View dialog has two persisting doors: "Save as view" on the
 * object data page (`ObjectDataPage.buildSaveAsViewSpec`) and the add-view
 * door on the object page (`ObjectView.buildAddViewSpec`, behind
 * `handleViewCreate`). Each door resolves its OWN inputs: the columns to fall
 * back on when the payload carries none, and, for "Save as view", the URL
 * conditions folded into spec filter rules (objectui#3419). Everything else is
 * decided here, once, so a type-specific rule can never live at one door and
 * be missing at the other. That is how the defect happened: only the add-view
 * door mirrored the columns into `kanban.columns`, which the spec requires,
 * and "Save as view" persisted a kanban the view write door refused.
 *
 * Both doors then wrap the result with `viewEnvelope` and persist it through
 * `createRuntimeMetadata`. `CreateViewDialog.viewTypeParse-11581.test.tsx`
 * parses what both doors build, for every type the dialog offers.
 */

import type { ViewFilterRule } from '@objectstack/spec/ui';
import type { ListViewVisualization } from '@object-ui/core';

/** What a door resolves for itself before handing the payload over. */
export interface NewViewInputs {
  /** The door's own column list, used only when the payload carries none. */
  fallbackColumns: string[];
  /** The door's spec filter rules. An empty or absent list writes no `filter`. */
  filter?: ViewFilterRule[];
}

type ViewBlock = Record<string, unknown>;
type ColumnMirror = (block: ViewBlock, columns: string[]) => ViewBlock;

/**
 * Write the resolved column list into a type's own block, for the view types
 * whose spec block carries a field list of its own. Typed as a TOTAL record
 * over the visualizations, so a visualization added to the spec fails the
 * build here until someone decides whether its block needs the columns;
 * `null` is that decision for "no".
 */
const COLUMN_MIRRORS: Record<ListViewVisualization, ColumnMirror | null> = {
  // `KanbanConfigSchema.columns` is REQUIRED ("Fields to show on cards"), and
  // the dialog collects only the group-by pick.
  kanban: (block, columns) => ({ ...block, columns }),
  // `GalleryConfigSchema.visibleFields` is optional, but `ObjectGallery` draws
  // no card body without it. A list the payload already carries is kept.
  gallery: (block, columns) =>
    Array.isArray(block.visibleFields) && block.visibleFields.length > 0
      ? block
      : { ...block, visibleFields: columns },
  grid: null,
  calendar: null,
  timeline: null,
  gantt: null,
  map: null,
  chart: null,
  tree: null,
};

/**
 * Build the list-view `spec` a door hands to `viewEnvelope`, from the dialog
 * payload (`{ type, label, name, [type]: block }`, or the view-config panel's
 * create-mode draft) and the door's own {@link NewViewInputs}.
 *
 * @internal Shared by the two doors; not exported from the package index.
 */
export function buildNewViewSpec(
  config: Record<string, unknown>,
  { fallbackColumns, filter }: NewViewInputs,
): Record<string, unknown> {
  const columns: string[] =
    Array.isArray(config.columns) && config.columns.length > 0 ? config.columns : fallbackColumns;
  const spec: Record<string, unknown> = {
    ...config,
    columns,
    // No rules writes no `filter` key at all, byte-identical to a save with
    // no conditions.
    ...(filter && filter.length > 0 ? { filter } : {}),
  };
  const type = config.type;
  // `hasOwnProperty`, not a bare index: `'toString'` is not a view type.
  if (typeof type === 'string' && Object.prototype.hasOwnProperty.call(COLUMN_MIRRORS, type)) {
    const mirror = COLUMN_MIRRORS[type as ListViewVisualization];
    if (mirror) spec[type] = mirror((spec[type] as ViewBlock | undefined) ?? {}, columns);
  }
  return spec;
}
