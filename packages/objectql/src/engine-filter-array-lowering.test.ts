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
import { ObjectQL } from './engine.js';

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
    engine.registry.registerObject(deal as any);
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
