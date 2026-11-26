/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE formatting call every display face of a quantity makes (ADR-0158):
 * `NumberCellRenderer` in a grid or detail row, and `NumberField`'s read-only
 * branch in a form. Pure, for the reason `number-format.ts` gives: the eager
 * barrel and the lazily loaded widget both call it and neither may import the
 * other.
 *
 * What it draws: the number at the unit's display width, then the unit's
 * label, or its bare code when the unit has no label to show (L1). The stored
 * value is never changed: nothing here rounds at write (L4), and a footer,
 * an export, the API and MCP all read the exact stored value.
 */

import type { FieldMetadata } from '@object-ui/types';
import type { ResolvedUnit } from '@object-ui/core';
import { resolveFieldScale } from '@objectstack/spec/data';
import { formatDisplayNumber } from '@object-ui/i18n';
import { formatNumberFieldValue } from './number-format.js';

/** What a quantity displays as. */
export interface QuantityDisplay {
  /** The whole text: the number, then the unit's label or code when there is one. */
  text: string;
  /** The number alone, as `text` writes it. */
  number: string;
  /** The label or code drawn after the number; absent when the quantity has no unit to show. */
  unit?: string;
  /**
   * Whether the stored value has more decimal places than the number shows.
   * Computed for every quantity; nothing renders from it (ADR-0158 Open item
   * 6 was ruled A, with no marker).
   */
  hidden: boolean;
}

/**
 * The display decimal places of a quantity whose unit declares `unitDecimals`
 * (ADR-0158 U6), under L4: the field's declared `scale` is the ceiling, so the
 * unit never shows more places than the field stores. A field that declares no
 * `scale` takes the unit's places as they are (Open item 6, first half: a
 * quantity needs no `scale`). `undefined` when the unit declares none, and the
 * field's own width then applies.
 */
export function quantityDisplayPlaces(unitDecimals: number | undefined, field: FieldMetadata): number | undefined {
  if (unitDecimals === undefined) return undefined;
  const scale = resolveFieldScale({ type: field.type, scale: 'scale' in field ? field.scale : undefined });
  return scale === undefined ? unitDecimals : Math.min(unitDecimals, scale);
}

/** The number of decimal places `value` carries in its shortest decimal form. */
function placesOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const text = Math.abs(value).toString();
  const exp = /e([+-]\d+)$/.exec(text);
  const mantissa = exp ? text.slice(0, exp.index) : text;
  const dot = mantissa.indexOf('.');
  const fraction = dot === -1 ? 0 : mantissa.length - dot - 1;
  return Math.max(0, fraction - (exp ? Number(exp[1]) : 0));
}

/**
 * The fraction-digit bounds a quantity is drawn at, given its display places.
 *
 * ⭐ The rounding rule lives here and nowhere else. ADR-0158 Open item 6's
 * second half (what a unit's display default does with a stored value that
 * has more places) was ruled A on objectstack#35490: round at render, half
 * away from zero, at a fixed width, as a currency amount is drawn at its
 * currency's digits. A unit of 3 places shows 1.5 as `1.500`, and a unit of
 * 0 places shows 1.5 as `2`. `Intl.NumberFormat`'s default rounding mode,
 * `halfExpand`, is that rule. Only the display rounds: the stored value, a
 * footer's total (summed exact, then formatted), an export, the API and MCP
 * keep the exact value.
 */
function quantityFractionDigits(places: number): { minimumFractionDigits: number; maximumFractionDigits: number } {
  return { minimumFractionDigits: places, maximumFractionDigits: places };
}

/**
 * Format a quantity of `field` in `unit` for display.
 *
 * @param value  the stored number; callers decide what is empty first.
 * @param field  the field metadata (`type`, `scale`, `useGrouping` are read).
 * @param unit   the resolved unit (`resolveQuantityUnit`), or `undefined` when
 *               the quantity has no unit to show (a blank code on its row).
 * @param locale the display locale tag.
 */
export function formatQuantity(
  value: number,
  field: FieldMetadata,
  unit: ResolvedUnit | undefined,
  locale?: string,
): QuantityDisplay {
  const places = quantityDisplayPlaces(unit?.decimals, field);
  let number: string;
  let hidden = false;
  if (places === undefined) {
    // No display default of the unit's own: the field's own width, as a bare
    // number of this field is drawn.
    number = formatNumberFieldValue(value, field, locale);
  } else {
    const declaredScale = resolveFieldScale({ type: field.type, scale: 'scale' in field ? field.scale : undefined });
    const useGrouping =
      'useGrouping' in field && typeof field.useGrouping === 'boolean' ? field.useGrouping : undefined;
    const digits = quantityFractionDigits(places);
    // The grouping policy keeps reading the FIELD's declaration, so a quantity
    // groups exactly as the same field's bare number does.
    number = formatDisplayNumber(value, { locale, scale: declaredScale, useGrouping, ...digits });
    hidden = placesOf(value) > digits.maximumFractionDigits;
  }
  const label = unit ? (unit.label ?? unit.code) : undefined;
  return {
    text: label ? `${number}\u00a0${label}` : number,
    number,
    ...(label ? { unit: label } : {}),
    hidden,
  };
}
