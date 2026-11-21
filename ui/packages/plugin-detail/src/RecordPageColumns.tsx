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
import { RecordBodyTablesContext, RelatedEnlargeContext, RelatedListEnlargedContext } from './relatedListCompact';
import { ApprovalBandContext, DefaultRecordPageContext, DetailsColumnCapContext } from './defaultRecordPage';
import { RECORD_TAB_OVERVIEW, RecordTabRow, type RecordTab, type RecordTabArrangeEdit } from './RecordTabRow';
import {
  RECORD_SUMMARY_APPROVALS,
  RECORD_SUMMARY_ATTACHMENTS,
  RecordSummaryRail,
  approvalSummaryRows,
  useRecordAttachmentCount,
} from './RecordSummaryRail';
import { RecordTimelineCountContext } from './recordTimelineStream';
import { createRecordBodyFields, RecordBodyFieldsContext } from './recordBodyFields';
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
   * The reader's right-column switch ⊟ (objectstack#27052; objectstack#27524,
   * Target 4): off, a tier with a right column draws the details alone, the
   * full width. The stack has no right column — its panels follow the
   * details — so it does not read the switch. Absent: on.
   */
  rightColumn?: boolean;
  /**
   * Whether the 概览 tab draws its right rail at all (objectstack#35596: a
   * drawer draws none). Absent: it does.
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
 * The details column's nodes (objectstack#35253): the synthesized page splits
 * its details around a body table, one `record:details` per run of sections,
 * and the record's approval band is drawn by the FIRST part alone — above the
 * table — so the page shows one band, not one per part. A context provider
 * adds no DOM, so the column's siblings stay siblings (`drawNodes`).
 */
function drawDetailsNodes(nodes: any[]): React.ReactNode {
  const firstDetails = nodes.findIndex((node) => node?.type === 'record:details');
  return nodes.map((node, index) => {
    const key = (node && typeof node === 'object' && node.id) || index;
    const drawn = <SchemaRenderer key={key} schema={toRenderableSchema(node)} />;
    if (node?.type !== 'record:details' || index === firstDetails) return drawn;
    return (
      <ApprovalBandContext.Provider key={key} value={false}>
        {drawn}
      </ApprovalBandContext.Provider>
    );
  });
}

