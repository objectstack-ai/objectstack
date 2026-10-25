// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DashboardDefaultInspector — the curated "home" panel for a Dashboard.
 *
 * Shown as the DEFAULT right panel (no selection) for a dashboard. Mirrors
 * {@link ReportDefaultInspector} but for the flat Dashboard document.
 *
 * SPEC-DRIVEN: the layout / filter / performance config fields are NOT
 * hardcoded. They are rendered by feeding the spec's canonical authoring
 * form (`dashboardForm`) and the spec-derived Dashboard JSONSchema into the
 * generic {@link SchemaForm}. Adding a new dashboard prop to
 * `@objectstack/spec` flows through with zero code changes here.
 *
 * The inspector keeps a thin curated layer for the cross-cutting concerns the
 * spec form can't express well on its own:
 *   1. the LABEL / DESCRIPTION basics, and
 *   2. the WIDGETS list — add / remove / reorder / select drills into the
 *      scoped {@link DashboardWidgetInspector}. Those fields are therefore
 *      pruned from the spec form to avoid double-editing.
 *
 * Unlike a View (a nested document with a variant BODY), a Dashboard is FLAT:
 * label / description / widgets / layout all live at the draft top level, so
 * every write is a plain shallow `onPatch`. Widgets are addressed by their
 * own `id` (matching {@link DashboardWidgetInspector} and {@link
 * DashboardPreview}), not by an index path.
 */

import * as React from 'react';
import { GripVertical, X } from 'lucide-react';
import { Badge, Button, Label } from '@object-ui/components';
import type { DashboardWidgetSchema } from '@object-ui/types';
import {
  InspectorShell,
  InspectorTextField,
  appendArray,
  moveArray,
  spliceArray,
  uniqueId,
} from './_shared.js';
import { AddWidgetPicker } from '../previews/AddWidgetPicker.js';
import { WIDGET_TYPE_META, UnknownWidgetIcon } from '../previews/widget-types.js';
import type { MetadataDefaultInspectorProps } from '../default-inspector-registry.js';
import { SchemaForm } from '../SchemaForm.js';
import type { FormViewSpec } from '../SchemaForm.js';
import { getDashboardForm, getDashboardSchema } from '../dashboard-schema.js';
import { mergeServerFields } from '../mergeServerFields.js';
import { t, tFormat } from '../i18n.js';
// `DashboardWidget.title` is the spec's `I18nLabel`, which @objectstack/spec
// 17.0.0-rc.6 widened from plain `string` to `string | Record<string, string>`
// (the inline per-locale map, folded in from the retired `I18nObject`). Every
// read below lands in a text slot — a `<button>` child, an HTML `title=`, a
// selection label typed `string` — so each one resolves through the spec's own
// shared resolver first. Rendering the map form raw prints `[object Object]`,
// which is the exact harm the resolver's own doc comment names.
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';
// objectui#12688 — the served titles the Studio's Interfaces pillar provides.
import { displayWidgetTitle, useServedWidgetText } from '../../studio-design/servedDashboardText.js';

type DashboardWidget = DashboardWidgetSchema & { id: string };

/**
 * Top-level dashboard fields rendered by this inspector's own controls (or by
 * the dedicated widgets list), pruned from the spec-form graft so they are not
 * double-rendered. Mirrors the `hiddenFields` passed to SchemaForm.
 */
const DASHBOARD_CURATED_FIELDS = new Set([
  'name',
  'label',
  'description',
  'widgets',
]);

/**
 * objectui#11796 — this inspector is a narrow side panel, so every section of
 * the spec form renders as ONE column here.
 *
 * `dashboardForm` lays its Layout section out in three columns, which suits a
 * full-width form and squeezed Columns / Gap / Refresh Interval Seconds into a
 * third of this panel each: a two-digit value lost a digit and the labels
 * wrapped onto several lines. A section's `columns` is a layout hint for the
 * form's host, and this host is a single column, so the fields keep their
 * declared order and stack. A field's `colSpan` is clamped with its section:
 * a span wider than a one-column grid adds implicit columns and pushes the
 * section past the panel's edge.
 *
 * Scoped to this panel on purpose: `SchemaForm` still honours `columns` for
 * every other form it renders.
 */
