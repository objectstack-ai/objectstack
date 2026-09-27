// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19949] A `{ $field }` cross-field reference is REFUSED by `translateFilter`,
 * in every comparand position, with the `INVALID_FILTER` / 400 envelope every
 * filter refusal on this driver speaks.
 *
 * ## The defect, measured
 *
 * `compileCelToFilter` lowers a field-to-field comparison such as
 * `record.s != record.t` to `{ s: { $ne: { $field: 't' } } }` — the spec's
 * `FieldReferenceSchema`. This driver had no arm for it, so `translateFilter`
 * emitted the reference as a LITERAL sub-document. Over the card's rows
 * `{ s: 'a', t: 'a' }` and `{ s: 'a', t: 'b' }`, read through **mingo 7.2.4,
 * the named proxy** for MongoDB query semantics, `$ne` against the reference
 * selected BOTH rows (the one where `s` equals `t` included) and `$eq` selected
 * none. The negated positions widened the same way: `$nin: [ref]`,
 * `$notContains: ref`, `$ne` against a reference carrying `addDays`, and `$eq`
 * under `$not` (lowered to `$nor`).
 *
 * The same reading through the real read path — `ObjectQL`, the real
 * `SecurityPlugin` with a `rowLevelSecurity` `using: 's != t'`, and the real
 * `MongoDBDriver` over a mingo-backed collection — returned both rows from
 * `find`, `2` from `count`, and the `s == t` row from `findOne`: an RLS read
 * restriction widened to every row.
 *
 * ⚠️ **A live `mongod` is NOT MEASURED** — this fleet cannot fetch the binary —
 * and neither mingo nor `@objectstack/plugin-security` is a dependency of this
 * package, so those readings were taken outside this suite and are recorded
 * here and in the PR. This suite pins the translator and the two doors in
 * front of the server: the refusal, and that the server is never asked.
 *
 * ## Scope — the maintainer's ruling on this driver: refuse, do not lower
 *
 * The reference is refused, never implemented (no `$expr` column-to-column
 * lowering). The message names the unsupported feature and withholds the
 * fields, the operator and the position, as the `$ne`-array refusal beside it
 * does: the filter may be an access policy the caller did not write.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { translateFilter } from './mongodb-filter.js';
import { MongoDBDriver } from './mongodb-driver.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const refusalOf = (where: unknown): WireBearingError => {
  try {
    translateFilter(where);
  } catch (e) {
    return e as WireBearingError;
  }
  throw new Error('expected the translator to refuse this filter, but it translated');
};

const asyncRefusalOf = async (run: () => Promise<unknown>): Promise<WireBearingError | null> =>
  run().then(() => null, (e: unknown) => e as WireBearingError);

/** The card's two rows: `s` equals `t` on the first, not on the second. */
const ROWS = [
  { id: 'r1', s: 'a', t: 'a' },
  { id: 'r2', s: 'a', t: 'b' },
];

const REF = { $field: 't' };

/** What `compileCelToFilter` lowers `record.s != record.t` to. */
const COMPILED_NOT_EQUAL = { s: { $ne: REF } };
/** …and `record.s == record.t`. */
const COMPILED_EQUAL = { s: { $eq: REF } };

describe('[#19949] the ruling\'s cases: $ne and $eq against { $field: "t" } are refused', () => {
  it.each([
    ['$ne — what s != t lowers to', COMPILED_NOT_EQUAL],
    ['$eq — what s == t lowers to', COMPILED_EQUAL],
  ])('%s: INVALID_FILTER / 400', (_label, where) => {
    const err = refusalOf(where);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
  });

  it('the message names the unsupported feature, and withholds the fields', () => {
    const err = refusalOf({ secret_scope: { $ne: { $field: 'owner_scope' } } });
    expect(err.message).toContain('does not support field-to-field comparison');
    expect(err.message).toContain('"$field"');
    expect(err.message).not.toContain('secret_scope');
    expect(err.message).not.toContain('owner_scope');
  });

  it('CONTROL — literal $ne / $eq over the same field translate exactly as before', () => {
    expect(translateFilter({ s: { $ne: 'a' } })).toEqual({ s: { $ne: 'a' } });
    expect(translateFilter({ s: { $eq: 'a' } })).toEqual({ s: { $eq: 'a' } });
    expect(translateFilter({ t: { $ne: 'b' } })).toEqual({ t: { $ne: 'b' } });
    expect(translateFilter({ t: { $eq: 'b' } })).toEqual({ t: { $eq: 'b' } });
    expect(translateFilter({ t: 'b' })).toEqual({ t: 'b' });
  });
});

