import type { Field as SpecField } from '@objectstack/spec/data';
import { recordCurrencyField, recordCurrencyPath, resolveFieldCurrency, type FieldCurrencyConfig } from '@object-ui/i18n';
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
 * Each amount is judged against the record with this pick's own writes
 * applied (`currency.targetCurrency`'s `writes`), so a pick that fills a code
 * field and an amount in that code together copies both.
 */
export function planDeclaredLookupAutofill(
  pairs: readonly LookupAutofillPair[] | undefined,
  picked: Values | null | undefined,
  current: Values | null | undefined,
  previous?: Values | null,
  currency?: AutofillCurrencyContext,
): LookupAutofillPlan {
  return judgePickWrites(declaredPickWrites(pairs, picked, current, previous), currency);
}

/**
 * The values the declared pairs would write on one pick, under the overwrite
 * rule ({@link planDeclaredLookupAutofill}), before the cross-currency rule
 * judges them.
 */
export function declaredPickWrites(
  pairs: readonly LookupAutofillPair[] | undefined,
  picked: Values | null | undefined,
  current: Values | null | undefined,
  previous?: Values | null,
): PickWrite[] {
  const out: PickWrite[] = [];
  if (!pairs?.length || !picked || typeof picked !== 'object') return out;
  for (const { target, source, overwrite } of pairs) {
    if (!(source in picked) || picked[source] === undefined) continue;
    const held = current?.[target];
    const filledByEarlierPick = !!previous && source in previous && sameValue(held, previous[source]);
    if (!(overwrite === true || isEmptyValue(held) || filledByEarlierPick)) continue;
    out.push({ target, source, value: picked[source], held });
  }
  return out;
}

/**
 * One value a pick would write: `value` from `source` into `target`, which
 * held `held` at the pick.
 */
export interface PickWrite {
  readonly target: string;
  readonly source: string;
  readonly value: unknown;
  readonly held?: unknown;
}

/**
 * The cross-currency judgement of every value one pick would write. Each is
 * judged against the record with all of this pick's writes applied (the
 * `writes` `currency.targetCurrency` is handed), so the code a pick writes
 * beside an amount is the code that amount is judged in. Without `currency`
 * every value is written.
 */
export function judgePickWrites(
  candidates: readonly PickWrite[],
  currency: AutofillCurrencyContext | undefined,
): LookupAutofillPlan {
  const plan: LookupAutofillPlan = { patch: {}, withheld: [] };
  const copiedAmounts: CopiedAutofill[] = [];
  const writes: Values = {};
  for (const c of candidates) writes[c.target] = c.value;
  for (const c of candidates) {
    const { withheld, copied } = judgeCopy(currency, c, writes);
    if (withheld) plan.withheld.push(withheld);
    else plan.patch[c.target] = c.value;
    if (copied) copiedAmounts.push(copied);
  }
  return copiedAmounts.length > 0 ? { ...plan, copied: copiedAmounts } : plan;
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
 *   named. It is copied only into an amount in the home currency;
 * - `unread`: an amount that follows the code of a parent the record names,
 *   whose code this host could not read (the read failed, or cannot run), so
 *   nothing can be judged against it.
 */
export type AmountCurrency =
  | { readonly kind: 'home' }
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'unset' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'unread' };

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
  writes?: Readonly<Record<string, unknown>> | null,
): AmountCurrency | undefined {
  if (!isMoneyDef(def)) return undefined;
  const code = resolveFieldCurrency(def, undefined, withCodeWrite(def, record, writes));
  if (code) return { kind: 'code', code };
  return def.currencyConfig?.currencyMode === 'record' ? UNSET : HOME;
}

/**
 * `record` with the write `writes` makes to `def`'s own code field applied: a
 * pick that fills the code beside the amount puts the amount in that code. A
 * parent's code is not the record's to write, so a parent path reads `record`
 * as it stands.
 */
