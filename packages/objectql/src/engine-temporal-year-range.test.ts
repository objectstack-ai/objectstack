// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20264] A `date` value names a year from 0001 to 9999, and [#20280] a
 * `datetime` value a year from 1000 to 9999, or it is refused — at both doors,
 * by one range (`@objectstack/core`'s `isOutsideTemporalYearRange`):
 *
 * - the temporal-comparand door, `INVALID_FILTER` / 400, on `where`, a
 *   per-aggregation `filter` and `having`, before any driver read;
 * - the write door (the record validator), `VALIDATION_FAILED` with the field's
 *   `invalid_date` code, on insert, update, a multi-row update and the
 *   dry-run `validate`, before any driver write.
 *
 * Measured on the base (`b285508188`) on InMemoryDriver and SqlDriver on
 * SQLite and PostgreSQL 16, through the engine and REST, over seven 2026 rows:
 *
 * | position | input | memory | SQLite | PostgreSQL | now |
 * |:--|:--|:--|:--|:--|:--|
 * | `where` on a `datetime`, `$gt` / `$lt` / `$eq` | year 10000 or −1: a number, `Date` or ISO string | 7 / 0 / 0 | 7 / 0 / 0 | 500 | 400 |
 * | the same, per-aggregation `filter` `$gt` / `having` `$gt` on `min` | the same | 7 / 4 groups | 7 / 4 groups | 7 / 4 groups | 400 |
 * | `where` on a `datetime` or a `date` | year 0000, every spelling | 7 / 0 / 0 | 7 / 0 / 0 | 500 | 400 |
 * | create a `date` | `"+010000-01-01T00:00:00.000Z"` | 201, stored verbatim | 201, stored verbatim | 500 | 400 |
 * | create a `date` / `datetime` | year 0000 | 201 | 201 | 500 | 400 |
 *
 * Year 10000 in a `datetime` spells `+010000-…`, which sorts below every
 * four-digit year as text (the right answer for `$gt` / `$lt` / `$eq` was
 * 0 / 7 / 0); PostgreSQL has no year 0 in `DATE` or `timestamptz`. Every refusal
 * sits beside its POSITIVE CONTROL: the range's edges (0001 for a `date`, 1000
 * for a `datetime`, 9999 for both) and a 2026 value reach the driver. The
 * drivers are not this file's subject — the doors sit in front of every one;
 * the REST door over three real drivers is
 * `packages/rest/src/data-temporal-year-range.test.ts`.
 *
 * [#20280] A `datetime` in 0001..0999 was accepted by both doors at the base
 * (`b285508188` onward) and compared as the instant it names; it is refused now
 * in every spelling, because MySQL documents its `DATETIME` from year 1000
 * only and reads one stored in 0001..0099 back a century late. A `date` in
 * 0001..0999 is the control: still accepted. So is a `time` comparand naming an
 * instant in those years — a `time` column keeps its time of day.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

const ledger = {
  name: 'ledger',
  label: 'Ledger',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    customer_id: { name: 'customer_id', type: 'text' as const },
    placed_on: { name: 'placed_on', type: 'date' as const },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
    opens_at: { name: 'opens_at', type: 'time' as const },
  },
};

const at = (iso: string) => Date.parse(iso);

const Y10000 = at('+010000-01-01T00:00:00.000Z');
const YNEG1 = at('-000001-01-01T00:00:00.000Z');
const Y0 = at('0000-06-15T00:00:00.000Z');