describe('[#19949] every position a reference can reach is refused', () => {
  const POSITIONS: Array<[string, Record<string, unknown>]> = [
    ['$gt', { s: { $gt: REF } }],
    ['$gte', { s: { $gte: REF } }],
    ['$lt', { s: { $lt: REF } }],
    ['$lte', { s: { $lte: REF } }],
    ['an $in member', { s: { $in: ['x', REF] } }],
    ['an $nin member', { s: { $nin: [REF] } }],
    ['the $between lower endpoint', { s: { $between: [REF, 'z'] } }],
    ['the $between upper endpoint', { s: { $between: ['a', REF] } }],
    ['a reference carrying a literal addDays', { s: { $ne: { $field: 't', addDays: 1 } } }],
    ['a reference carrying an addDays reference', { s: { $eq: { $field: 't', addDays: { $field: 'n' } } } }],
    ['a malformed reference ($field not a string)', { s: { $ne: { $field: 42 } } }],
    ['the bare form, with no operator', { s: REF }],
    ['a list in the implicit-equality position', { s: [REF] }],
    ['an array handed to $ne', { s: { $ne: [REF] } }],
    ['$contains', { s: { $contains: REF } }],
    ['$notContains', { s: { $notContains: REF } }],
    ['$startsWith', { s: { $startsWith: REF } }],
    ['$endsWith', { s: { $endsWith: REF } }],
    ['$icontains', { s: { $icontains: REF } }],
    ['$null', { s: { $null: REF } }],
    ['$exists', { s: { $exists: REF } }],
    ['beside a literal operator on the same field', { s: { $gte: 'a', $ne: REF } }],
    ['inside $and', { $and: [{ id: 'r1' }, COMPILED_NOT_EQUAL] }],
    ['inside $or', { $or: [COMPILED_NOT_EQUAL, { s: 'zz' }] }],
    // `{}` reduces the `$or` to TRUE on its first disjunct, so the emitter never
    // reaches the second: only a gate on the WALK refuses this one.
    ['inside $or, beside a TRUE identity', { $or: [{}, COMPILED_NOT_EQUAL] }],
    ['inside $not (lowered to $nor)', { $not: COMPILED_EQUAL }],
    ['nested three combinators deep', { $and: [{ $or: [{ $not: COMPILED_NOT_EQUAL }] }] }],
  ];

  for (const [label, where] of POSITIONS) {
    it(`${label}: INVALID_FILTER / 400, the same refusal`, () => {
      const err = refusalOf(where);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('does not support field-to-field comparison');
    });
  }
});

describe('[#19949] every neighbouring literal shape translates exactly as before', () => {
  it('literal $in / $nin / $between', () => {
    expect(translateFilter({ t: { $in: ['b'] } })).toEqual({ t: { $in: ['b'] } });
    expect(translateFilter({ t: { $nin: ['b'] } })).toEqual({ t: { $nin: ['b'] } });
    expect(translateFilter({ t: { $between: ['a', 'a'] } })).toEqual({ t: { $gte: 'a', $lte: 'a' } });
  });

  it('literal $ne under $not, and the $ne-array refusal beside this gate', () => {
    expect(translateFilter({ $not: { t: { $eq: 'b' } } })).toEqual({ $nor: [{ t: { $eq: 'b' } }] });
    const err = refusalOf({ t: { $ne: ['a', 'b'] } });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).toContain('"$nin"');
  });

  it('an array in the equality slot with no reference still passes through (the shared face owns it)', () => {
    expect(translateFilter({ tags: ['a'] })).toEqual({ tags: ['a'] });
    expect(translateFilter({ tags: { $eq: ['a'] } })).toEqual({ tags: { $eq: ['a'] } });
  });
});

// ── the doors in front of the server ─────────────────────────────────────────

interface RecordedCall { op: string; object: string; filter: unknown }

/**
 * A `Db` stand-in that answers only what a boot and a read touch, and records
 * every filter the driver hands the collection. It selects nothing: whether the
 * SERVER would have matched is mingo's reading above, not this double's.
 */
function recordingDb(calls: RecordedCall[]) {
  const collection = (object: string) => ({
    find: (filter: unknown) => {
      calls.push({ op: 'find', object, filter });
      return { toArray: async () => [] };
    },
    findOne: async (filter: unknown) => { calls.push({ op: 'findOne', object, filter }); return null; },
    countDocuments: async (filter: unknown) => { calls.push({ op: 'count', object, filter }); return 0; },
    updateMany: async (filter: unknown) => { calls.push({ op: 'updateMany', object, filter }); return { modifiedCount: 0 }; },
    deleteMany: async (filter: unknown) => { calls.push({ op: 'deleteMany', object, filter }); return { deletedCount: 0 }; },
    aggregate: (pipeline: unknown) => {
      calls.push({ op: 'aggregate', object, filter: pipeline });
      return { toArray: async () => [] };
    },
    createIndex: async () => 'ok',
  });
  return {
    command: async () => ({ ok: 1 }),
    listCollections: () => ({ toArray: async () => [{ name: 'pair' }] }),
    createCollection: async () => undefined,
    collection,
  };
}

