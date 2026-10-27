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
import type { DefaultPageColumns } from './synth/recordPageColumns';
import { useDetailTranslation } from './useDetailTranslation';

export interface RecordPageColumnsProps {
  /** The column tier to draw; the tabbed tier is the page itself, drawn by its host. */
  tier: 'two-column' | 'three-column';
  /** The synthesized page, partitioned (`buildDefaultPageColumns`). */
  columns: DefaultPageColumns;
  /**
   * The record's provenance footer, which the host draws once per page: under
   * the related column in the three-column tier, under the columns in the
   * two-column tier (where the related column is a rail that may be closed).
   */
  footer?: React.ReactNode;
  className?: string;
}

/**
 * Grid templates by which columns have content. Literal strings, so
 * Tailwind's scanner emits each one. Details and timeline share the width
 * (the timeline a little wider, it carries the composer); the related column
 * is a fixed rail.
 */
const THREE_COLUMN_TEMPLATE = {
  all: 'grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_20rem]',
  noTimeline: 'grid-cols-[minmax(0,1fr)_20rem]',
  noRelated: 'grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]',
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
 */
export const RecordPageColumns: React.FC<RecordPageColumnsProps> = ({ tier, columns, footer, className }) => {
  const { t } = useDetailTranslation();
  const railId = React.useId();
  const toggleRef = React.useRef<HTMLButtonElement>(null);
  const [railOpen, setRailOpen] = React.useState(false);
  const hasTimeline = columns.timeline.length > 0;
  const hasRelated = columns.related.length > 0;
  const relatedLabel = t('detail.related');

  const detailsColumn = (
    <div className="flex min-w-0 flex-col gap-4" data-record-column="details">
      {drawNodes(columns.details)}
    </div>
  );
  const timelineColumn = hasTimeline ? (
    <div className="flex min-w-0 flex-col gap-4" data-record-column="timeline">
      {drawNodes(columns.timeline)}
    </div>
  ) : null;

  let body: React.ReactNode;
  if (tier === 'three-column') {
    const showRelated = hasRelated || footer != null;
    const template = hasTimeline
      ? showRelated ? THREE_COLUMN_TEMPLATE.all : THREE_COLUMN_TEMPLATE.noRelated
      : showRelated ? THREE_COLUMN_TEMPLATE.noTimeline : THREE_COLUMN_TEMPLATE.detailsOnly;
    body = (
      <div className={cn('grid items-start gap-6', template)} data-record-columns="">
        {detailsColumn}
        {timelineColumn}
        {showRelated && (
          <aside className="flex min-w-0 flex-col gap-4" data-record-column="related" aria-label={relatedLabel}>
            {drawNodes(columns.related)}
            {footer}
          </aside>
        )}
      </div>
    );
  } else {
    const closeRail = () => {
      setRailOpen(false);
      toggleRef.current?.focus();
    };
    body = (
      <>
        {hasRelated && (
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
            className={cn('grid items-start gap-6', hasTimeline ? 'grid-cols-2' : 'grid-cols-1')}
            data-record-columns=""
          >
            {detailsColumn}
            {timelineColumn}
          </div>
          {hasRelated && railOpen && (
            <aside
              id={railId}
              aria-label={relatedLabel}
              className="absolute right-0 top-0 z-20 flex min-h-full w-80 max-w-full flex-col gap-4 border-l border-border bg-background pb-4 pl-4 shadow-[-12px_0_24px_-20px_rgba(0,0,0,0.35)]"
              data-record-column="related"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  closeRail();
                }
              }}
            >
              {drawNodes(columns.related)}
            </aside>
          )}
        </div>
        {footer}
      </>
    );
  }

  return (
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
  );
};
