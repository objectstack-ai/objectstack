// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Studio canvas's built-in `object` renderer: the runtime records grid.
 *
 * Its own module so it loads on first draw (objectstack#33582):
 * `./studio-canvas-preview.tsx` is imported by the package entry for its
 * load-time registration, and registers this component through a lazy wrapper
 * of the same name. ⛔ Import it statically only from code that is itself lazy
 * (tests aside): a static import from the package's eager graph puts the grid,
 * and the designer strings it reads, back on every console route.
 */

import * as React from 'react';
import { SchemaRenderer, useMetadata } from '@object-ui/react';
import { resolveViewId } from '@object-ui/core';
import { useAuth } from '@object-ui/auth';
import { Database, Loader2 } from 'lucide-react';
import { findByName } from '../../hooks/useNavTargetLabel.js';
import { t } from '../metadata-admin/i18n.js';
import {
  listViewsOf,
  navEntryListTarget,
  StudioCanvasCardSelectionContext,
  StudioCanvasColumnSelectionContext,
  StudioCanvasDraftOnlyObjectsContext,
  StudioCanvasListViewContext,
  StudioCanvasNavEntryContext,
  type StudioCanvasNavEntry,
  type StudioCanvasPreviewProps,
} from './studio-canvas-preview.js';

/**
 * Default Studio-canvas renderer for `object` leaves: the runtime records grid,
 * exactly as the running app shows it (preview = runtime). Schema editing lives
 * in the Data pillar, so this is the object-view grid — NOT the field-form
 * designer that is the `object` entry in the MetadataPreviewRegistry.
 *
 * objectui#11774 — opened on a nav entry that slices the object (`filters`) or
 * names one of its views (`viewName`), it shows that slice or that view, as the
 * running app does (see {@link navEntryListTarget}). The named view is the
 * object's own, from the merged `listViews` the shell's metadata holds — the
 * map `ObjectView` and the rail's label resolver (`useNavTargetLabel`) read —
 * handed to the renderer as the Studio's view preview hands one. With no entry
 * (or a plain one) the schema is exactly the one this rendered before.
 *
 * objectui#11823 — while the Properties panel beside it holds a list view of
 * this object ({@link StudioCanvasListViewContext}), that view is the one
 * shown: the panel's buffer, so an edit shows here before it is published.
 * The panel holds the view this canvas opens (the entry's named view, else the
 * object's default list view, as the running app opens it).
 *
 * objectui#12508 — an object the Interfaces pillar names draft-only
 * ({@link StudioCanvasDraftOnlyObjectsContext}) has no runtime yet: no schema
 * and no records to read. The canvas says it is not published instead of
 * mounting the grid, whose reads would answer 404.
 *
 * Exported so downstream renderers can compose/wrap it; override the default
 * wholesale via `registerStudioCanvasPreview('object', …)`.
 */
export function StudioObjectRecordsCanvas(props: StudioCanvasPreviewProps) {
  const { name, locale } = props;
  // objectui#12508 — an object with only a draft has no runtime to preview,
  // and while the pillar has not said, the grid waits rather than ask.
  const draftOnly = React.useContext(StudioCanvasDraftOnlyObjectsContext);
  if (draftOnly?.status === 'pending') {
    return (
      <div data-testid="studio-canvas-object-pending" className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t('engine.studio.loading', locale)}
      </div>
    );
  }
  if (draftOnly?.status === 'known' && draftOnly.names.has(name)) {
    return (
      <div data-testid="studio-canvas-object-unpublished" className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Database className="h-6 w-6 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">{t('engine.studio.if.objectUnpublishedTitle', locale)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('engine.studio.if.objectUnpublishedHint', locale)}</p>
        </div>
      </div>
    );
  }
  return <ObjectRecordsGrid {...props} />;
}

/** The runtime records grid {@link StudioObjectRecordsCanvas} renders for a published object. */
function ObjectRecordsGrid({ name }: StudioCanvasPreviewProps) {
  const entry = React.useContext(StudioCanvasNavEntryContext);
  const edited = React.useContext(StudioCanvasListViewContext);
  const editedView = edited && edited.objectName === name ? edited : null;
  const { user, activeOrganization } = useAuth();
  const currentUserId = user?.id ?? null;
  const currentOrgId = activeOrganization?.id ?? null;
  // Keyed on the values, never on the context object's identity (AGENTS.md #10).
  const navId = entry?.navId;
  const filtersKey = JSON.stringify(entry?.filters ?? null);
  const entryViewName = entry?.viewName;
  const target = React.useMemo(() => {
    const filters = (JSON.parse(filtersKey) as StudioCanvasNavEntry['filters'] | null) ?? undefined;
    return navEntryListTarget(name, { navId, filters, viewName: entryViewName }, { currentUserId, currentOrgId });
  }, [name, navId, filtersKey, entryViewName, currentUserId, currentOrgId]);
  // Read only for an entry that names a view: a plain entry asks the metadata
  // cache for nothing, as before. The panel's view, when there is one, is
  // shown instead of the cache's (objectui#11823).
  const metadata = useMetadata();
  const objectViews = !editedView && target.viewName ? listViewsOf(findByName(metadata.objects, name)) : undefined;
  const viewId = editedView
    ? editedView.viewId
    : objectViews && target.viewName
      ? resolveViewId(target.viewName, Object.keys(objectViews), name)
      : undefined;
  const view = editedView ? editedView.view : viewId ? objectViews?.[viewId] : undefined;
  const schema = {
    type: 'object-view',
    objectName: name,
    ...(target.filter.length > 0 ? { table: { filter: target.filter } } : {}),
    ...(viewId && view ? { listViews: { [viewId]: view }, defaultListView: viewId } : {}),
  };
  // The renderer settles its named view once, at mount, so a different view is
  // a different mount; a different slice of the same list is a refetch.
  return (
    <ColumnHeaderSelect objectName={name}>
      <KanbanCardSelect objectName={name}>
        <SchemaRenderer key={view ? viewId : ''} schema={schema as never} />
      </KanbanCardSelect>
    </ColumnHeaderSelect>
  );
}

