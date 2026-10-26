/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from 'react';
import {
  SelectField,
  BooleanField,
  LookupField,
  UserField,
  NumberField,
  CurrencyField,
  PercentField,
  ImageField,
  FileField,
  AvatarField,
  SignatureField,
  TextAreaField,
  AddressField,
  LocationField,
  GeolocationField,
  FieldEditWidget,
  hasFieldEditWidget,
  mapFieldTypeToFormType,
  FORM_FIELD_TYPES,
  coerceToSafeValue,
  RETIRED_FIELD_TYPES,
  RetiredFieldTombstone,
} from '@object-ui/fields';
import { TEXTUAL_REF_FALLBACK_TYPES } from './fieldEnrichment';

/**
 * Field types that carry a `reference` for relational metadata but are NOT
 * edited via the lookup picker (they have their own dedicated inputs/renderers).
 * Used below so the inline-edit branch doesn't hijack them into a record picker.
 *
 * The set itself moved to `fieldEnrichment` (objectui#3355) — the module both
 * hosts' editability gates already share — so this renderer fallback and those
 * gates read the ONE definition of "machine-computed". Re-exported here to keep
 * the package's public name unchanged.
 */
export { TEXTUAL_REF_FALLBACK_TYPES };

/**
 * Test id on the terminal raw text input at the end of this component.
 *
 * The one editor in here that is lossy by construction — it displays through
 * `coerceToSafeValue` and emits a STRING — so "did this type reach the terminal
 * input?" is the question the drift guard has to answer EXACTLY, in both
 * directions. Sniffing `input[type="text"]` cannot: `TextField`, `ColorField`
 * and `QRCodeField` render one too, so the heuristic reads a benign type's
 * correct fallback and a delegated type's correct widget as the same thing.
 */
export const INLINE_PLAIN_TEXT_INPUT_TESTID = 'inline-plain-text-input';

/**
 * **Class D** — field types whose stored value is ALREADY a string, so the
 * terminal input's stringification is the identity and nothing is lost
 * (objectui#4220). These, and only these, keep that input.
 *
 * Enumerated rather than expressed as "everything the switch didn't match":
 * an open tail is what let `tags`, `checkboxes`, `toggle`, `slider`, `radio`
 * and friends land on a value-destroying editor in silence for six cards
 * running. A new field type is now a RED drift guard until someone decides
 * which of the four buckets it belongs in — see
 * `__tests__/inlineEditTypeCoverage.test.tsx`.
 *
 * `select` is deliberately absent: it has a routed branch (the picklist), and
 * only its degenerate options-less SINGLE-value form reaches the terminal
 * input — see {@link usesInlinePlainTextInput}.
 *
 * `markdown` (objectui#11541) and `textarea` (objectui#11562) are absent
 * although their values are strings: they are multi-line by type, so they are
 * ROUTED, to the multi-line `TextAreaField`. This terminal input is a
 * single-line `<input type="text">`, and the browser strips line breaks from
 * the value it is seeded with — one keystroke and the flattened text is what
 * gets written. The members left here are single-line types, which is what
 * makes "nothing is lost" true of them. `html` / `richtext` are absent because
 * the hosts never open an editor for them at all (they are in the fields
 * package's shared exclusion, consulted since #4228).
 */
export const INLINE_PLAIN_TEXT_FIELD_TYPES = new Set<string>([
  'text',
  'email',
  'phone',
  'url',
]);

/**
 * The type switch's own manifest: every type this component routes to a
 * dedicated editor before the delegation below is reached.
 *
 * Declared next to the switch so the four-way classification is readable in
 * ONE place, and pinned by rendering — the drift guard asserts each member
 * really produces something other than the terminal input, so an entry that
 * outlives its branch fails rather than quietly re-opening the plain-text path
 * (the discipline #4228 established for `DETAIL_ROUTED_INLINE_TYPES`).
 *
 * `select` / `multiselect` are routed only WITH options; the options-less
 * spellings are covered by {@link usesInlinePlainTextInput} (single, a bare
 * string) and by the delegation (multi-value, an array). Both are pinned by
 * name in the guard.
 */
