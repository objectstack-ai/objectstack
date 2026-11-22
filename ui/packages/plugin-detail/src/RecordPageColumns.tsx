/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import type { FieldContainerLike } from '@object-ui/core';
import { SchemaRenderer, toRenderableSchema, useRecordContext, useRecordPagePreferences } from '@object-ui/react';
import {
  RECORD_PAGE_DETAILS_MIN_WIDTH,
  RECORD_PAGE_PINNED_GAP,
  RECORD_PAGE_TABS_MIN_WIDTH,
  RECORD_PAGE_TIMELINE_PANEL,
  clampDetailsWidth,
  recordPagePinsDetails,
  relatedListIdsIn,
  type DefaultPageColumns,
  type RecordPageTier,
} from './synth/recordPageColumns';
import { useDetailTranslation } from './useDetailTranslation';
import { RecordBodyTablesContext, RelatedEnlargeContext, RelatedListEnlargedContext } from './relatedListCompact';
import { ApprovalBandOnceScope, DefaultRecordPageContext, DetailsColumnCapContext } from './defaultRecordPage';
import { RECORD_TAB_OVERVIEW, RecordTabRow, type RecordTab, type RecordTabArrangeEdit } from './RecordTabRow';
import {
  RECORD_TAB_APPROVALS,
  RECORD_TAB_ATTACHMENTS,
  approvalsHoldPendingRequest,
  useRecordAttachmentCount,
} from './recordTabBadges';
import { RecordTimelineCountContext } from './recordTimelineStream';
import { createRecordBodyFields, RecordBodyFieldsContext } from './recordBodyFields';
import { createEmptyFieldTally, RecordFieldListContext, type RecordFieldList } from './recordFieldList';
import { EmptyFieldsRow } from './EmptySectionsFold';
import { RecordTimelineCountProbe } from './renderers/record-activity';
import {
  editRelatedArrangement,
  relatedCardId,
  resolveRelatedArrangement,
  type RelatedArrangement,
  type RelatedArrangementEdit,
  type RelatedCardId,
} from './synth/relatedArrangement';
import { relatedCountTargetOf, useRelatedCounts, type RelatedCountTarget } from './useRelatedCounts';

export interface RecordPageColumnsProps {
  /** The tier to draw (`recordPageTierFor` of the container's width). */
  tier: RecordPageTier;
  /** The synthesized page, partitioned (`buildDefaultPageColumns`). */
  columns: DefaultPageColumns;
  /**
   * The record's provenance line (created / updated / owner / id), which the
   * host draws once per page: at the foot of the details column, in every
   * tier (objectstack#27055, the v3 meta line).
   */
  footer?: React.ReactNode;
  /**
   * Whether the page is a full page — not a drawer or a pane — which may pin
   * its details to a left column (objectstack#35890; `recordPagePinsDetails`).
   * Absent: not.
   */
  fullPage?: boolean;
  /**
   * The width the reader dragged the pinned left column to, from the host's
   * preference store (per person, per object), and the setter that keeps a
   * new one. Absent: 400, and a drag holds for this view only.
   */
  detailsWidth?: number;
  onDetailsWidthChange?: (width: number) => void;
  /**
   * Told the tab on screen whenever it changes: `RECORD_TAB_OVERVIEW` for the
   * details as a tab, else the open tab's id — addressed, or implied (the
   * first of the row on a pinned page whose address names none).
   */
  onShownTabChange?: (id: string) => void;
  /**
   * @deprecated The right rail it switched is gone (objectstack#35890); ignored.
   */
  rightColumn?: boolean;
  /**
   * @deprecated The right rail is gone at every width (objectstack#35890);
   * ignored. A full page says so with `fullPage`.
   */
  rail?: boolean;
  /**
   * The reader's arrangement of the related lists (objectstack#27055,
   * Targets 7 and 10) — order, hidden — from the host's workspace preference
   * store, and the setter that keeps a new one; a related tab's menu writes
   * it (objectstack#35783). Absent: the reader's choices hold for this view
   * only.
   */
  relatedArrangement?: RelatedArrangement;
  onRelatedArrangementChange?: (next: RelatedArrangement) => void;
  /**
   * Open a panel's whole face in place — a related list's `object.field`, or
   * `timeline` for the 动态 stream — the host's `?related=`. It is what a
   * tab of the tab row does (objectstack#27524, Target 8); absent, the page
   * draws no tab row. `replace`: the address takes the id in place of its
   * entry, adding none to the history (a pinned page narrowed out of its
   * layout keeps the tab it implied, objectstack#35890).
   */
  onEnlargeRelated?: (id: RelatedCardId, options?: { replace?: boolean }) => void;
  /**
   * The active tab (the host's `?related=`, objectstack#27524, Target 9): a
   * related list's full table, or the 动态 stream in full (`timeline`), drawn
   * under the record header and its tab row, until Esc or 「详情」
   * (`onCloseEnlargedRelated`). An id naming nothing on the page draws the
   * page.
   */
  enlargedRelated?: RelatedCardId;
  onCloseEnlargedRelated?: () => void;
  /**
   * The child objects' field definitions the host holds (its metadata), for
   * the related panels' up-front counts (objectstack#27056). Absent: the
   * counts read each child's definition first.
   */
  relatedFieldsOf?: (objectName: string) => FieldContainerLike;
  className?: string;
}

