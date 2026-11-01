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
import { SchemaRenderer, toRenderableSchema, useRecordContext } from '@object-ui/react';
import {
  RECORD_PAGE_TIMELINE_PANEL,
  relatedListIdsIn,
  type DefaultPageColumns,
  type RecordPageTier,
} from './synth/recordPageColumns';
import { useDetailTranslation } from './useDetailTranslation';
import { RecordBodyTablesContext, RelatedEnlargeContext, RelatedListCompactContext, RelatedListEnlargedContext } from './relatedListCompact';
import { DefaultRecordPageContext, DetailsColumnCapContext } from './defaultRecordPage';
import { RelatedCardStack } from './RelatedCardStack';
import { RecordTimelinePanel } from './RecordTimelinePanel';
import { RECORD_TAB_OVERVIEW, RecordTabRow, type RecordTab } from './RecordTabRow';
import { partitionRecordTabsByRecords } from './synth/recordTabRow';
import { RecordTimelineCountContext } from './recordTimelineStream';
import { RecordTimelineCountProbe } from './renderers/record-activity';
import {
  relatedCardId,
  resolveRelatedArrangement,
  type RelatedArrangement,
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
   * The reader's right-column switch ⊟ (objectstack#27052; objectstack#27524,
   * Target 4): off, a tier with a right column draws the details alone, the
   * full width. The stack has no right column — its panels follow the
   * details — so it does not read the switch. Absent: on.
   */
  rightColumn?: boolean;
  /**
   * The reader's arrangement of the related panels (objectstack#27055,
   * Targets 7 and 10) — order, hidden — from the host's workspace preference
   * store, and the setter that keeps a new one. Absent: the reader's choices
   * hold for this view only.
   */
  relatedArrangement?: RelatedArrangement;
  onRelatedArrangementChange?: (next: RelatedArrangement) => void;
  /**
   * Open a panel's whole face in place — a related list's `object.field`, or
   * `timeline` for the 动态 stream — the host's `?related=`. It is what a
   * tab of the tab row does (objectstack#27524, Target 8); absent, the page
   * draws no tab row.
   */
  onEnlargeRelated?: (id: RelatedCardId) => void;
  /**
   * The active tab (the host's `?related=`, objectstack#27524, Target 9): a
   * related list's full table, or the 动态 stream in full (`timeline`), drawn
   * at the page's full width under the record header and its tab row, until
   * Esc or 「概览」 (`onCloseEnlargedRelated`). An id naming nothing on the
   * page draws the page.
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

/**
 * Grid templates. Literal strings, so Tailwind's scanner emits each one:
 * details | the right column at 320 px, or 380 px in the wide tier
 * (objectstack#27524, Target 6).
 */
const GRID_TEMPLATE = {
  twoColumn: 'grid-cols-[minmax(0,1fr)_20rem]',
  wide: 'grid-cols-[minmax(0,1fr)_23.75rem]',
  oneColumn: 'grid-cols-1',
} as const;

/** Each node of a column, drawn as a sibling of the others: a related-list
 *  stack is the lists sharing a DOM parent (`RelatedListEmptyFold`), so no
 *  per-node wrapper may sit between a list and its column. */
function drawNodes(nodes: any[]): React.ReactNode {
  return nodes.map((node, index) => (
    <SchemaRenderer key={(node && typeof node === 'object' && node.id) || index} schema={toRenderableSchema(node)} />
  ));
}

/**
 * A column stacks its blocks 16 px apart. A related list folded into its
 * stack's empty line stays MOUNTED with its content `hidden`
 * (`RelatedListStackSlot`), which leaves a zero-height root that a flex gap
 * would still space out — eight folded lists, eight empty gaps. A child whose
 * only child is hidden draws nothing, so it is taken out of the flow.
 */
const COLUMN_STACK = 'flex min-w-0 flex-col gap-4 [&>*:has(>[hidden]:only-child)]:hidden';