export const INLINE_ROUTED_FIELD_TYPES = new Set<string>([
  // Picklists (with options), booleans, numerics
  'select', 'multiselect', 'boolean', 'number', 'currency', 'percent',
  // `date` / `datetime` left this set for the delegation tail in objectui#12759:
  // they edit with the platform date picker `FieldEditWidget` draws.
  // Structured composites (#4216 / #4222)
  'address', 'location', 'geolocation',
  // Relational pickers.
  //
  // `owner` sat beside `user` until objectui#4914 removed it (the fast-follow
  // to objectui#4814's ruling A′, which retired the spelling). Unlike the dead
  // predicate branches that retirement left behind, this set is consulted at
  // runtime against whatever type a STORED field actually carries — so while
  // `owner` was a member, a field still typed `owner` got a working person
  // picker in inline edit while the record FORM rendered the tombstone
  // refusal: two edit surfaces disagreeing about one field, which is worse
  // than either uniform outcome.
  //
  // Deleting the member ALONE would have changed nothing an author could see —
  // measured, not assumed. The delegation tail at the bottom of this component
  // asks `hasFieldEditWidget`, and the fields package still answers `true` for
  // `owner` (`EDIT_WIDGETS` maps it to `UserField`,
  // `packages/fields/src/FieldEditWidget.tsx` — a residual face #4914 does not
  // enumerate, filed separately). So the type would have reached the SAME
  // person picker by the delegation road instead of the routing road. That is
  // why this removal moves in lockstep with the retired-spelling refusal at
  // the top of `InlineFieldInput`, which runs before both roads: the refusal
  // is what actually changes the behavior, and the two are never split.
  'lookup', 'master_detail', 'tree', 'user',
  // Binary / attachment — the detail page's exemption from the shared
  // exclusion (#4228): a row can host an upload widget, a grid cell cannot.
  'image', 'avatar', 'signature', 'file', 'video', 'audio',
  // Long-form markup source — the same exemption (objectui#11541): a row can
  // host a multi-line editor, and the terminal input is one line.
  'markdown',
  // Multi-line plain text (objectui#11562). Not in the shared exclusion, so
  // the hosts always opened an editor for it; it was class D until the
  // terminal input's one line was measured to drop its line breaks.
  'textarea',
]);

/**
 * Is this a field type the form actually knows, rather than an unrecognized
 * string?
 *
 * `mapFieldTypeToFormType` FALLS BACK to `field:text` for anything it has no
 * entry for, which makes `hasFieldEditWidget()` answer `true` for every string
 * on earth. Delegating on that answer alone would quietly hand a typo'd or
 * private type (`decimal`, `integer` — deliberately not aliased, see the
 * numeric branch) to `TextField` instead of leaving it on the documented
 * fallback, and would let the drift guard's "delegated" bucket swallow a NEW
 * spec type that nobody has decided about. Both are the recurrence this card
 * exists to stop, so the alias fallback is not treated as a decision.
 */
export function isKnownFieldType(type: string | undefined): boolean {
  if (!type) return false;
  // `text` is the fallback's own target, and also a direct widget key — so the
  // first clause already covers it and no real type is missed here.
  return FORM_FIELD_TYPES.includes(type) || mapFieldTypeToFormType(type) !== 'field:text';
}

/**
 * Does this field edit in the terminal raw text input (class D)?
 *
 * The options-less SINGLE `select` is the one conditional member. Its stored
 * value is a bare string, so the text input is lossless — while the fields
 * package's own widget would render its "no options to offer" state, leaving
 * the user unable to enter anything at all. The `multiple` spelling of the same
 * degenerate field is NOT benign: its value is an array, so it delegates and
 * keeps that array (class A).
 */
