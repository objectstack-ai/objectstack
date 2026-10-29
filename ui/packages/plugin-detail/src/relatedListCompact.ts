/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';

/**
 * `true` inside the record page's related column (objectstack#26678): a
 * fixed rail 320 px wide, where a related list draws as a compact card —
 * title + count + ＋ in one row, no table header, up to three rows of name +
 * one status / date chip, ⤢ to enlarge (objectstack#27055, Target 4) —
 * instead of a table cut off at the column's edge.
 *
 * Set by `RecordPageColumns` only, so a related list anywhere else — the
 * Related tab, an authored page — draws exactly as before. Package-internal:
 * not exported from the barrel.
 */
export const RelatedListCompactContext = React.createContext(false);

/** How many rows a compact related card names. */
export const COMPACT_RELATED_ROWS = 3;

/**
 * The reader's controls over one related card (objectstack#27055, Targets 7,
 * 9 and 10), handed to the card by the arranged stack that draws it. Absent
 * outside that stack: the card then has no menu, no drag and no enlarge.
 */
export interface RelatedCardChrome {
  /** The relationship id, `CHILD_OBJECT.FK_FIELD`. */
  id: string;
  /** New since the reader's last drag — the 「新」 badge. */
  fresh: boolean;
  /** Collapse the card to its title + count. */
  onCollapse: () => void;
  /** Move one place up / down in the column; absent at the edge. */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Hide the card (「隐藏」). */
  onHide: () => void;
  /** Enlarge the list in place (⤢, the count chip) — `?related=object.field`. */
  onEnlarge?: () => void;
  /** Spread onto the title row: the card's drag handle (desktop only). */
  dragHandleProps?: React.HTMLAttributes<HTMLElement> & { draggable?: boolean };
}

/** The chrome of the card being drawn, or `null` outside an arranged stack. */
export const RelatedCardChromeContext = React.createContext<RelatedCardChrome | null>(null);

/**
 * The drop line of a card being dragged over (objectstack#27055): the stack
 * marks the card the dragged one would land before with
 * `data-related-drop="before"` (the last card `after`), and the card draws a
 * primary line on that edge. Literal classes, so Tailwind's scanner emits them.
 */
export const RELATED_CARD_DROP_LINE =
  'data-[related-drop=before]:shadow-[0_-3px_0_0_var(--color-primary)] data-[related-drop=after]:shadow-[0_3px_0_0_var(--color-primary)]';

/**
 * The relationship ids the synthesized default record page draws as the
 * record's BODY tables (objectstack#27055, Target 8) — the related lists its
 * Details tab places among the field sections. A list whose id is in the set
 * takes the body face: collapsible, ⤢ to enlarge, a totals line under its
 * numeric columns, no 「查看全部」. Set by the record page host from the page
 * itself (`bodyTableIdsOf`); empty anywhere else.
 */
export const RecordBodyTablesContext = React.createContext<ReadonlySet<string>>(new Set());

/** Enlarge a related list in place — the host's `?related=` — for a body table. */
export const RelatedEnlargeContext = React.createContext<((id: string) => void) | null>(null);
