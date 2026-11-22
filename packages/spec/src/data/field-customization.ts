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
 * 3. **Only the paired `.custom` package arranges the whole record page**
 *    (maintainer, verbatim: 「软件包字段、子表自定义分三种，原始软件包，继承软件包和环境管理员覆盖，
 *    继承软件包 我记得已经有一套标准，只能申明插入位置，原始软件包、环境管理员 应该可以申明完整的配置」).
 *    {@link CUSTOM_ARRANGEMENT_KEYS} are the two keys its object extension
 *    writes, in an object's own shape; any other package's extension places
 *    what it brings with `place`, and outside a `.custom` package is refused
 *    these keys at publish, at `os validate` and at the install door. The
 *    pair is the `.custom` package of the App the object belongs to; what
 *    another `.custom` package writes under these keys is not applied.
 *
 * Constants and pure predicates, imports nothing. The shape that carries a
 * per-field patch is `ObjectExtensionSchema.fieldPatches`
 * (`data/object.zod.ts`), its keys derived from the whitelist below; the merge
 * that applies it is not declared in `packages/spec`.
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
 *
 * `hidden` was measured against the test and stays OUT: it is not display-only.
 * A hidden field is left out of the object's search companion column, so the
 * stored `__search` value changes; a form's required verdict reads it
 * (`required && hidden !== true`), so a validation verdict changes; and the
 * default `search` and export columns drop it. The environment keeps a base
 * field off the record page and the forms in its arrangement instead: the
 * paired `.custom` extension's `fieldGroups` lists the field in a group whose
 * `visibleWhen` is false ({@link CUSTOM_ARRANGEMENT_KEYS}). Two limits of
 * that recipe, which the key's description states too:
 *
 *  - it is presentation only, not access control: the field stays readable
 *    and writable through the API;
 *  - it is not for a `required` field that has no default: the create form
 *    no longer shows the field while the save still requires it, so the form
 *    cannot be submitted.
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

/**
 * [ADR-0146 D10] The keys of an object extension only a base's paired
 * `.custom` package writes: the whole field arrangement and the whole tab
 * list of the extended object, each in the shape an object declares it in
 * (`ObjectExtensionSchema.fieldGroups` / `.relatedLists`). Written, a key
 * replaces what the owner declares and the other extensions' `place` entries
 * add to, whole; not written, that arrangement stays.
 *
 * The ONE list: the registry fold that applies the keys, and the judge that
 * refuses them outside `.custom` (publish, `os validate` / `os build`, the
 * install door), read it through {@link extensionArrangementKeys}.
 */
export const CUSTOM_ARRANGEMENT_KEYS = Object.freeze(['fieldGroups', 'relatedLists'] as const);

/** One of {@link CUSTOM_ARRANGEMENT_KEYS}. */
export type CustomArrangementKey = (typeof CUSTOM_ARRANGEMENT_KEYS)[number];

/**
 * [ADR-0146 D10] The {@link CUSTOM_ARRANGEMENT_KEYS} an object extension body
 * writes, in the list's order. A key counts as written when the body carries
 * any value under it (an empty array included: it declares an arrangement
 * with nothing in it); `undefined` and `null` do not. Tolerant of an unparsed
 * body, so every door and the fold share one reading.
 */
export function extensionArrangementKeys(extension: unknown): CustomArrangementKey[] {
  if (typeof extension !== 'object' || extension === null || Array.isArray(extension)) return [];
  const body = extension as Record<string, unknown>;
  return CUSTOM_ARRANGEMENT_KEYS.filter((key) => body[key] !== undefined && body[key] !== null);
}
