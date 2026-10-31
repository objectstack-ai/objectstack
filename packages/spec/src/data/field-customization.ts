// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * # Customer extensions of a base object's fields (ADR-0146 D10)
 *
 * Objects are extended, never replaced. A customer's extension of a base
 * object lives in the base's paired `<base>.custom` package, under two rules
 * this module spells once:
 *
 * 1. **Extension fields end in `__c`, and only a `.custom` package may declare
 *    one** (maintainer, verbatim: 「扩展字段用 __c 后缀，只有 .custom 包能用。」).
 *    {@link EXTENSION_FIELD_SUFFIX} and {@link isExtensionFieldName} are the
 *    reservation; refusing the suffix outside `.custom` (at publish, at
 *    `os validate`, at the install door) is the enforcement card's, not this
 *    module's.
 * 2. **A base field changes only within a display-property whitelist** (Q7).
 *    {@link BASE_FIELD_DISPLAY_WHITELIST} is that whitelist: the closed constant
 *    the write gate reads, never a judgement it makes.
 *
 * Constants and one pure predicate, imports nothing: the shape that carries a
 * per-field patch on an object extension, and the merge that applies it, are
 * not declared here.
 */

/**
 * The suffix that reserves a field name to the customer's layer: a customer's
 * field on `crm_account` is `region__c`, so a vendor's next version can never
 * take that name (ADR-0146 D10). A field one vendor package adds to another
 * vendor's object keeps the plain spelling; the suffix names the customer's
 * layer and nothing else.
 */
export const EXTENSION_FIELD_SUFFIX = '__c';

/**
 * Whether `name` is spelled as a customer extension field: it ends in
 * {@link EXTENSION_FIELD_SUFFIX} after a non-empty stem (`region__c` yes,
 * `region` no, a bare `__c` no). Judges the suffix only; whether the name is a
 * valid field name at all is `FieldSchema`'s question.
 */
export function isExtensionFieldName(name: unknown): boolean {
  return typeof name === 'string'
    && name.length > EXTENSION_FIELD_SUFFIX.length
    && name.endsWith(EXTENSION_FIELD_SUFFIX);
}

/**
 * The base-field display-property whitelist (ADR-0146 D10, Q7; "Decided here"
 * item 4): the properties of a base field a customer's extension may patch.
 *
 * A property is admitted by D10's test, never by convenience: changing it
 * alters **no DDL, no stored value, no validation verdict and no permission**.
 * Each member below is a `FieldSchema` key (or, under `option`, a key of one
 * entry of a field's `options`) measured against that test:
 *
 * | member | `FieldSchema` key | why it passes |
 * |:--|:--|:--|
 * | label | `label` | display text; no column, value, check or grant reads it |
 * | description | `description` | tooltip text |
 * | help text | `inlineHelpText` | help text shown beside the input |
 * | placeholder | `placeholder` | placeholder text of an empty input |
 * | option label | `options[].label` | display text of an option, keyed by its stored `value`, which stays the vendor's |
 *
 * Everything else on a base field — `type`, `required`, `unique`, `reference`,
 * `defaultValue`, formulas (`expression`), `options` membership and each
 * option's `value` — stays the vendor's (ADR-0146 D6) and is refused on the
 * extension with a prescription naming this whitelist.
 *
 * Deliberately the class D10 names and nothing more. Other display-only keys
 * may pass the same test (`rows`, `group`, `widget`, an option's `color`); each
 * enters by a recorded decision, because widening a published whitelist is
 * reversible and narrowing it is not. `field-customization.test.ts` checks that
 * every member exists on `FieldSchema` and that none is structural.
 */
export const BASE_FIELD_DISPLAY_WHITELIST = Object.freeze({
  /** Keys of the base field itself. */
  field: Object.freeze(['label', 'description', 'inlineHelpText', 'placeholder'] as const),
  /** Keys of one entry of the base field's `options`, the entry addressed by its stored `value`. */
  option: Object.freeze(['label'] as const),
});

/** A base field key the extension may patch. */
export type BaseFieldDisplayProperty = (typeof BASE_FIELD_DISPLAY_WHITELIST.field)[number];
/** A key of one base field option the extension may patch. */
export type BaseFieldOptionDisplayProperty = (typeof BASE_FIELD_DISPLAY_WHITELIST.option)[number];
