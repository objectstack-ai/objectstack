/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Field Type Definitions
 * 
 * Comprehensive field type system for ObjectQL protocol.
 * Defines all field types supported in ObjectGrid and ObjectForm components.
 * 
 * @module field-types
 * @packageDocumentation
 */

import type { Field as SpecField } from '@objectstack/spec/data';

/**
 * A field's `dependsOn` in the shape `@objectstack/spec` declares at FIELD
 * level — derived from `@objectstack/spec/data`'s `Field` by reference rather
 * than restated (objectui#6153), so the two cannot drift: a list of controlling
 * sibling field names, or `{ field, param }` entries mapping a sibling onto the
 * remote query parameter a dependent lookup filters by.
 *
 * Measured on the installed `@objectstack/spec` (18.1.0), `FieldSchema` declares
 * `dependsOn` as an OPTIONAL ARRAY of `string | { field, param? }` — never a
 * bare string. That is deliberately narrower than `DependsOnInput` (`form.ts`),
 * the shape the widget prop `FieldWidgetComponentProps.dependsOn` and
 * `FormField.dependsOn` take, which also admits a bare parent name and `null`:
 * `FieldSchema.safeParse` answers `invalid_type` at `dependsOn` to a bare
 * string on a field document, with the same field carrying `['country']`
 * accepted as the control — so declaring the wider shape here would let an
 * author write metadata the publish door refuses. Every runtime reader takes
 * `DependsOnInput`, and this type is assignable to it (pinned in
 * `__tests__/field-metadata-depends-on-declared-6153.test.ts`).
 */
export type FieldDependsOn = NonNullable<SpecField['dependsOn']>;

/**
 * Base field metadata interface
 * Common properties shared by all field types
 */
export interface BaseFieldMetadata {
  /**
   * Field name/identifier
   */
  name: string;
  
  /**
   * Display label
   */
  label?: string;
  
  /**
   * Field type identifier
   */
  type: string;
  
  /**
   * Help text drawn under the field's control on a form —
   * `@objectstack/spec`'s `FieldSchema.inlineHelpText` ("Help text displayed
   * below the field in forms"), typed BY REFERENCE (objectui#12213). It is
   * the key Studio's object field inspector writes. The record form reads it
   * first and falls back to `description` (`fieldHelpText` in
   * `@object-ui/fields`), and flow screens draw it in the same place.
   *
   * It replaces `help`, which this interface declared until objectui#12213:
   * the spec refuses `help` by name and suggests `inlineHelpText`, so a field
   * written with it could not be published.
   */
  inlineHelpText?: SpecField['inlineHelpText'];

  /**
   * Description text. The record form draws it under the control when the
   * field declares no `inlineHelpText`.
   */
  description?: string;
  
  /**
   * Whether field is required
   */
  required?: boolean;
  
  /**
   * Whether field is read-only
   */
  readonly?: boolean;

  /**
   * Auto-injected system/audit/ownership field (e.g. `created_at`,
   * `updated_by`, `organization_id`, `owner_id`), stamped by the framework's
   * `applySystemFields`. Surfaces that separate framework-managed bookkeeping
   * from author-declared business fields (e.g. default list-column derivation)
   * branch on this flag. Mirrors the spec `Field.system` property.
   */
  system?: boolean;

  /*
   * There is deliberately no `mobile_fullscreen` here (objectui#12242, ruling
   * A). It is not authored metadata: it is a PROJECTION of the FORM-level
   * `ObjectFormSchema.mobile.fullscreenLongText` that `ObjectForm`
   * (`@object-ui/plugin-form`) stamps onto each long-text field's carrier
   * while it builds the form, and `@objectstack/spec`'s `FieldSchema` refuses
   * it by name, so no published object carries it. A key only the host
   * writes is typed where its producer and its consumers meet, never on this
   * authoring face (AGENTS.md #0.1): `LongTextCarrierHandoff` in
   * `@object-ui/fields`, which `TextAreaField` and `RichTextField` read the
   * flag through. The flag keeps its one carrier, the widget's `field`
   * (objectui#3245); only its declaration moved.
   */

  /**
   * Placeholder text
   */
  placeholder?: string;
  
  /**
   * Default value
   */
  defaultValue?: any;
  
  /**
   * Whether field is sortable
   */
  sortable?: boolean;
  
  /**
   * REFUSED BY NAME (objectui#12242): `@objectstack/spec`'s `FieldSchema`
   * refuses `filterable` with `unrecognized_keys` and declares no field-level
   * filter switch, and no reader reads it off field metadata. It is retired
   * with no replacement key: a list view declares its filterable fields on
   * the view.
   * @deprecated Nothing reads this key. Remove it.
   */
  filterable?: never;

  /**
   * Show the field only while this predicate is true —
   * `@objectstack/spec`'s `FieldSchema.visibleWhen`, typed BY REFERENCE
   * (objectui#12242): a bare CEL string (`record.type == 'invoice'`) or the
   * spec's expression envelope (`{ dialect, source }`). Both form builders in
   * `@object-ui/plugin-form` (`ObjectForm` and `fromObjectSchema`) carry it
   * onto the runtime form field, and the form renderer evaluates it against
   * the record.
   */
  visibleWhen?: SpecField['visibleWhen'];

  /**
   * REFUSED BY NAME (objectui#12242): renamed {@link visibleWhen}, which is
   * the spelling `FieldSchema` suggests for it ("did you mean `visible_on` →
   * `visibleWhen`?"). The value is a CEL predicate, not the
   * `{ field, operator, value }` object this member used to declare: the
   * form builders read predicate text only, so that object was never drawn
   * as a gate. Neither form builder reads this spelling any more.
   * @deprecated Write `visibleWhen`. Nothing reads this spelling.
   */
  visible_on?: never;

  /**
   * REFUSED BY NAME (objectui#12242): `@objectstack/spec`'s `FieldSchema`
   * refuses `validate` with `unrecognized_keys`, and a field document is JSON,
   * which cannot carry the function this member used to declare. A record's
   * checks are the OBJECT's `validations[]` rules, which the server runs on
   * the writes each rule names: `script` for a CEL predicate, `format` for a
   * regex. `buildValidationRules` (`@object-ui/fields`) no longer reads this
   * key.
   * @deprecated Declare a `validations[]` rule on the object. Nothing reads this key.
   */
  validate?: never;

  /*
   * There is deliberately no `depends_on` here (objectui#7357). It was
   * objectui's own snake_case twin of {@link BaseFieldMetadata.dependsOn} and
   * never a `@objectstack/spec` key — `FieldSchema` refuses it BY NAME, so any
   * producer that authored it produced a document the publish door rejects.
   * Retired under ADR-0049 enforce-or-remove (maintainer ruling, 2026-09-02,
   * recommendation A on objectui#6153, and no grace window per the 2026-08-27
   * ruling). One spelling, one concept: author `dependsOn`.
   */

  /**
   * Controlling sibling field(s) — the spec's field-level cascade key, declared
   * here so every field-metadata member carries it THROUGH THE DECLARED TYPE
   * (objectui#6153, maintainer ruling A, 2026-09-02). The option widgets
   * (`SelectField`, `MultiSelectField`, `RadioField`, `CheckboxesField`) gate
   * their authored option list behind it — a "select the parent first" hint
   * while any controlling value is empty — and prune a selection the parent no
   * longer offers; `LookupField` scopes its candidate queries by it.
   *
   * Two shapes, both {@link FieldDependsOn}:
   *  - `['country']` — the sibling's value is sent as both the filter field and
   *    the value (`country = ${country}`).
   *  - `[{ field: 'account', param: 'account_id' }]` — the remote parameter
   *    name differs from the local field name (dependent lookups).
   *
   * Precedence: this metadata key wins over the `dependsOn` WIDGET PROP
   * (`FieldWidgetComponentProps.dependsOn`) — the one documented inversion, see
   * `toHostProps.ts` in `@object-ui/fields`. Before this member existed the
   * widgets reached the key through an `as any`, so it worked at runtime while
   * no annotated literal could carry it — the declared/enforced gap the card
   * measured.
   */
  dependsOn?: FieldDependsOn;
  
  /*
   * There is deliberately no `indexed` here (objectui#4679). The ObjectStack
   * spec has no field-level index flag: it built no index (objectstack#2377
   * removed it) and `FieldSchema.safeParse` now rejects the key by name, so
   * any producer that authored it produced a save-blocking 422. Declare the
   * index on the object instead — `indexes: [{ name, fields, unique }]`.
   */

