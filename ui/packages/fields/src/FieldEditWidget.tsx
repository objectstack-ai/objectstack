/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React from 'react';
import type { FieldWidgetComponentProps } from './widgets/types.js';
// The package's own executor of the DOM pass-through declaration, reused here
// rather than re-listed — see the note on this component's return statement.
import { toDomProps } from './widgets/toDomProps.js';
// The package's own executor of the NON-DOM half of the same declaration
// (`f08bcd9af`) — a separate function because those keys are not DOM-legal.
import { toHostProps } from './widgets/toHostProps.js';

// The SAME dedicated widgets the form renders — reused for in-place editing
// (e.g. the data grid's inline cell editor) so a select edits as a dropdown, a
// boolean as a checkbox, a date as a date picker, etc. — never a bare text box.
import { TextField } from './widgets/TextField.js';
import { TextAreaField } from './widgets/TextAreaField.js';
import { NumberField } from './widgets/NumberField.js';
import { CurrencyField } from './widgets/CurrencyField.js';
import { PercentField } from './widgets/PercentField.js';
import { SliderField } from './widgets/SliderField.js';
import { RatingField } from './widgets/RatingField.js';
import { BooleanField } from './widgets/BooleanField.js';
import { SelectField } from './widgets/SelectField.js';
import { MultiSelectField } from './widgets/MultiSelectField.js';
import { RadioField } from './widgets/RadioField.js';
import { CheckboxesField } from './widgets/CheckboxesField.js';
import { TagsField } from './widgets/TagsField.js';
import { TimeField } from './widgets/TimeField.js';
import { EmailField } from './widgets/EmailField.js';
import { PhoneField } from './widgets/PhoneField.js';
import { UrlField } from './widgets/UrlField.js';
// Relational pickers — the SAME standard widgets the form uses. They read the
// related-object dataSource from SchemaRendererContext (which the grid already
// provides), so they drop straight into an inline cell.
import { LookupField } from './widgets/LookupField.js';
import { UserField } from './widgets/UserField.js';
// Structured-value editors — lightweight (no map/code-editor deps), same
// widgets the form uses. Drop into a cell like the rest.
import { ColorField } from './widgets/ColorField.js';
import { AddressField } from './widgets/AddressField.js';
import { LocationField } from './widgets/LocationField.js';
import { GeolocationField } from './widgets/GeolocationField.js';
import { CodeField } from './widgets/CodeField.js';
import { ObjectField } from './widgets/ObjectField.js';
import { QRCodeField } from './widgets/QRCodeField.js';
// The FORM's spec-alias table (`secret` → `field:password`, `tree` → `field:lookup`,
// …) — inline resolution reuses it so spec spellings get the form's decision.
// `isRetiredFieldType` / `reportRetiredFieldType` come from the same module on
// purpose: it re-exports the live retirement gate (objectui#4814, hoisted to
// `@object-ui/core` by objectui#4914), and importing them from here — rather
// than from the `./index` barrel, which re-exports this file — keeps the module
// graph acyclic, exactly as the alias import already does (see the note at
// index.tsx's `mapFieldTypeToFormType` re-export).
//
// `isRetiredFieldType` used to be defined locally in this file, quantified over
// the table for objectui#4931. That definition is now THE gate the maintainer
// ruled into `@object-ui/fields`' surface (objectui#4914 ruling B) and the same
// function object the other six faces call, so the local copy is gone rather
// than kept in sync: this file was the precedent for the shape, not a second
// implementation of it.
import {
  mapFieldTypeToFormType,
  isRetiredFieldType,
  reportRetiredFieldType,
} from './field-type-alias.js';

/**
 * The platform date picker (objectui#12622, objectui#12642), the face the
 * record form and the action-param and bulk dialogs already draw for `date` /
 * `datetime`, now the inline editors' too (objectui#12664): a text box in the
 * console locale's format with a calendar popover, in place of the browser's
 * native input, whose placeholder and digit order follow the machine's locale.
 *
 * LAZY, through the same `import()` `fieldWidgetMap` uses, so the picker stays
 * in its own `fields-date-picker` chunk (`apps/console/vite.config.ts`, checked
 * by `PER_CHUNK_MEMBERSHIP_CARVE_OUTS` in `scripts/check-eager-closure-budget.mjs`)
 * and never joins the eager closure this module is part of. A static import
 * here would put it on every page load. {@link FieldEditWidget} renders these
 * two inside its own `Suspense` boundary, so no host has to provide one.
 *
 * The picker reads its typed text when the control loses focus (and on
 * Enter); the grid's cell seam blurs the control before it commits, which is
 * what makes that text reach the edit (objectui#12664, the `renderCellEditor`
 * contract on `DataTableSchema`).
 */
