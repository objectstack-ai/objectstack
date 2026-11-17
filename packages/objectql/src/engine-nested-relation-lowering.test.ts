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
import { isComposedReadableIds, ReadableIds } from '@objectstack/spec/data';
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
 * are recorded, never applied. It answers to `name` (by default the SQL
 * driver's) and declares `supports` — by default the
 * `DriverCapabilities.readableIdsLeaf` bit the engine plans a semi-join on
 * ([#33876]); a driver without it is refused a single-valued relation
 * condition on a read verb up front.
 */
function makeRecordingDriver(name = 'com.objectstack.driver.sql', supports: Record<string, unknown> = { readableIdsLeaf: true }) {
  const reads: SeenRead[] = [];
  const writes: SeenRead[] = [];
  const answers = new Map<string, Array<Record<string, unknown>>>();
  const rowsOf = (o: string) => answers.get(o) ?? [];
  const driver: any = {
    name, version: '0.0.0', supports,
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

/**
 * `where` with every composed semi-join leaf respelled `{ SEMI_JOIN: object,
 * scope }`, so a driver input can be compared with a literal (the composed
 * leaf itself is branded and cannot be written by hand).
 */
const normalized = (v: any): any => {
  if (isComposedReadableIds(v)) return { SEMI_JOIN: v.object, scope: normalized(v.scope) };
  if (Array.isArray(v)) return v.map(normalized);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normalized(x)]));
  return v;
};

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

  it('every single-valued relation type on a read verb: the related read is PLANNED, never run, and the outer read carries one semi-join leaf scoped by it', async () => {
    for (const [field, , target, condition] of SINGLE) {
      rec.answers.clear();
      rec.answers.set(target, idRows('r1', 'r3'));
      rec.reads.length = 0;
      await engine.find(OBJECT, { where: { [field]: condition } as FilterCondition });
      // One driver call: the outer read. The related read reached its driver
      // call and was planned, so no id list was read.
      expect(rec.reads, field).toHaveLength(1);
      const outer = rec.reads[0];
      expect(outer.object, field).toBe(OBJECT);
      const leaf = outer.ast.where?.[field]?.$in;
      expect(isComposedReadableIds(leaf), field).toBe(true);
      expect(normalized(outer.ast.where), field).toEqual({ [field]: { $in: { SEMI_JOIN: target, scope: condition } } });
    }
  });

  it('[#33626] two and three hops: each hop is the related object\'s own planned read, so each is a semi-join leaf nested in the scope of the one above — one driver call', async () => {
    const owner = (scope: unknown) => ({ SEMI_JOIN: OWNER, scope });
    const ledger = (scope: unknown) => ({ SEMI_JOIN: OBJECT, scope });
    const cases: ReadonlyArray<readonly [FilterCondition, unknown]> = [
      // 2 hops: ledger.owner → owner.account → ledger.title
      [{ owner: { account: { title: 'a' } } }, { owner: { $in: owner({ account: { $in: ledger({ title: 'a' }) } }) } }],
      // 3 hops, a sibling key beside the inner relation at the middle hop
      [
        { owner: { region: 'NA', account: { owner: { region: { $ne: 'EU' } } } } },
        // The innermost `$ne` is the shared lowering's NULL-inclusive form, as on a direct read of the owner.
        { owner: { $in: owner({ region: 'NA', account: { $in: ledger({ owner: { $in: owner({ $and: [{ $or: [{ region: { $null: true } }, { region: { $ne: 'EU' } }] }] }) } }) } }) } },
      ],
      // 3 hops through a tree and a master_detail field
      [
        { parent: { boss: { account: { title: 'z' } } } },
        { parent: { $in: ledger({ boss: { $in: owner({ account: { $in: ledger({ title: 'z' }) } }) } }) } },
      ],
    ];
    for (const [where, expected] of cases) {
      rec.reads.length = 0;
      await engine.find(OBJECT, { where });
      expect(rec.reads, JSON.stringify(where)).toHaveLength(1);
      expect(normalized(rec.reads[0].ast.where), JSON.stringify(where)).toEqual(expected);
      expect(engine.judgeFilter(OBJECT, where), JSON.stringify(where)).toEqual({ ok: true });
    }
  });

  it('[#33626] a multi-valued relation at an inner hop keeps its capped id read there; the hops above stay semi-joins', async () => {
    const OWNER_WITH_MULTI = {
      ...OWNER_OBJECT,
      fields: { ...OWNER_OBJECT.fields, accounts: { name: 'accounts', type: 'lookup', reference: OBJECT, multiple: true } },
    };
    engine.registry.registerObject(OWNER_WITH_MULTI as any, 'test');
    rec.answers.set(OBJECT, idRows('l1'));
    rec.reads.length = 0;
    await engine.find(OBJECT, { where: { owner: { accounts: { title: 'a' } } } });
    // The inner id read (ledger, by title), then the outer read.
    expect(rec.reads.map((r) => r.object)).toEqual([OBJECT, OBJECT]);
    expect(normalized(rec.reads[1].ast.where)).toEqual({
      owner: { $in: { SEMI_JOIN: OWNER, scope: { $and: [{ $or: [{ accounts: { $contains: 'l1' } }] }] } } },
    });
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

  it('no related record matches: an empty subquery / $or [] — FALSE, never an absent predicate', async () => {
    rec.answers.set(OWNER, []);
    // Single-valued: the subquery decides in the database — an empty one is FALSE there.
    expect(normalized(await outerWhereOf({ owner: { region: 'APAC' } }))).toEqual({
      owner: { $in: { SEMI_JOIN: OWNER, scope: { region: 'APAC' } } },
    });
    expect(await outerWhereOf({ owners: { region: 'APAC' } })).toEqual({ $and: [{ $or: [] }] });
  });

  it('composes as written inside $and / $or / $not, and the FilterArray sugar alike', async () => {
    rec.answers.set(OWNER, idRows('u1'));
    const NA = { SEMI_JOIN: OWNER, scope: { region: 'NA' } };
    const cases: ReadonlyArray<readonly [unknown, unknown]> = [
      [{ $or: [{ owner: { region: 'NA' } }, { title: 'a' }] }, { $or: [{ owner: { $in: NA } }, { title: 'a' }] }],
      [{ $and: [{ title: 'c' }, { boss: { region: 'NA' } }] }, { $and: [{ title: 'c' }, { boss: { $in: NA } }] }],
      [{ title: 'c', owner: { region: 'NA' } }, { title: 'c', owner: { $in: NA } }],
      [[['owner', '=', { region: 'NA' }]], { owner: { $in: NA } }],
    ];
    for (const [nested, expected] of cases) {
      expect(normalized(await outerWhereOf(nested)), JSON.stringify(nested)).toEqual(expected);
    }
    // `$not` over a single-valued relation: the shared lowering's NULL-safe
    // negation applies to the semi-join leaf exactly as it does to a list —
    // the same driver input as the hand-written `$not` over a ReadableIds leaf.
    const negated = normalized(await outerWhereOf({ $not: { owner: { region: 'NA' } } }));
    expect(JSON.stringify(negated)).toContain('"SEMI_JOIN":"nested_rel_owner"');
    // A multi-valued relation keeps the id route.
    const reference = await twoStepWhereOf({ $not: { $and: [{ $or: [{ owners: { $contains: 'u1' } }] }] } });
    expect(await outerWhereOf({ $not: { owners: { region: 'NA' } } })).toEqual(reference);
  });

  it('covers every verb that takes a where — the driver never receives the nested form — and the judge admits it', async () => {
    rec.answers.set(OWNER, idRows('u1'));
    const where = { owner: { region: 'NA' } } as FilterCondition;
    // Read verbs: the semi-join leaf. Write verbs (`update`, `delete`) keep
    // the id read — their `where` never reaches the executor boundary that
    // composes the leaf.
    const semiJoin = { owner: { $in: { SEMI_JOIN: OWNER, scope: { region: 'NA' } } } };
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
      for (const read of outer) expect(normalized(read.ast.where), verb).toEqual(semiJoin);
    }
    rec.writes.length = 0;
    await engine.update(OBJECT, { title: 'x' }, { where, multi: true });
    expect(rec.writes, 'update').toHaveLength(1);
    expect(rec.writes[0].ast.where, 'update').toEqual(lowered);
    // [#26871] Relations point at this ledger (the owner's `account`, its own
    // `parent` tree), so a predicate delete first reads the rows it will walk
    // and then deletes those rows by id. The predicate reaches the driver on
    // that read, lowered; nothing matches here, so nothing is written.
    rec.reads.length = 0;
    rec.writes.length = 0;
    await engine.delete(OBJECT, { where, multi: true });
    const resolution = rec.reads.filter((r) => r.object === OBJECT && Array.isArray(r.ast?.fields) && r.ast.fields.includes('id'));
    expect(resolution, 'delete').toHaveLength(1);
    expect(resolution[0].ast.where, 'delete').toEqual(lowered);
    expect(rec.writes, 'delete').toHaveLength(0);
    expect(engine.judgeFilter(OBJECT, where)).toEqual({ ok: true });
    expect(engine.judgeFilter(OBJECT, { owners: { region: 'NA' } })).toEqual({ ok: true });
  });

  it('placeholders in the condition resolve against the caller before the related read is planned', async () => {
    rec.answers.set(OWNER, idRows('u9'));
    rec.reads.length = 0;
    await engine.find(OBJECT, { where: { owner: { id: '{current_user_id}' } }, context: { userId: 'u9' } } as EngineQueryOptions);
    expect(rec.reads.find((r) => r.object === OWNER), 'no related read ran').toBeUndefined();
    expect(normalized(rec.reads[0]?.ast.where)).toEqual({ owner: { $in: { SEMI_JOIN: OWNER, scope: { id: 'u9' } } } });
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

  it('the cap: a single-valued relation on a read verb has none (the semi-join reads no id list); a multi-valued one and a write verb are REFUSED past it, never run over a cut-off list', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `u${i}` }));
    rec.answers.set(OWNER, many(RELATION_FILTER_ID_CAP + 1));
    expect(normalized(await outerWhereOf({ owner: { region: 'NA' } }))).toEqual({
      owner: { $in: { SEMI_JOIN: OWNER, scope: { region: 'NA' } } },
    });

    rec.reads.length = 0;
    const multi = await refusalOf(engine.find(OBJECT, { where: { owners: { region: 'NA' } } }));
    expect(envelopeOf(multi)).toEqual(INVALID_FILTER);
    expect(multi!.message).toMatch(/^find\('nested_rel_ledger'\): /);
    expect(multi!.message).toContain(`matched more than ${RELATION_FILTER_ID_CAP} records of the related object '${OWNER}'`);
    expect(multi!.message).toContain('{ "owners": { "$contains": ID } }');
    expect(rec.reads.filter((r) => r.object === OBJECT), 'no outer read').toHaveLength(0);

    const write = await refusalOf(engine.update(OBJECT, { title: 'x' }, { where: { owner: { region: 'NA' } }, multi: true }));
    expect(envelopeOf(write)).toEqual(INVALID_FILTER);
    expect(write!.message).toContain('{ "owner": { "$in": [ID, …] } }');
  });

  // ── what the first cut keeps refusing ────────────────────────────────────

  it('keeps refusing, in the engine\'s words and before any read: a fourth hop, a dotted key, an undeclared key at any hop, {}, an unregistered related object', async () => {
    const cases: ReadonlyArray<readonly [FilterCondition, string, string]> = [
      [{ owner: { account: { owner: { account: { title: 'a' } } } } }, 'where.owner.account.owner', "'account' holds a condition of its own past the 3-relationship limit"],
      [{ parent: { parent: { owner: { account: { title: 'a' } } } } }, 'where.parent.parent.owner', "'account' is itself a lookup field of the related object 'nested_rel_owner'"],
      [{ owner: { account: { titel: 'a' } } }, 'where.owner.account', "'titel' is not a field of the related object 'nested_rel_ledger'"],
      [{ owner: { 'account.title': 'a' } }, 'where.owner', "'account.title' is a dotted path: nest each relation instead"],
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
      expect(err!.message, JSON.stringify(where)).toMatch(new RegExp(`at ${path.replace(/[$[\]().]/g, '\\$&')}, beneath the (lookup|tree) field, and `));
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
    // [#27337] The verdict says where the form is served; the reasoning after
    // "NOT applied" names the position that does not serve it.
    expect(perAggregation!.message).toContain("the nested-relation form, which the engine serves in 'where' only.");
    expect(perAggregation!.message).toContain("The engine evaluates an aggregation's 'filter' itself");
    expect(perAggregation!.message).toContain('{ "owner": { "$in": [ID, …] } }');
    const multi = await refusalOf(engine.aggregate(OBJECT, {
      aggregations: [{ function: 'count', alias: 'all' }, { function: 'count', alias: 'n', filter: { owners: { region: 'NA' } } }],
    } as EngineAggregateOptions));
    expect(multi!.message).toContain("Move the condition to 'where': here the stored list of ids is compared as one value");
    expect(multi!.message).not.toContain('$contains');
    const having = await refusalOf(engine.aggregate(OBJECT, {
      groupBy: ['owner'], aggregations: [{ function: 'count', alias: 'n' }], having: { owner: { region: 'NA' } },
    } as EngineAggregateOptions));
    expect(envelopeOf(having)).toEqual(INVALID_FILTER);
    expect(having!.message).toContain("which the engine serves in 'where' only.");
    expect(having!.message).toContain("The engine evaluates 'having' itself");
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

/**
 * The semi-join is taken ONLY where it is provably the same read as the id
 * read (`relation-semi-join.ts`); every other case keeps that id read — the
 * related object read as the caller, `id` only, one row past the cap, then
 * `$in` — exactly as before the semi-join existed. Each case below asserts
 * the related read RAN (it is in the driver's reads) and the outer read
 * carries the id list, never a composed leaf, and is served, never refused.
 */
describe('[#33626] the semi-join falls back to the id read wherever it is not provably that read', () => {
  const OUTER_REF = { owner: { $in: ['u1'] } };

  async function makeEngine(driverName?: string, supports?: Record<string, unknown>) {
    const rec = makeRecordingDriver(driverName, supports);
    const engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(OWNER_OBJECT as any, 'test');
    engine.registry.registerObject(LEDGER as any, 'test');
    return { engine, rec };
  }

  /** The related read and the outer read the driver saw for `{ owner: { region: 'NA' } }`. */
  async function readsOf(engine: ObjectQL, rec: ReturnType<typeof makeRecordingDriver>, context?: any) {
    rec.reads.length = 0;
    await engine.find(OBJECT, { where: { owner: { region: 'NA' } }, ...(context ? { context } : {}) } as EngineQueryOptions);
    const related = rec.reads.filter((r) => r.object === OWNER);
    const outer = rec.reads.filter((r) => r.object === OBJECT);
    return { related, outerWhere: outer[outer.length - 1]?.ast?.where };
  }

  function expectIdRead(r: { related: SeenRead[]; outerWhere: unknown }, ids: unknown[], name: string) {
    expect(r.related, name).toHaveLength(1);
    expect(r.related[0].ast.where, name).toEqual({ region: 'NA' });
    expect(r.related[0].ast.limit, name).toBe(RELATION_FILTER_ID_CAP + 1);
    expect(normalized(r.outerWhere), name).toEqual({ owner: { $in: ids } });
  }

  // [#33876, the maintainer's ruling A on #33626's Q2] The bit decides, not
  // the name: a driver without `readableIdsLeaf` (MongoDB, OData, any driver
  // that declares nothing) is REFUSED the condition before any related read is
  // planned or run — no id read, no driver call — and the refusal names the
  // driver. Every read verb; a multi-valued relation and a write verb keep the
  // capped id read there.
  it('[#33876] a driver without the readableIdsLeaf bit (MongoDB, OData, an undeclared driver) is refused up front: INVALID_FILTER / 400, nothing read', async () => {
    for (const name of ['com.objectstack.driver.mongodb', 'com.objectstack.driver.odata', 'recording', 'com.objectstack.driver.sql']) {
      for (const supports of [{}, { readableIdsLeaf: false }, { readableIdsLeaf: 'true' }]) {
        const label = `${name} ${JSON.stringify(supports)}`;
        const { engine, rec } = await makeEngine(name, supports);
        rec.answers.set(OWNER, idRows('u1'));
        const where = { owner: { region: 'NA' } };
        const verbs: Array<[string, () => Promise<unknown>]> = [
          ['find', () => engine.find(OBJECT, { where })],
          ['findOne', () => engine.findOne(OBJECT, { where })],
          ['count', () => engine.count(OBJECT, { where })],
          ['aggregate', () => engine.aggregate(OBJECT, { where, aggregations: [{ function: 'count', alias: 'n' }] } as EngineAggregateOptions)],
        ];
        for (const [verb, run] of verbs) {
          rec.reads.length = 0;
          const err = await refusalOf(run());
          expect(envelopeOf(err), `${label} ${verb}`).toEqual(INVALID_FILTER);
          expect(err?.message, `${label} ${verb}`).toContain(`'${name}'`);
          expect(rec.reads, `${label} ${verb}: nothing read`).toEqual([]);
        }
        // Inside $or / $not alike — every site is judged before anything is read.
        rec.reads.length = 0;
        expect(envelopeOf(await refusalOf(engine.find(OBJECT, { where: { $or: [{ title: 'a' }, { $not: where }] } }))), label).toEqual(INVALID_FILTER);
        expect(rec.reads, label).toEqual([]);
        // A multi-valued relation keeps the capped id read on that driver…
        rec.reads.length = 0;
        await engine.find(OBJECT, { where: { owners: { region: 'NA' } } });
        expect(rec.reads.filter((r) => r.object === OWNER), label).toHaveLength(1);
        // …and so does a write verb's `where`.
        rec.writes.length = 0;
        await engine.update(OBJECT, { title: 'b' }, { where, multi: true });
        expect(normalized(rec.writes[rec.writes.length - 1]?.ast?.where), label).toEqual({ owner: { $in: ['u1'] } });
      }
    }
  });

  it('[#33876] CONTROL the bit decides, not the name: a driver named MongoDB that declares readableIdsLeaf plans the semi-join', async () => {
    const { engine, rec } = await makeEngine('com.objectstack.driver.mongodb', { readableIdsLeaf: true });
    rec.answers.set(OWNER, idRows('u1'));
    const r = await readsOf(engine, rec);
    expect(r.related).toHaveLength(0);
    expect(normalized(r.outerWhere)).toEqual({ owner: { $in: { SEMI_JOIN: OWNER, scope: { region: 'NA' } } } });
  });

  it('[#33876] the filter judge answers the same up-front refusal as execution, from the declared bit, and reads nothing', async () => {
    const where = { owner: { region: 'NA' } };
    for (const name of ['com.objectstack.driver.mongodb', 'com.objectstack.driver.odata']) {
      const { engine, rec } = await makeEngine(name, {});
      rec.answers.set(OWNER, idRows('u1'));
      for (const verb of ['find', 'findOne', 'count', 'aggregate'] as const) {
        const run = verb === 'aggregate'
          ? () => engine.aggregate(OBJECT, { where, aggregations: [{ function: 'count', alias: 'n' }] } as EngineAggregateOptions)
          : () => engine[verb](OBJECT, { where });
        const err = await refusalOf(run());
        rec.reads.length = 0;
        expect(engine.judgeFilter(OBJECT, where, { operation: verb }), `${name} ${verb}`).toEqual({ ok: false, ...INVALID_FILTER, message: err!.message });
        // …under $or / $not too, at the depth execution judges it.
        const nested = { $or: [{ title: 'a' }, { $not: where }] };
        const nestedErr = await refusalOf(engine.find(OBJECT, { where: nested }));
        expect(engine.judgeFilter(OBJECT, nested), `${name} nested`).toEqual({ ok: false, ...INVALID_FILTER, message: nestedErr!.message });
        expect(rec.reads, `${name} ${verb}: the judge reads nothing`).toEqual([]);
      }
      // What execution serves on that driver, the judge admits: a multi-valued relation and a write verb's `where`.
      expect(engine.judgeFilter(OBJECT, { owners: { region: 'NA' } }), name).toEqual({ ok: true });
      expect(engine.judgeFilter(OBJECT, where, { operation: 'update' }), name).toEqual({ ok: true });
    }
    // CONTROL: a driver that declares the bit is admitted.
    const { engine } = await makeEngine('com.objectstack.driver.mongodb', { readableIdsLeaf: true });
    expect(engine.judgeFilter(OBJECT, where, { operation: 'aggregate' })).toEqual({ ok: true });
    // CONTROL: an engine that routes the object to no driver (the authoring-time judge) does not judge it.
    const authoring = new ObjectQL();
    authoring.registry.registerObject(OWNER_OBJECT as any, 'test');
    authoring.registry.registerObject(LEDGER as any, 'test');
    expect(authoring.judgeFilter(OBJECT, where)).toEqual({ ok: true });
  });

  it('CONTROL a compiling driver plans the read: no id read, one composed leaf', async () => {
    const { engine, rec } = await makeEngine();
    rec.answers.set(OWNER, idRows('u1'));
    const r = await readsOf(engine, rec);
    expect(r.related).toHaveLength(0);
    expect(normalized(r.outerWhere)).toEqual({ owner: { $in: { SEMI_JOIN: OWNER, scope: { region: 'NA' } } } });
  });

  it('a related object an object-keyed middleware narrows keeps the id read — that middleware runs on it, and the read is served', async () => {
    const { engine, rec } = await makeEngine();
    rec.answers.set(OWNER, idRows('u1', 'u2'));
    // Narrows AFTER the driver call: no planned `where` could carry it.
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      await next();
      if (Array.isArray(opCtx.result)) opCtx.result = opCtx.result.filter((row: any) => row.id === 'u1');
    }, { object: OWNER });
    expectIdRead(await readsOf(engine, rec), ['u1'], 'object-keyed middleware');
  });

  it('a read rule the related object applies after its driver call (an afterFind hook) gives the id read\'s answer', async () => {
    const { engine, rec } = await makeEngine();
    rec.answers.set(OWNER, idRows('u1', 'u2'));
    engine.registerHook('afterFind', async (ctx: any) => {
      ctx.result = (ctx.result as any[]).filter((row) => row.id === 'u1');
    }, { object: OWNER });
    expectIdRead(await readsOf(engine, rec), ['u1'], 'afterFind');
    // The same answer as the hand-written two-step route over those ids.
    expect(normalized((await readsOf(engine, rec)).outerWhere)).toEqual(OUTER_REF);
  });

  it('a global middleware that answers the related read without its driver, or adds rows after it, keeps the id read; one that reshapes the rows does not', async () => {
    {
      // CONTROL the field mask's shape: every row mapped to a copy — no id changes, the read is still planned.
      const { engine, rec } = await makeEngine();
      engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
        await next();
        if (Array.isArray(opCtx.result)) opCtx.result = opCtx.result.map((row: any) => ({ ...row }));
      });
      const r = await readsOf(engine, rec);
      expect(r.related).toHaveLength(0);
      expect(normalized(r.outerWhere)).toEqual({ owner: { $in: { SEMI_JOIN: OWNER, scope: { region: 'NA' } } } });
    }
    for (const mode of ['short-circuit', 'replace'] as const) {
      const { engine, rec } = await makeEngine();
      rec.answers.set(OWNER, idRows('u2'));
      engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
        if (opCtx.object !== OWNER) return next();
        if (mode === 'short-circuit') { opCtx.result = [{ id: 'u9' }]; return; }
        await next();
        opCtx.result = [...(opCtx.result as any[]), { id: 'u9' }];
      });
      const r = await readsOf(engine, rec);
      const related = rec.reads.filter((x) => x.object === OWNER);
      expect(related, mode).toHaveLength(mode === 'short-circuit' ? 0 : 1);
      expect(normalized(r.outerWhere), mode).toEqual({ owner: { $in: mode === 'short-circuit' ? ['u9'] : ['u2', 'u9'] } });
    }
  });

  it('a related object on another datasource keeps the id read on its own driver — served, no 400', async () => {
    const rec = makeRecordingDriver();
    const far = makeRecordingDriver('far');
    const engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    engine.registerDriver(far.driver);
    await engine.init();
    engine.registry.registerObject({ ...OWNER_OBJECT, datasource: 'far' } as any, 'test');
    engine.registry.registerObject(LEDGER as any, 'test');
    far.answers.set(OWNER, idRows('u1'));
    rec.reads.length = 0;
    await engine.find(OBJECT, { where: { owner: { region: 'NA' } } });
    expect(far.reads.map((r) => [r.object, r.ast.where, r.ast.limit])).toEqual([[OWNER, { region: 'NA' }, RELATION_FILTER_ID_CAP + 1]]);
    expect(normalized(rec.reads[rec.reads.length - 1].ast.where)).toEqual(OUTER_REF);
  });

  it('a federated related object keeps the id read, decided before planning: the related read is dispatched once', async () => {
    const { engine, rec } = await makeEngine();
    // ADR-0015 `external`, on the read's own datasource and driver.
    engine.registry.registerObject({ ...OWNER_OBJECT, external: { remoteName: 'owners' } } as any, 'test');
    const dispatched = countRelatedDispatch(engine);
    rec.answers.set(OWNER, idRows('u1'));
    expectIdRead(await readsOf(engine, rec), ['u1'], 'federated related object');
    expect(dispatched).toEqual({ middleware: 1, beforeFind: 1 });
  });

  /**
   * Counts the related object's dispatches: a GLOBAL middleware (an
   * object-keyed one would itself keep the id read) and a `beforeFind` hook,
   * each counting only the related object's reads.
   */
  function countRelatedDispatch(engine: ObjectQL) {
    const n = { middleware: 0, beforeFind: 0 };
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (opCtx.object === OWNER && opCtx.operation === 'find') n.middleware += 1;
      return next();
    });
    engine.registerHook('beforeFind', async () => { n.beforeFind += 1; }, { object: OWNER });
    return n;
  }

  /** Records the `tenantId` each driver read was handed. */
  function recordTenantIds(rec: ReturnType<typeof makeRecordingDriver>) {
    const seen: Array<{ object: string; tenantId: unknown }> = [];
    const find = rec.driver.find;
    rec.driver.find = async (o: string, ast: any, options: any) => { seen.push({ object: o, tenantId: options?.tenantId }); return find.call(rec.driver, o, ast); };
    return seen;
  }

  for (const [direction, ledger, owner, expected] of [
    // The ledger is no tenant's; the owner is tenant-scoped. Under a wall the
    // owner's read carries `tenantId`, the ledger's does not.
    ['the read\'s object is platform-global, the related object tenant-scoped', { ...LEDGER, tenancy: { enabled: false } }, OWNER_OBJECT,
      [{ object: OWNER, tenantId: 'org_b' }, { object: OBJECT, tenantId: undefined }]],
    // The opposite: the ledger is tenant-scoped, the owner platform-global.
    ['the read\'s object is tenant-scoped, the related object platform-global', LEDGER, { ...OWNER_OBJECT, tenancy: { enabled: false } },
      [{ object: OWNER, tenantId: undefined }, { object: OBJECT, tenantId: 'org_b' }]],
  ] as const) {
    it(`another tenancy class under a walled posture (${direction}): driver options differ → id read, decided before planning — the related read is dispatched once`, async () => {
      const { engine, rec } = await makeEngine();
      engine.registry.registerObject(ledger as any, 'test');
      engine.registry.registerObject(owner as any, 'test');
      engine.setTenancyPostureProvider(() => 'isolated');
      const seen = recordTenantIds(rec);
      const dispatched = countRelatedDispatch(engine);
      rec.answers.set(OWNER, idRows('u1'));
      const r = await readsOf(engine, rec, { userId: 'u_b', tenantId: 'org_b' });
      expectIdRead(r, ['u1'], direction);
      expect(seen, direction).toEqual(expected);
      expect(dispatched, direction).toEqual({ middleware: 1, beforeFind: 1 });
    });
  }

  it('CONTROL a planned hop dispatches the related read once, and the driver is never asked', async () => {
    const { engine, rec } = await makeEngine();
    const dispatched = countRelatedDispatch(engine);
    const r = await readsOf(engine, rec);
    expect(r.related).toHaveLength(0);
    expect(dispatched).toEqual({ middleware: 1, beforeFind: 1 });
  });

  it('driver options that differ only by a per-object verdict the request records: the ids are read at the executor boundary — a fallback after planning, which dispatches the related read twice', async () => {
    const { engine, rec } = await makeEngine();
    engine.setTenancyPostureProvider(() => 'isolated');
    // Both objects tenant-scoped (the registry cannot tell them apart); the
    // recorded verdict lifts the scope on the ledger's read only.
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      opCtx.tenantLayer0Verdict = opCtx.object === OBJECT ? { kind: 'none' } : { kind: 'organization', organizationId: 'org_b' };
      return next();
    });
    const seen = recordTenantIds(rec);
    const dispatched = countRelatedDispatch(engine);
    rec.answers.set(OWNER, idRows('u1'));
    const r = await readsOf(engine, rec, { userId: 'u_b', tenantId: 'org_b' });
    expectIdRead(r, ['u1'], 'boundary fallback');
    expect(seen).toEqual([{ object: OWNER, tenantId: 'org_b' }, { object: OBJECT, tenantId: undefined }]);
    expect(dispatched).toEqual({ middleware: 2, beforeFind: 2 });
  });

  it('a related read a middleware answers itself falls back after planning, which dispatches the related read twice', async () => {
    const { engine, rec } = await makeEngine();
    const dispatched = countRelatedDispatch(engine);
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (opCtx.object !== OWNER) return next();
      opCtx.result = [{ id: 'u9' }];
    });
    const r = await readsOf(engine, rec);
    expect(normalized(r.outerWhere)).toEqual({ owner: { $in: ['u9'] } });
    // The answering middleware stops both dispatches before `beforeFind`.
    expect(dispatched).toEqual({ middleware: 2, beforeFind: 0 });
  });

  it('CONTROL without a wall (the single posture) two tenancy classes read under the same options, and the leaf is composed', async () => {
    const { engine, rec } = await makeEngine();
    engine.registry.registerObject({ ...LEDGER, tenancy: { enabled: false } } as any, 'test');
    engine.setTenancyPostureProvider(() => 'single');
    const dispatched = countRelatedDispatch(engine);
    const r = await readsOf(engine, rec, { userId: 'u_b', tenantId: 'org_b' });
    expect(r.related).toHaveLength(0);
    expect(normalized(r.outerWhere)).toEqual({ owner: { $in: { SEMI_JOIN: OWNER, scope: { region: 'NA' } } } });
    expect(dispatched).toEqual({ middleware: 1, beforeFind: 1 });
  });

  it('a read whose leaves are all planned does not report, nor spend, the once-only "no usable security service" warning', async () => {
    const { engine, rec } = await makeEngine();
    const warned: string[] = [];
    const logger = (engine as any).logger;
    const warn = logger.warn.bind(logger);
    logger.warn = (msg: unknown, ...rest: unknown[]) => { warned.push(String(msg)); return warn(msg, ...rest); };
    const noService = (w: string[]) => w.filter((m) => m.includes('no usable "security" service'));
    await readsOf(engine, rec);
    expect(noService(warned)).toEqual([]);
    // CONTROL an ordinary ADR-0139 leaf asks the service, and so reports its absence — once.
    await engine.find(OBJECT, { where: { owner: { $in: ReadableIds.of(OWNER) } } });
    await engine.find(OBJECT, { where: { owner: { $in: ReadableIds.of(OWNER) } } });
    expect(noService(warned)).toHaveLength(1);
  });

  it('CONTROL the same wall on both objects: the options are the related read\'s own, and the leaf is composed', async () => {
    const { engine, rec } = await makeEngine();
    engine.setTenancyPostureProvider(() => 'isolated');
    rec.answers.set(OWNER, idRows('u1'));
    const r = await readsOf(engine, rec, { userId: 'u_b', tenantId: 'org_b' });
    expect(r.related).toHaveLength(0);
    expect(JSON.stringify(normalized(r.outerWhere))).toContain(`"SEMI_JOIN":"${OWNER}"`);
  });
});
