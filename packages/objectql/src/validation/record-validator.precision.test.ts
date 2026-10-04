// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { validateRecord, ValidationError } from './record-validator.js';
import { ObjectQL } from '../engine.js';

/**
 * #19992 — a numeric field's declared `precision` ("Total digits") is ENFORCED
 * at the write seam, by rejection (`max_precision`), never by rounding.
 *
 * Before this, nothing read the key: `numeric-column-representation.ts` gives
 * every numeric column the fixed `(65, 30)` exact decimal, the record validator
 * had no branch for it, and the objectui reads the liveness ledger cited were
 * retired — so `precision: 5` on a `number` stored `123456789` verbatim. Triage
 * answered the enforce-or-remove question ENFORCE by the maintainer's #18900 ④
 * criterion (a total-digit bound is mainstream: SQL `DECIMAL(p, s)`, Salesforce
 * Length + Decimal Places), at the write seam and ⛔ not in storage.
 *
 * The reading pinned here is DECIMAL(p, s): the value's digits are counted at
 * the decimal places the `scale` rule applies, so the integer part may carry
 * `precision − scale` digits. The three triage pins come first; the rest pin
 * how an undeclared `scale` counts, what the fraction-stored `percent` basis
 * does to the count, and the boundaries of the rule.
 */

const fieldsOf = (
  schema: Parameters<typeof validateRecord>[0],
  data: Record<string, unknown>,
  mode: 'insert' | 'update' = 'insert',
  options: Parameters<typeof validateRecord>[3] = {},
) => {
  try {
    validateRecord(schema, data, mode, options);
  } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    return (e as ValidationError).fields;
  }
  return null;
};

describe('validateRecord — `precision` is enforced by rejection (#19992): the triage pins', () => {
  it('a `number` with `precision: 5, scale: 2` refuses 1234.5 and accepts 123.45', () => {
    const s = { fields: { rate: { type: 'number', label: 'Rate', precision: 5, scale: 2 } } };
    const errs = fieldsOf(s, { rate: 1234.5 });
    expect(errs).toHaveLength(1);
    expect(errs![0]).toMatchObject({
      field: 'rate',
      code: 'max_precision',
      // 1234.5 at the field's 2 decimal places is 1234.50: six digits.
      constraint: { precision: 5, scale: 2, actual: 6 },
    });
    expect(errs![0].message).toBe('Rate must have at most 5 digits in total, counting 2 decimal places (got 6)');
    // The thrown error is the VALIDATION_FAILED envelope REST maps to 400.
    try {
      validateRecord(s, { rate: 1234.5 }, 'insert');
      throw new Error('expected a ValidationError');
    } catch (e) {
      expect((e as ValidationError).code).toBe('VALIDATION_FAILED');
    }
    expect(fieldsOf(s, { rate: 123.45 })).toBeNull();
  });

  it('a `currency` with `precision: 18` refuses a 19-digit amount', () => {
    const s = { fields: { amount: { type: 'currency', label: 'Amount', precision: 18 } } };
    // 10^18 is 1 followed by 18 zeros — 19 digits, exact in a double.
    const errs = fieldsOf(s, { amount: 1e18 });
    expect(errs?.[0]).toMatchObject({
      field: 'amount',
      code: 'max_precision',
      constraint: { precision: 18, scale: 0, actual: 19 },
    });
    expect(errs![0].message).toBe('Amount must have at most 18 digits in total (got 19)');
    // An 18-digit amount fits.
    expect(fieldsOf(s, { amount: 1e17 })).toBeNull();
  });

  it('CONTROL — an undeclared `precision` accepts both values', () => {
    const number = { fields: { rate: { type: 'number', label: 'Rate', scale: 2 } } };
    expect(fieldsOf(number, { rate: 1234.5 })).toBeNull();
    const currency = { fields: { amount: { type: 'currency', label: 'Amount' } } };
    expect(fieldsOf(currency, { amount: 1e18 })).toBeNull();
  });
});