const DatePickerEditWidget = React.lazy(() =>
  import('./widgets/date-picker/DatePickerField.js').then((m) => ({ default: m.DatePickerField })),
);
const DateTimePickerEditWidget = React.lazy(() =>
  import('./widgets/date-picker/DatePickerField.js').then((m) => ({ default: m.DateTimePickerField })),
);

/** The {@link EDIT_WIDGETS} entries that load lazily and need a `Suspense` boundary. */
const LAZY_EDIT_WIDGETS: ReadonlySet<unknown> = new Set([
  DatePickerEditWidget,
  DateTimePickerEditWidget,
]);

/**
 * Field types that edit in place with a dedicated widget. Keyed by the raw
 * field `type` (the widget map mirrors the form's `mapFieldTypeToFormType`).
 * Rich/heavy types (file, image, lookup, richtext, …) are intentionally absent
 * so callers fall back to their own simpler editor.
 */
const EDIT_WIDGETS: Record<string, React.ComponentType<FieldWidgetComponentProps<any>>> = {
  text: TextField,
  textarea: TextAreaField,
  number: NumberField,
  currency: CurrencyField,
  percent: PercentField,
  slider: SliderField,
  progress: SliderField,
  rating: RatingField,
  boolean: BooleanField,
  toggle: BooleanField,
  select: SelectField,
  status: SelectField,
  multiselect: MultiSelectField,
  radio: RadioField,
  checkboxes: CheckboxesField,
  tags: TagsField,
  date: DatePickerEditWidget,
  datetime: DateTimePickerEditWidget,
  time: TimeField,
  email: EmailField,
  phone: PhoneField,
  url: UrlField,
  // Relational — the record/user pickers, same as the form (the form maps
  // master_detail to the single-value LookupField too, see fieldWidgetMap).
  lookup: LookupField,
  master_detail: LookupField,
  user: UserField,
  // `owner: UserField` sat here — pointing at the very same widget `user`
  // resolves to — until objectui#4931 removed it, closing the last road by
  // which objectui#4814's retirement could be bypassed. Membership in THIS
  // table is what made `resolveInlineEditType` return the spelling unchanged
  // (it short-circuits on `type in EDIT_WIDGETS`), so the alias table was never
  // consulted and the retirement never applied: `hasFieldEditWidget('owner')`
  // answered `true` and every host built on this seam still offered a working
  // person picker while the record form answered the same field with a
  // tombstone refusal. Do not re-add it — and note that re-adding it alone
  // would no longer resurrect the picker, because the retirement gate below
  // is keyed on the retirement table, not on this map's keys.
  // Structured-value editors — same widgets the form uses.
  color: ColorField,
  address: AddressField,
  location: LocationField,
  geolocation: GeolocationField,
  code: CodeField,
  // `json` is keyed DIRECTLY, ahead of the alias table (objectui#11448). The
  // form now resolves it to `field:object`, and `object` is excluded below as a
  // container — so resolving it through the alias would have taken `json` out of
  // inline editing altogether. It keeps the inline editor it had, with the face
  // the record form uses for it: the JSON editor, not the raw-text code editor
  // that showed `[object Object]` and wrote the edit back as a string.
  json: ObjectField,
  qrcode: QRCodeField,
};

/**
 * Form field types that are deliberately NOT given an inline editor — every
 * other form widget type must be in {@link EDIT_WIDGETS}. This pairing is
 * enforced by a test against the form's widget map (`FORM_FIELD_TYPES`) so the
 * two can't silently drift again (which is how `lookup` was missed). To add a
 * type to inline editing, move it from here into EDIT_WIDGETS.
 */
