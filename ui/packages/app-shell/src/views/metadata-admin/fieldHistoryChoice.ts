// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The three choices of a `fieldHistory` key — follow the default, on, off —
 * declared once for every Studio surface that writes the key (#36290 ruling
 * 7076513167 point 1, #36482).
 *
 * The key has no default on purpose: unset follows the platform, and only an
 * author who chose writes `true` or `false`. So "Default" is a state of its
 * own, it REMOVES the key, and its label names what it resolves to for the row
 * in front of it — the caller asks `resolveFieldHistory` from
 * `@objectstack/spec/data`, the predicate the activity writer keeps or drops
 * values with, and hands the answer in as `defaultOn`.
 *
 * Two surfaces draw it: the metadata form's `field-history` widget
 * (`widgets.tsx`, a `WidgetProps` renderer that sees one row and no object)
 * and the object field inspector (an `InspectorSelectField` row, which holds
 * the whole object document and so resolves Default against the object's own
 * `enable.fieldHistory` too). Their controls differ; the choice, the value
 * each choice writes and the wording live here.
 */

import { t, tFormat, type SupportedLocale } from './i18n.js';

export type FieldHistoryChoice = 'default' | 'on' | 'off';

/**
 * A stored value as a choice. Only a literal boolean is On or Off: the writer
 * reads any other stored value as unset, so it draws as Default.
 */
export function fieldHistoryChoiceOf(value: unknown): FieldHistoryChoice {
  return value === true ? 'on' : value === false ? 'off' : 'default';
}

/** The value a choice writes — `undefined` means remove the key. */
export function fieldHistoryValueOf(choice: string): boolean | undefined {
  return choice === 'on' ? true : choice === 'off' ? false : undefined;
}

/** The label of the Default choice: `Default (On)` / `Default (Off)`. */
export function fieldHistoryDefaultLabel(defaultOn: boolean, locale: SupportedLocale | string | undefined): string {
  return tFormat('engine.form.fieldHistoryDefault', locale, {
    state: t(defaultOn ? 'engine.form.fieldHistoryOn' : 'engine.form.fieldHistoryOff', locale),
  });
}

/** The three choices in display order, Default naming what it resolves to. */
export function fieldHistoryOptions(
  defaultOn: boolean,
  locale: SupportedLocale | string | undefined,
): Array<{ value: FieldHistoryChoice; label: string }> {
  return [
    { value: 'default', label: fieldHistoryDefaultLabel(defaultOn, locale) },
    { value: 'on', label: t('engine.form.fieldHistoryOn', locale) },
    { value: 'off', label: t('engine.form.fieldHistoryOff', locale) },
  ];
}
