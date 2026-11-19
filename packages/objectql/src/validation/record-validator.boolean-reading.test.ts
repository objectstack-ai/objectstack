// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34916] A `boolean` / `toggle` field stores the boolean its arm judged.
 *
 * The record validator's boolean arm admits `true` / `false`, `0` / `1`,
 * `'0'` / `'1'` and `'true'` / `'false'`. The write carried the reading as
 * sent, so `'true'` reached the driver as the TEXT `'true'`. Measured on
 * `origin/main` @ `c81f498b5f` at the REST doors over SQLite (single POST /
 * PATCH and `/api/v1/batch`): the column held `'true'` beside rows holding
 * `1`, `won = true` missed it, and a `requiredWhen: record.won == true` read
 * the string and admitted a write it refuses for `true`. The console's inline
 * grid sends exactly these strings (a boolean column is a select over the
 * option values `'true'` / `'false'`).
 *
 * The door (`normalizeNumericStringValues`, beside the #29241 / #29562 halves)
 * now writes the judged boolean. The accepted set does not move: every value
 * outside the readings is left as sent and refused by the arm as before.
 * The REST-door pin over SQLite is `packages/rest/src/rest-data-boolean-reading.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { normalizeNumericStringValues, validateRecord, ValidationError } from './record-validator.js';
import { ObjectQL } from '../engine.js';

const READINGS: ReadonlyArray<readonly [unknown, boolean]> = [
  ['true', true],
  ['1', true],
  [1, true],
  ['false', false],
  ['0', false],
  [0, false],
];

/** Values the arm refuses today: each stays as sent, for the arm to refuse. */
const REFUSED: readonly unknown[] = ['yes', 'TRUE', 'False', ' true', 'on', 2, -1, 0.5, [true], { v: true }];

function errorsOf(schema: { fields: Record<string, unknown> }, data: Record<string, unknown>) {
  try {
    validateRecord(schema as any, data, 'insert');
  } catch (e) {
    if (e instanceof ValidationError) return e.fields.map((f) => [f.field, f.code]);
    throw e;
  }
  return [];
}

describe('#34916 — the door writes the boolean the boolean arm judged', () => {
  for (const type of ['boolean', 'toggle'] as const) {
    for (const [input, judged] of READINGS) {
      it(`${type}: ${JSON.stringify(input)} is written as ${judged}`, () => {
        const schema = { fields: { f: { type } } };
        const out = normalizeNumericStringValues(schema, { f: input });
        expect(out.f).toBe(judged);
        // The arm admits the reading, and the written boolean too.
        expect(errorsOf(schema, { f: input })).toEqual([]);
        expect(errorsOf(schema, out)).toEqual([]);
      });
    }
  }

  it('a readonly boolean field is written too: its value is judged on every write', () => {
    const ro = { fields: { locked: { type: 'boolean', readonly: true } } };
    expect(normalizeNumericStringValues(ro, { locked: 'false' })).toEqual({ locked: false });
  });

  it('an array of rows: each row is written, the input is not mutated', () => {
    const schema = { fields: { won: { type: 'boolean' } } };
    const rows = [{ won: 'true' }, { won: true }, { won: '0' }];
    expect(normalizeNumericStringValues(schema, rows)).toEqual([{ won: true }, { won: true }, { won: false }]);
    expect(rows).toEqual([{ won: 'true' }, { won: true }, { won: '0' }]);
  });
});

describe('#34916 — what the door leaves alone on a boolean field', () => {
  const schema = { fields: { won: { type: 'boolean' } } };

  it('a boolean, null and a missing key: the same row back', () => {
    for (const row of [{ won: true }, { won: false }, { won: null }, { won: undefined }, {}]) {
      expect(normalizeNumericStringValues(schema, row), String(row.won)).toBe(row);
    }
  });

  for (const value of REFUSED) {
    it(`${JSON.stringify(value)}: the same row back, and the arm refuses it as before`, () => {
      const row = { won: value };
      expect(normalizeNumericStringValues(schema, row)).toBe(row);
      expect(errorsOf(schema, row)).toEqual([['won', 'invalid_boolean']]);
    });
  }

  it('the readings on a text field are the text arm\'s: a string stays a string', () => {
    const own = { fields: { note: { type: 'text' } } };
    const row = { note: 'true' };
    expect(normalizeNumericStringValues(own, row)).toBe(row);
  });
});

describe('#34916 — write path end to end: the driver receives the boolean, and requiredWhen reads it', () => {
  async function boot() {
    const engine = new ObjectQL();
    const writes: Record<string, unknown>[] = [];
    const rows = new Map<string, Record<string, unknown>>([['rec_1', { id: 'rec_1', won: false, delivery_date: null }]]);
    engine.registerDriver({
      name: 'recording', version: '0.0.0', supports: {},
      async connect() {}, async disconnect() {}, async checkHealth() { return true; },
      async execute() { return null; },
      async find() { return Array.from(rows.values()); },
      async findOne(_o: string, ast: any) { return rows.get(ast?.where?.id) ?? null; },
      async create(_o: string, data: Record<string, unknown>) { writes.push(data); return { ...data, id: 'x' }; },
      async update(_o: string, id: string, data: Record<string, unknown>) { writes.push(data); return { ...data, id }; },
      async updateMany(_o: unknown, _a: unknown, data: Record<string, unknown>) { writes.push(data); return 0; },
      async delete() { return true; }, async count() { return rows.size; },
      async bulkCreate(_o: string, data: Record<string, unknown>[]) { writes.push(...data); return data.map((d, i) => ({ ...d, id: `b${i}` })); },
      async bulkUpdate() { return []; }, async bulkDelete() {},
      async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
      async commit() {}, async rollback() {},
    } as any, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'deal_line_34916', label: 'Deal line',
      fields: {
        id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
        won: { name: 'won', label: 'Won', type: 'boolean' },
        delivery_date: { name: 'delivery_date', label: 'Delivery', type: 'date', requiredWhen: 'record.won == true' },
      },
    } as any);
    return { engine, writes };
  }

  it('insert, insertMany, update by id and update by predicate', async () => {
    const { engine, writes } = await boot();
    await engine.insert('deal_line_34916', { won: 'true', delivery_date: '2026-12-01' } as any);
    await engine.insert('deal_line_34916', [{ won: 'false' }, { won: 0 }] as any);
    await engine.update('deal_line_34916', { won: '1', delivery_date: '2026-12-01' } as any, { where: { id: 'rec_1' } } as any);
    await engine.update('deal_line_34916', { won: '0' } as any, { multi: true } as any);
    expect(writes.map((w) => w.won)).toEqual([true, false, false, true, false]);
  });

  it("requiredWhen `record.won == true` refuses 'true' with no delivery date, exactly as it refuses true", async () => {
    const { engine, writes } = await boot();
    for (const won of ['true', true, '1', 1]) {
      const err: any = await engine.insert('deal_line_34916', { won } as any).then(() => null, (e) => e);
      expect(err, JSON.stringify(won)).toBeInstanceOf(ValidationError);
      expect(err.fields.map((f: any) => f.field), JSON.stringify(won)).toEqual(['delivery_date']);
    }
    expect(writes).toEqual([]);
  });
});
