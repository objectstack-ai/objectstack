// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DashboardPreview — interactive design surface for a Dashboard
 * metadata draft. Clicking a widget emits a {@link MetadataSelection}
 * so the host swaps the right-side inspector to that widget's form.
 *
 * Uses the same DashboardRenderer the runtime DashboardView uses, with
 * the adapter from app-shell's AdapterProvider so widgets can query
 * live data. `designMode` is ON whenever the host is editing —
 * read-only / view mode falls back to a plain runtime preview so the
 * canvas looks identical to what end users see.
 *
 * The plugin is loaded lazily to avoid pulling its dep graph into
 * every metadata-admin page load.
 */

import * as React from 'react';
import { Loader2, Pencil, X, Check } from 'lucide-react';
import type { DashboardComponentSchema, DashboardWidgetSchema } from '@object-ui/types';
import { useAdapter } from '../../../providers/AdapterProvider.js';
import type { MetadataPreviewProps } from '../preview-registry.js';
import { PreviewShell, PreviewErrorBoundary, PreviewMessage } from './PreviewShell.js';
import { uniqueId, appendArray } from '../inspectors/_shared.js';
import { t as tr } from '../i18n.js';
// The spec's own `I18nLabel` resolver, aliased so it is never confused with
// objectui's same-named translation-KEY resolver in `app-shell/src/utils`.
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';
import { setLocalized } from '@object-ui/i18n';
import { AddWidgetPicker } from './AddWidgetPicker.js';
import { WIDGET_TYPE_META } from './widget-types.js';

const DashboardRenderer = React.lazy(() =>
  import('@object-ui/plugin-dashboard').then((m) => ({ default: m.DashboardRenderer })),
);

