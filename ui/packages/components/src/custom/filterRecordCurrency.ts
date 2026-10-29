/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A filter on a `record`-mode amount compares within ONE currency
 * (ADR-0144 D2, D6): `amount > 100` over rows in USD, EUR and JPY compares
 * numbers in three units. So the FilterBuilder pairs every value-comparing
 * row on such an amount with its CODE condition, and the group it emits
 * reads `amount op X AND code = C`.
 *
 * The pair travels as two plain rows of the one flat group — the amount row
 * and a companion `{ field: <code field>, operator: 'equals', value: C }`
 * whose id is the amount row's id plus {@link CURRENCY_COMPANION_SUFFIX}. So
 * every stored filter stays a valid `ViewFilterRule` list (no new key on a
 * rule), and every face that lowers the group — the list's
 * `convertFilterGroupToAST`, a saved view, the server — reads the code
 * condition without knowing anything about currencies. The builder draws the
 * companion as the amount row's currency picker, never as a row of its own.
 *
 * The flat group has one `logic`: the pairing holds under `and`. Under `or`
 * the rows would split (`amount > 100 OR code = USD`), so the builder will
 * not switch a paired group to `or`, and says so on a stored `or` group.
 */

import type { FilterBuilderRow, FilterBuilderRowGroup } from "./filter-builder"

/** The id suffix that marks a row as an amount row's currency companion. */
export const CURRENCY_COMPANION_SUFFIX = "::currency"

/** The companion id of the amount row `rowId`. */
export function currencyCompanionId(rowId: string): string {
  return `${rowId}${CURRENCY_COMPANION_SUFFIX}`
}

/** What the pairing reads off a builder field entry. */
export interface RecordCurrencyFilterField {
  value: string
  /** The sibling code field of a `record`-mode amount (its `currencyField`). */
  currencyField?: string
}

/**
 * The code field a row's amount pairs with, or `undefined` when the row needs
 * no companion: its field is not a `record`-mode amount, or its operator
 * compares no value (`is_null`, `is_empty`, … ask about presence, which is
 * the same question in every currency).
 */
export function pairedCurrencyField(
  row: Pick<FilterBuilderRow, "field" | "operator">,
  fields: readonly RecordCurrencyFilterField[],
  comparesValue: (operator: string) => boolean,
): string | undefined {
  const codeField = fields.find((f) => f.value === row.field)?.currencyField
  return codeField && comparesValue(row.operator) ? codeField : undefined
}

/** Whether `row` is the companion of another row in `group`. */
export function isCurrencyCompanion(row: FilterBuilderRow, group: FilterBuilderRowGroup): boolean {
  if (!row.id.endsWith(CURRENCY_COMPANION_SUFFIX)) return false
  const baseId = row.id.slice(0, -CURRENCY_COMPANION_SUFFIX.length)
  return group.conditions.some((c) => c.id === baseId)
}

/** The companion of the amount row `rowId` in `group`, if it holds one. */
export function currencyCompanionOf(group: FilterBuilderRowGroup, rowId: string): FilterBuilderRow | undefined {
  const id = currencyCompanionId(rowId)
  return group.conditions.find((c) => c.id === id)
}

/**
 * `group` with every pair settled: each value-comparing row on a
 * `record`-mode amount followed by exactly one companion on its code field,
 * and no companion left without its amount row. A companion that already
 * holds a code keeps it; a new one starts on `homeCurrency` (the picker's
 * default, ADR-0144 D8 rule 4), or blank — which the picker marks as
 * required — when the organization currency is unset.
 *
 * Returns `group` itself when nothing changes, so an emit that touched no
 * pair hands the host the identity it would have had without this step.
 */
export function syncRecordCurrencyRows(
  group: FilterBuilderRowGroup,
  fields: readonly RecordCurrencyFilterField[],
  homeCurrency: string | undefined,
  comparesValue: (operator: string) => boolean,
): FilterBuilderRowGroup {
  const companions = new Map<string, FilterBuilderRow>()
  for (const c of group.conditions) if (c.id.endsWith(CURRENCY_COMPANION_SUFFIX)) companions.set(c.id, c)

  const next: FilterBuilderRow[] = []
  for (const row of group.conditions) {
    // A companion is re-placed by its amount row below, right after it; one
    // whose amount row is gone, or no longer pairs, is dropped.
    if (companions.has(row.id)) continue
    next.push(row)
    const codeField = pairedCurrencyField(row, fields, comparesValue)
    if (!codeField) continue
    const held = companions.get(currencyCompanionId(row.id))
    const heldCode = held?.field === codeField && typeof held.value === "string" ? held.value : ""
    next.push({
      id: currencyCompanionId(row.id),
      field: codeField,
      operator: "equals",
      value: heldCode !== "" ? heldCode : homeCurrency ?? "",
    })
  }

  const same =
    next.length === group.conditions.length &&
    next.every((row, i) => JSON.stringify(row) === JSON.stringify(group.conditions[i]))
  return same ? group : { ...group, conditions: next }
}
