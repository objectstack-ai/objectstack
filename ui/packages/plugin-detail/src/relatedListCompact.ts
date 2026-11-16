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
 * fixed rail 320 px wide, where a related list draws as a panel — its header
 * (title + count, the ⠿ ＋ ⋯ controls on hover, objectstack#27524 Target 1),
 * no table header, up to three rows of name + one status / date chip
 * (objectstack#27055, Target 4) — instead of a table cut off at the column's
 * edge.
 *
 * Set by `RecordPageColumns` only, so a related list anywhere else — the
 * Related tab, an authored page — draws exactly as before. Package-internal:
 * not exported from the barrel.
 */
export const RelatedListCompactContext = React.createContext(false);

/** How many rows a compact related card names. */
export const COMPACT_RELATED_ROWS = 3;

/**
 * The reader's controls over one related panel (objectstack#27055, Targets 7,
 * 9 and 10; objectstack#27524, Target 1), handed to the panel by the arranged
 * stack that draws it. Absent outside that stack: the panel then has no
 * handle, no menu and no way to its whole list.
 */
export interface RelatedCardChrome {
  /** The relationship id, `CHILD_OBJECT.FK_FIELD`. */
  id: string;
  /** New since the reader's last drag — the 「新」 badge. */
  fresh: boolean;
  /**
   * Move one place up / down in the column — ⌥↑ / ⌥↓ on the focused ⠿
   * handle, the drag's keyboard twin; absent at the edge.
   */
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  /** Hide the panel (「隐藏」, the ⋯ menu's one item). */
  onHide: () => void;
  /**
   * Open the panel's whole list — its header row or its count chip
   * (「查看全部 N 条」). The host's `?related=object.field`.
   */
  onEnlarge?: () => void;
  /** Spread onto the ⠿ handle: the panel's drag source (desktop only). */
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

/**
 * The related list is drawn as the record page's active tab — its enlarged
 * face (objectstack#27524, the ride-along ruled at ③'s preview gate): a
 * toolbar (the filter, 全部 / 我的 / 逾期, 新建, 导出) over the table at the
 * tab's full height, with no card header and no card foot.
 */
export const RelatedListEnlargedContext = React.createContext(false);

/**
 * The count of the compact card being drawn, counted up front by its stack
 * (objectstack#27056, Targets 1 and 2): the card draws its header from it, a
 * count of 0 folds the card to its one line and reads no rows, and a card
 * above 0 reads its first rows only once it scrolls into view. `null` when
 * the stack did not count the card (no data source in context, the read
 * failed, or the card is drawn outside a stack): the card reads for itself.
 */
export const RelatedCardCountContext = React.createContext<number | null>(null);

/**
 * Where a related list reports how many records it holds (objectstack#34250):
 * the count channel of the `page:tabs` panel it sits in, handed down by
 * `record:related_list` when its parent is bound by `parentDataSource`, and
 * `undefined` everywhere else.
 *
 * A parent-bound list has no parent the tab strip can name: on an app page
 * there is no record context at all, and on a record page the page's record is
 * not this list's parent. So the strip cannot probe the count itself, and the
 * list says the number it holds, the one its own header shows, read off the
 * query that drew its rows. The strip keeps such a tab mounted while inactive,
 * so the number is there before the tab is opened. A list whose parent is the
 * page's record never reports: the strip counts it by its own probe, as before.
 *
 * Package-internal: not exported from the package entry.
 */
export const RelatedListTotalReportContext = React.createContext<((total: number) => void) | undefined>(undefined);

/**
 * Has `el` come near the viewport yet (objectstack#27056, Target 2: only the
 * cards in view read their rows)? A latch: once seen, a card keeps its rows
 * when scrolled away. Cards just below the fold count as near (a 200 px
 * margin under the viewport), so a short scroll finds them drawn. Where
 * `IntersectionObserver` does not exist (SSR, jsdom) every card is seen, so
 * no environment strands a card without its rows. With `enabled` false the
 * answer is `true`: the list is not a lazy card.
 */
export function useSeenOnce(el: Element | null, enabled: boolean): boolean {
  const observable = typeof IntersectionObserver !== 'undefined';
  const [seen, setSeen] = React.useState(false);
  React.useEffect(() => {
    if (!enabled || seen || !observable || !el) return undefined;
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) setSeen(true);
      },
      { rootMargin: '0px 0px 200px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, enabled, seen, observable]);
  return !enabled || !observable || seen;
}
