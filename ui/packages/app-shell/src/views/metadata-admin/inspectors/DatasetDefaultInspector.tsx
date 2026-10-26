// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * DatasetDefaultInspector — the curated designer for an analytics `dataset`
 * (ADR-0021). Replaces the generic whole-draft JSON SchemaForm with structured,
 * fool-proof editors for the dataset's parts:
 *
 *   - base `object`,
 *   - `include` relationships (the join allowlist — D-C),
 *   - `dimensions` (name + field/`relationship.field` + type + granularity), and
 *   - `measures` (name + aggregate + field + format/currency/derived).
 *
 * The base object, the included relationships, and every `field` are picked
 * from the live object graph (a searchable combo over {@link useDatasetFieldCatalog})
 * — not recalled by hand — so authoring matches mainstream low-code dataset
 * builders. The aggregate / type / granularity are closed dropdowns so an
 * author can't type an unsupported value. Each combo still allows a custom
 * value as an escape hatch (offline catalog, computed path). Edits flow through
 * `onPatch`; the DatasetPreview on the canvas re-runs live as the draft changes.
 */

import * as React from 'react';
import { AlertTriangle, ArrowRight, ChevronDown, Plus, Trash2, X } from 'lucide-react';
import { Badge, Button, FilterBuilder, Label, Popover, PopoverContent, PopoverTrigger } from '@object-ui/components';
import {
  InspectorShell,
  InspectorTextField,
  InspectorSelectField,
  InspectorCheckboxField,
  RequiredMarker,
  appendArray,
  spliceArray,
} from './_shared.js';
import { InspectorComboField, type InspectorComboOption } from './InspectorComboField.js';
import { toFieldNameLoose, toFieldNameOrEmpty } from '../previews/object-fields-io.js';
import { formatMeasure } from '@object-ui/core';
import { useDisplayLocale } from '@object-ui/i18n';
import { conditionToGroup, groupToCondition, isClearedGroup, type BuilderGroup, type FilterCondition } from './datasetFilterCondition.js';
import {
  useObjectOptions,
  useDatasetFieldCatalog,
  useDatasetUsage,
  fieldTypeToDimensionType,
} from './useDatasetFields.js';
import type { MetadataDefaultInspectorProps } from '../default-inspector-registry.js';
import { t, tFormat, type SupportedLocale } from '../i18n.js';

/**
 * An option whose label is a catalogue key, resolved in the designer locale at
 * render (objectui#10586). The stored `value` never moves.
 */
type KeyedOption = { value: string; labelKey: string };

function localizeOptions(options: ReadonlyArray<KeyedOption>, locale: SupportedLocale): Array<{ value: string; label: string }> {
  return options.map((o) => ({ value: o.value, label: t(o.labelKey, locale) }));
}

/**
 * Render a catalogue sentence whose `{token}` slots are React nodes (a code
 * span, an emphasised word) — the split-and-interleave `ResourceEditPage`
 * already uses for `engine.edit.readOnlyBanner`. Where a slot sits, and the
 * words around it, belong to the locale rather than to this JSX.
 */
function withSlots(template: string, slots: Record<string, React.ReactNode>): React.ReactNode {
  return template.split(/\{(\w+)\}/).map((part, i) =>
    i % 2 === 1 ? <React.Fragment key={i}>{part in slots ? slots[part] : `{${part}}`}</React.Fragment> : part,
  );
}

// Closed to what the dataset compiler supports (no array_agg/string_agg in v1).
const AGGREGATE_OPTIONS: KeyedOption[] = [
  { value: 'count', labelKey: 'engine.inspector.dataset.aggregate.count' },
  { value: 'sum', labelKey: 'engine.inspector.dataset.aggregate.sum' },
  { value: 'avg', labelKey: 'engine.inspector.dataset.aggregate.avg' },
  { value: 'min', labelKey: 'engine.inspector.dataset.aggregate.min' },
  { value: 'max', labelKey: 'engine.inspector.dataset.aggregate.max' },
  { value: 'count_distinct', labelKey: 'engine.inspector.dataset.aggregate.count_distinct' },
];

const DIMENSION_TYPE_OPTIONS: KeyedOption[] = [
  { value: 'string', labelKey: 'engine.inspector.dataset.dimType.string' },
  { value: 'number', labelKey: 'engine.inspector.dataset.dimType.number' },
  { value: 'date', labelKey: 'engine.inspector.dataset.dimType.date' },
  { value: 'boolean', labelKey: 'engine.inspector.dataset.dimType.boolean' },
  { value: 'lookup', labelKey: 'engine.inspector.dataset.dimType.lookup' },
];

const DATE_GRANULARITY_OPTIONS: KeyedOption[] = [
  { value: '', labelKey: 'engine.inspector.dataset.granularity.none' },
  { value: 'day', labelKey: 'engine.inspector.dataset.granularity.day' },
  { value: 'week', labelKey: 'engine.inspector.dataset.granularity.week' },
  { value: 'month', labelKey: 'engine.inspector.dataset.granularity.month' },
  { value: 'quarter', labelKey: 'engine.inspector.dataset.granularity.quarter' },
  { value: 'year', labelKey: 'engine.inspector.dataset.granularity.year' },
];

