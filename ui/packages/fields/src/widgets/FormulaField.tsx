import React from 'react';
import { EmptyValue } from '@object-ui/components';
import { useDisplayLocale } from '@object-ui/i18n';
import { formatDate, isEmptyValue, toDisplayDate } from '@object-ui/core';
import type { FormulaFieldMetadata } from '@object-ui/types';
import { FieldWidgetComponentProps } from './types.js';
import { useBooleanValueLabel } from './booleanValueLabel.js';
import { formatNumberFieldValue } from './number-format.js';
import { CurrencyField } from './CurrencyField.js';
import { coerceToSafeValue } from '../coerceToSafeValue.js';

/**
 * FormulaField - Read-only computed field
 * Values are computed on the backend and cannot be edited
 *
 * ## One value, one reading (objectui#11748)
 *
 * This is the read-only FORM face of a formula; `FormulaCellRenderer` in this
 * package's barrel is its TABLE face. The two used to format the value each by
 * itself, so one stored value read two ways: a number here was `200000` (no
 * `returnType`) or `200000.00` (a `toFixed(2)`), in monospace, beside the
 * cell's `200,000`; a declared boolean or date read `Yes` / `Jul 4` here and
 * `true` / `2026-07-04` in the cell.
 *
 * Both faces now read the SAME rule and draw each type through the calls the
 * matching field type's faces make, so they agree on every value:
 *
 *   - which type: the declared `returnType`; with none, a JS number is a
 *     number and anything else is text. ⛔ Nothing is inferred from the
 *     expression: the spec's own field form says consumers read `returnType`
 *     "instead of re-parsing the expression".
 *   - number: `formatNumberFieldValue`, the one call every number face makes
 *     (the locale's grouping, the width `resolveFieldScale` answers for a
 *     declared `scale`). The value is read the way the formula cell reads it
 *     (objectui#11683): blank is empty, and a declared number held as a
 *     numeric string is a number.
 *   - currency: money, through the currency field's own faces (`CurrencyField`
 *     read-only here, `CurrencyCellRenderer` in the cell), reading the
 *     formula's own `currencyConfig` as they read a currency field's
 *     (objectui#12111).
 *   - boolean: the locale's word, as `BooleanField`'s read-only branch draws
 *     it; only a JS boolean is a boolean, as there (objectui#8593).
 *   - date: `formatDate`'s DEFAULT face, as `DateField`'s read-only branch
 *     draws it (objectui#8194).
 *   - text: the value as the cell prints it, in the font `TextField`'s
 *     read-only branch draws (objectui#12357), declared `text` or not.
 *
 * Both faces also share the emptiness floor (`isEmptyValue` on the coerced
 * value), so an empty value reads the shared affordance in both.
 *
 * The rule is spelled here and in the cell, because the barrel and this lazily
 * loaded widget may not import each other (the reason `number-format.ts`
 * gives). `__tests__/formulaFaces.returnType-11748.test.tsx` draws every
 * declared type in both faces and compares the two texts, so neither can move
 * alone.
 */