  /**
   * Field is unique constraint
   */
  unique?: boolean;
}

/**
 * Visibility condition type.
 *
 * @deprecated No member declares it since objectui#12242: it typed the retired
 * `BaseFieldMetadata.visible_on`, and no reader ever drew this object shape as
 * a gate. A field's visibility is `BaseFieldMetadata.visibleWhen`, a CEL
 * predicate.
 */
export type VisibilityCondition = {
  field: string;
  operator?: '=' | '!=' | '>' | '>=' | '<' | '<=' | 'in';
  value?: any;
  and?: VisibilityCondition[];
  or?: VisibilityCondition[];
};

/**
 * Validation function type.
 *
 * @deprecated No member declares it since objectui#12242: it typed the
 * function arm of the retired `BaseFieldMetadata.validate`. A record's checks
 * are the object's `validations[]` rules, run by the server.
 */
export type FieldValidationFunction = (value: any) => boolean | string | Promise<boolean | string>;

/**
 * Validation rule type.
 *
 * @deprecated No member declares it since objectui#12242: it typed the rules
 * arm of the retired `BaseFieldMetadata.validate`. Its `pattern` is not a
 * field-level key either: an object's regex check is its `format` validation
 * rule.
 */
export type FieldConstraints = {
  required?: boolean | string;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: string | RegExp;
  custom?: FieldValidationFunction;
};

/**
 * Text field metadata
 */
export interface TextFieldMetadata extends BaseFieldMetadata {
  type: 'text';
  /**
   * Minimum character length — `@objectstack/spec`'s `FieldSchema.minLength`,
   * typed BY REFERENCE (objectui#11070). The form's validation rules
   * (`buildValidationRules` in `@object-ui/fields`) read it for every field
   * type and enforce it at submit. It replaces the retired snake_case
   * `min_length`, which the spec refuses by name and nothing reads.
   */
  minLength?: SpecField['minLength'];
  /**
   * Maximum character length — `@objectstack/spec`'s `FieldSchema.maxLength`,
   * typed BY REFERENCE (objectui#11070). `buildValidationRules` enforces it at
   * submit, and the `text` widget puts it on its input as the native
   * `maxlength` stop. It replaces the retired snake_case `max_length`, which
   * the spec refuses by name and nothing reads.
   */
  maxLength?: SpecField['maxLength'];
  /**
   * REFUSED BY NAME (objectui#12242): `FieldSchema` refuses `pattern` with
   * `unrecognized_keys` and declares no field-level regex. The spec's regex
   * check is an OBJECT-level `validations[]` rule,
   * `{ type: 'format', name, field, regex, message }`, which the server runs
   * on every write that touches the field and refuses with the rule's
   * `message`. `buildValidationRules` no longer reads this key.
   * @deprecated Declare a `format` validation rule on the object. Nothing reads this key.
   */
  pattern?: never;
  /**
   * REFUSED BY NAME (objectui#12242), as {@link pattern}: the message a
   * failed regex check shows is the `format` rule's own `message`.
   * @deprecated Write the `format` rule's `message`. Nothing reads this key.
   */
  pattern_message?: never;
}

/**
 * Long text/textarea field metadata
 */
export interface TextareaFieldMetadata extends BaseFieldMetadata {
  type: 'textarea';
  /**
   * Minimum character length — `FieldSchema.minLength` by reference, read the
   * same way as {@link TextFieldMetadata.minLength} (objectui#11070).
   */
  minLength?: SpecField['minLength'];
  /**
   * Maximum character length — `FieldSchema.maxLength` by reference
   * (objectui#11070). The `textarea` widget reads it for the native stop and
   * its `{n}/{max}` counter, and `buildValidationRules` enforces it at submit.
   * It replaces the retired snake_case `max_length`.
   */
  maxLength?: SpecField['maxLength'];
  rows?: number;
}

/**
 * Markdown field metadata
 */
export interface MarkdownFieldMetadata extends BaseFieldMetadata {
  type: 'markdown';
  /**
   * Maximum character length — `FieldSchema.maxLength` by reference
   * (objectui#11070). Read the same way on all three rich-content types; see
   * {@link RichtextFieldMetadata.maxLength}.
   */
  maxLength?: SpecField['maxLength'];
  /**
   * Height of the INLINE editor, in text rows (the HTML textarea `rows`
   * attribute; the fullscreen dialog sizes itself and ignores it).
   *
   * Declared by the objectui#6140 ruling (maintainer 2026-08-25, Option A):
   * `RichTextField` — the one widget behind the `markdown`/`html`/`richtext`
   * registry keys — has always read `rows` off this metadata (default 8) while
   * no rich-content type declared it, so the running widget honoured a key an
   * annotated literal rejected. Follows the `TextareaFieldMetadata` precedent.
   *
   * A DECLARED spec key as of `@objectstack/spec` 17.3.0, which implements that
   * same ruling. Measured on the installed `@objectstack/spec` 18.1.0:
   * `FieldSchema` ACCEPTS `rows` on all four of textarea/markdown/html/
   * richtext, as an integer of at least 1 — a non-integer answers
   * `invalid_type` and 0 answers `too_small`, so "declared" does not mean "any
   * number". ⚠️ It is TYPE-GATED, not universal: on a field type that renders
   * no rows-sized editor surface the refusal arrives as a cross-field
   * REFINEMENT naming the key — deliberately NOT `unrecognized_keys` — so a
   * `text` field carrying `rows` still fails the whole field. Authored object
   * metadata may carry it on these four types and nowhere else.
   *
   * ⛔ This reverses what this docblock asserted between `0e3b3be09` and
   * `544ecba84`: at 17.2.0 the key WAS refused by name, and the sentence
   * saying so outlived the contract it described. Both directions, each behind
   * an accepting control, are re-derived by
   * `__tests__/select-option-spec-extension-7014.test.ts` — read that file's
   * verdict rather than trusting this paragraph.
   * The four inert editor keys the same ruling measured (`toolbar`/`preview`/
   * `minHeight`/`maxHeight`) stay deliberately undeclared — nothing reads them,
   * and the same file holds that door shut.
   */
  rows?: number;
}

/**
 * HTML/Rich text field metadata
 */
export interface HtmlFieldMetadata extends BaseFieldMetadata {
  type: 'html';
  /**
   * Maximum character length — `FieldSchema.maxLength` by reference
   * (objectui#11070). See {@link RichtextFieldMetadata.maxLength}.
   */
  maxLength?: SpecField['maxLength'];
  /**
   * Height of the INLINE editor, in text rows. Same declaration as
   * `MarkdownFieldMetadata.rows` (objectui#6140 Option A ruling — see the
   * docblock there): `RichTextField` reads it for all three registry keys it
   * serves. It is a DECLARED spec key on this type too, type-gated to the four
   * multiline editor types; see the measured reading in the docblock there
   * (`0e3b3be09`, corrected for the 17.3.0 boundary by `544ecba84`).
   */
  rows?: number;
}