export function DashboardPreview({
  draft,
  editing,
  onPatch,
  selection,
  onSelectionChange,
  locale,
}: MetadataPreviewProps) {
  const adapter = useAdapter();
  const widgets: DashboardWidgetSchema[] = Array.isArray((draft as any).widgets)
    ? (draft as any).widgets
    : [];

  // Design mode is opt-in: only active while the host edits AND the
  // host supplied a selection channel. In read-only / drawer-preview
  // contexts we render the runtime presentation untouched.
  const designMode = !!(editing && onSelectionChange);
  const canEdit = designMode && !!onPatch;
  const selectedWidgetId =
    selection && selection.kind === 'widget' ? selection.id : null;

  const handleWidgetClick = React.useCallback(
    (widgetId: string | null) => {
      if (!onSelectionChange) return;
      if (!widgetId) {
        onSelectionChange(null);
        return;
      }
      const w = widgets.find((wi) => wi?.id === widgetId);
      onSelectionChange({
        kind: 'widget',
        id: widgetId,
        // `DashboardWidget.title` became `string | Record<string, string>` in
        // @objectstack/spec 17.0.0-rc.6 (`I18nLabel` absorbed the inline
        // per-locale map). `SelectionChange.label` is a `string`, so the map
        // form is resolved here rather than stringified at the render site.
        label: resolveInlineI18nLabel(w?.title, locale) || widgetId,
      });
    },
    [onSelectionChange, widgets, locale],
  );

  // Typed as `DashboardRenderer`'s `onWidgetsReorder` hands it: the slot's own
  // array, each entry a widget or a component node (objectui#11514).
  const handleReorder = React.useCallback(
    (next: DashboardComponentSchema['widgets']) => {
      if (!onPatch) return;
      onPatch({ widgets: next });
    },
    [onPatch],
  );

  const handleAddWidget = React.useCallback(
    (type: string) => {
      if (!canEdit) return;
      const existingIds = widgets.map((w) => w?.id).filter(Boolean) as string[];
      const id = uniqueId('widget', existingIds);
      const meta = WIDGET_TYPE_META[type];
      const title = meta ? `New ${meta.label.toLowerCase()}` : 'New widget';
      const newWidget = { id, type, title, ...(meta?.defaults ?? {}) } as unknown as DashboardWidgetSchema;
      const next = appendArray(widgets, newWidget);
      onPatch!({ widgets: next });
      onSelectionChange?.({ kind: 'widget', id, label: title });
    },
    [canEdit, widgets, onPatch, onSelectionChange],
  );

  // The inline rename edits the title in the designer `locale`, the same
  // read/write pair the widget inspector uses: the strip shows
  // `resolveInlineI18nLabel(title, locale)`, and the save goes through
  // `setLocalized`, so a per-locale map gets only that locale's entry replaced
  // (or added) and every other locale is kept (objectui#10847). A plain-string
  // title stays a plain string. Writing `trimmed` straight over a map would
  // drop every locale the author was not looking at.
  const handleRenameWidget = React.useCallback(
    (id: string, nextTitle: string) => {
      if (!canEdit) return;
      const trimmed = nextTitle.trim();
      const next = widgets.map((w) =>
        w?.id === id
          ? ({
              ...(w as object),
              title: setLocalized(w.title, locale, trimmed) as DashboardWidgetSchema['title'],
            } as DashboardWidgetSchema)
          : w,
      );
      onPatch!({ widgets: next });
      onSelectionChange?.({ kind: 'widget', id, label: trimmed || id });
    },
    [canEdit, widgets, onPatch, onSelectionChange, locale],
  );

  const selectedWidget = selectedWidgetId
    ? widgets.find((w) => w?.id === selectedWidgetId) ?? null
    : null;

  // objectui#8219 — a dashboard with ONE widget shows it across the whole
  // grid. The renderer sizes each widget by its authored span (a half-width
  // chart is `w: 6` of 12), which leaves a lone widget using half the canvas
  // beside empty space. Rendering that draft as a one-column grid gives the
  // lone widget the full width while its authored row count (`layout.h`) and
  // the renderer's content-sized rows stay as they are. Preview only: the
  // draft handed to `onPatch` is never this copy.
  const loneWidget = widgets.length === 1;
  const renderedSchema = React.useMemo(
    () => (loneWidget ? { ...(draft as Record<string, unknown>), columns: 1 } : draft),
    [draft, loneWidget],
  );

  const addButton = canEdit ? (
    <AddWidgetPicker onAdd={handleAddWidget} label={tr('engine.inspector.add.widget', locale)} />
  ) : null;

  if (widgets.length === 0) {
    return (
      <PreviewShell hint={`dashboard${designMode ? ' · design' : ''}`} toolbar={addButton}>
        <PreviewMessage>{tr('engine.dashboardPreview.empty', locale)}</PreviewMessage>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell
      hint={`dashboard · ${widgets.length} widget${widgets.length === 1 ? '' : 's'}${
        designMode ? ' · design' : ''
      }`}
      toolbar={addButton}
    >
      <PreviewErrorBoundary fallbackHint={tr('engine.dashboardPreview.malformed', locale)}>
        {canEdit && selectedWidget ? (
          <SelectedWidgetStrip
            widget={selectedWidget}
            locale={locale}
            onRename={(nextTitle) => handleRenameWidget(selectedWidget.id!, nextTitle)}
            onClose={() => onSelectionChange?.(null)}
          />
        ) : null}
        <React.Suspense
          fallback={
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> {tr('engine.dashboardPreview.loading', locale)}
            </div>
          }
        >
          <div className="p-3 max-h-[70vh] overflow-auto">
            {/*
             * The runtime dashboard grid is 12 columns wide. Inside the
             * Studio canvas — especially with the inspector open — the
             * available width collapses to ~500px, squeezing metric cards
             * down to ~120px so their titles truncate to a couple of
             * characters ("管道…"). Pin a desktop-like minimum width so
             * the grid lays out as end users see it; the parent's
             * overflow-auto adds a horizontal scrollbar when the canvas is
             * narrower. The minimum applies only with several widgets: a lone
             * widget fills the grid instead (objectui#8219), so it has no row
             * to squeeze and a pinned width would only add a scrollbar.
             */}
            <div className={loneWidget ? undefined : 'min-w-[768px]'}>
              <DashboardRenderer
                schema={renderedSchema as any}
                dataSource={adapter as any}
                designMode={designMode}
                selectedWidgetId={selectedWidgetId}
                onWidgetClick={designMode ? handleWidgetClick : undefined}
                onWidgetsReorder={designMode && onPatch ? handleReorder : undefined}
                hideHeaderText
              />
            </div>
          </div>
        </React.Suspense>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}

/**
 * Floating strip that appears above the dashboard whenever a widget
 * is selected in design mode. Lets the author rename the widget
 * inline (Enter commits, Esc cancels) without diving into the right-
 * side inspector for a single text edit. Its own words read the designer
 * `locale` (objectui#10835). The widget's title is author data, but it is the
 * spec's `I18nLabel`, so it may be a per-locale map: it is shown, and the
 * rename draft seeded, through `resolveInlineI18nLabel` in the same designer
 * `locale` the selection label uses (objectui#10847). The map itself never
 * reaches React as a child. The widget inspector's title field edits the same
 * entry through the same read/write pair (`resolveInlineI18nLabel` and
 * `setLocalized`); editing every locale from one surface is still an open question.
 */
function SelectedWidgetStrip({
  widget,
  locale,
  onRename,
  onClose,
}: {
  widget: DashboardWidgetSchema;
  locale?: string;
  onRename: (nextTitle: string) => void;
  onClose: () => void;
}) {
  const currentTitle = resolveInlineI18nLabel(widget.title, locale) ?? widget.id ?? '';
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(currentTitle);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Sync local state when the externally-selected widget changes.
  React.useEffect(() => {
    setDraft(currentTitle);
    setEditing(false);
  }, [widget.id, currentTitle]);

  React.useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== currentTitle) onRename(v);
    setEditing(false);
  };

  const cancel = () => {
    setDraft(currentTitle);
    setEditing(false);
  };

  const meta = WIDGET_TYPE_META[widget.type as string];
  const TypeIcon = meta?.icon ?? null;

  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-primary/5 px-3 py-1.5 text-xs">
      {TypeIcon ? <TypeIcon className="h-3.5 w-3.5 text-primary" /> : null}
      <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary-foreground">
        {tr('engine.dashboardPreview.selected', locale)}
      </span>
      {editing ? (
        <>
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}
            className="flex-1 min-w-0 rounded border bg-background px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            type="button"
            onClick={commit}
            className="rounded p-1 hover:bg-primary/10"
            aria-label={tr('engine.dashboardPreview.saveTitle', locale)}
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex-1 min-w-0 truncate text-left font-medium hover:underline"
            title={tr('engine.dashboardPreview.clickToRename', locale)}
          >
            {currentTitle || (
              <span className="italic text-muted-foreground">{tr('engine.dashboardPreview.untitled', locale)}</span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded p-1 hover:bg-primary/10"
            aria-label={tr('engine.dashboardPreview.renameWidget', locale)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </>
      )}
      <button
        type="button"
        onClick={onClose}
        className="rounded p-1 hover:bg-primary/10"
        aria-label={tr('engine.dashboardPreview.clearSelection', locale)}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