export const INLINE_EXCLUDED_FIELD_TYPES = new Set<string>([
  // Computed / read-only — the grid keeps these non-editable (no value to author).
  'formula', 'summary', 'auto_number',
  // Binary / attachment — edited from the record form, shown read-only in the grid.
  'file', 'image', 'avatar', 'signature',
  // Heavy / full editors — better in the record form than a cell.
  'markdown', 'html', 'richtext',
  // Credentials — never inline-editable. Both are masked on read, so the cell has
  // no real value to seed an editor with, and the grid's fallback is a PLAIN TEXT
  // input: it would render the mask as if it were the value and write it straight
  // back. `secret` additionally round-trips through an encrypted store (ADR-0100,
  // data/field.zod.ts) — the cell holds an opaque ref, not the secret.
  'password', 'secret',
  // Containers / non-authorable — a sub-form / sub-grid / embedding vector
  // doesn't belong in a single cell.
  'object', 'grid', 'vector',
  // Widget-hint-only pickers — authored in the record form (they depend on
  // sibling fields / a loaded object catalog), not inline in a grid cell.
  'object-ref', 'filter-condition', 'recipient-picker',
  'position-ref', 'permission-ref',
]);

/** Field types whose value is chosen in one discrete gesture (no free typing). */
export const DISCRETE_EDIT_TYPES = new Set<string>([
  'boolean', 'toggle', 'select', 'status', 'radio', 'rating',
]);

/**
 * Resolve a field type to its inline-editing key: the raw type when the
 * widget/exclusion tables name it directly, otherwise its form-alias target
 * (`mapFieldTypeToFormType`, `field:` prefix stripped).
 *
 * The tables are keyed by the FORM's spellings, but spec field types reach
 * this layer in the SPEC's spellings — `json`, `tree`, `composite`, `record`,
 * `repeater`, `video`, `audio`, `autonumber` are aliases in the form map and
 * were keys in NEITHER table here, so the grid silently fell back to a plain
 * text input for all of them: typing over structured JSON or a hierarchy ref
 * is a value-corruption path (#2942). Resolving through the same alias table
 * the form uses gives each spec type the form's own decision: `tree` → the
 * lookup picker, and the container/computed/binary families → their documented
 * exclusions. (`json` is keyed directly in {@link EDIT_WIDGETS} — see there.)
 */
function resolveInlineEditType(type: string): string {
  if (type in EDIT_WIDGETS || INLINE_EXCLUDED_FIELD_TYPES.has(type)) return type;
  return mapFieldTypeToFormType(type).replace(/^field:/, '');
}

/**
 * True when a field type has a dedicated in-place edit widget.
 *
 * A RETIRED spelling answers `false` unconditionally, ahead of every table
 * lookup (objectui#4931). This is the gate the retirement was missing: hosts
 * ask this question to decide whether to hand a cell to {@link FieldEditWidget},
 * and while it answered `true` for a retired spelling the whole tombstone was
 * bypassable by delegation — the grid's inline cell editor rendered a working
 * person picker for a field the record form refuses.
 *
 * Keyed on the retirement TABLE rather than on the raw `type`, and checked
 * BEFORE `resolveInlineEditType`, so it holds even if a future retired spelling
 * is still (or again) a key of {@link EDIT_WIDGETS} — closing the class, not
 * one spelling.
 */
export function hasFieldEditWidget(type: string | undefined): boolean {
  if (!type) return false;
  if (isRetiredFieldType(type)) return false;
  return resolveInlineEditType(type) in EDIT_WIDGETS;
}

/**
 * True when a field type is deliberately NOT inline-editable (alias-aware:
 * `composite` resolves to the excluded `object`, `video` to `file`, …).
 * Grid hosts must treat these as read-only cells — falling back to a plain
 * text editor is exactly the corruption path the exclusion exists to close.
 */
export function isInlineExcludedFieldType(type: string | undefined): boolean {
  if (!type) return false;
  // A RETIRED spelling is excluded from inline editing (objectui#4931).
  //
  // This is the half that decides what the grid actually DOES once
  // `hasFieldEditWidget` starts answering `false`, and without it the fix would
  // trade one silent failure for another. `ObjectGrid` marks a column
  // `editable: false` exactly when `isFieldInlineEditable` is false (which
  // consults this predicate) — otherwise the column stays editable, the cell
  // editor asks `hasFieldEditWidget`, gets `false`, returns `null`, and
  // DataTable falls back to its built-in PLAIN TEXT input. For a stored
  // person-reference that input displays the coerced value and writes a bare
  // string straight back over it. So the retirement routes the cell to the
  // grid's normal read-only path — the same disposition `password`, `formula`
  // and `composite` get, and for the same reason: a text box here is a
  // value-corruption path, not a graceful degradation.
  //
  // Deliberately a predicate-level answer and NOT a membership in
  // `INLINE_EXCLUDED_FIELD_TYPES`: that set is documented as the types this
  // renderer *chose* not to edit in place and is asserted to contain only
  // renderable form types, which a retired spelling is precisely not. The
  // predicate already diverges from raw set membership for the alias-resolved
  // spellings (`composite` → `object`, `video` → `file`), so answering on
  // behalf of the retirement table is the established shape here.
  if (isRetiredFieldType(type)) return true;
  return INLINE_EXCLUDED_FIELD_TYPES.has(resolveInlineEditType(type));
}