function recordingDriver(calls: RecordedCall[]): MongoDBDriver {
  const driver = new MongoDBDriver({ url: 'mongodb://127.0.0.1:1/unused', database: 'unused' });
  (driver as unknown as { db: unknown }).db = recordingDb(calls);
  // No socket: the Db above IS the connection.
  driver.connect = async () => undefined;
  driver.disconnect = async () => undefined;
  return driver;
}

describe('[#19949] the driver door refuses before the server is asked', () => {
  it('find / findOne / count / updateMany / deleteMany / aggregate, under the engine\'s $and composition', async () => {
    const calls: RecordedCall[] = [];
    const driver = recordingDriver(calls);
    // The shape a read reaches the driver in: the caller's where AND the policy.
    const where = { $and: [{ id: 'r1' }, COMPILED_NOT_EQUAL] };

    for (const run of [
      () => driver.find('pair', { where } as never),
      () => driver.findOne('pair', { where } as never),
      () => driver.count('pair', { where } as never),
      () => driver.updateMany('pair', { where } as never, { s: 'x' }),
      () => driver.deleteMany('pair', { where } as never),
      () => driver.aggregate('pair', { where, aggregations: [{ function: 'count', alias: 'n' }] } as never),
    ]) {
      const err = await asyncRefusalOf(run);
      expect(err?.code).toBe('INVALID_FILTER');
      expect(err?.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  it('CONTROL — a literal policy reaches the server as the document it always was', async () => {
    const calls: RecordedCall[] = [];
    const driver = recordingDriver(calls);
    await driver.find('pair', { where: { t: { $ne: 'a' } } } as never);
    await driver.count('pair', { where: { t: { $eq: 'a' } } } as never);
    expect(calls.map((c) => c.filter)).toEqual([{ t: { $ne: 'a' } }, { t: { $eq: 'a' } }]);
  });
});

describe('[#19949] the RLS read path fails CLOSED: the engine rethrows the refusal', () => {
  const pair = {
    name: 'pair',
    label: 'Pair',
    fields: {
      id: { name: 'id', type: 'text' as const, primaryKey: true },
      s: { name: 's', type: 'text' as const },
      t: { name: 't', type: 'text' as const },
    },
  };

  const engines: ObjectQL[] = [];
  afterEach(async () => {
    while (engines.length) await engines.pop()?.destroy();
  });

  /**
   * An engine over the real driver, with ONE middleware that AND-composes a
   * compiled `using` clause into every read — the composition the security
   * middleware applies after the engine's comparand seams, so the driver is
   * the only face the policy meets. (`@objectstack/plugin-security` itself is
   * not a dependency of this package; its own path was measured outside this
   * suite — see the file header.)
   */
  async function boot(policy: Record<string, unknown>, calls: RecordedCall[]): Promise<ObjectQL> {
    const engine = new ObjectQL();
    engine.registerDriver(recordingDriver(calls) as never, true);
    await engine.init();
    engine.registry.registerObject(pair as never, 'test');
    engine.registerMiddleware(async (opCtx, next) => {
      const ast = (opCtx as { ast?: { where?: unknown } }).ast;
      if (ast) ast.where = ast.where ? { $and: [ast.where, policy] } : policy;
      await next();
    });
    // The refusal is logged once by the engine's find path at WARN; expected here.
    vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);
    engines.push(engine);
    return engine;
  }

  it.each([
    ['s != t', COMPILED_NOT_EQUAL],
    ['s == t', COMPILED_EQUAL],
  ])('using %s — find, findOne and count are refused, never answered unfiltered', async (_cel, policy) => {
    const calls: RecordedCall[] = [];
    const engine = await boot(policy, calls);
    for (const run of [
      () => engine.find('pair', {} as never),
      () => engine.findOne('pair', { where: { id: ROWS[0]!.id } } as never),
      () => engine.count('pair', {} as never),
    ]) {
      const err = await asyncRefusalOf(run);
      expect(err?.code).toBe('INVALID_FILTER');
      expect(err?.status).toBe(400);
    }
    expect(calls.filter((c) => c.object === 'pair')).toHaveLength(0);
  });

  it('CONTROL — a literal policy is composed and handed to the server', async () => {
    const calls: RecordedCall[] = [];
    const engine = await boot({ t: { $ne: 'a' } }, calls);
    await engine.find('pair', {} as never);
    expect(calls.filter((c) => c.object === 'pair').map((c) => c.filter)).toEqual([{ t: { $ne: 'a' } }]);
  });
});
