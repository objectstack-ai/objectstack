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
 *
 * ## A `type: 'file'` field is the platform upload widget (objectstack#25801)
 *
 * The object form's `FileField`, reached through `getLazyFieldWidget('file')`
 * as `ActionParamDialog`'s file params reach it, uploading through the host's
 * ambient `UploadProvider`. The upload lands as a `sys_file` no record owns yet,
 * and the widget's value is that file's bare id. The spec makes `'file'` a value
 * domain on resume: the engine refuses anything but a file id, so the runtime
 * posts {@link screenResumeValues}, which reduces a file field's value to its
 * id (a prefilled `defaultValue` may arrive in the expanded read form). A later
 * node writes the id into an object's `file` field, and that write claims the
 * file. While an upload is in flight the value is not an id yet, so the runtime
 * holds Submit until it settles (`FlowRunner`).
 *
 * ## A `type: 'record_link'` field shows a record, as a link (objectstack#25872)
 *
 * The read-only record link (the spec's `SCREEN_FIELD_RECORD_LINK_TYPE`, ruling
 * B on the screen-flow result screen): it shows the `reference` record whose id
 * its `defaultValue` was served with, by the record's display name (ADR-0079
 * `nameField`), as a link to the record's page. The name comes from the object
 * form's own `LookupField` in its `readonly` branch, which fetches the record
 * and names it from the referenced object's schema; the link is the console's
 * record route (`appRecordPath`, the builder the record page's related lists
 * use), drawn by the router's `Link` so a new tab or a copied address carries
 * the router's basename. An empty id draws the platform's empty glyph ("—")
 * and no link, and so does a record the console cannot route to (no app
 * segment, an object outside this console's metadata, or no router at all, as
 * in a bare preview): the name stays readable either way.
 *
 * The field takes no input. It is never seeded into the collected values
 * ({@link initialScreenValues}) and never posted ({@link screenResumeValues}):
 * the engine refuses a resume that carries any value under its name.
 *
 * ## `date`, `datetime` and `boolean` are the platform controls (objectstack#26579)
 *
 * A `date` / `datetime` field is the record form's picker (`DatePickerField` /
 * `DateTimePickerField`, objectui#12622): a text box in the display locale's
 * format, a calendar popover and a clear button, reached through
 * `getLazyFieldWidget` as `ActionParamDialog`'s date params reach it. The
 * value it writes is the stored shape the native inputs wrote — `YYYY-MM-DD`
 * for a date, an ISO instant for a date-time, `''` when cleared — so the
 * runner's `required` check and the resume bag read it unchanged.
 *
 * A `boolean` (or `checkbox`) field is `ActionParamDialog`'s inline row: the
 * form's `BooleanField` in its checkbox face, with the label BESIDE the control
 * and the help text under the row. The generic layout put the label on one line
 * and a lone checkbox on the next, which read as an empty radio button.
 *
 * ## A refused field says so under its control (objectstack#26882)
 *
 * `errors` maps a field name to the message the caller refused it with (the
 * runtime's `required` check). The message is drawn under the control as the
 * record form's `FormMessage` draws it, and the control is marked the way the
 * record form marks it: `aria-invalid`, and the message's id in its
 * `aria-describedby` beside any help text. A platform widget (picker, upload,
 * lookup, checkbox) receives the message as its published `error` slot, which
 * it reads only to set `aria-invalid` on its own control; the text stays here,
 * so it is drawn once. A field absent from `errors` renders as before, and the
 * Studio preview passes none.
 */
import { Suspense } from 'react';
import { Link, useInRouterContext, useParams } from 'react-router-dom';
import {
  Input,
  Label,
  Textarea,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  cn,
} from '@object-ui/components';
import { ObjectForm } from '@object-ui/plugin-form';
import { evalFieldPredicate } from '@object-ui/core';
import { fileIdOf, getLazyFieldWidget } from '@object-ui/fields';
import { useObjectTranslation } from '@object-ui/i18n';
import { SCREEN_FIELD_RECORD_LINK_TYPE, flowScreenFieldOptionKey } from '@objectstack/spec/automation';
import { appRecordPath, routableObjectNames } from './RelatedRecordActionsBridge.js';

/**
 * The object form's lookup picker (`LookupField`), through the shared lazy
 * widget registry `ActionParamDialog` also reads. Resolved once at module
 * scope, not in render (`react-hooks/static-components`); the registry caches
 * one lazy component per type, so this is the same component the dialog gets.
 */
const LookupFieldWidget = getLazyFieldWidget('lookup');

/** The object form's upload widget (`FileField`), resolved the same way. */
const FileFieldWidget = getLazyFieldWidget('file');

/** The object form's date and date-time pickers (objectui#12622), resolved the same way. */
const DateFieldWidget = getLazyFieldWidget('date');
const DateTimeFieldWidget = getLazyFieldWidget('datetime');

/** The object form's boolean control (`BooleanField`), resolved the same way. */
const BooleanFieldWidget = getLazyFieldWidget('boolean');

/**
 * Whether a screen field draws the boolean control, and so the inline row.
 * A boolean field that declares `options` is a select, as {@link ScreenFieldInput}
 * draws it, so it keeps the label above.
 */
function isBooleanScreenField(field: ScreenFieldSpec): boolean {
  const kind = (field.type || '').toLowerCase();
  if (kind !== 'boolean' && kind !== 'checkbox') return false;
  return !(Array.isArray(field.options) && field.options.length > 0);
}

/**
 * Whether a screen field is the read-only record link. Matched exactly, as the
 * spec's refinement and the engine's resume rule match it, so the console never
 * draws a link for a field the server would accept a value for.
 */
export function isRecordLinkScreenField(field: ScreenFieldSpec): boolean {
  return field.type === SCREEN_FIELD_RECORD_LINK_TYPE;
}

/** Whether a screen field is the upload widget — the widget hint, read as the renderer reads it. */
function isFileScreenField(field: ScreenFieldSpec): boolean {
  return (field.type || '').toLowerCase() === 'file';
}

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

/**
 * Seed flat-field values from each field's `defaultValue`. A record link's
 * `defaultValue` is the id it SHOWS, not a value it collects, so it is not
 * seeded: it would otherwise ride the resume the engine refuses for it.
 */
export function initialScreenValues(screen: ScreenSpec): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const f of screenFields(screen)) {
    if (isRecordLinkScreenField(f)) continue;
    if (f.defaultValue !== undefined) v[f.name] = f.defaultValue;
  }
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

