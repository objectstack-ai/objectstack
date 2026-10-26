// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DashboardWidgetInspector — scoped property panel for the widget
 * selected inside <DashboardPreview>.
 *
 * Renders the per-widget form (title / type / data source / KPI value
 * / aggregate / color / layout size) for the widget identified by
 * `selection.id`. Patches are written back into `draft.widgets[i]`
 * (immutably) and emitted via `onPatch`, so live preview updates
 * instantly on the left side.
 *
 * The shape mirrors the WidgetPropertyPanel that ships in
 * @object-ui/plugin-designer's DashboardEditor — same fields, same
 * defaults, same enums — so users familiar with the standalone
 * designer feel at home here.
 */

import * as React from 'react';
import { ColorVariantPicker } from '../color-variant-field.js';
import { X } from 'lucide-react';
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import type { DashboardWidgetSchema, DashboardWidgetTypeName } from '@object-ui/types';
import { completeWidgetLayout, defaultWidgetPlacement } from '@object-ui/types';
import { resolveDashboardFilterDefs, type DashboardFilterDef, type RegistryComponentMeta } from '@object-ui/core';
import type { MetadataInspectorProps } from '../inspector-registry.js';
import { t, tFormat } from '../i18n.js';
// The spec's `I18nLabel` resolver (new in @objectstack/spec 17.0.0-rc.6),
// aliased apart from objectui's same-named translation-KEY resolver.
import { resolveI18nLabel as resolveInlineI18nLabel } from '@objectstack/spec/ui';
// The WRITE-side twin of that resolver (objectui#5301) — see the Title field.
import { setLocalized } from '@object-ui/i18n';
import { InspectorCheckboxField, InspectorReorderButtons, moveArray } from './_shared.js';
import { InspectorComboField, type InspectorComboOption } from './InspectorComboField.js';
import {
  DatasetNamesEditor,
  datasetDimensionOptions,
  datasetMeasureOptions,
  datasetPickerOptions,
} from './ReportDefaultInspector.js';
import { useDatasetCatalog, useDatasetSemantics } from '../previews/useDatasetCatalog.js';
import type { ObjectFieldInfo } from '../previews/useObjectFields.js';
import { widgetMissingInputs } from '../../studio-design/metadataError.js';

// ADR-0021: dashboard widgets author the semantic-layer dataset shape only
// (dataset + dimensions + values). The pre-ADR-0021 inline single-object query
// (object / valueField / categoryField / aggregate) was removed from the spec
// at @objectstack/spec 9.0.0 and is no longer authored here — its fields are
// gone so no Studio surface can emit the dead shape (framework#3251).
/**
 * The widget families this inspector offers. TYPED to `DashboardWidgetTypeName`
 * (objectui#4600, which closed the widget `type` vocabulary) so the inspector
 * cannot offer a type validation refuses — every entry here is a spec
 * visualization family. A hand-written SUBSET is fine; offering something
 * outside the vocabulary is not.
 *
 * Each label is a catalogue key, resolved in the designer locale at render
 * (objectui#10748, the objectui#10586 `KeyedOption` shape); the stored `value`
 * never moves.
 */
const WIDGET_TYPES: ReadonlyArray<{ value: DashboardWidgetTypeName; labelKey: string }> = [
  { value: 'metric', labelKey: 'engine.inspector.widget.type.metric' },
  { value: 'bar', labelKey: 'engine.inspector.widget.type.bar' },
  { value: 'horizontal-bar', labelKey: 'engine.inspector.widget.type.horizontalBar' },
  { value: 'line', labelKey: 'engine.inspector.widget.type.line' },
  { value: 'area', labelKey: 'engine.inspector.widget.type.area' },
  { value: 'pie', labelKey: 'engine.inspector.widget.type.pie' },
  { value: 'donut', labelKey: 'engine.inspector.widget.type.donut' },
  { value: 'funnel', labelKey: 'engine.inspector.widget.type.funnel' },
  { value: 'table', labelKey: 'engine.inspector.widget.type.table' },
  { value: 'pivot', labelKey: 'engine.inspector.widget.type.pivot' },
];