/**
 * Relational picker widgets (lookup / master_detail / user) render best in a
 * grid cell as a single-line, borderless trigger — so the selected record's
 * NAME shows inside the trigger instead of a chip stacked above a separate
 * "Select…" button (which double-stacks and wastes the row height). This
 * mirrors how the line-item grid (`GridField`) renders its lookup cells.
 *
 * `owner` was listed here (objectui#4914 item 11) until objectui#4931 dropped
 * it in the same stroke as the routing-table key above. Purely cosmetic on its
 * own — it only ever added `compact` to a widget that is no longer reached —
 * but it is removed rather than left to rot, because a retired spelling
 * lingering in a sizing set is how the next reader concludes the type is still
 * live here.
 */
const COMPACT_EDIT_TYPES = new Set<string>(['lookup', 'master_detail', 'user']);

/**
 * Render the dedicated edit widget for a field's type — the SAME control the
 * form uses — as a controlled `{ value, onChange, field }` input. Returns
 * `null` for types without a registered widget so the caller can fall back to
 * a plain editor.
 *
 * The host's DOM pass-through set is forwarded WHOLE (objectui#6909). This
 * component's props are `FieldWidgetComponentProps`, so a caller may already
 * pass `id`, `name`, `autoFocus`, `tabIndex`, `onBlur`, `onFocus`, `onClick`,
 * any `aria-*` and any `data-*` with no type error — but the body used to
 * destructure five keys and render the widget with those, so `autoFocus` was
 * the ONLY survivor of the whole block and everything else was silently
 * dropped. That is this package's own first-class defect class, named in
 * `widgets/toDomProps.ts`: a key that type-checks, reads as supported, and
 * silently never reaches the element (objectui#3290's `aria-required`,
 * objectui#3222's validation slot). Forwarding is not a widening: the keys were
 * already declared, and each widget still re-filters through its own
 * `toDomProps` before anything reaches a DOM element.
 *
 * `autoFocus`' original reason survives inside that set — an inline-edit host
 * enters edit mode ON a field and expects the caret to land there
 * (objectui#4220, the detail page's delegation) — and so does its property:
 * each widget's own whitelist carries these onto the real focusable control, so
 * nothing here needs to know which element that is. A host that passes nothing
 * is unaffected.
 *
 * The host's NON-DOM set is forwarded WHOLE too (`f08bcd9af`), through the
 * sibling executor `toHostProps`. The DOM fix left the other half of the
 * contract undelivered: `error`, `onUploadingChange` and the "Host plumbing"
 * block (`dataSource`, `dependentValues`, `dependsOn`, `dependsOnLabels`,
 * `emptyHint`, `onSelectRecord`, `onCreateNew`) still type-checked, read as
 * supported, and never reached the widget. `error` was the live one:
 * `InlineFieldInput` has passed `error={error}` since PR #7109 and this factory
 * dropped it, so a control that had failed validation never reported
 * `aria-invalid`. Forwarding is not a widening — every one of those keys is
 * already declared on `FieldWidgetComponentProps`, the same argument #7009
 * landed on in this file.
 *
 * ⛔ They do NOT go through `toDomProps`. None of them is DOM-legal, and that
 * whitelist is closed for exactly this reason — a `dataSource` adapter routed
 * there becomes `dataSource="[object Object]"` on an `<input>`, the leak the
 * helper exists to prevent. `toHostProps`' direction-3 assertion makes the two
 * sets provably disjoint, so the order of the two spreads below is not a
 * question anyone has to answer again.
 *
 * ## `dataSource` precedence: the explicit prop WINS
 *
 * Delivering `dataSource` can change behaviour where before it could not
 * arrive, because the relational widgets fall back to `SchemaRendererContext`
 * (which the grid already provides). The precedence is therefore STATED rather
 * than left to emerge: **a host's explicit `dataSource` prop wins over the
 * context**. That is not a new decision — `LookupField` already resolves
 * `props.dataSource ?? lookupField?.dataSource ?? fieldMeta?.dataSource ??
 * contextDataSource` and documents that order on the line that does it. This
 * factory is a CONDUIT and resolves nothing: adding a resolution here would
 * give `dataSource` a second author, the `field || schema` shape objectui#3233
 * removed. A host that passes no `dataSource` keeps reading the context exactly
 * as before, so no in-repo host changes behaviour. The full per-key precedence
 * table lives on `toHostProps`, next to the list it governs.
 */
