// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25808] `{ $now: true, addDays }` — the now-anchored comparand on the
 * engine's three filter positions, maintainer ruling 2026-10-26 (letter A):
 *
 * - `where`: the token resolver PINS `$now` to the tree's instant before any
 *   driver runs — a driver sees `{ $now: '<ISO>', addDays }`, never `true` —
 *   and an anchor without `addDays` is the resolver's `INVALID_FILTER` / 400.
 * - `aggregations[i].filter`: the per-aggregation judge holds the anchor to
 *   `where`'s class rule (a temporal target, a declared numeric offset) with
 *   the operands withheld, and the rows fallback counts it through
 *   `@objectstack/formula`.
 * - `having`: the aggregated row's classes judge the same rule by name (the
 *   query is the author's own), and the resolved anchor is compared per group.
 *
 * `Date` is faked to one instant so every count below is a table, the way the
 * SQL conformance corpus pins its `$now`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

const NOW = new Date('2026-03-03T12:00:00.000Z');

/** Tickets: opened on a calendar day (an instant at noon), an SLA in days, and a numeric decoy. */
const TICKETS = [
  { id: 't1', region: 'east', opened_at: '2026-02-01T12:00:00.000Z', opened_on: '2026-02-01', sla_days: -7,  amount: 10, title: 'a' },
  { id: 't2', region: 'east', opened_at: '2026-03-01T12:00:00.000Z', opened_on: '2026-03-01', sla_days: -7,  amount: 20, title: 'b' },
  { id: 't3', region: 'west', opened_at: '2026-02-20T12:00:00.000Z', opened_on: '2026-02-20', sla_days: -14, amount: 30, title: 'c' },
  { id: 't4', region: 'west', opened_at: '2026-02-25T12:00:00.000Z', opened_on: '2026-02-25', sla_days: null, amount: 40, title: 'd' },
  { id: 't5', region: 'west', opened_at: null,                       opened_on: null,         sla_days: -7,  amount: 50, title: 'e' },
];

function makeRawDriver(rows: any[]) {
  const seen: any[] = [];
  const driver: any = {
    name: 'raw-mock',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, query: any) { seen.push(query); return rows.map((r) => ({ ...r })); },
    async findOne() { return rows[0] ?? null; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return rows.length; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, seen };
}

async function makeEngine(driver: any) {
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  (engine.registry as any).registerObject({
    name: 'ticket',
    fields: {
      region: { type: 'text' },
      opened_at: { type: 'datetime' },
      opened_on: { type: 'date' },
      sla_days: { type: 'number' },
      amount: { type: 'number' },
      title: { type: 'text' },
    },
  });
  return engine;
}

type Wire = Error & { code?: string; status?: number };
async function refusalOf(run: () => Promise<unknown>): Promise<Wire> {
  try {
    const got = await run();
    throw new Error(`expected a refusal, got ${JSON.stringify(got)}`);
  } catch (e) {
    return e as Wire;
  }
}

/** "Opened more than SLA days ago": the column holds NEGATIVE days, the sign rules are `addDays`'. */
const OVERDUE = { $lt: { $now: true, addDays: { $field: 'sla_days' } } };