export function usesInlinePlainTextInput(field: Record<string, any>): boolean {
  const type = field?.type as string | undefined;
  if (!type) return true;
  if (INLINE_PLAIN_TEXT_FIELD_TYPES.has(type)) return true;
  return type === 'select' && !field.multiple;
}

/**
 * Extract the id a reference widget expects from a value that may already be
 * an `$expand`-ed record object (`{ id, name, ... }`), an array of those, or a
 * bare id. Mirrors the display logic in `LookupCellRenderer` so edit-mode and
 * read-mode agree on which id a relationship points at.
 */
export function extractLookupId(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(extractLookupId);
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return obj.id ?? obj._id ?? obj.value ?? '';
  }
  return value;
}

export interface InlineFieldInputProps {
  /**
   * Enriched field metadata — `type` plus any objectSchema enrichment (options,
   * currency, precision, format, reference, widget…). The caller owns
   * enrichment so read-mode and edit-mode agree on the same resolved field
   * shape. Kept as a loose bag (matching the widgets' `field` props) since the
   * exact key set varies by field type.
   */
  field: Record<string, any>;
  /** Current field value (may be an `$expand`-ed record object for references). */
  value: any;
  /** Called with the next value whenever the user edits the field. */
  onChange: (value: any) => void;
  /** DataSource used by reference (lookup / master_detail / user) pickers. */
  dataSource?: any;
  /** Auto-focus the underlying input on mount (wired to the entered field). */
  autoFocus?: boolean;
  /**
   * The SERVER's reason for refusing this field on the last save, or undefined
   * (objectui#6868). Forwarded to the widget's published objectui#3222 `error`
   * slot, which marks `aria-invalid` — it does NOT render text, on this surface
   * or on the form one, so the visible hint is drawn by the HOST beside this
   * input (see `DetailSection` / `HeaderHighlight`).
   *
   * ⚠️ Never a client-side verdict. The ruling on objectui#6868 makes the
   * server the validation authority here; this prop only carries what the
   * server already decided.
   */
  error?: string;
  /**
   * The record this field belongs to, as the edit session sees it — the saved
   * record overlaid with the inline draft (objectui#7190). Forwarded unchanged
   * to every widget that scopes itself by a record: `LookupField` / `UserField`
   * (a `dependsOn` lookup gates on it and filters its query by it),
   * `SelectField` (a `dependsOn` gate plus per-option `visibleWhen`, through
   * `useCascadingOptions`), and `FieldEditWidget`, which hands it on to the
   * option widgets it renders. Same spelling and shape as the widgets' own
   * `dependentValues` prop.
   *
   * ⚠️ It is the ONLY channel. The widgets resolve `dependentValues ?? {}`:
   * there is no context fallback (objectui#7206 retired the one that was
   * documented and never fired), so a host that omits it renders every
   * `dependsOn` field permanently gated — "Select region first" beside a
   * filled `region`. The two in-repo hosts, `DetailSection` and
   * `HeaderHighlight`, both pass it.
   *
   * STAGED, not saved: a parent edited in the same session re-scopes the child
   * before anything is written, and clearing it re-gates the child — the grid
   * inline editor's `pendingRow ?? row` (objectui#7188) and the form's live
   * watched record.
   */
  dependentValues?: Record<string, unknown>;
}

