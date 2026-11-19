// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144 D2 and D6, amended 2026-11-09 by #31743, ruling A recorded in
 * 6739066323] The two cross-object refusals of a child that follows its
 * parent's currency, worded once for the two doors that hold both objects:
 *
 * - `defineStack`'s cross-reference pass (`collectRecordCurrencyPathErrors`,
 *   `stack.zod.ts`), where a stack declares both;
 * - the engine registry (`SchemaRegistry.registerObject`, `@objectstack/objectql`),
 *   the door a single-object save reaches with the other end already
 *   registered.
 *
 * Kept in one module so a stack author and a single-object author read the
 * same words, and the two judgements cannot drift.
 *
 * - {@link isRecordCurrencyCodeField}: does a field hold an ISO 4217 code? A
 *   `VALUE_DOMAIN_FIELD_TYPES` field declaring
 *   `valueDomain: 'iso_4217_currency'`, the kind the amended D2 note requires
 *   segment 2 of a `PARENT_FIELD.CODE_FIELD` path to name.
 * - {@link recordCurrencyFollowedCodeError}: (a), segment 2 names no field of
 *   the parent, or a field that holds no code.
 * - {@link recordCurrencyUnfollowedRollupError}: (c), the arm of a
 *   `currencyMode: 'record'` roll-up whose child amount follows no parent.
 * - {@link storedHomeAmountSourceOf}: is a child field a stored home amount,
 *   named by a `homeAmount` that is valid where it is declared? The (d)
 *   refusal of a record-mode child reads it to name the home amount to roll up.
 * - {@link isTenantCurrencyAmount}: is a child field an amount in the
 *   organization's home (tenant) currency by declaration, a stored `currency`
 *   field in `dynamic` mode? The test (d) reads.
 * - {@link recordCurrencyDynamicRollupNotHomeError}: (d), a
 *   `currencyMode: 'dynamic'` roll-up over a child field that is not such an
 *   amount.
 *
 * Messages only and two predicates: each door decides when a pair is judged.
 */

