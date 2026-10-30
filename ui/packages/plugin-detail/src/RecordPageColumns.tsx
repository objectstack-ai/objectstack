/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import { Button, cn } from '@object-ui/components';
import type { FieldContainerLike } from '@object-ui/core';
import { SchemaRenderer, toRenderableSchema } from '@object-ui/react';
import { ChevronLeft } from 'lucide-react';
import {
  RECORD_PAGE_TIMELINE_PANEL,
  relatedListIdsIn,
  type DefaultPageColumns,
  type RecordPageTier,
} from './synth/recordPageColumns';
import { useDetailTranslation } from './useDetailTranslation';
import { RecordBodyTablesContext, RelatedEnlargeContext, RelatedListCompactContext } from './relatedListCompact';
import { DefaultRecordPageContext, DetailsColumnCapContext } from './defaultRecordPage';
import { RelatedCardStack } from './RelatedCardStack';
import { RecordTimelinePanel } from './RecordTimelinePanel';
import { relatedCardId, type RelatedArrangement, type RelatedCardId } from './synth/relatedArrangement';

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
   * `timeline` for the 动态 stream — the host's `?related=`.
   */
  onEnlargeRelated?: (id: RelatedCardId) => void;
  /**
   * The open face (the host's `?related=`): a related list's full table, or
   * the 动态 stream in full (`timeline`), drawn at the page's full width
   * under the record header until Esc or ‹ (`onCloseEnlargedRelated`). An id
   * naming nothing on the page draws the page.
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
 * A panel's whole face, open in place (objectstack#27055, Target 9): under the
 * record header, at the page's full width, with ‹ to return. Esc returns too;
 * a dialog or menu open over the page keeps its own Esc.
 */
/**
 * Whether an `Esc` belongs to something other than the open face: a field the
 * reader types in, an open menu or alert, or a dialog the face is not inside
 * (a popover, a confirm, a drawer opened over the page that holds the face).
 * The dialog that holds the face — the record pane's drawer — is not one.
 */
function escapeOwnedElsewhere(target: EventTarget | null, face: Element | null): boolean {
  if (!face) return true;
  if (
    target instanceof Element &&
    target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')
  ) {
    return true;
  }
  const doc = face.ownerDocument;
  if (doc.querySelector('[role="alertdialog"], [role="menu"]')) return true;
  return Array.from(doc.querySelectorAll('[role="dialog"]')).some((dialog) => !dialog.contains(face));
}

const EnlargedFace: React.FC<{ id: string; title: string; onClose?: () => void; children: React.ReactNode }> = ({
  id,
  title,
  onClose,
  children,
}) => {
  const { t } = useDetailTranslation();
  const faceRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!onClose) return undefined;
    // On the window, in the capture phase: inside the record pane the pane's
    // own `Esc` (the drawer's dialog layer, the split pane's document
    // listener) would act first and close or step the pane (objectstack#27524).
    // The face takes the key, and keeps it from the pane.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (escapeOwnedElsewhere(event.target, faceRef.current)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);
  return (
    <section ref={faceRef} className="flex min-w-0 flex-col gap-3" data-related-enlarged={id} aria-label={title}>
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
      {children}
    </section>
  );
};

/**
 * The enlarged related list (Target 9, the ONE path to a related list's
 * every record): the full `RelatedList` face — every column, paging, sort,
 * inline edit.
 */
function enlargedRelatedList(node: any): React.ReactNode {
  const p = { ...node, ...(node.properties ?? {}) };
  const authoredLimit = typeof p.limit === 'number' && p.limit > 0;
  const enlarged = authoredLimit
    ? node
    : { ...node, properties: { ...(node.properties ?? {}), limit: ENLARGED_PAGE_SIZE } };
  return <SchemaRenderer schema={toRenderableSchema(enlarged)} />;
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

  // The open face: the 动态 stream in full, or a related list — body tables
  // (in the details) enlarge too (Target 8 names ⤢ on them).
  let enlarged: React.ReactNode = null;
  if (enlargedRelated === RECORD_PAGE_TIMELINE_PANEL && hasTimeline) {
    enlarged = (
      <EnlargedFace
        id={RECORD_PAGE_TIMELINE_PANEL}
        title={t('detail.timeline', { defaultValue: 'Activity' })}
        onClose={onCloseEnlargedRelated}
      >
        {drawNodes(columns.timeline)}
      </EnlargedFace>
    );
  } else if (enlargedRelated) {
    const node = [...columns.related, ...columns.details].find((n) => relatedNodeId(n) === enlargedRelated);
    if (node) {
      enlarged = (
        <EnlargedFace id={enlargedRelated} title={relatedNodeTitle(node)} onClose={onCloseEnlargedRelated}>
          {enlargedRelatedList(node)}
        </EnlargedFace>
      );
    }
  }

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
        />
      )}
      {/* The related panels, in the reader's arrangement (objectstack#27055). */}
      <RelatedListCompactContext.Provider value>
        <RelatedCardStack
          nodes={columns.related}
          arrangement={relatedArrangement}
          onArrangementChange={onRelatedArrangementChange}
          onEnlarge={onEnlargeRelated}
          fieldsOf={relatedFieldsOf}
        />
      </RelatedListCompactContext.Provider>
    </aside>
  ) : null;
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
