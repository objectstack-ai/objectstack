// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The cube door's refusal of a `sum` / `avg` / `min` / `max` measure over a
 * `formula` field takes the spec's virtual-field remedy
 * (`VIRTUAL_FIELD_AGGREGATE_REMEDY`, ruling B), not the "count the rows"
 * route every other refused pair keeps.
 *
 * ## The shape this closes
 *
 * A formula stores no value, so a count substituted for its total is a
 * plausible wrong number. The dataset compiler and the engine's aggregate door
 * already answer the pair with the spec's sentence; the cube door — reached by
 * a configured cube and by an inferred cube's suffix measure (`total_sum`),
 * neither of which passes the dataset compiler — still told the caller to
 * count the rows.
 *
 * ## What these pins hold
 *
 * - Every value-reading aggregate over a `formula` column is refused
 *   `INVALID_FIELD` / 400 before anything is read, on a configured cube and on
 *   an inferred cube, and the words carry the remedy verbatim and no "count the
 *   rows" route.
 * - CONTROL: a refused pair over a STORED type (`sum` over `text`) keeps
 *   today's route — the accepted set and "count the rows with count" — and
 *   carries no remedy.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { VIRTUAL_FIELD_AGGREGATE_REMEDY, type Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from './analytics-service.js';
import { AnalyticsServicePlugin } from './plugin.js';
import { installDefaultOrganization } from './__tests__/default-organization.testkit.js';

const OBJECT = 'os35353_formula_ledger';

const LEDGER = {
  name: OBJECT,
  label: 'Cube measure formula ledger',
  fields: {
    note: { name: 'note', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    expected: { name: 'expected', type: 'formula' as const, expression: 'record.amount * 2' },
  },
};

const ROWS = [
  { id: 'r1', note: 'x', amount: 10 },
  { id: 'r2', note: 'y', amount: 32 },
] as const;

const VALUE_READING = ['sum', 'avg', 'min', 'max'] as const;

const CUBE: Cube = {
  name: 'os35353_cube',
  title: 'Cube measure formula cube',
  sql: OBJECT,
  public: true,
  measures: {
    ...Object.fromEntries(
      VALUE_READING.map((fn) => [`${fn}_expected`, { type: fn, sql: 'expected', label: `${fn} of expected (formula)` }]),
    ),
    sum_note: { type: 'sum', sql: 'note', label: 'Sum of notes (text)' },
  },
  dimensions: {
    note: { type: 'string', sql: 'note', label: 'Note' },
  },
} as Cube;

const COUNT_ROUTE = 'count the rows with count';

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Refusal = Error & { code?: string; status?: number; member?: string; field?: string; object?: string };

describe('the cube door answers sum / avg / min / max over a formula with the virtual-field remedy, not a count', () => {
  let engine: ObjectQL;
  const reads = { rawSql: 0, aggregate: 0 };
  let service: AnalyticsService;

  const refusalOf = async (cube: string, member: string) => {
    const before = reads.rawSql + reads.aggregate;
    const err = await service.query({ cube, measures: [member] } as any).then(
      () => undefined,
      (e) => e as Refusal,
    );
    return { err, read: reads.rawSql + reads.aggregate - before };
  };

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL({ logger: quiet } as any);
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(LEDGER as any);
    await engine.syncSchemas();
    await installDefaultOrganization(engine);
    for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

    const realExecute = (engine as any).execute.bind(engine);
    (engine as any).execute = (sql: unknown, opts?: { object?: string }) => {
      if (opts?.object === OBJECT) reads.rawSql += 1;
      return realExecute(sql, opts);
    };
    const realAggregate = engine.aggregate.bind(engine);
    (engine as any).aggregate = (object: string, ...rest: unknown[]) => {
      if (object === OBJECT) reads.aggregate += 1;
      return (realAggregate as any)(object, ...rest);
    };

    const registered: Record<string, unknown> = {};
    await new AnalyticsServicePlugin({ cubes: [CUBE] } as any).init({
      getService: (name: string) => (name === 'data' ? engine : registered[name]),
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      hook: () => {},
      logger: quiet,
    } as never);
    service = registered.analytics as AnalyticsService;
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  for (const [door, cubeOf, memberOf] of [
    ['a configured cube', () => CUBE.name, (fn: string) => `${fn}_expected`],
    ['an inferred cube (suffix measure)', () => OBJECT, (fn: string) => `expected_${fn}`],
  ] as const) {
    it(`${door}: each value-reading aggregate over a formula is refused INVALID_FIELD / 400 with the remedy verbatim and no count route — no read`, async () => {
      for (const fn of VALUE_READING) {
        const member = memberOf(fn);
        const { err, read } = await refusalOf(cubeOf(), member);
        expect(err?.code, `${member}: ${err?.message}`).toBe('INVALID_FIELD');
        expect(err?.status, member).toBe(400);
        expect(err?.member, member).toBe(member);
        expect(err?.field, member).toBe('expected');
        expect(err?.object, member).toBe(OBJECT);
        expect(err!.message, member).toContain(VIRTUAL_FIELD_AGGREGATE_REMEDY);
        expect(err!.message, member).not.toContain(COUNT_ROUTE);
        expect(read, `${member}: nothing was read`).toBe(0);
      }
    });
  }

  it('CONTROL: a refused pair over a stored type keeps the accepted set and the count route, and no remedy', async () => {
    const { err, read } = await refusalOf(CUBE.name, 'sum_note');
    expect(err?.code, err?.message).toBe('INVALID_FIELD');
    expect(err?.status).toBe(400);
    expect(err?.field).toBe('note');
    expect(err!.message).toContain(`; aggregate a field of one of those types, or ${COUNT_ROUTE}.`);
    expect(err!.message).not.toContain(VIRTUAL_FIELD_AGGREGATE_REMEDY);
    expect(read).toBe(0);
  });
});