import { VALUE_DOMAIN_FIELD_TYPES } from './field.zod';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasOwnKey = (value: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/**
 * Does `field` hold an ISO 4217 code: a `VALUE_DOMAIN_FIELD_TYPES` field
 * (`text` today) declaring `valueDomain: 'iso_4217_currency'`?
 */
export function isRecordCurrencyCodeField(field: unknown): boolean {
  return isRecord(field)
    && typeof field.type === 'string'
    && VALUE_DOMAIN_FIELD_TYPES.has(field.type)
    && field.valueDomain === 'iso_4217_currency';
}

/** The code fields of `fields`, as the prescription names them. */
function codeFieldCandidates(fields: Record<string, unknown>): string {
  const names = Object.keys(fields).filter((k) => isRecordCurrencyCodeField(fields[k]));
  return names.length > 0
    ? `candidates: ${names.map((n) => `'${n}'`).join(', ')}`
    : 'it has none; declare one, conventionally `currency_code: Field.text({ valueDomain: \'iso_4217_currency\' })`';
}

/** One record-mode amount following its parent through `VIA.CODE`, and the parent's field map. */
export interface RecordCurrencyFollowedCode {
  /** The object declaring the amount. */
  readonly object: string;
  /** The amount field. */
  readonly field: string;
  /** Segment 1: the amount's own `master_detail` field. */
  readonly via: string;
  /** Segment 2: the code field named on the parent. */
  readonly code: string;
  /** The object `via` references. */
  readonly parent: string;
  /** The parent's fields. */
  readonly parentFields: Record<string, unknown>;
}

/**
 * [ADR-0144 D2, amended] (a) The refusal of a record-mode amount whose
 * `currencyField` path `VIA.CODE` names, as segment 2, no field of the parent
 * or a field that holds no ISO 4217 code; `undefined` when segment 2 is a code
 * field ({@link isRecordCurrencyCodeField}). Segment 1 is the amount's own
 * object's to judge (`ObjectSchema`), and the caller has resolved it to
 * `parent`.
 */
export function recordCurrencyFollowedCodeError(input: RecordCurrencyFollowedCode): string | undefined {
  const { object, field, via, code, parent, parentFields } = input;
  const where = `Object '${object}' field '${field}' currencyConfig.currencyField`;
  const target = hasOwnKey(parentFields, code) ? parentFields[code] : undefined;
  if (!isRecord(target)) {
    return `${where}: '${via}.${code}' follows '${parent}', the object the master_detail `
      + `'${via}' references, and '${parent}' declares no field '${code}', so the amount `
      + `has no code to follow. Name the field of '${parent}' that holds its ISO 4217 code — `
      + `${codeFieldCandidates(parentFields)}.`;
  }
  if (isRecordCurrencyCodeField(target)) return undefined;
  const codeTypes = [...VALUE_DOMAIN_FIELD_TYPES].map((t) => `\`${t}\``).join(' or ');
  return `${where}: '${via}.${code}' follows '${parent}.${code}', a `
    + `'${String(target.type)}' field that does not hold an ISO 4217 code, so a write could store any value as `
    + `the currency. A followed code field is a ${codeTypes} field declaring \`valueDomain: 'iso_4217_currency'\` `
    + `on '${parent}' — ${codeFieldCandidates(parentFields)}.`;
}

/** A `summary` declaring `currencyMode: 'record'`, and the child amount it rolls up. */
export interface RecordCurrencyRecordRollup {
  /** The object declaring the summary. */
  readonly object: string;
  /** The summary field. */
  readonly field: string;
  /** `summaryOperations.function`. */
  readonly fn: string;
  /** `summaryOperations.object`. */
  readonly childObject: string;
  /** `summaryOperations.field`. */
  readonly childField: string;
}

/**
 * [ADR-0144 D6, amended] The head of every (c) refusal: a `record` roll-up
 * that is not the admitted one, followed by `why`.
 */
export function recordCurrencyRecordRollupError(rollup: RecordCurrencyRecordRollup, why: string): string {
  return `Object '${rollup.object}' field '${rollup.field}' currencyConfig: \`currencyMode: 'record'\` on a summary is admitted `
    + `only for a roll-up through a master_detail whose child amounts follow this record's currency through that `
    + `very field (\`currencyField: 'MASTER_DETAIL_FIELD.CODE_FIELD'\` on the child amount). This summary rolls up `
    + `${rollup.fn}(${rollup.childObject}.${rollup.childField}), and ${why}`;
}

/**
 * Why a child amount that follows no parent cannot be the subject of a
 * `record` roll-up, and what to declare instead.
 */
function unfollowedAmountReason(childObject: string, childField: string, def: unknown): string {
  const named = `'${childObject}.${childField}'`;
  const config = isRecord(def) && isRecord(def.currencyConfig) ? def.currencyConfig : undefined;
  if (config?.currencyMode === 'record' && typeof config.currencyField === 'string') {
    return `${named} is in each '${childObject}' record's own currency (the code in '${config.currencyField}'), so the `
      + 'roll-up would add amounts in several currencies. Make the child amount follow this record '
      + '(`currencyField: \'MASTER_DETAIL_FIELD.CODE_FIELD\'`), or roll up a stored home-currency amount of the child '
      + 'instead and declare that currency.';
  }
  if (config?.currencyMode === 'fixed' && typeof config.defaultCurrency === 'string') {
    return `${named} is fixed to ${config.defaultCurrency}, so the total is in ${config.defaultCurrency} whatever this `
      + `record's code holds. Declare \`currencyConfig: { currencyMode: 'fixed', defaultCurrency: '${config.defaultCurrency}' }\` `
      + 'on the summary instead.';
  }
  return `${named} declares no currency that follows this record, so the total is not in the currency this record's `
    + 'code holds. Delete `currencyConfig` on the summary, or declare `currencyMode: \'fixed\'` if every amount it reads '
    + 'is in one currency.';
}

/**
 * [ADR-0144 D6, amended] (c), the unfollowed arm: a `currencyMode: 'record'`
 * roll-up over a child amount `childDef` that follows no parent (its own code
 * field, a `fixed` code, or no currency at all), so the total is not in the
 * currency the summary's object holds.
 */
export function recordCurrencyUnfollowedRollupError(rollup: RecordCurrencyRecordRollup, childDef: unknown): string {
  return recordCurrencyRecordRollupError(rollup, unfollowedAmountReason(rollup.childObject, rollup.childField, childDef));
}

/** A field's `currencyConfig`, when it is an object. */
function currencyConfigOf(def: unknown): Record<string, unknown> | undefined {
  return isRecord(def) && isRecord(def.currencyConfig) ? def.currencyConfig : undefined;
}

/**
 * [ADR-0144 D5, D8 rule 5] Is `def` a field the engine alone writes a home
 * amount into: a stored `currency` field in `dynamic` mode (an absent mode is
 * `dynamic`), `readonly: true` and with no `expression`? The object door's
 * reading of a `homeAmount.field` target (`refuseDishonestHomeAmount`,
 * `data/object.zod.ts`).
 */
function isStoredHomeField(def: unknown): boolean {
  if (!isRecord(def) || def.type !== 'currency') return false;
  const mode = currencyConfigOf(def)?.currencyMode ?? 'dynamic';
  return mode === 'dynamic' && def.readonly === true && def.expression === undefined;
}

/** Does `def` declare a `homeAmount` whose `field` is `target`, where a `homeAmount` is valid: on a `record`-mode `currency` amount? */
function claimsHomeField(def: unknown, target: string): boolean {
  const config = currencyConfigOf(def);
  return isRecord(def) && def.type === 'currency' && config?.currencyMode === 'record'
    && isRecord(config.homeAmount) && config.homeAmount.field === target;
}

/**
 * [ADR-0144 D5] The amount field of `fields` whose `currencyConfig.homeAmount`
 * stores its home-currency value in `field`, or `undefined` when `field` is
 * not a stored home amount: the reading the (d) refusal of a record-mode child
 * amount uses to name the home amount to roll up instead.
 *
 * A `homeAmount` counts only where it is valid as declared, the reading the
 * object door (`refuseDishonestHomeAmount`, `data/object.zod.ts`) guarantees
 * for an authored object: it sits on a `record`-mode `currency` amount, and its
 * `field` names another field of the same map that is a stored `currency`
 * field in `dynamic` mode, `readonly: true` and with no `expression`, claimed
 * by that one amount alone. So a map the object door never parsed (an
 * object's fields merged with an extension's, or an object as a server serves
 * it) cannot make a plain number, a `fixed` amount or a writable field a home
 * amount by naming it in a `homeAmount`. The `rateDate` and `rateField`
 * pointers say nothing about which currency `field` holds, and are not read.
 */
export function storedHomeAmountSourceOf(fields: Record<string, unknown>, field: string): string | undefined {
  if (!hasOwnKey(fields, field) || !isStoredHomeField(fields[field])) return undefined;
  const claimants = Object.keys(fields).filter((name) => name !== field && claimsHomeField(fields[name], field));
  return claimants.length === 1 ? claimants[0] : undefined;
}

/**
 * [ADR-0144 D8 rule 5, seat ruling record 7000258793] Is `def` an amount in the
 * organization's home currency by declaration: a stored `currency` field in
 * `dynamic` mode (an absent `currencyConfig` or `currencyMode` is `dynamic`)?
 * The test (d) reads for the child field a `dynamic` summary may roll up.
 *
 * `dynamic` means "the field has no currency of its own — amounts display in
 * the tenant default currency (the `localization.currency` setting)"
 * (`CurrencyConfigSchema.currencyMode`), the one setting ADR-0144 D4 names the
 * home currency, so every row of such a field is in that currency and a total
 * of them is too. A stored home amount ({@link storedHomeAmountSourceOf}) is
 * one such field (D8 rule 5: "the home field is a `dynamic`-mode currency
 * field"). A `record` or `fixed` amount, a plain `number`, a `formula` and a
 * `summary` are not: the first two name another currency, and the others
 * declare no `currency` amount the roll-up reads.
 */
export function isTenantCurrencyAmount(def: unknown): boolean {
  if (!isRecord(def) || def.type !== 'currency') return false;
  return (currencyConfigOf(def)?.currencyMode ?? 'dynamic') === 'dynamic';
}

/** The fields of `fields` that {@link isTenantCurrencyAmount} admits, as the (d) prescription names them. */
function tenantCurrencyAmountsOf(fields: Record<string, unknown>): string[] {
  return Object.keys(fields).filter((name) => isTenantCurrencyAmount(fields[name]));
}

/**
 * [ADR-0144 D6, D8 rule 5] (d): a `summary` (`sum`, `min`, `max`, `avg`)
 * declaring `currencyMode: 'dynamic'` (or a `currencyConfig` with no
 * `currencyMode`) rolls up `childDef`, a field of `childFields` that is not an
 * amount in the home currency ({@link isTenantCurrencyAmount}), with the
 * declaration the child field does support. The faces draw a `dynamic` summary
 * in the organization's home currency, which the amounts it reads are not
 * known to be in.
 */
export function recordCurrencyDynamicRollupNotHomeError(
  rollup: RecordCurrencyRecordRollup,
  childFields: Record<string, unknown>,
  childDef: unknown,
): string {
  const named = `'${rollup.childObject}.${rollup.childField}'`;
  const config = currencyConfigOf(childDef);
  const declaredHome = isRecord(config?.homeAmount) && typeof config.homeAmount.field === 'string' ? config.homeAmount.field : undefined;
  const home = declaredHome !== undefined && storedHomeAmountSourceOf(childFields, declaredHome) === rollup.childField
    ? declaredHome
    : undefined;
  const amounts = tenantCurrencyAmountsOf(childFields);
  const kind = isRecord(childDef) && typeof childDef.type === 'string' ? `a '${childDef.type}' field` : 'not a field';
  const why = config?.currencyMode === 'record'
    ? `${named} is an amount in ${typeof config.currencyField === 'string' && config.currencyField.includes('.') ? 'its parent\'s' : 'each record\'s own'} `
      + `currency (\`currencyMode: 'record'\`), not the home currency. `
      + (home !== undefined
        ? `Roll up its stored home amount '${rollup.childObject}.${home}' instead, `
        : 'Roll up a stored home amount of the child instead (declare `homeAmount` on the amount), ')
      + 'or, when the amounts follow this record through the master_detail the roll-up runs through, declare '
      + '`currencyMode: \'record\'` naming this object\'s own code field.'
    : config?.currencyMode === 'fixed' && typeof config.defaultCurrency === 'string'
      ? `${named} is fixed to ${config.defaultCurrency}. Declare \`currencyConfig: { currencyMode: 'fixed', defaultCurrency: `
        + `'${config.defaultCurrency}' }\` on the summary instead.`
      : `${named} is ${kind}, not a \`currency\` field in \`dynamic\` mode, so its rows are not known to be in the home currency. `
        + (amounts.length > 0
          ? `The amounts of '${rollup.childObject}' in the home currency are ${amounts.map((h) => `'${h}'`).join(', ')}; `
            + 'roll up one of them, '
          : `'${rollup.childObject}' has no amount in the home currency; `)
        + 'or delete `currencyConfig` on the summary, or declare `currencyMode: \'fixed\'` if every amount it reads is in '
        + 'one currency.';
  return `Object '${rollup.object}' field '${rollup.field}' currencyConfig: \`currencyMode: 'dynamic'\` on a summary is `
    + 'admitted only for a roll-up of an amount in the organization\'s home currency: a child `currency` field in '
    + '`dynamic` mode (an absent `currencyMode` is `dynamic`), a stored home amount included, whose every row is in that '
    + `currency. This summary rolls up ${rollup.fn}(${rollup.childObject}.${rollup.childField}), and ${why}`;
}
