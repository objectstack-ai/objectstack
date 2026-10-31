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
 * tier (`RecordPageColumns` sets it) and, where its strip cannot be laid out,
 * as its tab strip (the console's record view sets it around the page).
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
 * The most columns a frameless detail section may take on the page being
 * drawn (objectstack#27524, Target 6): the record page's layout sets 2 in its
 * two-column tier, where the details share the row with the 320 px right
 * column, and leaves 3 in the wide tier and the stack, where the section's
 * own container width decides. 3 anywhere else.
 */
export const DetailsColumnCapContext = React.createContext<2 | 3>(3);

/**
 * How many columns a frameless detail section lays its fields in, by the
 * number of fields it shows (objectstack#27055, the v3 design: 「每段按字段数
 * 1–3 列」): one field takes one column, two to five take two, six and more
 * take three — never more than `cap` ({@link DetailsColumnCapContext}).
 */
export function framelessSectionColumns(visibleFieldCount: number, cap: 2 | 3 = 3): 1 | 2 | 3 {
  if (visibleFieldCount <= 1) return 1;
  if (visibleFieldCount <= 5 || cap === 2) return 2;
  return 3;
}