/**
 * The single inline-edit input for a record field, extracted from
 * `DetailSection` so any record-level surface — the details body AND the
 * highlights strip (objectui#2407) — renders an identical editor. Covers every
 * widget the detail body handles: `SelectField`, `BooleanField`, `LookupField`,
 * `UserField`, the numeric
 * widgets (`NumberField` / `CurrencyField` / `PercentField`, objectui#2572), the
 * structured composites (`AddressField` / `LocationField` / `GeolocationField`,
 * objectui#4216 — their value is an OBJECT, so the text fallback both displayed
 * and WROTE it wrong), and the plain date/text input (with ISO date coercion +
 * object-value guarding so an unexpanded reference never leaks
 * "[object Object]").
 *
 * Editability GATING (computed types, `readonly`, system fields, object
 * lifecycle) stays with the host — this component only renders the editor once
 * the host has decided the field is editable.
 *
 * ## Why there is no validation in this component (objectui#6868)
 *
 * ⚖️ This is a DECISION, not an omission. The maintainer ruled on 2026-08-31
 * (decision batch #13, on
 * https://github.com/objectstack-ai/objectui/issues/6868) that **the server is
 * the validation authority on the inline-edit surface**. Recorded here because
 * this component is where the question gets asked: it imports from
 * `@object-ui/fields` but never calls `buildValidationRules`, and it takes no
 * `error` prop — which for two years read as an oversight and is now a ruling.
 *
 * ⛔ Do NOT "fix" that by adding rules here. The ruling refuses both an
 * extracted shared evaluator and a second validation implementation on this
 * surface: the server is the only rule source, and the front end only presents
 * its verdict. Every rule kind reachable through this component was measured
 * against a real ObjectQL engine and refused server-side with
 * `VALIDATION_FAILED` (`required` empty and null, `minLength`, `maxLength`,
 * `email`, `url`, `min`, `max`), with the prior value left in storage.
 *
 * ✅ The presentation half lives in `<InlineEditSaveBar>`, which turns the
 * server's field-scoped refusal into a reason per field. See that module's
 * header for the ruling in full.
 *
 * ⚠️ One measured caveat for anyone extending this later: the widgets'
 * published `error` slot (objectui#3222) marks `aria-invalid` — it does NOT
 * render the message. Measured at 2c3cd1b: `NumberField` given `error` sets
 * `aria-invalid="true"` and renders no text, exactly as on the form surface
 * where `form.tsx` — not the widget — draws the visible message. So threading
 * `error` through here would buy the a11y marking, and the visible hint would
 * still be this package's markup to render.
 */