/**
 * Rich-text (WYSIWYG) field metadata — the THIRD registry key `RichTextField`
 * serves, and the last of the three to get a declarable face.
 *
 * `markdown`, `html` and `richtext` are ONE widget (`4bb940b6e`). The first
 * two carried an exported metadata type; `richtext` carried none, so the only
 * way to write a richtext field's metadata was
 * `as unknown as MarkdownFieldMetadata` — a deliberate cast whose presence in
 * `RichTextField.rows.test.tsx` was the gap's only evidence. Neither a member
 * nor a recorded alias: a silent hole that had to be rediscovered to be seen.
 * Closed by the maintainer's objectui#7083 ruling (decision batch #71,
 * 2026-09-07), which is why the cast and its comment are gone as well.
 *
 * ## The read set below is DERIVED, not copied from the siblings
 *
 * Read off `RichTextField.tsx` on the `richtext` path, key by key:
 *
 *  - `type` — `resolveRichTextFieldType` reads `field.type` (stripping a
 *    `field:` prefix). It is THE discriminator for the three keys, and the
 *    ONLY thing that differs between them at runtime: it selects the display
 *    pipeline (`richtext` reads through the HTML renderer, objectui#5452) and
 *    the editor's format label. Nothing else in the widget branches on it.
 *  - `rows` — `richField?.rows || 8`, the inline editor's height. Declared
 *    here for the same reason objectui#6140 declared it on the two siblings:
 *    the running widget honoured a key an annotated literal rejected.
 *  - `placeholder`, `label` — also read off this carrier (the textarea
 *    placeholder, the dialog title), and both already sit on
 *    {@link BaseFieldMetadata}, so they need no redeclaration here. Listed
 *    because "derived" has to name what it found, including the keys that
 *    turned out to need no line.
 *  - `mobile_fullscreen` — the expand affordance, read off the same carrier
 *    but written there by the host (`ObjectForm`), never authored. It is
 *    typed on `LongTextCarrierHandoff` in `@object-ui/fields`, not on any
 *    field metadata type (objectui#12242).
 *
 * The readonly branch hands `field` whole to the `RICH_TEXT_CELL_RENDERERS`
 * entry for the type; both renderers there destructure `value` only, so the
 * display half contributes no metadata key.
 *
 * ## `maxLength` — the spec's bound, read by the widget AND at submit
 *
 * Declared as `@objectstack/spec`'s `FieldSchema.maxLength`, typed BY
 * REFERENCE (objectui#11070), on all three of this widget's metadata faces.
 * Two readers honour it:
 *
 *  - `RichTextField` itself (objectui#8438): the native `maxlength` stop, the
 *    character counter and the `aria-describedby` wiring, on the inline
 *    surface and in the fullscreen dialog.
 *  - `buildValidationRules` (`packages/fields/src/index.tsx`), which is
 *    GENERIC — it has no field-type gate — and which both form producers call
 *    on every field they build (`ObjectForm` and `sectionFields.ts`), so the
 *    same cap is also enforced when the form is submitted.
 *
 * It replaces the snake_case `max_length` these three types declared until
 * objectui#11070's text-family round. `FieldSchema` refuses that spelling BY
 * NAME on every field type, and nothing reads it any more: the widget's and
 * the validation rules' `maxLength ?? max_length` dual reads retired with the
 * member, at once and with no alias. The spec reading for the three types
 * this widget serves — `maxLength` admitted, `max_length` refused — is pinned
 * in `packages/fields/src/widgets/__tests__/richtext-field-metadata-7083.test.tsx`;
 * `rows` admitted is pinned separately, in
 * `packages/types/src/__tests__/select-option-spec-extension-7014.test.ts`.
 *
 * Omitting the key would leave `richtext` the one type of the three whose
 * ceiling cannot be authored under an annotation while both of its readers
 * stay live — a fresh instance of the asymmetry this member exists to end.
 *
 * The `rows` docblocks on the two siblings described the `@objectstack/spec`
 * 17.2.0 boundary, where `rows` was refused by name, and outlived it;
 * `544ecba84` corrected them in the same change that corrected this
 * paragraph, so all three now read the same boundary and none of them is the
 * odd one out.
 */
export interface RichtextFieldMetadata extends BaseFieldMetadata {
  type: 'richtext';
  /**
   * Maximum character length — `FieldSchema.maxLength` by reference
   * (objectui#11070). The widget and the form's validation rules both read
   * it; see the docblock above.
   */
  maxLength?: SpecField['maxLength'];
  /**
   * Height of the INLINE editor, in text rows. Same read as
   * `MarkdownFieldMetadata.rows` and `HtmlFieldMetadata.rows` — literally the
   * same expression, since the three registry keys are one widget: `rows`
   * lands on the inline `<Textarea>`'s `rows` attribute and the fullscreen
   * dialog ignores it (`rows={fullHeight ? undefined : rows}`).
   */
  rows?: number;
}

/**
 * Number field metadata
 */
export interface NumberFieldMetadata extends BaseFieldMetadata {
  type: 'number';
  min?: number;
  max?: number;
  /** Total number of digits (the `p` in a `decimal(p, s)` column). Not a display setting. */
  precision?: number;
  /** Number of decimal places to display (the `s` in a `decimal(p, s)` column). */
  scale?: number;
  /**
   * Explicit input granularity, overriding the value `NumberField` derives from
   * `scale`. ⛔ NOT a renderer-only invention (objectui#9875): `step` is a
   * member of `@objectstack/spec`'s own FIELD surface — a flat member of
   * `FieldSchema`, reachable from every field type — so an author who writes it
   * on a platform field has it preserved, not stripped and not refused, at both
   * doors this repo uses: the `ObjectSchema` parse `saveMetaItem` performs on a
   * metadata item of type `object`, and the served document's
   * `stripReadDecorations`. Measured with a lit control and a strictness control
   * in `__tests__/number-field-step-spec-parity-9875.test.ts`, which is also
   * what goes red if a spec release moves either answer.
   *
   * The spec's prose for the member reads "Step increment for slider", which is
   * documentation of its intended use and ⛔ not a structural fence — reading
   * that wording as a nested slider node is what made objectui#9875 report an
   * asymmetry that does not exist.
   */
  step?: number;
  /**
   * The author's digit-grouping hint — `FieldSchema.useGrouping` in
   * `@objectstack/spec`, derived from it by reference so the two cannot drift
   * (objectui#11026). `false` renders the number with no thousands separators
   * (a year reads `2026`), `true` always groups it (a scale-0 count reads
   * `2,026`), and leaving it out lets the renderer decide: a declared
   * `scale: 0` is then read as an ordinal and left ungrouped, anything else is
   * grouped the locale's way. `NumberCellRenderer` (`@object-ui/fields`) is the
   * reader; the policy itself is `formatDisplayNumber` in `@object-ui/core`.
   */
  useGrouping?: SpecField['useGrouping'];
}

/**
 * Currency field metadata
 */
export interface CurrencyFieldMetadata extends BaseFieldMetadata {
  type: 'currency';
  /**
   * The field's currency — `@objectstack/spec`'s `FieldSchema.currencyConfig`,
   * typed BY REFERENCE (objectui#12242). A field that always shows one currency
   * declares `{ currencyMode: 'fixed', defaultCurrency: 'USD' }`; a field with
   * no fixed currency (or `currencyMode: 'dynamic'`) shows the tenant's
   * default. `resolveFieldCurrency` (`@object-ui/i18n`) is the reader every
   * currency widget and cell shares.
   */
  currencyConfig?: SpecField['currencyConfig'];
  /**
   * REFUSED BY NAME (objectui#12242): `FieldSchema` refuses a field-level
   * `currency` with `unrecognized_keys`. A fixed currency is
   * {@link currencyConfig}: `{ currencyMode: 'fixed', defaultCurrency }`.
   * @deprecated Write `currencyConfig: { currencyMode: 'fixed', defaultCurrency }`.
   */
  currency?: never;
  precision?: number;
  min?: number;
  max?: number;
}

/**
 * Percent field metadata
 */
export interface PercentFieldMetadata extends BaseFieldMetadata {
  type: 'percent';
  precision?: number;
  /** Number of decimal places to display (the `s` in a `decimal(p, s)` column). */
  scale?: number;
  min?: number;
  max?: number;
}

/**
 * Boolean field metadata
 */
export interface BooleanFieldMetadata extends BaseFieldMetadata {
  type: 'boolean';
}

/**
 * Date field metadata
 */
export interface DateFieldMetadata extends BaseFieldMetadata {
  type: 'date';
  format?: string;
  /**
   * REFUSED BY NAME (objectui#12242): `FieldSchema` refuses `min_date` with
   * `unrecognized_keys` and declares no date bound (its `min` / `max` are
   * numbers), and no widget reads it. Retired with no replacement key.
   * @deprecated Nothing reads this key. Remove it.
   */
  min_date?: never;
  /**
   * REFUSED BY NAME (objectui#12242), as {@link min_date}.
   * @deprecated Nothing reads this key. Remove it.
   */
  max_date?: never;
  /**
   * Declares this date a deadline — `@objectstack/spec`'s
   * `FieldSchema.dueLike`, typed BY REFERENCE (objectui#12297). `true` lets a
   * renderer show relative overdue wording ("Overdue Nd") and an overdue
   * colour once the date has passed; a past date that is not a deadline reads
   * as neutral "N days ago" text. The spec authors it on `date` and
   * `datetime` fields only and refuses it on any other type. Display only:
   * nothing on the write path reads it.
   *
   * ⚠️ The spec says absent or `false` means "not a deadline", with nothing
   * inferred from the field's name. Today's date cells still fall back to the
   * due/deadline field-NAME convention when the key is not `true`, and `false`
   * does not suppress that fallback; retiring it is objectui#11815.
   */
  dueLike?: SpecField['dueLike'];
  /**
   * When this field's deadline is SETTLED for a record —
   * `@objectstack/spec`'s `FieldSchema.settledWhen`, typed BY REFERENCE
   * (objectui#12297): a CEL predicate over the record's own columns, read as
   * `record` (`record.status == 'done'`), as a bare string or the spec's
   * expression envelope (`{ dialect, source }`). While it holds, no overdue
   * wording or colour applies to that record. The spec requires
   * `dueLike: true` beside it and refuses it on any type but `date` /
   * `datetime`. Display only: nothing on the write path reads it.
   *
   * ⚠️ Declared, not yet rendered: no date cell evaluates it today, so a past
   * deadline on a settled record still renders overdue. The read is
   * objectui#11815.
   */
  settledWhen?: SpecField['settledWhen'];
}