function stackSectionsForNarrowPanel(form: FormViewSpec | undefined): FormViewSpec | undefined {
  if (!form?.sections) return form;
  return {
    ...form,
    sections: form.sections.map((section) => ({
      ...section,
      columns: 1,
      // A `{ group }` section declares no `fields`; it is left as it came.
      ...(section.fields
        ? {
            fields: section.fields.map((f) =>
              typeof f === 'string' || f.colSpan == null ? f : { ...f, colSpan: 1 as const },
            ),
          }
        : {}),
    })),
  };
}

export function DashboardDefaultInspector({
  draft,
  onPatch,
  readOnly,
  locale,
  onSelectionChange,
  serverSchema,
}: MetadataDefaultInspectorProps) {
  const tr = React.useCallback((key: string) => t(key, locale), [locale]);
  // objectui#12688 — the component list DRAWS a widget's served title (the
  // server's `/meta` answer for this session's language) while its authored
  // title still equals the published one; `null` outside the Studio pillar.
  // Display only: selection labels and every editor keep the authored title.
  const servedWidgets = useServedWidgetText();

  const labelValue = typeof draft.label === 'string' ? (draft.label as string) : '';
  const descriptionValue =
    typeof draft.description === 'string' ? (draft.description as string) : '';

  const widgets: DashboardWidget[] = React.useMemo(
    () =>
      Array.isArray(draft.widgets) ? (draft.widgets as DashboardWidget[]) : [],
    [draft.widgets],
  );

  /* ─────────────── Widget read / write / reorder / select ─────────────── */

  const addWidget = (type: string) => {
    const existingIds = widgets.map((w) => w?.id).filter(Boolean) as string[];
    const id = uniqueId('widget', existingIds);
    const meta = WIDGET_TYPE_META[type];
    const title = meta ? `New ${meta.label.toLowerCase()}` : 'New widget';
    const widget = { id, type, title, ...(meta?.defaults ?? {}) } as unknown as DashboardWidget;
    onPatch({ widgets: appendArray(widgets, widget) });
    onSelectionChange?.({ kind: 'widget', id, label: title });
  };

  const removeWidget = (index: number) => {
    onPatch({ widgets: spliceArray(widgets, index, null) });
  };

  const moveWidget = (from: number, to: number) => {
    if (from === to) return;
    onPatch({ widgets: moveArray(widgets, from, to) });
  };

  const selectWidget = (widget: DashboardWidget, index: number) => {
    if (!widget?.id) return;
    onSelectionChange?.({
      kind: 'widget',
      id: widget.id,
      label:
        resolveInlineI18nLabel(widget.title, locale) ||
        widget.id ||
        tFormat('engine.inspector.widget.untitledN', locale, { n: index + 1 }),
    });
  };

  const [dragIndex, setDragIndex] = React.useState<number | null>(null);
  const [overIndex, setOverIndex] = React.useState<number | null>(null);

  // Graft any server-only top-level dashboard fields onto the bundled-spec
  // form so they are editable even when the bundled spec lags the server.
  const { schema, form } = React.useMemo(() => {
    const merged = mergeServerFields({
      bundledSchema: getDashboardSchema(),
      // objectui#7254 — the spec form is English; the locale overlay lives
      // inside `getDashboardForm` so every consumer of it gets the same copy.
      bundledForm: getDashboardForm(locale),
      serverSchema,
      excludeFields: DASHBOARD_CURATED_FIELDS,
      sectionTitle: t('engine.inspector.moreFields', locale),
    });
    // After the graft, so a server-only section stacks too (objectui#11796).
    return { schema: merged.schema, form: stackSectionsForNarrowPanel(merged.form) };
  }, [serverSchema, locale]);

  return (
    <InspectorShell
      kindLabel={tr('engine.inspector.dashboard.kind')}
      title={String(labelValue || draft.name || tr('engine.inspector.dashboard.kind'))}
      onClose={() => {}}
      closeLabel={tr('engine.inspector.dashboard.close')}
      hideClose
    >
      <InspectorTextField
        label={tr('engine.inspector.dashboard.label')}
        value={labelValue}
        onCommit={(v) => onPatch({ label: v })}
        placeholder={tr('engine.inspector.dashboard.labelPlaceholder')}
        disabled={readOnly}
      />
      <InspectorTextField
        label={tr('engine.inspector.dashboard.description')}
        value={descriptionValue}
        onCommit={(v) => onPatch({ description: v })}
        placeholder={tr('engine.inspector.dashboard.descriptionPlaceholder')}
        disabled={readOnly}
      />

      <div className="border-t pt-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">
            {tr('engine.inspector.dashboard.widgets')}
          </Label>
          <Badge variant="outline" className="text-[10px]">
            {widgets.length}
          </Badge>
        </div>

        {widgets.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 px-3 py-3 text-center text-[11px] text-muted-foreground">
            {tr('engine.inspector.dashboard.widgetsEmpty')}
          </p>
        ) : (
          <div className="space-y-1">
            {widgets.map((w, i) => {
              const meta = WIDGET_TYPE_META[w?.type as string];
              const Icon = meta?.icon ?? UnknownWidgetIcon;
              const showDropLine =
                overIndex === i && dragIndex !== null && dragIndex !== i;
              const shownTitle = resolveInlineI18nLabel(displayWidgetTitle(w, servedWidgets), locale);
              return (
                <div
                  key={w?.id ?? i}
                  draggable={!readOnly}
                  onDragStart={() => setDragIndex(i)}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setOverIndex(i);
                  }}
                  onDrop={() => {
                    if (dragIndex != null && dragIndex !== i) moveWidget(dragIndex, i);
                    setDragIndex(null);
                    setOverIndex(null);
                  }}
                  className={
                    'group flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs hover:bg-accent' +
                    (showDropLine ? ' border-primary' : '')
                  }
                >
                  {!readOnly && (
                    <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" />
                  )}
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left font-medium"
                    onClick={() => selectWidget(w, i)}
                    title={shownTitle || w?.id}
                  >
                    {shownTitle ||
                      w?.id ||
                      tFormat('engine.inspector.widget.untitledN', locale, { n: i + 1 })}
                  </button>
                  {/* The widget's KIND in the designer's language — the name
                      the add-widget picker shows for it (objectui#11659), not
                      the stored `type` id (`bar`). The id stays on hover for
                      authors. A type the catalogue does not know has no name
                      to show, so it prints its id as before. */}
                  <span
                    className="shrink-0 text-[10px] text-muted-foreground"
                    title={w?.type}
                    data-widget-kind={w?.type}
                  >
                    {meta ? tr(meta.labelKey) : w?.type}
                  </span>
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 shrink-0 p-0 opacity-0 group-hover:opacity-100"
                      onClick={() => removeWidget(i)}
                      title={tr('engine.inspector.dashboard.removeWidget')}
                      aria-label={tr('engine.inspector.dashboard.removeWidget')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!readOnly && (
          <AddWidgetPicker
            onAdd={addWidget}
            label={tr('engine.inspector.add.widget')}
          />
        )}
      </div>

      <div className="border-t pt-3">
        {schema ? (
          <SchemaForm
            schema={schema}
            form={form}
            value={draft}
            hiddenFields={['name', 'label', 'description', 'widgets']}
            readOnly={readOnly}
            onChange={(next) => onPatch(next)}
          />
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {tr('engine.inspector.dashboard.noSchema')}
          </p>
        )}
      </div>
    </InspectorShell>
  );
}
