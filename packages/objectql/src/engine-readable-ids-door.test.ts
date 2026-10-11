// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D1, E1] The engine's comparand door and a `ReadableIds` leaf.
 *
 * Three answers, each before any driver is asked:
 *
 * - **An unbranded copy is refused `INVALID_FILTER` / 400** — a `where` holding
 *   the leaf after a JSON round-trip or a structured clone, and the
 *   plain-object spelling a request could write, are a plain object in a list
 *   slot. That refusal existed before the leaf did; it is THE refusal.
 * - **A branded leaf passes the door and is refused `INTERNAL_ERROR` / 500** —
 *   the engine does not compose the leaf yet (ADR-0139 D2), and no driver
 *   evaluates it as written: measured at `a2e94c2a05` with the leaf handed
 *   straight to each driver, `driver-memory` threw a raw `TypeError`,
 *   `driver-sql` (SQLite) answered `500 DATABASE_ERROR` and
 *   `driver-mongodb`'s `translateFilter` emitted it unchanged. So the leaf
 *   stops at the door's seam, on every verb and at every position.
 * - **A list keeps working** — the lit control: the recording driver IS
 *   reachable, so a refusal's "no read" means the refusal, not a dead harness.
 *
 * The recording driver is this package's witness shape (the in-memory
 * driver's test consumers are a closed census): the door answers before a
 * driver is resolved, so what matters is that no read is recorded.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ReadableIds } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

interface SeenCall { verb: string; object: string; ast: any }

function makeRecordingDriver() {
  const calls: SeenCall[] = [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) { calls.push({ verb: 'find', object, ast }); return []; },
    async findOne(object: string, ast: any) { calls.push({ verb: 'findOne', object, ast }); return null; },
    async count(object: string, ast: any) { calls.push({ verb: 'count', object, ast }); return 0; },
    async aggregate(object: string, ast: any) { calls.push({ verb: 'aggregate', object, ast }); return []; },
    async create(object: string, data: Record<string, unknown>) { calls.push({ verb: 'create', object, ast: data }); return data; },
    async update(object: string, _id: string, data: Record<string, unknown>) { calls.push({ verb: 'update', object, ast: data }); return data; },
    async updateMany(object: string, ast: any) { calls.push({ verb: 'updateMany', object, ast }); return 0; },
    async delete(object: string) { calls.push({ verb: 'delete', object, ast: null }); return true; },
    async deleteMany(object: string, ast: any) { calls.push({ verb: 'deleteMany', object, ast }); return 0; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, calls };
}

const CHILD = {
  name: 'rid_child',
  label: 'ReadableIds probe child',
  fields: {
    object_name: { name: 'object_name', type: 'text' },
    record_id: { name: 'record_id', type: 'text' },
    note: { name: 'note', type: 'text' },
    amount: { name: 'amount', type: 'number' },
    parent: { name: 'parent', type: 'lookup', reference: 'rid_parent' },
  },
};
const PARENT = {
  name: 'rid_parent',
  label: 'ReadableIds probe parent',
  fields: { title: { name: 'title', type: 'text' } },
};

type Thrown = (Error & { code?: string; status?: number }) | null;
const refusalOf = async (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e: any) => e);
const envelopeOf = (err: Thrown) => ({ code: err?.code, status: err?.status });

const INVALID_FILTER = { code: 'INVALID_FILTER', status: 400 };
const UNCOMPOSED = { code: 'INTERNAL_ERROR', status: 500 };