/**
 * DateTime field metadata
 */
export interface DateTimeFieldMetadata extends BaseFieldMetadata {
  type: 'datetime';
  format?: string;
  /**
   * REFUSED BY NAME (objectui#12242), as {@link DateFieldMetadata.min_date}.
   * @deprecated Nothing reads this key. Remove it.
   */
  min_date?: never;
  /**
   * REFUSED BY NAME (objectui#12242), as {@link DateFieldMetadata.max_date}.
   * @deprecated Nothing reads this key. Remove it.
   */
  max_date?: never;
  /**
   * Declares this datetime a deadline — `@objectstack/spec`'s
   * `FieldSchema.dueLike`, typed BY REFERENCE (objectui#12297): the same key,
   * with the same meaning and the same name-convention fallback, as
   * {@link DateFieldMetadata.dueLike} one interface up. `DateTimeCellRenderer`
   * reads it (objectui#8958).
   *
   * ⚠️ Day granularity, inherited from the shared relative-time path: the
   * overdue wording gates on whole calendar days, so a datetime a few hours
   * past its deadline is not yet overdue. Sub-day precision is a separate
   * call and was not taken.
   */
  dueLike?: SpecField['dueLike'];
  /**
   * When this datetime's deadline is SETTLED for a record —
   * `@objectstack/spec`'s `FieldSchema.settledWhen`, typed BY REFERENCE
   * (objectui#12297): the same key, with the same meaning and the same
   * "declared, not yet rendered" status, as
   * {@link DateFieldMetadata.settledWhen} one interface up.
   */
  settledWhen?: SpecField['settledWhen'];
}

/**
 * Time field metadata
 */
export interface TimeFieldMetadata extends BaseFieldMetadata {
  type: 'time';
  format?: string;
}

import type { SelectOptionBase } from './select-option.js';

/**
 * Select option — the OBJECT-METADATA face of the one select-option contract
 * (`98d4108a2`). It extends {@link SelectOptionBase}, which derives the spec
 * keys from `@objectstack/spec/data` by reference and carries objectui's
 * `visibleWhen` wire shape plus the two objectui-only keys `disabled` and
 * `icon`. This face restates none of them; it adds exactly the one key below
 * and keeps the spec's `value` — a lowercase machine identifier — as declared.
 *
 * This is the declared element type of a select field's and a lookup field's
 * `options`, so it is the runtime READ model the renderers consume. It is still
 * WIDER than what may be authored, but by TWO keys rather than three:
 * `disabled` and `icon` are refused BY NAME by the spec's strict
 * `SelectOptionSchema`, which a field's `options` are routed through, while
 * `description` became authorable at `@objectstack/spec` 17.3.0 (`544ecba84`
 * corrected this paragraph; the member docblock below carries the measurement).
 */
export interface SelectOptionMetadata extends SelectOptionBase {
  /**
   * Optional secondary/help text for the option (objectui#6153, inheriting the
   * objectui#6140 ruling frame — a key that is genuinely consumed gets
   * declared). `LookupField` has always SEARCHED it on authored static options
   * (`opt.description && opt.description.toLowerCase().includes(q)`) and its
   * `recordToOption` emits the same key for fetched records — while this type
   * never declared it, so the behaviour was real for a key no annotated
   * literal could carry. Renderers may show it as supporting text.
   *
   * A DECLARED `SelectOptionSchema` key as of `@objectstack/spec` 17.3.0,
   * which implements the objectui#6153 half of that ruling. Measured on the
   * installed `@objectstack/spec` 18.1.0: an option carrying `description`
   * is ACCEPTED, as a string (a non-string answers `invalid_type`; the empty
   * string is valid), and a field whose `options` carry it parses whole. ⇒ it
   * may now be written into authored object metadata, which is the point of
   * the ruling — the key was consumed by `LookupField` long before the
   * authoring door admitted it.
   *
   * ⛔ This reverses what this docblock asserted between `0e3b3be09` and
   * `544ecba84`, when the key was refused by name and this comment said so.
   * The option keys that are STILL outside the vocabulary are `icon` and
   * `disabled` — declared on {@link SelectOptionBase} as objectui-only
   * extensions and refused by name — and they are what keeps "the schema still
   * refuses something" a live fact rather than an assumption. The verdict is
   * re-derived, both directions behind accepting controls, by
   * `__tests__/select-option-spec-extension-7014.test.ts` (`0e3b3be09`).
   */
  description?: string;
}

/**
 * Select field metadata
 */
export interface SelectFieldMetadata extends BaseFieldMetadata {
  type: 'select';
  options?: SelectOptionMetadata[];
  multiple?: boolean;
  searchable?: boolean;
}

/**
 * Email field metadata
 */
export interface EmailFieldMetadata extends BaseFieldMetadata {
  type: 'email';
  /**
   * Maximum character length — `@objectstack/spec`'s `FieldSchema.maxLength`,
   * typed BY REFERENCE (objectui#11070). `buildValidationRules` enforces it at
   * submit. It replaces the retired snake_case `max_length`, which the spec
   * refuses by name and nothing reads.
   */
  maxLength?: SpecField['maxLength'];
}

/**
 * Phone field metadata
 */
export interface PhoneFieldMetadata extends BaseFieldMetadata {
  type: 'phone';
  format?: string;
}

/**
 * URL field metadata
 */
export interface UrlFieldMetadata extends BaseFieldMetadata {
  type: 'url';
  /**
   * Maximum character length — `FieldSchema.maxLength` by reference, read the
   * same way as {@link EmailFieldMetadata.maxLength} (objectui#11070).
   */
  maxLength?: SpecField['maxLength'];
}

/**
 * Password field metadata
 */
export interface PasswordFieldMetadata extends BaseFieldMetadata {
  type: 'password';
  /**
   * Minimum character length — `@objectstack/spec`'s `FieldSchema.minLength`,
   * typed BY REFERENCE (objectui#11070). The form's validation rules
   * (`buildValidationRules` in `@object-ui/fields`) read it for every field
   * type and enforce it at submit. It replaces the retired snake_case
   * `min_length`, which the spec refuses by name.
   */
  minLength?: SpecField['minLength'];
  /**
   * Maximum character length — `@objectstack/spec`'s `FieldSchema.maxLength`,
   * typed BY REFERENCE and read the same way as {@link minLength}. It replaces
   * the retired snake_case `max_length`.
   */
  maxLength?: SpecField['maxLength'];
}

/**
 * Metadata of an uploaded file, as carried in a `file`/`image` field's VALUE.
 *
 * Renamed off the spec's `FileMetadata` name (objectstack#4115): the spec's
 * (`@objectstack/spec/system`) is the storage layer's file record — `{ path,
 * name, size, mimeType, lastModified, created, etag, fileId }`, all required
 * but the last two — describing an object in a bucket. This one is the
 * field-value payload the form renderer displays: snake_case keys, everything
 * but `name` optional, and it carries `url` (what the field links to) and
 * `original_name` (the upload's client-side filename), neither of which the
 * spec's has. Re-exporting the spec's would delete `url` outright.
 *
 * Tripwire: `__tests__/page-nav-misc-spec-parity.test.ts`.
 */
export interface UploadedFileMetadata {
  name: string;
  original_name?: string;
  size?: number;
  mime_type?: string;
  url?: string;
}