describe('validateRecord — the DECIMAL(p, s) reading of `precision` (#19992)', () => {
  const schema = {
    fields: {
      rate: { type: 'number', label: 'Rate', precision: 5, scale: 2 },
      qty: { type: 'number', label: 'Qty', precision: 4 },
      tight: { type: 'number', label: 'Tight', precision: 1, scale: 2 },
      zero: { type: 'number', label: 'Zero', precision: 0 },
    },
  };

  it('with a declared `scale`, the integer part may carry `precision − scale` digits', () => {
    for (const ok of [999.99, -999.99, 0.01, 5, 0, 123.4]) {
      expect(fieldsOf(schema, { rate: ok }), String(ok)).toBeNull();
    }
    // 1000 is 1000.00 at the field's scale — six digits.
    expect(fieldsOf(schema, { rate: 1000 })?.[0]).toMatchObject({
      code: 'max_precision',
      constraint: { precision: 5, scale: 2, actual: 6 },
    });
    expect(fieldsOf(schema, { rate: -1000 })?.[0]).toMatchObject({ code: 'max_precision' });
  });

  it('with NO `scale`, the value counts at its own decimal places — and leading zeros never count', () => {
    for (const ok of [1234, 12.34, 1.234, 0.001, 0.1234, -1234]) {
      expect(fieldsOf(schema, { qty: ok }), String(ok)).toBeNull();
    }
    const [err] = fieldsOf(schema, { qty: 12345 })!;
    expect(err).toMatchObject({ field: 'qty', code: 'max_precision', constraint: { precision: 4, scale: 0, actual: 5 } });
    // The value's own digits were counted, so the plain sentence — no padding to explain.
    expect(err.message).toBe('Qty must have at most 4 digits in total (got 5)');
    expect(fieldsOf(schema, { qty: 1.2345 })?.[0]).toMatchObject({
      field: 'qty',
      code: 'max_precision',
      constraint: { precision: 4, scale: 4, actual: 5 },
    });
    // A trailing zero of the INTEGER part is a digit: 10000 needs five.
    expect(fieldsOf(schema, { qty: 10000 })?.[0]).toMatchObject({ constraint: { actual: 5 } });
  });

  it('exponent forms are normalized, as the `scale` count normalizes them', () => {
    // 1.5e-7 is 0.00000015: two significant digits, no leading zero counted.
    expect(fieldsOf(schema, { qty: 1.5e-7 })).toBeNull();
    // 1.23e+21 is a 22-digit integer.
    expect(fieldsOf(schema, { qty: 1.23e21 })?.[0]).toMatchObject({ constraint: { precision: 4, actual: 22 } });
  });

  it('`precision` below `scale` keeps a meaning (the DECIMAL range |v| < 10^(p − s)): 0.05 fits `precision: 1, scale: 2`, 0.1 does not', () => {
    expect(fieldsOf(schema, { tight: 0.05 })).toBeNull();
    expect(fieldsOf(schema, { tight: 0.1 })?.[0]).toMatchObject({
      code: 'max_precision',
      constraint: { precision: 1, scale: 2, actual: 2 },
    });
  });

  it('zero occupies no digits, so it fits even `precision: 0` — which refuses every other value', () => {
    expect(fieldsOf(schema, { zero: 0 })).toBeNull();
    expect(fieldsOf(schema, { zero: 1 })?.[0]).toMatchObject({ field: 'zero', code: 'max_precision', constraint: { precision: 0, actual: 1 } });
  });
});

describe('validateRecord — `precision` on `currency` and `percent` (#19992)', () => {
  it('currency: `scale` is refused there, so an amount counts at its own decimals — which stay unconstrained, only the total is bounded', () => {
    const s = { fields: { amount: { type: 'currency', label: 'Amount', precision: 10 } } };
    expect(fieldsOf(s, { amount: 12345678.12 })).toBeNull(); // 10 digits
    expect(fieldsOf(s, { amount: 1.23456789 })).toBeNull(); // 9 digits, 8 of them decimals — no max_scale on currency
    expect(fieldsOf(s, { amount: 123456789.12 })?.[0]).toMatchObject({
      field: 'amount',
      code: 'max_precision',
      constraint: { precision: 10, scale: 2, actual: 11 },
    });
    // A legacy `scale` on a currency def (it bypassed FieldSchema) narrows
    // nothing (#19629), so it does not pad the count either.
    const legacy = { fields: { amount: { type: 'currency', label: 'Amount', precision: 3, scale: 2 } } };
    expect(fieldsOf(legacy, { amount: 123 })).toBeNull();
  });

  it('a fraction-stored percent with `scale` counts at `scale + 2` — the percentage-point digits as displayed', () => {
    // precision 4, scale 2: displayed up to 99.99%, stored up to 0.9999.
    const s = { fields: { p: { type: 'percent', label: 'P', precision: 4, scale: 2 } } };
    expect(fieldsOf(s, { p: 0.9999 })).toBeNull();
    expect(fieldsOf(s, { p: 0.05 })).toBeNull();
    // 100.00% is stored 1, counted 1.0000: five digits.
    const [err] = fieldsOf(s, { p: 1 })!;
    expect(err).toMatchObject({ field: 'p', code: 'max_precision', constraint: { precision: 4, scale: 4, actual: 5 } });
    expect(err.message).toBe('P must have at most 4 digits in total, counting 4 decimal places (got 5)');
  });

  it('a fraction-stored percent with NO `scale` is still counted two places right — so 1000% (stored 10) is four digits', () => {
    const s = { fields: { p: { type: 'percent', label: 'P', precision: 3 } } };
    expect(fieldsOf(s, { p: 9.99 })).toBeNull(); // 999%
    expect(fieldsOf(s, { p: 0.123 })).toBeNull(); // 12.3%
    expect(fieldsOf(s, { p: 10 })?.[0]).toMatchObject({ code: 'max_precision', constraint: { precision: 3, scale: 2, actual: 4 } });
    // 12.345% is stored 0.12345: its own five decimals are counted, unpadded.
    expect(fieldsOf(s, { p: 0.12345 })?.[0]).toMatchObject({ constraint: { precision: 3, scale: 5, actual: 5 } });
  });

  it('a whole-percent field (`max` above 1) stores the displayed number, so it counts like a `number`', () => {
    const s = { fields: { p: { type: 'percent', label: 'P', precision: 5, scale: 2, max: 1000 } } };
    expect(fieldsOf(s, { p: 100 })).toBeNull(); // 100.00
    expect(fieldsOf(s, { p: 999.99 })).toBeNull();
    expect(fieldsOf(s, { p: 1000 })?.[0]).toMatchObject({ code: 'max_precision', constraint: { precision: 5, scale: 2, actual: 6 } });
  });
});

