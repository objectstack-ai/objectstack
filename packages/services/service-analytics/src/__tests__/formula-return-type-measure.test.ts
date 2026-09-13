// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16236 → ⚠️ **REVERSED by #17560.** This file used to pin that a `min`/`max`
 * over a `formula` field is described by the type that formula was DECLARED to
 * return. The pair is refused now, so there is no descriptor to describe it
 * with — and this file is re-aimed onto the refusal rather than deleted, so the
 * evidence #16236 gathered stays readable beside the ruling that retired it.
 *
 * ## What #16236 measured, and why it was right about the VALUE
 *
 * `FieldSchema.returnType` (`packages/spec/src/data/field.zod.ts`) declares the
 * value type a formula computes, and its own JSDoc names this exact consumer
 * FIRST:
 *
 * > Lets consumers — dataset measures, display formatting, validation — read a
 * > declared type instead of re-parsing the expression.
 *
 * Driven end-to-end through `AnalyticsService.queryDataset` on `origin/main` @
 * `bea76c928`, two measures over two formula fields (one declaring
 * `returnType: 'text'`, one `'date'`) answered:
 *
 * ```json
 * {"rows":[{"first_label":"alpha","latest_due":"2026-06-01"}],
 *  "fields":[{"name":"first_label","type":"number","label":"First Label"},
 *            {"name":"latest_due","type":"number","label":"Latest Due"}]}
 * ```
 *
 * Both values strings, both descriptors `number`. #16236 carried `returnType`
 * onto `AnalyticsServiceConfig.sourceFieldMeta` and TRANSLATED it into the wire
 * vocabulary (`text` → `'string'`, `date` → `'time'`), and five cases pinned
 * that end to end.
 *
 * ## ⛔ What it was answering, and the ruling that stopped the question
 *
 * `AGGREGATE_FIELD_TYPE_COMPATIBILITY` never listed `formula` under `min` or
 * `max`. That contradiction was visible at the time and was recorded rather
 * than resolved — this file's own header said the branch "becomes unreachable
 * and inert — never wrong" if the `min` / `max` rows were ever executed.
 *
 * The director ruling of decision batch #127 (2026-09-13, #17560) executed
 * them, and named `formula` specifically, on the table's own storage ground:
 *
 * > `formula`: refused, on the table's own storage ground — it is VIRTUAL in
 * > SQL storage, no column is emitted, so no aggregate can be lowered to it
 * > whatever `returnType` says; the five `formula-return-type-measure` cases
 * > pin a result TYPE, not a capability, and are retired with the reversal
 * > named.
 *
 * ⇒ A declared `returnType` says what the expression COMPUTES; it does not
 * create a column for a backend to take a `min` of. The five end-to-end cases
 * pinned a result type for a pair no backend was ever asked, so they are
 * replaced — same fixture, same door — by the refusal the platform now gives.
 * `measureResultType`'s third input went with the branch: with the `formula`
 * branch gone it had no reader, and a declared input nobody consumes is the
 * declared-not-enforced shape Prime Directive #10 refuses.
 *
 * ⚠️ `returnType` itself is UNTOUCHED as an authoring key — display formatting
 * and validation are its other declared consumers, and this card speaks only
 * about the dataset-measure one.
 *
 * ## Reverse verification, direction predicted BEFORE running
 *
 * Restoring `if (!DERIVING_AGGREGATES.has(aggregate)) return;` in
 * `dataset-compiler.ts` must turn every case in section B red in the ordinary
 * direction — the compile succeeds, so no refusal is thrown and `refusalOf`
 * fails loudly rather than any case passing vacuously. Section A is a unit walk
 * over the rule and is predicted to stay GREEN under that mutation (the rule
 * reads the table directly, not the door). Measured: recorded in the PR body.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import { FieldSchema, isAggregateCompatibleWithFieldType } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { MEASURE_RESULT_TYPE_TEMPORAL, measureResultType } from '../measure-result-type.js';

/**
 * The four members, read off the SPEC schema rather than restated here — the
 * same construction the `FieldType` walk in `measure-result-type.test.ts` uses.
 * A fifth member added upstream reds the exhaustiveness case below instead of
 * quietly inheriting a verdict nobody wrote for it.
 */
const SPEC_RETURN_TYPES: readonly string[] = (() => {
  const node = (FieldSchema as unknown as { shape: Record<string, unknown> }).shape.returnType;
  let inner = node as { options?: readonly string[]; unwrap?: () => unknown };
  for (let i = 0; i < 4 && inner && !inner.options; i++) {
    inner = inner.unwrap?.() as typeof inner;
  }
  if (!inner?.options) throw new Error('could not read FieldSchema.returnType options from the spec schema');
  return inner.options;
})();

