/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ADR-0144 D2 as amended, on a header-and-lines form: a line amount whose
 * `currencyField` is `MASTER_DETAIL.CODE` through the very relation the lines
 * hang under is in the header's currency. The line grid's columns carry no
 * field definition, so this host, which holds the child schema and the live
 * header record, names those columns' currency (`GridField`'s
 * `columnCurrencies`). Read through the one resolver, `resolveFieldCurrency`.
 */
import { recordCurrencyPath, resolveFieldCurrency, withFollowedParent, type FieldCurrencyConfig } from '@object-ui/i18n';
import type { ColumnCurrencies } from '@object-ui/fields';

type CurrencyDef = { currencyConfig?: FieldCurrencyConfig };

/**
 * The child fields whose currency follows the header through
 * `relationshipField`, by name, or `undefined` when none does (the common
 * case). A path through another `master_detail` follows another parent, never
 * this header, so it is not named.
 */
export function parentCurrencyFieldsOf(
  childFields: Readonly<Record<string, unknown>> | null | undefined,
  relationshipField: string | undefined,
): Readonly<Record<string, CurrencyDef>> | undefined {
  if (!childFields || typeof childFields !== 'object' || !relationshipField) return undefined;
  let out: Record<string, CurrencyDef> | undefined;
  for (const [name, def] of Object.entries(childFields)) {
    if (recordCurrencyPath(def as CurrencyDef)?.via !== relationshipField) continue;
    (out ??= {})[name] = def as CurrencyDef;
  }
  return out;
}

/**
 * The currency of each following column, read off the live header record. A
 * header with no code yet maps the column to `undefined`: no symbol, never the
 * tenant's, as the resolver answers a following row with a blank parent.
 */
export function followedColumnCurrencies(
  fields: Readonly<Record<string, CurrencyDef>> | undefined,
  header: Readonly<Record<string, unknown>> | null | undefined,
  tenantCurrency: string | undefined,
): ColumnCurrencies | undefined {
  if (!fields) return undefined;
  const out: Record<string, string | undefined> = {};
  for (const [name, def] of Object.entries(fields)) {
    out[name] = resolveFieldCurrency(def, tenantCurrency, withFollowedParent(undefined, def, header ?? {}));
  }
  return out;
}
