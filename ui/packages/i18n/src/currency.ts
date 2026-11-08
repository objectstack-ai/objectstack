/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The currency config a field declares, in the three modes of
 * `@objectstack/spec`'s `CurrencyConfigSchema` (ADR-0144 D2 adds `record`).
 */
export interface FieldCurrencyConfig {
  currencyMode?: 'dynamic' | 'fixed' | 'record';
  defaultCurrency?: string;
  /** `record` mode only: the sibling field holding each record's ISO 4217 code. */
  currencyField?: string;
  /** `record` mode only (ADR-0144 D5): where the engine stores the amount in the home currency. */
  homeAmount?: { field?: string; rateDate?: string; rateField?: string };
}

/**
 * The sibling code field a `record`-mode amount points at (ADR-0144 D2), or
 * `undefined` for a `dynamic` / `fixed` field and for anything that is not a
 * currency config at all. The one reading every surface that needs the
 * pointer itself — the form's code select, the grid footer's grouping test,
 * the filter builder — shares, so none of them re-derives the mode test.
 */
export function recordCurrencyField(
  field: { currencyConfig?: FieldCurrencyConfig } | null | undefined,
): string | undefined {
  const config = field?.currencyConfig;
  if (config?.currencyMode !== 'record') return undefined;
  return typeof config.currencyField === 'string' && config.currencyField !== ''
    ? config.currencyField
    : undefined;
}

/**
 * Where a home field's stored amount came from (ADR-0144 D5): the
 * `record`-mode amount whose `currencyConfig.homeAmount.field` names it, that
 * amount's code field, and the document-date and rate fields the engine wrote
 * beside it. Read off the object's field map, never stated twice: the home
 * field itself declares nothing that says it is one.
 */
export interface HomeAmountSource {
  /** The `record`-mode amount the engine converted. */
  readonly amountField: string;
  /** That amount's `currencyConfig.currencyField`: the code it is in. */
  readonly codeField: string;
  /** `homeAmount.rateDate`: the document date that picked the rate. */
  readonly rateDateField: string;
  /** `homeAmount.rateField`: the rate the engine used. */
  readonly rateField: string;
}

/**
 * The amount that names `name` as its home field, or `undefined` when none
 * does (the common case). The first declaring amount answers, as the spec's
 * object judge gives a home field to its first claimant only.
 */
export function homeAmountSourceOf(
  fields: Readonly<Record<string, unknown>> | null | undefined,
  name: string,
): HomeAmountSource | undefined {
  if (!fields || typeof fields !== 'object') return undefined;
  for (const [amountField, def] of Object.entries(fields)) {
    const config = (def as { currencyConfig?: FieldCurrencyConfig } | null)?.currencyConfig;
    const codeField = recordCurrencyField(def as { currencyConfig?: FieldCurrencyConfig });
    const home = config?.homeAmount;
    if (codeField === undefined || !home || home.field !== name) continue;
    if (typeof home.rateDate !== 'string' || typeof home.rateField !== 'string') continue;
    return { amountField, codeField, rateDateField: home.rateDate, rateField: home.rateField };
  }
  return undefined;
}

/**
 * The key a producer stamps {@link HomeAmountSource} under on the field
 * metadata it hands a currency renderer, the way the form stamps a code
 * field's `usedCurrencyCodes`: a renderer receives one field, not the object.
 */
export const HOME_AMOUNT_SOURCE_KEY = 'homeAmountSource';

/** `def` with its {@link HomeAmountSource} stamped, or `def` itself when `name` is no home field. */
export function withHomeAmountSource<T extends object>(
  def: T,
  fields: Readonly<Record<string, unknown>> | null | undefined,
  name: string,
): T {
  const source = homeAmountSourceOf(fields, name);
  return source ? { ...def, [HOME_AMOUNT_SOURCE_KEY]: source } : def;
}

/** The {@link HomeAmountSource} a producer stamped on `field`, or `undefined`. */
export function readHomeAmountSource(field: unknown): HomeAmountSource | undefined {
  const source = (field as Record<string, unknown> | null | undefined)?.[HOME_AMOUNT_SOURCE_KEY];
  return source && typeof source === 'object' ? (source as HomeAmountSource) : undefined;
}

/**
 * Resolve the display currency code for a currency-typed field, in precedence
 * order:
 *
 *  0. a `record`-mode field (ADR-0144 D2) reads ONLY the record in scope: the
 *     value of the sibling field `currencyConfig.currencyField` names. No
 *     record, or a record whose code is blank, resolves to `undefined` — never
 *     to steps 1–4. The record's code field is the only place that amount's
 *     currency lives, so the tenant default would name a currency the amount
 *     is not in: an amount of 100 EUR shown as `¥100` is worse than `100`;
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
 * its `defaultCurrency`. That matters beyond authored dynamic configs: until
 * @objectstack/spec dropped the `'CNY'` default (#27157), the spec parsed an
 * EMPTY `currencyConfig` to `{ currencyMode: 'dynamic', defaultCurrency: 'CNY' }`,
 * and rows stored or built by that parse still carry it until a rehydration
 * strips it; it must not render as yuan. The spec now refuses a `fixed`
 * config without a code at authoring and save, but a stored row saved that
 * way before is kept as authored and still loads with no code; step 2 skips
 * it and the tenant default shows, as it always did. If a value ever carries
 * its own selected code, that code is the one to win, ahead of the tenant
 * default.
 *
 * `currencyMode: 'record'` (ADR-0144 D2) is step 0's alone: the field has no
 * currency of its own — each record's code lives in the sibling field
 * `currencyConfig.currencyField` names, which only a caller holding the row
 * can pass. No other step applies, the tenant default included: a record whose
 * code is blank, or a call with no record (a metric tile, an aggregate),
 * shows no symbol rather than a currency it never named.
 *
 * This is the single resolution every field / measure / cell renderer shares -
 * ending the per-renderer drift where some read only `currency`, others only
 * `defaultCurrency`, and others `currencyConfig`. It lives in `@object-ui/i18n`
 * (alongside `useLocalization`) because the tenant default is a localization
 * concern; `@object-ui/fields` re-exports it for backward compatibility.
 *
 * `record` is the row / form values the amount sits in. A caller that holds no
 * record (a column-level header, a footer over many rows) passes none, and a
 * `record`-mode field then resolves to no currency, which is the honest answer
 * for a set of amounts in different currencies.
 */
export function resolveFieldCurrency(
  field:
    | {
        currency?: string;
        defaultCurrency?: string;
        currencyConfig?: FieldCurrencyConfig;
      }
    | null
    | undefined,
  tenantDefault?: string,
  record?: Readonly<Record<string, unknown>> | null,
): string | undefined {
  const config = field?.currencyConfig;
  if (config?.currencyMode === 'record') {
    const codeField = recordCurrencyField(field);
    const code = codeField !== undefined ? record?.[codeField] : undefined;
    return typeof code === 'string' && code !== '' ? code : undefined;
  }
  return (
    field?.currency ||
    (config?.currencyMode === 'fixed' ? config.defaultCurrency : undefined) ||
    field?.defaultCurrency ||
    tenantDefault ||
    undefined
  );
}