function withCodeWrite(
  def: MoneyDef,
  record: Readonly<Record<string, unknown>> | null | undefined,
  writes: Readonly<Record<string, unknown>> | null | undefined,
): Readonly<Record<string, unknown>> | null {
  const codeField = recordCurrencyField(def);
  if (!writes || !codeField || recordCurrencyPath(def) || !Object.prototype.hasOwnProperty.call(writes, codeField)) {
    return record ?? null;
  }
  return { ...(record ?? {}), [codeField]: writes[codeField] };
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
 *   the amount being filled is in `to`;
 * - `targetCurrencyUnread`: the amount being filled follows a parent whose
 *   code could not be read.
 *
 * - `nowSameCurrency`: the record's currency has since changed, in the same
 *   edit, to the picked amount's own (`to`). The value stays unwritten (a
 *   currency change fills nothing), and a pick again fills it (the
 *   maintainer's ruling on objectstack-ai/objectstack#36412, branch B).
 *
 * `held` is the value the target held at the pick when it held one (a re-pick
 * over a filled target): the target keeps it, and the note says so.
 */
export interface WithheldAutofill {
  readonly target: string;
  readonly source: string;
  readonly amount: number;
  readonly reason: 'differs' | 'noTargetCurrency' | 'noSourceCurrency' | 'targetCurrencyUnread' | 'nowSameCurrency';
  readonly from?: string;
  readonly to?: string;
  readonly held?: unknown;
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
  if (target.kind === 'unread') return { reason: 'targetCurrencyUnread', ...(from ? { from } : {}) };
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
 * before. `targetCurrency` is handed this pick's own writes, by target name: a
 * target whose code field the pick writes is in that code
 * (`amountCurrencyOf`'s `writes`).
 */
export interface AutofillCurrencyContext {
  sourceCurrency: (source: string, value: unknown) => AmountCurrency | undefined;
  targetCurrency: (target: string, writes?: Readonly<Values>) => AmountCurrency | undefined;
  home: string | undefined;
}

/**
 * An amount one pick copied into `target`: the `value` written and `under`,
 * the code the target was in when it was written. A currency change in the
 * same edit leaves the amount as it is (the maintainer's ruling on
 * objectstack-ai/objectstack#36412, 「保留金额并提示」), and the host says
 * under which currency it was copied while the target still holds it
 * ({@link copiedAutofillNow}).
 */
export interface CopiedAutofill {
  readonly target: string;
  readonly source: string;
  readonly value: unknown;
  readonly under: string;
}

/**
 * The writes and the withheld values of one pick, and `copied`, the amounts
 * it wrote with the code each was written under. `copied` is absent when the
 * pick wrote no amount a currency judged (absent means none), so a plan built
 * without it stays a plan.
 */
export interface LookupAutofillPlan {
  patch: Values;
  withheld: WithheldAutofill[];
  copied?: CopiedAutofill[];
}

/** `write` judged against the record with this pick's `writes` applied: withheld with the reason, or copied (an amount under its target's code). */
function judgeCopy(
  ctx: AutofillCurrencyContext | undefined,
  { target, source, value, held }: PickWrite,
  writes: Readonly<Values>,
): { withheld?: WithheldAutofill; copied?: CopiedAutofill } {
  if (!ctx) return {};
  const to = ctx.targetCurrency(target, writes);
  const refusal = crossCurrencyRefusal(ctx.sourceCurrency(source, value), to, ctx.home);
  if (!refusal) {
    const under = to ? codeOf(to, ctx.home) : undefined;
    return under ? { copied: { target, source, value, under } } : {};
  }
  const amount = typeof value === 'number' ? value : Number(value);
  return { withheld: { target, source, amount, ...refusal, ...(isEmptyValue(held) ? {} : { held }) } };
}

/**
 * `item` judged again against `now`, the currency its target is in now: a
 * currency change in the same edit refreshes a withheld note to the new
 * currency (the maintainer's ruling on objectstack-ai/objectstack#36412,
 * item 3). Once the target is in the picked amount's own currency, the
 * value stays unwritten and the note says a pick again fills it
 * (`nowSameCurrency`, branch B). `item` itself when `now` is not known, or
 * when it names no code to say.
 */
export function withheldAutofillNow(
  item: WithheldAutofill,
  now: AmountCurrency | undefined,
  home: string | undefined,
): WithheldAutofill {
  if (!now) return item;
  const source: AmountCurrency = item.from ? { kind: 'code', code: item.from } : UNKNOWN;
  const { target, amount, held } = item;
  const base = { target, source: item.source, amount, ...(held === undefined ? {} : { held }) };
  const refusal = crossCurrencyRefusal(source, now, home);
  if (refusal) return { ...base, ...refusal };
  const to = codeOf(now, home);
  return to ? { ...base, reason: 'nowSameCurrency', ...(item.from ? { from: item.from } : {}), to } : item;
}

/**
 * The code to name beside an amount a pick copied (`item`) while its target
 * still holds it (`current`): the code the target is in `now`, when that is
 * known and differs from the one it was copied under. `undefined` says
 * nothing is to be said: the target was written since (a typed amount gets
 * no note), or the currency is unchanged or cannot be named.
 */
export function copiedAutofillNow(
  item: CopiedAutofill,
  current: unknown,
  now: AmountCurrency | undefined,
  home: string | undefined,
): string | undefined {
  if (!sameValue(current, item.value) || !now) return undefined;
  const to = codeOf(now, home);
  return to && to !== item.under ? to : undefined;
}

/**
 * Whether the note about `item` still stands over `current`, the value its
 * target holds now: the target still holds what it held at the pick (empty,
 * or the earlier value a re-pick left in place). Once somebody writes the
 * target, the note has said what it had to say.
 */
export function withheldStillStands(item: WithheldAutofill, current: unknown): boolean {
  return item.held === undefined ? isEmptyValue(current) : sameValue(current, item.held);
}

/** The translation call a widget holds (`useFieldTranslation().t`). */
type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The sentence that says why a pick left `item.target` empty, naming both
 * currencies and the picked amount in its own currency, so a person can
 * price it by hand. `label` is the target's label. A target that kept the
 * value it held at the pick (`held`) is said to keep it; under
 * `nowSameCurrency` it is told to clear the field before a pick again.
 */
export function withheldAutofillMessage(
  item: WithheldAutofill,
  label: string,
  t: Translate,
  locale: string | undefined,
): string {
  const amount = Number.isFinite(item.amount) ? formatCurrency(item.amount, item.from, locale) : String(item.amount);
  const why =
    item.reason === 'differs'
      ? t('lookup.autofillCurrencyDiffers', { field: label, amount, from: item.from, to: item.to })
      : item.reason === 'noSourceCurrency'
        ? t('lookup.autofillSourceNoCurrency', { field: label, amount, to: item.to })
        : item.reason === 'targetCurrencyUnread'
          ? t('lookup.autofillCurrencyUnread', { field: label, amount })
          : item.reason === 'nowSameCurrency'
            ? t('lookup.autofillNowSameCurrency', { field: label, amount, to: item.to })
            : t('lookup.autofillNoCurrency', { field: label, amount });
  if (item.held === undefined) return why;
  // A target that still holds an earlier value: a pick again of the same
  // record does not replace it (a declared pair without `overwrite` keeps a
  // value this record did not fill), so the sentence says to clear it first.
  if (item.reason === 'nowSameCurrency') return t('lookup.autofillNowSameCurrencyHeld', { field: label, amount, to: item.to });
  return `${why} ${t('lookup.autofillKept', { field: label })}`;
}

/**
 * The sentence beside an amount a pick copied, once the record's currency
 * changed in the same edit: the amount as it was copied, in the code it was
 * copied under, and the code the record is in `now`
 * ({@link copiedAutofillNow}).
 */
export function copiedAutofillMessage(
  item: CopiedAutofill,
  now: string,
  label: string,
  t: Translate,
  locale: string | undefined,
): string {
  const n = typeof item.value === 'number' ? item.value : Number(item.value);
  const amount = Number.isFinite(n) ? formatCurrency(n, item.under, locale) : String(item.value);
  return t('lookup.autofillCopiedUnder', { field: label, amount, to: now });
}

/**
 * The key a record form stamps the definitions of a lookup's `lookupAutofill`
 * targets under, on the lookup's own field metadata: the widget receives one
 * field, not the object, and a target's currency is its definition's. The
 * same hand-off shape as `FOLLOWED_PARENT_OBJECT_KEY` (`currency.ts`).
 *
 * The stamp is also the record form's statement that the lookup is drawn
 * for the record being edited, and so the one thing that lets a pick fill
 * other fields at all ({@link readLookupAutofillTargets}): `lookupAutofill`
 * is a fact about the object, honoured in a record form and a line-item grid
 * column, and a pick in any other host fills nothing.
 *
 * ⛔ Only a stamp {@link withLookupAutofillTargets} issued counts: a value
 * under this key that arrived as data (written by hand on a standalone form
 * node's field, or anywhere else) is no stamp, whatever its shape.
 */
export const LOOKUP_AUTOFILL_TARGETS_KEY = 'lookupAutofillTargets';

/**
 * Every target map {@link withLookupAutofillTargets} issued. Membership is
 * what makes the stamp the record form's statement rather than a document's:
 * nothing parsed from JSON is ever in it. A copy of the field def keeps the
 * map it carries, so the stamp survives every spread between the form and
 * the widget.
 */
const ISSUED_TARGET_STAMPS = new WeakSet<object>();

/**
 * `def` with the definitions of its `lookupAutofill` targets stamped, read
 * off `fields` (the edited object's field map), each carrying the parent
 * object it follows when its currency follows a parent (ADR-0144 D2 as
 * amended). `labels` names each field as the form shows it (translated);
 * a target the form draws carries that name as its `label`, so a note about
 * it names the field the way the form does. Only a host that edits one
 * record of the object calls this: the record form.
 *
 * A lookup that declares pairs is stamped even when `fields` names none of
 * its targets (the schema is still loading, the form has no metadata source,
 * a target is not a field of the map): the map is then empty, the pick
 * copies with no currency to judge, and the stamp still says the lookup is
 * drawn by a record form. `def` itself when it declares no pairs.
 */
export function withLookupAutofillTargets<T extends object>(
  def: T,
  fields: Readonly<Record<string, unknown>> | null | undefined,
  labels?: Readonly<Record<string, string>>,
): T {
  const pairs = (def as { lookupAutofill?: unknown }).lookupAutofill;
  if (!Array.isArray(pairs) || pairs.length === 0) return def;
  const targets: Record<string, object> = {};
  for (const pair of pairs as LookupAutofillPair[]) {
    const target = fields?.[pair?.target];
    if (!target || typeof target !== 'object') continue;
    const stamped = withFollowedParentObject(target, fields);
    const shown = labels?.[pair.target];
    targets[pair.target] = typeof shown === 'string' && shown !== '' ? { ...stamped, label: shown } : stamped;
  }
  const stamp = Object.freeze(targets);
  ISSUED_TARGET_STAMPS.add(stamp);
  return { ...def, [LOOKUP_AUTOFILL_TARGETS_KEY]: stamp };
}

/**
 * The target definitions a record form stamped on `field`
 * ({@link withLookupAutofillTargets}), possibly none, or `undefined` when no
 * record form stamped it. A value under the key that
 * {@link withLookupAutofillTargets} did not issue is no stamp.
 */
export function readLookupAutofillTargets(field: unknown): Readonly<Record<string, Record<string, unknown>>> | undefined {
  const value = (field as Record<string, unknown> | null | undefined)?.[LOOKUP_AUTOFILL_TARGETS_KEY];
  return value && typeof value === 'object' && ISSUED_TARGET_STAMPS.has(value)
    ? (value as Record<string, Record<string, unknown>>)
    : undefined;
}
