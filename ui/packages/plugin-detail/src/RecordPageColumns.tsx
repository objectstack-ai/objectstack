/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Badge, Button, cn } from '@object-ui/components';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { PanelRightClose, PanelRightOpen } from 'lucide-react';
import {
  recordPageArrangementFor,
  type DefaultPageColumns,
  type RecordPageColumnSwitches,
} from './synth/recordPageColumns';
import { useDetailTranslation } from './useDetailTranslation';
import { RelatedListCompactContext } from './relatedListCompact';
import { DefaultRecordPageContext } from './defaultRecordPage';

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
   * not drawn — the timeline folds into the related column's 「动态」 card, the
   * related column into the rail (`recordPageArrangementFor`). Absent: both on.
   */
  switches?: RecordPageColumnSwitches;
  className?: string;
}

const ALL_COLUMNS_ON: RecordPageColumnSwitches = { timeline: true, related: true };

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

/** The related column's nodes: its lists draw as compact cards. */
function drawRelatedNodes(nodes: any[]): React.ReactNode {
  return <RelatedListCompactContext.Provider value>{drawNodes(nodes)}</RelatedListCompactContext.Provider>;
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
 * it stays in the rail. `data-record-columns-shown` names the resident
 * columns.
 */
export const RecordPageColumns: React.FC<RecordPageColumnsProps> = ({
  tier,
  columns,
  footer,
  switches = ALL_COLUMNS_ON,
  className,
}) => {
  const { t } = useDetailTranslation();
  const railId = React.useId();
  const toggleRef = React.useRef<HTMLButtonElement>(null);
  const [railOpen, setRailOpen] = React.useState(false);
  const arrangement = recordPageArrangementFor(tier, switches);
  const hasTimeline = columns.timeline.length > 0;
  const hasRelatedLists = columns.related.length > 0;
  // objectstack#27052 — a timeline the reader switched off is not a column:
  // its blocks are the related column's foot card, under the lists.
  const foldTimeline = arrangement.timelineFolded && hasTimeline;
  const hasRelated = hasRelatedLists || foldTimeline;
  const residentTimeline = hasTimeline && arrangement.columns.includes('timeline');
  const residentRelated = hasRelated && !arrangement.relatedRail;
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
      {drawRelatedNodes(columns.related)}
      {foldTimeline && (
        <section
          className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4"
          aria-label={foldedTimelineLabel}
          data-record-folded-timeline=""
        >
          <h2 className="text-sm font-semibold text-foreground">{foldedTimelineLabel}</h2>
          {drawNodes(columns.timeline)}
        </section>
      )}
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
      <div
        className={cn('w-full bg-background p-3 md:p-4 lg:p-6', className)}
        data-page-type="record"
        data-record-page-tier={tier}
      >
        <div className="flex flex-col gap-4">
          {drawNodes(columns.header)}
          {body}
        </div>
      </div>
    </DefaultRecordPageContext.Provider>
  );
};
