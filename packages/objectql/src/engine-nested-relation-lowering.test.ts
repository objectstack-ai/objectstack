// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20802] The nested-relation form `{ relation: { field: value } }` is SERVED
 * at `where`: the engine reads the related object with the condition, as the
 * caller, and hands every driver the filter the two-step route would have
 * written — `$in` on a single-valued relation, an `$or` of `$contains` per id
 * on a multi-valued one. The drivers never see the nested form (ADR-0053 D-D1
 * item 5, D4 (b)).
 *
 * This suite pins the engine's half with a recording driver: what the related
 * read asks for (the object, the condition, `id` only, one row past the cap,
 * the caller's context), what the driver then receives — asserted EQUAL to what
 * the engine sends for the hand-written two-step filter over the same ids, so
 * the shared lowering (NULL-safe `$not`, …) is the one both spellings get —
 * the cap, the structural refusals the first cut keeps (one level, declared
 * keys, a registered related object), the two positions that keep the
 * no-operator-object refusal, and the judge. The rows each driver answers are
 * `@objectstack/rest`'s `data-nested-object-door.test.ts` (SQLite, PostgreSQL)
 * and its `data-nested-relation-permission.test.ts` (the real security layer).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { EngineAggregateOptions, EngineQueryOptions, FilterCondition } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';
import { RELATION_FILTER_ID_CAP } from './relation-filter-lowering.js';

const OBJECT = 'nested_rel_ledger';
const OWNER = 'nested_rel_owner';
const USER = 'sys_user';

const OWNER_OBJECT = {
  name: OWNER,
  label: 'Owner',
  fields: {
    region: { name: 'region', type: 'text' },
    score: { name: 'score', type: 'number' },
    account: { name: 'account', type: 'lookup', reference: OBJECT },
    meta: { name: 'meta', type: 'json' },
  },
};

/** A stand-in for the platform's user object: `user` fields point at `sys_user` by type. */
const USER_OBJECT = { name: USER, label: 'User', fields: { region: { name: 'region', type: 'text' } } };

const LEDGER = {
  name: OBJECT,
  label: 'Ledger',
  fields: {
    title: { name: 'title', type: 'text' },
    owner: { name: 'owner', type: 'lookup', reference: OWNER },
    boss: { name: 'boss', type: 'master_detail', reference: OWNER },
    owners: { name: 'owners', type: 'lookup', reference: OWNER, multiple: true },
    assignee: { name: 'assignee', type: 'user' },
    parent: { name: 'parent', type: 'tree', reference: OBJECT },
    stray: { name: 'stray', type: 'lookup', reference: 'nested_rel_missing' },
    meta: { name: 'meta', type: 'json' },
  },
};

/** field · declared type · the related object it reads · a condition on that object. */
const SINGLE: ReadonlyArray<readonly [string, string, string, Record<string, unknown>]> = [
  ['owner', 'lookup', OWNER, { region: 'NA' }],
  ['boss', 'master_detail', OWNER, { region: 'NA' }],
  ['assignee', 'user', USER, { region: 'NA' }],
  ['parent', 'tree', OBJECT, { title: 'a' }],
];

interface SeenRead { object: string; ast: any }

/**
 * A recording driver. A read of the object named in `answers` returns those
 * rows (the related read's matches); every other read returns none. Writes
 * are recorded, never applied.
 */
function makeRecordingDriver() {
  const reads: SeenRead[] = [];
  const writes: SeenRead[] = [];
  const answers = new Map<string, Array<Record<string, unknown>>>();
  const rowsOf = (o: string) => answers.get(o) ?? [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(o: string, ast: any) { reads.push({ object: o, ast }); return rowsOf(o); },
    async findOne(o: string, ast: any) { reads.push({ object: o, ast }); return rowsOf(o)[0] ?? null; },
    async count(o: string, ast: any) { reads.push({ object: o, ast }); return rowsOf(o).length; },
    async create(_o: string, data: Record<string, unknown>) { return { ...data, id: data.id ?? 'r_1' }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { ...data, id }; },
    async updateMany(o: string, ast: any) { writes.push({ object: o, ast }); return 0; },
    async delete() { return true; },
    async deleteMany(o: string, ast: any) { writes.push({ object: o, ast }); return 0; },
    async bulkCreate(o: string, batch: Record<string, unknown>[]) { return Promise.all(batch.map((r) => this.create(o, r))); },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads, writes, answers };
}

type Thrown = (Error & { code?: string; status?: number }) | null;
const refusalOf = async (p: Promise<unknown>): Promise<Thrown> => p.then(() => null, (e: any) => e);
const envelopeOf = (err: Thrown) => ({ code: err?.code, status: err?.status });
const INVALID_FILTER = { code: 'INVALID_FILTER', status: 400 };

const idRows = (...ids: string[]) => ids.map((id) => ({ id }));

describe('[#20802] the nested-relation form is lowered at the engine\'s where seam', () => {
  let engine: ObjectQL;
  let rec: ReturnType<typeof makeRecordingDriver>;

  beforeEach(async () => {
    rec = makeRecordingDriver();
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(OWNER_OBJECT as any, 'test');
    engine.registry.registerObject(USER_OBJECT as any, 'test');
    engine.registry.registerObject(LEDGER as any, 'test');
  });

  /** The `where` the driver received for the object's own read, after the related read. */
  const outerWhereOf = async (where: unknown, verb: 'find' = 'find') => {
    rec.reads.length = 0;
    await engine[verb](OBJECT, { where } as EngineQueryOptions);
    const outer = rec.reads.filter((r) => r.object === OBJECT);
    return outer[outer.length - 1]?.ast?.where;
  };

  /** What the driver receives for the hand-written two-step filter — the reference. */
  const twoStepWhereOf = async (where: FilterCondition) => {
    const saved = new Map(rec.answers);
    rec.answers.clear();
    rec.reads.length = 0;
    await engine.find(OBJECT, { where });
    const outer = rec.reads.filter((r) => r.object === OBJECT);
    for (const [k, v] of saved) rec.answers.set(k, v);
    return outer[outer.length - 1]?.ast?.where;
  };

  it('every single-valued relation type: the related object is read as the condition says, then $in on its ids', async () => {
    for (const [field, , target, condition] of SINGLE) {
      rec.answers.clear();
      rec.answers.set(target, idRows('r1', 'r3'));
      rec.reads.length = 0;
      await engine.find(OBJECT, { where: { [field]: condition } as FilterCondition });
      const related = rec.reads.filter((r) => r.object === target && r.ast?.limit === RELATION_FILTER_ID_CAP + 1);
      expect(related, field).toHaveLength(1);
      expect(related[0].ast.where, field).toEqual(condition);
      expect(related[0].ast.fields, field).toEqual(['id']);
      const outer = rec.reads[rec.reads.length - 1];
      expect(outer.object, field).toBe(OBJECT);
      expect(outer.ast.where, field).toEqual({ [field]: { $in: ['r1', 'r3'] } });
    }
  });

  it('a multi-valued relation matches on ANY member: an $or of $contains per id, the spec\'s any-of spelling', async () => {
    rec.answers.set(OWNER, idRows('u1', 'u3'));
    expect(await outerWhereOf({ owners: { region: 'NA' } })).toEqual({
      $and: [{ $or: [{ owners: { $contains: 'u1' } }, { owners: { $contains: 'u3' } }] }],
    });
    // Beside the node's own `$and`, the lowered clause is appended, never overwriting it.
    expect(await outerWhereOf({ $and: [{ title: 'a' }], owners: { region: 'NA' } })).toEqual({
      $and: [{ title: 'a' }, { $or: [{ owners: { $contains: 'u1' } }, { owners: { $contains: 'u3' } }] }],
    });
  });

  it('no related record matches: $in [] / $or [] — FALSE, never an absent predicate', async () => {
    rec.answers.set(OWNER, []);
    expect(await outerWhereOf({ owner: { region: 'APAC' } })).toEqual({ owner: { $in: [] } });
    expect(await outerWhereOf({ owners: { region: 'APAC' } })).toEqual({ $and: [{ $or: [] }] });
  });

  it('composes as written inside $and / $or / $not, and the FilterArray sugar alike — exactly the two-step route\'s driver input', async () => {
    rec.answers.set(OWNER, idRows('u1'));
    const cases: ReadonlyArray<readonly [unknown, FilterCondition]> = [
      [{ $or: [{ owner: { region: 'NA' } }, { title: 'a' }] }, { $or: [{ owner: { $in: ['u1'] } }, { title: 'a' }] }],
      [{ $and: [{ title: 'c' }, { boss: { region: 'NA' } }] }, { $and: [{ title: 'c' }, { boss: { $in: ['u1'] } }] }],
      [{ title: 'c', owner: { region: 'NA' } }, { title: 'c', owner: { $in: ['u1'] } }],
      // `$not`: the lowered leaf takes the shared lowering's NULL-safe negation,
      // so a row whose relation is empty satisfies it — the two-step route's reading.
      [{ $not: { owner: { region: 'NA' } } }, { $not: { owner: { $in: ['u1'] } } }],
      [{ $not: { owners: { region: 'NA' } } }, { $not: { $and: [{ $or: [{ owners: { $contains: 'u1' } }] }] } }],
      [[['owner', '=', { region: 'NA' }]], { owner: { $in: ['u1'] } }],
    ];
    for (const [nested, twoStep] of cases) {
      const reference = await twoStepWhereOf(twoStep);
      expect(await outerWhereOf(nested), JSON.stringify(nested)).toEqual(reference);
    }
  });

  it('covers every verb that takes a where — the driver never receives the nested form — and the judge admits it', async () => {
    rec.answers.set(OWNER, idRows('u1'));
    const where = { owner: { region: 'NA' } } as FilterCondition;
    const lowered = { owner: { $in: ['u1'] } };
    for (const [verb, call] of [
      ['find', () => engine.find(OBJECT, { where })],
      ['findOne', () => engine.findOne(OBJECT, { where })],
      ['count', () => engine.count(OBJECT, { where })],
      ['aggregate', () => engine.aggregate(OBJECT, { where, aggregations: [{ function: 'count', alias: 'n' }] } as EngineAggregateOptions)],
    ] as const) {
      rec.reads.length = 0;
      await call();
      const outer = rec.reads.filter((r) => r.object === OBJECT);
      expect(outer.length, verb).toBeGreaterThan(0);
      for (const read of outer) expect(read.ast.where, verb).toEqual(lowered);
    }
    for (const [verb, call] of [
      ['update', () => engine.update(OBJECT, { title: 'x' }, { where, multi: true })],
      ['delete', () => engine.delete(OBJECT, { where, multi: true })],
    ] as const) {
      rec.writes.length = 0;
      await call();
      expect(rec.writes, verb).toHaveLength(1);
      expect(rec.writes[0].ast.where, verb).toEqual(lowered);
    }
    expect(engine.judgeFilter(OBJECT, where)).toEqual({ ok: true });
    expect(engine.judgeFilter(OBJECT, { owners: { region: 'NA' } })).toEqual({ ok: true });
  });

  it('placeholders in the condition resolve against the caller before the related read', async () => {
    rec.answers.set(OWNER, idRows('u9'));
    rec.reads.length = 0;
    await engine.find(OBJECT, { where: { owner: { id: '{current_user_id}' } }, context: { userId: 'u9' } } as EngineQueryOptions);
    const related = rec.reads.find((r) => r.object === OWNER);
    expect(related?.ast.where).toEqual({ id: 'u9' });
  });

  it('the related read runs AS THE CALLER, through the middleware chain, and its refusal is the answer — loudly, no outer read', async () => {
    const seen: Array<{ object: string; operation: string; context: any }> = [];
    engine.registerMiddleware(async (op: any, next: () => Promise<void>) => {
      seen.push({ object: op.object, operation: op.operation, context: op.context });
      if (op.object === OWNER && op.context?.userId === 'u_denied') {
        const denied = new Error(`query on '${OWNER}' references field(s) not readable by the caller: region`) as Error & {
          code?: string; status?: number;
        };
        denied.code = 'PERMISSION_DENIED';
        denied.status = 403;
        throw denied;
      }
      await next();
    });
    rec.answers.set(OWNER, idRows('u1'));

    rec.reads.length = 0;
    await engine.find(OBJECT, { where: { owner: { region: 'NA' } }, context: { userId: 'u_reader' } } as EngineQueryOptions);
    const related = seen.find((s) => s.object === OWNER);
    expect(related?.operation).toBe('find');
    expect(related?.context?.userId).toBe('u_reader');
    expect(related?.context?.isSystem).not.toBe(true);

    rec.reads.length = 0;
    const err = await refusalOf(engine.find(OBJECT, {
      where: { owner: { region: 'NA' } }, context: { userId: 'u_denied' },
    } as EngineQueryOptions));
    expect(envelopeOf(err)).toEqual({ code: 'PERMISSION_DENIED', status: 403 });
    expect(err!.message).toContain('region');
    expect(rec.reads.filter((r) => r.object === OBJECT), 'the outer read never ran').toHaveLength(0);
  });

  // ── the cap ──────────────────────────────────────────────────────────────

  it('the cap: past it the filter is REFUSED with the two-step route, never run over a cut-off list; at it, served whole', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `u${i}` }));
    rec.answers.set(OWNER, many(RELATION_FILTER_ID_CAP + 1));
    rec.reads.length = 0;
    const err = await refusalOf(engine.find(OBJECT, { where: { owner: { region: 'NA' } } }));
    expect(envelopeOf(err)).toEqual(INVALID_FILTER);
    expect(err!.message).toMatch(/^find\('nested_rel_ledger'\): /);
    expect(err!.message).toContain(`matched more than ${RELATION_FILTER_ID_CAP} records of the related object '${OWNER}'`);
    expect(err!.message).toContain('the filter was NOT applied: a cut-off id list would silently drop matching rows');
    expect(err!.message).toContain('{ "owner": { "$in": [ID, …] } }');
    expect(rec.reads.filter((r) => r.object === OBJECT), 'no outer read').toHaveLength(0);

    const multi = await refusalOf(engine.find(OBJECT, { where: { owners: { region: 'NA' } } }));
    expect(envelopeOf(multi)).toEqual(INVALID_FILTER);
    expect(multi!.message).toContain('{ "owners": { "$contains": ID } }');

    rec.answers.set(OWNER, many(RELATION_FILTER_ID_CAP));
    const where = await outerWhereOf({ owner: { region: 'NA' } });
    expect((where as any).owner.$in).toHaveLength(RELATION_FILTER_ID_CAP);
  });

  // ── what the first cut keeps refusing ────────────────────────────────────

  it('keeps refusing, in the engine\'s words and before any read: a second level, a dotted key, an undeclared key, {}, an unregistered related object', async () => {
    const cases: ReadonlyArray<readonly [FilterCondition, string, string]> = [
      [{ parent: { owner: { region: 'NA' } } }, 'where.parent', "'owner' is itself a lookup field of the related object 'nested_rel_ledger'"],
      [{ owner: { account: { title: 'a' } } }, 'where.owner', "'account' is itself a lookup field of the related object 'nested_rel_owner'"],
      [{ owner: { 'account.title': 'a' } }, 'where.owner', "'account.title' is a dotted path: the condition reaches one level only"],
      [{ owner: { regio: 'NA' } }, 'where.owner', "'regio' is not a field of the related object 'nested_rel_owner'"],
      [{ owner: {} }, 'where.owner', 'names no field of the related object'],
      [{ stray: { region: 'NA' } }, 'where.stray', "no object 'nested_rel_missing' is registered here"],
      [{ $or: [{ title: 'a' }, { owner: { regio: 'NA' } }] }, 'where.$or[1].owner', "'regio' is not a field"],
    ];
    for (const [where, path, words] of cases) {
      rec.reads.length = 0;
      const err = await refusalOf(engine.find(OBJECT, { where }));
      expect(envelopeOf(err), JSON.stringify(where)).toEqual(INVALID_FILTER);
      expect(err!.message, JSON.stringify(where)).toContain('puts a nested-relation condition (');
      expect(err!.message, JSON.stringify(where)).toContain(`at ${path}, beneath the declared`);
      expect(err!.message, JSON.stringify(where)).toContain(words);
      expect(err!.message, JSON.stringify(where)).toContain('The filter was NOT applied.');
      expect(rec.reads, JSON.stringify(where)).toHaveLength(0);
      // The judge gives execution's verdict, word for word.
      expect(engine.judgeFilter(OBJECT, where), JSON.stringify(where)).toEqual({ ok: false, ...INVALID_FILTER, message: err!.message });
    }
  });

  it('keeps refusing a json field\'s object comparand and the dotted path — the latter now naming the nested route', async () => {
    const json = await refusalOf(engine.find(OBJECT, { where: { meta: { a: 1 } } }));
    expect(envelopeOf(json)).toEqual(INVALID_FILTER);
    expect(json!.message).toContain('whole-value match');
    const dotted = await refusalOf(engine.find(OBJECT, { where: { 'owner.region': 'NA' } }));
    expect(envelopeOf(dotted)).toEqual({ code: 'INVALID_FIELD', status: 400 });
    expect(dotted!.message).toContain('nest the condition beneath the relation field: { "owner": { "region": VALUE } }');
    expect(rec.reads).toHaveLength(0);
  });

  it('the related object\'s own doors judge the condition\'s comparands, and the judge asks them too', async () => {
    const where = { owner: { score: { $gt: 'abc' } } } as FilterCondition;
    const err = await refusalOf(engine.find(OBJECT, { where }));
    expect(envelopeOf(err)).toEqual(INVALID_FILTER);
    expect(err!.message).toMatch(/^find\('nested_rel_owner'\): filter on 'score'/);
    expect(engine.judgeFilter(OBJECT, where)).toEqual({ ok: false, ...INVALID_FILTER, message: err!.message });
    const json = await refusalOf(engine.find(OBJECT, { where: { owner: { meta: { a: 1 } } } }));
    expect(envelopeOf(json)).toEqual(INVALID_FILTER);
    expect(json!.message).toContain("find('nested_rel_owner'): filter on 'meta'");
  });

  it('an aggregation\'s own filter and having keep the refusal, and say the form is served in where', async () => {
    const perAggregation = await refusalOf(engine.aggregate(OBJECT, {
      aggregations: [{ function: 'count', alias: 'all' }, { function: 'count', alias: 'n', filter: { owner: { region: 'NA' } } }],
    } as EngineAggregateOptions));
    expect(envelopeOf(perAggregation)).toEqual(INVALID_FILTER);
    expect(perAggregation!.message).toContain("the nested-relation form, which the engine serves in 'where' and not in an aggregation's 'filter'");
    expect(perAggregation!.message).toContain('{ "owner": { "$in": [ID, …] } }');
    const multi = await refusalOf(engine.aggregate(OBJECT, {
      aggregations: [{ function: 'count', alias: 'all' }, { function: 'count', alias: 'n', filter: { owners: { region: 'NA' } } }],
    } as EngineAggregateOptions));
    expect(multi!.message).toContain("Put the condition in 'where' instead: here the stored list of ids is compared as one value");
    expect(multi!.message).not.toContain('$contains');
    const having = await refusalOf(engine.aggregate(OBJECT, {
      groupBy: ['owner'], aggregations: [{ function: 'count', alias: 'n' }], having: { owner: { region: 'NA' } },
    } as EngineAggregateOptions));
    expect(envelopeOf(having)).toEqual(INVALID_FILTER);
    expect(having!.message).toContain("which the engine serves in 'where' and not in 'having'");
    expect(rec.reads).toHaveLength(0);
  });

  it('CONTROL a filter with no nested-relation condition reaches the driver by reference and triggers no related read', async () => {
    for (const where of [
      { owner: { $in: ['u1'] } },
      { owners: { $contains: 'u1' } },
      { owner: 'u1', title: 'a' },
      { meta: { $null: false } },
    ] as FilterCondition[]) {
      rec.reads.length = 0;
      await engine.find(OBJECT, { where });
      expect(rec.reads, JSON.stringify(where)).toHaveLength(1);
      expect(rec.reads[0].object).toBe(OBJECT);
      expect(rec.reads[0].ast.where, JSON.stringify(where)).toEqual(where);
    }
  });
});
