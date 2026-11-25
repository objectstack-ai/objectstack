/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Licensed under the MIT license found in the LICENSE file.
 */

import { summaryDeclaresCurrency } from './currency.js';

/**
 * The value type a `formula` or `summary` cell draws its result as: the face
 * `FormulaCellRenderer` picks, answered for anyone who has to know it before
 * the cell draws (a gallery card deciding whether the row needs its label).
 *
 * ONE rule, read in one place, so a surface that asks it cannot disagree with
 * the cell that draws the value:
 *   - a roll-up that declares its currency (ADR-0144 D6 as amended) is money,
 *     for a numeric value;
 *   - otherwise the declared `returnType`, read as declared and never
 *     overridden by the value;
 *   - with none, the value's own JSON type: only a JS number is a number, and
 *     a string of digits from an undeclared formula stays text, because nothing
 *     says it is a quantity (a postcode built by concatenation is not one).
 *
 * ⛔ No type is inferred from the expression or from its inputs: the spec's
 * own field form says consumers read `returnType` "instead of re-parsing the
 * expression".
 */
export function resolveFormulaValueType(field: unknown, value: unknown): string {
  const def = field as { type?: unknown; returnType?: unknown } | null | undefined;
  const returnType = def && typeof def === 'object' && 'returnType' in def ? def.returnType : undefined;
  const declaresMoney = def?.type === 'summary' && summaryDeclaresCurrency(field);
  return declaresMoney && typeof value === 'number'
    ? 'currency'
    : ((returnType ?? (typeof value === 'number' ? 'number' : 'text')) as string);
}
