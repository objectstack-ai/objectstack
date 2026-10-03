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
 *
 * [#21516] The verbs no longer reach this branch through an unregistered name.
 * An in-process verb resolves its target only through the registry and
 * refuses a name it does not resolve with the data door's `OBJECT_NOT_FOUND`,
 * before admission and before any driver; a registered object always carries
 * a field map (the registry injects the system columns). So the verb cases
 * below now pin the refusal, the typed control is unchanged, and the
 * no-field-map stage is still exercised where it is reachable: the judge, which
 * reads nothing and judges the filter for a name the registry does not hold.
 * Item 7's rule — a seam that cannot read the declared type lowers type-blind —
 * is unchanged.
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

  it('[#21516] every verb refuses the unregistered name with the door\'s OBJECT_NOT_FOUND, and the driver sees nothing', async () => {
    const where = { closed_at: { $lte: '2026-07-28' } };
    const verbs: Array<[string, () => Promise<unknown>]> = [
      ['find', () => engine.find(UNREGISTERED, { where })],
      ['findOne', () => engine.findOne(UNREGISTERED, { where })],
      ['count', () => engine.count(UNREGISTERED, { where })],
      ['aggregate', () => engine.aggregate(UNREGISTERED, {
        where,
        groupBy: ['note'],
        aggregations: [{ function: 'count', alias: 'n' }],
      } as EngineAggregateOptions)],
    ];
    for (const [verb, call] of verbs) {
      const refused: any = await call().then(() => undefined, (e) => e);
      expect({ verb, code: refused?.code, status: refused?.status, object: refused?.object })
        .toEqual({ verb, code: 'OBJECT_NOT_FOUND', status: 404, object: UNREGISTERED });
    }
    expect(seen).toEqual([]);
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
