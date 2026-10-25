/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { ListView as SpecListView } from '@objectstack/spec/ui';

/**
 * The flat product of a list view's `gantt` block: one entry per key the
 * `@objectstack/spec` list view's `gantt` block declares, under the name
 * `ObjectGantt` reads it by on the node (the same name for every key).
 * objectui#6152 round 14 put it in place of the raw spreads of `options.gantt`
 * / `gantt`, which forwarded every key a stored block carried, after the
 * node's own keys: an undeclared key reached the node, and a block key named
 * like a node key (`objectName`, `filter`) overrode the node's own value.
 * Every list-view door refuses an undeclared key in this block, so nothing an
 * author can store is lost.
 *
 * ONE copy (objectui#13458). `plugin-list`'s `ListView` and `plugin-view`'s
 * `ObjectView` each lower the block, and each used to carry its own table;
 * neither package depends on the other, so the table lives here, below both.
 *
 * TOTAL over the spec's own type: a key the spec adds to the block fails `tsc`
 * here until it is listed, so a declared key cannot be dropped by not being
 * written down. Type-only import, so nothing about the spec reaches the
 * runtime bundle.
 */
export const GANTT_CONFIG_SPELLING = {
  startDateField: 'startDateField',
  endDateField: 'endDateField',
  titleField: 'titleField',
  progressField: 'progressField',
  dependenciesField: 'dependenciesField',
  colorField: 'colorField',
  parentField: 'parentField',
  typeField: 'typeField',
  baselineStartField: 'baselineStartField',
  baselineEndField: 'baselineEndField',
  groupByField: 'groupByField',
  resourceView: 'resourceView',
  assigneeField: 'assigneeField',
  effortField: 'effortField',
  capacity: 'capacity',
  tooltipFields: 'tooltipFields',
  quickFilters: 'quickFilters',
  autoZoomToFilter: 'autoZoomToFilter',
  viewMode: 'viewMode',
  borderColorField: 'borderColorField',
  lockField: 'lockField',
  objectField: 'objectField',
  summaryExtent: 'summaryExtent',
  defaultCollapsedDepth: 'defaultCollapsedDepth',
  dependencyTypes: 'dependencyTypes',
  timeZone: 'timeZone',
  exportFileName: 'exportFileName',
  interactions: 'interactions',
  timeSegments: 'timeSegments',
} as const satisfies Record<keyof NonNullable<SpecListView['gantt']>, string>;