describe('validateRecord — where `precision` binds, and where it does not (#19992)', () => {
  it('binds on number, currency, percent, rating and slider; ⛔ not on progress, which takes only `min` / `max` (#20386)', () => {
    for (const type of ['number', 'currency', 'percent', 'rating', 'slider']) {
      const s = { fields: { v: { type, label: 'V', precision: 1, ...(type === 'percent' ? { max: 100 } : {}) } } };
      expect(fieldsOf(s, { v: 12 })?.[0], type).toMatchObject({ field: 'v', code: 'max_precision' });
    }
    const progress = { fields: { v: { type: 'progress', label: 'V', precision: 1 } } };
    expect(fieldsOf(progress, { v: 50 })).toBeNull();
  });

  it('runs after `min` / `max` and `max_scale` — an over-scale value answers `max_scale`, as before', () => {
    const s = { fields: { rate: { type: 'number', label: 'Rate', precision: 5, scale: 2, max: 500 } } };
    expect(fieldsOf(s, { rate: 1234.567 })?.[0]).toMatchObject({ code: 'max_value' });
    const unbounded = { fields: { rate: { type: 'number', label: 'Rate', precision: 5, scale: 2 } } };
    expect(fieldsOf(unbounded, { rate: 1234.567 })?.[0]).toMatchObject({ code: 'max_scale', constraint: { scale: 2, actual: 3 } });
  });

  it('refuses on update too, and judges a string-carried number (a CSV cell) after coercion', () => {
    const s = { fields: { rate: { type: 'number', label: 'Rate', precision: 5, scale: 2 } } };
    expect(fieldsOf(s, { rate: 1234.5 }, 'update')?.[0]).toMatchObject({ field: 'rate', code: 'max_precision' });
    expect(fieldsOf(s, { rate: '1234.5' })?.[0]).toMatchObject({ code: 'max_precision', constraint: { actual: 6 } });
    expect(fieldsOf(s, { rate: '123.45' })).toBeNull();
    // An omitted field is never judged on update — a stored value above a count declared later rests.
    expect(fieldsOf(s, { other: 1 }, 'update')).toBeNull();
  });

  it('a malformed declaration that bypassed FieldSchema stays unenforced — the runtime invents no meaning for it', () => {
    const bad = { fields: { a: { type: 'number', precision: 2.5 }, b: { type: 'number', precision: -1 } } };
    expect(fieldsOf(bad, { a: 123456, b: 123456 })).toBeNull();
  });

  it('renders the refusal fully localized', () => {
    const s = { fields: { rate: { type: 'number', label: 'Rate', precision: 5, scale: 2 } } };
    const zh = fieldsOf(s, { rate: 1234.5 }, 'insert', { messages: { locale: 'zh-CN', objectName: 'x' } });
    expect(zh?.[0].message).toBe('Rate的总位数不能超过 5 位(按 2 位小数计,当前 6 位)');
  });
});

// ---------------------------------------------------------------------------
// Every engine write door reaches the refusal, the bulk doors included (AGENTS.md
// Prime Directive #10: "check every call site, bulk paths included"). The stub
// driver records what it is handed, so a refused write is shown to reach
// nothing — the refusal is not a message decorating a stored row.
// ---------------------------------------------------------------------------

