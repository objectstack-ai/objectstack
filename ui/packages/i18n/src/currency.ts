/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Resolve the display currency code for a currency-typed field, in precedence
 * order:
 *
 *  1. the field's explicit `currency` — a per-node display code. The spec
 *     declares it on presentation surfaces (the metric widget's `currency`, a
 *     dataset measure's `currency`) and looser grid/column configs carry it;
 *     `FieldSchema` itself refuses it as a field key;
 *  2. `currencyConfig.defaultCurrency`, ONLY when `currencyConfig.currencyMode`
 *     is `'fixed'` — the spec's one fixed-currency declaration;
 *  3. a legacy top-level `defaultCurrency` — a pre-spec spelling that
 *     `FieldSchema` refuses as an unrecognized key, kept in place so configs
 *     written against it still read their code;
 *  4. the tenant default (`localization.currency`, ADR-0053, surfaced via
 *     {@link useLocalization}).
 *
 * Returns `undefined` when none is known, so the renderer shows a plain number
 * rather than guessing a symbol.
 *
 * `currencyMode: 'dynamic'` — and a `currencyConfig` with no `currencyMode` at
 * all, which `@objectstack/spec` defaults to `'dynamic'` — skips step 2
 * (objectui#10422). The spec describes that mode as "user selectable", and its
 * `FieldSchema` guidance says a field without a fixed currency "uses the tenant
 * default at runtime". No value carries a user-selected code today (a currency
 * value is a bare number), so a dynamic field reads the tenant default, never
 * its `defaultCurrency`. That matters beyond authored dynamic configs: the
 * spec parses an EMPTY `currencyConfig` to
 * `{ currencyMode: 'dynamic', defaultCurrency: 'CNY' }`, which must not render
 * as yuan. If a value ever carries its own selected code, that code is the one
 * to win, ahead of the tenant default.
 *
 * This is the single resolution every field / measure / cell renderer shares -
 * ending the per-renderer drift where some read only `currency`, others only
 * `defaultCurrency`, and others `currencyConfig`. It lives in `@object-ui/i18n`
 * (alongside `useLocalization`) because the tenant default is a localization
 * concern; `@object-ui/fields` re-exports it for backward compatibility.
 */
export function resolveFieldCurrency(
  field:
    | {
        currency?: string;
        defaultCurrency?: string;
        currencyConfig?: { currencyMode?: 'dynamic' | 'fixed'; defaultCurrency?: string };
      }
    | null
    | undefined,
  tenantDefault?: string,
): string | undefined {
  const config = field?.currencyConfig;
  return (
    field?.currency ||
    (config?.currencyMode === 'fixed' ? config.defaultCurrency : undefined) ||
    field?.defaultCurrency ||
    tenantDefault ||
    undefined
  );
}
