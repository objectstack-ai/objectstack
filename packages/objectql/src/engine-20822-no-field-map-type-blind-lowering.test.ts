// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20822 · ADR-0053 D-D1 item 7, as amended] The engine's `where` seam has no
 * declared type to read for an object with no field map, and item 7 says what
 * such a seam does: "A seam that cannot applies the rewrite type-blind." So a
 * bare-day upper bound on ANY column of such an object leaves the engine
 * already lowered — `$lte` a day becomes `$lt` the next day, and `$between`
 * splits — on every verb that reads the object's declarations.
 *
 * Before #20822 this branch read "no field map" as "no datetime column" and
 * left the rule to the driver's own copy. Item 5 retires those copies, so that
 * reading would have dropped the whole-day bound on every such read: measured
 * on `driver-memory` with its copy deleted, an unregistered object's `$lte` a
 * day went from the whole day to midnight only.
 *
 * An object WITH a field map keeps the typed scope byte-identical (the control
 * below; `engine-shared-filter-lowering-seam.test.ts` pins the rest of it).
 *
 * The witness is the recording driver's `where`, as in the seam's own pin.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

const UNREGISTERED = 'no_field_map_probe';
const REGISTERED = 'typed_probe';

const TYPED_SCHEMA = {
  name: REGISTERED,
  label: 'Typed probe',
  fields: {
    id: { name: 'id', type: 'text' },
    note: { name: 'note', type: 'text' },
    closed_at: { name: 'closed_at', type: 'datetime' },
    due_on: { name: 'due_on', type: 'date' },
  },
};

interface Seen { verb: string; ast: any }

function makeRecordingDriver() {
  const seen: Seen[] = [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: any) { seen.push({ verb: 'find', ast }); return []; },
    async findOne(_o: string, ast: any) { seen.push({ verb: 'findOne', ast }); return null; },
    async count(_o: string, ast: any) { seen.push({ verb: 'count', ast }); return 0; },
  };
  return { driver, seen };
}

describe('[#20822] an object with no field map: the engine seam lowers type-blind (ADR-0053 D-D1 item 7)', () => {
  let engine: ObjectQL;
  let seen: Seen[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    seen = rec.seen;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(TYPED_SCHEMA as any, 'test');
    seen.length = 0;
  });

  const lastWhere = (verb: string) => [...seen].reverse().find((s) => s.verb === verb)?.ast?.where;

  it('the fixture: the probe object really has no registry entry', () => {
    expect(engine.registry.getObject(UNREGISTERED)).toBeUndefined();
    expect(engine.registry.getObject(REGISTERED)).toBeDefined();
  });

  it('find: a bare-day `$lte` on any column reaches the driver as `$lt` the next day', async () => {
    await engine.find(UNREGISTERED, { where: { closed_at: { $lte: '2026-07-28' } } });
    expect(lastWhere('find')).toEqual({ closed_at: { $lt: '2026-07-29' } });
    // Type-blind means every column: no declaration says `note` is not a datetime.
    await engine.find(UNREGISTERED, { where: { note: { $lte: '2026-07-28' } } });
    expect(lastWhere('find')).toEqual({ note: { $lt: '2026-07-29' } });
  });

  it('find: `$between` with a bare-day maximum splits and widens its upper end', async () => {
    await engine.find(UNREGISTERED, { where: { closed_at: { $between: ['2026-07-01', '2026-07-28'] } } });
    expect(lastWhere('find')).toEqual({ closed_at: { $gte: '2026-07-01', $lt: '2026-07-29' } });
  });

  it('findOne and count take the same reading', async () => {
    await engine.findOne(UNREGISTERED, { where: { closed_at: { $lte: '2026-07-28' } } });
    expect(lastWhere('findOne') ?? lastWhere('find')).toEqual({ closed_at: { $lt: '2026-07-29' } });
    await engine.count(UNREGISTERED, { where: { closed_at: { $lte: '2026-07-28' } } });
    expect(lastWhere('count')).toEqual({ closed_at: { $lt: '2026-07-29' } });
  });

  it('aggregate: its `where` takes the same reading', async () => {
    await engine.aggregate(UNREGISTERED, {
      where: { closed_at: { $lte: '2026-07-28' } },
      groupBy: ['note'],
      aggregations: [{ function: 'count', alias: 'n' }],
    } as EngineAggregateOptions);
    expect(lastWhere('find')).toEqual({ closed_at: { $lt: '2026-07-29' } });
  });

  it('an instant, and `$gte` / `$lt` on a bare day, are never widened', async () => {
    const where = { closed_at: { $lte: '2026-07-28T12:00:00.000Z' }, note: { $gte: '2026-07-01', $lt: '2026-07-28' } };
    await engine.find(UNREGISTERED, { where });
    expect(lastWhere('find')).toBe(where);
  });

  it('control — a field map keeps the typed scope: only the declared datetime is rewritten', async () => {
    const where = { closed_at: { $lte: '2026-07-28' }, due_on: { $lte: '2026-07-28' }, note: { $lte: '2026-07-28' } };
    await engine.find(REGISTERED, { where });
    expect(lastWhere('find')).toEqual({
      closed_at: { $lt: '2026-07-29' },
      due_on: { $lte: '2026-07-28' },
      note: { $lte: '2026-07-28' },
    });
  });

  it('the judge runs the same stage and gains no verdict from it', () => {
    expect(engine.judgeFilter(UNREGISTERED, { closed_at: { $between: ['2026-07-01', '2026-07-28'] } })).toEqual({ ok: true });
  });
});
