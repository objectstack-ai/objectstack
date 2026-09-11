// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16236 — a `min`/`max` over a `formula` field must be described by the type
 * that formula was DECLARED to return.
 *
 * `FieldSchema.returnType` (`packages/spec/src/data/field.zod.ts`, located by
 * text) declares the value type a formula computes, and its own JSDoc names
 * this exact consumer FIRST:
 *
 * > Lets consumers — dataset measures, display formatting, validation — read a
 * > declared type instead of re-parsing the expression.
 *
 * The dataset-measure side could not read it. The one channel from the host to
 * `AnalyticsService` for a field's declared metadata is
 * `AnalyticsServiceConfig.sourceFieldMeta`, whose return carried three members
 * — `{ type?, defaultCurrency?, max? }` — and none of them was `returnType`. So
 * `measureResultType` received the bare string `'formula'` and could say
 * nothing further, and every formula measure column was described `number`
 * whatever the formula computes.
 *
 * ## The reproduction, driven rather than read (section B)
 *
 * Two measures over two formula fields, one declared `returnType: 'text'` and
 * one declared `returnType: 'date'`, driven end-to-end through
 * `AnalyticsService.queryDataset` — the ADR-0021 result-column enrichment seam
 * the REST face relays verbatim. Measured on `origin/main` @ `bea76c928`
 * BEFORE this change:
 *
 * ```json
 * {"rows":[{"first_label":"alpha","latest_due":"2026-06-01"}],
 *  "fields":[{"name":"first_label","type":"number","label":"First Label"},
 *            {"name":"latest_due","type":"number","label":"Latest Due"}]}
 * ```
 *
 * Both values are strings; both descriptors say `number`. Same defect class as
 * #15768/#16101, over the one `FieldType` member whose answer was already
 * sitting in the metadata.
 *
 * ⚠️ **Why the pair is still reachable, re-measured rather than inherited.**
 * The card's own "live control" (nothing between author and driver refuses the
 * pair) was taken before the compile leg of #16099 landed, and
 * `AGGREGATE_FIELD_TYPE_COMPATIBILITY` does NOT list `formula` under `min` or
 * `max`. It is nonetheless not refused today: `dataset-compiler`'s
 * `assertAggregateFieldTypeCompatible` judges only the DERIVING aggregates
 * (`if (!DERIVING_AGGREGATES.has(aggregate)) return;` — `sum` / `avg`), so
 * `min` / `max` sit outside its reach whatever the field type. ⚠️ #16099 re-cut
 * that scope from the FIELD class to the AGGREGATE class without changing this
 * conclusion: the reason used to be 「`formula` is not temporal」 and is now
 * 「`min` / `max` are not judged here at all」, which is the #17513 population.
 * Section B is the standing control either way: it drives the pair through
 * `queryDataset` and gets a response, so this rule's `formula` branch is reached
 * by the tree as it ships. If the `min` / `max` rows are ever executed the branch
 * becomes unreachable and inert — never wrong.
 *
 * ## ⚠️ The mapping is a TRANSLATION, and section A is the pin that keeps it one
 *
 * `returnType` speaks the AUTHORING vocabulary (`number` / `text` / `boolean` /
 * `date`); `AnalyticsResult.fields[].type` speaks `DimensionType` (`string` /
 * `number` / `boolean` / `time` / `geo`). Two of the four words are not wire
 * words at all — `text` is `'string'` there, `date` is `'time'` — so relaying
 * the literal would put a word into the response that no consumer branches on.
 *
 * The pin that stops a later edit degrading the table into a pass-through is
 * NOT four hand-written expectations (a pass-through satisfies the two rows
 * where the vocabularies happen to share a spelling). It is one invariant over
 * the whole enum: **no member of `returnType` is answered by its own
 * spelling.** All four members satisfy it today — `text`→`string`,
 * `date`→`time`, and `number`/`boolean` answer "no correction" — so a relay
 * reintroduced anywhere in the table fails it on every row it touches,
 * including a fifth member added upstream later.
 *
 * The enum walked here is read off `FieldSchema` itself, so a member added to
 * the spec lands as a failure of the exhaustiveness guard rather than silently
 * falling through as "cannot answer".
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import { FieldSchema } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import {
  FORMULA_RETURN_TYPE_RESULT,
  MEASURE_RESULT_TYPE_STRING,
  MEASURE_RESULT_TYPE_TEMPORAL,
  measureResultType,
} from '../measure-result-type.js';