/** `datetime` comparands outside 1000..9999, every spelling the rule reads. */
const DATETIME_OUT: ReadonlyArray<readonly [string, unknown]> = [
  ['year 10000, a number', Y10000],
  ['year 10000, a Date', new Date(Y10000)],
  ['year 10000, its ISO string', '+010000-01-01T00:00:00.000Z'],
  ['year 10000, a bare extended day', '10000-01-01'],
  ['year -1, a number', YNEG1],
  ['year -1, its ISO string', '-000001-01-01T00:00:00.000Z'],
  ['year 0, a number', Y0],
  ['year 0, a Date', new Date(Y0)],
  ['year 0, its ISO string', '0000-06-15T00:00:00.000Z'],
  ['year 0, a bare day', '0000-06-15'],
  ['year 9999 in its zone, 10000 in UTC', '9999-12-31T23:59:59-01:00'],
  // [#20280] Before the `datetime` floor, year 1000 — each read at the base.
  ['[#20280] year 1, a number', at('0001-01-01T00:00:00.000Z')],
  ['[#20280] year 1, its ISO string', '0001-01-01T00:00:00.000Z'],
  ['[#20280] year 9, a Date', new Date(at('0009-03-04T10:00:00.000Z'))],
  ['[#20280] year 99, its ISO string', '0099-03-04T10:00:00.000Z'],
  ['[#20280] year 500, a bare day (midnight UTC)', '0500-07-15'],
  ['[#20280] year 999, zone-naive (read as UTC)', '0999-12-31 23:59'],
  ['[#20280] the last instant of year 999, a number', at('0999-12-31T23:59:59.999Z')],
  ['[#20280] year 1000 in its zone, 999 in UTC', '1000-01-01T00:00:00+08:00'],
];

/** `date` comparands in year 0 — every spelling. */
const DATE_OUT: ReadonlyArray<readonly [string, unknown]> = [
  ['year 0, a number', Y0],
  ['year 0, a Date', new Date(Y0)],
  ['year 0, its ISO string', '0000-06-15T00:00:00.000Z'],
  ['year 0, a bare day', '0000-06-15'],
];

/** The range's edges and a 2026 control — every one reaches the driver. */
const DATETIME_IN: readonly unknown[] = [
  // [#20280] The floor's edge, in every spelling, where year 1 stood.
  at('1000-01-01T00:00:00.000Z'), new Date(at('1000-01-01T00:00:00.000Z')), '1000-01-01T00:00:00.000Z', '1000-01-01',
  '0999-12-31T23:00:00-02:00', new Date(at('9999-12-31T23:59:59.999Z')),
  '9999-12-31T23:59:59.999Z', 1769940000000, '2026-02-01T10:00:00.000Z', '2026-02-01',
];
const DATE_IN: readonly unknown[] = [
  at('0001-01-01T00:00:00.000Z'), '0001-01-01', '9999-12-31', 1769940000000, '2026-02-01',
  // [#20280] The control: a `date` keeps 0001..0999.
  '0099-03-04', '0999-12-31', new Date(at('0500-07-15T00:00:00.000Z')),
];