describe('A) the formula branch is retired — no declared returnType buys a result type back', () => {
  it('the spec still declares the four members this file was written about', () => {
    // The enum is read, not restated: the reversal is about what the MEASURE
    // rule does with `returnType`, not about the key going away.
    expect([...SPEC_RETURN_TYPES].sort()).toEqual(['boolean', 'date', 'number', 'text']);
  });

  it('⭐ the table REFUSES `min` / `max` over `formula` — the ground the ruling stood on', () => {
    expect(isAggregateCompatibleWithFieldType('min', 'formula')).toBe(false);
    expect(isAggregateCompatibleWithFieldType('max', 'formula')).toBe(false);
    // …and it refuses the deriving aggregates over it too, which is older
    // (#16099) and is the continuity control for the row as a whole.
    expect(isAggregateCompatibleWithFieldType('sum', 'formula')).toBe(false);
    expect(isAggregateCompatibleWithFieldType('avg', 'formula')).toBe(false);
    // `count` / `count_distinct` read no value off the column and still accept it.
    expect(isAggregateCompatibleWithFieldType('count', 'formula')).toBe(true);
  });

  it('⛔ the rule answers `undefined` for `formula` — walked over every declared member', () => {
    // The invariant that replaces the anti-pass-through one: there is no
    // returnType-shaped input left, so no member of the enum can buy a verdict.
    for (const member of SPEC_RETURN_TYPES) {
      const meta = { type: 'formula', returnType: member } as { type: string; returnType: string };
      expect(measureResultType('min', meta.type), `returnType "${member}"`).toBeUndefined();
      expect(measureResultType('max', meta.type), `returnType "${member}"`).toBeUndefined();
    }
  });

  it('the rule takes TWO inputs now — a third argument cannot re-enter through the call site', () => {
    // A structural pin rather than a prose note: the signature is the reason a
    // host answering `returnType` changes nothing. If a third parameter is ever
    // re-added, this case is where the decision has to be re-argued.
    expect(measureResultType.length).toBe(2);
  });

  it('⭐ NEGATIVE CONTROL: the accepted class this rule still answers for is untouched', () => {
    // Without this, "everything is undefined" would also be what a broken rule
    // looks like.
    expect(measureResultType('min', 'datetime')).toBe(MEASURE_RESULT_TYPE_TEMPORAL);
    expect(measureResultType('max', 'date')).toBe(MEASURE_RESULT_TYPE_TEMPORAL);
    expect(measureResultType('min', 'number')).toBeUndefined();
  });
});

// ───────────────────────── end-to-end, through the real seam ─────────────────

interface Task extends Record<string, unknown> {
  id: string;
  label_calc: string;
  due_calc: string;
  amount: number;
}

const ROWS: Task[] = [
  { id: 'r1', label_calc: 'alpha', due_calc: '2026-05-03', amount: 10 },
  { id: 'r2', label_calc: 'beta', due_calc: '2026-06-01', amount: 20 },
];

/** The measure that is still legal here — `sum` over a `number` field. */
const NUMERIC_DATASET = DatasetSchema.parse({
  name: 'task_ds',
  label: 'Task',
  object: 'task',
  dimensions: [],
  measures: [{ name: 'total_amount', aggregate: 'sum', field: 'amount', label: 'Total Amount' }],
});

/** One formula measure per case, so a refusal cannot be masked by a sibling's. */
const formulaDataset = (name: string, aggregate: string, field: string) => DatasetSchema.parse({
  name: 'task_ds',
  label: 'Task',
  object: 'task',
  dimensions: [],
  measures: [{ name, aggregate, field, label: name }],
});

const CTX = { tenantId: 'org_A' } as ExecutionContext;

/** Enough of an aggregate for this fixture — min/max compare as the rows store them. */
function evaluateAggregate(opts: { aggregations?: unknown }) {
  const aggs = (opts.aggregations ?? []) as Array<{ field: string; method: string; alias: string }>;
  const row: Record<string, unknown> = {};
  for (const a of aggs) {
    const raw = ROWS.map((r) => r[a.field]);
    const sorted = raw.map(String).sort();
    row[a.alias] =
      a.method === 'sum' ? raw.reduce((s: number, v) => s + Number(v ?? 0), 0)
        : a.method === 'max' ? sorted[sorted.length - 1]
          : sorted[0];
  }
  return [row];
}

/**
 * A service wired the way a host wires it, recording every aggregate call —
 * `meta` is the ONLY thing that varies between the cases below, so a difference
 * in the response is a difference the declared metadata caused.
 */