/** Rows per page of an enlarged related list whose block names no `limit`. */
const ENLARGED_PAGE_SIZE = 25;

/** A node's props: the ADR-0089 D3a `properties` bag over its own keys. */
const nodeProps = (node: any): Record<string, any> =>
  node && typeof node === 'object' ? { ...node, ...(node.properties ?? {}) } : {};

/** The relationship id of a related-list node, or `null`. */
function relatedNodeId(node: any): RelatedCardId | null {
  const p = node && typeof node === 'object' ? { ...node, ...(node.properties ?? {}) } : null;
  if (!p || p.type !== 'record:related_list') return null;
  if (typeof p.objectName !== 'string' || typeof p.relationshipField !== 'string') return null;
  return relatedCardId(p.objectName, p.relationshipField);
}

/**
 * Whether an `Esc` belongs to a layer over the open face: an open menu, alert
 * or floating content (a select, a tooltip), or a dialog the face is not
 * inside (a popover, a confirm, a drawer opened over the page that holds the
 * face). The dialog that holds the face — the record pane's drawer — is not one.
 */
function escapeOwnedByLayer(face: Element): boolean {
  const doc = face.ownerDocument;
  if (doc.querySelector('[role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]')) return true;
  return Array.from(doc.querySelectorAll('[role="dialog"]')).some((dialog) => !dialog.contains(face));
}

function isTypingTarget(target: EventTarget | null): target is Element {
  return (
    target instanceof Element &&
    !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')
  );
}

/**
 * A panel's whole face, open in place — the active tab (objectstack#27524,
 * Target 9): under the record header and its tab row, at the page's full
 * width. The tab names it, so it draws no title of its own; 「概览」 returns,
 * and so does Esc — a dialog or menu open over the page keeps its own Esc,
 * and so does a field the reader types in. Not a modal and not a level down:
 * the header above it stays as it is.
 */
const EnlargedFace: React.FC<{ id: string; title: string; onClose?: () => void; children: React.ReactNode }> = ({
  id,
  title,
  onClose,
  children,
}) => {
  const faceRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!onClose) return undefined;
    // On the window, in the capture phase: inside the record pane the pane's
    // own `Esc` (the drawer's dialog layer, the split pane's document
    // listener) would act first and close or step the pane (objectstack#27524).
    // The face takes the key, and keeps it from the pane.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      const face = faceRef.current;
      if (!face || escapeOwnedByLayer(face)) return;
      if (isTypingTarget(event.target)) {
        // A field keeps its own `Esc` (it closes a mention list, cancels an
        // inline edit), so the key goes on to it; pressed in the face, it is
        // marked handled, and the pane around the face stays open.
        if (face.contains(event.target)) event.preventDefault();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);
  return (
    <section
      ref={faceRef}
      role="tabpanel"
      className="flex min-w-0 flex-col gap-3"
      data-related-enlarged={id}
      aria-label={title}
      aria-keyshortcuts={onClose ? 'Escape' : undefined}
    >
      {children}
    </section>
  );
};

/**
 * The enlarged related list (Target 9, the ONE path to a related list's
 * every record): every column, paging, sort, inline edit — drawn as the
 * tab's face (`RelatedListEnlargedContext`): the toolbar over the table,
 * no card (objectstack#27524).
 */
