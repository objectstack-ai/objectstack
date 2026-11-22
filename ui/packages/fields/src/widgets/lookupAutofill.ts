import type { Field as SpecField } from '@objectstack/spec/data';
import { resolveFieldCurrency, type FieldCurrencyConfig } from '@object-ui/i18n';
import { formatCurrency } from './number-format.js';
import { withFollowedParentObject } from '../currency.js';

/**
 * One declared `{ target, source, overwrite? }` pair of `@objectstack/spec`'s
 * `FieldSchema.lookupAutofill`, typed by reference so the two cannot drift.
 */
export type LookupAutofillPair = NonNullable<SpecField['lookupAutofill']>[number];

/**
 * The declared pairs of the lookup fields of one object, keyed by the lookup
 * field's name: what a line-item grid is handed for its lookup columns, since
 * a grid column (`InlineGridColumnSchema`) carries no field definition.
 */
export type LookupAutofillByField = Readonly<Record<string, readonly LookupAutofillPair[]>>;

type Values = Record<string, unknown>;

/** A target holding nothing a person could have written. */
function isEmptyValue(v: unknown): boolean {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The writes one pick in a lookup makes under its declared `lookupAutofill`
 * pairs: each `target` of the record being edited takes the picked record's
 * `source`.
 *
 * The overwrite rule is the spec's (the key's describe): a pair without
 * `overwrite: true` fills its target only while the target is empty or still
 * holds the value an earlier pick filled in — `previous`, the record the lookup
 * held from an earlier pick in this same form or row, read at the same
 * `source`. A value the user typed or the record already stored stays. A pair
 * declaring `overwrite: true` replaces the target on every pick.
 *
 * A `source` the picked record does not carry (a field the reader may not
 * read is not served) writes nothing: a missing key is not a value.
 *
 * The cross-currency rule (`crossCurrencyRefusal`, read through `currency`):
 * an amount the pick would write into an amount in another currency is not
 * written; it is returned under `withheld`, so the host can say why the
 * target stayed as it was. Without `currency` every value copies as before.
 */
export function planDeclaredLookupAutofill(
  pairs: readonly LookupAutofillPair[] | undefined,
  picked: Values | null | undefined,
  current: Values | null | undefined,
  previous?: Values | null,
  currency?: AutofillCurrencyContext,
): LookupAutofillPlan {
  const plan: LookupAutofillPlan = { patch: {}, withheld: [] };
  if (!pairs?.length || !picked || typeof picked !== 'object') return plan;
  for (const { target, source, overwrite } of pairs) {
    if (!(source in picked) || picked[source] === undefined) continue;
    const held = current?.[target];
    const filledByEarlierPick = !!previous && source in previous && sameValue(held, previous[source]);
    if (!(overwrite === true || isEmptyValue(held) || filledByEarlierPick)) continue;
    const refused = judgeCopy(currency, target, source, picked[source]);
    if (refused) plan.withheld.push(refused);
    else plan.patch[target] = picked[source];
  }
  return plan;
}

/** {@link planDeclaredLookupAutofill}'s writes alone. */
export function declaredLookupAutofillPatch(
  pairs: readonly LookupAutofillPair[] | undefined,
  picked: Values | null | undefined,
  current: Values | null | undefined,
  previous?: Values | null,
  currency?: AutofillCurrencyContext,
): Values {
  return planDeclaredLookupAutofill(pairs, picked, current, previous, currency).patch;
}

/**
 * The declared `lookupAutofill` pairs of an object's fields, by lookup field
 * name. Only single-value `lookup` / `master_detail` fields carry the key (the
 * spec refuses it elsewhere), so only those are read.
 */
export function lookupAutofillByField(fields: Record<string, unknown> | undefined | null): LookupAutofillByField {
  const out: Record<string, readonly LookupAutofillPair[]> = {};
  if (!fields || typeof fields !== 'object') return out;
  for (const [name, def] of Object.entries(fields)) {
    const d = def as { type?: unknown; multiple?: unknown; lookupAutofill?: unknown } | null | undefined;
    if (!d || (d.type !== 'lookup' && d.type !== 'master_detail') || d.multiple === true) continue;
    if (Array.isArray(d.lookupAutofill) && d.lookupAutofill.length > 0) {
      out[name] = d.lookupAutofill as LookupAutofillPair[];
    }
  }
  return out;
}