const DERIVED_OP_OPTIONS: KeyedOption[] = [
  { value: 'ratio', labelKey: 'engine.inspector.dataset.derivedOp.ratio' },
  { value: 'sum', labelKey: 'engine.inspector.dataset.derivedOp.sum' },
  { value: 'difference', labelKey: 'engine.inspector.dataset.derivedOp.difference' },
  { value: 'product', labelKey: 'engine.inspector.dataset.derivedOp.product' },
];

// Display-format picker options — a business user shouldn't have to know numeral
// syntax (`$0,0.00`), so the inspector offers kind + decimals + currency and
// generates the `format`/`currency` strings.
const FORMAT_KIND_OPTIONS: KeyedOption[] = [
  { value: 'raw', labelKey: 'engine.inspector.dataset.formatKind.raw' },
  { value: 'number', labelKey: 'engine.inspector.dataset.formatKind.number' },
  { value: 'currency', labelKey: 'engine.inspector.dataset.formatKind.currency' },
  { value: 'percent', labelKey: 'engine.inspector.dataset.formatKind.percent' },
];
// Digits and ISO codes: the same in every locale, so plain labels.
const DECIMALS_OPTIONS = [
  { value: '0', label: '0' },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
];
const CURRENCY_OPTIONS = [
  { value: 'USD', label: 'USD ($)' },
  { value: 'EUR', label: 'EUR (€)' },
  { value: 'GBP', label: 'GBP (£)' },
  { value: 'CNY', label: 'CNY (¥)' },
  { value: 'JPY', label: 'JPY (¥)' },
  { value: 'INR', label: 'INR (₹)' },
  { value: 'CAD', label: 'CAD ($)' },
  { value: 'AUD', label: 'AUD ($)' },
];

type Dimension = { name?: string; label?: string; field?: string; type?: string; dateGranularity?: string };
type DerivedSpec = { op?: string; of?: string[] };
type Measure = {
  name?: string;
  label?: string;
  aggregate?: string;
  field?: string;
  format?: string;
  currency?: string;
  derived?: DerivedSpec;
  filter?: FilterCondition;
};

/**
 * objectui#11402 — a row's `field` has ONE spelling for "no field": the key is
 * absent. `DatasetMeasureSchema.field` is optional (only `count` may omit it),
 * and a dimension's `field` is required, so an empty string is never a value
 * either kind can use — the analytics door answered 500 on the ObjectQL
 * strategy for a `count` measure with `field: ''`, and the narrowed spec
 * refuses `''` at save (objectstack-ai/objectstack#21240).
 */
function isBlankField(field: unknown): boolean {
  return typeof field !== 'string' || field.trim() === '';
}

/**
 * Write a row's `field`: a blank value removes the key rather than storing
 * `''`. The row is rebuilt without the key — not given `field: undefined` — so
 * the held draft and the body the save sends say the same thing.
 */
export function writeRowField<T extends { field?: string }>(row: T, field: string): T {
  const { field: _previous, ...rest } = row;
  return (isBlankField(field) ? rest : { ...rest, field }) as T;
}

function SectionHeader({ title, count, onAdd, addLabel }: { title: string; count: number; onAdd?: () => void; addLabel: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <Label className="text-xs text-muted-foreground">{title}</Label>
        <Badge variant="outline" className="text-[10px]">{count}</Badge>
      </div>
      {onAdd && (
        <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-1.5 text-[11px]" onClick={onAdd}>
          <Plus className="h-3 w-3" /> {addLabel}
        </Button>
      )}
    </div>
  );
}

/** Native disclosure for a row's optional / advanced fields. */
function Advanced({ children, locale }: { children: React.ReactNode; locale: SupportedLocale }) {
  return (
    <details className="group">
      <summary className="cursor-pointer select-none list-none text-[11px] text-muted-foreground hover:text-foreground">
        <span className="inline-flex items-center gap-1">
          <ArrowRight className="h-3 w-3 transition-transform group-open:rotate-90" />
          {t('engine.inspector.dataset.advanced', locale)}
        </span>
      </summary>
      <div className="mt-1.5 space-y-1.5 border-l pl-2.5">{children}</div>
    </details>
  );
}

/** Best-effort parse of a stored measure format into the picker's {kind, decimals}. */
function parseMeasureFormat(format?: string, currency?: string): { kind: string; decimals: number } {
  const f = (format ?? '').trim();
  const m = f.match(/\.(0+)/);
  const decimals = m ? Math.min(m[1].length, 2) : 0;
  if (currency || /[$£€¥₹]/.test(f)) return { kind: 'currency', decimals };
  if (f.includes('%')) return { kind: 'percent', decimals };
  if (f) return { kind: 'number', decimals };
  return { kind: 'raw', decimals: 0 };
}