/**
 * File field metadata
 *
 * The size limit is `maxSize`, the spec's `FieldSchema.maxSize` by reference:
 * the one spelling the file widget reads, and the one the spec accepts on a
 * field document (objectui#12156). The snake_case `max_size` this interface
 * declared until then was read by no widget, so a limit written that way was
 * accepted and then did nothing. ⛔ No file-count key is declared: `FieldSchema`
 * has none and no widget enforces one, so `max_files` was removed, not renamed.
 * Pinned in `__tests__/field-file-image-max-size-12156.test.ts`.
 */
export interface FileFieldMetadata extends BaseFieldMetadata {
  type: 'file';
  multiple?: boolean;
  accept?: string[];
  /** Largest file the widget accepts, in bytes; it refuses a larger pick before any upload starts. */
  maxSize?: SpecField['maxSize'];
}

/**
 * Image field metadata
 *
 * `maxSize` as on {@link FileFieldMetadata}, by reference to the spec. ⛔ No
 * file-count or pixel-dimension key is declared: `FieldSchema` has none and no
 * widget enforces one, so `max_files`, `max_width` and `max_height` were
 * removed, not renamed (objectui#12156).
 */
export interface ImageFieldMetadata extends BaseFieldMetadata {
  type: 'image';
  multiple?: boolean;
  accept?: string[];
  /** Largest image the widget accepts, in bytes; it refuses a larger pick (or crop) before any upload starts. */
  maxSize?: SpecField['maxSize'];
}

/**
 * Location field metadata
 */
export interface LocationFieldMetadata extends BaseFieldMetadata {
  type: 'location';
  /**
   * REFUSED BY NAME (objectui#12242): `FieldSchema` refuses `default_zoom` with
   * `unrecognized_keys` and declares no map zoom, and `LocationField` never
   * reads it. Retired with no replacement key.
   * @deprecated Nothing reads this key. Remove it.
   */
  default_zoom?: never;
}

/**
 * Column definition for the Record Picker dialog table.
 */
export interface LookupColumnDef {
  /** Field name to display in this column */
  field: string;
  /** Optional column header label (defaults to field name) */
  label?: string;
  /** Column width (CSS value, e.g. '120px', '20%') */
  width?: string;
  /**
   * Field type hint for type-aware cell rendering.
   * When provided, the Record Picker uses getCellRenderer for formatting
   * (badges for select/status, currency formatting, date display, etc.).
   * @example 'currency', 'date', 'select', 'boolean'
   */
  type?: string;
}

/**
 * Filter condition for the Record Picker dialog.
 * Applied as a base filter on every query — restricts which records are selectable.
 *
 * Operator compatibility:
 * - `eq`, `ne` — all data types
 * - `gt`, `lt`, `gte`, `lte` — numbers, dates
 * - `contains` — strings
 * - `in`, `notIn` — arrays of values (select/lookup fields)
 *
 * @example { field: 'status', operator: 'eq', value: 'active' }
 * @example { field: 'created_at', operator: 'gte', value: '2024-01-01' }
 * @example { field: 'category', operator: 'in', value: ['A', 'B'] }
 */
export interface LookupFilterDef {
  /** Field name to filter on */
  field: string;
  /** Filter operator */
  operator: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'in' | 'notIn';
  /** Filter value */
  value: unknown;
}

/**
 * Lookup/Master-Detail field metadata
 *
 * Supports enterprise-grade Record Picker configuration:
 * - `lookupColumns` — columns shown in the Record Picker dialog table
 * - `descriptionField` — secondary description shown in quick-select popover
 * - `lookupPageSize` — records per page in the Record Picker dialog
 * - `lookupFilters` — base filters applied to Record Picker queries
 */
export interface LookupFieldMetadata extends BaseFieldMetadata {
  type: 'lookup' | 'master_detail';
  /**
   * The object the picker queries and the read cell resolves a name from —
   * `@objectstack/spec`'s `FieldSchema.reference`, typed BY REFERENCE so the
   * two cannot drift (objectui#11070). `LookupField`, `UserField` and the
   * lookup / user read cells read this spelling and no other.
   *
   * It replaces the retired snake_case `reference_to`, which the spec refuses
   * by name ("did you mean `reference_to` → `reference`?"). A served def that
   * still spells a legacy key is folded onto `reference` once, at the
   * ingestion choke point (`normalizeSchemaReferenceKeys` in
   * `@object-ui/core`); a def handed to a widget directly is not.
   */
  reference?: SpecField['reference'];
  reference_field?: string;
  multiple?: boolean;
  searchable?: boolean;
  options?: SelectOptionMetadata[];

  /**
   * Record field rendered as each candidate's label. Falls back to
   * `reference_field`, then the referenced object's own display-name
   * resolution, then the raw id.
   * @example 'label' — a position's display name
   */
  displayField?: string;

  /*
   * There is deliberately no `idField` here (objectui#12242, ruling A). The
   * record field a picker commits as the lookup's VALUE (default `id`; a
   * reference stored by machine name commits `name`) is picker configuration
   * a HOST writes,
   * not object metadata: `@objectstack/spec`'s `FieldSchema` refuses
   * `idField` by name, so no published object carries it. Its producers are
   * a form entry (`FormField.idField`), an action parameter, a flow binding
   * and a `master_detail` inline grid column, and its consumer is
   * `LookupField`, which reads it through the form entry's own declaration.
   */

  /**
   * Offer inline "create the referenced record" from an empty/zero-result
   * picker. Defaults ON for user-facing relations and OFF for platform
   * objects (`sys_`/`cloud_`/`ai_` and the user directory); set explicitly to
   * override either way.
   *
   * `@objectstack/spec`'s `FieldSchema.allowCreate`, typed BY REFERENCE
   * (objectui#12157). It replaces the snake_case `allow_create`, which the spec
   * refuses with `unrecognized_keys` and the widget no longer reads.
   */
  allowCreate?: SpecField['allowCreate'];

  /**
   * Secondary field shown as description in the quick-select popover.
   * @example 'industry' — shows customer industry below customer name
   */
  descriptionField?: string;

  /**
   * Columns to display in the Record Picker dialog table.
   * When omitted the dialog auto-infers columns from the display field and
   * description field.
   * @example ['name', 'email', 'status']
   * @example [{ field: 'name', label: 'Customer' }, { field: 'amount', label: 'Total', width: '100px' }]
   *
   * `@objectstack/spec`'s `FieldSchema.lookupColumns`, typed BY REFERENCE: each
   * entry is a field name or a {@link LookupColumnDef}-shaped descriptor
   * (objectui#12157). It replaces the snake_case `lookup_columns`, which the
   * spec refuses with `unrecognized_keys` and the widget no longer reads.
   */
  lookupColumns?: SpecField['lookupColumns'];

  /**
   * Custom page size for the Record Picker dialog.
   * Defaults to 10.
   *
   * `@objectstack/spec`'s `FieldSchema.lookupPageSize`, typed BY REFERENCE
   * (objectui#12157). It replaces the snake_case `lookup_page_size`, which the
   * spec refuses with `unrecognized_keys` and the widget no longer reads.
   */
  lookupPageSize?: SpecField['lookupPageSize'];

  /**
   * Base filters applied to every Record Picker query.
   * Use to restrict which records are selectable (e.g. only active records).
   * @example [{ field: 'status', operator: 'eq', value: 'active' }]
   */
  lookupFilters?: LookupFilterDef[];
}

/**
 * Formula field metadata (read-only computed field)
 * Phase 3.2.4: Enhanced formula field with real-time computation
 */