/**
 * The four members, read off the SPEC schema rather than restated here — the
 * same construction the `FieldType` walk in `measure-result-type.test.ts` uses.
 * A fifth member added upstream reds the exhaustiveness case below instead of
 * quietly inheriting the "cannot answer" tier.
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

/**
 * One row per member: the wire word this rule answers, and the MEASUREMENT
 * behind it. `undefined` is a verdict here, never a gap — the two rows that
 * carry it carry the reason the corresponding `FieldType` class already
 * carries in `measure-result-type.ts`'s header.
 */
const RETURN_TYPE_VERDICTS: ReadonlyArray<{ returnType: string; expected: string | undefined; why: string }> = [
  {
    returnType: 'text',
    expected: MEASURE_RESULT_TYPE_STRING,
    why: 'TRANSLATED — `text` is not a wire word; the DimensionType spelling for a string column is `string`',
  },
  {
    returnType: 'date',
    expected: MEASURE_RESULT_TYPE_TEMPORAL,
    why: 'TRANSLATED — `date` is not a wire word; the DimensionType spelling for a temporal column is `time`',
  },
  {
    returnType: 'number',
    expected: undefined,
    why: 'no correction — identical to the NUMERIC_VALUE_TYPES row: the producer already minted the correct word',
  },
  {
    returnType: 'boolean',
    expected: undefined,
    why: 'no correction — identical to the BOOLEAN_VALUE_TYPES row: three readings disagree on what min/max over a boolean returns',
  },
];