/** Generate {format, currency} from the picker selection. */
function buildMeasureFormat(kind: string, decimals: number, currency: string): { format?: string; currency?: string } {
  const dp = decimals > 0 ? '.' + '0'.repeat(decimals) : '';
  switch (kind) {
    case 'number': return { format: `0,0${dp}`, currency: undefined };
    case 'currency': return { format: `0,0${dp}`, currency: currency || 'USD' };
    case 'percent': return { format: `0${dp}%`, currency: undefined };
    default: return { format: undefined, currency: undefined };
  }
}

/**
 * Structured display-format picker for a measure. Maps {kind, decimals, currency}
 * ⇄ the spec's `format`/`currency` strings and shows a live sample so a business
 * user never has to hand-write a numeral pattern.
 */
function MeasureFormatField({ measure, onPatch, disabled, locale }: { measure: Measure; onPatch: (p: Partial<Measure>) => void; disabled?: boolean; locale: SupportedLocale }) {
  const { kind, decimals } = parseMeasureFormat(measure.format, measure.currency);
  const currency = measure.currency || 'USD';
  const apply = (k: string, d: number, c: string) => onPatch(buildMeasureFormat(k, d, c));
  // The sample is a PREVIEW of authored formatting, so it has to be rendered
  // through the same channel as the surfaces it previews (objectui#4575): a
  // German session picking "Number · 1 decimal" is shown `1.234,5`, because
  // that is what the report and the dashboard will render. Showing the machine
  // locale's form here would make the sample lie about the one thing it exists
  // to demonstrate.
  const displayLocale = useDisplayLocale();
  // The percent sample is a hand-picked 0–1 FRACTION, so it says so rather than
  // leaving the formatter to infer a scale from the sample's magnitude.
  const sample = formatMeasure(kind === 'percent' ? 0.1234 : 1234.5, measure.format, measure.currency, kind === 'percent' ? 'fraction' : undefined, displayLocale);
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <InspectorSelectField label={t('engine.inspector.dataset.displayFormat', locale)} value={kind} options={localizeOptions(FORMAT_KIND_OPTIONS, locale)} onCommit={(v) => apply(v, decimals, currency)} disabled={disabled} />
        {kind !== 'raw' && (
          <InspectorSelectField label={t('engine.inspector.dataset.decimals', locale)} value={String(decimals)} options={DECIMALS_OPTIONS} onCommit={(v) => apply(kind, parseInt(v, 10) || 0, currency)} disabled={disabled} />
        )}
      </div>
      {kind === 'currency' && (
        <InspectorSelectField label={t('engine.inspector.dataset.currency', locale)} value={currency} options={CURRENCY_OPTIONS} onCommit={(v) => apply(kind, decimals, v)} disabled={disabled} />
      )}
      {kind !== 'raw' && (
        <p className="text-[10px] text-muted-foreground">
          {withSlots(t('engine.inspector.dataset.sample', locale), { sample: <span className="font-mono tabular-nums">{sample}</span> })}
        </p>
      )}
    </div>
  );
}

/** The relationship PATH of a `relationship[.relationship].field` reference (all
 *  segments but the final column) that isn't yet in `include`, else null. ADR-0071
 *  multi-hop: `account.owner.region` → `account.owner`. */
function missingRelationship(field: string | undefined, include: string[]): string | null {
  if (!field || !field.includes('.')) return null;
  const rel = field.slice(0, field.lastIndexOf('.'));
  return rel && !include.includes(rel) ? rel : null;
}

/** Inline author-time warning: a `relationship.field` whose join isn't declared in `include`. */
function RelWarning({ rel, onAdd, disabled, locale }: { rel: string; onAdd?: () => void; disabled?: boolean; locale: SupportedLocale }) {
  return (
    <p className="flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400">
      <AlertTriangle className="h-3 w-3 shrink-0" />
      <span>{withSlots(t('engine.inspector.dataset.relWarning', locale), { rel: <code className="font-mono">{rel}</code> })}</span>
      {!disabled && onAdd && (
        <button type="button" className="underline hover:no-underline" onClick={onAdd}>{t('engine.inspector.dataset.relWarningAdd', locale)}</button>
      )}
    </p>
  );
}

/**
 * Visual filter editor for a dataset/measure `FilterCondition`. Wraps the shared
 * {@link FilterBuilder} (a flat AND of `field op value` rows) and converts to/from
 * the spec's Mongo-style `FilterCondition`. Filters it can't faithfully edit
 * (nested / `$or` / multi-op) degrade to a "edit in Source" note rather than being
 * silently rewritten. See {@link conditionToGroup} / {@link groupToCondition}.
 */