describe('[ADR-0139 D1] the engine comparand door and a ReadableIds leaf', () => {
  let engine: ObjectQL;
  let calls: SeenCall[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    calls = rec.calls;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(PARENT as any, 'test');
    engine.registry.registerObject(CHILD as any, 'test');
    calls.length = 0;
  });

  it('a JSON round-trip of a where holding the leaf is refused INVALID_FILTER / 400 — no driver call', async () => {
    const where = { object_name: 'rid_parent', record_id: { $in: ReadableIds.of('rid_parent') } };
    const wire = JSON.parse(JSON.stringify(where));
    const err = await refusalOf(engine.find('rid_child', { where: wire }));
    expect(envelopeOf(err)).toEqual(INVALID_FILTER);
    expect(err!.message).toMatch(/^find\('rid_child'\): Operator "\$in" on field "record_id" requires an ARRAY of values\. Received object/);
    expect(calls, 'the refusal precedes the driver').toHaveLength(0);
  });

  it('a structured clone and a spread of the leaf are refused INVALID_FILTER / 400 — no driver call', async () => {
    const leaf = ReadableIds.of('rid_parent');
    for (const copy of [structuredClone(leaf), { ...leaf }]) {
      const err = await refusalOf(engine.find('rid_child', { where: { record_id: { $in: copy } } }));
      expect(envelopeOf(err)).toEqual(INVALID_FILTER);
    }
    expect(calls).toHaveLength(0);
  });

  it('the plain-object spelling is refused INVALID_FILTER / 400 on every read verb — no driver call', async () => {
    const where = { record_id: { $in: { object: 'rid_parent' } } };
    const answers = await Promise.all([
      refusalOf(engine.find('rid_child', { where })),
      refusalOf(engine.findOne('rid_child', { where })),
      refusalOf(engine.count('rid_child', { where })),
      refusalOf(engine.aggregate('rid_child', { where, aggregations: [{ function: 'count', alias: 'n' }] })),
    ]);
    for (const err of answers) expect(envelopeOf(err)).toEqual(INVALID_FILTER);
    expect(calls).toHaveLength(0);
  });

  it('a branded leaf passes the door and is refused INTERNAL_ERROR / 500 as uncomposed, naming its position and object — no driver call', async () => {
    const err = await refusalOf(engine.find('rid_child', {
      where: { object_name: 'rid_parent', record_id: { $in: ReadableIds.of('rid_parent') } },
    }));
    expect(envelopeOf(err)).toEqual(UNCOMPOSED);
    expect(err!.message).toMatch(
      /^find\('rid_child'\): where\.record_id\.\$in holds a ReadableIds leaf, "the ids of 'rid_parent' this caller may read", and this engine does not compose that leaf yet\. The query was NOT run and no driver was asked/,
    );
    expect(calls, 'the leaf never reaches a driver').toHaveLength(0);
  });

  it('the uncomposed leaf is refused under $and / $or / $not and on every verb — no driver call', async () => {
    const leaf = () => ReadableIds.of('rid_parent');
    const cases: ReadonlyArray<readonly [string, () => Promise<unknown>, string]> = [
      ['find $or', () => engine.find('rid_child', { where: { $or: [{ note: 'x' }, { record_id: { $in: leaf() } }] } }), 'where.$or[1].record_id.$in'],
      ['find $not', () => engine.find('rid_child', { where: { $not: { record_id: { $in: leaf() } } } }), 'where.$not.record_id.$in'],
      ['find $and', () => engine.find('rid_child', { where: { $and: [{ object_name: 'rid_parent' }, { record_id: { $in: leaf() } }] } }), 'where.$and[1].record_id.$in'],
      ['findOne', () => engine.findOne('rid_child', { where: { record_id: { $in: leaf() } } }), 'where.record_id.$in'],
      ['count', () => engine.count('rid_child', { where: { record_id: { $in: leaf() } } }), 'where.record_id.$in'],
      ['aggregate where', () => engine.aggregate('rid_child', { where: { record_id: { $in: leaf() } }, aggregations: [{ function: 'count', alias: 'n' }] }), 'where.record_id.$in'],
      ['aggregate aggregation filter', () => engine.aggregate('rid_child', { aggregations: [{ function: 'count', alias: 'n', filter: { record_id: { $in: leaf() } } }] }), 'aggregations[0].filter.record_id.$in'],
      ['update multi', () => engine.update('rid_child', { note: 'y' }, { where: { record_id: { $in: leaf() } }, multi: true }), 'where.record_id.$in'],
      ['delete multi', () => engine.delete('rid_child', { where: { record_id: { $in: leaf() } }, multi: true }), 'where.record_id.$in'],
    ];
    for (const [label, run, at] of cases) {
      const err = await refusalOf(run());
      expect(envelopeOf(err), label).toEqual(UNCOMPOSED);
      expect(err!.message, label).toContain(`: ${at} holds a ReadableIds leaf`);
    }
    expect(calls, 'no verb reached the driver').toHaveLength(0);
  });

  it('a leaf at a position the shape door does not judge is refused too — equality, a list member, a range endpoint, a nested-relation condition', async () => {
    const leaf = () => ReadableIds.of('rid_parent');
    const cases: ReadonlyArray<readonly [Record<string, unknown>, string]> = [
      [{ record_id: leaf() }, 'where.record_id'],
      [{ record_id: { $eq: leaf() } }, 'where.record_id.$eq'],
      [{ record_id: { $in: ['p1', leaf()] } }, 'where.record_id.$in[1]'],
      [{ amount: { $between: [1, leaf()] } }, 'where.amount.$between[1]'],
      [{ parent: { title: leaf() } }, 'where.parent.title'],
    ];
    for (const [where, at] of cases) {
      const err = await refusalOf(engine.find('rid_child', { where }));
      expect(envelopeOf(err), at).toEqual(UNCOMPOSED);
      expect(err!.message, at).toContain(`: ${at} holds a ReadableIds leaf`);
    }
    expect(calls).toHaveLength(0);
  });

  it('LIT CONTROL — a list comparand on the same field reaches the driver', async () => {
    await engine.find('rid_child', { where: { record_id: { $in: ['p1', 'p2'] } } });
    expect(calls.map((c) => c.verb)).toEqual(['find']);
    expect(calls[0].ast.where).toEqual({ record_id: { $in: ['p1', 'p2'] } });
  });
});