const LINE_BUTTON =
  'rounded-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** 「默认顺序已更新 · 恢复默认」 — the reader's order was laid over an older default (rule 5). */
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
 * The rail's foot line (objectstack#27055 rule 6, objectstack#27241):
 * 「已隐藏 N 张 · 显示」 and, while the arrangement is not the default one,
 * 「恢复默认顺序」 (the default order, every list shown). Draws nothing for a
 * default arrangement. 「更多」 holds the same reset (objectstack#35783).
 */
const RelatedFootLine: React.FC<{
  hiddenCount: number;
  onShowHidden: () => void;
  rearranged: boolean;
  onRestoreDefault: () => void;
}> = ({ hiddenCount, onShowHidden, rearranged, onRestoreDefault }) => {
  const { t } = useDetailTranslation();
  if (hiddenCount === 0 && !rearranged) return null;
  return (
    <p className="text-xs text-muted-foreground" data-related-foot-line="">
      {hiddenCount > 0 && (
        <span data-related-hidden-line="">
          {t('detail.relatedHiddenCount', { count: hiddenCount, defaultValue: '{{count}} hidden' })}
          {' · '}
          <button type="button" className={LINE_BUTTON} onClick={onShowHidden}>
            {t('detail.relatedShowHidden', { defaultValue: 'Show' })}
          </button>
        </span>
      )}
      {hiddenCount > 0 && rearranged && ' · '}
      {rearranged && (
        <button type="button" className={LINE_BUTTON} onClick={onRestoreDefault} data-related-restore-default-order="">
          {t('detail.relatedRestoreDefaultOrder', { defaultValue: 'Restore default order' })}
        </button>
      )}
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

/**
 * The synthesized default record page, laid out by the width it has
 * (objectstack#26678; one rule since objectstack#27524, Target 6): one record
 * header, the record's tab row (objectstack#35595: 概览, one tab per related
 * list in the reader's arrangement, 附件, 审批, then 动态 last — every tab
 * there at first paint, an empty list muted with no number, the width the
 * row's only fold), then the open tab's face.
 *
 * 概览 draws a strip the page places (`record:path`, `record:highlights`, a
 * slotted page's `highlights`; the default page places none since
 * objectstack#35891) across the whole width, then the details and the right
 * rail — the summary of the other tabs
 * (`RecordSummaryRail`, objectstack#35596: 审批, 附件, 最近动态, then the
 * lists with records; a card with nothing to show is not drawn, and a rail
 * known to have none folds away). Every other tab draws its block in full in
 * place of all three.
 *
 *  - `two-column` / `wide`: details | the rail (320 / 380 px). The wide tier
 *    lets a details section take three field columns (two otherwise,
 *    `DetailsColumnCapContext`). The reader's ⊟ (`rightColumn`) takes the
 *    rail out; the details then take the row. A host that draws no rail (a
 *    drawer, `rail={false}`) draws the details alone.
 *  - `stack`: ONE column — the details, then the rail.
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
  rail = true,
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
  // objectstack#35941 — the details sections report the rows they draw, and
  // the meta line closing the details column reads them: the owner is left
  // off that line when a section already draws `owner_id`.
  const [bodyFields] = React.useState(createRecordBodyFields);
  const hasTimeline = columns.timeline.length > 0;
  const wide = tier === 'wide';
  const besideDetails = tier !== 'stack';

  // ── The right column's blocks: the related lists, 附件 and 审批 ──
  const approvalsNode = columns.related.find((node) => node?.type === 'record:approvals');
  const attachmentsNode = columns.related.find((node) => node?.type === 'record:attachments');
  const panelNodes = new Map<RelatedCardId, any>();
  for (const node of columns.related) {
    const id = relatedNodeId(node);
    if (id && !panelNodes.has(id)) panelNodes.set(id, node);
  }
  const hasPanels = hasTimeline || columns.related.length > 0;
  // objectstack#35596 — the rail is the 概览 tab's, and a drawer draws none.
  const drawsPanels = rail && hasPanels && (!besideDetails || rightColumn);

  // ── The reader's arrangement of the related lists, read for the tab row ──
  // A host without a preference store keeps the reader's choices here, for
  // this view.
  const [localArrangement, setLocalArrangement] = React.useState<RelatedArrangement | undefined>(undefined);
  const arrangement = onRelatedArrangementChange ? relatedArrangement : localArrangement;
  const onArrangementChange = onRelatedArrangementChange ?? setLocalArrangement;
  const [now] = React.useState(() => Date.now());
  const defaultOrder = Array.from(panelNodes.keys());
  const resolved = resolveRelatedArrangement(defaultOrder, arrangement, now);

  // ── The related lists' counts, one set for the tabs and the rail ──
  // The hidden lists are counted too: their tabs sit in the row's dropdown
  // with their counts.
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
  // objectstack#35595 — 附件 counts the record's files; 审批 carries a dot
  // while an approval waits.
  const attachmentCount = useRecordAttachmentCount(!!attachmentsNode);
  const approvalPending = !!approvalsNode && approvalSummaryRows(nodeProps(approvalsNode).approvals, undefined) !== null;

  // ── The 动态 stream's size, for its card and its tab ──
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
  // A related list, 附件, 审批 or the 动态 stream in full — body tables (in the
  // details) open in place too (their ⤢), and take a tab of their own while
  // open.
  let enlarged: React.ReactNode = null;
  let activeTab = RECORD_TAB_OVERVIEW;
  let openBodyTable: RecordTab | null = null;
  const attachmentsTitle = t('detail.attachments', { defaultValue: 'Attachments' });
  const approvalsTitle = t('detail.approvalsPanelTitle', { defaultValue: 'Approvals' });
  const blockFace = (id: string, title: string, node: any) => (
    <EnlargedFace id={id} title={title} onClose={onCloseEnlargedRelated}>
      <SchemaRenderer schema={toRenderableSchema(node)} />
    </EnlargedFace>
  );
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
  } else if (enlargedRelated === RECORD_SUMMARY_ATTACHMENTS && attachmentsNode) {
    activeTab = RECORD_SUMMARY_ATTACHMENTS;
    enlarged = blockFace(RECORD_SUMMARY_ATTACHMENTS, attachmentsTitle, attachmentsNode);
  } else if (enlargedRelated === RECORD_SUMMARY_APPROVALS && approvalsNode) {
    activeTab = RECORD_SUMMARY_APPROVALS;
    enlarged = blockFace(RECORD_SUMMARY_APPROVALS, approvalsTitle, approvalsNode);
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

  // ── The tab row (objectstack#35595): 概览, every related list, 附件, 审批, 动态 ──
  // Every related list has its tab whether or not it has records — muted and
  // without a number at 0 — so no tab moves when the counts land; the width
  // is the row's only fold (「更多 N ▾」, `RecordTabRow`). 动态 is the row's
  // last tab (objectstack#34590).
  const panelTab = (id: RelatedCardId): RecordTab => ({
    id,
    label: relatedNodeTitle(panelNodes.get(id)),
    count: countOf(id),
  });
  // objectstack#35783 — a shown list's tab is the reader's to move one place
  // either way among the lists, or to hide; the other tabs stay where they are.
  const arrangedTab = (id: RelatedCardId, index: number): RecordTab => ({
    ...panelTab(id),
    arrange: { before: index > 0, after: index < resolved.order.length - 1 },
  });
  const tabs: RecordTab[] = [{ id: RECORD_TAB_OVERVIEW, label: t('detail.recordTabOverview', { defaultValue: 'Overview' }) }];
  tabs.push(...resolved.order.map(arrangedTab));
  if (openBodyTable) tabs.push(openBodyTable);
  if (attachmentsNode) tabs.push({ id: RECORD_SUMMARY_ATTACHMENTS, label: attachmentsTitle, count: attachmentCount });
  if (approvalsNode) tabs.push({ id: RECORD_SUMMARY_APPROVALS, label: approvalsTitle, dot: approvalPending });
  if (hasTimeline) {
    tabs.push({ id: RECORD_PAGE_TIMELINE_PANEL, label: t('detail.timeline', { defaultValue: 'Activity' }), count: streamCount });
  }
  const hiddenTabs = resolved.hidden.map(panelTab);
  const selectTab = (id: string) => {
    if (id === RECORD_TAB_OVERVIEW) onCloseEnlargedRelated?.();
    else onEnlargeRelated?.(id);
  };
  const editArrangement = (edit: RelatedArrangementEdit) =>
    onArrangementChange(editRelatedArrangement(defaultOrder, arrangement, edit, now));
  const arrangeTab = (id: string, edit: RecordTabArrangeEdit) => {
    if (edit === 'hide') {
      editArrangement({ kind: 'hide', id });
      // The open list hidden: its face goes with its tab, back to 概览.
      if (id === activeTab) onCloseEnlargedRelated?.();
    } else {
      editArrangement({ kind: edit === 'move-before' ? 'move-up' : 'move-down', id });
    }
  };
  const tabRow =
    onEnlargeRelated && tabs.length + hiddenTabs.length > 1 ? (
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

  // The provenance line closes the details column in every tier
  // (objectstack#27055): it describes the record the details show.
  const detailsColumn = (
    <div className={COLUMN_STACK} data-record-column="details">
      {drawDetailsNodes(columns.details)}
      {footer}
    </div>
  );
  // objectstack#35596 — a rail with nothing to show takes no column: once
  // every card is KNOWN to be absent (no approval waiting, no files, a
  // counted stream with no entries, every list counted with no records — a
  // refused count draws no card either — and nothing at the foot), the
  // details take the row. While a count is still out the column stays, so a
  // page whose cards land does not shift. A slotted chatter stream reports
  // no count, so its card always draws.
  const streamCounted = columns.timeline.some((node) => node?.type === 'record:activity');
  const railKnownEmpty =
    !approvalPending
    && (!attachmentsNode || attachmentCount === 0)
    && (!hasTimeline || (streamCounted && streamCount === 0))
    && resolved.order.every((id) => {
      const state = counts.stateOf(id);
      return state.kind !== 'pending' && !(state.kind === 'counted' && state.count > 0);
    })
    && resolved.hidden.length === 0
    && !resolved.rearranged
    && !resolved.defaultChanged;
  const drawsRail = drawsPanels && !railKnownEmpty;
  const rightPanels = drawsRail ? (
    <aside
      className={COLUMN_STACK}
      data-record-column="right"
      aria-label={t('detail.relatedColumn', { defaultValue: 'Right column' })}
    >
      {/* objectstack#35596 — the 概览 tab's summary of the other tabs: 审批,
          附件, 最近动态, then 「其他相关」 (the lists with records), each card
          absent while it has nothing to show. The foot line keeps a reader's
          hidden lists one click from coming back. */}
      <RecordSummaryRail
        related={resolved.order.map((id) => ({ id, node: panelNodes.get(id), count: countOf(id) }))}
        approvals={approvalsNode}
        attachments={attachmentsNode ? { count: attachmentCount } : null}
        timeline={columns.timeline}
        timelineCount={streamCount}
        onTimelineCount={reportTimelineCount}
        onOpen={onEnlargeRelated ? selectTab : undefined}
        fieldsOf={relatedFieldsOf}
        footer={
          <>
            {resolved.defaultChanged && (
              <RelatedDefaultChangedHint onRestore={() => editArrangement({ kind: 'restore-default-order' })} />
            )}
            <RelatedFootLine
              hiddenCount={resolved.hidden.length}
              onShowHidden={() => editArrangement({ kind: 'show-hidden' })}
              rearranged={resolved.rearranged}
              onRestoreDefault={() => editArrangement({ kind: 'restore-default-arrangement' })}
            />
          </>
        }
      />
    </aside>
  ) : null;
  // A face with no 动态 card drawn — another tab open, the right column
  // switched off, or a drawer — still names the stream's count on the 动态
  // tab (objectstack#27524): counted from the feed the host holds.
  // A rail folded away for want of cards still learns of a new entry: the
  // probe counts for it, and the rail comes back with its 最近动态 card.
  const probesTimelineCount = hasTimeline && activeTab !== RECORD_PAGE_TIMELINE_PANEL
    && ((!!tabRow && (enlarged !== null || !drawsPanels)) || (enlarged === null && drawsPanels && !drawsRail));
  // Folded away, the rail keeps the size its card last read: a probe that
  // cannot count (no feed held by the host — the stream reads its own) says
  // nothing rather than unknown, so the rail does not come back empty.
  const railFolded = enlarged === null && drawsPanels && !drawsRail;
  const reportProbedCount = React.useCallback(
    (count: number | null) => {
      if (count !== null) reportTimelineCount(count);
    },
    [reportTimelineCount],
  );
  const sideBySide = besideDetails && drawsRail;
  const template = sideBySide ? (wide ? GRID_TEMPLATE.wide : GRID_TEMPLATE.twoColumn) : GRID_TEMPLATE.oneColumn;

  return (
    <RecordBodyFieldsContext.Provider value={bodyFields}>
    <DefaultRecordPageContext.Provider value>
    <RecordBodyTablesContext.Provider value={bodyTableIds}>
    <RelatedEnlargeContext.Provider value={onEnlargeRelated ?? null}>
    <DetailsColumnCapContext.Provider value={sideBySide && !wide ? 2 : 3}>
      <div
        // objectstack#35745 — the top is 12px at every width: the header sits
        // right above, and the host's scroller adds no top padding of its own,
        // so the tab row follows the header as a list's view bar follows its
        // page bar. The sides and the foot keep the page's padding.
        className={cn('w-full bg-background px-3 pb-3 pt-3 md:px-4 md:pb-4 lg:px-6 lg:pb-6', className)}
        data-page-type="record"
        data-record-page-tier={tier}
      >
        <div className="flex flex-col gap-4">
          {drawNodes(columns.header)}
          {tabRow}
          {probesTimelineCount && (
            <RecordTimelineCountProbe nodes={columns.timeline} onCount={railFolded ? reportProbedCount : reportTimelineCount} />
          )}
          {enlarged ?? (
            <>
              {/* objectstack#35595 — the stage path and the key fields are the
                  概览 tab's top, across the whole width (both columns), and
                  no other tab's. */}
              {columns.strip.length > 0 && (
                <div className="flex min-w-0 flex-col gap-4" data-record-overview-strip="">
                  {drawNodes(columns.strip)}
                </div>
              )}
              <div
                className={cn('grid items-start gap-6', template)}
                data-record-columns=""
                data-record-columns-shown={sideBySide ? 'details right' : 'details'}
              >
                {detailsColumn}
                {rightPanels}
              </div>
            </>
          )}
        </div>
      </div>
    </DetailsColumnCapContext.Provider>
    </RelatedEnlargeContext.Provider>
    </RecordBodyTablesContext.Provider>
    </DefaultRecordPageContext.Provider>
    </RecordBodyFieldsContext.Provider>
  );
};