function DatasetFilterField({ label, help, value, onCommit, fields, disabled, locale }: {
  label: string;
  help?: string;
  value: FilterCondition | undefined;
  onCommit: (fc: FilterCondition | undefined) => void;
  fields: Array<{ value: string; label?: string; type?: string }>;
  disabled?: boolean;
  locale: SupportedLocale;
}) {
  // `fields` is handed to the READ half as well as to the builder: it is what
  // lets a stored `$gt` on a date column read back as `after` — the operator
  // that column's dropdown offers — instead of a `greaterThan` it does not
  // list, which drew a blank operator trigger (objectui#9382).
  const { group, representable } = conditionToGroup(value, fields);
  const count = group.conditions.length;
  /**
   * Commit an edit — unless nothing survived serialization while rows are
   * still on screen (objectui#9372).
   *
   * `groupToCondition` answers `undefined` both when the author CLEARED the
   * filter and when every row was dropped, and this commit is what turns the
   * second one into data loss: `onCommit` lands as `onPatch({ filter })`, the
   * host applies it as `{ ...draft, ...patch }`, so `filter` is SET to
   * `undefined` — the very patch shape `objectChangePatch` uses to erase it.
   * An unmapped operator (`between`) or a blanked value on the only row would
   * therefore destroy a working stored filter, silently.
   *
   * Holding the patch leaves the stored value alone, which is the whole
   * requirement. ⛔ It is deliberately not "emit something anyway": a filter in
   * a spelling that means something else is worse than one that was dropped.
   * ⚠️ Known and accepted: the builder re-seeds its own state from `value`
   * whenever the two differ, so an unexpressible row is lost from the panel on
   * the next render the inspector happens to do. Losing an edit the bridge
   * could never have stored is not in the same class as destroying one it had.
   */
  const commitFilterGroup = (g: BuilderGroup) => {
    const next = groupToCondition(g);
    if (next === undefined && !isClearedGroup(g)) return;
    onCommit(next);
  };
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {!representable ? (
        <p className="rounded-md border border-dashed bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          {withSlots(t('engine.inspector.dataset.filterAdvanced', locale), {
            source: <span className="font-medium">{t('engine.inspector.dataset.sourceTab', locale)}</span>,
          })}
        </p>
      ) : (
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={disabled} className="h-8 w-full justify-between text-xs font-normal">
              <span className="truncate text-left">
                {count
                  ? tFormat(count === 1 ? 'engine.inspector.dataset.filterConditionsOne' : 'engine.inspector.dataset.filterConditionsOther', locale, { count })
                  : <span className="text-muted-foreground">{t('engine.inspector.dataset.addFilter', locale)}</span>}
              </span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[440px] max-w-[90vw] p-3">
            {fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('engine.inspector.dataset.filterNeedsObject', locale)}</p>
            ) : (
              <FilterBuilder fields={fields as any} value={group as any} onChange={commitFilterGroup} />
            )}
          </PopoverContent>
        </Popover>
      )}
      {help && <p className="text-[10px] text-muted-foreground">{help}</p>}
    </div>
  );
}

/**
 * Whether a measure names none of its object's fields: a plain row count — no
 * `field` (or the row wildcard `'*'`), no measure-scoped `filter` (its keys are
 * fields), and not `derived` (a derived measure combines other measures, which
 * may name fields, and one left pointing at a cleared measure is refused).
 */
function measureNamesNoField(m: Measure): boolean {
  return (isBlankField(m.field) || m.field === '*') && m.filter === undefined && m.derived === undefined;
}

/**
 * Patch for a base-object change. A dataset's joins (`include`), `dimensions`,
 * `filter`, and every measure that names a field reference the OLD object's
 * fields, so a real object change re-bases the dataset and clears them —
 * preventing stale field refs from silently producing broken/ambiguous queries.
 * A measure that names no field (the row count) means the same on any object
 * and is kept from `draft` (objectui#12848). A draft that holds no `measures`
 * is given none: a new dataset's first pick then keeps the create seed's
 * `count`, which the save merges under the draft. With no `draft`, nothing is
 * kept. Selecting the SAME object is a no-op (only sets `object`).
 */
export function objectChangePatch(
  next: string,
  current: string,
  draft?: Record<string, unknown>,
): Record<string, unknown> {
  if (next === current) return { object: next };
  const patch: Record<string, unknown> = { object: next, include: [], dimensions: [], filter: undefined };
  if (!draft) patch.measures = [];
  else if (Array.isArray(draft.measures)) patch.measures = (draft.measures as Measure[]).filter(measureNamesNoField);
  return patch;
}

