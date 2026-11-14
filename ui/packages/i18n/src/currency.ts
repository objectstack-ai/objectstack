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
  /**
   * `record` mode only: the sibling field holding each record's ISO 4217 code,
   * or, on a `master_detail` child, `MASTER_DETAIL.CODE`: the parent's code
   * field reached through that `master_detail` (ADR-0144 D2 as amended).
   */
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
 * A `record`-mode pointer that follows the parent (ADR-0144 D2 as amended):
 * `via` is the amount's own `master_detail` field, `codeField` the parent's
 * code field. The child stores no code of its own.
 */
export interface RecordCurrencyPath {
  readonly via: string;
  readonly codeField: string;
}

/**
 * The parent path a `record`-mode amount's `currencyField` names, or
 * `undefined` for a sibling pointer, a non-record field, and any spelling the
 * spec does not admit (only exactly two non-empty segments are a path).
 */
export function recordCurrencyPath(
  field: { currencyConfig?: FieldCurrencyConfig } | null | undefined,
): RecordCurrencyPath | undefined {
  const pointer = recordCurrencyField(field);
  if (pointer === undefined) return undefined;
  const segments = pointer.split('.');
  if (segments.length !== 2 || segments[0] === '' || segments[1] === '') return undefined;
  return { via: segments[0], codeField: segments[1] };
}

/**
 * The field of the amount's OWN object a row must carry for
 * {@link resolveFieldCurrency} to read its code: the sibling code field, or
 * the `master_detail` a parent path starts with, which the read must also
 * EXPAND (a bare id holds no code). `undefined` outside `record` mode. A list
 * that projects its rows asks for this beside each record-mode amount it
 * shows, or the cell has no code to read.
 */
export function recordCurrencyReadField(
  field: { currencyConfig?: FieldCurrencyConfig } | null | undefined,
): { readonly field: string; readonly expand: boolean } | undefined {
  const path = recordCurrencyPath(field);
  if (path) return { field: path.via, expand: true };
  const pointer = recordCurrencyField(field);
  return pointer !== undefined && !pointer.includes('.') ? { field: pointer, expand: false } : undefined;
}

/** A related row as a read answers it expanded: an object, not a bare id. */
function isRowObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The id a `master_detail` value names, expanded or bare. */
function referencedId(value: unknown): string | undefined {
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value === 'number') return String(value);
  if (isRowObject(value)) return referencedId(value.id);
  return undefined;
}

/**
 * `record` with its parent row laid under the path's `master_detail`, so
 * {@link resolveFieldCurrency} reads the parent's code from it: the one way a
 * caller that holds the parent apart from the row (a record page's related
 * list, a master-detail form's line grid, a form that read the parent) hands
 * it over. `record` itself is returned when `field` follows no parent, when
 * there is no parent row, when the row already holds its parent expanded, and
 * when the row names ANOTHER parent: a parent is laid only under a row that
 * names it, or names none yet (a line not saved under its header).
 */
export function withFollowedParent<T extends Readonly<Record<string, unknown>>>(
  record: T | null | undefined,
  field: { currencyConfig?: FieldCurrencyConfig } | null | undefined,
  parent: Readonly<Record<string, unknown>> | null | undefined,
): T | Record<string, unknown> | null | undefined {
  const path = recordCurrencyPath(field);
  if (!path || !isRowObject(parent)) return record;
  const named = record?.[path.via];
  if (isRowObject(named)) return record;
  const namedId = referencedId(named);
  const parentId = referencedId(parent.id);
  if (namedId !== undefined && parentId !== undefined && namedId !== parentId) return record;
  return { ...(record ?? {}), [path.via]: parent };
}

/**
 * The code a `record`-mode amount reads off `record`: its sibling code field,
 * or, for a parent path, the code field of the parent row expanded under the
 * `master_detail`. A bare id there holds no code, so it reads as none.
 */
function recordCurrencyCode(
  field: { currencyConfig?: FieldCurrencyConfig } | null | undefined,
  record: Readonly<Record<string, unknown>> | null | undefined,
): unknown {
  const path = recordCurrencyPath(field);
  if (path) {
    const parent = record?.[path.via];
    return isRowObject(parent) ? parent[path.codeField] : undefined;
  }
  const codeField = recordCurrencyField(field);
  return codeField !== undefined ? record?.[codeField] : undefined;
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
 *     value of the sibling field `currencyConfig.currencyField` names, or,
 *     for a `MASTER_DETAIL.CODE` pointer (D2 as amended), the parent's code
 *     field on the parent row the record holds under that `master_detail`
 *     (expanded by the read, or laid there by {@link withFollowedParent}). No
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
    const code = recordCurrencyCode(field, record);
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
