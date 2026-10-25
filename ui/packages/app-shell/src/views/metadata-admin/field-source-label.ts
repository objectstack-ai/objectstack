// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A form field's UNTRANSLATED source label, carried beside its translation
 * (objectui#8231).
 *
 * `SchemaForm`'s machine-name chip answers "the label does not already spell
 * the machine name". That is a question about the label the field was
 * AUTHORED with, never about the translation a reader sees: `prettify
 * ('columns')` can never equal 「列数」, so judging the visible label showed the
 * chip beside every field of a localized panel and hid it beside the same
 * fields in English.
 *
 * The locale overlay (`./metadata-form-i18n.ts`) replaces `label` in place, so
 * before it does, it records the label each field arrived with under a
 * module-private symbol ({@link stampSourceLabel}); `SchemaForm` reads it back
 * with {@link untranslatedFieldLabel}. The stamp is not a `FormFieldSpec` key:
 * it is not authorable, not serialized (`JSON.stringify` skips symbol keys),
 * not enumerable by `Object.keys`, and not part of any exported type. Object
 * spread DOES carry it, which is what lets it ride through the spec resolver's
 * `{ ...field }` copies — and why a JSON round-trip of a localized form loses
 * it (`mergeServerFields` copies shallowly for that reason).
 *
 * A leaf with no runtime imports on purpose: `SchemaForm` reads the stamp, and
 * importing the overlay instead would pull `@objectstack/spec/system` into
 * `SchemaForm`'s static import closure for one symbol.
 */

const SOURCE_LABEL = Symbol('metadataForm.sourceLabel');

type Stamped = Record<PropertyKey, unknown>;

/** Record `label` as `field`'s source label. Writes only the symbol key. */
export function stampSourceLabel(field: object, label: string | undefined): void {
  (field as Stamped)[SOURCE_LABEL] = label;
}

/** Whether a locale overlay has already recorded `field`'s source label. */
export function hasSourceLabel(field: object): boolean {
  return SOURCE_LABEL in field;
}

/**
 * The label a form field carried BEFORE any locale overlay replaced it — the
 * string `SchemaForm`'s machine-name chip must judge.
 *
 *  - A field an overlay translated answers the label it arrived with, which
 *    is `undefined` when the form authored none (every `dashboardForm` field
 *    today): the caller then falls back to the schema's own English, exactly
 *    as the English panel does.
 *  - A field no overlay touched (an English console, a curated client form)
 *    answers its own `label`: nothing replaced it, so it is its own source.
 */
export function untranslatedFieldLabel(
  fieldSpec: { label?: unknown } | undefined,
): string | undefined {
  if (!fieldSpec) return undefined;
  if (hasSourceLabel(fieldSpec)) {
    const source = (fieldSpec as Stamped)[SOURCE_LABEL];
    return typeof source === 'string' ? source : undefined;
  }
  return typeof fieldSpec.label === 'string' ? fieldSpec.label : undefined;
}
