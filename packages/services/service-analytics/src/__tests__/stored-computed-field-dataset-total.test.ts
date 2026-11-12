// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A computed value can be totalled: the remedy the formula refusal prescribes
 * is a way to the total, end to end.
 *
 * The case is a leave app's day count, `daysBetween(start, end) + 1`. As a
 * `formula` it is computed on read and stores no value, so a dataset measure
 * `sum` over it is refused at the compile door (`400 DATASET_INVALID`) with the
 * spec's one sentence, `VIRTUAL_FIELD_AGGREGATE_REMEDY`. That sentence names a
 * field of the formula's return type (here `number`) carrying the same
 * `expression`: a stored computed field, which the engine computes from the row
 * every write stores and keeps in a column. This file follows the sentence and
 * shows the total it leads to:
 *
 * - an insert stores the computed value, and a value the client sent for the
 *   field does not stand; a batch insert (the import path) computes each row;
 * - an update by id that moves an input stores the recomputed value;
 * - a dataset `sum` grouped by leave type answers the true totals after each
 *   write, on both analytics strategies (native SQL and the engine aggregate);
 * - the field takes the formula's RETURN type, not `number` for every formula:
 *   a date expression stores on a `date` field and is refused on a `number`.
 *
 * It needs nothing an author on a hosted tier cannot write: no hook, no flow,
 * only the field's declaration.
 *
 * The composition is the shipped one: `AnalyticsServicePlugin` over a real
 * `ObjectQL` engine on a real `SqlDriver` (SQLite), as its `'data'` service.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectSchema, VIRTUAL_FIELD_AGGREGATE_REMEDY } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsServicePlugin } from '../plugin.js';
import type { AnalyticsService } from '../analytics-service.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

const OBJECT = 'leave_request';
const DAYS = 'daysBetween(record.start_date, record.end_date) + 1';

/** The leave object, parsed as authored: the stored day count beside the formula it replaces. */
const LEAVE = ObjectSchema.parse({
  name: OBJECT,
  label: 'Leave request',
  fields: {
    leave_type: { type: 'text' },
    start_date: { type: 'date' },
    end_date: { type: 'date' },
    // The remedy: a field of the formula's return type (`number`) carrying the expression —
    // computed and stored on every write.
    days: { type: 'number', readonly: true, expression: DAYS },
    // The refused shape it replaces, kept as the control: computed on read, no column.
    days_formula: { type: 'formula', returnType: 'number', expression: DAYS },
  },
});

const datasetSumming = (field: string) => DatasetSchema.parse({
  name: `leave_totals_${field}`,
  label: 'Leave totals',
  object: OBJECT,
  dimensions: [{ name: 'leave_type', field: 'leave_type', type: 'string' }],
  measures: [{ name: 'total_days', aggregate: 'sum', field }],
});

const SELECTION = { dimensions: ['leave_type'], measures: ['total_days'] };

type Face = 'native' | 'objectql';
const FACES: readonly Face[] = ['native', 'objectql'];