/**
 * The values a flat screen resumes with: the collected `values`, with each
 * `type: 'file'` field's value reduced to its `sys_file` id (objectstack#25801).
 *
 * The engine reads a file field as a value domain and admits a bare file id
 * alone. The upload widget already hands back a bare id, but a prefilled
 * `defaultValue` can be served in the expanded read form (`{ id, name, url, … }`),
 * so the reduction is `fileIdOf`, the extractor `ActionParamDialog`'s
 * `serializeParamValues` applies to file params — one rule for both surfaces.
 * A value carrying no id is sent as it is, so the engine's refusal names it
 * rather than the dialog posting `undefined`. Every other value passes through,
 * except a record link's: that field takes no value and the engine refuses one
 * under its name, so any key it holds is left out.
 */
export function screenResumeValues(screen: ScreenSpec, values: Record<string, unknown>): Record<string, unknown> {
  let out: Record<string, unknown> | undefined;
  for (const field of screenFields(screen)) {
    if (isRecordLinkScreenField(field)) {
      if (!Object.prototype.hasOwnProperty.call(values, field.name)) continue;
      out ??= { ...values };
      delete out[field.name];
      continue;
    }
    if (!isFileScreenField(field)) continue;
    const value = values[field.name];
    if (value == null) continue;
    const id = fileIdOf(value);
    if (id === undefined || id === value) continue;
    out ??= { ...values };
    out[field.name] = id;
  }
  return out ?? values;
}

/** The id of a screen field's help-text element, which its control names in `aria-describedby`. */
function screenFieldHelpId(name: string): string {
  return `ff-${name}-help`;
}

/** The id of a screen field's refusal message, which its control names in `aria-describedby`. */
function screenFieldErrorId(name: string): string {
  return `ff-${name}-error`;
}

/**
 * The id of the control a screen field draws, the one its label points at.
 * Exported so the runtime can move focus to a refused field (objectstack#26882).
 */
export function screenFieldControlId(name: string): string {
  return `ff-${name}`;
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
  /**
   * The message each refused field is drawn with, by field name (see the
   * header, objectstack#26882). Absent, or a field not in it, draws no message.
   */
  errors?: Readonly<Record<string, string>>;
  className?: string;
}

