/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Badge, Button, cn } from '@object-ui/components';
import type { FieldContainerLike } from '@object-ui/core';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { ChevronLeft, ChevronRight, PanelRightClose, PanelRightOpen } from 'lucide-react';
import {
  recordPageArrangementFor,
  relatedListIdsIn,
  type DefaultPageColumns,
  type RecordPageColumnSwitches,
} from './synth/recordPageColumns';
import { useDetailTranslation } from './useDetailTranslation';
import { RecordBodyTablesContext, RelatedEnlargeContext, RelatedListCompactContext } from './relatedListCompact';
import { DefaultRecordPageContext } from './defaultRecordPage';
import { RelatedCardStack } from './RelatedCardStack';
import { relatedCardId, type RelatedArrangement, type RelatedCardId } from './synth/relatedArrangement';

export interface RecordPageColumnsProps {
  /** The column tier to draw; the tabbed tier is the page itself, drawn by its host. */
  tier: 'two-column' | 'three-column';
  /** The synthesized page, partitioned (`buildDefaultPageColumns`). */
  columns: DefaultPageColumns;
  /**
   * The record's provenance line (created / updated / owner / id), which the
   * host draws once per page: at the foot of the details column, in every
   * column tier (objectstack#27055, the v3 meta line).
   */
  footer?: React.ReactNode;
  /**
   * The reader's column switches (objectstack#27052): a column that is off is
   * not drawn — the timeline folds into the related column's 「动态」 card; the
   * related column is gone, rail and all (objectstack#27241). A related column
   * that is on but has no room is the rail (`recordPageArrangementFor`).
   * Absent: both on.
   */
  switches?: RecordPageColumnSwitches;
  /**
   * The reader's arrangement of the related cards (objectstack#27055,
   * Targets 7 and 10) — order, collapsed, hidden — from the host's workspace
   * preference store, and the setter that keeps a new one. Absent: the
   * reader's choices hold for this view only.
   */
  relatedArrangement?: RelatedArrangement;
  onRelatedArrangementChange?: (next: RelatedArrangement) => void;
  /** Enlarge a related card's list in place (Target 9, the host's `?related=`). */
  onEnlargeRelated?: (id: RelatedCardId) => void;
  /**
   * The enlarged related list (`object.field`, the host's `?related=`): drawn
   * as a full-width table over the page body — the header stays, the columns
   * step aside — until Esc or ‹ (`onCloseEnlargedRelated`). An id naming no
   * related list of the page draws the columns.
   */
  enlargedRelated?: RelatedCardId;
  onCloseEnlargedRelated?: () => void;
  /**
   * The child objects' field definitions the host holds (its metadata), for
   * the related cards' up-front counts (objectstack#27056). Absent: the counts
   * read each child's definition first.
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
 * The enlarged related list (objectstack#27055, Target 9 — the ONE path to a
 * related list's every record): the full `RelatedList` face the old Related
 * tab drew — every column, paging, sort, inline edit — at the page's full
 * width, under the record header. ‹ and Esc return to the columns. A dialog
 * open over the page keeps its own Esc.
 */
const EnlargedRelatedList: React.FC<{ node: any; onClose?: () => void }> = ({ node, onClose }) => {
  const { t } = useDetailTranslation();
  const p = { ...node, ...(node.properties ?? {}) };
  const title = typeof p.title === 'string' && p.title ? p.title : p.objectName;
  React.useEffect(() => {
    if (!onClose) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  const authoredLimit = typeof p.limit === 'number' && p.limit > 0;
  const enlarged = authoredLimit
    ? node
    : { ...node, properties: { ...(node.properties ?? {}), limit: ENLARGED_PAGE_SIZE } };
  return (
    <section className="flex min-w-0 flex-col gap-3" data-related-enlarged={relatedNodeId(node) ?? ''} aria-label={title}>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 gap-1 px-2"
          onClick={onClose}
          aria-keyshortcuts="Escape"
          data-related-enlarged-back=""
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          <span>{t('detail.relatedEnlargedBack', { defaultValue: 'Back' })}</span>
        </Button>
        <h2 className="truncate text-sm font-semibold">{title}</h2>
      </div>
      <SchemaRenderer schema={toRenderableSchema(enlarged)} />
    </section>
  );
};

const ALL_COLUMNS_ON: RecordPageColumnSwitches = { timeline: true, related: true };

/**
 * The timeline folded into the related column (objectstack#27052): the
 * 「动态」 card under the lists. Closed until the reader opens it, and its
 * blocks are not mounted while closed, so the feed reads nothing before it is
 * asked for (objectstack#27056, Target 2).
 */
const FoldedTimelineCard: React.FC<{ nodes: any[]; label: string }> = ({ nodes, label }) => {
  const [open, setOpen] = React.useState(false);
  const bodyId = React.useId();
  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
      aria-label={label}
      data-record-folded-timeline=""
    >
      <h2 className="text-sm font-semibold text-foreground">
        <button
          type="button"
          className="flex items-center gap-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
          data-record-folded-timeline-toggle=""
        >
          <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} aria-hidden />
          {label}
        </button>
      </h2>
      {open && (
        <div id={bodyId} className="flex flex-col gap-4">
          {drawNodes(nodes)}
        </div>
      )}
    </section>
  );
};

/**
 * Grid templates by which columns have content. Literal strings, so
 * Tailwind's scanner emits each one. The v3 widths (objectstack#27055,
 * 「栏宽 1.25fr : 1fr : 320px」): details the widest, the timeline after it,
 * the related column a fixed 320 px rail.
 */
const THREE_COLUMN_TEMPLATE = {
  all: 'grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_20rem]',
  noTimeline: 'grid-cols-[minmax(0,1fr)_20rem]',
  noRelated: 'grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]',
  detailsOnly: 'grid-cols-1',
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
 * The synthesized default record page in its column tiers (objectstack#26678):
 * one record header, then details | timeline | related as resident columns.
 *
 * The frame mirrors the record page frame `PageRenderer` draws for the tabbed
 * tier (its padding and background, the header nodes 16 px apart), so the
 * header does not move when the page changes tier. The nodes are the page's
 * own — the same `page:header`, `record:details`, `record:discussion` and
 * `record:related_list` nodes the tab strip draws — so every tier shows the
 * same header and the same sections.
 *
 * Two-column tier: details | timeline, and the related column folded into a
 * rail opened from a toggle above the columns. The rail opens over the
 * timeline rather than pushing a third column in, which is the point of the
 * tier: three columns do not fit. Closed, its lists are not mounted, so they
 * read nothing until opened. Whether it is open is this view's ephemeral
 * state.
 *
 * The reader's switches (objectstack#27052) take a column out: with the
 * timeline off the related column is resident in its place and the
 * timeline's blocks are its foot card (「动态」); with the related column off
 * there is no related column and no rail toggle (objectstack#27241: the
 * switch decides whether the column exists, the rail toggle only opens one
 * the switch allows). `data-record-columns-shown` names the resident columns.
 */
export const RecordPageColumns: React.FC<RecordPageColumnsProps> = ({
  tier,
  columns,
  footer,
  switches = ALL_COLUMNS_ON,
  relatedArrangement,
  onRelatedArrangementChange,
  onEnlargeRelated,
  enlargedRelated,
  onCloseEnlargedRelated,
  relatedFieldsOf,
  className,
}) => {
  const { t } = useDetailTranslation();
  const railId = React.useId();
  const toggleRef = React.useRef<HTMLButtonElement>(null);
  const [railOpen, setRailOpen] = React.useState(false);
  const arrangement = recordPageArrangementFor(tier, switches);
  // Body tables (in the details column) enlarge too (Target 8 names ⤢ on them).
  const enlargedNode = enlargedRelated
    ? [...columns.related, ...columns.details].find((node) => relatedNodeId(node) === enlargedRelated)
    : undefined;
  const bodyTableIds = React.useMemo(() => new Set(relatedListIdsIn(columns.details)), [columns.details]);
  const hasTimeline = columns.timeline.length > 0;
  const hasRelatedLists = columns.related.length > 0;
  // objectstack#27052 — a timeline the reader switched off is not a column:
  // its blocks are the related column's foot card, under the lists.
  const foldTimeline = arrangement.timelineFolded && hasTimeline;
  const hasRelated = hasRelatedLists || foldTimeline;
  const residentTimeline = hasTimeline && arrangement.columns.includes('timeline');
  const residentRelated = hasRelated && arrangement.columns.includes('related');
  const relatedInRail = hasRelated && arrangement.relatedRail;
  const relatedLabel = t('detail.related');
  const foldedTimelineLabel = t('detail.timelineFolded');

  // The provenance line closes the details column in every tier
  // (objectstack#27055): it describes the record the details show.
  const detailsColumn = (
    <div className={COLUMN_STACK} data-record-column="details">
      {drawNodes(columns.details)}
      {footer}
    </div>
  );
  const timelineColumn = residentTimeline ? (
    <div className={COLUMN_STACK} data-record-column="timeline">
      {drawNodes(columns.timeline)}
    </div>
  ) : null;
  const relatedContent = (
    <>
      {/* The related column's lists draw as compact cards the reader
          arranges (objectstack#27055). */}
      <RelatedListCompactContext.Provider value>
        <RelatedCardStack
          nodes={columns.related}
          arrangement={relatedArrangement}
          onArrangementChange={onRelatedArrangementChange}
          onEnlarge={onEnlargeRelated}
          fieldsOf={relatedFieldsOf}
        />
      </RelatedListCompactContext.Provider>
      {foldTimeline && <FoldedTimelineCard nodes={columns.timeline} label={foldedTimelineLabel} />}
    </>
  );

  const template = residentTimeline
    ? residentRelated
      ? THREE_COLUMN_TEMPLATE.all
      : tier === 'three-column' ? THREE_COLUMN_TEMPLATE.noRelated : 'grid-cols-2'
    : residentRelated ? THREE_COLUMN_TEMPLATE.noTimeline : THREE_COLUMN_TEMPLATE.detailsOnly;
  const closeRail = () => {
    setRailOpen(false);
    toggleRef.current?.focus();
  };
  const body = (
    <>
      {relatedInRail && (
        <div className="flex justify-end" data-record-columns-toolbar="">
          <Button
            ref={toggleRef}
            type="button"
            variant={railOpen ? 'secondary' : 'outline'}
            size="sm"
            className="gap-1.5"
            aria-expanded={railOpen}
            aria-controls={railId}
            onClick={() => setRailOpen((open) => !open)}
            data-testid="record-related-rail-toggle"
          >
            {railOpen ? (
              <PanelRightClose className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <PanelRightOpen className="h-3.5 w-3.5" aria-hidden />
            )}
            <span>{relatedLabel}</span>
            {columns.relatedCount > 0 && (
              <Badge variant="secondary" className="h-4 min-w-[1rem] justify-center px-1 text-[10px] leading-none">
                {columns.relatedCount}
              </Badge>
            )}
          </Button>
        </div>
      )}
      <div className="relative">
        <div
          className={cn('grid items-start gap-6', template)}
          data-record-columns=""
          data-record-columns-shown={['details', residentTimeline && 'timeline', residentRelated && 'related']
            .filter(Boolean)
            .join(' ')}
        >
          {detailsColumn}
          {timelineColumn}
          {residentRelated && (
            <aside className={COLUMN_STACK} data-record-column="related" aria-label={relatedLabel}>
              {relatedContent}
            </aside>
          )}
        </div>
        {relatedInRail && railOpen && (
          <aside
            id={railId}
            aria-label={relatedLabel}
            className={cn(
              COLUMN_STACK,
              'absolute right-0 top-0 z-20 min-h-full w-80 max-w-full border-l border-border bg-background pb-4 pl-4 shadow-[-12px_0_24px_-20px_rgba(0,0,0,0.35)]',
            )}
            data-record-column="related"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                closeRail();
              }
            }}
          >
            {relatedContent}
          </aside>
        )}
      </div>
    </>
  );

  return (
    <DefaultRecordPageContext.Provider value>
    <RecordBodyTablesContext.Provider value={bodyTableIds}>
    <RelatedEnlargeContext.Provider value={onEnlargeRelated ?? null}>
      <div
        className={cn('w-full bg-background p-3 md:p-4 lg:p-6', className)}
        data-page-type="record"
        data-record-page-tier={tier}
      >
        <div className="flex flex-col gap-4">
          {drawNodes(columns.header)}
          {enlargedNode ? <EnlargedRelatedList node={enlargedNode} onClose={onCloseEnlargedRelated} /> : body}
        </div>
      </div>
    </RelatedEnlargeContext.Provider>
    </RecordBodyTablesContext.Provider>
    </DefaultRecordPageContext.Provider>
  );
};