function svc(meta: (object: string, field: string) => Record<string, unknown> | undefined) {
  const calls: unknown[] = [];
  const service = new AnalyticsService({
    sourceFieldMeta: meta as never,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_o: string, options: Record<string, unknown>) => {
      calls.push(options);
      return evaluateAggregate(options);
    },
  });
  return { service, calls };
}

/** The two formula fields with their type PROVEN at authoring — #16236's shape. */
const DECLARED = (object: string, field: string) => {
  if (object !== 'task') return undefined;
  if (field === 'label_calc') return { type: 'formula', returnType: 'text' };
  if (field === 'due_calc') return { type: 'formula', returnType: 'date' };
  if (field === 'amount') return { type: 'number' };
  return undefined;
};

/** The same two formula fields with the type left unproven at authoring. */
const UNPROVEN = (object: string, field: string) => {
  if (object !== 'task') return undefined;
  if (field === 'label_calc' || field === 'due_calc') return { type: 'formula' };
  if (field === 'amount') return { type: 'number' };
  return undefined;
};

async function refusalOf(fn: () => Promise<unknown>): Promise<Error & { code?: string; status?: number }> {
  try {
    await fn();
  } catch (e) {
    return e as Error & { code?: string; status?: number };
  }
  throw new Error('expected a refusal, none was thrown');
}

describe('B) end-to-end — #16236\'s own fixture, now answering the refusal', () => {
  for (const [measure, aggregate, field, declaredReturn] of [
    ['first_label', 'min', 'label_calc', 'text'],
    ['latest_due', 'max', 'due_calc', 'date'],
  ] as const) {
    it(`⭐ ${aggregate} over a formula declaring \`${declaredReturn}\` → DATASET_INVALID / 400 (was: a typed column)`, async () => {
      // ⚠️ This case asserted the OPPOSITE until #17560: "a min over a formula
      // declaring `text` is described `string`, beside a string value". The
      // value it observed was real; what changed is that the platform no longer
      // asks for it. ⛔ The pin is replaced, not deleted — same measure, same
      // metadata, same door.
      const { service, calls } = svc(DECLARED);
      const err = await refusalOf(() => service.queryDataset(
        formulaDataset(measure, aggregate, field),
        { dimensions: [], measures: [measure] },
        CTX,
      ));
      expect(err.code).toBe('DATASET_INVALID');
      expect(err.status).toBe(400);
      expect(err.message).toContain(measure);
      expect(err.message).toContain(field);
      expect(err.message).toContain('formula');
      // Refused as a DECLARATION: the aggregate was never issued, which is what
      // makes this a rejected document rather than an empty answer.
      expect(calls.length).toBe(0);
    });
  }

  it('an UNPROVEN formula is refused on the same ground — the returnType was never what decided it', async () => {
    // The absent tier used to be a ROW here ("no answer, the producer's word
    // stands"). It collapses into the refusal: the pair is judged on the
    // declared `FieldType`, and `formula` is refused whatever else is declared.
    const { service, calls } = svc(UNPROVEN);
    const err = await refusalOf(() => service.queryDataset(
      formulaDataset('first_label', 'min', 'label_calc'),
      { dimensions: [], measures: ['first_label'] },
      CTX,
    ));
    expect(err.code).toBe('DATASET_INVALID');
    expect(calls.length).toBe(0);
  });

  it('⭐ NEGATIVE CONTROL: a numeric measure beside them still compiles and still says number', async () => {
    // The case that fails if the widened door started refusing everything.
    expect(isAggregateCompatibleWithFieldType('sum', 'number')).toBe(true);
    const { service, calls } = svc(DECLARED);
    const res = await service.queryDataset(NUMERIC_DATASET, { dimensions: [], measures: ['total_amount'] }, CTX);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].total_amount).toBe(30);
    expect(res.fields.find((f) => f.name === 'total_amount')?.type).toBe('number');
    expect(calls.length).toBe(1);
  });

  it('a host that wires no sourceFieldMeta at all is unchanged — "cannot answer, do not block"', async () => {
    // The tier that must survive the widening: with no declared type the pair
    // is not judged, so the formula measure still compiles for such a host.
    const { service, calls } = svc(() => undefined);
    const res = await service.queryDataset(
      formulaDataset('first_label', 'min', 'label_calc'),
      { dimensions: [], measures: ['first_label'] },
      CTX,
    );
    expect(res.rows).toHaveLength(1);
    expect(calls.length).toBe(1);
    for (const f of res.fields) expect(f.type).toBe('number');
  });
});