export function ScreenView({ screen, values, onValueChange, dataSource, objects, objectForm, errors, className }: ScreenViewProps) {
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
        // A refused field names its message too, after the help text, as the
        // record form's control does (objectstack#26882).
        const error = errors?.[f.name] || undefined;
        const errorId = error ? screenFieldErrorId(f.name) : undefined;
        const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;
        const input = (
          <ScreenFieldInput
            field={f}
            value={values[f.name]}
            onChange={(v) => onValueChange(f.name, v)}
            describedBy={describedBy}
            error={error}
            dataSource={dataSource}
            objects={objects}
          />
        );
        const message = errorId && (
          <p id={errorId} className="text-sm font-medium text-destructive" data-screen-field-error={f.name}>{error}</p>
        );
        // The boolean control sits BESIDE its label, `ActionParamDialog`'s
        // inline row; the help text lines up under the label.
        if (isBooleanScreenField(f)) {
          return (
            <div key={f.name} className="grid gap-1">
              <div className="flex items-start gap-2">
                {input}
                <Label htmlFor={`ff-${f.name}`} className="text-sm font-normal cursor-pointer">
                  {f.label || f.name}
                  {f.required && (
                    <span className="text-destructive" aria-hidden="true" data-required-marker="true"> *</span>
                  )}
                </Label>
              </div>
              {helpId && (
                <p id={helpId} className="text-xs text-muted-foreground ml-6">{f.inlineHelpText}</p>
              )}
              {message && <div className="ml-6">{message}</div>}
            </div>
          );
        }
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
            {input}
            {helpId && (
              <p id={helpId} className="text-xs text-muted-foreground">{f.inlineHelpText}</p>
            )}
            {message}
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
  error,
  dataSource,
  objects,
}: {
  field: ScreenFieldSpec;
  value: unknown;
  onChange: (v: unknown) => void;
  /** Ids of the elements describing this control (its help text, its refusal), for `aria-describedby`. */
  describedBy?: string;
  /**
   * The message this field was refused with (objectstack#26882). A platform
   * widget takes it as its `error` slot, which sets `aria-invalid` on its own
   * control; a plain control gets `aria-invalid` here. The text itself is
   * drawn by {@link ScreenView}.
   */
  error?: string;
  /** Data source a `type: 'lookup'` picker queries its `reference` object through. */
  dataSource?: unknown;
  /** The console's object definitions: the objects a `record_link` field may link to a page of. */
  objects?: ReadonlyArray<unknown>;
}) {
  const { t } = useObjectTranslation();
  const id = screenFieldControlId(field.name);
  const kind = (field.type || 'text').toLowerCase();
  // The required STATE, announced on the control itself — the label's `*` is
  // visual-only (objectui#10367). `aria-required`, not native `required`: the
  // runner owns required enforcement (`FlowRunner`'s submit check, which counts
  // an unchecked `false` as an answer), and native `required` would add the
  // browser's own verdict beside it — on a checkbox it means "must be checked".
  // `undefined` when optional, so the attribute is omitted rather than "false".
  const ariaRequired = field.required ? true : undefined;
  // The refused STATE, for the plain controls below; omitted when not refused.
  const ariaInvalid = error ? true : undefined;

  // The read-only record link (objectstack#25872): the record's display name,
  // drawn by the lookup widget's `readonly` branch, inside a link to its page.
  // It reads the served `defaultValue`, never `value`: nothing is collected.
  if (isRecordLinkScreenField(field)) {
    return (
      <ScreenRecordLink id={id} field={field} dataSource={dataSource} objects={objects} describedBy={describedBy} />
    );
  }

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
          error={error}
          aria-required={ariaRequired}
          aria-describedby={describedBy}
        />
      </Suspense>
    );
  }

  // The platform upload widget (objectstack#25801) — the object form's own
  // `FileField`, through the same lazy registry and behind its own Suspense for
  // the reason the lookup's is. It uploads through the host's ambient
  // `UploadProvider` and hands back the minted file's bare id; its in-flight
  // state reaches the runner through the uploading scope it reports into.
  if (kind === 'file') {
    return (
      <Suspense fallback={<div className="h-9 w-full animate-pulse rounded-md bg-muted" aria-hidden="true" />}>
        <FileFieldWidget
          id={id}
          value={value ?? null}
          onChange={onChange}
          field={{ name: field.name, label: field.label, type: 'file', placeholder: field.placeholder }}
          error={error}
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
        <SelectTrigger id={id} aria-required={ariaRequired} aria-invalid={ariaInvalid} aria-describedby={describedBy}><SelectValue placeholder={placeholder} /></SelectTrigger>
        <SelectContent>
          {options.map((o, i) => (
            <SelectItem key={i} value={flowScreenFieldOptionKey(o.value)}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  // The form's `BooleanField` in its checkbox face, as `ActionParamDialog`'s
  // boolean params draw it (objectstack#26579); {@link ScreenView} lays the
  // label beside it. The host owns the id, so the widget draws no `sr-only`
  // label of its own. Only a real `true` is checked, and a tick answers a
  // real boolean.
  if (kind === 'boolean' || kind === 'checkbox') {
    return (
      <Suspense fallback={<div className="size-4 mt-0.5 animate-pulse rounded-sm bg-muted" aria-hidden="true" />}>
        <BooleanFieldWidget
          id={id}
          value={value === true}
          onChange={(checked: unknown) => onChange(checked === true)}
          field={{ name: field.name, label: field.label, type: 'boolean', widget: 'checkbox' }}
          className="mt-0.5"
          error={error}
          aria-required={ariaRequired}
          aria-describedby={describedBy}
        />
      </Suspense>
    );
  }
  // The record form's date / date-time picker (objectstack#26579), in the
  // display locale's format instead of the browser's native input. It writes
  // the stored shape the native input wrote, so nothing downstream changes.
  if (kind === 'date' || kind === 'datetime') {
    const Picker = kind === 'date' ? DateFieldWidget : DateTimeFieldWidget;
    return (
      <Suspense fallback={<div className="h-9 w-full animate-pulse rounded-md bg-muted" aria-hidden="true" />}>
        <Picker
          id={id}
          value={value ?? null}
          onChange={onChange}
          field={{ name: field.name, label: field.label, type: kind }}
          error={error}
          aria-required={ariaRequired}
          aria-describedby={describedBy}
        />
      </Suspense>
    );
  }
  if (kind === 'textarea' || kind === 'markdown') {
    return <Textarea id={id} aria-required={ariaRequired} aria-invalid={ariaInvalid} aria-describedby={describedBy} value={(value as string) ?? ''} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
  }
  const htmlType = kind === 'number' || kind === 'currency' ? 'number' : kind === 'email' ? 'email' : 'text';
  // The declared bound pair goes on a NUMERIC input only, as the native
  // attributes — on a text input they mean nothing. The submit-time refusal
  // is the runner's (`screenFieldBoundViolations`), beside its `required` check.
  const numeric = htmlType === 'number';
  return (
    <Input
      id={id}
      aria-required={ariaRequired}
      aria-invalid={ariaInvalid}
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

/** No-op change handler for the read-only lookup widget: a record link collects nothing. */
function ignoreChange(): void {}

/** The record id a record link was served with, or `undefined` when it holds none. */
function recordLinkId(field: ScreenFieldSpec): string | number | undefined {
  const id = field.defaultValue;
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  if (typeof id === 'string' && id.trim() !== '') return id;
  return undefined;
}

/**
 * A `type: 'record_link'` screen field: the record's display name, from the
 * lookup widget's `readonly` branch (which fetches the record and names it from
 * the referenced object's schema, or draws "—" when there is no id), wrapped in
 * a link to the record's page when the console can route there.
 */
function ScreenRecordLink({
  id,
  field,
  dataSource,
  objects,
  describedBy,
}: {
  id: string;
  field: ScreenFieldSpec;
  dataSource?: unknown;
  objects?: ReadonlyArray<unknown>;
  describedBy?: string;
}) {
  const recordId = recordLinkId(field);
  const name = (
    <Suspense fallback={<span className="inline-block h-4 w-24 animate-pulse rounded bg-muted" aria-hidden="true" />}>
      <LookupFieldWidget
        value={recordId ?? null}
        onChange={ignoreChange}
        readonly
        field={{ name: field.name, label: field.label, type: 'lookup', reference: field.reference }}
        dataSource={dataSource}
      />
    </Suspense>
  );
  // Rules-of-hooks safe: whether a router sits above is a fact about the mount,
  // and cannot change under it.
  const routed = useInRouterContext();
  return (
    <div id={id} aria-describedby={describedBy} data-screen-record-link={field.name} className="min-h-9 flex items-center">
      {routed && recordId !== undefined && typeof field.reference === 'string' ? (
        <RoutedRecordLink objectName={field.reference} recordId={recordId} objects={objects}>{name}</RoutedRecordLink>
      ) : (
        name
      )}
    </div>
  );
}

/**
 * The link to a record's page, under a router: the record route the record
 * page's related lists build (`appRecordPath`), or the bare name when this
 * console cannot route there.
 */
function RoutedRecordLink({
  objectName,
  recordId,
  objects,
  children,
}: {
  objectName: string;
  recordId: string | number;
  objects?: ReadonlyArray<unknown>;
  children: React.ReactNode;
}) {
  const { appName } = useParams<{ appName?: string }>();
  const path = appRecordPath(appName, routableObjectNames(objects), objectName, recordId);
  if (path === null) return <>{children}</>;
  return (
    <Link to={path} className="text-primary underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}