describe('a stored computed field — the formula refusal\'s remedy — is totalled by a dataset (sqlite)', () => {
  let engine: ObjectQL;
  const services: Partial<Record<Face, AnalyticsService>> = {};
  const ids: Record<string, string> = {};

  const storedDays = async (id: string): Promise<unknown> =>
    ((await engine.findOne(OBJECT, { where: { id } } as never)) as Record<string, unknown> | null)?.days;

  /** The dataset's answer as `{ leave_type: total }`. */
  const totals = async (face: Face, field = 'days'): Promise<Record<string, number>> => {
    const res = await services[face]!.queryDataset(datasetSumming(field) as never, SELECTION as never);
    return Object.fromEntries((res.rows ?? []).map((r: Record<string, unknown>) => [String(r.leave_type), Number(r.total_days)]));
  };

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(LEAVE as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);

    // The plugin's own composition over the real engine; `objectql` narrows the
    // capabilities to the engine-aggregate path.
    for (const [face, caps] of [
      ['native', undefined],
      ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
    ] as const) {
      const registered: Record<string, unknown> = {};
      await new AnalyticsServicePlugin({ ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
        getService: (name: string) => (name === 'data' ? engine : registered[name]),
        registerService: (name: string, svc: unknown) => { registered[name] = svc; },
        replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
        hook: () => {},
        logger: quiet,
      } as never);
      services[face] = registered.analytics as AnalyticsService;
    }
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('CONTROL the formula it replaces is refused at the compile door, naming this remedy', async () => {
    for (const face of FACES) {
      const err = await totals(face, 'days_formula').then(
        () => { throw new Error(`${face}: a sum over the formula must be refused`); },
        (e: Error & { code?: string; status?: number }) => e,
      );
      expect(err.code, face).toBe('DATASET_INVALID');
      expect(err.status, face).toBe(400);
      expect(err.message, face).toContain(VIRTUAL_FIELD_AGGREGATE_REMEDY);
    }
  });

  it('an insert stores the computed value, and a client-sent value does not stand', async () => {
    const annual = (await engine.insert(OBJECT, {
      leave_type: 'annual', start_date: '2026-11-02', end_date: '2026-11-06', days: 99,
    } as never)) as { id: string };
    // A batch insert, the shape an import's create rows take: each row is computed from itself.
    const batch = (await engine.insert(OBJECT, [
      { leave_type: 'sick', start_date: '2026-11-10', end_date: '2026-11-10' },
      { leave_type: 'annual', start_date: '2026-12-01', end_date: '2026-12-03', days: 1 },
    ] as never)) as Array<{ id: string }>;
    ids.annual = annual.id;
    ids.sick = batch[0]!.id;
    ids.december = batch[1]!.id;

    expect(await storedDays(ids.annual)).toBe(5);
    expect(await storedDays(ids.sick)).toBe(1);
    expect(await storedDays(ids.december)).toBe(3);
  });

  it('a dataset sum grouped by leave type answers the true totals', async () => {
    for (const face of FACES) {
      expect(await totals(face), face).toEqual({ annual: 8, sick: 1 });
    }
  });

  it('an update by id that moves an input stores the recomputed value, and the total follows', async () => {
    await engine.update(OBJECT, { id: ids.sick, end_date: '2026-11-12' } as never, { where: { id: ids.sick } } as never);
    expect(await storedDays(ids.sick)).toBe(3);
    for (const face of FACES) {
      expect(await totals(face), face).toEqual({ annual: 8, sick: 3 });
    }
  });
});

describe('the stored field takes the formula\'s RETURN type, not `number` for every formula (sqlite)', () => {
  // A date formula's `min` / `max` (a list-view group order asks exactly that) is refused like its
  // `sum`; its stored answer is a `date` field. The same expression on a `number` field computes a
  // date the record validator refuses, so every write to the object fails.
  const withLastDay = (name: string, type: string) => ObjectSchema.parse({
    name,
    label: name,
    fields: {
      start_date: { type: 'date' },
      end_date: { type: 'date' },
      last_day: { type, readonly: true, expression: 'record.end_date' },
    },
  });
  let engine: ObjectQL;

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(withLastDay('leave_last_day_date', 'date') as never);
    engine.registry.registerObject(withLastDay('leave_last_day_number', 'number') as never);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
  });

  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('a date expression on a `date` field is computed and stored', async () => {
    const row = (await engine.insert('leave_last_day_date', { start_date: '2026-11-02', end_date: '2026-11-06' } as never)) as { id: string };
    const back = (await engine.findOne('leave_last_day_date', { where: { id: row.id } } as never)) as Record<string, unknown> | null;
    expect(back?.last_day).toBe('2026-11-06');
  });

  it('CONTROL the same expression on a `number` field is refused at the write', async () => {
    const err = await engine.insert('leave_last_day_number', { start_date: '2026-11-02', end_date: '2026-11-06' } as never).then(
      () => { throw new Error('a date stored into a number field must be refused'); },
      (e: Error & { code?: string }) => e,
    );
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.message).toContain('last_day');
  });
});