function enlargedRelatedList(node: any): React.ReactNode {
  const p = { ...node, ...(node.properties ?? {}) };
  const authoredLimit = typeof p.limit === 'number' && p.limit > 0;
  const enlarged = authoredLimit
    ? node
    : { ...node, properties: { ...(node.properties ?? {}), limit: ENLARGED_PAGE_SIZE } };
  return (
    <RelatedListEnlargedContext.Provider value>
      <SchemaRenderer schema={toRenderableSchema(enlarged)} />
    </RelatedListEnlargedContext.Provider>
  );
}

/** The title an enlarged related list's face names it by. */
function relatedNodeTitle(node: any): string {
  const p = { ...node, ...(node.properties ?? {}) };
  return typeof p.title === 'string' && p.title ? p.title : p.objectName;
}

/** Each node of a column, drawn as a sibling of the others: a related-list
 *  stack is the lists sharing a DOM parent (`RelatedListEmptyFold`), so no
 *  per-node wrapper may sit between a list and its column. */
function drawNodes(nodes: any[]): React.ReactNode {
  return nodes.map((node, index) => (
    <SchemaRenderer key={(node && typeof node === 'object' && node.id) || index} schema={toRenderableSchema(node)} />
  ));
}

/**
 * The details column's nodes (objectstack#35253): the synthesized page splits
 * its details around a body table, one `record:details` per run of sections,
 * and the record's approval band is drawn once per page — by the first details
 * body that reaches the band's place (`ApprovalBandOnceScope`), above the
 * table. objectstack#35483 / objectstack#35484 — the same rule as a page drawn
 * as written: a first `record:details` that draws no body (withheld by its
 * `requiredPermissions`, or drawing its own header) leaves the band to the next
 * part instead of taking it off the page. A context provider adds no DOM, so
 * the column's siblings stay siblings (`drawNodes`).
 */
function drawDetailsNodes(nodes: any[]): React.ReactNode {
  return <ApprovalBandOnceScope>{drawNodes(nodes)}</ApprovalBandOnceScope>;
}