/**
 * The currency one amount of a pick is in, for the cross-currency rule a pick
 * follows (the maintainer's ruling on objectstack-ai/objectstack#36249: when
 * the two currencies differ, the value is not copied and the form says why).
 *
 * - `home`: the amount declares no currency of its own (no `currencyConfig`,
 *   or `dynamic`), so it is in the organization's home currency (ADR-0144 D2);
 * - `code`: the amount is in a known ISO 4217 code, a `fixed` code or the
 *   code its record holds (`record` mode, the parent's code included);
 * - `unset`: a `record`-mode amount whose record holds no code yet;
 * - `unknown`: a picked value whose field definition this host does not hold
 *   (the referenced object's schema did not load), so its currency cannot be
 *   named. It is copied only into an amount in the home currency.
 */
export type AmountCurrency =
  | { readonly kind: 'home' }
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'unset' }
  | { readonly kind: 'unknown' };

const HOME: AmountCurrency = Object.freeze({ kind: 'home' });
const UNSET: AmountCurrency = Object.freeze({ kind: 'unset' });
const UNKNOWN: AmountCurrency = Object.freeze({ kind: 'unknown' });

interface MoneyDef {
  type?: unknown;
  returnType?: unknown;
  currencyConfig?: FieldCurrencyConfig;
}

/** Is `def` an amount of money: a `currency` field, or a `formula` returning one. */
function isMoneyDef(def: MoneyDef | null | undefined): def is MoneyDef {
  if (!def || typeof def !== 'object') return false;
  return def.type === 'currency' || (def.type === 'formula' && def.returnType === 'currency');
}

/**
 * The currency of the amount `def` declares, read on `record` (the row the
 * amount sits in), or `undefined` when `def` is no amount of money: a
 * `number` carries no currency and copies as before.
 *
 * Read through `resolveFieldCurrency`, the one resolver every currency face
 * shares, handed no tenant default: a field it answers no code for declares
 * none of its own, so it is in the home currency.
 */
export function amountCurrencyOf(
  def: MoneyDef | null | undefined,
  record?: Readonly<Record<string, unknown>> | null,
): AmountCurrency | undefined {
  if (!isMoneyDef(def)) return undefined;
  const code = resolveFieldCurrency(def, undefined, record ?? null);
  if (code) return { kind: 'code', code };
  return def.currencyConfig?.currencyMode === 'record' ? UNSET : HOME;
}

/**
 * The currency of a picked value whose field definition may be missing: the
 * field's own answer when `def` is known, else `unknown` for a number (it may
 * be an amount) and `undefined` for anything else.
 */
export function pickedAmountCurrencyOf(
  def: MoneyDef | null | undefined,
  value: unknown,
  picked: Readonly<Record<string, unknown>> | null | undefined,
): AmountCurrency | undefined {
  if (def && typeof def === 'object') return amountCurrencyOf(def, picked);
  return typeof value === 'number' ? UNKNOWN : undefined;
}

/** The code `c` names, the home currency read as `home` when one is configured. */
function codeOf(c: AmountCurrency, home: string | undefined): string | undefined {
  if (c.kind === 'code') return c.code;
  if (c.kind === 'home') return home || undefined;
  return undefined;
}

/**
 * Why a pick did not copy one value: the picked `amount` and the two
 * currencies, so the form can say so and a person can price it by hand.
 *
 * - `differs`: both currencies are known and differ (`from` → `to`);
 * - `noTargetCurrency`: the amount being filled follows a record that holds
 *   no currency yet;
 * - `noSourceCurrency`: the picked amount's currency cannot be named, while
 *   the amount being filled is in `to`.
 */
export interface WithheldAutofill {
  readonly target: string;
  readonly source: string;
  readonly amount: number;
  readonly reason: 'differs' | 'noTargetCurrency' | 'noSourceCurrency';
  readonly from?: string;
  readonly to?: string;
}

/**
 * The cross-currency rule of a pick, as one predicate: `undefined` when the
 * value copies, else why it does not.
 *
 * A value copies as before when either side is no amount of money, and when
 * both amounts are in the home currency (an organization with no home
 * currency configured included). Otherwise it copies only when both sides
 * name the same known code: the home currency counts as its configured code.
 * Nothing is converted, and nothing is copied at an implied rate of 1.
 */
