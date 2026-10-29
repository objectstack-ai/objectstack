/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';

/**
 * `true` while the synthesized default record page draws (objectstack#27055):
 * the page `buildDefaultPageSchema` writes from the object's roles, in every
 * tier — the column tiers (`RecordPageColumns` sets it) and the tab strip (the
 * console's record view sets it around the synthesized page).
 *
 * The record page v3 face reads it: detail sections drawn frameless (a title,
 * a hairline and the field grid, no card), entirely empty sections folded into
 * one line, the highlight strip as an equal-width grid, and the provenance
 * line naming the owner and the record id. A block drawn anywhere else — an
 * authored page, a dashboard, a standalone `DetailView` — keeps its own face,
 * because no metadata key says "v3": the face is the default page's, never an
 * author's choice (ADR-0085).
 */
export const DefaultRecordPageContext = React.createContext(false);

/** Whether the block is drawn on the synthesized default record page. */
export function useDefaultRecordPage(): boolean {
  return React.useContext(DefaultRecordPageContext);
}

/**
 * How many columns a frameless detail section lays its fields in, by the
 * number of fields it shows (objectstack#27055, the v3 design: 「每段按字段数
 * 1–3 列」): one field takes one column, two to five take two, six and more
 * take three. Never more than three — the details column is the page's widest
 * but shares the row with the timeline and related columns.
 */
export function framelessSectionColumns(visibleFieldCount: number): 1 | 2 | 3 {
  if (visibleFieldCount <= 1) return 1;
  if (visibleFieldCount <= 5) return 2;
  return 3;
}
