/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/** The field types a `formula` can read as on this package's record header. */
export type FormulaFieldType = 'currency' | 'percent' | 'date';

/**
 * The field type a `formula` reads as, when its declared `returnType` names
 * one the record header draws as that field type; `undefined` for any other
 * field or return type, so a caller keeps its own type with `?? type`.
 *
 * - `currency`: the spec reads it "as a currency field declares it", in the
 *   formula's own `currencyConfig` currency.
 * - `percent`: the spec reads it "as a `percent` field reads its stored
 *   value", at the formula's own `scale` and `max`.
 * - `date`: a value of the `date` field type, drawn by the formula cell with
 *   the date field's face (`FormulaCellRenderer`, objectui#11748), so the
 *   header reads it as a date too.
 *
 * `number`, `text` and `boolean` are not answered: the header has no number,
 * text or boolean face a formula would gain by reading as one.
 *
 * The one spelling for both header bands: the highlights strip asks it which
 * chips are KPI figures (only `currency` and `percent` are), and the summary
 * chip beside the title asks it which formatting arm a formula takes.
 */
export function formulaReadsAsFieldType(
  type: string | undefined,
  returnType: unknown,
): FormulaFieldType | undefined {
  if (type !== 'formula') return undefined;
  return returnType === 'currency' || returnType === 'percent' || returnType === 'date'
    ? returnType
    : undefined;
}
