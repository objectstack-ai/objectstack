// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144, multi-currency M0-3] Two compile-time guards on a dataset's
 * measure currencies, `DATASET_INVALID` / 400 at compile, where the author
 * still holds the document. Each has a record-mode arm and a `fixed` arm; the
 * `fixed` arms narrow what compiled before, under ADR-0144 open item 12
 * (ruling 6486427200 on #8345, letter A).
 *
 * 1. **A measure `currency` that contradicts its field.** The column's chain
 *    lets the measure's code win (`enrichResultColumns`), so `currency: 'USD'`
 *    over a field fixed to `EUR` printed euros as dollars (probe A of the
 *    #8345 measurement round, `m_eur_as_usd`: 100 `"USD"`).
 *    - Over a record-mode amount, any one code: its currency is per row
 *      (ADR-0144 D2). That holds for a derived measure whose resolved currency
 *      is the record mode too (a sum of record-mode amounts over one code
 *      field): its column carries no per-row pointer, so the one code would
 *      label every row.
 *    - Over a `fixed` field, a code other than the field's. The same code is
 *      redundant, not wrong, and is accepted. That holds for a derived measure
 *      whose resolved currency is one `fixed` code (a sum of `fixed` amounts in
 *      one code): `computeDerived` keeps the operands' amounts, so the measure's
 *      code would label them as another currency.
 * 2. **A derived measure across currencies.** `computeDerived` adds,
 *    subtracts, multiplies and divides bare numbers, so such a value is not a
 *    number in any currency (probe A, `m_mixed_sum`: `200` with no currency).
 *    Refused, whatever the op, when two monetary operands provably differ and
 *    - one is a record-mode amount, and the other is another code field, a
 *      code or the tenant's; or
 *    - both resolve to `fixed` codes, and the codes differ.
 *    Non-monetary operands (a `count`) are not compared, so an amount per
 *    invoice stays legal.
 *
 * ⛔ Not judged (the ruling's own list): a `fixed` code against the tenant's
 * currency, which is not known at compile ("cannot answer, do not block"); a
 * measure `currency` over a `dynamic` field, the top of the #27119 Q2 X chain.
 * An operand whose code is such an explicit one is not a `fixed` code, so
 * guard 2 does not compare it with one either.
 *
 * ## The resolved currency, at compile
 *
 * The column's chain, with the request's half left symbolic: an explicit
 * measure `currency`, else the field's `fixed` code, else the tenant's (one
 * code per request, unknown here). A code is `fixed` when it is the field's
 * `fixed` code (restated or not). A record-mode amount resolves to its code
 * field. A derived `sum` / `difference` resolves to its operands' common
 * currency (none when they differ; `fixed` when every operand's is), so a
 * derived measure built on one is judged too; a `ratio` or `product`
 * resolves to none. The same reading labels the result column: a derived
 * measure that resolves to one `fixed` code carries that code on the wire
 * (`enrichResultColumns`, through {@link measureCurrencyResolver}).
 *
 * ## Not judged
 *
 * - No `declaredCurrency` hook (no data engine), or a field it cannot resolve.
 * - A relationship-path field (`account.amount`): the hook answers for the
 *   base object, as for the aggregate × field-type door.
 * - A duration measure, which counts time, not money.
 */

import type { Dataset, DatasetMeasure } from '@objectstack/spec/ui';
import { datasetInvalidError } from './dataset-refusal.js';

/**
 * A field's declared currency, as the host's `sourceFieldMeta` relays it:
 * `defaultCurrency` only under `fixed`, `currencyField` only under `record`.
 */
export interface DeclaredCurrency {
  readonly type?: string;
  readonly defaultCurrency?: string;
  readonly currencyField?: string;
}

type Resolved =
  | { readonly kind: 'code'; readonly code: string; readonly fixed: boolean }
  | { readonly kind: 'record'; readonly codeField: string }
  | { readonly kind: 'tenant' };

const currencyWords = (r: Resolved): string =>
  r.kind === 'code'
    ? r.code
    : r.kind === 'record'
      ? `each record's '${r.codeField}' (record currency)`
      : "the tenant's default currency";

/** Two currencies that are provably not one: two codes, two code fields, or a code field and anything else. */
function provablyDiffer(a: Resolved, b: Resolved): boolean {
  if (a.kind === 'record' || b.kind === 'record') {
    return !(a.kind === 'record' && b.kind === 'record' && a.codeField === b.codeField);
  }
  return a.kind === 'code' && b.kind === 'code' && a.code !== b.code;
}

/**
 * The pairs guard 2 refuses: a provable difference with a record-mode amount
 * on one side, or two different `fixed` codes.
 */
const pairRefused = (a: Resolved, b: Resolved): boolean =>
  ((a.kind === 'record' || b.kind === 'record') && provablyDiffer(a, b))
  || (a.kind === 'code' && a.fixed && b.kind === 'code' && b.fixed && a.code !== b.code);

type DeclaredCurrencyOf = ((objectName: string, field: string) => DeclaredCurrency | undefined) | undefined;

/**
 * Each measure's resolved currency (module header), which both guards read and
 * the result column of a derived measure takes (`enrichResultColumns`), so the
 * column says what compile judged. `declaredCurrency` answers for a bare field
 * of the base object, `undefined` when nothing authoritative can.
 */
export function measureCurrencyResolver(dataset: Dataset, declaredCurrency: DeclaredCurrencyOf) {
  const byName = new Map(dataset.measures.map((m) => [m.name, m]));
  const fieldOf = (m: DatasetMeasure): DeclaredCurrency | undefined =>
    m.field && !m.field.includes('.') ? declaredCurrency?.(dataset.object, m.field) : undefined;

  const memo = new Map<string, Resolved | undefined>();
  const resolving = new Set<string>();
  const resolvedOf = (m: DatasetMeasure): Resolved | undefined => {
    if (memo.has(m.name)) return memo.get(m.name);
    if (resolving.has(m.name)) return undefined;
    resolving.add(m.name);
    let r: Resolved | undefined;
    if (m.derived) {
      const common = (m.derived.op === 'sum' || m.derived.op === 'difference')
        ? monetaryOperands(m).map((o) => o.resolved)
        : [];
      const first = common[0];
      if (first && common.every((c) => !provablyDiffer(c, first))) {
        r = first.kind === 'code'
          ? { ...first, fixed: common.every((c) => c.kind === 'code' && c.fixed) }
          : first;
      }
    } else if (!m.duration) {
      const field = fieldOf(m);
      if (field?.currencyField !== undefined) r = { kind: 'record', codeField: field.currencyField };
      else if (m.currency) r = { kind: 'code', code: m.currency, fixed: field?.defaultCurrency === m.currency };
      else if (field?.type === 'currency') {
        r = field.defaultCurrency !== undefined
          ? { kind: 'code', code: field.defaultCurrency, fixed: true }
          : { kind: 'tenant' };
      }
    }
    resolving.delete(m.name);
    memo.set(m.name, r);
    return r;
  };
  const monetaryOperands = (m: DatasetMeasure): Array<{ name: string; resolved: Resolved }> =>
    (m.derived?.of ?? []).flatMap((name) => {
      const operand = byName.get(name);
      const resolved = operand ? resolvedOf(operand) : undefined;
      return resolved ? [{ name, resolved }] : [];
    });
  /** The one `fixed` code a measure resolves to, `undefined` for any other currency or none. */
  const fixedCodeOf = (m: DatasetMeasure): string | undefined => {
    const r = resolvedOf(m);
    return r?.kind === 'code' && r.fixed ? r.code : undefined;
  };
  return { fieldOf, resolvedOf, monetaryOperands, fixedCodeOf };
}

/**
 * Refuse the first measure of `dataset` that breaks either guard — see the
 * module header.
 */
export function assertMeasureCurrenciesCoherent(dataset: Dataset, declaredCurrency: DeclaredCurrencyOf): void {
  const { fieldOf, resolvedOf, monetaryOperands } = measureCurrencyResolver(dataset, declaredCurrency);

  // Guard 1 — a measure `currency` over a record-mode amount (aggregated or
  // derived), or contradicting a `fixed` code (a field's, or the one its
  // derived operands resolve to).
  for (const m of dataset.measures) {
    if (m.duration || !m.currency) continue;
    const field = m.derived ? undefined : fieldOf(m);
    if (field?.currencyField !== undefined) {
      throw datasetInvalidError(
        `[dataset-compiler] dataset "${dataset.name}" measure "${m.name}" declares currency "${m.currency}" `
        + `over field "${m.field}", a record-currency amount of object "${dataset.object}" whose currency is `
        + `each record's "${field.currencyField}". One code cannot label amounts in several currencies: `
        + `delete the measure's \`currency\`, and select the dimension over "${field.currencyField}" so each `
        + 'row carries its own.',
      );
    }
    if (field?.defaultCurrency !== undefined && field.defaultCurrency !== m.currency) {
      throw datasetInvalidError(
        `[dataset-compiler] dataset "${dataset.name}" measure "${m.name}" declares currency "${m.currency}" `
        + `over field "${m.field}", which object "${dataset.object}" fixes to ${field.defaultCurrency}. The `
        + `amounts are ${field.defaultCurrency}, so the column would print them as ${m.currency}: delete the `
        + `measure's \`currency\` (the column takes the field's ${field.defaultCurrency}).`,
      );
    }
    const resolved = m.derived ? resolvedOf(m) : undefined;
    if (resolved?.kind === 'record') {
      throw datasetInvalidError(
        `[dataset-compiler] dataset "${dataset.name}" derived measure "${m.name}" declares currency `
        + `"${m.currency}" over amounts in ${currencyWords(resolved)}. One code cannot label amounts in several `
        + "currencies: delete the measure's `currency`.",
      );
    }
    if (resolved?.kind === 'code' && resolved.fixed && resolved.code !== m.currency) {
      const operands = [...new Set(monetaryOperands(m).map((o) => `"${o.name}"`))].join(', ');
      throw datasetInvalidError(
        `[dataset-compiler] dataset "${dataset.name}" derived measure "${m.name}" declares currency `
        + `"${m.currency}" over measures ${operands}, whose amounts are fixed to ${resolved.code}. The amounts are `
        + `${resolved.code}, so the column would print them as ${m.currency}: delete the measure's \`currency\` `
        + `(the column takes the operands' ${resolved.code}), or restate ${resolved.code}.`,
      );
    }
  }

  // Guard 2 — a derived measure combining a record-mode amount with another
  // currency, or two different `fixed` codes.
  for (const m of dataset.measures) {
    if (!m.derived) continue;
    const operands = monetaryOperands(m);
    const pair = operands.flatMap((a, i) => operands.slice(i + 1).map((b) => [a, b] as const))
      .find(([a, b]) => pairRefused(a.resolved, b.resolved));
    if (!pair) continue;
    const [first, other] = pair;
    throw datasetInvalidError(
      `[dataset-compiler] dataset "${dataset.name}" derived measure "${m.name}" (${m.derived.op}) combines `
      + `measure "${first.name}", in ${currencyWords(first.resolved)}, with measure "${other.name}", in `
      + `${currencyWords(other.resolved)}. A ${m.derived.op} of amounts in different currencies is not a number in `
      + 'any currency: derive it from measures in one currency, or drop the operand in the other.',
    );
  }
}
