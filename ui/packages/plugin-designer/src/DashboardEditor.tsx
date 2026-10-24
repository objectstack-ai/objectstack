/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * DashboardEditor Component
 *
 * Visual editor for DashboardSchema — grid layout with widget selection,
 * property editing, and drag-based reordering. Supports KPI, Chart, Table,
 * and custom widget types from the spec.
 *
 * Features:
 * - Undo/Redo via useUndoRedo hook (Ctrl+Z / Ctrl+Y)
 * - JSON Schema export/import
 * - Preview mode toggle
 * - Widget layout (w/h) editing
 * - i18n via useDesignerTranslation
 * - Keyboard shortcuts (Delete to remove selected)
 * - Mobile responsive layout
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import type {
  DashboardComponentSchema,
  DashboardWidgetSchema,
  DashboardWidgetSlotComponentSchema,
  DashboardWidgetTypeName,
} from '@object-ui/types';
import {
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  BarChart3,
  LineChart,
  PieChart,
  TrendingUp,
  Table2,
  X,
  Undo2,
  Redo2,
  Download,
  Upload,
  Eye,
  EyeOff,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@object-ui/components';
import { DASHBOARD_COMPONENT_WIDGET_TYPES, completeWidgetLayout, defaultWidgetPlacement } from '@object-ui/types';
import { DashboardWidgetSchema as DashboardWidgetDoor } from '@object-ui/types/zod';
import { pickLocalized, setLocalized } from '@object-ui/i18n';
import { useUndoRedo } from './hooks/useUndoRedo';
import { useDesignerTranslation } from './hooks/useDesignerTranslation';

function cn(...inputs: (string | undefined | false)[]) {
  return twMerge(clsx(inputs));
}

// ============================================================================
// Types
// ============================================================================

export interface DashboardEditorProps {
  /** Dashboard schema to edit */
  schema: DashboardComponentSchema;
  /** Callback when schema changes */
  onChange: (schema: DashboardComponentSchema) => void;
  /** Read-only mode */
  readOnly?: boolean;
  /** CSS class */
  className?: string;
  /** Callback when JSON is exported */
  onExport?: (schema: DashboardComponentSchema) => void;
  /** Callback when JSON is imported */
  onImport?: (schema: DashboardComponentSchema) => void;
  /** Externally controlled selected widget ID */
  selectedWidgetId?: string | null;
  /** Callback when widget selection changes (for external sync) */
  onWidgetSelect?: (widgetId: string | null) => void;
}

/**
 * One entry of `widgets[]`: the slot's element type, a widget or a component
 * node placed directly in the slot. Every read of an entry goes through it
 * (objectui#11514): the widget arm, `DashboardWidgetSchema`, names no component
 * type, so the component arm is not assignable to it.
 */
type DashboardWidgetEntry = DashboardComponentSchema['widgets'][number];

/**
 * Whether an entry is the slot's component arm (a `metric-card`): its `type`
 * is a member of the closed `DASHBOARD_COMPONENT_WIDGET_TYPES`, which no
 * widget `type` names (objectui#11483).
 *
 * A widget key (`values`, `dimensions`, `colorVariant`, …) is read on the
 * widget arm alone, so every such read below narrows with this first
 * (objectui#11598, N2 A): the component arm declares none of them, and reading
 * one off the entry whichever arm it was compiled only through `BaseSchema`'s
 * index signature, which objectui#8347 removed.
 *
 * The twin of plugin-dashboard's `isSlotComponentEntry` (`widgetDispatch.ts`),
 * which this package cannot import: it does not depend on plugin-dashboard
 * (the same reason `measureRefusal` below is a twin). Both read the one
 * closed list from `@object-ui/types`, so they cannot disagree on membership.
 */
function isSlotComponentEntry(entry: DashboardWidgetEntry): entry is DashboardWidgetSlotComponentSchema {
  return (DASHBOARD_COMPONENT_WIDGET_TYPES as readonly unknown[]).includes(entry.type);
}

// ============================================================================
// Constants
// ============================================================================

/**
 * The widget families this editor offers.
 *
 * TYPED to `DashboardWidgetTypeName` (objectui#4600): the palette must never
 * offer a type validation refuses, which is the "designer saves what the server
 * rejects" failure AGENTS.md #0.1 names. Before that card closed the widget
 * `type` vocabulary this array was inferred as `string[]`, and it had drifted —
 * it offered `grid`, which is neither a spec visualization family
 * (`ChartTypeSchema`) nor a member of objectui's own `DASHBOARD_WIDGET_TYPES`
 * (`@object-ui/types`' exported list for exactly this purpose, which
 * `WidgetConfigPanel` already derives its options from). A widget saved as
 * `type: 'grid'` resolved through `ComponentRegistry` to the VIEW grid — an
 * empty tile — and was refused at publish. Nothing pinned it: no test in this
 * package referenced it, and `PageDesigner`'s own `grid` palette entry is a
 * different surface and is untouched.
 *
 * This is a hand-written subset, not the full vocabulary — a designer may offer
 * fewer families than validation accepts. The direction that must hold is
 * SUBSET, and `@object-ui/types`' parity suite pins it.
 */
const WIDGET_TYPES: ReadonlyArray<{
  type: DashboardWidgetTypeName;
  label: string;
  Icon: typeof TrendingUp;
}> = [
  { type: 'metric', label: 'KPI Metric', Icon: TrendingUp },
  { type: 'bar', label: 'Bar Chart', Icon: BarChart3 },
  { type: 'line', label: 'Line Chart', Icon: LineChart },
  { type: 'pie', label: 'Pie Chart', Icon: PieChart },
  { type: 'table', label: 'Table', Icon: Table2 },
];

let widgetCounter = 0;

function createWidgetId(): string {
  widgetCounter += 1;
  return `widget_${Date.now()}_${widgetCounter}`;
}

// ============================================================================
// Widget title — display vs authoring
// ============================================================================

/**
 * Resolve `DashboardWidget.title` for DISPLAY.
 *
 * `@objectstack/spec` 17.0.0-rc.6 widened `I18nLabel` from `string` to
 * `string | Record<string, string>`, so a widget title may be an inline
 * per-locale map (`{ en: 'Pipeline', 'zh-CN': '销售漏斗' }`). Every read that
 * lands in a text node has to resolve it or React stringifies the object to
 * `[object Object]`.
 *
 * `pickLocalized` is objectui's render-side resolver for that vocabulary,
 * paired with the active UI language; `@objectstack/spec`'s own
 * `resolveI18nLabel` implements the same rule, and the two are held limb for
 * limb by `@object-ui/plugin-list`'s
 * `src/__tests__/i18nLabel-resolver-parity.test.ts` — so the designer's preview
 * of a dashboard and the runtime dashboard itself cannot start disagreeing
 * about which locale entry wins.
 *
 * This is the DISPLAY half of the title rule. The authoring INPUT resolves
 * through here too — it can only show one locale — but it must never write
 * back what it shows as the whole value; see `writeWidgetTitle` for the WRITE
 * half, and note that the two have to stay paired.
 */
function resolveWidgetTitle(
  title: DashboardWidgetSchema['title'],
  language: string | undefined,
): string {
  return pickLocalized(title, language);
}

/**
 * Write an edited title string back into `DashboardWidget.title` — the WRITE
 * half of the rule whose DISPLAY half is `resolveWidgetTitle`.
 *
 * A single-line input holds one locale's string, so writing `e.target.value`
 * back as the whole value collapses **every other locale** on the first
 * keystroke: an author who opened a dashboard to move a widget and happened to
 * focus the title field would silently destroy the translations. PR #4169 met
 * that on `DashboardWidgetInspector` by showing a map-valued title resolved and
 * **read-only**, and this file copied the branch.
 *
 * That branch could not lose data, but its stated justification has expired.
 * It read "nothing can reach this path from stored metadata yet — `I18nLabel`
 * was plain `string` through rc.5" while `resolveWidgetTitle` sixty lines above
 * documented the widening that makes a stored map reachable; `@objectstack/spec`
 * is pinned at 17.0.0, whose `I18nLabelSchema` is
 * `string | Record<string, string>`. Both could not hold. What the read-only
 * branch actually did from rc.6 onward was deny an author the ability to edit a
 * title in their own locale.
 *
 * objectui#5301's maintainer ruling (2026-08-20) settled the write rule for the
 * sibling surface — a save replaces only the active locale's entry and
 * preserves the others — and `@object-ui/i18n` ships it as `setLocalized`,
 * co-located with `pickLocalized` because the two must agree. Their pairing
 * (`pickLocalized(setLocalized(map, lang, s), lang) === s`) is pinned in
 * `@object-ui/i18n`'s `src/__tests__/setLocalized.test.ts`: an edit always
 * lands in the entry this panel displays, never in one it does not. The write
 * key follows only the first three resolution limbs (exact tag, base language,
 * region-qualified sibling) and stops — `default` / `en` / first-value are
 * DISPLAY fallbacks that hand back another locale's string, so an author
 * editing in `fr` against an English-only map ADDS `fr` instead of overwriting
 * `en`.
 *
 * ⚠️ Scope: this is the minimal non-destructive write for a single-locale
 * editor, not a multi-locale authoring UI — an author reaches only the entry
 * for the locale they are in. Authoring every locale from one panel remains an
 * open product question and is deliberately NOT filed against a tracker here:
 * the deferral this replaced named objectui#4163 part 2, #4163 closed as
 * completed on 2026-08-15 with the placeholder still in the tree, and a comment
 * pointing at a closed card is how the stale premise above survived a year.
 */
function writeWidgetTitle(
  title: DashboardWidgetSchema['title'],
  language: string | undefined,
  next: string,
): DashboardWidgetSchema['title'] {
  // `setLocalized` types its map result `Record<string, unknown>` because it
  // carries non-string entries across untouched rather than dropping them. A
  // stored title that parses as `I18nLabel` has string entries only, and the
  // one entry written here is `next` — so the cast states that contract at the
  // boundary rather than widening what this function returns.
  return setLocalized(title, language, next) as DashboardWidgetSchema['title'];
}

// ============================================================================
// Widget measures — what the widget door accepts (objectui#8894)
// ============================================================================

/**
 * The widget door's refusal of `widget`'s measures under `type`, or
 * `undefined` when it accepts them.
 *
 * A metric-family tile answers ONE number, and `@objectstack/spec` 17.5.0
 * refuses a second measure on it (ruling D on objectui#8894). This editor
 * authors no measures itself, but its type picker can turn a stored widget
 * that carries several (a `bar` over three measures) into a tile, which the
 * door then refuses at publish. So the picker asks the door before it offers a
 * type, and shows the door's message when the stored widget is already refused.
 *
 * The door is ASKED, never restated: objectui's `DashboardWidgetSchema` mirror
 * (`@object-ui/types/zod`) re-attaches the spec's own object-level checks, so no
 * widget-type list lives here and a further refusal the spec adds is followed
 * once the mirror attaches it. Only the keys a measure rule reads are probed,
 * each kept to a shape the door accepts: zod skips object-level checks once a
 * field-level issue aborts the parse, so an unrelated fault elsewhere in the
 * widget (a malformed `title`, say) must not hide the measure verdict.
 *
 * The same probe as plugin-dashboard's `measureRefusal` (`WidgetConfigPanel`'s
 * measure picker), which this package cannot import: it does not depend on
 * plugin-dashboard.
 */
function measureRefusal(widget: DashboardWidgetEntry, type: string | undefined): string | undefined {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  // The measures are widget keys, read on the widget arm alone: a component
  // node in the slot carries none, so it is probed with none (objectui#11598).
  const measures = isSlotComponentEntry(widget) ? undefined : widget;
  const dimensions = measures?.dimensions;
  const probe = {
    ...(typeof widget.id === 'string' ? { id: widget.id } : {}),
    ...(type ? { type } : {}),
    values: strings(measures?.values),
    ...(Array.isArray(dimensions) ? { dimensions: strings(dimensions) } : {}),
  };
  const result = DashboardWidgetDoor.safeParse(probe);
  if (result.success) return undefined;
  return result.error.issues.find(
    (issue) => issue.code === 'custom' && issue.path.length === 1 && issue.path[0] === 'values',
  )?.message;
}

// ============================================================================
// Widget Card
// ============================================================================

interface WidgetCardProps {
  widget: DashboardWidgetEntry;
  index: number;
  total: number;
  selected: boolean;
  readOnly: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function WidgetCard({
  widget,
  index,
  total,
  selected,
  readOnly,
  onSelect,
  onRemove,
  onMoveUp,
  onMoveDown,
}: WidgetCardProps) {
  const wType = widget.type || 'metric';
  const meta = WIDGET_TYPES.find((t) => t.type === wType) || WIDGET_TYPES[0];
  const { language } = useDesignerTranslation();
  // DISPLAY read of `widget.title` — see `resolveWidgetTitle`.
  const title = resolveWidgetTitle(widget.title, language);

  return (
    <div
      data-testid={`dashboard-widget-${widget.id}`}
      onClick={onSelect}
      className={cn(
        'group cursor-pointer rounded-lg border-2 p-3 transition-colors',
        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-gray-300" />
          <meta.Icon className="h-4 w-4 text-gray-500" />
          <span className="text-sm font-medium text-gray-800">
            {title || `Widget ${index + 1}`}
          </span>
        </div>

        {!readOnly && (
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
              disabled={index === 0}
              className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
              aria-label="Move up"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
              disabled={index === total - 1}
              className="rounded p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
              aria-label="Move down"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRemove(); }}
              className="rounded p-0.5 text-gray-400 hover:text-red-500"
              aria-label="Remove widget"
              data-testid={`dashboard-widget-remove-${widget.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-2">
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
          {meta.label}
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// Widget Property Panel
// ============================================================================

/**
 * The colour variants the panel offers, in the order the native control
 * listed them. TYPED to the widget's own `colorVariant`, so a pick reaches
 * `onChange` as that type with no cast of a DOM string.
 */
const COLOR_VARIANTS: ReadonlyArray<{
  value: NonNullable<DashboardWidgetSchema['colorVariant']>;
  label: string;
}> = [
  { value: 'default', label: 'Default' },
  { value: 'blue', label: 'Blue' },
  { value: 'teal', label: 'Teal' },
  { value: 'orange', label: 'Orange' },
  { value: 'purple', label: 'Purple' },
  { value: 'success', label: 'Success' },
  { value: 'warning', label: 'Warning' },
  { value: 'danger', label: 'Danger' },
];

/** The item a stored value none of a picker's options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/** The classes a picker takes, at the size of the inputs beside it. */
const PICKER = 'h-auto border-gray-300 px-2.5 py-1.5 text-sm';

/**
 * objectui#11865 — one of the property panel's pickers (the widget's type and
 * its colour variant), drawn with the shared `Select`, the control the rest of
 * the console picks with. They used to be browser-native `<select>`s. What a
 * pick writes is unchanged: `onPick` receives the picked option's own `value`,
 * the string the native control's `change` carried, and each caller turns it
 * into the same `onChange` update as before. Re-picking the current option
 * writes nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value, so the picked option is
 *   resolved against the very list that rendered the items, and no option
 *   value can collide with the outside item below.
 * - An option may be `disabled`, as a native `<option>` was: the type picker
 *   disables the types the widget door refuses this widget's measures under.
 * - A stored value none of the options carries gets an item of its own,
 *   labelled with the value, so the trigger shows what the widget holds (a
 *   stored `area`, a `metric-card` entry). The native control showed its first
 *   option there ("KPI Metric", "Default"), which is not what the widget says.
 *   Picking that item writes nothing. An empty value gets no such item: the
 *   trigger shows nothing.
 * - Read-only follows the primitive (objectui#11781): `disabled` disables the
 *   trigger, which wears `SelectTrigger`'s own disabled look.
 * - `id` lands on the trigger, so the caller's `<label htmlFor>` names it as it
 *   named the native control.
 */
function WidgetPropPicker<V extends string>({
  id,
  testId,
  value,
  options,
  onPick,
  disabled,
}: {
  id: string;
  testId: string;
  value: string;
  options: ReadonlyArray<{ value: V; label: string; disabled?: boolean }>;
  onPick: (value: V) => void;
  disabled: boolean;
}) {
  const at = options.findIndex((o) => o.value === value);
  const outside = at === -1 && value !== '';
  return (
    <Select
      value={at !== -1 ? String(at) : outside ? OUTSIDE_OPTIONS : ''}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the stored value, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} data-testid={testId} className={PICKER}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {outside && (
          <SelectItem value={OUTSIDE_OPTIONS} data-option-value={value}>
            {value}
          </SelectItem>
        )}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)} disabled={o.disabled} data-option-value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface WidgetPropertyPanelProps {
  widget: DashboardWidgetEntry;
  /** The widget's position in `widgets[]`, which the grid auto-places it by. */
  index: number;
  readOnly: boolean;
  onChange: (updates: Partial<DashboardWidgetSchema>) => void;
  onClose: () => void;
}

function WidgetPropertyPanel({
  widget,
  index,
  readOnly,
  onChange,
  onClose,
}: WidgetPropertyPanelProps) {
  const { t, language } = useDesignerTranslation();
  // Width and height each edit ONE dimension of the spec's four-number
  // `layout`, so both go through `completeWidgetLayout` (objectui#11388): on a
  // widget with no `layout` the untouched coordinates come from the grid's
  // auto-placement for this widget's index, and the stored box is whole.
  // Spreading the one number onto an absent box stored `{ w }`, which the spec
  // refuses. Both inputs SHOW the same completed box. This editor's own grid
  // places widgets by array order and computes no `x` / `y`, so it seeds from
  // `defaultWidgetPlacement`.
  const placement = defaultWidgetPlacement(index);
  const layout = completeWidgetLayout(widget.layout, {}, placement);
  // What the title input SHOWS: the active locale's entry. What a keystroke
  // WRITES is `writeWidgetTitle` — never this resolved string as a whole value.
  const titleDisplay = resolveWidgetTitle(widget.title, language);
  // The type picker offers only the types the widget door accepts this
  // widget's measures under, and shows the door's refusal when the widget as
  // stored is already refused — see `measureRefusal` (objectui#8894). The
  // widget's own current type stays selectable either way, so a refused stored
  // widget still shows what it is.
  const currentType = widget.type ?? 'metric';
  const refusedUnder = (type: string) => measureRefusal(widget, type) !== undefined;
  const currentRefusal = measureRefusal(widget, widget.type);
  // The widget arm, or `undefined` for a component node in the slot (a
  // `metric-card`), which declares no widget key: the widget-only fields below
  // are offered on the widget arm alone (objectui#11598, N2 A).
  const widgetArm = isSlotComponentEntry(widget) ? undefined : widget;
  return (
    <div
      data-testid="widget-property-panel"
      className="shrink-0 space-y-4 rounded-lg border border-gray-200 bg-white p-4"
    >
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-800">{t('appDesigner.widgetProperties')}</h4>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-gray-400 hover:text-gray-600"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Title — the ONE authoring (not display) read of `widget.title`, and the
          only place where following the `I18nLabel` widening mechanically would
          destroy data. A stored title may be an inline per-locale map and this
          is a single-line input, so the read and the write are two different
          rules and both come from `@object-ui/i18n`:

            READ  `pickLocalized` (via `resolveWidgetTitle`) — show the active
                  locale's entry.
            WRITE `setLocalized` (via `writeWidgetTitle`) — replace ONLY that
                  entry; every other locale is carried across untouched.

          The input is no longer read-only for a map-valued title (objectui#5301's
          ruling made the write rule available); authoring every locale from this
          panel is a separate, still-open question — see `writeWidgetTitle`. */}
      <div className="space-y-1">
        <label htmlFor="widget-title" className="text-xs font-medium text-gray-600">Title</label>
        <input
          id="widget-title"
          data-testid="widget-prop-title"
          type="text"
          value={titleDisplay}
          onChange={(e) => {
            // Never `{ title: e.target.value }`: that is the flattening write
            // that replaces an inline locale map with one locale's string.
            onChange({ title: writeWidgetTitle(widget.title, language, e.target.value) });
          }}
          disabled={readOnly}
          className="block w-full rounded-md border border-gray-300 px-2.5 py-1.5 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
        />
      </div>

      {/* Type */}
      <div className="space-y-1">
        <label htmlFor="widget-type" className="text-xs font-medium text-gray-600">Type</label>
        <WidgetPropPicker
          id="widget-type"
          testId="widget-prop-type"
          value={currentType}
          options={WIDGET_TYPES.map((t) => ({
            value: t.type,
            label: t.label,
            disabled: t.type !== currentType && refusedUnder(t.type),
          }))}
          onPick={(type) => {
            // The picker resolves its item against the very list that rendered
            // the options, so the type arrives typed off the palette, never as a
            // cast DOM string: a value not in the palette writes nothing at all,
            // instead of storing a `type` the platform refuses at publish.
            // A type the door refuses this widget's measures under writes
            // nothing either (objectui#8894): its item is disabled, and this
            // keeps any other route to it from storing what publish refuses.
            if (type === currentType || !refusedUnder(type)) onChange({ type });
          }}
          disabled={readOnly}
        />
        {currentRefusal && (
          <p role="alert" data-testid="widget-prop-measure-refusal" className="break-words text-xs text-red-600">
            {currentRefusal}
          </p>
        )}
      </div>

      {/* Analytics binding (data source / dimensions / measures) is authored via
          the dataset picker in app-shell's DashboardWidgetInspector / plugin-
          dashboard's WidgetConfigPanel. The pre-ADR-0021 inline object /
          valueField / aggregate fields were retired in framework#3320. */}

      {/* Color variant — a widget key, so offered on the widget arm alone
          (objectui#11598, N2 A). A `metric-card` declares no `colorVariant`:
          the strict face refuses one on the card and `MetricCard` draws
          nothing from it, so offering the select there could only store a key
          publish refuses (AGENTS.md #0.1). */}
      {widgetArm && (
        <div className="space-y-1">
          <label htmlFor="widget-color" className="text-xs font-medium text-gray-600">Color Variant</label>
          <WidgetPropPicker
            id="widget-color"
            testId="widget-prop-color"
            value={widgetArm.colorVariant ?? 'default'}
            options={COLOR_VARIANTS}
            onPick={(colorVariant) => onChange({ colorVariant })}
            disabled={readOnly}
          />
        </div>
      )}

      {/* Widget size */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-gray-600">{t('appDesigner.widgetLayoutSize')}</label>
        <div className="flex gap-2">
          <div className="flex-1">
            <label htmlFor="widget-width" className="text-[10px] text-gray-400">{t('appDesigner.widgetWidth')}</label>
            <input
              id="widget-width"
              data-testid="widget-prop-width"
              type="number"
              min={1}
              value={layout.w}
              onChange={(e) => onChange({ layout: completeWidgetLayout(widget.layout, { w: Number(e.target.value) || 1 }, placement) })}
              disabled={readOnly}
              className="block w-full rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>
          <div className="flex-1">
            <label htmlFor="widget-height" className="text-[10px] text-gray-400">{t('appDesigner.widgetHeight')}</label>
            <input
              id="widget-height"
              data-testid="widget-prop-height"
              type="number"
              min={1}
              value={layout.h}
              onChange={(e) => onChange({ layout: completeWidgetLayout(widget.layout, { h: Number(e.target.value) || 1 }, placement) })}
              disabled={readOnly}
              className="block w-full rounded-md border border-gray-300 px-2 py-1 text-sm outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:bg-gray-50"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Preview Panel
// ============================================================================

function DashboardPreview({ schema }: { schema: DashboardComponentSchema }) {
  const { t, language } = useDesignerTranslation();
  // Typed by the slot's element type, `DashboardWidgetEntry` (objectui#11514),
  // the same type `WidgetCard` takes: the card below reads `title`, which both
  // arms of the `widgets[]` union declare (the widget arm's spec row, and the
  // component arm's card heading).
  const widgets: DashboardWidgetEntry[] = schema.widgets || [];
  return (
    <div data-testid="dashboard-preview" className="rounded-lg border border-gray-200 bg-gray-50 p-4">
      {/*
        `schema.label` is the ONLY dashboard-name source here. A legacy root
        `title` used to be read instead; that arm RETIRED under ADR-0049
        (objectui#7509, maintainer ruling 2026-09-04) together with the four
        sibling root arms in `DashboardView`, `DashboardRenderer`,
        `DashboardGridLayout` and `DashboardDesignPage`, so the designer and the
        console can no longer disagree about one stored document's header.
        @objectstack/spec's `DashboardSchema` refuses root `title` BY NAME
        (`unrecognized_keys(title)`) and requires `label`.

        Resolved with `pickLocalized` because `label` is the spec's `I18nLabel`
        (objectui#4580) — the same resolver `resolveWidgetTitle` above uses, so
        this component keeps ONE locale channel. A miss yields `''`, which is
        falsy, so the generic heading still backstops it.

        ⛔ NOT the widget arm: `widget.title` is `DashboardWidget.title`, a
        different DECLARED key, read through `resolveWidgetTitle` and untouched.
        Root and widget arms are told apart by RECEIVER — this receiver is the
        dashboard ROOT.
      */}
      <h4 className="mb-3 text-sm font-semibold text-gray-700">{pickLocalized(schema.label, language) || t('appDesigner.dashboardPreview')}</h4>
      {widgets.length === 0 ? (
        <div className="text-xs text-gray-400">{t('appDesigner.noWidgetsPreview')}</div>
      ) : (
        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: `repeat(${schema.columns ?? 2}, 1fr)` }}
        >
          {widgets.map((w) => {
            const meta = WIDGET_TYPES.find((t) => t.type === (w.type || 'metric')) || WIDGET_TYPES[0];
            return (
              <div key={w.id} className="rounded-md border border-gray-200 bg-white p-2">
                <div className="flex items-center gap-1.5">
                  <meta.Icon className="h-3 w-3 text-gray-400" />
                  {/* DISPLAY read — resolve the inline locale map form. */}
                  <span className="text-xs font-medium text-gray-600">{resolveWidgetTitle(w.title, language) || 'Untitled'}</span>
                </div>
                <div className="mt-1 text-[10px] text-gray-400">{meta.label}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function DashboardEditor({
  schema,
  onChange,
  readOnly = false,
  className,
  onExport,
  onImport,
  selectedWidgetId: externalSelectedWidgetId,
  onWidgetSelect,
}: DashboardEditorProps) {
  const { t } = useDesignerTranslation();
  const [internalSelectedWidgetId, setInternalSelectedWidgetId] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Use external selection when controlled, otherwise internal state
  const isControlled = externalSelectedWidgetId !== undefined;
  const selectedWidgetId = isControlled ? externalSelectedWidgetId : internalSelectedWidgetId;
  const setSelectedWidgetId = useCallback((id: string | null) => {
    if (onWidgetSelect) onWidgetSelect(id);
    if (!isControlled) setInternalSelectedWidgetId(id);
  }, [isControlled, onWidgetSelect, setInternalSelectedWidgetId]);

  const {
    current: currentSchema,
    canUndo,
    canRedo,
    push: pushHistory,
    undo,
    redo,
  } = useUndoRedo<DashboardComponentSchema>(schema);

  const applyChange = useCallback(
    (newSchema: DashboardComponentSchema) => {
      pushHistory(newSchema);
      onChange(newSchema);
    },
    [pushHistory, onChange]
  );

  const widgets = currentSchema.widgets || [];
  const selectedIndex = widgets.findIndex((w) => w.id === selectedWidgetId);
  const selectedWidget = selectedIndex < 0 ? undefined : widgets[selectedIndex];

  const addWidget = useCallback(
    (type: DashboardWidgetTypeName) => {
      const id = createWidgetId();
      const newWidget: DashboardWidgetSchema = {
        id,
        title: '',
        type,
        layout: {
          x: 0,
          y: widgets.length,
          w: currentSchema.columns ?? 2,
          h: 1,
        },
      };
      applyChange({ ...currentSchema, widgets: [...widgets, newWidget] });
      setSelectedWidgetId(id);
    },
    [currentSchema, widgets, applyChange, setSelectedWidgetId]
  );

  const removeWidget = useCallback(
    (id: string) => {
      applyChange({ ...currentSchema, widgets: widgets.filter((w) => w.id !== id) });
      if (selectedWidgetId === id) setSelectedWidgetId(null);
    },
    [currentSchema, widgets, selectedWidgetId, applyChange, setSelectedWidgetId]
  );

  const moveWidget = useCallback(
    (id: string, direction: 'up' | 'down') => {
      const idx = widgets.findIndex((w) => w.id === id);
      if (idx < 0) return;
      const target = direction === 'up' ? idx - 1 : idx + 1;
      if (target < 0 || target >= widgets.length) return;
      const copy = [...widgets];
      [copy[idx], copy[target]] = [copy[target], copy[idx]];
      applyChange({ ...currentSchema, widgets: copy });
    },
    [currentSchema, widgets, applyChange]
  );

  const updateWidget = useCallback(
    (updates: Partial<DashboardWidgetSchema>) => {
      if (!selectedWidgetId) return;
      applyChange({
        ...currentSchema,
        widgets: widgets.map((w) =>
          w.id === selectedWidgetId ? { ...w, ...updates } : w
        ),
      });
    },
    [currentSchema, widgets, selectedWidgetId, applyChange]
  );

  // Keyboard shortcuts
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (readOnly) return;

      // Ctrl+Z / Cmd+Z → Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      // Ctrl+Y / Cmd+Shift+Z → Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }
      // Delete / Backspace → Remove selected widget
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedWidgetId) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        removeWidget(selectedWidgetId);
      }
    };

    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [readOnly, undo, redo, selectedWidgetId, removeWidget]);

  const handleExport = useCallback(() => {
    if (onExport) {
      onExport(currentSchema);
    }
  }, [currentSchema, onExport]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string) as DashboardComponentSchema;
          if (parsed && parsed.type === 'dashboard') {
            applyChange(parsed);
            onImport?.(parsed);
          }
        } catch {
          // Invalid JSON — silently ignore
        }
      };
      reader.readAsText(file);
      // Reset input so re-import of same file triggers change
      e.target.value = '';
    },
    [applyChange, onImport]
  );

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      data-testid="dashboard-editor"
      className={cn('flex flex-col gap-4 outline-none', className)}
    >
      {/* Hidden file input for import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className="hidden"
        data-testid="dashboard-import-input"
        onChange={handleImportFile}
      />

      {/* Property panel — shown above widget list when a widget is selected */}
      {selectedWidget && !previewMode && (
        <WidgetPropertyPanel
          widget={selectedWidget}
          index={selectedIndex}
          readOnly={readOnly}
          onChange={updateWidget}
          onClose={() => setSelectedWidgetId(null)}
        />
      )}

      {/* Main area */}
      <div className="flex-1 space-y-4">
        {/* Toolbar */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-700">{t('appDesigner.addWidget')}:</span>
            {WIDGET_TYPES.map(({ type, label, Icon }) => (
              <button
                key={type}
                type="button"
                data-testid={`dashboard-add-${type}`}
                onClick={() => addWidget(type)}
                disabled={readOnly || previewMode}
                className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1">
            {!readOnly && (
              <>
                <button
                  type="button"
                  data-testid="dashboard-undo"
                  onClick={undo}
                  disabled={!canUndo}
                  className="rounded p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                  aria-label={t('appDesigner.undo')}
                >
                  <Undo2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  data-testid="dashboard-redo"
                  onClick={redo}
                  disabled={!canRedo}
                  className="rounded p-1.5 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                  aria-label={t('appDesigner.redo')}
                >
                  <Redo2 className="h-4 w-4" />
                </button>
              </>
            )}
            <button
              type="button"
              data-testid="dashboard-export"
              onClick={handleExport}
              className="rounded p-1.5 text-gray-400 hover:text-gray-700"
              aria-label={t('appDesigner.navExportSchema')}
            >
              <Download className="h-4 w-4" />
            </button>
            {!readOnly && (
              <button
                type="button"
                data-testid="dashboard-import"
                onClick={handleImportClick}
                className="rounded p-1.5 text-gray-400 hover:text-gray-700"
                aria-label={t('appDesigner.navImportSchema')}
              >
                <Upload className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              data-testid="dashboard-preview-toggle"
              onClick={() => setPreviewMode((p) => !p)}
              className={cn(
                'rounded p-1.5 transition-colors',
                previewMode ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-gray-700'
              )}
              aria-label={previewMode ? t('appDesigner.modeEdit') : t('appDesigner.preview')}
            >
              {previewMode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Content: Widget grid or Preview */}
        {previewMode ? (
          <DashboardPreview schema={currentSchema} />
        ) : widgets.length === 0 ? (
          <div className="flex h-48 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 text-sm text-gray-400">
            {t('appDesigner.noWidgets')}
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${currentSchema.columns ?? 2}, 1fr)` }}
          >
            {widgets.map((w, i) => (
              <WidgetCard
                key={w.id}
                widget={w}
                index={i}
                total={widgets.length}
                selected={w.id === selectedWidgetId}
                readOnly={readOnly}
                onSelect={() => setSelectedWidgetId(w.id ?? null)}
                onRemove={() => removeWidget(w.id!)}
                onMoveUp={() => moveWidget(w.id!, 'up')}
                onMoveDown={() => moveWidget(w.id!, 'down')}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default DashboardEditor;