const LINE_BUTTON =
  'rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * 「默认顺序已更新 · 恢复默认」 — the reader's order was laid over an older
 * default (rule 5). Under the tab row since the rail it closed went
 * (objectstack#35890); the hidden lists and the reset live in 「更多」.
 */
const RelatedDefaultChangedHint: React.FC<{ onRestore: () => void }> = ({ onRestore }) => {
  const { t } = useDetailTranslation();
  return (
    <p className="text-xs text-muted-foreground" data-related-default-changed="">
      {t('detail.relatedDefaultChanged', { defaultValue: 'Default order updated' })}
      {' · '}
      <button type="button" className={LINE_BUTTON} onClick={onRestore}>
        {t('detail.relatedRestoreDefault', { defaultValue: 'Restore default' })}
      </button>
    </p>
  );
};

/**
 * A column stacks its blocks 16 px apart. A related list folded into its
 * stack's empty line stays MOUNTED with its content `hidden`
 * (`RelatedListStackSlot`), which leaves a zero-height root that a flex gap
 * would still space out — eight folded lists, eight empty gaps. A child whose
 * only child is hidden draws nothing, so it is taken out of the flow.
 */
const COLUMN_STACK = 'flex min-w-0 flex-col gap-4 [&>*:has(>[hidden]:only-child)]:hidden';

/** The nearest ancestor of `el` that scrolls vertically, or `null`. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  const view = el.ownerDocument.defaultView;
  if (!view) return null;
  for (let node = el.parentElement; node; node = node.parentElement) {
    const overflowY = view.getComputedStyle(node).overflowY;
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/** The content-box width of `el`, measured before paint and on every resize; 0 while unknown. */
function useContentWidth(el: HTMLElement | null): number {
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return width;
}

/** Below this, the pinned columns are not bounded: the page scrolls as one. */
const PINNED_MIN_HEIGHT = 360;

/**
 * The height the pinned columns take so each scrolls on its own
 * (objectstack#35890, card item 2): the rest of the scroller the page sits in,
 * below the columns' top and above the paddings under them, so the page
 * itself does not scroll. `null` — the columns flow with the page — with no
 * scrolling ancestor (a test environment) or less room than
 * {@link PINNED_MIN_HEIGHT}.
 */
function usePinnedHeight(grid: HTMLElement | null, frame: HTMLElement | null): number | null {
  const [height, setHeight] = React.useState<number | null>(null);
  React.useLayoutEffect(() => {
    if (!grid || !frame) {
      setHeight(null);
      return undefined;
    }
    const scroller = scrollParentOf(frame);
    if (!scroller) {
      setHeight(null);
      return undefined;
    }
    const view = frame.ownerDocument.defaultView!;
    const measure = () => {
      const top = grid.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientTop
        + scroller.scrollTop;
      const below = (parseFloat(view.getComputedStyle(frame).paddingBottom) || 0)
        + (parseFloat(view.getComputedStyle(scroller).paddingBottom) || 0);
      const room = Math.floor(scroller.clientHeight - top - below);
      setHeight(room >= PINNED_MIN_HEIGHT ? room : null);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [grid, frame]);
  return height;
}

/** How far one arrow-key press moves the pinned left column's edge. */
const DETAILS_WIDTH_KEY_STEP = 16;

/**
 * The pinned left column's drag handle (objectstack#35890: 「左栏宽 400，可以
 * 拖宽，拖过的宽度按人记住」), sitting in the gap between the columns: a
 * vertical separator, dragged with the pointer or moved with ← → (Home / End
 * to either end). `onPreview` follows the drag; `onCommit` keeps the width
 * once the drag ends.
 */
const DetailsWidthHandle: React.FC<{
  width: number;
  max: number;
  onPreview: (width: number | null) => void;
  onCommit: (width: number) => void;
}> = ({ width, max, onPreview, onCommit }) => {
  const { t } = useDetailTranslation();
  const drag = React.useRef<{ x: number; width: number; last: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.max(RECORD_PAGE_DETAILS_MIN_WIDTH, Math.min(w, max)));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('detail.detailsColumnResize', { defaultValue: 'Resize details column' })}
      aria-valuenow={width}
      aria-valuemin={RECORD_PAGE_DETAILS_MIN_WIDTH}
      aria-valuemax={max}
      tabIndex={0}
      className="group relative flex cursor-col-resize touch-none justify-center focus-visible:outline-none"
      data-record-details-resize=""
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { x: event.clientX, width, last: width };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        start.last = clamp(start.width + event.clientX - start.x);
        onPreview(start.last);
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        drag.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        onPreview(null);
        if (start && start.last !== start.width) onCommit(start.last);
      }}
      onPointerCancel={() => {
        drag.current = null;
        onPreview(null);
      }}
      onKeyDown={(event) => {
        const next =
          event.key === 'ArrowLeft' ? width - DETAILS_WIDTH_KEY_STEP
          : event.key === 'ArrowRight' ? width + DETAILS_WIDTH_KEY_STEP
          : event.key === 'Home' ? RECORD_PAGE_DETAILS_MIN_WIDTH
          : event.key === 'End' ? max
          : null;
        if (next === null) return;
        event.preventDefault();
        if (clamp(next) !== width) onCommit(clamp(next));
      }}
    >
      <span
        aria-hidden="true"
        className="h-full w-px bg-border transition-colors group-hover:bg-primary/60 group-focus-visible:bg-ring"
      />
    </div>
  );
};

/**
 * The synthesized default record page, laid out by the width it has
 * (objectstack#26678; one rule since objectstack#27524, Target 6): one record
 * header, the record's tab row (objectstack#35595: 「详情」, one tab per
 * related list in the reader's arrangement, 附件, 审批, then 动态 last — every
 * tab there at first paint, an empty list muted with no number, the width the
 * row's only fold), then the open tab's face drawn the full width. A page with
 * only the details draws no tab row.
 *
 * Pinned (objectstack#35890, figure 41; `recordPagePinsDetails` — a full page
 * with room for both columns, another tab, and no related table among the
 * fields): the details are a left column (400 px, dragged by the reader, and
 * narrowing on their own to leave the tabs 400 — `clampDetailsWidth`), no
 * longer a tab. Beside them sit the tab row without 「详情」 and the open
 * tab, the first of the row when the address names none. The two scroll
 * apart. Narrowed out of the pinned layout, the page keeps the tab it showed:
 * the implied one is written to the address (`onEnlargeRelated` with
 * `replace`).
 *
 * A strip the page places (`record:path`, `record:highlights`, a slotted
 * page's `highlights`; the default page places none since objectstack#35891)
 * sits atop the details. The right rail of summary cards (objectstack#35596)
 * is gone, at every width: each tab's count carries what it said.
 *
 * The frame mirrors the record page frame `PageRenderer` draws (its padding
 * and background, the header nodes 16 px apart), so the header sits where an
 * authored page's would. The nodes are the page's own — the same
 * `page:header`, `record:details`, `record:activity` and
 * `record:related_list` nodes its tab strip holds — so every width shows the
 * same header and the same sections. `data-record-columns-shown` names the
 * columns drawn side by side.
 */
