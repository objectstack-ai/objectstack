// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ScreenView — the presentational body of a flow `screen` (framework
 * screen-flow runtime, ADR-0019): the flat input-field list OR the named
 * object's full create/edit form.
 *
 * Extracted from {@link FlowRunner} so the exact same renderer drives both the
 * runtime (paused screen-flow → collect input → resume) and the Studio design
 * preview ({@link ScreenPreview}). Keeping ONE renderer is deliberate: a
 * separate preview reimplementation would drift from runtime — the
 * simulator-vs-engine divergence fixed in #1927.
 *
 * It owns no submit/resume behaviour and no Dialog chrome — the caller frames
 * it (the runtime wraps it in a Dialog + footer and resumes the run; the
 * preview wraps it in a card and hides the persist bar).
 *
 * ## The three screen-field keys objectstack#17306 added
 *
 * The spec gave a screen field `min` / `max`, `inlineHelpText` and `reference`,
 * each spelled as the object field (`FieldSchema`) spells it, on the ruling
 * that the keys ship WITH their rendering. They are read straight off the
 * re-exported `ScreenFieldSpec`; there is no local spelling and no alias
 * (the spec refuses `help` / `helpText` / `hint` / `tooltip` and the lookup
 * target's neighbouring spellings by name, so none of them reaches a client):
 *
 * - `min` / `max` land on the numeric input as the native bounds, and
 *   {@link screenFieldBoundViolations} is the submit-time comparison — the
 *   engine's resume check re-applies the same rule server-side.
 * - `inlineHelpText` is drawn UNDER the control and tied to it with
 *   `aria-describedby`. It is not the placeholder: that one is gone the moment
 *   the user types, and help text has to stay readable.
 * - `reference` resolves a `type: 'lookup'` field's picker — the SAME
 *   `LookupField` widget the object form and `ActionParamDialog` use, reached
 *   through `getLazyFieldWidget('lookup')` and fed the screen's data source.
 *   A lookup with no `reference` (a run suspended before the key existed) has
 *   no target to resolve and keeps the plain input it always had.
 *
 * A field declaring none of them renders exactly as it did before.
 */
import { Suspense } from 'react';
import {
  Input,
  Label,
  Textarea,
  Checkbox,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  cn,
} from '@object-ui/components';
import { ObjectForm } from '@object-ui/plugin-form';
import { evalFieldPredicate } from '@object-ui/core';
import { getLazyFieldWidget } from '@object-ui/fields';
import { useObjectTranslation } from '@object-ui/i18n';
import { flowScreenFieldOptionKey } from '@objectstack/spec/automation';

/**
 * The object form's lookup picker (`LookupField`), through the shared lazy
 * widget registry `ActionParamDialog` also reads. Resolved once at module
 * scope, not in render (`react-hooks/static-components`); the registry caches
 * one lazy component per type, so this is the same component the dialog gets.
 */
const LookupFieldWidget = getLazyFieldWidget('lookup');

/**
 * The screen-pause contract is OWNED by `@objectstack/spec/contracts`
 * (objectstack#4115) — the server emits it, this dialog renders it.
 *
 * `ScreenFieldSpec` is re-exported verbatim: the local copy was byte-equivalent
 * (including `visibleWhen`, ADR-0089's canonical spelling), so there was
 * nothing to keep.
 */
export type { ScreenFieldSpec } from '@objectstack/spec/contracts';

import type {
  ScreenFieldSpec,
  ScreenSpec as SpecScreenSpec,
} from '@objectstack/spec/contracts';

/**
 * The spec's screen contract with ONE deliberate widening: `fields` is optional
 * here and required there.
 *
 * Derived structurally from `SpecScreenSpec` so every other key — and any key
 * the spec adds later — arrives automatically; only the documented divergence
 * is spelled out. An `object-form` step, or a message-only screen emitted by a
 * third-party node executor, legitimately carries no `fields` array, and an
 * absent `fields` used to throw the moment the dialog opened. Every read goes
 * through {@link screenFields} rather than touching the array directly, so the
 * widening cannot leak into rendering or `required` enforcement (objectstack-ai/objectstack#3528).
 *
 * If the spec ever makes `fields` optional itself, this alias collapses to a
 * plain re-export — `__tests__/spec-symbol-parity.test.ts` fails on that day and says so.
 */
export type ScreenSpec = Omit<SpecScreenSpec, 'fields'> & { fields?: ScreenFieldSpec[] };

/** Whether a screen renders the object-form body rather than the flat fields. */
export function isObjectFormScreen(screen: ScreenSpec): boolean {
  return screen.kind === 'object-form' && !!screen.objectName;
}

/** The screen's input fields — always an array, even when the payload omits them. */
export function screenFields(screen: ScreenSpec): ScreenFieldSpec[] {
  return Array.isArray(screen.fields) ? screen.fields : [];
}

/**
 * The fields actually on screen for the values collected so far — i.e. every
 * field whose `visibleWhen` predicate holds (or that declares none).
 *
 * This is the list callers must use for BOTH rendering and `required`
 * enforcement. Splitting them is the objectstack-ai/objectstack#3528 dead-end: validate the full list
 * while rendering a subset and Submit blocks on a field the user was never
 * shown, with no resume request ever issued.
 *
 * The predicate is bare CEL over the screen's own field names
 * (`createOpportunity == true`), evaluated through the canonical
 * `@objectstack/formula` engine — the same verdict the server reaches for
 * field rules. Values are bound both bare and under `record.`, so either
 * spelling resolves. A broken predicate **fails open** (field stays visible),
 * matching `resolveFieldRuleState`: hiding an input on a typo would silently
 * drop data the flow is waiting for.
 */
export function visibleScreenFields(
  screen: ScreenSpec,
  values: Record<string, unknown>,
): ScreenFieldSpec[] {
  const scope = screenPredicateScope(screen, values);
  return screenFields(screen).filter((f) =>
    f.visibleWhen
      ? evalFieldPredicate(f.visibleWhen, scope, true, undefined, scope, {
          context: `visibleWhen of screen field '${f.name}'`,
        })
      : true,
  );
}

/**
 * The scope a screen's `visibleWhen` predicates evaluate against: every
 * DECLARED field bound to its collected value, or to a known-empty one when
 * the user has not touched it yet.
 *
 * Seeding matters. An untouched checkbox holds `undefined`, and to CEL an
 * unbound name is an *unknown identifier* — the evaluation errors and
 * `evalFieldPredicate` falls open, leaving `createOpportunity == true` fields
 * on screen precisely in the state where they should be hidden. Binding the
 * declared names makes the predicate resolve to a real `false` instead.
 *
 * Fail-open is still the behaviour we want for a genuinely broken predicate —
 * a syntax error, or a name that is not a field on this screen. Seeding only
 * the declared names keeps that split intact.
 *
 * Exported for the Studio's screen diagnostics
 * (`metadata-admin/previews/screen-spec.ts`), which read its keys as the names
 * a predicate may reference (objectui#10743); the evaluation itself stays in
 * {@link visibleScreenFields}.
 */
export function screenPredicateScope(
  screen: ScreenSpec,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const f of screenFields(screen)) {
    const t = (f.type || 'text').toLowerCase();
    scope[f.name] = t === 'boolean' || t === 'checkbox' ? false : null;
  }
  for (const [k, v] of Object.entries(values)) if (v !== undefined) scope[k] = v;
  return scope;
}