export interface FormulaFieldMetadata extends BaseFieldMetadata {
  type: 'formula';
  /**
   * The formula — `@objectstack/spec`'s `FieldSchema.expression`, typed BY
   * REFERENCE so the two cannot drift (objectui#11070): a CEL source string
   * (`record.quantity * record.unit_price`) or the spec's expression envelope
   * (`{ dialect, source, … }`). The backend evaluates it; `FormulaField` only
   * formats the computed value by `returnType`.
   *
   * It replaces the retired `formula` member, which `FieldSchema` refuses by
   * name (its rename hint points here) and which no typed reader read. A
   * stored Studio draft that still carries `formula` is objectui#6526's ruled
   * migration path on the metadata-admin seam, not this published type.
   * @example "record.quantity * record.unit_price"
   */
  expression?: SpecField['expression'];
  /**
   * The value type the formula computes — `@objectstack/spec`'s
   * `FieldSchema.returnType`, typed BY REFERENCE so the two cannot drift
   * (objectui#11070). Both faces of a formula draw the computed value by it,
   * `FormulaField` in a form and `FormulaCellRenderer` in a table cell, so
   * one stored value reads the same in each (objectui#11748): a number
   * formatted as a `number` field formats it (the viewer's display locale,
   * at the width a `scale` on the field sets); a boolean as the UI
   * language's Yes / No word, where any value that is not a JS boolean
   * reads as empty; a date in `formatDate`'s default face, the date field's
   * read-only face, not the date cell's relative one; and text as text, in
   * monospace. With no `returnType`, a JS number is drawn as a number and
   * anything else as text. Nothing is inferred from the expression.
   *
   * It replaces the retired snake_case `return_type`, which the spec refuses
   * by name and which no reader reads any more: the spec spelling is the one
   * object metadata carries (authoring stamps it from the inferred CEL type),
   * so an object-bound formula field is formatted by what its definition
   * declares.
   */
  returnType?: SpecField['returnType'];
  // ⛔ No `auto_compute` — RETIRED by objectui#11070 under ADR-0049
  // (enforce-or-remove): declared, and read by nothing in the repository —
  // the value is computed by the backend, and no widget or producer ever
  // consulted a recompute switch. `@objectstack/spec`'s `FieldSchema` refuses
  // it by name.
}

/**
 * Summary/Rollup field metadata (aggregation)
 * Phase 3.2.5: Enhanced summary field implementation
 */
export interface SummaryFieldMetadata extends BaseFieldMetadata {
  type: 'summary';
  /**
   * The roll-up definition — `@objectstack/spec`'s
   * `FieldSchema.summaryOperations`, typed BY REFERENCE so the two cannot
   * drift (objectui#11070): the child `object`, the child `field` to
   * aggregate, the aggregation `function` (`count` / `sum` / `min` / `max` /
   * `avg`), and optionally the child's `relationshipField` and a `filter`
   * restricting which child rows are aggregated. The backend computes the
   * value from it; neither face of a summary reads it to format. Whatever the
   * `function`, `SummaryField` in a form and the summary table cell draw the
   * value by one rule, so one stored value reads the same in each
   * (objectui#11752): a number formatted as a `number` field formats it (the
   * viewer's display locale, at the width a `scale` on the field sets, at its
   * natural precision with none, so a `count` reads whole), and anything else
   * as text.
   *
   * It replaces four retired snake_case members, one per part:
   * `summary_object` (now `object`), `summary_field` (now `field`),
   * `summary_type` (now `function`) and `summary_filter` (now `filter`). The
   * spec refuses them, and no reader reads them any more.
   */
  summaryOperations?: SpecField['summaryOperations'];
  // ⛔ No `auto_update` — RETIRED by objectui#11070 under ADR-0049
  // (enforce-or-remove): declared, and read by nothing in the repository —
  // the roll-up is computed by the backend. `@objectstack/spec`'s
  // `FieldSchema` refuses it by name.
}

/**
 * Auto-number field metadata.
 *
 * `type` is `'autonumber'`, the spelling `@objectstack/spec`'s `FieldType`
 * declares (objectui#12242). It was `'auto_number'`, which `FieldSchema` refuses
 * at `type` with `invalid_value`. `auto_number` is the form's WIDGET key
 * (`field:auto_number`), which `mapFieldTypeToFormType` resolves `autonumber`
 * to; it is not a field type.
 */
export interface AutoNumberFieldMetadata extends BaseFieldMetadata {
  type: 'autonumber';
  /**
   * The record-number pattern — `@objectstack/spec`'s
   * `FieldSchema.autonumberFormat`, typed BY REFERENCE so the two cannot drift
   * (objectui#12282): literal text plus a `{0000}` counter, the date tokens and
   * `{field_name}` interpolation that the spec's `parseAutonumberFormat` reads,
   * e.g. `'INV-{YYYY}-{0000}'`. The spec prefers it on a new field, and it is
   * the key the spec's own field form, which Studio's field designer renders,
   * offers for an `autonumber` field.
   *
   * It wins over `format` when a field carries both: the backend takes a
   * non-empty `autonumberFormat`, then a non-empty `format`, then the
   * contract default `{0000}` (`resolveAutonumberFormat`,
   * `@objectstack/spec/data`).
   */
  autonumberFormat?: SpecField['autonumberFormat'];
  /**
   * The shorthand for `autonumberFormat` — `@objectstack/spec`'s
   * `FieldSchema.format`, which on an `autonumber` field is the same
   * record-number pattern and predates `autonumberFormat`. The spec still
   * accepts it and the backend still honours it, but only when the field
   * carries no `autonumberFormat`. Prefer `autonumberFormat` on a new field.
   */
  format?: string;
  /**
   * REFUSED BY NAME (objectui#12242): `FieldSchema` refuses `starting_number`
   * with `unrecognized_keys` and declares no starting value (the record number
   * is minted by the backend from `autonumberFormat`, or its shorthand
   * `format`), and nothing reads it. Retired with no replacement key.
   * @deprecated Nothing reads this key. Remove it.
   */
  starting_number?: never;
}

/**
 * User field metadata — a lookup specialized to `sys_user`, rendered by the
 * person picker.
 *
 * `type` offered `'user' | 'owner'` until objectui#4814 retired the `owner`
 * spelling (ruling A′), carried onto the published twins by objectui#4914.
 * `owner` was a synonym with zero behavioral delta (both resolved to the SAME
 * `UserField` widget) and was never a member of `@objectstack/spec`'s closed
 * `FieldType`, so no object schema could declare it. While it survived here,
 * published `.d.ts` autocomplete kept offering a word `@object-ui/fields`
 * answers with a tombstone refusal. The record-owner idiom survives verbatim
 * as `{ type: 'user', name: 'owner' }` — the field NAME carries the ownership
 * meaning, the type carries the widget. The interface keeps its name: it
 * describes the person-picker family, not the retired spelling.
 */
export interface UserFieldMetadata extends BaseFieldMetadata {
  type: 'user';
  multiple?: boolean;

  /*
   * There is deliberately no `picker` and no `subtitle` here (objectui#12242,
   * ruling A). The person picker's variant (`'search'`, the default, or the
   * classic `'default'` dialog) and the record fields drawn beside each
   * candidate are picker configuration a HOST writes, not object metadata:
   * `@objectstack/spec`'s `FieldSchema` refuses both keys by name, so no
   * published object carries them. `UserField` supplies both defaults
   * itself; a form entry (`FormField.picker` / `FormField.subtitle`) and a
   * flow binding may set them, and `LookupField` reads them through the form
   * entry's own declaration.
   */

  /** Field holding the avatar image URL. Default `image`. */
  avatar_field?: string;

  /**
   * Base candidate filters applied to the picker query — e.g. exclude
   * deactivated users. Defaults to excluding `banned` users for user fields.
   * @example [{ field: 'banned', operator: 'ne', value: true }]
   */
  lookupFilters?: LookupFilterDef[];
}

/**
 * JSON field metadata — the field `ObjectField` edits as JSON.
 *
 * `type` is `'json'`, the `@objectstack/spec` `FieldType` for a free-form JSON
 * value (objectui#12242). It was `'object'`, which is not a spec field type:
 * `FieldSchema` refuses it at `type` with `invalid_value`. The form resolves
 * `json` to the same `field:object` editor `object` reached, so nothing about
 * the widget changes. The interface keeps its name.
 */
export interface ObjectFieldMetadata extends BaseFieldMetadata {
  type: 'json';
  /**
   * REFUSED BY NAME (objectui#12242): `FieldSchema` refuses `schema` with
   * `unrecognized_keys`, and `ObjectField` never read it (it checks JSON syntax
   * only). The spec validates a JSON value's shape at the OBJECT level instead,
   * with a `validations[]` rule of `type: 'json_schema'` naming the field.
   * @deprecated Nothing reads this key. Declare a `json_schema` validation rule on the object.
   */
  schema?: never;
}

/**
 * Vector field metadata (embeddings)
 * Phase 3.2.1: Complete vector field implementation
 */