/** A driver that records every read and write, and answers none. */
function makeRecordingDriver() {
  const reads: unknown[] = [];
  const writes: unknown[] = [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: unknown) { reads.push(ast); return []; },
    async findOne(_o: string, ast: unknown) { reads.push(ast); return { id: 'r1' }; },
    async count(_o: string, ast: unknown) { reads.push(ast); return 0; },
    async aggregate(_o: string, ast: unknown) { reads.push(ast); return []; },
    async create(_o: string, data: Record<string, unknown>) { writes.push(data); return { ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { writes.push(data); return { ...data, id }; },
    async updateMany(_o: string, _ast: unknown, data: Record<string, unknown>) { writes.push(data); return 0; },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async bulkCreate(_o: string, batch: Record<string, unknown>[]) { writes.push(...batch); return batch; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads, writes };
}

const refusalOf = async (p: Promise<unknown>) =>
  p.then(() => null, (e: any) => e as Error & { code?: string; status?: number; fields?: Array<{ field: string; code: string }> });

describe('[#20264] the temporal-comparand door — a year outside the kind\'s years is refused on every position, before any read', () => {
  let engine: ObjectQL;
  let reads: unknown[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    reads = rec.reads;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(ledger, 'test');
  });

  const positions = (field: string, comparand: unknown, op: string) => [
    ['where', () => engine.find('ledger', { where: { [field]: { [op]: comparand } } })],
    ['per-aggregation filter', () => engine.aggregate('ledger', {
      aggregations: [{ function: 'count', alias: 'n' }, { function: 'count', alias: 'm', filter: { [field]: { [op]: comparand } } }],
    } as never)],
    ['having', () => engine.aggregate('ledger', {
      groupBy: ['customer_id'],
      aggregations: [{ function: 'min', field, alias: 'first' }],
      having: { first: { [op]: comparand } },
    } as never)],
  ] as const;

  for (const [field, kind, OUT, IN] of [
    ['opened_at', 'datetime', DATETIME_OUT, DATETIME_IN],
    ['placed_on', 'date', DATE_OUT, DATE_IN],
  ] as const) {
    it(`${kind}: INVALID_FILTER / 400 with code AND status and no read — while the edges and a 2026 value reach the driver`, async () => {
      for (const [name, comparand] of OUT) {
        for (const op of ['$gt', '$lt', '$eq'] as const) {
          for (const [position, call] of positions(field, comparand, op)) {
            const err = await refusalOf(call());
            expect(err, `${position} ${name} ${op}`).not.toBeNull();
            expect(err!.code, `${position} ${name} ${op}`).toBe('INVALID_FILTER');
            expect(err!.status, `${position} ${name} ${op}`).toBe(400);
          }
        }
      }
      expect(reads, 'no read — every refusal precedes the driver').toHaveLength(0);

      // ── the POSITIVE CONTROL: the same positions, a supported year ─────────
      for (const comparand of IN) {
        for (const [position, call] of positions(field, comparand, '$gt')) {
          const before = reads.length;
          await expect(call(), `${position} ${String(comparand)}`).resolves.toBeDefined();
          expect(reads.length, `${position} ${String(comparand)} reached the driver`).toBeGreaterThan(before);
        }
      }
    });
  }

  it('a list member, a range bound, the implicit-equality slot and a nested branch are judged too', async () => {
    const out = '+010000-01-01T00:00:00.000Z';
    const inside = '2026-02-01T10:00:00.000Z';
    for (const where of [
      { opened_at: out },
      { opened_at: { $in: [inside, out] } },
      { opened_at: { $between: [inside, out] } },
      { $or: [{ customer_id: 'x' }, { $not: { opened_at: { $gte: new Date(Y0) } } }] },
      [['opened_at', '>', Y10000]],
    ]) {
      const err = await refusalOf(engine.find('ledger', { where: where as never }));
      expect(err, JSON.stringify(where)).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    }
    expect(reads).toHaveLength(0);
    await expect(engine.find('ledger', { where: { opened_at: { $in: [inside, '1000-01-01T00:00:00.000Z'] } } })).resolves.toEqual([]);
    expect(reads).toHaveLength(1);
  });

  // [#20480] A wall clock has no year, but a time field reads a number, a
  // `Date` or an instant string as an INSTANT and keeps its UTC time of day —
  // only when that instant's UTC year has a four-digit spelling. Year 0 does
  // (`0000-…`), so its time of day is read; year 10000 and year -1 do not, and
  // the rule handed them back as written, compared with `HH:MM:SS`. This pin
  // asserted the year-10000 number was read; it is refused now.
  it('a time field reads the time of day of a year-0 instant, and [#20480] refuses one with no four-digit UTC year', async () => {
    for (const comparand of [new Date(Y0), Y0, '0000-06-15T10:00:00.000Z']) {
      await expect(engine.find('ledger', { where: { opens_at: { $gt: comparand } } }), String(comparand)).resolves.toEqual([]);
    }
    expect(reads).toHaveLength(3);
    for (const comparand of [Y10000, new Date(Y10000), '+010000-01-01T00:00:00.000Z', YNEG1, '9999-12-31T23:59:59-01:00']) {
      const err = await refusalOf(engine.find('ledger', { where: { opens_at: { $gt: comparand } } }));
      expect(err, String(comparand)).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
      expect(err!.message).toContain("'opens_at'");
    }
    expect(reads, 'every refusal precedes the driver').toHaveLength(3);
  });

  it('the refusal names the year class, not "compares false for every row"', async () => {
    const err = await refusalOf(engine.find('ledger', { where: { opened_at: { $gt: Y10000 } } }));
    expect(err!.message).toContain("'opened_at'");
    expect(err!.message).toContain('where.opened_at.$gt');
    expect(err!.message).toContain('1000 to 9999');
    expect(err!.message).not.toContain('compare false for EVERY row');
    // A `date` keeps its own years in its words.
    const day = await refusalOf(engine.find('ledger', { where: { placed_on: { $gt: Y10000 } } }));
    expect(day!.message).toContain('0001 to 9999');
  });

  // [#20280] A `datetime` in 0001..0999 sorts and compares as the instant it
  // names on every backend, so its refusal claims no misorder: it names the
  // floor and why it sits at 1000. Past 9999 the misorder words stay.
  it('[#20280] a datetime before year 1000 is refused in its own words, on where and on having', async () => {
    const where = await refusalOf(engine.find('ledger', { where: { opened_at: { $gt: '0500-07-15T10:00:00.000Z' } } }));
    expect(where).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    expect(where!.message).toContain('outside the years 1000 to 9999');
    expect(where!.message).toContain('Before year 1000');
    expect(where!.message).not.toContain('does not sort');
    const having = await refusalOf(engine.aggregate('ledger', {
      groupBy: ['customer_id'],
      aggregations: [{ function: 'min', field: 'opened_at', alias: 'first' }],
      having: { first: { $gt: new Date(at('0500-07-15T10:00:00.000Z')) } },
    } as never));
    expect(having).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    expect(having!.message).toContain('Before year 1000');
    expect(having!.message).not.toContain('does not sort');
    const past = await refusalOf(engine.find('ledger', { where: { opened_at: { $gt: '+010000-01-01T00:00:00.000Z' } } }));
    expect(past!.message).toContain('does not sort as an instant');
    expect(past!.message).not.toContain('Before year 1000');
    expect(reads).toHaveLength(0);
  });

  // [#20280] The `datetime` floor is not `time`'s: a `time` column keeps the
  // time of day of an instant in 0001..0999, and one it refuses for another
  // reason is named by that reason, never as an instant with no four-digit year.
  it('[#20280] a time field still reads an instant before year 1000, and names another refusal by its own class', async () => {
    for (const comparand of ['0500-07-15T10:00:00.000Z', at('0009-03-04T10:00:00.000Z'), new Date(at('0999-12-31T23:59:59.999Z'))]) {
      await expect(engine.find('ledger', { where: { opens_at: { $gt: comparand } } }), String(comparand)).resolves.toEqual([]);
    }
    expect(reads).toHaveLength(3);
    const impossible = await refusalOf(engine.find('ledger', { where: { opens_at: { $gt: '0500-02-30T10:00:00Z' } } }));
    expect(impossible).toMatchObject({ code: 'INVALID_FILTER', status: 400 });
    expect(impossible!.message).toContain('whose calendar day does not exist');
    expect(impossible!.message).not.toContain('no time of day is read');
    const notIso = await refusalOf(engine.find('ledger', { where: { opens_at: { $gt: '0500/07/15 10:00' } } }));
    expect(notIso!.message).toContain('not one of the ISO 8601 spellings');
    expect(notIso!.message).not.toContain('no time of day is read');
    expect(reads, 'every refusal precedes the driver').toHaveLength(3);
  });
});

describe('[#20264] the write door — a date or datetime value outside its kind\'s years is VALIDATION_FAILED, before any write', () => {
  let engine: ObjectQL;
  let writes: unknown[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    writes = rec.writes;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(ledger, 'test');
  });

  // field · value — each one a 201 on memory and SQLite at the base (the date
  // extended ISO stored verbatim, a non-day) and a 500 on PostgreSQL.
  const REFUSED: ReadonlyArray<readonly [string, unknown]> = [
    ['placed_on', '+010000-01-01T00:00:00.000Z'],
    ['placed_on', '-000001-01-01T00:00:00.000Z'],
    ['placed_on', '0000-06-15'],
    ['placed_on', new Date(Y10000)],
    ['placed_on', new Date(Y0)],
    ['opened_at', '+010000-01-01T00:00:00.000Z'],
    ['opened_at', '-000001-01-01T00:00:00.000Z'],
    ['opened_at', '0000-06-15T10:00:00.000Z'],
    ['opened_at', '9999-12-31T23:59:59-01:00'],
    ['opened_at', new Date(YNEG1)],
    // [#20280] A datetime before year 1000 — each a 201 here at the base.
    ['opened_at', '0001-01-01T00:00:00.000Z'],
    ['opened_at', '0099-03-04T10:00:00.000Z'],
    ['opened_at', '0999-12-31T23:59:59.999Z'],
    ['opened_at', '1000-01-01T00:00:00+08:00'],
    ['opened_at', new Date(at('0500-07-15T10:00:00.000Z'))],
  ];
  // The edges, and a 2026 control, on both kinds.
  const ACCEPTED: ReadonlyArray<readonly [string, unknown]> = [
    ['placed_on', '0001-01-01'],
    ['placed_on', '9999-12-31'],
    ['placed_on', '2026-02-01'],
    ['placed_on', new Date(at('0001-01-01T00:00:00.000Z'))],
    // [#20280] The control: a `date` keeps 0001..0999.
    ['placed_on', '0099-03-04'],
    ['placed_on', '0999-12-31'],
    ['opened_at', '1000-01-01T00:00:00.000Z'],
    ['opened_at', new Date(at('1000-01-01T00:00:00.000Z'))],
    ['opened_at', '0999-12-31T23:00:00-02:00'],
    ['opened_at', '9999-12-31T23:59:59.999Z'],
    ['opened_at', '2026-02-01T10:00:00.000Z'],
  ];

  const doors = (field: string, value: unknown) => [
    ['insert', () => engine.insert('ledger', { id: 'n1', [field]: value })],
    ['update', () => engine.update('ledger', { id: 'r1', [field]: value })],
    ['multi-row update', () => engine.update('ledger', { [field]: value }, { where: { customer_id: 'c1' }, multi: true })],
  ] as const;

  it('refuses each on insert, update and a multi-row update, with the field and invalid_date — and writes nothing', async () => {
    for (const [field, value] of REFUSED) {
      const label = `${field} ${value instanceof Date ? `Date ${value.toISOString()}` : JSON.stringify(value)}`;
      for (const [door, call] of doors(field, value)) {
        const err = await refusalOf(call());
        expect(err, `${door}, ${label}`).not.toBeNull();
        expect(err!.code, `${door}, ${label}`).toBe('VALIDATION_FAILED');
        expect(err!.fields, `${door}, ${label}`).toEqual([expect.objectContaining({ field, code: 'invalid_date' })]);
      }
    }
    expect(writes, 'no write — every refusal precedes the driver').toHaveLength(0);
  });

  it('the dry-run validate predicts each refusal — and each accepted value as valid', async () => {
    for (const [field, value] of REFUSED) {
      const verdict = await engine.validate('ledger', { [field]: value });
      expect(verdict.valid, `${field} ${String(value)}`).toBe(false);
      expect(verdict.results[0]!.errors, `${field} ${String(value)}`)
        .toEqual([expect.objectContaining({ field, code: 'invalid_date' })]);
    }
    for (const [field, value] of ACCEPTED) {
      expect((await engine.validate('ledger', { [field]: value })).valid, `${field} ${String(value)}`).toBe(true);
    }
  });

  it('accepts the edges and a 2026 value on every door — the POSITIVE CONTROL', async () => {
    for (const [field, value] of ACCEPTED) {
      for (const [door, call] of doors(field, value)) {
        const before = writes.length;
        await expect(call(), `${door}, ${field} ${String(value)}`).resolves.toBeDefined();
        expect(writes.length, `${door}, ${field} ${String(value)} reached the driver`).toBe(before + 1);
      }
    }
  });
});
