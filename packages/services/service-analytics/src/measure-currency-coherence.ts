// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0144, multi-currency M0-3] Two compile-time guards on a dataset's
 * measure currencies — the guards the measurement round on #8345 (its Q6)
 * found missing on today's surface, `DATASET_INVALID` / 400 at compile, where
 * the author still holds the document.
 *
 * 1. **A measure `currency` that contradicts its field.** The column's
 *    currency chain lets an explicit measure `currency` win over everything
 *    (`enrichResultColumns`), so `currency: 'USD'` over a field fixed to `EUR`
 *    printed euros as dollars (probe A, `m_eur_as_usd`: 100 `"USD"`). Refused
 *    when the field is `fixed` to a different code, and over every
 *    `record`-mode field, whose currency is per row and so is contradicted by
 *    any one code. The same code as a `fixed` field's is redundant, not
 *    wrong, and is accepted. A `dynamic` field is not judged: its currency is
 *    the tenant's, which is not known at compile.
 * 2. **A derived measure across differing currencies.** `computeDerived` adds,
 *    subtracts, multiplies and divides bare numbers, so `sum` over a USD
 *    measure and an EUR measure answered `200` with no currency at all (probe
 *    A, `m_mixed_sum`). Refused when two of its operands are monetary and
 *    their resolved currencies provably differ, whatever the op: a ratio or a
 *    product of two amounts in two currencies is no more a number than their
 *    sum. Non-monetary operands (a `count`) are not compared, so revenue per
 *    deal stays legal.
 *
 * ## The resolved currency, at compile
 *
 * The column's chain, with the request's half left symbolic: an explicit
 * measure `currency`, else the field's `fixed` code, else the tenant's (one
 * code per request, unknown here). A `record`-mode amount resolves to its code
 * field. Two currencies provably differ when they are two codes, two different
 * code fields, or a code field against anything else; the tenant's against a
 * code is NOT provably different and is not judged ("cannot answer, do not
 * block"). A derived `sum` / `difference` resolves to its operands' common
 * currency, so a derived measure built on one is judged too; a `ratio` or
 * `product` resolves to none.
 *
 * ## Not judged
 *
 * - No `declaredCurrency` hook (no data engine), or a field it cannot resolve:
 *   only an explicit measure `currency` is known then.
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

function provablyDiffer(a: Resolved, b: Resolved): boolean {
  if (a.kind === 'record' || b.kind === 'record') {
    return !(a.kind === 'record' && b.kind === 'record' && a.codeField === b.codeField);
  }
  return a.kind === 'code' && b.kind === 'code' && a.code !== b.code;
}

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

  // Guard 1 — a measure `currency` that contradicts its field.
  for (const m of dataset.measures) {
    if (m.derived || m.duration || !m.currency || !m.field) continue;
    const field = fieldOf(m);
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
  }

  // Guard 2 — a derived measure across differing currencies.
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

  for (const m of dataset.measures) {
    if (!m.derived) continue;
    const operands = monetaryOperands(m);
    const first = operands[0];
    const other = operands.find((o) => first && provablyDiffer(o.resolved, first.resolved));
    if (!first || !other) continue;
    throw datasetInvalidError(
      `[dataset-compiler] dataset "${dataset.name}" derived measure "${m.name}" (${m.derived.op}) combines `
      + `measure "${first.name}", in ${currencyWords(first.resolved)}, with measure "${other.name}", in `
      + `${currencyWords(other.resolved)}. A ${m.derived.op} of amounts in different currencies is not a number in `
      + 'any currency: derive it from measures in one currency, or drop the operand in the other.',
    );
  }
}