export interface VectorFieldMetadata extends BaseFieldMetadata {
  type: 'vector';
  /**
   * Vector dimensions (e.g., 768 for BERT, 1536 for OpenAI)
   */
  dimensions?: number;
  /*
   * There is deliberately no `distance_metric` here (objectui#4687). It was
   * never a `FieldSchema` key: the installed `@objectstack/spec`'s vector
   * field shape declares no metric-spelling key at all (`dimensions` is the
   * only vector-specific key it recognizes), and `FieldSchema.safeParse`
   * rejects `distance_metric` by name (`unrecognized_keys`) with no
   * alias/rename entry pointing anywhere else. It had zero readers and zero
   * writers repo-wide, so there was no capability to preserve by renaming —
   * only a dead declaration to remove.
   */
  /*
   * There is deliberately no `indexed` here (objectui#4679, objectui#4687).
   * The ObjectStack spec has no field-level index flag: it built no index
   * (objectstack#2377 removed it) and `FieldSchema.safeParse` now rejects the
   * key by name, so any producer that authored it produced a save-blocking
   * 422. Declare the index on the object instead — `indexes: [{ name,
   * fields, unique }]`.
   */
  /**
   * REFUSED BY NAME (objectui#12242): `FieldSchema` refuses `normalize` with
   * `unrecognized_keys` (`dimensions` is the only vector key it declares), and
   * `VectorField` never reads it. Retired with no replacement key.
   * @deprecated Nothing reads this key. Remove it.
   */
  normalize?: never;
}

/**
 * Grid field metadata (sub-table)
 * Phase 3.2.2: Complete grid field implementation
 */
export interface GridFieldMetadata extends BaseFieldMetadata {
  type: 'grid';
  /**
   * The grid's columns — `@objectstack/spec`'s `FieldSchema.inlineColumns`,
   * typed BY REFERENCE (objectui#11070): an array of the spec's strict,
   * `name`-keyed inline grid column (`InlineGridColumn`), the shape the spec
   * declares as the mirror of this widget's column. `GridField` reads each
   * column by exactly the spec's keys and no other spelling, so a column the
   * spec accepts is a column the grid renders, and a key the spec refuses
   * (the retired `field`, a `title`, a per-column `defaultValue`) is refused
   * here at compile time instead of being dropped at render time.
   *
   * The key is `columns` because a `grid` field is objectui's own field type
   * (`@objectstack/spec` has no `grid` field type); the spec spells the same
   * list `inlineColumns` on a `master_detail` field, whose inline editor this
   * widget is. The former local `GridColumnDefinition` is retired: it was not
   * the shape the widget read (it required a free-form `type` and declared
   * `defaultValue` / `validate`, which nothing read).
   */
  columns?: SpecField['inlineColumns'];
  /**
   * Minimum number of rows. The grid's Remove action is disabled at this many
   * rows.
   */
  minRows?: number;
  /**
   * Maximum number of rows. The grid's Add and Duplicate actions are disabled,
   * and no blank entry row is drawn, at this many rows.
   */
  maxRows?: number;
  /**
   * Whether to allow adding rows. On unless set `false`; each row's Duplicate
   * action follows it.
   */
  allowAdd?: boolean;
  /**
   * Whether to allow deleting rows. On unless set `false`.
   */
  allowDelete?: boolean;
  /**
   * Whether rows can be reordered by dragging. On unless set `false`; a
   * read-only or disabled grid never offers it. The one reorder key the grid
   * reads (objectui#11070 round 8 retired the undeclared `reorderable` it used
   * to read instead, which left this member taught and ignored).
   */
  allowReorder?: boolean;
  /**
   * The CHILD column whose values are summed into the grid's footer total —
   * the `name` of one of {@link columns}. No total shows when it is unset.
   *
   * It carries the spec's `amountField` (`FieldSchema.inlineAmountField` on a
   * `master_detail` field, `subforms[].amountField` on a form view): the
   * master-detail and line-items adapters in `@object-ui/plugin-form` write
   * that value here. ⚠️ Same name, different meaning: on those spec surfaces
   * `totalField` is the PARENT field that receives the rolled-up sum on save,
   * and the grid never writes the parent. Here it names the child column
   * summed. The one spelling the grid reads (objectui#11070 round 8 retired
   * its `amount_field` / `amountField` reads, which nothing produced).
   */
  totalField?: string;
  /**
   * Label of the grid's Add button, and the label its empty state names. The
   * locale's own wording shows when it is unset. It is the spec's
   * `subforms[].addLabel`, which the master-detail adapter in
   * `@object-ui/plugin-form` writes here.
   */
  addLabel?: string;
  /**
   * The CHILD field the grid stamps with each row's index (0, 1, 2, …) on
   * every change that adds, removes or moves a row, so the order a
   * drag-reorder leaves survives a save and a reload. A cell edit moves no
   * row and leaves every row's value of it as it was. It names a field on the
   * row object, not one of {@link columns}: a column that is also the sort
   * field has its typed value overwritten by every such change. Rows keep the
   * order they were entered in when it is unset.
   *
   * Its producer is `deriveDetail` in `@object-ui/plugin-form`, through
   * `MasterDetailForm`: the first of the child object's fields named
   * `position`, `sort_order`, `sequence`, `line_no`, `line_number` or `sort`.
   * There is no authored master-detail key for it (objectui#11070 round 9
   * retired the detail's `sortField` override, which nothing wrote), and the
   * spec declares no inline sort-field key.
   */
  sortField?: string;

  // ── The retired snake_case spellings (objectui#11610) ───────────────────
  //
  // These eight keys were the grid's field-level keys until objectui#11610
  // renamed each to the camelCase member above, so that `@objectstack/spec`'s
  // runtime form field can declare them under its camelCase rule for config
  // keys. They retired at once, with no alias window: no reader reads them,
  // and each is REFUSED BY NAME on every face: here, as a `?: never`
  // tombstone; on the form-field zod mirror, as an alias refusal naming the
  // camelCase key; and in the `grid` widget, which draws a named refusal
  // instead of the grid. {@link GRID_FIELD_RETIRED_KEYS} maps each to its
  // replacement.

  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link minRows}.
   * @deprecated Write `minRows`. Nothing reads this spelling.
   */
  min_rows?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link maxRows}.
   * @deprecated Write `maxRows`. Nothing reads this spelling.
   */
  max_rows?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link allowAdd}.
   * @deprecated Write `allowAdd`. Nothing reads this spelling.
   */
  allow_add?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link allowDelete}.
   * @deprecated Write `allowDelete`. Nothing reads this spelling.
   */
  allow_delete?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link allowReorder}.
   * @deprecated Write `allowReorder`. Nothing reads this spelling.
   */
  allow_reorder?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link totalField}.
   * @deprecated Write `totalField`. Nothing reads this spelling.
   */
  total_field?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link addLabel}.
   * @deprecated Write `addLabel`. Nothing reads this spelling.
   */
  add_label?: never;
  /**
   * REFUSED BY NAME (objectui#11610): renamed {@link sortField}.
   * @deprecated Write `sortField`. Nothing reads this spelling.
   */
  sort_field?: never;
}

/** A member `GridFieldMetadata` declares beyond `BaseFieldMetadata`. */
type GridFieldOwnKey = Exclude<keyof GridFieldMetadata, keyof BaseFieldMetadata>;

/**
 * The `grid` field's retired snake_case field-level keys, each mapped to the
 * camelCase {@link GridFieldMetadata} member that replaced it (objectui#11610).
 *
 * The one list every face of the retirement reads: the form-field zod mirror
 * declares an alias refusal per entry, naming the value as the key to write,
 * and the `grid` widget refuses a field carrying any entry, naming the same
 * replacement. A key or a value that is not one of `GridFieldMetadata`'s own
 * members fails to compile here; that the keys are exactly its `?: never`
 * tombstones, and the values exactly its camelCase keys, is pinned in
 * `__tests__/grid-field-keys-camelcase-11610.test.ts`.
 */
export const GRID_FIELD_RETIRED_KEYS = {
  min_rows: 'minRows',
  max_rows: 'maxRows',
  allow_add: 'allowAdd',
  allow_delete: 'allowDelete',
  allow_reorder: 'allowReorder',
  total_field: 'totalField',
  add_label: 'addLabel',
  sort_field: 'sortField',
} as const satisfies { readonly [K in GridFieldOwnKey]?: GridFieldOwnKey };

/** A retired snake_case spelling of a `grid` field-level key: a key of {@link GRID_FIELD_RETIRED_KEYS}. */
export type GridFieldRetiredKey = keyof typeof GRID_FIELD_RETIRED_KEYS;

export interface ColorFieldMetadata extends BaseFieldMetadata {
  type: 'color';
}

