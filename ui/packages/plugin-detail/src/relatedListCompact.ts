/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import type { FilterBuilderRowGroup, SortItem } from '@object-ui/components';
import type { DataSource } from '@object-ui/types';

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

/**
 * What a record page's EDIT STATE draws in place of its body tables
 * (objectstack#35599): the relationship ids (`CHILD_OBJECT.FK_FIELD`) it edits,
 * and the element it draws for each — the host's editor, supplied by the host
 * because this package does not draw editable lines. A `record:related_list`
 * whose id is in `ids` renders `render(...)` instead of its read-only list;
 * every other list, and every list while the value is `null` (read mode, and
 * every page that is not a record page in its edit state), renders as before.
 *
 * Set by the record page host only while its edit state is open and one batch
 * can carry the tables. The page keeps its `record:related_list` nodes: the
 * editor is a host element, never a node type a page could carry.
 */
export interface RecordBodyTableEditorSlot {
  /** The body tables the edit state edits, by relationship id. */
  ids: ReadonlySet<string>;
  /** The editor drawn in a body table's place. */
  render: (table: { objectName: string; relationshipField: string; title?: string }) => React.ReactNode;
}

/** The open edit state's body-table editor slot, or `null` (see {@link RecordBodyTableEditorSlot}). */
export const RecordBodyTableEditorSlotContext = React.createContext<RecordBodyTableEditorSlot | null>(null);

/**
 * What a related list opened as the record page's tab draws as its condition
 * row (objectstack#35892): the list page's own Sort and Filter, supplied by the
 * host because the row lives in `@object-ui/plugin-list`, which depends on
 * this package. The host draws `plugin-list`'s `ListConditionsBlock`; while
 * the value is `null` (a host that supplies none) the tab draws no condition
 * row. A host element, never a node type a page could carry.
 */
export interface RelatedListConditionsProps {
  objectName?: string;
  objectDef?: { fields?: Record<string, any> } | null;
  /** The fields the tab's table shows, in column order. */
  shownFields?: ReadonlyArray<string>;
  sort: ReadonlyArray<SortItem>;
  onSortChange: (next: SortItem[]) => void;
  filters: FilterBuilderRowGroup;
  /** The next filter group, with the query node it applies (`undefined` = no filter). */
  onFiltersChange: (next: FilterBuilderRowGroup, filter: unknown[] | undefined) => void;
  /** 「Discard」 at the row's end, passed only while the reader changed anything. */
  onDiscard?: () => void;
  /** Where the names of the records a lookup condition points at are read. */
  dataSource?: Pick<DataSource, 'find' | 'getObjectSchema'> | null;
}

/** The host's condition row for a related tab, or `null` (see {@link RelatedListConditionsProps}). */
export const RelatedListConditionsSlotContext = React.createContext<((props: RelatedListConditionsProps) => React.ReactNode) | null>(null);

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