export const InlineFieldInput: React.FC<InlineFieldInputProps> = ({
  field,
  value,
  onChange,
  dataSource,
  autoFocus,
  error,
  dependentValues,
}) => {
  const editType = field.type;
  // Per-field widget override (ADR-0056 P1) — honor a `widget` hint before the
  // type switch so a structured editor replaces the raw type in inline edit too,
  // matching the form path.
  //
  // TOMBSTONE (objectui#3308): a `capability-multiselect` branch used to sit
  // here, rendering `CapabilityMultiSelectField` for that hint. The hint was
  // retired under ADR-0049 enforce-or-remove — nothing ever stamped it and its
  // registry key only existed on the docs-site-only `registerFields()` path, so
  // the form path never honored it. The component itself is unaffected —
  // Studio's `PermissionMatrixEditor` renders it directly (P2).
  //
  // A RETIRED field-type spelling meets the SAME loud refusal here that the
  // record form gives it (objectui#4914, fast-follow to #4814's ruling A′).
  //
  // This is the branch that makes the two edit surfaces agree. The form path
  // resolves `type: 'owner'` through `ComponentRegistry.get('field:owner')`,
  // which the fields package answers with `RetiredFieldTombstone` — a visible
  // refusal naming the migration, plus a console prescription deduped once per
  // spelling. Inline edit reaches no registry at all — it routes by type and
  // then delegates — so without this branch it answers a retired spelling on
  // its own, and BOTH of its answers are a working person picker: the routing
  // road while `owner` was in `INLINE_ROUTED_FIELD_TYPES`, and the delegation
  // road afterwards, because `hasFieldEditWidget('owner')` is still true
  // (`EDIT_WIDGETS` maps it to `UserField`). Removing the set member is
  // therefore not by itself a behavior change; this branch is.
  // `RetiredFieldTombstone` reports through the same once-per-spelling seam as
  // the form, so an inline-edited retired field logs the prescription once,
  // not once per row entered.
  //
  // Keyed on the TYPE and placed after the widget-hint branch, mirroring the
  // form's own precedence (an explicit `widget` hint resolves before the
  // mapped type). The table is read live from `@object-ui/fields`, never
  // copied — a future retirement is covered here the day it lands.
  if (typeof editType === 'string' && RETIRED_FIELD_TYPES[editType]) {
    return <RetiredFieldTombstone field={field} />;
  }
  // Picklist → real Select widget so users see localized option labels and
  // can't free-type invalid values. A `multiple` picklist (spec canon: `select`
  // + `multiple: true`; `multiselect` is the widget-level alias) selects
  // zero-or-more values — `SelectField` delegates to the chip picker, so the
  // value must stay an ARRAY here instead of being flattened by `String()`.
  const isMultiSelect = editType === 'multiselect' || !!field.multiple;
  if (
    (editType === 'select' || editType === 'multiselect') &&
    Array.isArray(field.options) &&
    field.options.length > 0
  ) {
    return isMultiSelect ? (
      <SelectField
        field={{ ...(field as any), multiple: true }}
        value={Array.isArray(value) ? value : value == null || value === '' ? [] : [value]}
        onChange={(v) => onChange(v)}
        error={error}
        dependentValues={dependentValues}
      />
    ) : (
      <SelectField
        field={field as any}
        value={value == null ? '' : String(value)}
        onChange={(v) => onChange(v)}
        error={error}
        dependentValues={dependentValues}
      />
    );
  }
  // Boolean → Switch widget instead of free-text "true"/"false".
  if (editType === 'boolean') {
    return (
      <BooleanField
        field={field as any}
        value={!!value}
        onChange={(v) => onChange(v)}
        error={error}
      />
    );
  }
  // File-backed fields carry a `sys_file` reference (id / descriptor / URL), not
  // free text — a plain input would surface the raw storage URL and offer no way
  // to re-upload. Render the same upload widget the form uses so inline edit can
  // preview, replace, add and remove files (objectui image inline-edit showing a
  // bare URL string).
  if (editType === 'image') {
    return <ImageField field={field as any} value={value} onChange={(v: any) => onChange(v)} error={error} />;
  }
  if (editType === 'avatar') {
    return <AvatarField field={field as any} value={value} onChange={(v: any) => onChange(v)} error={error} />;
  }
  if (editType === 'signature') {
    return <SignatureField field={field as any} value={value} onChange={(v: any) => onChange(v)} error={error} />;
  }
  if (editType === 'file' || editType === 'video' || editType === 'audio') {
    return <FileField field={field as any} value={value} onChange={(v: any) => onChange(v)} error={error} />;
  }
  // Markdown and textarea → `TextAreaField`, the fields package's multi-line
  // widget, the one a `textarea` field edits with in the record form and in a
  // grid cell (objectui#11541 for markdown, objectui#11562 for textarea). The
  // value is a plain string — for markdown, its SOURCE — and the textarea hands
  // it back exactly as typed, blank lines and trailing newline included. The
  // terminal input below cannot: it is one line, and the browser strips line
  // breaks from the value it is seeded with — "a one-line text box is lossy",
  // the reason #4228 recorded for keeping markdown out of this row, and the
  // reason a stored multi-line note lost its line breaks on the first keystroke
  // while `textarea` still edited there. `html` / `richtext` never reach this
  // component: the hosts' gate still excludes them.
  if (editType === 'markdown' || editType === 'textarea') {
    return <TextAreaField field={field as any} value={value} onChange={(v) => onChange(v)} autoFocus={autoFocus} error={error} />;
  }
  // Reference fields (lookup / master_detail / tree / user / owner) store an id
  // but may arrive `$expand`-ed as a record object. A plain text input would
  // stringify that to "[object Object]", so render the real picker. The value
  // is passed through UNCOLLAPSED (objectui#2572 item 1): `LookupField`
  // resolves an expanded record object directly (display name included), so
  // stripping it to a bare id here would force the picker's hydration effect
  // to re-fetch the referenced record just to recover the name the record
  // page's `populate=` already delivered. `extractLookupId` stays exported for
  // write-side callers that need the bare id.
  //
  // `|| editType === 'owner'` stood here until objectui#4914 removed it — the
  // second half of the same lockstep as the `INLINE_ROUTED_FIELD_TYPES`
  // membership above (both faces were measured together on objectui#4814's
  // patch round). A retired spelling never reaches this line now: the refusal
  // at the top of the component answers it first.
  const isUserRef = editType === 'user';
  const isLookupRef =
    editType === 'lookup' ||
    editType === 'master_detail' ||
    editType === 'tree' ||
    (!!field.reference && !TEXTUAL_REF_FALLBACK_TYPES.has(editType as string));
  if (isUserRef || isLookupRef) {
    const RefWidget = isUserRef ? UserField : LookupField;
    return (
      <RefWidget
        field={field as any}
        value={value}
        onChange={(v: any) => onChange(v)}
        dataSource={dataSource}
        error={error}
        dependentValues={dependentValues}
      />
    );
  }
  // Numeric types → the SAME dedicated widgets the form uses (objectui#2572
  // item 3), so inline edit gets a real number input (numeric keyboard,
  // min/max/step from the field metadata) and currency/percent keep their
  // symbol adornment + display conversion instead of a free-text input.
  // (`decimal`/`integer` are not spec FieldTypes — metadata should declare
  // `number` with `scale`, so they are deliberately not aliased here.)
  if (editType === 'number') {
    return <NumberField field={field as any} value={value} onChange={(v: any) => onChange(v)} autoFocus={autoFocus} error={error} />;
  }
  if (editType === 'currency') {
    return <CurrencyField field={field as any} value={value} onChange={(v: any) => onChange(v)} autoFocus={autoFocus} error={error} />;
  }
  if (editType === 'percent') {
    return <PercentField field={field as any} value={value} onChange={(v: any) => onChange(v)} autoFocus={autoFocus} error={error} />;
  }
  // Structured-value composites → the SAME widgets the create/edit dialog uses
  // (objectui#4216). Their stored value is an OBJECT, and the terminal text
  // input below is a value-destroying editor for all three: it renders the
  // object through `coerceToSafeValue`, whose general-object case extracts
  // `name || label || externalId || id || _id` — none of which an address or a
  // coordinate pair has — so the box reads the literal "[Object]", and then
  // emits whatever is typed over it as a bare STRING that replaces the whole
  // object on save. Routing them here is what makes the sub-fields the editing
  // surface and keeps the write an object, so the inline path and the form path
  // cannot diverge on the value SHAPE they write back.
  //
  // The widgets are the form's own (`fieldWidgetMap`, and `FieldEditWidget`'s
  // "structured-value editors" block) — all three are dependency-light, so a
  // static import here costs the detail bundle nothing a map/code editor would.
  //
  // `autoFocus` follows the numeric branches' convention: each widget forwards
  // the DOM pass-through set onto its FIRST focusable sub-input (street /
  // latitude / the coordinate box), so entering inline edit on the field lands
  // the caret in the same place a single-input type would.
  if (editType === 'address') {
    return <AddressField field={field as any} value={value} onChange={(v: any) => onChange(v)} autoFocus={autoFocus} error={error} />;
  }
  if (editType === 'location') {
    return <LocationField field={field as any} value={value} onChange={(v: any) => onChange(v)} autoFocus={autoFocus} error={error} />;
  }
  if (editType === 'geolocation') {
    return <GeolocationField field={field as any} value={value} onChange={(v: any) => onChange(v)} autoFocus={autoFocus} error={error} />;
  }
  // Everything the switch did not route, and that is not class D, edits with
  // the SAME widget the form uses (objectui#4220). One fallback branch, not a
  // per-type copy of the routing above: the tail this closes is the part of the
  // #4216 sweep where the terminal input is not merely the wrong control but a
  // value-destroying one —
  //
  //   class A (`tags`, `checkboxes`, an options-less multi picklist) stores a
  //   `string[]`, and `coerceToSafeValue`'s array case is `.join(', ')`, so the
  //   box offered `"a, b"` for editing and saved that string over the array;
  //   class C (`toggle`, `slider`, `progress`, `rating`, `radio`) stores a
  //   boolean / number / one-of-`options`, all of which came back as strings.
  //
  // Plus every type the fields package edits inline that this switch simply had
  // no branch for (`json` → the JSON editor, `color`, `qrcode`, `time`, `code`).
  //
  // The design calls INSIDE class A — what an options-less `checkboxes` offers,
  // how a chip row renders — are `FieldEditWidget`'s to make, and it already
  // makes them for the grid's inline cell editor; asking it here is the point of
  // delegating rather than routing type by type. Types the hosts gate out entirely (containers,
  // credentials, computed — #4228 / #3355) never arrive here at all, and none of
  // them has a widget anyway, so this branch cannot re-open those.
  //
  // `date` and `datetime` take this branch too (objectui#12759), so the record
  // page draws the platform date picker the grid cell, the forms, the dialogs
  // and the kanban dialog draw (objectui#12622 / #12642 / #12664), with its
  // placeholder and digit order in the console locale rather than the
  // machine's. A `datetime` edits its date AND time there: the picker reads the
  // instant as the local wall clock, a day picked in its calendar keeps that
  // time, and it writes back an ISO instant. The native `<input type="date">`
  // this replaces could hold no time, so it re-emitted local midnight and an
  // inline edit of the day silently dropped the stored time. A `date` field
  // still writes the plain `YYYY-MM-DD` (objectui#12206): the picker writes the
  // day unchanged. The picker answers a stored day that does not exist
  // (`2026-02-30`) as `DateField` did (objectui#10625 / #10567): an empty,
  // `aria-invalid` box described by a notice naming the stored string, and
  // nothing written until the user enters a day. It reads typed text on blur
  // and on Enter; the save bar's button takes focus first, so that blur lands
  // before the save reads the draft.
  //
  // `autoFocus` follows the numeric/composite branches' convention: it is
  // forwarded, and `FieldEditWidget` hands it to the widget, whose own
  // `toDomProps` whitelist lands it on the real focusable control. No
  // `dataSource` is needed — every record-querying type is routed above.
  if (!usesInlinePlainTextInput(field) && isKnownFieldType(editType) && hasFieldEditWidget(editType)) {
    return (
      <FieldEditWidget
        field={field as any}
        value={value}
        onChange={(v: any) => onChange(v)}
        autoFocus={autoFocus}
        error={error}
        dependentValues={dependentValues}
      />
    );
  }
  // Only the raw text fallback remains below.
  // Coerce objects (e.g. an unexpanded reference that slipped through type
  // detection) to a readable label rather than leaking "[object Object]".
  const inputValue = value == null
    ? ''
    : typeof value === 'object'
      ? String(coerceToSafeValue(value) ?? '')
      : String(value);
  return (
    <input
      type="text"
      // Marks the RAW TEXT fallback, the lossy path the guard hunts for.
      data-testid={INLINE_PLAIN_TEXT_INPUT_TESTID}
      autoFocus={autoFocus}
      // No widget sits behind this branch to honour the #3222 slot, so the
      // refusal marking is applied to the element itself.
      aria-invalid={error ? true : undefined}
      className="w-full px-2 py-1.5 text-sm border rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring"
      value={inputValue}
      onChange={(e) => onChange(e.target.value)}
    />
  );
};