export function FieldEditWidget(
  props: FieldWidgetComponentProps<any>,
): React.ReactElement | null {
  const { field, value, onChange, readonly } = props;
  // A RETIRED spelling never reaches a widget here, whatever the tables say,
  // and it says so out loud (objectui#4931). This branch is for the caller that
  // ignores `hasFieldEditWidget` and calls this component directly: without it
  // such a host would still be handed the person picker for a field the record
  // form refuses, which is the exact contradiction #4814's tombstone exists to
  // end.
  //
  // The loud half is the once-per-spelling console prescription, not a rendered
  // alert, and that is deliberate: this component's hosts are CELL-sized (the
  // grid's inline editor, the kanban required-fields dialog), and #4814 settled
  // the same question the same way for the read path — "there is no visible
  // alert a table CELL can carry without wrecking the row". The visible refusal
  // is the record form's job, and `RetiredFieldTombstone` is what it renders.
  //
  // Returning `null` is this function's documented contract for "no dedicated
  // widget", not a new fallback invented here — and every in-repo host is
  // already routed away from that path by the two predicates above
  // (`hasFieldEditWidget` → false, `isInlineExcludedFieldType` → true), so the
  // grid marks the column read-only instead of opening a plain text box.
  if (field?.type && isRetiredFieldType(field.type)) {
    reportRetiredFieldType(field.type);
    return null;
  }
  const resolved = field?.type ? resolveInlineEditType(field.type) : undefined;
  const Widget = resolved ? EDIT_WIDGETS[resolved] : undefined;
  if (!Widget) return null;
  // `compact` is a declared widget prop (objectui#3221 closed this type), so
  // the spread no longer needs an `any` escape hatch to get past it.
  const compactProps = resolved && COMPACT_EDIT_TYPES.has(resolved) ? { compact: true } : {};
  // `toDomProps` — this package's own runtime executor of the declaration — is
  // REUSED rather than re-listed here, and that reuse is the guard. Its
  // direction-2 compile-time assertion already makes
  // `keyof FieldWidgetDomProps extends DomPassThroughKey` an error to violate,
  // so a key added to the declared DOM block now reaches the widget through
  // this factory automatically. A private key list written out here would be a
  // SECOND judge of the same declaration — exactly what `toDomProps.ts` argues
  // against ("one mechanism, two declarations, each bound to the contract it
  // executes — not two judges") — and would be free to drift, which is how this
  // factory came to deliver one key out of seven in the first place.
  //
  // The set is a deliberate superset of `FieldWidgetDomProps`: it also carries
  // `className` and `disabled`, declared on the controlled-input block and
  // forwarded by the same executor for the reason stated there — withholding
  // them makes it a silent styling- and interactivity-dropper.
  //
  // The semantic props stay explicit and come AFTER the spread. They are not in
  // the whitelist, so there is no collision to resolve; ordering them this way
  // states that this component OWNS them and a host cannot displace them.
  //
  // `toHostProps` is the same reuse argument applied to the other half of the
  // declaration (`f08bcd9af`): the declared NON-DOM keys — `error` and the
  // "Host plumbing" block — travel as COMPONENT props, never through the DOM
  // whitelist, which is closed against exactly them. The two executors are
  // asserted disjoint at compile time, so neither spread can shadow the other,
  // and `compact` below still wins because the factory owns it.
  const widget = (
    <Widget
      {...toDomProps(props)}
      {...toHostProps(props)}
      field={field}
      value={value}
      onChange={onChange}
      readonly={readonly}
      {...compactProps}
    />
  );
  if (!LAZY_EDIT_WIDGETS.has(Widget)) return widget;
  // The picker's chunk is loading (objectui#12664). The placeholder takes the
  // control's height and holds no input, so nothing typed before the chunk
  // arrives can be lost: there is nowhere to type it.
  return (
    <React.Suspense
      fallback={
        <div
          aria-busy="true"
          data-testid="field-edit-widget-loading"
          className="h-9 w-full rounded-md border border-input bg-muted/40"
        />
      }
    >
      {widget}
    </React.Suspense>
  );
}