export function crossCurrencyRefusal(
  source: AmountCurrency | undefined,
  target: AmountCurrency | undefined,
  home: string | undefined,
): Pick<WithheldAutofill, 'reason' | 'from' | 'to'> | undefined {
  if (!source || !target) return undefined;
  if (target.kind === 'home' && (source.kind === 'home' || source.kind === 'unknown')) return undefined;
  const from = codeOf(source, home);
  const to = codeOf(target, home);
  if (from && to && from === to) return undefined;
  if (target.kind === 'unset') return { reason: 'noTargetCurrency', ...(from ? { from } : {}) };
  if (!from) return { reason: 'noSourceCurrency', ...(to ? { to } : {}) };
  if (!to) return { reason: 'noTargetCurrency', from };
  return { reason: 'differs', from, to };
}

/**
 * What a host knows about the currencies of one pick: the currency of each
 * value the picked record offers (`sourceCurrency`, by source field name, read
 * on the picked record) and of each field of the record being edited
 * (`targetCurrency`, by target name), plus the organization's home currency.
 * A host that knows neither side passes no context, and every value copies as
 * before.
 */
export interface AutofillCurrencyContext {
  sourceCurrency: (source: string, value: unknown) => AmountCurrency | undefined;
  targetCurrency: (target: string) => AmountCurrency | undefined;
  home: string | undefined;
}

/** The writes and the withheld values of one pick. */
export interface LookupAutofillPlan {
  patch: Values;
  withheld: WithheldAutofill[];
}

/** `value` copied from `source` into `target`, or the reason it is not. */
function judgeCopy(
  ctx: AutofillCurrencyContext | undefined,
  target: string,
  source: string,
  value: unknown,
): WithheldAutofill | undefined {
  if (!ctx) return undefined;
  const refusal = crossCurrencyRefusal(ctx.sourceCurrency(source, value), ctx.targetCurrency(target), ctx.home);
  if (!refusal) return undefined;
  const amount = typeof value === 'number' ? value : Number(value);
  return { target, source, amount, ...refusal };
}

/** The translation call a widget holds (`useFieldTranslation().t`). */
type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The sentence that says why a pick left `item.target` empty, naming both
 * currencies and the picked amount in its own currency, so a person can
 * price it by hand. `label` is the target's label.
 */
export function withheldAutofillMessage(
  item: WithheldAutofill,
  label: string,
  t: Translate,
  locale: string | undefined,
): string {
  const amount = Number.isFinite(item.amount) ? formatCurrency(item.amount, item.from, locale) : String(item.amount);
  if (item.reason === 'differs') {
    return t('lookup.autofillCurrencyDiffers', { field: label, amount, from: item.from, to: item.to });
  }
  if (item.reason === 'noSourceCurrency') {
    return t('lookup.autofillSourceNoCurrency', { field: label, amount, to: item.to });
  }
  return t('lookup.autofillNoCurrency', { field: label, amount });
}

/**
 * The key a record form stamps the definitions of a lookup's `lookupAutofill`
 * targets under, on the lookup's own field metadata: the widget receives one
 * field, not the object, and a target's currency is its definition's. The
 * same hand-off shape as `FOLLOWED_PARENT_OBJECT_KEY` (`currency.ts`).
 */
export const LOOKUP_AUTOFILL_TARGETS_KEY = 'lookupAutofillTargets';

/**
 * `def` with the definitions of its `lookupAutofill` targets stamped, read
 * off `fields` (the edited object's field map), each carrying the parent
 * object it follows when its currency follows a parent (ADR-0144 D2 as
 * amended). `def` itself when it declares no pairs or `fields` names none of
 * its targets.
 */
export function withLookupAutofillTargets<T extends object>(
  def: T,
  fields: Readonly<Record<string, unknown>> | null | undefined,
): T {
  const pairs = (def as { lookupAutofill?: unknown }).lookupAutofill;
  if (!Array.isArray(pairs) || pairs.length === 0 || !fields) return def;
  const targets: Record<string, object> = {};
  for (const pair of pairs as LookupAutofillPair[]) {
    const target = fields[pair?.target];
    if (target && typeof target === 'object') targets[pair.target] = withFollowedParentObject(target, fields);
  }
  return Object.keys(targets).length > 0 ? { ...def, [LOOKUP_AUTOFILL_TARGETS_KEY]: targets } : def;
}

/** The target definitions a form stamped on `field`, or `undefined`. */
export function readLookupAutofillTargets(field: unknown): Readonly<Record<string, Record<string, unknown>>> | undefined {
  const value = (field as Record<string, unknown> | null | undefined)?.[LOOKUP_AUTOFILL_TARGETS_KEY];
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Record<string, unknown>>)
    : undefined;
}
