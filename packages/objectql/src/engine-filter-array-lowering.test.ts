// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5158 — Door 2 lowers `FilterArray` before any driver sees it.
 *
 * `FilterArray` (`['stage','=','won']`, `['and', […], […]]`, `[[…], […]]`) is
 * INPUT-ONLY authoring sugar. The spec says so since #5285
 * (`data/filter.zod.ts`, pinned by `filter-array-declaration.test.ts`): it is
 * declared, and `QuerySchema.where` deliberately excludes it.
 *
 * Two doors led into the runtime and only one read the contract that way. The
 * protocol face (Door 1, `metadata-protocol/protocol.ts`) has always run
 * `isFilterAST` → `parseFilterAST` and answered `400 INVALID_FILTER` for an
 * array it could not lower. A direct engine call (Door 2) passed the array
 * through verbatim, so four drivers grew a SECOND filter compiler to meet it —
 * including an infix dialect (`[condA, 'or', condB]`) the spec never declared
 * and `parseFilterAST` cannot express, which cloud's
 * `RemoteTransport.buildWhereSQL` refuses outright. Same query, two answers,
 * decided by whether the caller went over the wire.
 *
 * Maintainer ruling C on #5158 closed Door 2 onto Door 1's sink. These tests
 * assert on the AST the DRIVER RECEIVES, not on the returned rows: identical
 * rows are the whole point of the change, so a row assertion cannot tell a
 * lowered filter from an unlowered one. That distinction is what makes the
 * driver-side dialect deletion in this same PR safe.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type {
  EngineAggregateOptions,
  EngineCountOptions,
  EngineQueryOptions,
} from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

/**
 * [#4918] `FilterArray` on `where` is off-contract BY DECLARATION, and these
 * tests exist to drive it: `EngineQueryOptions.where` is a `FilterCondition` /
 * `Record< string, unknown >`, which an array is not assignable to, because
 * `FilterArray` is INPUT-ONLY authoring sugar the spec deliberately excludes
 * (#5285). So a test that hands the engine one has to say so, and
 * `as unknown as EngineQueryOptions` is how: it names the contract being
 * bypassed, keeps the rest of the call type-checked, and greps as an
 * intentional act — none of which a bare `as any` does. (#6300 flipped the
 * find/findOne parameter from `EngineQueryOptionsParsed` to the author-state
 * `EngineQueryOptions`; the cast target follows the contract it names.)
 *
 * Deliberately NOT used for the malformed-COMPARAND cases below
 * (`{ stage: { $nin: 'won' } }`). Those are ordinary objects that `tsc`
 * accepts, because `where` is declared loosely on purpose — which is the whole
 * reason the runtime gate this file pins has to exist. Erasing them would hide
 * that they are type-legal, which is the point.
 */
const asFilterArrayQuery = (where: unknown): EngineQueryOptions =>
  ({ where }) as unknown as EngineQueryOptions;

const deal = {
  name: 'deal',
  label: 'Deal',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    stage: { name: 'stage', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    owner_id: { name: 'owner_id', type: 'text' as const },
  },
};

interface SeenRead { ast: any }

/**
 * Minimal driver that records every AST it is handed and executes only the
 * `FilterCondition` object form — deliberately. A driver that also understood
 * the array form could not witness the lowering, which is the bug this file
 * pins: the four in-repo drivers understood BOTH, so nothing downstream ever
 * had to notice which one it got.
 */