/** Seed flat-field values from each field's `defaultValue`. */
export function initialScreenValues(screen: ScreenSpec): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const f of screenFields(screen)) if (f.defaultValue !== undefined) v[f.name] = f.defaultValue;
  return v;
}

/** One declared bound a collected value breaks — see {@link screenFieldBoundViolations}. */
export interface ScreenFieldBoundViolation {
  field: ScreenFieldSpec;
  bound: 'min' | 'max';
  limit: number;
}

/**
 * The declared `min` / `max` bounds the collected values break, over the
 * fields actually on screen (the list {@link visibleScreenFields} answers).
 *
 * The client refusal is a courtesy — the engine re-checks the same bounds when
 * the run resumes (`validateScreenInputs` in `@objectstack/service-automation`)
 * — so it applies the SAME comparison, and nothing beyond it:
 *
 * - only a PRESENT finite number is compared, whatever the field's `type`. An
 *   empty optional field holds no value, and absence is `required`'s question,
 *   never a bound's;
 * - the bounds are inclusive: `min` refuses a value below it, `max` one above;
 * - a field its `visibleWhen` hides is not compared — the user was never asked
 *   for it (the objectstack-ai/objectstack#3528 dead-end, applied to bounds).
 */
export function screenFieldBoundViolations(
  screen: ScreenSpec,
  values: Record<string, unknown>,
): ScreenFieldBoundViolation[] {
  const out: ScreenFieldBoundViolation[] = [];
  for (const field of visibleScreenFields(screen, values)) {
    const value = values[field.name];
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    if (typeof field.min === 'number' && value < field.min) out.push({ field, bound: 'min', limit: field.min });
    if (typeof field.max === 'number' && value > field.max) out.push({ field, bound: 'max', limit: field.max });
  }
  return out;
}