/**
 * The synthesized default record page, laid out by the width it has
 * (objectstack#26678; one rule since objectstack#27524, Target 6): one record
 * header, then the details and the right column — the 动态 panel first, then
 * the related panels in the reader's arrangement.
 *
 *  - `two-column` / `wide`: details | the right column (320 / 380 px). The
 *    wide tier lets a details section take three field columns (two
 *    otherwise, `DetailsColumnCapContext`) and the 动态 panel five entries
 *    (three otherwise). The reader's ⊟ (`rightColumn`) takes the right
 *    column out; the details then take the row.
 *  - `stack`: ONE column — the details, then the right column's panels in
 *    their order. No tabs, no rail: the stack is what a narrow container
 *    (the split pane, a phone) draws.
 *
 * The frame mirrors the record page frame `PageRenderer` draws (its padding
 * and background, the header nodes 16 px apart), so the header sits where an
 * authored page's would. The nodes are the page's own — the same
 * `page:header`, `record:details`, `record:activity` and
 * `record:related_list` nodes its tab strip holds — so every tier shows the
 * same header and the same sections. `data-record-columns-shown` names the
 * columns drawn side by side.
 */
export const RecordPageColumns: React.FC<RecordPageColumnsProps> = ({
  tier,
  columns,
  footer,
  rightColumn = true,
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
  const hasTimeline = columns.timeline.length > 0;
  const hasPanels = hasTimeline || columns.related.length > 0;
  const wide = tier === 'wide';
  const besideDetails = tier !== 'stack';
  const drawsPanels = hasPanels && (!besideDetails || rightColumn);
  const viewAllTimeline = React.useCallback(
    () => onEnlargeRelated?.(RECORD_PAGE_TIMELINE_PANEL),
    [onEnlargeRelated],
  );

  // ── The reader's arrangement, read once for the panels and the tab row ──
  // A host without a preference store keeps the reader's choices here, for
  // this view, so the stack and the row read the same one.
  const [localArrangement, setLocalArrangement] = React.useState<RelatedArrangement | undefined>(undefined);
  const arrangement = onRelatedArrangementChange ? relatedArrangement : localArrangement;
  const onArrangementChange = onRelatedArrangementChange ?? setLocalArrangement;
  const panelNodes = new Map<RelatedCardId, any>();
  for (const node of columns.related) {
    const id = relatedNodeId(node);
    if (id && !panelNodes.has(id)) panelNodes.set(id, node);
  }
  const [now] = React.useState(() => Date.now());
  const resolved = resolveRelatedArrangement(Array.from(panelNodes.keys()), arrangement, now);

  // ── The panels' counts, one set for the panels and their tabs ──
  // The hidden panels are counted too: their tabs sit in the row's dropdown
  // with their counts (Target 8).
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

  // ── The 动态 stream's size, for its panel and its tab ──
  // Held per record, so a pane stepping to the next record never shows the
  // last one's number; kept while neither face that reports it is drawn.
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

  // ── The active tab: the open face ──
  // The 动态 stream in full, or a related list — body tables (in the details)
  // open in place too (their ⤢), and take a tab of their own while open.
  let enlarged: React.ReactNode = null;
  let activeTab = RECORD_TAB_OVERVIEW;
  let openBodyTable: RecordTab | null = null;
  if (enlargedRelated === RECORD_PAGE_TIMELINE_PANEL && hasTimeline) {
    activeTab = RECORD_PAGE_TIMELINE_PANEL;
    enlarged = (
      <EnlargedFace
        id={RECORD_PAGE_TIMELINE_PANEL}
        title={t('detail.timeline', { defaultValue: 'Activity' })}
        onClose={onCloseEnlargedRelated}
      >
        <RecordTimelineCountContext.Provider value={reportTimelineCount}>
          {drawNodes(columns.timeline)}
        </RecordTimelineCountContext.Provider>
      </EnlargedFace>
    );
  } else if (enlargedRelated) {
    const node = [...columns.related, ...columns.details].find((n) => relatedNodeId(n) === enlargedRelated);
    if (node) {
      activeTab = enlargedRelated;
      if (!panelNodes.has(enlargedRelated)) openBodyTable = { id: enlargedRelated, label: relatedNodeTitle(node) };
      enlarged = (
        <EnlargedFace id={enlargedRelated} title={relatedNodeTitle(node)} onClose={onCloseEnlargedRelated}>
          {enlargedRelatedList(node)}
        </EnlargedFace>
      );
    }
  }

  // ── The tab row (Target 8): 概览, 动态, the panels in the reader's order ──
  // The panels with records first and the empty ones in the dropdown
  // (objectstack#28469), as the right column folds its empty panels.
  const panelTab = (id: RelatedCardId): RecordTab => ({
    id,
    label: relatedNodeTitle(panelNodes.get(id)),
    count: countOf(id),
  });
  const tabs: RecordTab[] = [{ id: RECORD_TAB_OVERVIEW, label: t('detail.recordTabOverview', { defaultValue: 'Overview' }) }];
  if (hasTimeline) {
    tabs.push({ id: RECORD_PAGE_TIMELINE_PANEL, label: t('detail.timeline', { defaultValue: 'Activity' }), count: streamCount });
  }
  const panelTabs = partitionRecordTabsByRecords(resolved.order.map(panelTab));
  tabs.push(...panelTabs.withRecords);
  if (openBodyTable) tabs.push(openBodyTable);
  const hiddenTabs = resolved.hidden.map(panelTab);
  const selectTab = (id: string) => {
    if (id === RECORD_TAB_OVERVIEW) onCloseEnlargedRelated?.();
    else onEnlargeRelated?.(id);
  };
  const tabRow =
    onEnlargeRelated && tabs.length + panelTabs.empty.length + hiddenTabs.length > 1 ? (
      <RecordTabRow
        tabs={tabs}
        emptyTabs={panelTabs.empty}
        hiddenTabs={hiddenTabs}
        activeId={activeTab}
        onSelect={selectTab}
      />
    ) : null;

  // The provenance line closes the details column in every tier
  // (objectstack#27055): it describes the record the details show.
  const detailsColumn = (
    <div className={COLUMN_STACK} data-record-column="details">
      {drawNodes(columns.details)}
      {footer}
    </div>
  );
  const rightPanels = drawsPanels ? (
    <aside
      className={COLUMN_STACK}
      data-record-column="right"
      aria-label={t('detail.relatedColumn', { defaultValue: 'Right column' })}
    >
      {hasTimeline && (
        <RecordTimelinePanel
          nodes={columns.timeline}
          entries={wide ? 5 : 3}
          onViewAll={onEnlargeRelated ? viewAllTimeline : undefined}
          count={streamCount}
          onCount={reportTimelineCount}
        />
      )}
      {/* The related panels, in the reader's arrangement (objectstack#27055). */}
      <RelatedListCompactContext.Provider value>
        <RelatedCardStack
          nodes={columns.related}
          arrangement={arrangement}
          onArrangementChange={onArrangementChange}
          onEnlarge={onEnlargeRelated}
          fieldsOf={relatedFieldsOf}
          counts={counts}
        />
      </RelatedListCompactContext.Provider>
    </aside>
  ) : null;
  // A face with neither the 动态 panel nor its tab drawn — another tab open,
  // or the right column switched off — still names the stream's count on the
  // 动态 tab (objectstack#27524): counted from the feed the host holds.
  const probesTimelineCount = hasTimeline && !!tabRow && activeTab !== RECORD_PAGE_TIMELINE_PANEL
    && (enlarged !== null || !drawsPanels);
  const sideBySide = besideDetails && drawsPanels;
  const template = sideBySide ? (wide ? GRID_TEMPLATE.wide : GRID_TEMPLATE.twoColumn) : GRID_TEMPLATE.oneColumn;

  return (
    <DefaultRecordPageContext.Provider value>
    <RecordBodyTablesContext.Provider value={bodyTableIds}>
    <RelatedEnlargeContext.Provider value={onEnlargeRelated ?? null}>
    <DetailsColumnCapContext.Provider value={sideBySide && !wide ? 2 : 3}>
      <div
        className={cn('w-full bg-background p-3 md:p-4 lg:p-6', className)}
        data-page-type="record"
        data-record-page-tier={tier}
      >
        <div className="flex flex-col gap-4">
          {drawNodes(columns.header)}
          {tabRow}
          {probesTimelineCount && <RecordTimelineCountProbe nodes={columns.timeline} onCount={reportTimelineCount} />}
          {enlarged ?? (
            <div
              className={cn('grid items-start gap-6', template)}
              data-record-columns=""
              data-record-columns-shown={sideBySide ? 'details right' : 'details'}
            >
              {detailsColumn}
              {rightPanels}
            </div>
          )}
        </div>
      </div>
    </DetailsColumnCapContext.Provider>
    </RelatedEnlargeContext.Provider>
    </RecordBodyTablesContext.Provider>
    </DefaultRecordPageContext.Provider>
  );
};