function makeRecordingDriver() {
  const rows = new Map<string, Record<string, unknown>>();
  const reads: SeenRead[] = [];
  const writes: SeenRead[] = [];
  const matches = (row: any, where: any): boolean => {
    if (where == null) return true;
    if (Array.isArray(where) || typeof where !== 'object') {
      throw new Error(
        `driver received a non-object 'where' (${JSON.stringify(where)}) — the engine must ` +
        'lower FilterArray before the driver (#5158)',
      );
    }
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and') { if (!(v as any[]).every((w) => matches(row, w))) return false; continue; }
      if (k === '$or') { if (!(v as any[]).some((w) => matches(row, w))) return false; continue; }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const ops = v as Record<string, unknown>;
        if ('$gt' in ops && !((row[k] as any) > (ops.$gt as any))) return false;
        if ('$gte' in ops && !((row[k] as any) >= (ops.$gte as any))) return false;
        if ('$lt' in ops && !((row[k] as any) < (ops.$lt as any))) return false;
        if ('$lte' in ops && !((row[k] as any) <= (ops.$lte as any))) return false;
        if ('$ne' in ops && row[k] === ops.$ne) return false;
        if ('$in' in ops && !(ops.$in as unknown[]).includes(row[k])) return false;
        if ('$null' in ops && (row[k] == null) !== ops.$null) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };
  const run = (ast: any) => {
    const out = [...rows.values()].filter((r) => matches(r, ast?.where));
    return typeof ast?.limit === 'number' && ast.limit > 0 ? out.slice(0, ast.limit) : out;
  };
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string, ast: any) { reads.push({ ast }); return run(ast); },
    async findOne(_o: string, ast: any) { reads.push({ ast }); return run(ast)[0] ?? null; },
    async count(_o: string, ast: any) { reads.push({ ast }); return run(ast).length; },
    async aggregate(_o: string, ast: any) { reads.push({ ast }); return run(ast); },
    async create(_o: string, data: Record<string, unknown>) {
      const id = (data.id as string) ?? `r_${rows.size + 1}`;
      const row = { ...data, id }; rows.set(id, row); return row;
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      const cur = rows.get(id); if (!cur) throw new Error(`nf ${id}`);
      const up = { ...cur, ...data, id }; rows.set(id, up); return up;
    },
    async updateMany(_o: string, ast: any, data: Record<string, unknown>) {
      writes.push({ ast });
      const hit = run(ast);
      for (const r of hit) rows.set(r.id as string, { ...r, ...data });
      return hit.length;
    },
    async delete(_o: string, id: string) { return rows.delete(id); },
    async deleteMany(_o: string, ast: any) {
      writes.push({ ast });
      const hit = run(ast);
      for (const r of hit) rows.delete(r.id as string);
      return hit.length;
    },
    async bulkCreate(o: string, batch: Record<string, unknown>[]) {
      return Promise.all(batch.map((r) => this.create(o, r)));
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, reads, writes };
}

