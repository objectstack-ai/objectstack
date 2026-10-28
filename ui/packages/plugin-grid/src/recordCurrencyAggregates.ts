/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D6 on the grid: a raw money aggregate over a `record`-mode amount
 * is honest only inside one currency. A group bucketed by the amount's code
 * field holds one currency, so its `sum` / `avg` / `min` / `max` stand; any
 * other set of rows mixes currencies, and adding 100 USD to 100 EUR answers a
 * number that is no amount at all. Consolidated totals belong to the home
 * field, an ordinary `dynamic` amount that totals unchanged.
 *
 * The counts are currency-free and always stand.
 */
import { recordCurrencyField } from '@object-ui/i18n';
import type { GroupAggregationConfig } from './useGroupedData';

const MONEY_AGGREGATES = new Set(['sum', 'avg', 'min', 'max']);

/** Whether `type` aggregates the amounts themselves (not a count of rows). */
export function isMoneyAggregate(type: string): boolean {
  return MONEY_AGGREGATES.has(type);
}

type CurrencyFieldLike = { currencyConfig?: unknown } | null | undefined;

/**
 * The code field a money aggregate over `field` needs to be grouped by, or
 * `undefined` when `field` is not a `record`-mode amount (any aggregate over
 * it is honest as it stands).
 */
export function requiredCurrencyGrouping(
  field: string,
  type: string,
  objectFields: Readonly<Record<string, CurrencyFieldLike>> | undefined,
): string | undefined {
  if (!isMoneyAggregate(type)) return undefined;
  return recordCurrencyField(objectFields?.[field] as Parameters<typeof recordCurrencyField>[0]);
}

/**
 * The group-header aggregations the grid may draw: every configured one,
 * minus each money aggregate over a `record`-mode amount whose code field is
 * not among the grouping fields. Dropped before the rows are bucketed and
 * before the server is asked, so neither path computes a cross-currency sum.
 */
export function honestGroupAggregations(
  aggregations: GroupAggregationConfig[] | undefined,
  objectFields: Readonly<Record<string, CurrencyFieldLike>> | undefined,
  groupingFields: readonly string[],
): GroupAggregationConfig[] | undefined {
  if (!aggregations || aggregations.length === 0) return aggregations;
  const kept = aggregations.filter(({ field, type }) => {
    const code = requiredCurrencyGrouping(field, type, objectFields);
    return code === undefined || groupingFields.includes(code);
  });
  return kept.length === aggregations.length ? aggregations : kept;
}