/** The id of a screen field's help-text element, which its control names in `aria-describedby`. */
function screenFieldHelpId(name: string): string {
  return `ff-${name}-help`;
}

/** Submit/cancel wiring for the object-form body — runtime persists & resumes;
 *  the design preview hides the bar (`showSubmit`/`showCancel` false). */
export interface ScreenObjectFormActions {
  showSubmit?: boolean;
  showCancel?: boolean;
  submitText?: string;
  cancelText?: string;
  onSuccess?: (saved: any) => void;
  onCancel?: () => void;
  /** Overrides the "no data source" copy (the preview phrases it for authors). */
  noDataSourceMessage?: React.ReactNode;
}

export interface ScreenViewProps {
  screen: ScreenSpec;
  /** Controlled values for the flat-fields body. */
  values: Record<string, unknown>;
  onValueChange: (name: string, value: unknown) => void;
  /**
   * Data source — required to render the `object-form` body. ObjectForm fetches
   * the object schema (and persists) through this adapter.
   */
  dataSource?: any;
  /**
   * Object definitions — used to derive an `object-form` step's inline
   * master-detail `subforms` (mirrors RecordFormPage's create form).
   */
  objects?: any[];
  objectForm?: ScreenObjectFormActions;
  className?: string;
}

export function ScreenView({ screen, values, onValueChange, dataSource, objects, objectForm, className }: ScreenViewProps) {
  if (isObjectFormScreen(screen)) {
    const objectDef = Array.isArray(objects) ? objects.find((o: any) => o?.name === screen.objectName) : undefined;
    const subforms = objectDef
      ? ((objectDef as any).form?.subforms ?? (objectDef as any).formViews?.default?.subforms)
      : undefined;
    // Full object create/edit form (with inline master-detail grids). At runtime
    // the form owns its own Save/Cancel bar; the preview hides it.
    return (
      <div className={cn('py-2', className)}>
        {dataSource ? (
          <ObjectForm
            key={screen.nodeId}
            schema={{
              type: 'object-form',
              formType: 'simple',
              objectName: screen.objectName!,
              mode: screen.mode === 'edit' ? 'edit' : 'create',
              recordId: screen.mode === 'edit' ? screen.recordId : undefined,
              ...(screen.defaults ? { initialValues: screen.defaults } : {}),
              layout: 'vertical',
              subforms,
              onSuccess: objectForm?.onSuccess,
              onCancel: objectForm?.onCancel,
              showSubmit: objectForm?.showSubmit ?? true,
              showCancel: objectForm?.showCancel ?? true,
              submitText: objectForm?.submitText ?? 'Save & Continue',
              cancelText: objectForm?.cancelText ?? 'Cancel',
            } as any}
            dataSource={dataSource}
          />
        ) : (
          <div className="text-sm text-destructive py-4">
            {objectForm?.noDataSourceMessage ?? 'This step renders an object form but no data source is available.'}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={cn('space-y-4 py-2', className)}>
      {visibleScreenFields(screen, values).map((f) => {
        // Help text is drawn under the control, never folded into its
        // placeholder (which the browser clears on the first keystroke), and
        // the control names it in `aria-describedby` so it is announced too.
        const helpId = f.inlineHelpText ? screenFieldHelpId(f.name) : undefined;
        return (
          <div key={f.name} className="space-y-1.5">
            <Label htmlFor={`ff-${f.name}`} className="text-sm">
              {f.label || f.name}
              {/* Visual-only (objectui#3299, objectui#10367): `aria-required` on
                  the control is the announced channel; hiding the `*` keeps it
                  out of the control's accessible name ("Title", not "Title *"). */}
              {f.required && (
                <span className="text-destructive" aria-hidden="true" data-required-marker="true"> *</span>
              )}
            </Label>
            <ScreenFieldInput
              field={f}
              value={values[f.name]}
              onChange={(v) => onValueChange(f.name, v)}
              describedBy={helpId}
              dataSource={dataSource}
            />
            {helpId && (
              <p id={helpId} className="text-xs text-muted-foreground">{f.inlineHelpText}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One screen field's edit control.
 *
 * Named `ScreenFieldInput`, not `FieldInput`: `@objectstack/spec/data` already
 * exports a `FieldInput` type — the authoring shape of an object FIELD
 * (`Omit<Partial<Field>, 'type'>`) — which has nothing to do with this React
 * component. Two unrelated things under one name is the objectstack#4115
 * defect; `__tests__/spec-symbol-parity.test.ts` pins that the spec does not own
 * this name.
 */
export function ScreenFieldInput({
  field,
  value,
  onChange,
  describedBy,
  dataSource,
}: {
  field: ScreenFieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  /** Id of the element describing this control (its help text), for `aria-describedby`. */
  describedBy?: string;
  /** Data source a `type: 'lookup'` picker queries its `reference` object through. */
  dataSource?: unknown;
}) {
  const { t } = useObjectTranslation();
  const id = `ff-${field.name}`;
  const kind = (field.type || 'text').toLowerCase();
  // The required STATE, announced on the control itself — the label's `*` is
  // visual-only (objectui#10367). `aria-required`, not native `required`: the
  // runner owns required enforcement (`FlowRunner`'s submit check, which counts
  // an unchecked `false` as an answer), and native `required` would add the
  // browser's own verdict beside it — on a checkbox it means "must be checked".
  // `undefined` when optional, so the attribute is omitted rather than "false".
  const ariaRequired = field.required ? true : undefined;

  // A lookup with a declared target resolves its picker from it (objectstack#17306).
  // The widget is the object form's own `LookupField`, through the shared lazy
  // registry — so it sits behind a Suspense of its own: the Studio preview
  // renders this body with no boundary around it, and an unbounded suspension
  // would swap whatever ancestor boundary it reached for a fallback.
  // `dataSource` is passed explicitly; absent, the widget falls back to the
  // `SchemaRendererContext` one, exactly as it does in `ActionParamDialog`.
  if (kind === 'lookup' && typeof field.reference === 'string' && field.reference.trim() !== '') {
    return (
      <Suspense fallback={<div className="h-9 w-full animate-pulse rounded-md bg-muted" aria-hidden="true" />}>
        <LookupFieldWidget
          id={id}
          value={value ?? null}
          onChange={onChange}
          field={{ name: field.name, label: field.label, type: 'lookup', reference: field.reference, placeholder: field.placeholder }}
          dataSource={dataSource}
          aria-required={ariaRequired}
          aria-describedby={describedBy}
        />
      </Suspense>
    );
  }

  if (Array.isArray(field.options) && field.options.length > 0) {
    // No declared placeholder ⇒ the locale's `common.select`, the word the
    // object form's lookup picker shows in the same spot (objectui#11220).
    // `??`, not `||`: an authored `placeholder: ''` renders as authored.
    const placeholder = field.placeholder ?? t('common.select', { defaultValue: 'Select…' });
    // The select addresses each item by its value read as text — the spec's
    // `flowScreenFieldOptionKey`, the same address the `options` translation
    // key uses — but the field BINDS the option's own value (objectui#12075):
    // handing the text to `onChange` resumed a number- or boolean-valued
    // option as a string. The spec refuses two options of one field that
    // collide as text, so the text names exactly one option.
    const options = field.options;
    const pickOption = (key: string) => {
      const picked = options.find((o) => flowScreenFieldOptionKey(o.value) === key);
      if (picked) onChange(picked.value);
    };
    return (
      <Select value={value != null ? flowScreenFieldOptionKey(value) : undefined} onValueChange={pickOption}>
        <SelectTrigger id={id} aria-required={ariaRequired} aria-describedby={describedBy}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((o, i) => (
            <SelectItem key={i} value={flowScreenFieldOptionKey(o.value)}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (kind === 'boolean' || kind === 'checkbox') {
    return <Checkbox id={id} aria-required={ariaRequired} aria-describedby={describedBy} checked={value === true} onCheckedChange={(c) => onChange(c === true)} />;
  }
  if (kind === 'textarea' || kind === 'markdown') {
    return <Textarea id={id} aria-required={ariaRequired} aria-describedby={describedBy} value={(value as string) ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  const htmlType = kind === 'number' || kind === 'currency' ? 'number' : kind === 'email' ? 'email' : kind === 'date' ? 'date' : 'text';
  // The declared bound pair goes on a NUMERIC input only, as the native
  // attributes — on a date input `min` / `max` would be read as dates, and on
  // a text one they mean nothing. The submit-time refusal is the runner's
  // (`screenFieldBoundViolations`), beside its `required` check.
  const numeric = htmlType === 'number';
  return (
    <Input
      id={id}
      aria-required={ariaRequired}
      aria-describedby={describedBy}
      type={htmlType}
      min={numeric ? field.min : undefined}
      max={numeric ? field.max : undefined}
      value={(value as string) ?? ''}
      placeholder={field.placeholder}
      onChange={(e) => onChange(numeric ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)}
    />
  );
}
