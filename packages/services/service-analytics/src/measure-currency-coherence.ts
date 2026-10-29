// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144, multi-currency M0-3] Two compile-time guards on a dataset's
 * measures over a `currencyMode: 'record'` amount, `DATASET_INVALID` / 400 at
 * compile, where the author still holds the document. Both judge the record
 * mode alone, a surface that ships with them, so neither refuses anything a
 * dataset could write before.
 *
 * 1. **A measure `currency` over a record-mode amount.** Its currency is per
 *    row (ADR-0144 D2), so any one code contradicts it, and the column's chain
 *    would let the measure's code win (`enrichResultColumns`). That holds for
 *    a derived measure whose resolved currency is the record mode too (a sum
 *    of record-mode amounts over one code field): its column carries no
 *    per-row pointer, so the one code would label every row.
 * 2. **A derived measure that combines a record-mode amount with an operand in
 *    another currency.** `computeDerived` adds, subtracts, multiplies and
 *    divides bare numbers, so such a value is not a number in any currency
 *    (probe A of the #8345 measurement round, `m_mixed_sum`: `200` with no
 *    currency). Refused, whatever the op, when a record-mode operand and another
 *    monetary operand provably differ: another code field, a `fixed` code, an
 *    explicit measure code or the tenant's. Non-monetary operands (a `count`)
 *    are not compared, so an amount per invoice stays legal.
 *
 * ⛔ Not judged here: the same two shapes over `fixed` fields only — a
 * measure `currency` contradicting a `fixed` field, a derived measure over two
 * different `fixed` codes. Refusing those narrows what compiles today, so
 * ADR-0144 open item 12 was ruled (6486427200 on #8345) to refuse them on a
 * card of its own after R1. A measure `currency` over a `dynamic` field stays
 * legal under either.
 *
 * ## The resolved currency, at compile
 *
 * The column's chain, with the request's half left symbolic: an explicit
 * measure `currency`, else the field's `fixed` code, else the tenant's (one
 * code per request, unknown here). A record-mode amount resolves to its code
 * field. A derived `sum` / `difference` resolves to its operands' common
 * currency (none when they differ), so a derived measure built on one is
 * judged too; a `ratio` or `product` resolves to none.
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
  | { readonly kind: 'code'; readonly code: string }
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

/** The pair guard 2 refuses: a provable difference with a record-mode amount on one side. */
const recordPairDiffers = (a: Resolved, b: Resolved): boolean =>
  (a.kind === 'record' || b.kind === 'record') && provablyDiffer(a, b);

/**
 * Refuse the first measure of `dataset` that breaks either guard — see the
 * module header. `declaredCurrency` answers for a bare field of the base
 * object, `undefined` when nothing authoritative can.
 */
export function assertMeasureCurrenciesCoherent(
  dataset: Dataset,
  declaredCurrency: ((objectName: string, field: string) => DeclaredCurrency | undefined) | undefined,
): void {
  const byName = new Map(dataset.measures.map((m) => [m.name, m]));
  const fieldOf = (m: DatasetMeasure): DeclaredCurrency | undefined =>
    m.field && !m.field.includes('.') ? declaredCurrency?.(dataset.object, m.field) : undefined;

  // Each measure's resolved currency (module header), which both guards read.
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
      r = common.length > 0 && common.every((c) => !provablyDiffer(c, common[0]!)) ? common[0] : undefined;
    } else if (!m.duration) {
      const field = fieldOf(m);
      if (field?.currencyField !== undefined) r = { kind: 'record', codeField: field.currencyField };
      else if (m.currency) r = { kind: 'code', code: m.currency };
      else if (field?.type === 'currency') {
        r = field.defaultCurrency !== undefined ? { kind: 'code', code: field.defaultCurrency } : { kind: 'tenant' };
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

  // Guard 1 — a measure `currency` over a record-mode amount, aggregated or derived.
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
    const resolved = m.derived ? resolvedOf(m) : undefined;
    if (resolved?.kind === 'record') {
      throw datasetInvalidError(
        `[dataset-compiler] dataset "${dataset.name}" derived measure "${m.name}" declares currency `
        + `"${m.currency}" over amounts in ${currencyWords(resolved)}. One code cannot label amounts in several `
        + "currencies: delete the measure's `currency`.",
      );
    }
  }

  // Guard 2 — a derived measure combining a record-mode amount with another currency.
  for (const m of dataset.measures) {
    if (!m.derived) continue;
    const operands = monetaryOperands(m);
    const pair = operands.flatMap((a, i) => operands.slice(i + 1).map((b) => [a, b] as const))
      .find(([a, b]) => recordPairDiffers(a.resolved, b.resolved));
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