export interface CodeFieldMetadata extends BaseFieldMetadata {
  type: 'code';
}

export interface AvatarFieldMetadata extends BaseFieldMetadata {
  type: 'avatar';
}

export interface SignatureFieldMetadata extends BaseFieldMetadata {
  type: 'signature';
}

export interface QRCodeFieldMetadata extends BaseFieldMetadata {
  type: 'qrcode';
}

export interface AddressFieldMetadata extends BaseFieldMetadata {
  type: 'address';
}

/**
 * `geolocation` field metadata — OUT of the {@link FieldMetadata} union since
 * objectui#12242 (ruling A). `geolocation` is not a `@objectstack/spec`
 * `FieldType`: `FieldSchema` refuses it at `type` with `invalid_value`, so no
 * published object can declare it, and the authoring union no longer offers
 * it. The spec's map-point field type is `location`
 * ({@link LocationFieldMetadata}), which renders a different widget.
 *
 * The `field:geolocation` widget itself stays registered in
 * `@object-ui/fields`; only the authoring face stops offering the type value.
 *
 * @deprecated Not a spec field type, and no longer a member of `FieldMetadata`.
 */
export interface GeolocationFieldMetadata extends BaseFieldMetadata {
  type: 'geolocation';
}

export interface SliderFieldMetadata extends BaseFieldMetadata {
  type: 'slider';
  min?: number;
  max?: number;
  /**
   * Step increment for slider (default: 1).
   *
   * Mirrors `step` on `@objectstack/spec`'s `FieldSchema`, whose own prose is
   * the sentence above; `SliderField` reads it and defaults it to `1`
   * (objectui#10066). Pinned in
   * `__tests__/number-field-step-spec-parity-9875.test.ts`.
   */
  step?: number;
}

export interface RatingFieldMetadata extends BaseFieldMetadata {
  type: 'rating';
  max?: number;
}

export interface MasterDetailFieldMetadata extends BaseFieldMetadata {
  type: 'master_detail';
  /**
   * The parent object — `@objectstack/spec`'s `FieldSchema.reference`, typed
   * BY REFERENCE, the same member {@link LookupFieldMetadata} carries. It
   * replaces the retired snake_case `reference_to` (objectui#11070).
   */
  reference?: SpecField['reference'];
}

/**
 * Union type of all field metadata types
 */
export type FieldMetadata =
  | TextFieldMetadata
  | TextareaFieldMetadata
  | MarkdownFieldMetadata
  | HtmlFieldMetadata
  | RichtextFieldMetadata
  | NumberFieldMetadata
  | CurrencyFieldMetadata
  | PercentFieldMetadata
  | BooleanFieldMetadata
  | DateFieldMetadata
  | DateTimeFieldMetadata
  | TimeFieldMetadata
  | SelectFieldMetadata
  | EmailFieldMetadata
  | PhoneFieldMetadata
  | UrlFieldMetadata
  | PasswordFieldMetadata
  | FileFieldMetadata
  | ImageFieldMetadata
  | LocationFieldMetadata
  | LookupFieldMetadata
  | FormulaFieldMetadata
  | SummaryFieldMetadata
  | AutoNumberFieldMetadata
  | UserFieldMetadata
  | ObjectFieldMetadata
  | VectorFieldMetadata
  | GridFieldMetadata
  | ColorFieldMetadata
  | CodeFieldMetadata
  | AvatarFieldMetadata
  | SignatureFieldMetadata
  | QRCodeFieldMetadata
  | AddressFieldMetadata
  // ⛔ No `GeolocationFieldMetadata` (objectui#12242): `geolocation` is not a
  // spec `FieldType`, so a published object cannot declare it.
  | SliderFieldMetadata
  | RatingFieldMetadata
  | MasterDetailFieldMetadata;

/**
 * Object document type — derived from `@objectstack/spec/data` rather than
 * restated (objectui#5362; maintainer ruling 2026-08-20: the object document
 * type belongs to `@objectstack/spec`, objectui derives rather than
 * hand-copies — the same layer split objectui#3074 applied to
 * `PageNodeSchema` and objectstack#4115 applied to `ObjectIndex` below).
 *
 * The hand-written interface this replaces had drifted in both directions:
 *
 * - It declared NONE of `titleFormat`, `listViews`, `icon` — three keys the
 *   shipped runtime reads (objectui#5362 lists the read sites), so a document
 *   annotated with this type got excess-property errors on keys the renderer
 *   then happily consumed.
 * - It declared nine members no objectui runtime code reads and the spec's
 *   object document does not know: `extends`, `triggers`, `primary_key`,
 *   `relationships`, `name_field` (the spec key is `nameField`),
 *   `soft_delete`, `audit_trail`, `version`, `cache`.
 *
 * Spelling (objectui#5362): the spec declares only camelCase `listViews`;
 * `list_views` appears nowhere in `@objectstack/spec` 17.2.0's `dist/`. The
 * runtime keeps a snake-spelling READ fallback for stored app data published
 * before this settlement (that stock has never been censused —
 * objectstack#7917); the tolerance lives at the read sites, deliberately not
 * in this type: new documents must author `listViews`.
 *
 * `ServiceObject` is the AUTHORING shape (`z.input` — pre-parse, defaults
 * not yet applied), which is what a hand-authored or served object document
 * is before validation. The post-parse shape is the spec's
 * `ServiceObjectParsed`.
 */
import type { ServiceObject } from '@objectstack/spec/data';

/**
 * Client-side members the objectui runtime reads on the object document but
 * `@objectstack/spec` does not declare. Every member here must cite a live
 * runtime read — this type is the measured client DELTA on top of the spec
 * document, not a place to restate spec keys (restating them would recreate
 * the hand-written fork objectui#5362 retired). The member list is pinned by
 * `__tests__/object-schema-metadata-spec-derivation.test.ts`, so growing it is
 * a conscious decision: promote the key upstream to the spec, or add it here
 * with the runtime read that justifies it.
 *
 * ## The delta is EMPTY today, and that is the pinned state
 *
 * `editMode` was the one member. `@objectstack/spec` 17.3.0 ADOPTED it —
 * measured on the installed build, `ObjectSchema`'s accept set went 42 → 43
 * keys with gained set exactly `['editMode']` and an empty lost set, declared
 * as `editMode?: 'page' | 'modal'`, the same union this file carried. So the
 * key is no longer a client delta, and restating it here would be exactly the
 * fork this type exists to prevent: two declarations of one key, with the
 * local one shadowing the spec's for every reader.
 *
 * The retirement is what the pin's own docblock PRESCRIBED for this event
 * ("If the spec ever adopts `editMode`, this test and the absence test above
 * both flip — retire the extension member and let the derivation carry the
 * key"), so it is executing a standing instruction, not a new decision.
 *
 * ⚠️ Nothing about `editMode` is removed from the product: it stays authorable
 * and stays typed on {@link ObjectSchemaMetadata}, now carried by
 * `ServiceObject`. `app-shell`'s `utils/recordFormNavigation.ts` read is
 * unchanged. What DID change is that a published, spec-validated object
 * document may now carry it — at 17.2.0 the spec refused the key by name.
 *
 * The type is kept (rather than deleted) because it is exported from
 * `@object-ui/types` and because the derivation `spec type + client delta` is
 * the shape this package pins; an empty delta states "objectui adds nothing
 * here today", which is a fact worth keeping addressable. `Record<never,
 * never>` rather than `{}`: `keyof` answers `never`, and it does not trip
 * `@typescript-eslint/no-empty-object-type`.
 */
export type ObjectSchemaClientExtensions = Record<never, never>;

/**
 * Object schema definition — the object document a data source's
 * `getObjectSchema(objectName)` serves, in its authoring shape, plus the
 * measured objectui client extensions above.
 */
export type ObjectSchemaMetadata = ServiceObject & ObjectSchemaClientExtensions;

/**
 * Object index configuration — re-exported from `@objectstack/spec/data`
 * rather than restated (objectstack#4115).
 *
 * The hand-written interface it replaces had drifted three ways: its `type`
 * enum was missing `fulltext`, `unique` was a bare `boolean` where the spec
 * also accepts `'global'` (the global-unique scope), and it had no `partial`
 * member at all — so a spec-authored partial or globally-unique index could
 * not be expressed here.
 */
import type { ObjectIndex } from '@objectstack/spec/data';
export type { ObjectIndex };