function makeStubDriver() {
  const calls: Array<{ fn: string; data: unknown }> = [];
  const rows = new Map<string, Record<string, unknown>>();
  let n = 0;
  const driver: any = {
    name: 'stub', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return [...rows.values()]; },
    async findOne(_o: string, q: any) {
      const id = (q?.where ?? q?.filter ?? q)?.id;
      return (typeof id === 'string' ? rows.get(id) : rows.values().next().value) ?? null;
    },
    async count() { return rows.size; },
    async create(_o: string, data: Record<string, unknown>) {
      calls.push({ fn: 'create', data });
      const row = { ...data, id: (data.id as string) ?? `r${++n}` };
      rows.set(row.id as string, row);
      return row;
    },
    async bulkCreate(_o: string, list: Record<string, unknown>[]) {
      calls.push({ fn: 'bulkCreate', data: list });
      return list.map((r) => {
        const row = { ...r, id: (r.id as string) ?? `r${++n}` };
        rows.set(row.id as string, row);
        return row;
      });
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      calls.push({ fn: 'update', data });
      const row = { ...(rows.get(id) ?? {}), ...data, id };
      rows.set(id, row);
      return row;
    },
    async updateMany(_o: string, _ast: unknown, data: Record<string, unknown>) {
      calls.push({ fn: 'updateMany', data });
      return rows.size;
    },
    async upsert(o: string, data: Record<string, unknown>) { return this.create(o, data); },
    async delete() { return true; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, calls };
}

const PRICED = {
  name: 'priced',
  label: 'Priced',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    rate: { name: 'rate', type: 'number' as const, label: 'Rate', precision: 5, scale: 2 },
  },
};

describe('engine write doors — `precision` is refused on every door, bulk included (#19992)', () => {
  let engine: ObjectQL;
  let stub: ReturnType<typeof makeStubDriver>;

  beforeEach(async () => {
    stub = makeStubDriver();
    engine = new ObjectQL();
    engine.registerDriver(stub.driver, true);
    await engine.init();
    engine.registry.registerObject(PRICED as any);
  });

  const refusal = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      return { code: (e as ValidationError).code, fields: (e as ValidationError).fields.map((f) => [f.field, f.code]) };
    }
    return null;
  };
  const REFUSED = { code: 'VALIDATION_FAILED', fields: [['rate', 'max_precision']] };
  const writes = () => stub.calls.filter((c) => c.fn !== 'find');

  it('insert of one row, and of an array of rows — the whole batch is refused and nothing reaches the driver', async () => {
    expect(await refusal(() => engine.insert('priced', { id: 'a', rate: 1234.5 }))).toEqual(REFUSED);
    expect(
      await refusal(() => engine.insert('priced', [{ id: 'b1', rate: 123.45 }, { id: 'b2', rate: 1234.5 }])),
    ).toEqual(REFUSED);
    expect(writes()).toEqual([]);
  });

  it('insertMany (partial success): the over-precision row fails alone, the fitting row is written', async () => {
    const outcomes = await engine.insertMany('priced', [{ id: 'm1', rate: 123.45 }, { id: 'm2', rate: 1234.5 }]);
    expect(outcomes.map((o) => o.ok)).toEqual([true, false]);
    const failed = outcomes[1] as { ok: false; error: unknown };
    expect(failed.error).toBeInstanceOf(ValidationError);
    expect((failed.error as ValidationError).fields.map((f) => [f.field, f.code])).toEqual([['rate', 'max_precision']]);
    const written = writes().flatMap((c) => (c.fn === 'bulkCreate' ? (c.data as any[]) : [c.data]));
    expect(written.map((r: any) => r.id)).toEqual(['m1']);
  });

  it('update by id and update by predicate (multi) — refused before the driver', async () => {
    await engine.insert('priced', { id: 'u1', rate: 1 });
    stub.calls.length = 0;
    expect(await refusal(() => engine.update('priced', { id: 'u1', rate: 1234.5 }))).toEqual(REFUSED);
    expect(
      await refusal(() => engine.update('priced', { rate: 1234.5 }, { where: { id: { $in: ['u1'] } }, multi: true } as any)),
    ).toEqual(REFUSED);
    expect(writes().filter((c) => c.fn === 'update' || c.fn === 'updateMany')).toEqual([]);
  });

  it('the dry run (`validate`) predicts the same refusal', async () => {
    const refused = await engine.validate('priced', { id: 'p1', rate: 1234.5 });
    expect(refused.valid).toBe(false);
    expect(refused.results?.[0]?.errors.map((e: any) => [e.field, e.code])).toEqual([['rate', 'max_precision']]);
    expect((await engine.validate('priced', { id: 'p2', rate: 123.45 })).valid).toBe(true);
  });

  it('CONTROL — a fitting value passes every door', async () => {
    await engine.insert('priced', { id: 'c1', rate: 999.99 });
    await engine.insert('priced', [{ id: 'c2', rate: 0.5 }]);
    await engine.update('priced', { id: 'c1', rate: 123.45 });
    await engine.update('priced', { rate: 1 }, { where: { id: { $in: ['c1'] } }, multi: true } as any);
    expect(writes().map((c) => c.fn)).toEqual(expect.arrayContaining(['update', 'updateMany']));
  });
});