export function DatasetDefaultInspector({ draft, onPatch, readOnly, name, locale, onBlockingIssuesChange }: MetadataDefaultInspectorProps) {
  // The designer's chrome language, handed in by the host like every other
  // default inspector's (objectui#10586). A plain function, not a memoised
  // one: nothing below may key on its identity (AGENTS.md #10).
  const tr = (key: string) => t(key, locale);
  const label = typeof draft.label === 'string' ? draft.label : '';
  const description = typeof draft.description === 'string' ? draft.description : '';
  const object = typeof draft.object === 'string' ? draft.object : '';
  const include: string[] = Array.isArray(draft.include) ? (draft.include as string[]) : [];
  const dimensions: Dimension[] = Array.isArray(draft.dimensions) ? (draft.dimensions as Dimension[]) : [];
  const measures: Measure[] = Array.isArray(draft.measures) ? (draft.measures as Measure[]) : [];
  const datasetName = typeof draft.name === 'string' ? draft.name : undefined;

  // In create mode the host passes an empty `name` (the PK is assigned on first
  // save). Mirror ReportDefaultInspector: expose an editable Name that auto-
  // derives a snake_case slug from the label until the author edits it directly,
  // so a dataset created through the canvas saves with a valid identifier instead
  // of dead-ending on the empty-name identity rule.
  const createMode = !name;
  const nameValue = typeof draft.name === 'string' ? (draft.name as string) : '';
  // objectui#12680 — whether the author has edited the name is read off the
  // DRAFT, not kept in this component: the name still follows the label while
  // it is empty or equals the identifier the label as it stands derives. A ref
  // here was reset whenever the host remounted this panel (a Properties →
  // Source → Properties round trip does), and the next label keystroke then
  // replaced the name the author had typed.
  // objectui#12789 — the comparison uses the same derivation as the Label
  // handler, so a Name left empty by a non-Latin Label still follows a later
  // Latin one, and a Name the author typed is never mistaken for the `field`
  // placeholder.
  const nameFollowsLabel = createMode && (nameValue === '' || nameValue === toFieldNameOrEmpty(label));

  const { options: objectOptions, loading: objectsLoading } = useObjectOptions();
  const { relationships, fieldOptions, loading: catalogLoading } = useDatasetFieldCatalog(object, include);
  const usage = useDatasetUsage(datasetName);

  const objectComboOptions: InspectorComboOption[] = React.useMemo(
    () => objectOptions.map((o) => ({ value: o.name, label: o.label })),
    [objectOptions],
  );
  const relationshipComboOptions: InspectorComboOption[] = React.useMemo(
    () => relationships.map((r) => ({ value: r.name, label: r.label, hint: r.referenceTo ? `→ ${r.referenceTo}` : undefined })),
    [relationships],
  );
  const fieldComboOptions: InspectorComboOption[] = React.useMemo(
    () => fieldOptions.map((f) => ({ value: f.value, label: f.label, hint: f.type, group: f.group })),
    [fieldOptions],
  );
  // Base-object fields for the filter builders (scope + measure filters operate on
  // the base table; relationship-path filters are out of scope for v1).
  const filterFields = React.useMemo(
    () => fieldOptions.filter((f) => !f.value.includes('.')).map((f) => ({ value: f.value, label: f.label, type: f.type })),
    [fieldOptions],
  );
  const datasetFilter = draft.filter && typeof draft.filter === 'object' ? (draft.filter as FilterCondition) : undefined;

  const baseLabel = objectComboOptions.find((o) => o.value === object)?.label ?? object;

  const patchDimension = (i: number, patch: Partial<Dimension>) =>
    onPatch({ dimensions: dimensions.map((d, idx) => (idx === i ? { ...d, ...patch } : d)) });
  const patchMeasure = (i: number, patch: Partial<Measure>) =>
    onPatch({ measures: measures.map((m, idx) => (idx === i ? { ...m, ...patch } : m)) });

  // Picking a field auto-infers the dimension type from the field's framework
  // type (region:string, close_date:date, …) — the BI "pick field, type follows"
  // convention — while leaving the Type select free to override.
  const leafName = (path: string) => (path.includes('.') ? path.split('.').pop() ?? path : path);
  // The field itself goes through `writeRowField`, so a blank pick removes the
  // key instead of storing `''` (objectui#11402).
  const pickDimensionField = (i: number, v: string) => {
    const opt = fieldOptions.find((o) => o.value === v);
    const patch: Partial<Dimension> = opt?.type ? { type: fieldTypeToDimensionType(opt.type) } : {};
    if (!isBlankField(v) && !dimensions[i]?.name) patch.name = leafName(v); // auto-name from field when unnamed
    onPatch({ dimensions: dimensions.map((d, idx) => (idx === i ? writeRowField({ ...d, ...patch }, v) : d)) });
  };
  const pickMeasureField = (i: number, v: string) => {
    const patch: Partial<Measure> = {};
    if (!isBlankField(v) && !measures[i]?.name) patch.name = leafName(v); // auto-name from field when unnamed
    onPatch({ measures: measures.map((m, idx) => (idx === i ? writeRowField({ ...m, ...patch }, v) : m)) });
  };

  /* ─── A field-less dimension → the host's Save gate (objectui#11402) ───
   *
   * A dimension's `field` is required (`DatasetDimensionSchema.field`), so a
   * row whose Field box is blank is incomplete. It is reported on the
   * blocking-issue channel the host already reads for this inspector family
   * (objectui#4527 / objectui#6900), which holds Save, the autosave timer and
   * the shortcut alike — so the row is never saved as `field: ''`, and never
   * sent half-built. A stored `field: ''` counts too: it is the same blank box.
   * While the box is blank, that row's Field label carries the designer's
   * required marker (objectui#10948), so the row the hold is about is the one
   * shown as incomplete; a row with a field shows the plain label.
   *
   * A measure is NOT counted: its `field` is optional, and whether its
   * aggregate may go without one is the spec's verdict at save.
   *
   * The count is derived from the draft on every render — there is no queued
   * verdict that could outlive the item it describes, so nothing is stamped
   * here; the host's own stamp expires the count when this inspector goes. */
  const incompleteDimensions = dimensions.filter((d) => isBlankField(d.field)).length;
  // Held in a ref so an unmemoized host callback cannot re-fire the effect.
  const onBlockingIssuesChangeRef = React.useRef(onBlockingIssuesChange);
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current = onBlockingIssuesChange;
  });
  React.useEffect(() => {
    onBlockingIssuesChangeRef.current?.(incompleteDimensions);
  }, [incompleteDimensions]);
  // One id prefix for every dimension row's Field label ⇄ combo pair; the row
  // index keeps each pair distinct within this inspector.
  const dimensionFieldIdPrefix = React.useId();

  return (
    <InspectorShell kindLabel={tr('engine.inspector.dataset.kind')} title={String(label || draft.name || tr('engine.inspector.dataset.kind'))} onClose={() => {}} hideClose>
      {datasetName && !usage.loading && (
        <p
          className={
            usage.reports + usage.dashboards > 0
              ? 'rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-300'
              : 'text-[11px] text-muted-foreground'
          }
        >
          {usage.reports + usage.dashboards > 0
            ? tFormat('engine.inspector.dataset.usage.bound', locale, {
                reports: tFormat(usage.reports === 1 ? 'engine.inspector.dataset.usage.reportsOne' : 'engine.inspector.dataset.usage.reportsOther', locale, { count: usage.reports }),
                dashboards: tFormat(usage.dashboards === 1 ? 'engine.inspector.dataset.usage.dashboardsOne' : 'engine.inspector.dataset.usage.dashboardsOther', locale, { count: usage.dashboards }),
              })
            : tr('engine.inspector.dataset.usage.unbound')}
        </p>
      )}

      {createMode && (
        <InspectorTextField
          label={tr('engine.inspector.dataset.name')}
          value={nameValue}
          // objectui#12746 — committed on every keystroke, so the
          // prefix-stable form, as ReportDefaultInspector and the object
          // designer do: the strict `toFieldName` trimmed a trailing `_`
          // before the next key arrived. The Label derivation below keeps
          // the strict form.
          onCommit={(v) => onPatch({ name: toFieldNameLoose(v) })}
          placeholder={tr('engine.inspector.dataset.namePlaceholder')}
          disabled={readOnly}
          mono
        />
      )}
      <InspectorTextField
        label={tr('engine.inspector.dataset.label')}
        value={label}
        onCommit={(v) => {
          // Live-derive the snake_case name from the label until the author edits
          // the Name field directly (create mode only). objectui#12789 — a Label
          // that yields no machine name (a non-Latin script, or a cleared Label)
          // leaves the Name empty, as the object designer does, so the save
          // path asks the author for one; it never writes the `field`
          // placeholder.
          const patch: Record<string, unknown> = { label: v };
          if (nameFollowsLabel) patch.name = toFieldNameOrEmpty(v);
          onPatch(patch);
        }}
        disabled={readOnly}
      />
      <InspectorTextField label={tr('engine.inspector.dataset.description')} value={description} onCommit={(v) => onPatch({ description: v })} disabled={readOnly} />
      <InspectorComboField
        label={tr('engine.inspector.dataset.baseObject')}
        value={object}
        onCommit={(v) => onPatch(objectChangePatch(v, object, draft))}
        options={objectComboOptions}
        loading={objectsLoading}
        placeholder={tr('engine.inspector.dataset.baseObjectPlaceholder')}
        searchPlaceholder={tr('engine.inspector.dataset.searchObjects')}
        disabled={readOnly}
        mono
      />
      {object && (dimensions.length > 0 || measures.length > 0 || include.length > 0 || !!datasetFilter) && (
        <p className="text-[10px] text-muted-foreground">{tr('engine.inspector.dataset.baseObjectChangeHint')}</p>
      )}

      {/* Included relationships (the join allowlist) */}
      <div className="border-t pt-3 space-y-1.5">
        <SectionHeader
          title={tr('engine.inspector.dataset.includedRelationships')}
          count={include.length}
          addLabel={tr('engine.form.add')}
          onAdd={readOnly ? undefined : () => onPatch({ include: appendArray(include, '') })}
        />
        {include.length === 0 ? (
          <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-center text-[11px] text-muted-foreground">
            {withSlots(tr('engine.inspector.dataset.noJoins'), {
              object: <code>{baseLabel || tr('engine.inspector.dataset.baseObjectFallback')}</code>,
              path: <code>relationship.field</code>,
            })}
          </p>
        ) : (
          include.map((rel, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <InspectorComboField
                // One row per join under the "Included relationships" heading;
                // no per-row visible label, so the trigger is named directly
                // rather than left anonymous (objectui#3997).
                ariaLabel={tr('engine.inspector.dataset.includedRelationship')}
                value={rel}
                onCommit={(v) => onPatch({ include: include.map((r, idx) => (idx === i ? v : r)) })}
                options={relationshipComboOptions}
                loading={catalogLoading}
                placeholder={tr('engine.inspector.dataset.relationshipPlaceholder')}
                searchPlaceholder={tr('engine.inspector.dataset.searchRelationships')}
                disabled={readOnly}
                mono
              />
              {!readOnly && (
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0" onClick={() => onPatch({ include: spliceArray(include, i, null) })} aria-label={tr('engine.inspector.dataset.removeRelationship')}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))
        )}
        {object && include.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 pt-0.5 text-[10px] text-muted-foreground">
            <span className="font-mono font-medium">{baseLabel}</span>
            {include.map((rel, i) => {
              const r = relationships.find((x) => x.name === rel);
              return (
                <span key={i} className="inline-flex items-center gap-1">
                  <ArrowRight className="h-3 w-3 opacity-60" />
                  <span className="font-mono">{rel}{r?.referenceTo ? ` (${r.referenceTo})` : ''}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Scope filter — the dataset's intrinsic FilterCondition */}
      <div className="border-t pt-3">
        <DatasetFilterField
          label={tr('engine.inspector.dataset.scopeFilter')}
          help={tr('engine.inspector.dataset.scopeFilterHelp')}
          value={datasetFilter}
          onCommit={(fc) => onPatch({ filter: fc })}
          fields={filterFields}
          disabled={readOnly}
          locale={locale}
        />
      </div>

      {/* Dimensions */}
      <div className="border-t pt-3 space-y-2">
        <SectionHeader
          title={tr('engine.inspector.dataset.dimensions')}
          count={dimensions.length}
          addLabel={tr('engine.inspector.dataset.addDimension')}
          // No `field` key until one is picked (objectui#11402) — never `''`.
          onAdd={readOnly ? undefined : () => onPatch({ dimensions: appendArray<Dimension>(dimensions, { name: '', type: 'string' }) })}
        />
        {dimensions.map((d, i) => (
          <div key={i} className="rounded-md border p-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">{tFormat('engine.inspector.dataset.dimensionN', locale, { index: i + 1 })}</span>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={tr('engine.inspector.dataset.removeDimension')}
                  title={tr('engine.inspector.dataset.removeDimension')}
                  className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => onPatch({ dimensions: spliceArray(dimensions, i, null) })}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <InspectorTextField label={tr('engine.inspector.dataset.name')} value={d.name ?? ''} onCommit={(v) => patchDimension(i, { name: v })} placeholder={tr('engine.inspector.dataset.dimensionNamePlaceholder')} disabled={readOnly} mono />
            {/* The label is rendered here, not by the combo, so it can carry the
                required marker while the box is blank (objectui#11402); `id` is
                the combo's external-label variant. */}
            <div className="space-y-1">
              <Label htmlFor={`${dimensionFieldIdPrefix}-${i}`} className="text-xs text-muted-foreground">
                {tr('engine.inspector.dataset.field')}
                {isBlankField(d.field) && <RequiredMarker />}
              </Label>
              <InspectorComboField
                id={`${dimensionFieldIdPrefix}-${i}`}
                value={d.field ?? ''}
                onCommit={(v) => pickDimensionField(i, v)}
                options={fieldComboOptions}
                loading={catalogLoading}
                placeholder={tr('engine.inspector.dataset.dimensionFieldPlaceholder')}
                searchPlaceholder={tr('engine.form.searchFields')}
                disabled={readOnly}
                mono
              />
            </div>
            {(() => { const rel = missingRelationship(d.field, include); return rel ? <RelWarning rel={rel} disabled={readOnly} locale={locale} onAdd={() => onPatch({ include: appendArray(include, rel) })} /> : null; })()}
            <InspectorSelectField label={tr('engine.inspector.dataset.type')} value={d.type} options={localizeOptions(DIMENSION_TYPE_OPTIONS, locale)} onCommit={(v) => patchDimension(i, { type: v })} disabled={readOnly} />
            <Advanced locale={locale}>
              <InspectorTextField label={tr('engine.inspector.dataset.labelOptional')} value={d.label ?? ''} onCommit={(v) => patchDimension(i, { label: v || undefined })} placeholder={d.name || tr('engine.inspector.dataset.displayLabel')} disabled={readOnly} />
              {d.type === 'date' && (
                <InspectorSelectField label={tr('engine.inspector.dataset.dateBucket')} value={d.dateGranularity ?? ''} options={localizeOptions(DATE_GRANULARITY_OPTIONS, locale)} onCommit={(v) => patchDimension(i, { dateGranularity: v || undefined })} disabled={readOnly} />
              )}
            </Advanced>
          </div>
        ))}
      </div>

      {/* Measures */}
      <div className="border-t pt-3 space-y-2">
        <SectionHeader
          title={tr('engine.inspector.dataset.measures')}
          count={measures.length}
          addLabel={tr('engine.inspector.dataset.addMeasure')}
          // No `field` key until one is picked (objectui#11402) — never `''`.
          onAdd={readOnly ? undefined : () => onPatch({ measures: appendArray<Measure>(measures, { name: '', aggregate: 'sum' }) })}
        />
        {measures.map((m, i) => {
          const otherMeasures = measures.filter((_, idx) => idx !== i).map((x) => x.name).filter((n): n is string => !!n);
          const derived = m.derived;
          return (
            <div key={i} className="rounded-md border p-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-muted-foreground">{tFormat('engine.inspector.dataset.measureN', locale, { index: i + 1 })}</span>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={tr('engine.inspector.dataset.removeMeasure')}
                    title={tr('engine.inspector.dataset.removeMeasure')}
                    className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onPatch({ measures: spliceArray(measures, i, null) })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              <InspectorTextField label={tr('engine.inspector.dataset.name')} value={m.name ?? ''} onCommit={(v) => patchMeasure(i, { name: v })} placeholder={tr('engine.inspector.dataset.measureNamePlaceholder')} disabled={readOnly} mono />
              <InspectorSelectField label={tr('engine.inspector.dataset.aggregate')} value={m.aggregate} options={localizeOptions(AGGREGATE_OPTIONS, locale)} onCommit={(v) => patchMeasure(i, { aggregate: v })} disabled={readOnly} />
              <InspectorComboField
                label={tr('engine.inspector.dataset.field')}
                value={m.field ?? ''}
                onCommit={(v) => pickMeasureField(i, v)}
                options={fieldComboOptions}
                loading={catalogLoading}
                placeholder={tr('engine.inspector.dataset.measureFieldPlaceholder')}
                searchPlaceholder={tr('engine.form.searchFields')}
                disabled={readOnly}
                mono
              />
              {(() => { const rel = missingRelationship(m.field, include); return rel ? <RelWarning rel={rel} disabled={readOnly} locale={locale} onAdd={() => onPatch({ include: appendArray(include, rel) })} /> : null; })()}
              <Advanced locale={locale}>
                <InspectorTextField label={tr('engine.inspector.dataset.labelOptional')} value={m.label ?? ''} onCommit={(v) => patchMeasure(i, { label: v || undefined })} placeholder={m.name || tr('engine.inspector.dataset.displayLabel')} disabled={readOnly} />
                <MeasureFormatField measure={m} onPatch={(pp) => patchMeasure(i, pp)} disabled={readOnly} locale={locale} />
                <DatasetFilterField
                  label={tr('engine.inspector.dataset.measureFilter')}
                  help={tr('engine.inspector.dataset.measureFilterHelp')}
                  value={m.filter}
                  onCommit={(fc) => patchMeasure(i, { filter: fc })}
                  fields={filterFields}
                  disabled={readOnly}
                  locale={locale}
                />
                <InspectorCheckboxField
                  label={tr('engine.inspector.dataset.derived')}
                  value={!!derived}
                  onCommit={(v) => patchMeasure(i, { derived: v ? { op: 'ratio', of: [] } : undefined })}
                  disabled={readOnly}
                />
                {derived && (
                  <div className="space-y-1.5 rounded-md border border-dashed p-2">
                    <InspectorSelectField label={tr('engine.inspector.dataset.operation')} value={derived.op} options={localizeOptions(DERIVED_OP_OPTIONS, locale)} onCommit={(v) => patchMeasure(i, { derived: { ...derived, op: v } })} disabled={readOnly} />
                    <Label className="text-xs text-muted-foreground">{tr('engine.inspector.dataset.operands')}</Label>
                    {(() => { const need = derived.op === 'ratio' || derived.op === 'difference' ? 2 : 1; const have = Array.isArray(derived.of) ? derived.of.length : 0; return have < need ? <p className="text-[10px] text-amber-600 dark:text-amber-400">{tFormat(need === 2 ? 'engine.inspector.dataset.derivedNeedTwo' : 'engine.inspector.dataset.derivedNeedOne', locale, { op: derived.op ?? '' })}</p> : null; })()}
                    {otherMeasures.length === 0 ? (
                      <p className="text-[11px] italic text-muted-foreground">{tr('engine.inspector.dataset.addOtherMeasuresFirst')}</p>
                    ) : (
                      <div className="space-y-1">
                        {otherMeasures.map((nm) => {
                          const checked = Array.isArray(derived.of) && derived.of.includes(nm);
                          return (
                            <InspectorCheckboxField
                              key={nm}
                              label={nm}
                              value={checked}
                              disabled={readOnly}
                              onCommit={(v) => {
                                const current = Array.isArray(derived.of) ? derived.of : [];
                                const next = v ? [...current, nm] : current.filter((x) => x !== nm);
                                patchMeasure(i, { derived: { ...derived, of: next } });
                              }}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Advanced>
            </div>
          );
        })}
      </div>
    </InspectorShell>
  );
}