describe('Door 2 lowers FilterArray to FilterCondition before the driver (#5158)', () => {
  let engine: ObjectQL;
  let reads: SeenRead[];
  let writes: SeenRead[];

  beforeEach(async () => {
    const rec = makeRecordingDriver();
    reads = rec.reads;
    writes = rec.writes;
    engine = new ObjectQL();
    engine.registerDriver(rec.driver, true);
    await engine.init();
    engine.registry.registerObject(deal);
    await engine.insert('deal', { id: 'd1', stage: 'won', amount: 10, owner_id: 'u1' });
    await engine.insert('deal', { id: 'd2', stage: 'lost', amount: 20, owner_id: 'u2' });
    await engine.insert('deal', { id: 'd3', stage: 'won', amount: 30, owner_id: 'u1' });
    reads.length = 0;
    writes.length = 0;
  });

  const lastWhere = () => reads[reads.length - 1]?.ast?.where;

  // ── the load-bearing assertion: the DRIVER's input, not the rows ──────

  it('find([[field, op, value]]) reaches the driver as a FilterCondition, not an array', async () => {
    const rows = await engine.find('deal', { where: [['stage', '=', 'won']] } as any);

    expect(Array.isArray(lastWhere())).toBe(false);
    expect(lastWhere()).toEqual({ stage: 'won' });
    expect(rows.map((r: any) => r.id).sort()).toEqual(['d1', 'd3']);
  });

  it('produces the identical driver AST as the hand-written FilterCondition', async () => {
    await engine.find('deal', { where: [['stage', '=', 'won']] } as any);
    const lowered = lastWhere();
    await engine.find('deal', { where: { stage: 'won' } } as any);
    expect(lowered).toEqual(lastWhere());
  });

  it.each([
    ['bare comparison tuple', ['stage', '=', 'won'], { stage: 'won' }],
    ['nested single condition', [['stage', '=', 'won']], { stage: 'won' }],
    ['prefix AND group', ['and', ['stage', '=', 'won'], ['amount', '>', 20]],
      { $and: [{ stage: 'won' }, { amount: { $gt: 20 } }] }],
    ['prefix OR group', ['or', ['stage', '=', 'won'], ['stage', '=', 'lost']],
      { $or: [{ stage: 'won' }, { stage: 'lost' }] }],
    ['bare list, implicit AND', [['stage', '=', 'won'], ['amount', '>', 20]],
      { $and: [{ stage: 'won' }, { amount: { $gt: 20 } }] }],
    ['operator alias (starts_with)', ['stage', 'starts_with', 'w'], { stage: { $startsWith: 'w' } }],
    ['null predicate, short form', ['owner_id', 'is_null'], { owner_id: { $null: true } }],
  ])('lowers %s', async (_label, where, expected) => {
    await engine.find('deal', { where } as any);
    expect(lastWhere()).toEqual(expected);
  });

  // ── the authoring surfaces ruling C promised would not regress ────────

  it('every shape @objectstack/client FilterBuilder emits still reaches the driver lowered', async () => {
    // Literal transcription of `FilterBuilder` output (`packages/client/src/
    // query-builder.ts`) — `build()` returns the single condition, or
    // `['and', ...conditions]`; `between()` nests a prefix group. Transcribed
    // rather than imported: objectql must not depend on the SDK, and the point
    // is the SHAPES, which this file pins verbatim.
    const builderOutputs: Array<[string, unknown]> = [
      ['equals()', ['stage', '=', 'won']],
      ['in()', ['stage', 'in', ['won', 'lost']]],
      ['contains()', ['stage', 'like', '%wo%']],
      ['isNotNull()', ['owner_id', 'is_not_null', null]],
      ['between()', ['and', ['amount', '>=', 10], ['amount', '<=', 30]]],
      ['build() with 2+ conditions', ['and', ['stage', '=', 'won'], ['amount', '>', 5]]],
      ['getConditions() list', [['stage', '=', 'won'], ['amount', '>', 5]]],
    ];
    for (const [label, where] of builderOutputs) {
      await engine.find('deal', { where } as any);
      expect(Array.isArray(lastWhere()), label).toBe(false);
      expect(lastWhere(), label).toBeTypeOf('object');
    }
  });

  it('the `{current_user_id}` token still resolves — lowering runs BEFORE token expansion', async () => {
    // The shape `examples/app-showcase/src/ui/pages/my-work.page.ts` authorises
    // (`filters: [['owner_id','=','{current_user_id}']]`). Token resolution
    // reads `where` as an object, so lowering first is what lets it see the
    // value at all.
    const rows = await engine.find(
      'deal',
      { where: [['owner_id', '=', '{current_user_id}']], context: { userId: 'u1' } } as any,
    );
    expect(lastWhere()).toEqual({ owner_id: 'u1' });
    expect(rows.map((r: any) => r.id).sort()).toEqual(['d1', 'd3']);
  });

  // ── every entry point, not just find() ────────────────────────────────

  it('findOne / count / aggregate lower the same way', async () => {
    const one = await engine.findOne('deal', { where: [['stage', '=', 'lost']] } as any);
    expect(lastWhere()).toEqual({ stage: 'lost' });
    expect(one?.id).toBe('d2');

    expect(await engine.count('deal', { where: [['stage', '=', 'won']] } as any)).toBe(2);
    expect(lastWhere()).toEqual({ stage: 'won' });

    await engine.aggregate('deal', {
      where: [['stage', '=', 'won']],
      groupBy: ['stage'],
      aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
    } as any);
    expect(lastWhere()).toEqual({ stage: 'won' });
  });

  it('update / delete lower too — and the by-id fast path finally sees `where.id`', async () => {
    await engine.update('deal', { amount: 99 }, { where: [['stage', '=', 'lost']], multi: true } as any);
    expect(writes[writes.length - 1]?.ast?.where).toEqual({ stage: 'lost' });

    await engine.delete('deal', { where: [['stage', '=', 'lost']], multi: true } as any);
    expect(writes[writes.length - 1]?.ast?.where).toEqual({ stage: 'lost' });
    expect(await engine.count('deal')).toBe(2);
  });

  it('the `filter` alias folds first, then lowers — both normalisations, one order', async () => {
    await engine.find('deal', { filter: [['stage', '=', 'won']] } as any);
    expect(lastWhere()).toEqual({ stage: 'won' });
  });

  // ── `[]` keeps its meaning: no filter ─────────────────────────────────

  it('an empty array is "no filter", exactly as before — find() returns every row', async () => {
    const rows = await engine.find('deal', { where: [] } as any);
    expect(rows).toHaveLength(3);
    // Lowered to ABSENT rather than to `{}`: `parseFilterAST([])` is
    // `undefined`, and every driver already treats both as "no predicate".
    expect(lastWhere()).toBeUndefined();
  });

  it('count([]) counts every row', async () => {
    expect(await engine.count('deal', { where: [] } as any)).toBe(3);
  });

  it('findOne([]) is now caught by the #4419 guard instead of returning an arbitrary row', async () => {
    // NOT a change to what `[]` MEANS — it still means "no filter". What
    // changed is that findOne can finally SEE that: an unlowered `[]` counted
    // as "an expression tree the driver will interpret", walked past the
    // guard, and came back with the object's first row.
    await expect(engine.findOne('deal', { where: [] } as any))
      .rejects.toThrow(/selects no particular record/);
  });

  // ── refusals: the shapes parseFilterAST cannot express ────────────────

  it('refuses the INFIX join dialect — the one shape the spec never declared', async () => {
    // `[condA, 'or', condB]` was compiled by four drivers and by none of the
    // doors; `FilterArraySchema` excludes it and `parseFilterAST` returns
    // `undefined` for it. Prefix is the declared spelling.
    await expect(
      engine.find('deal', { where: [['stage', '=', 'won'], 'or', ['stage', '=', 'lost']] } as any),
    ).rejects.toThrow(/Infix joins .* NOT one of the shapes/s);
  });

  it('refuses a bare triple whose operator is outside the AST vocabulary', async () => {
    await expect(engine.find('deal', { where: ['stage', 'sounds_like', 'won'] } as any))
      .rejects.toThrow(/is not a filter/);
  });

  it('refuses a logical node with nothing to join, rather than matching every row', async () => {
    await expect(engine.find('deal', { where: ['and'] } as any))
      .rejects.toThrow(/is not a filter/);
  });

  it('refuses an element that is neither a keyword nor a condition', async () => {
    await expect(engine.find('deal', { where: [42] } as any)).rejects.toThrow(/is not a filter/);
    await expect(engine.find('deal', { where: [null] } as any)).rejects.toThrow(/is not a filter/);
  });

  it('the refusal says the filter was not applied and names the operator vocabulary', async () => {
    await expect(engine.find('deal', { where: ['stage', 'sounds_like', 'won'] } as any))
      .rejects.toThrow(/UNFILTERED result set/);
    await expect(engine.find('deal', { where: ['stage', 'sounds_like', 'won'] } as any))
      .rejects.toThrow(/Recognised operators: .*starts_with/s);
  });

  it('a refused filter runs NOTHING — no driver read is attempted', async () => {
    await expect(engine.find('deal', { where: [42] } as any)).rejects.toThrow();
    expect(reads).toHaveLength(0);
  });

  // ── #5869: the list-shaped operators' comparands ──────────────────────
  //
  // `isFilterAST` vouches for the OPERATOR and nothing else, and
  // `parseFilterAST` lowers whatever comparand it is handed. So the shapes
  // below passed both, reached the driver, and — on driver-sql, via
  // `whereIn(field, scalar)` — came back as `500 DATABASE_ERROR`: a
  // server-fault code for a filter the caller can fix, naming neither the
  // operator nor the field. Same collection point, same envelope as the
  // refusals above.

  it.each([
    ['not_in', [['stage', 'not_in', 'won']]],
    ['nin', [['stage', 'nin', 'won']]],
    ['notin', [['stage', 'notin', 'won']]],
    ['in', [['stage', 'in', 'won']]],
  ])('refuses a scalar comparand on the collection operator %s', async (_op, where) => {
    await expect(engine.find('deal', asFilterArrayQuery(where)))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_FILTER' });
    // Nothing ran: a refused filter must not reach the driver at all, or the
    // 400 would be describing a query that already returned rows.
    expect(reads).toHaveLength(0);
  });

  it('the refusal NAMES the operator, the field and the expected shape (#5346/#5348 wording)', async () => {
    const err = await engine.find('deal', asFilterArrayQuery([['stage', 'not_in', 'won']]))
      .then(() => null, (e: any) => e);

    expect(err).not.toBeNull();
    // The entry point that refused, matching the sibling refusals above.
    expect(err.message).toMatch(/^find\('deal'\): /);
    // The operator, in the lowered spelling…
    expect(err.message).toMatch(/Operator "\$nin"/);
    // …and in the spellings an author actually types on a ViewFilterRule —
    // nobody writes `$nin` into metadata, so a refusal naming only the lowered
    // form sends them looking for a key their file does not contain.
    expect(err.message).toMatch(/not_in/);
    // The member.
    expect(err.message).toMatch(/field "stage"/);
    // What was received, and where.
    expect(err.message).toMatch(/Received string \("won"\)/);
    expect(err.message).toMatch(/where\.stage\.\$nin/);
    // The expected shape, as a value the caller can paste.
    expect(err.message).toMatch(/\["won"\]/);
    // The alternative, for the caller who meant a scalar comparison.
    expect(err.message).toMatch(/"!=" \(\$ne\)/);
    // And the part a status code cannot carry.
    expect(err.message).toMatch(/NOT applied/);
    expect(err.message).toMatch(/UNFILTERED result set/);
  });

  it('the whole refusal survives the REST boundary — it fits under CLIENT_MESSAGE_MAX', async () => {
    // `rest-server.ts` truncates a declared-4xx message at 500 chars before it
    // reaches the client (#5423 made it a truncation rather than a swap). The
    // "NOT applied" sentence is the part a caller cannot infer from a status
    // code, and it sits at the END — so a message that overflows loses exactly
    // the sentence the refusal exists to deliver. Pinned here rather than
    // trusted, because the bound lives in another package.
    const CLIENT_MESSAGE_MAX = 500;
    for (const where of [
      [['stage', 'not_in', 'won']],
      [['stage', 'in', 'won']],
      [['amount', 'between', 5]],
    ]) {
      const err = await engine.find('deal', asFilterArrayQuery(where))
        .then(() => null, (e: any) => e);
      expect(err.message.length, JSON.stringify(where)).toBeLessThan(CLIENT_MESSAGE_MAX);
      expect(err.message, JSON.stringify(where)).toMatch(/UNFILTERED result set/);
    }
  });

  it('refuses through the OBJECT door too — the door #5869 was measured through', async () => {
    // The protocol/HTTP face runs its own `isFilterAST` → `parseFilterAST` and
    // hands the engine an already-lowered FilterCondition, so the array branch
    // above never sees a wire query. This is that shape, arriving as an object.
    // NOT erased: `where` is declared `Record< string, unknown >`, so `tsc`
    // accepts a malformed comparand. That it type-checks and still has to be
    // refused at runtime is exactly why this gate exists.
    await expect(engine.find('deal', { where: { stage: { $nin: 'won' } } }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_FILTER' });
    await expect(engine.find('deal', { where: { stage: { $in: 'won' } } }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_FILTER' });
  });

  it.each([
    ['null', { stage: { $in: null } }],
    ['a number', { amount: { $in: 10 } }],
    ['an object', { stage: { $in: { a: 1 } } }],
  ])('refuses a comparand that is %s — every non-list, not just strings', async (_l, where) => {
    await expect(engine.find('deal', { where }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_FILTER' });
  });

  it('walks into $and / $or / $not — a nested scalar is refused with its own path', async () => {
    const err = await engine.find(
      'deal',
      asFilterArrayQuery(['and', ['amount', '>', 5], ['stage', 'not_in', 'won']]),
    ).then(() => null, (e: any) => e);
    expect(err?.status).toBe(400);
    expect(err.message).toMatch(/where\.\$and\[1\]\.stage\.\$nin/);

    await expect(engine.find('deal', { where: { $not: { stage: { $in: 'won' } } } }))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_FILTER' });
  });

  it('every engine entry point refuses it, not just find()', async () => {
    const where = [['stage', 'not_in', 'won']];
    await expect(engine.findOne('deal', asFilterArrayQuery(where)))
      .rejects.toMatchObject({ status: 400 });
    await expect(engine.count('deal', { where } as unknown as EngineCountOptions))
      .rejects.toMatchObject({ status: 400 });
    await expect(engine.aggregate('deal', {
      where, groupBy: ['stage'], aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
    } as unknown as EngineAggregateOptions)).rejects.toMatchObject({ status: 400 });
    await expect(engine.update('deal', { amount: 1 }, { where, multi: true } as any))
      .rejects.toMatchObject({ status: 400 });
    await expect(engine.delete('deal', { where, multi: true } as any))
      .rejects.toMatchObject({ status: 400 });
    // Refused before any of them touched the store.
    expect(reads).toHaveLength(0);
    expect(writes).toHaveLength(0);
    expect(await engine.count('deal')).toBe(3);
  });

  // `$between`'s arity, hoisted to the same seam. driver-sql and driver-memory
  // each already refuse this (#5328); driver-mongodb's arm falls through
  // without emitting a range predicate. Checking here is what makes the three
  // agree — the same reason the collection point exists.
  it.each([
    ['a scalar', [['amount', 'between', 5]]],
    ['a 1-tuple', [['amount', 'between', [1]]]],
    ['a 3-tuple', [['amount', 'between', [1, 2, 3]]]],
  ])('refuses a $between comparand that is %s', async (_l, where) => {
    await expect(engine.find('deal', asFilterArrayQuery(where)))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_FILTER' });
  });

  it('the $between refusal keeps the platform-wide wording and names the field', async () => {
    const err = await engine.find('deal', asFilterArrayQuery([['amount', 'between', 5]]))
      .then(() => null, (e: any) => e);
    // Verbatim leading sentence from driver-sql / driver-memory: one condition,
    // one wording, wherever the caller meets it.
    expect(err.message).toMatch(
      /Operator "\$between" on field "amount" requires a \[min, max\] value array\./,
    );
    expect(err.message).toMatch(/where\.amount\.\$between/);
  });

  // ── what must KEEP working: the declared list shapes ───────────────────

  it('a proper list comparand still reaches the driver untouched', async () => {
    await engine.find('deal', asFilterArrayQuery([['stage', 'in', ['won', 'lost']]]));
    expect(lastWhere()).toEqual({ stage: { $in: ['won', 'lost'] } });

    await engine.find('deal', asFilterArrayQuery([['stage', 'not_in', ['lost']]]));
    expect(lastWhere()).toEqual({ stage: { $nin: ['lost'] } });

    await engine.find('deal', asFilterArrayQuery([['amount', 'between', [5, 25]]]));
    expect(lastWhere()).toEqual({ amount: { $between: [5, 25] } });
  });

  it('an EMPTY list is a declared predicate, not a malformed one', async () => {
    // `$in: []` matches nothing and `$nin: []` matches everything — both
    // drivers say so in as many words. Arity is not this gate's business.
    await engine.find('deal', { where: { stage: { $in: [] } } });
    expect(lastWhere()).toEqual({ stage: { $in: [] } });
    await engine.find('deal', { where: { stage: { $nin: [] } } });
    expect(lastWhere()).toEqual({ stage: { $nin: [] } });
  });

  it('the gate does not re-judge list MEMBERS — that is #5234, on another face', async () => {
    // A `$field` reference and a plain object are both legitimate members here;
    // this gate asks only whether the comparand is a list at all.
    const where = { stage: { $in: [{ $field: 'other' }, 'won'] } };
    await engine.find('deal', { where });
    expect(lastWhere()).toEqual(where);
  });

  it('does not descend into a deep-equality comparand that merely LOOKS like an operator map', async () => {
    // `{ $eq: {...} }` holds DATA. A gate that walked into it would refuse a
    // stored document whose own key happens to be `$in` — a stricter contract
    // than any backend applies.
    const where = { stage: { $eq: { $in: 'not-an-operator-here' } } };
    await engine.find('deal', { where });
    expect(lastWhere()).toEqual(where);
  });

  it('a scalar on a NON-collection operator is untouched', async () => {
    await engine.find('deal', asFilterArrayQuery([['stage', '!=', 'won']]));
    expect(lastWhere()).toEqual({ stage: { $ne: 'won' } });
    // String bounds on a range comparison stay legal, and since #5685 the
    // declaration agrees: `FieldOperatorsSchema` now declares `$gt` as
    // number|Date|string|FieldReference, matching the ISO strings the showcase
    // apps send and every backend accepts. This gate still enforces only the
    // three list declarations, not the whole schema — for cost, not because the
    // schema disagrees.
    await engine.find('deal', asFilterArrayQuery([['stage', '>', '2026-01-01']]));
    expect(lastWhere()).toEqual({ stage: { $gt: '2026-01-01' } });
  });

  // ── the object form is untouched ──────────────────────────────────────

  it('a FilterCondition object passes through byte-for-byte', async () => {
    const where = { $or: [{ stage: 'won' }, { amount: { $gt: 25 } }] };
    await engine.find('deal', { where } as any);
    expect(lastWhere()).toEqual(where);
  });

  it('the caller\'s own bag is never mutated', async () => {
    const bag: any = { where: [['stage', '=', 'won']] };
    await engine.find('deal', bag);
    expect(bag.where).toEqual([['stage', '=', 'won']]);
  });
});
