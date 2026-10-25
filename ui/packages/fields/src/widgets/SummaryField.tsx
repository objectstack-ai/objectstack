import React from 'react';
import { EmptyValue } from '@object-ui/components';
import { useDisplayLocale } from '@object-ui/i18n';
import { isEmptyValue } from '@object-ui/core';
import { FieldWidgetComponentProps } from './types.js';
import { formatNumberFieldValue } from './number-format.js';
import { coerceToSafeValue } from '../coerceToSafeValue.js';

/**
 * SummaryField - Read-only aggregation field
 * Values are aggregated from related records and cannot be edited
 *
 * ## One value, one reading (objectui#11752)
 *
 * This is the read-only FORM face of a roll-up; its TABLE face is the formula
 * cell, `FormulaCellRenderer` in this package's barrel, which `summary` is
 * registered to. The two used to format the value each by itself, so one
 * stored value read two ways: this face picked a format by the roll-up's
 * aggregation `function` (`count` as it arrived, the other four at two fixed
 * decimals), so a `sum` over `15750.5` read `15750.50`, ungrouped and in every
 * locale, beside the cell's `15,750.5`.
 *
 * This face now reads the value the way the cell reads a summary's value,
 * whatever the function:
 *
 *   - the emptiness FLOOR (`isEmptyValue`) on the coerced value, as the cell
 *     takes it, so `''` and `[]` read the shared affordance in both faces;
 *   - a JS number: `formatNumberFieldValue`, the one call every number face
 *     makes (the display locale's grouping, the width `resolveFieldScale`
 *     answers for a declared `scale`, the value's natural precision when none
 *     is declared). A `count` is a whole number, so it reads whole; an author
 *     who wants a fixed width on a `sum` or an `avg` declares `scale`, and both
 *     faces honour it.
 *   - anything else: the coerced value as text, as the cell prints it. A
 *     summary declares no `returnType`, so a string of digits is not a number.
 *
 * The rule is spelled here and in the cell, because the barrel and this lazily
 * loaded widget may not import each other (the reason `number-format.ts`
 * gives). `__tests__/summaryFaces.numberFace-11752.test.tsx` draws every
 * aggregation function in both faces and compares the two texts, so neither
 * can move alone.
 */
export function SummaryField({ value, field, ...props }: FieldWidgetComponentProps<any>) {
  // Before the empty-value early return: the hook count must not change when a
  // value flips between null and set.
  const locale = useDisplayLocale();

  // The floor, on the coerced value, exactly as the formula cell takes it.
  // This read `value == null`, so `''` and `[]` drew a blank span with no
  // accessible name here and the shared affordance in the table.
  const safe = coerceToSafeValue(value);
  if (isEmptyValue(safe)) {
    return <EmptyValue className={props.className} />;
  }

  // Only a JS number is a number, the cell's rule for a field with no
  // `returnType` (objectui#11683); the aggregation `function` decides nothing
  // here, so `summaryOperations` is not read.
  const text =
    typeof value === 'number' && !isNaN(value)
      ? formatNumberFieldValue(value, field, locale)
      : String(safe);

  return (
    <span className={`text-sm font-medium tabular-nums text-gray-700 ${props.className || ''}`}>
      {text}
    </span>
  );
}