export function FormulaField({ value, field, ...props }: FieldWidgetComponentProps<any>) {
  // Before the empty-value early return — the hook count must not change when
  // a value flips between null and set. A `date` return type used to format
  // through the MACHINE's locale (objectui#4468); the number face reads the
  // same display locale.
  const locale = useDisplayLocale();
  // Same reason as the hook above: before the early return.
  const booleanLabel = useBooleanValueLabel();

  // The emptiness FLOOR (`isEmptyValue`), taken on the coerced value exactly
  // as the formula cell takes it (objectui#11748). This read `value == null`,
  // so `''` and `[]` drew a blank span with no accessible name here and the
  // shared affordance in the table.
  const safe = coerceToSafeValue(value);
  if (isEmptyValue(safe)) {
    return <EmptyValue className={props.className} />;
  }

  // The spec's `returnType` (`number` / `text` / `boolean` / `date` /
  // `currency`), the spelling object metadata carries — authoring stamps it from the inferred
  // CEL type. It is the ONLY spelling read: the snake_case `return_type` this
  // widget used to read is retired, so an object-bound formula field is
  // formatted by what its definition declares (objectui#11070).
  //
  // With none declared, the value's own JSON type decides, and only a JS
  // number counts (objectui#11748, the formula cell's rule since
  // objectui#11683): a formula with no `returnType` that computes a number,
  // like the showcase's Budget Remaining, is a number. A string of digits
  // stays text, because nothing says it is a quantity.
  const declared = (field as FormulaFieldMetadata | undefined)?.returnType;
  const valueType = declared ?? (typeof value === 'number' ? 'number' : 'text');
  const typedClassName = `text-sm ${props.className || ''}`;

  if (valueType === 'number') {
    // Read the way the formula cell reads it: on the coerced value, blank is
    // empty (`Number('  ')` is `0`, a digit the record never held), and a
    // declared number held as a numeric string is a number. Then the one
    // `formatNumberFieldValue` call, so the text is the number cell's and
    // `NumberField`'s read-only text: grouped in the locale, at the width a
    // declared `scale` gives. This was `toFixed(2)`, which neither face makes.
    if (typeof safe === 'string' && safe.trim() === '') {
      return <EmptyValue className={props.className} />;
    }
    const num = Number(safe);
    const text = isNaN(num) ? String(safe) : formatNumberFieldValue(num, field, locale);
    return <span className={typedClassName}>{text}</span>;
  }

  if (valueType === 'currency') {
    // Money (objectui#12111), drawn by `CurrencyField`'s own read-only face,
    // handed this formula's definition: that widget reads `currencyConfig`
    // through `resolveFieldCurrency` exactly as it reads a currency field's
    // (a `fixed` config keeps its code; absent is `dynamic`, the tenant
    // default currency), and formats through `formatCurrency`, the call the
    // currency cell makes too. ⛔ No second money formatter here. The value is
    // read as the currency cell reads it: blank is empty, and a value that is
    // not a number keeps its text.
    if (typeof safe === 'string' && safe.trim() === '') {
      return <EmptyValue className={props.className} />;
    }
    const amount = Number(safe);
    if (isNaN(amount)) return <span className={typedClassName}>{String(safe)}</span>;
    return <CurrencyField value={amount} onChange={props.onChange} field={field} readonly />;
  }

  if (valueType === 'boolean') {
    // The locale's word (objectui#11689), drawn under `BooleanField`'s
    // read-only rule (objectui#8593): only a JS boolean is a boolean. This
    // branch used to read the value by truthiness, so a formula declared
    // `boolean` that held the string `'false'` said `Yes`.
    if (typeof value !== 'boolean') return <EmptyValue className={props.className} />;
    return <span className={typedClassName}>{booleanLabel(value)}</span>;
  }

  if (valueType === 'date') {
    // `formatDate`'s DEFAULT style — the one home for the `date` display
    // convention (objectui#8194, following the maintainer's ruling A behind
    // `c15d7eca6`), and the face `DateField`'s read-only branch draws. This
    // branch used to call `toLocaleDateString(locale)` with NO options bag,
    // i.e. `Intl`'s numeric default (`7/4/2026`), so a formula returning a
    // date rendered a face the shared function never produces — while the
    // `date` field beside it showed `Jul 4`. The formula cell draws this same
    // face (objectui#11748), not the date cell's relative one, because this
    // face has no relative form to match.
    //
    // An unparseable computed value reads the shared AFFORDANCE (objectui#8809)
    // — the same em-dash glyph as `formatDate`'s own empty face, carried with
    // `data-slot` of `empty-value` and an accessible name. `toDisplayDate` IS
    // `formatDate`'s own parse step, so the guard refuses exactly what the
    // shared function would dash for being unreadable, a date-only
    // nonexistent day included (objectui#10026). A falsy value is empty too,
    // the numeric epoch included, as on `DateField` and the date cell.
    if (!safe || isNaN(toDisplayDate(safe as string | number).getTime())) {
      return <EmptyValue className={props.className} />;
    }
    return <span className={typedClassName}>{formatDate(safe as string | number, undefined, { locale })}</span>;
  }

  // Text: the coerced value, as the cell prints it (an expanded record reads
  // its name, not `[object Object]`), drawn the way `TextField`'s read-only
  // branch draws a text value (objectui#12357): the form's own font, not the
  // monospace this used to print, which made a person's name read as code.
  return <span className={typedClassName}>{String(safe)}</span>;
}