describe('[#25808] the now-anchored comparand on the engine', () => {
  let engine: ObjectQL;
  let seen: any[];
  const warned: string[] = [];

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const made = makeRawDriver(TICKETS);
    seen = made.seen;
    engine = await makeEngine(made.driver);
    (engine as any).logger = { ...(engine as any).logger, warn: (m: string) => { warned.push(m); }, debug() {}, info() {}, error() {} };
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  describe('`where` — the resolver pins `$now` to the tree\'s instant before any driver runs', () => {
    it('a driver sees the ISO instant, the offset kept as written', async () => {
      seen.length = 0;
      await engine.find('ticket', { where: { opened_at: OVERDUE } });
      expect(seen).toHaveLength(1);
      expect(seen[0].where).toEqual({ opened_at: { $lt: { $now: NOW.toISOString(), addDays: { $field: 'sla_days' } } } });
      // …and the literal arm, likewise.
      seen.length = 0;
      await engine.find('ticket', { where: { opened_on: { $gte: { $now: true, addDays: -30 } } } });
      expect(seen[0].where).toEqual({ opened_on: { $gte: { $now: NOW.toISOString(), addDays: -30 } } });
    });

    it('an anchor without addDays is refused at the resolver — `{now}` is the spelling for the bare instant', async () => {
      const err = await refusalOf(() => engine.find('ticket', { where: { opened_at: { $lt: { $now: true } } } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('addDays');
      expect(err.message).toContain('{now}');
    });

    it('a malformed offset is refused at the resolver', async () => {
      const err = await refusalOf(() => engine.find('ticket', { where: { opened_at: { $lt: { $now: true, addDays: 1.5 } } } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    });

    it('the temporal door does not judge the anchor as a literal', async () => {
      // A `datetime` column's literal door refuses `'soon'`; the anchor passes it.
      const err = await refusalOf(() => engine.find('ticket', { where: { opened_at: { $lt: 'soon' } } }));
      expect(err.code).toBe('INVALID_FILTER');
      seen.length = 0;
      await expect(engine.find('ticket', { where: { opened_at: OVERDUE } })).resolves.toBeDefined();
    });
  });

  describe('`aggregations[i].filter` — counted through the rows fallback, judged by `where`\'s rules', () => {
    it('counts "opened more than SLA days ago" with the SLA read off each row', async () => {
      // NOW is 03-03. t1: 02-01 < 02-24 ✓; t2: 03-01 < 02-24 ✗; t3: 02-20 < 02-17 ✗;
      // t4: NULL sla = 0 days, 02-25 < 03-03 ✓; t5: never opened ✗.
      const aggregations: NonNullable<EngineAggregateOptions['aggregations']> = [
        { function: 'count', alias: 'n' },
        { function: 'count', alias: 'overdue', filter: { opened_at: OVERDUE } },
        { function: 'count', alias: 'overdue_on', filter: { opened_on: OVERDUE } },
        { function: 'count', alias: 'recent', filter: { opened_on: { $gte: { $now: true, addDays: -7 } } } },
      ];
      const rows = await engine.aggregate('ticket', { aggregations });
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].n)).toBe(5);
      expect(Number(rows[0].overdue)).toBe(2);
      // The `date` twin answers the same count — the calendar-day form.
      expect(Number(rows[0].overdue_on)).toBe(2);
      // On or after 02-24: t2, t4.
      expect(Number(rows[0].recent)).toBe(2);
    });

    const withheld = async (filter: unknown, fragment: string) => {
      warned.length = 0;
      const err = await refusalOf(() => engine.aggregate('ticket', {
        aggregations: [{ function: 'count', alias: 'x', filter: filter as any }],
      }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('now-anchored');
      expect(err.message).toContain('aggregations[0].filter');
      for (const name of ['opened_at', 'sla_days', 'amount', 'title', 'no_such']) {
        expect(err.message, `message names "${name}"`).not.toContain(name);
      }
      expect(warned.join('\n')).toContain(fragment);
    };

    it('a NUMERIC target is refused, operands withheld, the reason in the log', async () => {
      await withheld({ amount: OVERDUE }, 'only a date or datetime column');
    });

    it('a TEXT offset column is refused', async () => {
      await withheld({ opened_at: { $lt: { $now: true, addDays: { $field: 'title' } } } }, 'not a numeric column');
    });

    it('an undeclared offset column is refused', async () => {
      await withheld({ opened_at: { $lt: { $now: true, addDays: { $field: 'no_such' } } } }, 'not a declared field');
    });

    it('a malformed anchor is refused by its declaration, the position named', async () => {
      const err = await refusalOf(() => engine.aggregate('ticket', {
        aggregations: [{ function: 'count', alias: 'x', filter: { opened_at: { $lt: { $now: true } } } }],
      }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('addDays');
    });

    it('an anchor as an $in member is refused by position', async () => {
      const err = await refusalOf(() => engine.aggregate('ticket', {
        aggregations: [{ function: 'count', alias: 'x', filter: { opened_at: { $in: [{ $now: true, addDays: 1 }] } } }],
      }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('WHOLE comparand');
    });
  });

  describe('`having` — the aggregated row\'s classes judge the rule by name', () => {
    const grouped = (having: unknown) => engine.aggregate('ticket', {
      groupBy: ['region'],
      aggregations: [
        { function: 'min', field: 'opened_at', alias: 'first_opened' },
        { function: 'max', field: 'opened_on', alias: 'last_opened' },
        { function: 'count', alias: 'n' },
        { function: 'min', field: 'sla_days', alias: 'tightest_sla' },
      ],
      having: having as any,
    });

    it('a `min` of a datetime keeps its kind: the anchor compares per group', async () => {
      // east first opened 02-01, west 02-20; NOW - 14 days is 02-17.
      const older = await grouped({ first_opened: { $lt: { $now: true, addDays: -14 } } });
      expect(older.map((r) => r.region)).toEqual(['east']);
      // The `date` column's `max`: east last 03-01, west 02-25; on or after 02-28.
      const recent = await grouped({ last_opened: { $gte: { $now: true, addDays: -3 } } });
      expect(recent.map((r) => r.region)).toEqual(['east']);
      // A column offset read off the aggregated row: `min(sla_days)` is -7 (east,
      // bound 02-24) / -14 (west, bound 02-17); east's 02-01 is before its bound,
      // west's 02-20 is on or after its own.
      const overdue = await grouped({ first_opened: { $lt: { $now: true, addDays: { $field: 'tightest_sla' } } } });
      expect(overdue.map((r) => r.region)).toEqual(['east']);
      const inside = await grouped({ first_opened: { $gte: { $now: true, addDays: { $field: 'tightest_sla' } } } });
      expect(inside.map((r) => r.region)).toEqual(['west']);
    });

    it('a `count` column is refused — the anchor is an instant', async () => {
      const err = await refusalOf(() => grouped({ n: { $gt: { $now: true, addDays: 1 } } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('now-anchored');
      expect(err.message).toContain('"n"');
      expect(err.message).toContain('numeric');
    });

    it('an offset naming no column of the aggregated row is refused by name', async () => {
      const err = await refusalOf(() => grouped({ first_opened: { $lt: { $now: true, addDays: { $field: 'sla_days' } } } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('names no column of the aggregated row');
    });

    it('a non-numeric offset column is refused', async () => {
      const err = await refusalOf(() => grouped({ first_opened: { $lt: { $now: true, addDays: { $field: 'last_opened' } } } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('not a numeric column');
    });

    it('the bare `{ column: { $now, addDays } }` spelling is refused', async () => {
      const err = await refusalOf(() => grouped({ first_opened: { $now: true, addDays: 1 } }));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('now-anchored');
    });
  });
});
