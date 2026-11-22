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
 * author's choice (ADR-0085). The one exception is the empty-sections line:
 * every `record:details` body draws it, authored page included
 * (`EmptySectionsLineContext`, objectstack#35019).
 */
export const DefaultRecordPageContext = React.createContext(false);

/** Whether the block is drawn on the synthesized default record page. */
export function useDefaultRecordPage(): boolean {
  return React.useContext(DefaultRecordPageContext);
}

/**
 * `true` around the `DetailView` a `record:details` node mounts: that body
 * folds its entirely empty sections into one closing line
 * (`EmptySectionsLine`), on an authored record page as on the synthesized
 * default one (objectstack#35019).
 *
 * Module-internal on purpose, the way `RecordPageProvenanceContext` is: not
 * re-exported from the package barrel, and neither a `DetailView` prop nor a
 * `DetailViewSchema` key. How a details body folds its empty sections is the
 * renderer's face, not something a page authors (ADR-0085). Everything else
 * reads the default, `false` — the `detail-view` node, the record drawer and
 * overlay panel, a direct React caller — and keeps the whole-body fold
 * (`EmptySectionsFold`).
 */
export const EmptySectionsLineContext = React.createContext(false);

/**
 * One approval band per record page (objectstack#35253, objectstack#35483,
 * objectstack#35484): the band (the "Locked for approval" / "In approval"
 * status chip, its recall lever and its tally, drawn by a `DetailView` whose
 * own header is suppressed) is the RECORD's state, so a page draws it once,
 * however many `record:details` bodies it places. Every page host mounts
 * {@link ApprovalBandOnceScope} around its details: the laid-out page around
 * its details column (`RecordPageColumns`), and the host around a page drawn
 * as written (an authored page, or a synthesized page whose strip cannot be
 * laid out). Under the scope every body that reaches the band's place marks
 * it, and only the FIRST mark in document order draws the band: a first node
 * that draws no body leaves no mark, and a `lockRecord: false` first node
 * draws its own (editable) band, the page's one. The band keeps its recall
 * lever and its tally. Outside a scope — a standalone `DetailView` (the `detail-view`
 * node, an overlay panel) — every body draws its band as before. Whether the band reads locked
 * or editable is untouched: that is `resolveApprovalLock`'s rule.
 */
export interface ApprovalBandOnce {
  /** Mark a body's band place; returns the unmark. `onChange` re-renders the body when the first mark moves. */
  register: (mark: Element, onChange: () => void) => () => void;
  /** The first mark in document order, or `null`. */
  first: () => Element | null;
}

export function createApprovalBandOnce(): ApprovalBandOnce {
  const marks = new Map<Element, () => void>();
  const notify = () => {
    for (const onChange of Array.from(marks.values())) onChange();
  };
  return {
    register(mark, onChange) {
      marks.set(mark, onChange);
      notify();
      return () => {
        marks.delete(mark);
        notify();
      };
    },
    first() {
      let first: Element | null = null;
      for (const mark of marks.keys()) {
        if (!mark.isConnected) continue;
        if (!first || first.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_PRECEDING) first = mark;
      }
      return first;
    },
  };
}

export const ApprovalBandOnceContext = React.createContext<ApprovalBandOnce | null>(null);

/** The page scope under which one approval band is drawn (see {@link ApprovalBandOnce}). */
export function ApprovalBandOnceScope({ children }: { children?: React.ReactNode }): React.ReactElement {
  const [once] = React.useState(createApprovalBandOnce);
  return React.createElement(ApprovalBandOnceContext.Provider, { value: once }, children);
}

/**
 * A details body's part in the page's one band: `draws` is whether this body
 * draws it, `mark` the hidden element it renders where the band would be.
 * Outside a scope it draws, with no mark.
 */
export function useApprovalBandOnce(): { draws: boolean; mark: React.ReactNode } {
  const once = React.useContext(ApprovalBandOnceContext);
  const [mark, setMark] = React.useState<HTMLElement | null>(null);
  const [, rerender] = React.useReducer((n: number) => n + 1, 0);
  React.useLayoutEffect(() => {
    if (!once || !mark) return undefined;
    return once.register(mark, rerender);
  }, [once, mark]);
  if (!once) return { draws: true, mark: null };
  return {
    draws: mark !== null && once.first() === mark,
    mark: React.createElement('span', { ref: setMark, hidden: true, 'data-approval-band-mark': '' }),
  };
}

/**
 * The most columns a frameless detail section may take on the page being
 * drawn: the record page's layout sets 1 wherever the details sit beside other
 * tabs or are one of them — a drawer, a phone, a narrow page, the pinned left
 * column (objectstack#36147: one field a row, label left and value right, at
 * any width) — and leaves 3 only on a full page whose details are its only
 * face, where the section's own container width decides. 3 anywhere else.
 * 1 is also the field list face: `DetailSection` draws its rows one under the
 * other with a hairline between them.
 */
export const DetailsColumnCapContext = React.createContext<1 | 2 | 3>(3);

/**
 * How many columns a frameless detail section lays its fields in, by the
 * number of fields it shows (objectstack#27055, the v3 design: 「每段按字段数
 * 1–3 列」): one field takes one column, two to five take two, six and more
 * take three — never more than `cap` ({@link DetailsColumnCapContext}).
 */
export function framelessSectionColumns(visibleFieldCount: number, cap: 1 | 2 | 3 = 3): 1 | 2 | 3 {
  if (visibleFieldCount <= 1 || cap === 1) return 1;
  if (visibleFieldCount <= 5 || cap === 2) return 2;
  return 3;
}