/**
 * objectui#12725 — the canvas half of selecting a kanban view's card: a click
 * on a card of the board ({@link StudioCanvasCardSelectionContext}) selects
 * the card and does not open the record. The board names each card's record
 * on its element (`data-kanban-card`, `SortableCard`). Both the click and the
 * pointer press are taken in the capture phase, before the card's own handlers
 * see them: the click would open the record, and the press is where the
 * board's drag sensor starts a move. A control drawn inside a card keeps its
 * job.
 *
 * A focused card opens on Enter and on Space's release, as a click does
 * (objectui#12888), so the keys are taken in the capture phase too: on the
 * Studio canvas Enter, and Space's release, select the card, and Space's press
 * is held so the board does not scroll. Only a key on the card element itself,
 * the board's own guard: a key on something inside the card stays its own.
 *
 * Drawn always, with no box, for the reason {@link ColumnHeaderSelect} is.
 */
function KanbanCardSelect({ objectName, children }: { objectName: string; children: React.ReactNode }) {
  const channel = React.useContext(StudioCanvasCardSelectionContext);
  const cards = channel && channel.objectName === objectName ? channel : null;
  const scope = React.useId();
  const cardOf = (e: React.SyntheticEvent<HTMLDivElement>): Element | null => {
    if (!cards || !(e.target instanceof Element)) return null;
    const card = e.target.closest('[data-kanban-card]');
    if (!card || !e.currentTarget.contains(card)) return null;
    const control = e.target.closest('button, input, a, [role="checkbox"]');
    if (control && card.contains(control)) return null;
    return card;
  };
  const onPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
    if (cardOf(e)) e.stopPropagation();
  };
  const onKeyCapture = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!cards || !(e.target instanceof Element) || !e.target.matches('[data-kanban-card]')) return;
    if (!e.currentTarget.contains(e.target)) return;
    const selects = e.type === 'keydown' ? e.key === 'Enter' : e.key === ' ';
    if (!selects && !(e.type === 'keydown' && e.key === ' ')) return;
    e.stopPropagation();
    e.preventDefault();
    const id = e.target.getAttribute('data-kanban-card');
    if (selects && id) cards.onSelect(id);
  };
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    const id = cardOf(e)?.getAttribute('data-kanban-card');
    if (!cards || !id) return;
    e.stopPropagation();
    e.preventDefault();
    cards.onSelect(id);
  };
  return (
    <div
      className="contents"
      data-testid="studio-canvas-cards"
      data-studio-canvas-cards={scope}
      onPointerDownCapture={onPointerDownCapture}
      onClickCapture={onClickCapture}
      onKeyDownCapture={onKeyCapture}
      onKeyUpCapture={onKeyCapture}
    >
      {cards?.selected ? (
        // The clicked card is outlined, as the StudioRailProps artboard draws
        // a selected element. A style rule, for the reason the column's is:
        // the board owns its cards and redraws them.
        <style>{`[data-studio-canvas-cards="${scope}"] [data-kanban-card=${JSON.stringify(cards.selected)}]>*{outline:2px solid hsl(var(--primary));outline-offset:1px;}`}</style>
      ) : null}
      {children}
    </div>
  );
}

/**
 * objectui#12725 — the canvas half of selecting a column: a click on a header
 * the panel lists ({@link StudioCanvasColumnSelectionContext}) selects that
 * column and does not sort. The runtime grid names each header's column on
 * the cell (`data-column-key`, the data table's `accessorKey`, which the
 * object grid sets to the column's `field`); the click is taken in the
 * capture phase, before the header's own sort handler sees it.
 *
 * The wrapper is always drawn, and draws no box (`display: contents`), so the
 * grid under it is not remounted when the channel arrives or goes.
 */
function ColumnHeaderSelect({ objectName, children }: { objectName: string; children: React.ReactNode }) {
  const channel = React.useContext(StudioCanvasColumnSelectionContext);
  const columns = channel && channel.objectName === objectName ? channel : null;
  const scope = React.useId();
  const onClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!columns || !(e.target instanceof Element)) return;
    const header = e.target.closest('thead th[data-column-key]');
    if (!header || !e.currentTarget.contains(header)) return;
    // A control drawn inside the header (the edit-field button) keeps its job.
    const control = e.target.closest('button, input, a, [role="checkbox"]');
    if (control && header.contains(control)) return;
    const field = header.getAttribute('data-column-key');
    if (!field || !columns.fields.includes(field)) return;
    e.stopPropagation();
    e.preventDefault();
    columns.onSelect(field, header.textContent?.trim() || field);
  };
  return (
    <div className="contents" data-testid="studio-canvas-columns" data-studio-canvas-columns={scope} onClickCapture={onClickCapture}>
      {columns?.selected ? (
        // The selected column's header is outlined, as the StudioRailProps
        // artboard draws a selected element. A style rule, not a class on
        // the cell: the grid owns its cells and redraws them.
        <style>{`[data-studio-canvas-columns="${scope}"] thead th[data-column-key=${JSON.stringify(columns.selected)}]{box-shadow:inset 0 0 0 2px hsl(var(--primary));}`}</style>
      ) : null}
      {children}
    </div>
  );
}
