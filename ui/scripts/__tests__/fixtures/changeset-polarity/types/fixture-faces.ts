/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Member-set fixture for `changeset-polarity-census.test.ts`.
 *
 * ⛔ Not a face this repository publishes and not a mirror of one. These
 * declarations exist so the census pins judge the INSTRUMENT rather than the
 * live `packages/types/src`, whose members move whenever a card declares one --
 * which is the very thing the census is built to notice. A pin that read the
 * live tree would go red for the tree's reasons rather than the instrument's.
 */

export interface BaseSchema {
  type: string;
  className?: string;
  /** Admitted and never examined -- this is NOT membership. */
  [key: string]: unknown;
}

export interface LaneSchema {
  id: string;
  /** Belongs to the LANE. A board that references a lane does not declare it. */
  cards: string[];
}

export interface ObjectKanbanSchema extends BaseSchema {
  type: 'object-kanban';
  groupBy?: string;
  columns?: LaneSchema[];
  cardTitle?: string;
  titleField?: string;
  allowCollapse?: boolean;
}

export interface SpinnerSchema extends BaseSchema {
  type: 'spinner';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}