describe('A) the returnType → DimensionType table is a TRANSLATION, member by member', () => {
  it('the table enumerates every member the spec declares, and only declared members', () => {
    expect([...RETURN_TYPE_VERDICTS.map((v) => v.returnType)].sort()).toEqual([...SPEC_RETURN_TYPES].sort());
    expect([...Object.keys(FORMULA_RETURN_TYPE_RESULT)].sort()).toEqual([...SPEC_RETURN_TYPES].sort());
  });

  it('⛔ NO member is answered by its own spelling — the anti-pass-through invariant', () => {
    // The one assertion that a relayed literal cannot satisfy on ANY row,
    // including a member added to the spec enum after this was written.
    for (const member of SPEC_RETURN_TYPES) {
      expect(measureResultType('min', 'formula', member), `returnType "${member}" relayed verbatim`).not.toBe(member);
      expect(measureResultType('max', 'formula', member), `returnType "${member}" relayed verbatim`).not.toBe(member);
    }
  });

  it('the two minted words are the DimensionType spellings, not the authoring ones', () => {
    expect(MEASURE_RESULT_TYPE_STRING).toBe('string');
    expect(MEASURE_RESULT_TYPE_TEMPORAL).toBe('time');
    expect(measureResultType('min', 'formula', 'text')).not.toBe('text');
    expect(measureResultType('max', 'formula', 'date')).not.toBe('date');
  });

  for (const { returnType, expected, why } of RETURN_TYPE_VERDICTS) {
    it(`min/max over a formula declaring ${returnType} → ${expected ?? 'no correction'} (${why})`, () => {
      expect(measureResultType('min', 'formula', returnType)).toBe(expected);
      expect(measureResultType('max', 'formula', returnType)).toBe(expected);
      expect(FORMULA_RETURN_TYPE_RESULT[returnType as keyof typeof FORMULA_RETURN_TYPE_RESULT]).toBe(expected);
    });
  }

  it('⚠️ the ABSENT-returnType tier: no answer, the producer\'s word stands', () => {
    // Written down as a row rather than left implied by a `?.` in the code
    // path. `returnType` is optional — "absent when the type can't be proven
    // (an ambiguous/`dyn` expression)" — and an unproven formula's measure
    // column keeps the `number` its producer minted. The absence is NOT read
    // as an answer.
    expect(measureResultType('min', 'formula', undefined)).toBeUndefined();
    expect(measureResultType('max', 'formula', undefined)).toBeUndefined();
    expect(measureResultType('min', 'formula')).toBeUndefined();
  });

  it('a returnType word outside the enum is the same "cannot answer" tier, never a guess', () => {
    // A JS host, or an engine carrying a legacy spelling, can answer anything.
    expect(measureResultType('min', 'formula', 'datetime')).toBeUndefined();
    expect(measureResultType('min', 'formula', 'string')).toBeUndefined();
    expect(measureResultType('min', 'formula', '')).toBeUndefined();
  });

  it('returnType is consulted for `formula` ONLY — it is that member\'s declared key', () => {
    // A host that answers `returnType` beside some other declared type changes
    // nothing: the field-type tiers above decide first and this key is not a
    // general override.
    expect(measureResultType('min', 'text', 'date')).toBe(MEASURE_RESULT_TYPE_STRING);
    expect(measureResultType('min', 'datetime', 'text')).toBe(MEASURE_RESULT_TYPE_TEMPORAL);
    expect(measureResultType('min', 'number', 'text')).toBeUndefined();
  });

  it('the non-min/max aggregates over a formula are never corrected', () => {
    for (const fn of ['count', 'count_distinct', 'sum', 'avg'] as const) {
      for (const member of SPEC_RETURN_TYPES) {
        expect(measureResultType(fn, 'formula', member)).toBeUndefined();
      }
    }
    // …and a derived measure (no aggregate) likewise.
    expect(measureResultType(undefined, 'formula', 'text')).toBeUndefined();
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

const DATASET = DatasetSchema.parse({
  name: 'task_ds',
  label: 'Task',
  object: 'task',
  dimensions: [],
  measures: [
    { name: 'first_label', aggregate: 'min', field: 'label_calc', label: 'First Label' },
    { name: 'latest_due', aggregate: 'max', field: 'due_calc', label: 'Latest Due' },
    { name: 'total_amount', aggregate: 'sum', field: 'amount', label: 'Total Amount' },
  ],
});

const SELECTION = { dimensions: [], measures: ['first_label', 'latest_due', 'total_amount'] };
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
 * A service wired the way a host wires it. `meta` is the ONLY thing that varies
 * between the cases below, so a difference in the response is a difference the
 * declared metadata caused.
 */
function svc(meta: (object: string, field: string) => Record<string, unknown> | undefined) {
  return new AnalyticsService({
    sourceFieldMeta: meta as never,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_o: string, options: Record<string, unknown>) => evaluateAggregate(options),
  });
}

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

async function fieldsOf(meta: (o: string, f: string) => Record<string, unknown> | undefined) {
  const res = await svc(meta).queryDataset(DATASET, SELECTION, CTX);
  return {
    by: Object.fromEntries(res.fields.map((f) => [f.name, f])),
    rows: res.rows,
  };
}

describe('B) end-to-end — the card\'s own reproduction, through queryDataset', () => {
  it('the pair is REACHABLE: the response exists and carries a value per measure', async () => {
    // The standing control for the section-header note: the compile-time
    // aggregate/field-type gate is scoped to the temporal class, so a formula
    // measure is not refused and this rule's branch is really reached.
    const { rows } = await fieldsOf(DECLARED);
    expect(rows).toHaveLength(1);
    expect(rows[0].first_label).toBe('alpha');
    expect(rows[0].latest_due).toBe('2026-06-01');
  });

  it('a min over a formula declaring `text` is described `string`, beside a string value', async () => {
    const { by, rows } = await fieldsOf(DECLARED);
    expect(typeof rows[0].first_label).toBe('string');
    expect(by.first_label.type).toBe('string');
    // ⛔ and not the authoring word, and not the flat number it used to be.
    expect(by.first_label.type).not.toBe('text');
    expect(by.first_label.type).not.toBe('number');
  });

  it('a max over a formula declaring `date` is described `time`, beside a calendar day', async () => {
    const { by, rows } = await fieldsOf(DECLARED);
    expect(typeof rows[0].latest_due).toBe('string');
    expect(by.latest_due.type).toBe('time');
    expect(by.latest_due.type).not.toBe('date');
    expect(by.latest_due.type).not.toBe('number');
  });

  it('a numeric measure beside them is untouched — the enrichment corrects, it does not repaint', async () => {
    const { by } = await fieldsOf(DECLARED);
    expect(by.total_amount.type).toBe('number');
  });

  it('⚠️ an UNPROVEN formula keeps the producer\'s word — the absent tier, end to end', async () => {
    const { by } = await fieldsOf(UNPROVEN);
    expect(by.first_label.type).toBe('number');
    expect(by.latest_due.type).toBe('number');
  });

  it('a host that wires no sourceFieldMeta at all is unchanged — "cannot answer, do not block"', async () => {
    const res = await svc(() => undefined).queryDataset(DATASET, SELECTION, CTX);
    for (const f of res.fields) expect(f.type).toBe('number');
  });
});