export const RecordPageColumns: React.FC<RecordPageColumnsProps> = ({
  tier,
  columns,
  footer,
  fullPage = false,
  detailsWidth,
  onDetailsWidthChange,
  onShownTabChange,
  relatedArrangement,
  onRelatedArrangementChange,
  onEnlargeRelated,
  enlargedRelated,
  onCloseEnlargedRelated,
  relatedFieldsOf,
  className,
}) => {
  const { t } = useDetailTranslation();
  const ctx = useRecordContext();
  const bodyTableIds = React.useMemo(() => new Set(relatedListIdsIn(columns.details)), [columns.details]);
  const [bodyFields] = React.useState(createRecordBodyFields);
  // objectstack#36147 — the field area is one list: its groups fold every
  // empty row into the list's last row, shown or not by the reader's one
  // per-object choice (objectstack#25883), or this view's own without a store.
  const [emptyFields] = React.useState(createEmptyFieldTally);
  const recordPagePreferences = useRecordPagePreferences();
  const preferenceObject = typeof ctx?.objectName === 'string' && ctx.objectName ? ctx.objectName : undefined;
  const [localShowEmpty, setLocalShowEmpty] = React.useState(false);
  const showEmpty =
    recordPagePreferences && preferenceObject
      ? recordPagePreferences.get(preferenceObject).showEmptyFields === true
      : localShowEmpty;
  const fieldList = React.useMemo<RecordFieldList>(
    () => ({
      showEmpty,
      toggleShowEmpty: () => {
        if (recordPagePreferences && preferenceObject) {
          recordPagePreferences.update(preferenceObject, { showEmptyFields: !showEmpty });
        } else {
          setLocalShowEmpty((shown) => !shown);
        }
      },
      emptyFields,
    }),
    [showEmpty, recordPagePreferences, preferenceObject, emptyFields],
  );
  const hasTimeline = columns.timeline.length > 0;

  const approvalsNode = columns.related.find((node) => node?.type === 'record:approvals');
  const attachmentsNode = columns.related.find((node) => node?.type === 'record:attachments');
  const panelNodes = new Map<RelatedCardId, any>();
  for (const node of columns.related) {
    const id = relatedNodeId(node);
    if (id && !panelNodes.has(id)) panelNodes.set(id, node);
  }

  const [localArrangement, setLocalArrangement] = React.useState<RelatedArrangement | undefined>(undefined);
  const arrangement = onRelatedArrangementChange ? relatedArrangement : localArrangement;
  const onArrangementChange = onRelatedArrangementChange ?? setLocalArrangement;
  const [now] = React.useState(() => Date.now());
  const defaultOrder = Array.from(panelNodes.keys());
  const resolved = resolveRelatedArrangement(defaultOrder, arrangement, now);

  const countTargets: RelatedCountTarget[] = [];
  for (const id of [...resolved.order, ...resolved.hidden]) {
    const target = relatedCountTargetOf(panelNodes.get(id));
    if (target) countTargets.push(target);
  }
  const counts = useRelatedCounts(countTargets, {
    parentId: ctx?.recordId,
    dataSource: ctx?.dataSource,
    fieldsOf: relatedFieldsOf,
  });
  const countOf = (id: RelatedCardId): number | null => {
    const state = counts.stateOf(id);
    return state.kind === 'counted' ? state.count : null;
  };
  const attachmentCount = useRecordAttachmentCount(!!attachmentsNode);
  const approvalPending = !!approvalsNode && approvalsHoldPendingRequest(nodeProps(approvalsNode).approvals);

  const recordKey = ctx?.recordId === undefined || ctx?.recordId === null ? '' : String(ctx.recordId);
  const [timelineCount, setTimelineCount] = React.useState<{ record: string; count: number | null }>({
    record: recordKey,
    count: null,
  });
  const recordKeyRef = React.useRef(recordKey);
  recordKeyRef.current = recordKey;
  const reportTimelineCount = React.useCallback((count: number | null) => {
    const record = recordKeyRef.current;
    setTimelineCount((prev) => (prev.record === record && prev.count === count ? prev : { record, count }));
  }, []);
  const streamCount = timelineCount.record === recordKey ? timelineCount.count : null;

  // ── The tabs after 「详情」, in the row's order ──────────────────────────
  const attachmentsTitle = t('detail.attachments', { defaultValue: 'Attachments' });
  const approvalsTitle = t('detail.approvalsPanelTitle', { defaultValue: 'Approvals' });
  const timelineTitle = t('detail.timeline', { defaultValue: 'Activity' });
  const panelTab = (id: RelatedCardId): RecordTab => ({
    id,
    label: relatedNodeTitle(panelNodes.get(id)),
    count: countOf(id),
  });
  const arrangedTab = (id: RelatedCardId, index: number): RecordTab => ({
    ...panelTab(id),
    arrange: { before: index > 0, after: index < resolved.order.length - 1 },
  });
  // A body table the details draw (a field group places it) opens as a tab of
  // its own while it is open: it has no tab of its own otherwise.
  const bodyTableNode =
    enlargedRelated && !panelNodes.has(enlargedRelated)
      ? columns.details.find((n) => relatedNodeId(n) === enlargedRelated)
      : undefined;
  const otherTabs: RecordTab[] = resolved.order.map(arrangedTab);
  if (bodyTableNode) otherTabs.push({ id: enlargedRelated!, label: relatedNodeTitle(bodyTableNode) });
  if (attachmentsNode) otherTabs.push({ id: RECORD_TAB_ATTACHMENTS, label: attachmentsTitle, count: attachmentCount });
  if (approvalsNode) otherTabs.push({ id: RECORD_TAB_APPROVALS, label: approvalsTitle, dot: approvalPending });
  if (hasTimeline) otherTabs.push({ id: RECORD_PAGE_TIMELINE_PANEL, label: timelineTitle, count: streamCount });
  const hiddenTabs = resolved.hidden.map(panelTab);

  // ── Pinned or not: the page content's own width decides ────────────────
  const [contentEl, setContentEl] = React.useState<HTMLDivElement | null>(null);
  const [frameEl, setFrameEl] = React.useState<HTMLDivElement | null>(null);
  const [gridEl, setGridEl] = React.useState<HTMLDivElement | null>(null);
  const contentWidth = useContentWidth(contentEl);
  const pinned = recordPagePinsDetails(contentWidth, columns, fullPage) && otherTabs.length > 0;
  const pinnedHeight = usePinnedHeight(pinned ? gridEl : null, frameEl);
  // objectstack#36147 — the field area is one column wherever it is drawn
  // beside other tabs or as one of them: a drawer, a phone, a narrow page and
  // the pinned left column. Only a full page whose details are its only face
  // (no other tab, objectstack#35890 item 4) keeps laying them out by width.
  const detailsFillPage = fullPage && otherTabs.length === 0 && resolved.hidden.length === 0;

  // The open tab: the address's when it names one this page has; pinned, the
  // first of the row otherwise (it is implied, never written, until the page
  // narrows out of the pinned layout).
  // A list the reader hid still opens: from its item in 「更多」, or from an
  // address that names it (card acceptance: 「带页签参数的链接仍然打开对应页签」).
  const requested =
    enlargedRelated && (otherTabs.some((tab) => tab.id === enlargedRelated) || resolved.hidden.includes(enlargedRelated))
      ? enlargedRelated
      : undefined;
  const impliedTab = pinned && !requested ? otherTabs[0].id : undefined;
  const openTab = requested ?? impliedTab;
  const activeTab = openTab ?? RECORD_TAB_OVERVIEW;

  // Esc leaves a tab for 「详情」; pinned, the details are on screen already.
  const closeFace = pinned ? undefined : onCloseEnlargedRelated;
  const blockFace = (id: string, title: string, node: any) => (
    <EnlargedFace id={id} title={title} onClose={closeFace}>
      <SchemaRenderer schema={toRenderableSchema(node)} />
    </EnlargedFace>
  );
  let face: React.ReactNode = null;
  if (openTab === RECORD_PAGE_TIMELINE_PANEL) {
    face = (
      <EnlargedFace id={RECORD_PAGE_TIMELINE_PANEL} title={timelineTitle} onClose={closeFace}>
        <RecordTimelineCountContext.Provider value={reportTimelineCount}>
          {drawNodes(columns.timeline)}
        </RecordTimelineCountContext.Provider>
      </EnlargedFace>
    );
  } else if (openTab === RECORD_TAB_ATTACHMENTS && attachmentsNode) {
    face = blockFace(RECORD_TAB_ATTACHMENTS, attachmentsTitle, attachmentsNode);
  } else if (openTab === RECORD_TAB_APPROVALS && approvalsNode) {
    face = blockFace(RECORD_TAB_APPROVALS, approvalsTitle, approvalsNode);
  } else if (openTab) {
    const node = panelNodes.get(openTab) ?? bodyTableNode;
    if (node) {
      face = (
        <EnlargedFace id={openTab} title={relatedNodeTitle(node)} onClose={closeFace}>
          {enlargedRelatedList(node)}
        </EnlargedFace>
      );
    }
  }

  // Narrowed out of the pinned layout on the same record, the page keeps the
  // tab it showed rather than falling back to 「详情」 (card acceptance:
  // 「当前选中的页签不丢」): the implied tab goes into the address, replacing
  // the entry, so Back still leaves the record.
  const shownBefore = React.useRef<{ record: string; implied: string | undefined }>({ record: recordKey, implied: undefined });
  const otherTabIds = otherTabs.map((tab) => tab.id).join('\n');
  React.useEffect(() => {
    const before = shownBefore.current;
    shownBefore.current = { record: recordKey, implied: impliedTab };
    if (pinned || !before.implied || before.record !== recordKey || enlargedRelated) return;
    if (!otherTabIds.split('\n').includes(before.implied)) return;
    onEnlargeRelated?.(before.implied, { replace: true });
  }, [pinned, impliedTab, recordKey, enlargedRelated, otherTabIds, onEnlargeRelated]);

  // The host reads which tab is on screen (the 动态 tab reads its window when
  // it is, addressed or implied).
  React.useEffect(() => {
    onShownTabChange?.(activeTab);
  }, [activeTab, onShownTabChange]);

  const tabs: RecordTab[] = pinned
    ? otherTabs
    : [{ id: RECORD_TAB_OVERVIEW, label: t('detail.recordTabOverview', { defaultValue: 'Details' }) }, ...otherTabs];
  const selectTab = (id: string) => {
    if (id === RECORD_TAB_OVERVIEW) onCloseEnlargedRelated?.();
    else if (id !== impliedTab) onEnlargeRelated?.(id);
  };
  const editArrangement = (edit: RelatedArrangementEdit) =>
    onArrangementChange(editRelatedArrangement(defaultOrder, arrangement, edit, now));
  const arrangeTab = (id: string, edit: RecordTabArrangeEdit) => {
    if (edit === 'hide') {
      editArrangement({ kind: 'hide', id });
      if (id === requested) onCloseEnlargedRelated?.();
    } else {
      editArrangement({ kind: edit === 'move-before' ? 'move-up' : 'move-down', id });
    }
  };
  const tabRow =
    onEnlargeRelated && (pinned ? tabs.length + hiddenTabs.length > 0 : tabs.length + hiddenTabs.length > 1) ? (
      <RecordTabRow
        tabs={tabs}
        hiddenTabs={hiddenTabs}
        activeId={activeTab}
        onSelect={selectTab}
        onArrange={arrangeTab}
        onResetArrangement={
          resolved.rearranged ? () => editArrangement({ kind: 'restore-default-arrangement' }) : undefined
        }
      />
    ) : null;
  const defaultChangedHint = tabRow && resolved.defaultChanged ? (
    <RelatedDefaultChangedHint onRestore={() => editArrangement({ kind: 'restore-default-order' })} />
  ) : null;
  // A face without the 动态 tab open still names the stream's count on its
  // tab (objectstack#27524): counted from the feed the host holds.
  const probesTimelineCount = hasTimeline && !!tabRow && activeTab !== RECORD_PAGE_TIMELINE_PANEL;

  const details = (
    <>
      {/* objectstack#35595 — a strip the page places is the details' top. */}
      {columns.strip.length > 0 && (
        <div className="flex min-w-0 flex-col gap-4" data-record-overview-strip="">
          {drawNodes(columns.strip)}
        </div>
      )}
      {drawDetailsNodes(columns.details)}
      {footer}
      <EmptyFieldsRow />
    </>
  );

  // The pinned left column's width: the reader's dragged one (the host's
  // preference store, or this view's own), narrowed to leave the tabs room.
  const [localDetailsWidth, setLocalDetailsWidth] = React.useState<number | undefined>(undefined);
  const askedDetailsWidth = onDetailsWidthChange ? detailsWidth : localDetailsWidth;
  const [dragWidth, setDragWidth] = React.useState<number | null>(null);
  const leftWidth = dragWidth ?? clampDetailsWidth(askedDetailsWidth, contentWidth);
  const maxLeftWidth = Math.max(
    RECORD_PAGE_DETAILS_MIN_WIDTH,
    contentWidth - RECORD_PAGE_PINNED_GAP - RECORD_PAGE_TABS_MIN_WIDTH,
  );
  const commitDetailsWidth = (width: number) => (onDetailsWidthChange ?? setLocalDetailsWidth)(width);
  const bounded = pinnedHeight !== null;

  let body: React.ReactNode;
  if (pinned) {
    body = (
      <div
        ref={setGridEl}
        className="grid min-h-0"
        style={{
          gridTemplateColumns: `${leftWidth}px ${RECORD_PAGE_PINNED_GAP}px minmax(0,1fr)`,
          ...(bounded ? { height: pinnedHeight } : {}),
        }}
        data-record-columns=""
        data-record-columns-shown="details tabs"
      >
        <div
          className={cn(COLUMN_STACK, bounded && 'min-h-0 overflow-y-auto overscroll-contain')}
          data-record-column="details"
        >
          {details}
        </div>
        <DetailsWidthHandle width={leftWidth} max={maxLeftWidth} onPreview={setDragWidth} onCommit={commitDetailsWidth} />
        <div
          className={cn('flex min-w-0 flex-col gap-4', bounded && 'min-h-0 overflow-y-auto overscroll-contain')}
          data-record-column="tabs"
        >
          {tabRow}
          {defaultChangedHint}
          {probesTimelineCount && <RecordTimelineCountProbe nodes={columns.timeline} onCount={reportTimelineCount} />}
          {face}
        </div>
      </div>
    );
  } else {
    body = (
      <>
        {tabRow}
        {defaultChangedHint}
        {probesTimelineCount && <RecordTimelineCountProbe nodes={columns.timeline} onCount={reportTimelineCount} />}
        {face ?? (
          <div className="grid grid-cols-1 items-start gap-6" data-record-columns="" data-record-columns-shown="details">
            <div className={COLUMN_STACK} data-record-column="details">
              {details}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <RecordBodyFieldsContext.Provider value={bodyFields}>
    <DefaultRecordPageContext.Provider value>
    <RecordBodyTablesContext.Provider value={bodyTableIds}>
    <RelatedEnlargeContext.Provider value={onEnlargeRelated ?? null}>
    <RecordFieldListContext.Provider value={fieldList}>
    <DetailsColumnCapContext.Provider value={detailsFillPage ? 3 : 1}>
      <div
        ref={setFrameEl}
        // objectstack#35745 — the top is 12px at every width: the header sits
        // right above, and the host's scroller adds no top padding of its own,
        // so the tab row follows the header as a list's view bar follows its
        // page bar. The sides and the foot keep the page's padding.
        className={cn('w-full bg-background px-3 pb-3 pt-3 md:px-4 md:pb-4 lg:px-6 lg:pb-6', className)}
        data-page-type="record"
        data-record-page-tier={tier}
        data-record-page-pinned={pinned ? '' : undefined}
      >
        <div ref={setContentEl} className="flex flex-col gap-4">
          {drawNodes(columns.header)}
          {body}
        </div>
      </div>
    </DetailsColumnCapContext.Provider>
    </RecordFieldListContext.Provider>
    </RelatedEnlargeContext.Provider>
    </RecordBodyTablesContext.Provider>
    </DefaultRecordPageContext.Provider>
    </RecordBodyFieldsContext.Provider>
  );
};