const COLORS = [
  'default',
  'blue',
  'teal',
  'orange',
  'purple',
  'success',
  'warning',
  'danger',
];

function findWidget(
  draft: Record<string, unknown>,
  id: string,
): { widget: DashboardWidgetSchema; index: number } | null {
  const widgets = Array.isArray((draft as any).widgets)
    ? ((draft as any).widgets as DashboardWidgetSchema[])
    : [];
  const index = widgets.findIndex((w) => w?.id === id);
  if (index < 0) return null;
  return { widget: widgets[index], index };
}

export function DashboardWidgetInspector({
  draft,
  selection,
  onPatch,
  onClearSelection,
  onSelectionChange,
  readOnly,
  locale,
}: MetadataInspectorProps) {
  const widgetsAll = Array.isArray((draft as any).widgets)
    ? ((draft as any).widgets as DashboardWidgetSchema[])
    : [];
  const selId = selection.kind === 'widget' ? selection.id : undefined;
  const hit = selId ? findWidget(draft, selId) : null;

  // ── Dataset binding (ADR-0021) ──────────────────────────────────────────
  // Field access goes through `as any`: the bundled `@object-ui/types`
  // `DashboardWidgetSchema` only gains `dataset`/`dimensions`/`values` once
  // objectui bumps `@objectstack/spec`. Same accessor pattern as DatasetWidget.
  const w = (hit?.widget ?? {}) as any;
  const datasetName = typeof w.dataset === 'string' ? (w.dataset as string) : '';
  const dimensions: string[] = Array.isArray(w.dimensions)
    ? (w.dimensions as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];
  const values: string[] = Array.isArray(w.values)
    ? (w.values as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  // Catalog — called unconditionally (stable hook order) BEFORE any early
  // return, so the dataset / dimensions / values pickers below bind to the
  // live schema instead of free-text the author has to recall.
  const catalog = useDatasetCatalog();
  const semantics = useDatasetSemantics(datasetName || undefined, catalog);

  // objectui#11161 — the options read the author's text in the one form the
  // Report inspector's pickers share (see `datasetPickerOptions` and its
  // siblings): a dataset's declared `description` rides as the combo's muted
  // `hint`, a member's `label` beside its name. The stored value is the name.
  const datasetComboOptions: InspectorComboOption[] = React.useMemo(() => {
    const opts: InspectorComboOption[] = datasetPickerOptions(catalog.datasets);
    if (datasetName && !opts.some((o) => o.value === datasetName)) {
      opts.push({ value: datasetName, label: datasetName });
    }
    return opts;
  }, [catalog.datasets, datasetName]);
  const measureOptions: ObjectFieldInfo[] = React.useMemo(
    () => datasetMeasureOptions(semantics.measures),
    [semantics.measures],
  );
  const dimensionOptions: ObjectFieldInfo[] = React.useMemo(
    () => datasetDimensionOptions(semantics.dimensions),
    [semantics.dimensions],
  );
  // Filter-binding field picker options come from the bound dataset's
  // dimensions (the fields a widget filter can target), replacing the removed
  // object-field source. The combo prints the value (the dimension name)
  // itself, so the label is the author's text alone.
  const fieldComboOptions: InspectorComboOption[] = React.useMemo(
    () => semantics.dimensions.map((d) => ({ value: d.name, label: d.label ?? d.name, hint: d.type })),
    [semantics.dimensions],
  );

  // ── Dashboard filter bindings (framework#2501) ─────────────────────────
  // The dashboard's own dateRange + globalFilters declarations, normalized
  // to the same flat def list the runtime broadcasts from — so the editor
  // offers exactly the filters the renderer will apply.
  const filterDefs: DashboardFilterDef[] = React.useMemo(
    () =>
      resolveDashboardFilterDefs({
        globalFilters: (draft as any).globalFilters,
        dateRange: (draft as any).dateRange,
      }),
    [draft],
  );

  if (selection.kind !== 'widget') {
    return (
      <InspectorEmpty
        message={tFormat('engine.inspector.widget.unsupportedSelection', locale, { kind: selection.kind })}
        onClose={onClearSelection}
        locale={locale}
      />
    );
  }
  if (!hit) {
    return (
      <InspectorEmpty
        message={t('engine.inspector.widget.removed', locale)}
        onClose={onClearSelection}
        locale={locale}
      />
    );
  }

  const { widget, index } = hit;
  // The box the grid auto-places this widget in, and the widget's layout
  // completed against it — what the width / height inputs show and write.
  const placement = defaultWidgetPlacement(index);
  const layout = completeWidgetLayout(widget.layout, {}, placement);
  // objectui#11910 — the binding inputs this widget leaves out that the spec
  // refuses it without, while that is all it lacks: what holds Studio's
  // autosave of the dashboard (and what the server refuses), so each says so
  // under its input.
  const heldInputs = new Set(widgetMissingInputs(widget));
  const heldHint = (key: string) =>
    heldInputs.has(key) ? (
      <p data-testid={`widget-field-held-hint-${key}`} className="text-[11px] leading-snug text-muted-foreground">
        {t('engine.studio.held.inputHint', locale)}
      </p>
    ) : null;

  function patchWidget(updates: Partial<DashboardWidgetSchema>) {
    const widgets = [...widgetsAll];
    widgets[index] = { ...widgets[index], ...updates };
    onPatch({ widgets });
  }

  function moveWidget(to: number) {
    onPatch({ widgets: moveArray(widgetsAll, index, to) });
    if (widget.id) {
      onSelectionChange?.({
        kind: 'widget',
        id: widget.id,
        label: resolveInlineI18nLabel(widget.title, locale),
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t('engine.inspector.widget.kind', locale)}
          </div>
          <div className="truncate text-sm font-semibold">
            {resolveInlineI18nLabel(widget.title, locale) ||
              selection.label ||
              tFormat('engine.inspector.widget.untitledN', locale, { n: index + 1 })}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <InspectorReorderButtons
            index={index}
            total={widgetsAll.length}
            onMove={moveWidget}
            upLabel={t('engine.inspector.reorder.up', locale)}
            downLabel={t('engine.inspector.reorder.down', locale)}
            disabled={readOnly}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            onClick={onClearSelection}
            title={t('engine.inspector.widget.close', locale)}
            aria-label={t('engine.inspector.widget.close', locale)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* The ONE authoring — not display — read of `widget.title`, and the only
          site in this inspector where following the `I18nLabel` widening
          mechanically would destroy data. `I18nLabel` admits an inline
          per-locale map and this is a single-line text input, so the read and
          the write are two different rules:

            READ  the spec's `resolveI18nLabel` — the producer's own resolution
                  order, which objectui#4163's ruling requires this package to
                  call rather than hand-roll.
            WRITE `setLocalized` from `@object-ui/i18n` — replace ONLY the
                  active locale's entry, carry every other locale across
                  untouched (objectui#5301's maintainer ruling, 2026-08-20).

          Pairing a spec-side read with an objectui-side write is safe because
          the two resolvers are held limb for limb by
          `@object-ui/plugin-list`'s `src/__tests__/i18nLabel-resolver-parity.test.ts`
          (they differ only in how each spells a MISS, and `setLocalized` always
          produces a hit for the locale it wrote), and `setLocalized`'s write key
          follows the first three of those limbs exactly. Pinned locally by the
          round-trip assertions in `DashboardWidgetInspector.test.tsx` so the
          transfer is checked here, not merely cited.

          This input used to be READ-ONLY for a map-valued title, justified by
          "nothing in any corpus can hit this path yet — `I18nLabel` was plain
          `string` through 17.0.0-rc.5". `@objectstack/spec` is pinned at 17.0.0,
          so a stored map is reachable and that justification has expired; what
          the branch did in practice was deny an author the ability to edit a
          title in their own locale. Authoring EVERY locale from one panel is a
          different, still-open product question — deliberately not deferred to
          a tracker here, because the deferral this replaced named objectui#4163
          part 2 and #4163 closed as completed on 2026-08-15 with the
          placeholder still in the tree. */}
      <Field id="widget-title" label={t('engine.inspector.widget.title', locale)}>
        <Input
          id="widget-title"
          value={resolveInlineI18nLabel(widget.title, locale) ?? ''}
          onChange={(e) =>
            patchWidget({
              // Never `{ title: e.target.value }` — that is the flattening
              // write. The cast states the contract `setLocalized` widens for
              // its own callers: it carries non-string entries across untouched
              // so its map limb is `Record<string, unknown>`, while a stored
              // title that parses as `I18nLabel` has string entries only and the
              // entry written here is `e.target.value`.
              title: setLocalized(widget.title, locale, e.target.value) as DashboardWidgetSchema['title'],
            })
          }
          disabled={readOnly}
        />
      </Field>

      <Field id="widget-type" label={t('engine.inspector.widget.type', locale)}>
        <Select
          value={widget.type ?? 'metric'}
          onValueChange={(v) => {
            // Resolve the Select's string against the list that rendered the
            // items rather than casting it onto the closed type — a value not in
            // the palette writes nothing instead of storing a `type` the
            // platform refuses at publish.
            const picked = WIDGET_TYPES.find((wt) => wt.value === v);
            if (picked) patchWidget({ type: picked.value });
          }}
          disabled={readOnly}
        >
          <SelectTrigger id="widget-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WIDGET_TYPES.map((wt) => (
              <SelectItem key={wt.value} value={wt.value}>
                {t(wt.labelKey, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* Dataset binding (ADR-0021) — the single author-facing analytics
          shape. The widget binds a governed cross-object `dataset` and selects
          its dimensions/measures by name; DashboardRenderer renders it via
          <DatasetWidget> (consistent numbers, cross-object, RLS-enforced). */}
      <div className="space-y-3 rounded-md border p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t('engine.inspector.widget.datasetSection', locale)}
        </div>
        <Field id="widget-dataset" label={t('engine.inspector.widget.dataset', locale)}>
          <InspectorComboField
            // `Field` above renders `<Label htmlFor="widget-dataset">`; the id
            // has to reach the trigger or that `for` dangles (objectui#3997).
            // Every other `Field` in this file already hands its id to the
            // control it wraps (`Input id`, `SelectTrigger id`) — this one could
            // not, because the combo took no id at all.
            id="widget-dataset"
            value={datasetName}
            onCommit={(v) => patchWidget({ dataset: v || undefined } as Partial<DashboardWidgetSchema>)}
            options={datasetComboOptions}
            loading={catalog.loading}
            placeholder={t('engine.inspector.widget.datasetPlaceholder', locale)}
            searchPlaceholder={t('engine.inspector.widget.datasetPlaceholder', locale)}
            disabled={readOnly}
            mono
          />
          {heldHint('dataset')}
          <p className="text-[10px] leading-snug text-muted-foreground">
            {t('engine.inspector.widget.datasetHint', locale)}
          </p>
        </Field>
        {datasetName && (
          <>
            {/* Dimensions / measures picked from the bound dataset's semantic
                layer (reorderable, add-from-catalog) — same control the Report
                inspector uses — instead of comma-separated free text. */}
            <DatasetNamesEditor
              label={t('engine.inspector.widget.dimensions', locale)}
              emptyText={t('engine.inspector.widget.dimensionsHint', locale)}
              names={dimensions}
              options={dimensionOptions}
              loading={semantics.loading}
              error={semantics.error}
              readOnly={readOnly}
              onCommit={(next) => patchWidget({ dimensions: next } as Partial<DashboardWidgetSchema>)}
            />
            {heldHint('dimensions')}
            <DatasetNamesEditor
              label={t('engine.inspector.widget.values', locale)}
              emptyText={t('engine.inspector.widget.valuesHint', locale)}
              names={values}
              options={measureOptions}
              loading={semantics.loading}
              error={semantics.error}
              readOnly={readOnly}
              onCommit={(next) => patchWidget({ values: next } as Partial<DashboardWidgetSchema>)}
            />
            {heldHint('values')}
          </>
        )}
      </div>

      {/* Dashboard filter bindings (framework#2501) — one row per dashboard
          filter: an Apply toggle (unchecked writes `false` = opt out) and a
          field picker re-targeting the filter to THIS widget's field (empty =
          default: the filter's own field). Only rendered when the dashboard
          declares filters. */}
      {filterDefs.length > 0 && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('engine.inspector.widget.filterBindingsSection', locale)}
          </div>
          <p className="text-[10px] leading-snug text-muted-foreground">
            {t('engine.inspector.widget.filterBindingsHint', locale)}
          </p>
          {filterDefs.map((def) => {
            const bindings = (widget as any).filterBindings as
              | Record<string, string | false>
              | undefined;
            const binding = bindings?.[def.name];
            const optedOut = binding === false;
            const override = typeof binding === 'string' ? binding : '';
            const setBinding = (next: string | false | undefined) => {
              const current: Record<string, string | false> = { ...(bindings ?? {}) };
              if (next === undefined) delete current[def.name];
              else current[def.name] = next;
              patchWidget({
                filterBindings: Object.keys(current).length > 0 ? current : undefined,
              } as Partial<DashboardWidgetSchema>);
            };
            return (
              <div key={def.name} className="space-y-1.5" data-testid={`widget-filter-binding-${def.name}`}>
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs font-medium text-muted-foreground truncate">
                    {/* objectui#4032 — `DashboardFilterDef.label` widened to the
                        spec's `I18nLabel`, so this read (and the aria-label
                        below) resolve the inline per-locale map exactly as the
                        widget title above already does. Resolving BEFORE the
                        `||` also fixes the truthiness gate: an object is always
                        truthy, so a map that resolves to nothing never reached
                        `def.name`. */}
                    {resolveInlineI18nLabel(def.label, locale) || def.name}
                  </Label>
                  <InspectorCheckboxField
                    label={t('engine.inspector.widget.filterBindingApply', locale)}
                    value={!optedOut}
                    onCommit={(apply) => setBinding(apply ? undefined : false)}
                    disabled={readOnly}
                  />
                </div>
                {!optedOut && (
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <InspectorComboField
                        // The filter's name above is a heading for the whole row
                        // (it also captions the Apply checkbox) and disappears
                        // from the association when the row is opted out, so the
                        // trigger carries its own name rather than borrowing it
                        // (objectui#3997). Includes the filter name because a
                        // dashboard has several of these rows.
                        ariaLabel={tFormat('engine.inspector.widget.filterBindingField', locale, {
                          filter: resolveInlineI18nLabel(def.label, locale) || def.name,
                        })}
                        value={override}
                        onCommit={(v) => setBinding(v ? v : undefined)}
                        options={fieldComboOptions}
                        placeholder={tFormat('engine.inspector.widget.filterBindingDefault', locale, { field: def.field })}
                        searchPlaceholder={t('engine.form.searchFields', locale)}
                        disabled={readOnly}
                        mono
                      />
                    </div>
                    {override && !readOnly && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 shrink-0 px-2 text-[10px] text-muted-foreground"
                        onClick={() => setBinding(undefined)}
                      >
                        {t('engine.inspector.widget.filterBindingReset', locale)}
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Field id="widget-color" labelling="group" label={t('engine.inspector.widget.color', locale)}>
        <ColorVariantPicker
          // The visible label above ("Color Variant") names the swatch group by
          // IDREF, and is the only naming channel: the group carries no `id`
          // for a `for` to aim at, because `role="radiogroup"` cannot be
          // labelled that way (objectui#4010).
          ariaLabelledBy={groupLabelId('widget-color')}
          value={widget.colorVariant ?? 'default'}
          onChange={(v) => patchWidget({ colorVariant: v as DashboardWidgetSchema['colorVariant'] })}
          disabled={readOnly}
          options={COLORS.map((c) => ({ value: c }))}
        />
      </Field>

      {/*
        Width and height each edit ONE dimension of the spec's four-number
        `layout`, so both go through `completeWidgetLayout` (objectui#11388):
        on a widget with no `layout` the untouched coordinates come from the
        grid's auto-placement for this widget's index, and the stored box is
        whole. Spreading the one number onto an absent box stored `{ w }`, which
        the spec refuses. Both inputs SHOW the same completed box, so the
        dimension an edit leaves alone is the one on screen. The preview grid
        computes no `x` / `y` this inspector can read, so it seeds from
        `defaultWidgetPlacement`.
      */}
      <div className="grid grid-cols-2 gap-3">
        <Field id="widget-w" label={t('engine.inspector.widget.width', locale)}>
          <Input
            id="widget-w"
            type="number"
            min={1}
            value={layout.w}
            onChange={(e) =>
              patchWidget({
                layout: completeWidgetLayout(widget.layout, { w: Number(e.target.value) || 1 }, placement),
              })
            }
            disabled={readOnly}
          />
        </Field>
        <Field id="widget-h" label={t('engine.inspector.widget.height', locale)}>
          <Input
            id="widget-h"
            type="number"
            min={1}
            value={layout.h}
            onChange={(e) =>
              patchWidget({
                layout: completeWidgetLayout(widget.layout, { h: Number(e.target.value) || 1 }, placement),
              })
            }
            disabled={readOnly}
          />
        </Field>
      </div>

      {!readOnly && (
        <div className="pt-2 border-t">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full text-destructive hover:text-destructive"
            onClick={() => {
              const widgets = Array.isArray((draft as any).widgets)
                ? ([...(draft as any).widgets] as DashboardWidgetSchema[])
                : [];
              widgets.splice(index, 1);
              onPatch({ widgets });
              onClearSelection();
            }}
          >
            {t('engine.inspector.widget.remove', locale)}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The id a `labelling="group"` field's `<Label>` publishes for its group to
 * reference. One function so the two halves of the IDREF — the label that emits
 * it and the control that answers it — cannot drift apart into two literals.
 */
const groupLabelId = (id: string) => `${id}-label`;

function Field({
  id,
  label,
  labelling = 'control',
  children,
}: {
  id: string;
  label: string;
  /**
   * How `label` is associated with the control (`RegistryComponentMeta.labelling`'s
   * vocabulary, objectui#3961/#4010):
   *
   *  - `'control'` (default) — the child is a LABELABLE element carrying this
   *    same `id` (`Input id`, `SelectTrigger id`, `InspectorComboField id`), so
   *    a plain `htmlFor` names it. Every other field in this panel is this.
   *  - `'group'` — the child is a container (`role="radiogroup"`) that no
   *    `<label for>` can name. The label publishes `groupLabelId(id)` instead
   *    and the child answers `aria-labelledby`. The `for` is not merely
   *    redundant here but must be ABSENT: aimed at a non-labelable element it
   *    names nothing, and aimed at this panel's `id` (which such a child never
   *    carries) it is a DANGLING IDREF — tooling reports an association that
   *    resolves to nothing, which is worse than an unnamed control because it
   *    reads as closed. That was objectui#4010's defect on `widget-color`.
   *
   * DERIVED from the repo-wide vocabulary, not a restatement of it: the 2026-08-17
   * ruling (objectui#4857 + objectui#4871) made `RegistryComponentMeta['labelling']` the
   * single answer to "how does a host learn what a widget will render" and
   * forbade host-local variants. `'display'` is excluded because this panel has
   * no such field — every one of its children is an editable control or a
   * container of them — and because it has no display CHANNEL to route one to;
   * introducing one is a compile error here rather than a silent degradation.
   * Re-spell a member in `packages/core` and this type stops compiling.
   */
  labelling?: Exclude<NonNullable<RegistryComponentMeta['labelling']>, 'display'>;
  children: React.ReactNode;
}) {
  const group = labelling === 'group';
  return (
    <div className="space-y-1.5">
      <Label
        // Exactly one channel — never a `for` beside an `aria-labelledby`.
        {...(group ? { id: groupLabelId(id) } : { htmlFor: id })}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

function InspectorEmpty({
  message,
  onClose,
  locale,
}: {
  message: string;
  onClose: () => void;
  locale: MetadataInspectorProps['locale'];
}) {
  return (
    <div className="space-y-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
      <p>{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onClose}>
        {t('engine.inspector.widget.close', locale)}
      </Button>
    </div>
  );
}
