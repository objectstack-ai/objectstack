// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7872] The comparand-type door at the engine's filter collection point —
 * Door 2's OBJECT form, the one form neither door routes through
 * `parseFilterAST`.
 *
 * The door's definition lives in `@objectstack/spec/data`
 * (`filter-comparand-type.ts`, where the ruling is quoted) and runs in two
 * places: inside `parseFilterAST` (Door 1's array lowering, analytics'
 * normalizer, every direct caller) and at `lowerWhereFilterArray`'s non-array
 * branch — this file's subject — because a `FilterCondition` OBJECT reaches
 * the engine without ever passing `parseFilterAST`: Door 1 gates on
 * `isFilterAST` (arrays only) and Door 2 is the engine call itself. The #7956
 * divergence matrix arrived through exactly this form.
 *
 * Same collection point, same envelope, same "no driver read on refusal"
 * discipline as the #5869 shape gate beside it. The shared per-driver pins
 * live in `FILTER_COMPARAND_TYPE_CASES`; this file pins what only the engine
 * can: that BOTH forms are covered on every engine verb, that refusal happens
 * BEFORE the driver, and that the bigint narrowing is copy-on-write on the
 * caller's bag.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { EngineQueryOptions } from '@objectstack/spec/data';
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

/** Minimal recording driver — the same witness shape as the #5158 lowering suite. */
function makeRecordingDriver() {
  const rows = new Map<string, Record<string, unknown>>();
  const reads: SeenRead[] = [];
  const writes: SeenRead[] = [];
  const matches = (row: any, where: any): boolean => {
    if (where == null) return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and') { if (!(v as any[]).every((w) => matches(row, w))) return false; continue; }
      if (k === '$or') { if (!(v as any[]).some((w) => matches(row, w))) return false; continue; }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const ops = v as Record<string, unknown>;
        if ('$eq' in ops && row[k] !== ops.$eq) return false;
        if ('$gt' in ops && !((row[k] as any) > (ops.$gt as any))) return false;
        if ('$in' in ops && !(ops.$in as unknown[]).includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };
  const run = (ast: any) => [...rows.values()].filter((r) => matches(r, ast?.where));
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

describe('[#7872] the comparand-type door at the engine collection point', () => {
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
    engine.registry.registerObject(deal, 'test');
    await engine.insert('deal', { id: 'd1', stage: 'won', amount: 10, owner_id: 'u1' });
    await engine.insert('deal', { id: 'd2', stage: 'lost', amount: 20, owner_id: 'u2' });
    reads.length = 0;
    writes.length = 0;
  });

  const refusalOf = async (p: Promise<unknown>) =>
    p.then(() => null, (e: any) => e as Error & { code?: string; status?: number });

  // ── the OBJECT form, the form the matrix arrived through ────────────────

  it.each([
    ['a Symbol, operator form', { stage: { $eq: Symbol('x') } }],
    ['a Map, operator form', { stage: { $ne: new Map() } }],
    ['a function, implicit form', { stage: () => 1 }],
    ['undefined, implicit form — the mongo worst cell', { stage: undefined }],
    ['undefined, operator form', { amount: { $gt: undefined } }],
    ['a plain object in a scalar slot', { amount: { $eq: { v: 10 } } }],
    ['an oversized bigint', { amount: { $eq: 2n ** 53n + 1n } }],
  ])('refuses %s with the envelope, and NO driver read runs', async (_label, where) => {
    // NOT erased: `FilterCondition`'s index signature admits these values, so
    // the call type-checks as written — that a type-legal filter still has to
    // be refused at runtime is exactly why the door exists (#5869's note).
    const err = await refusalOf(engine.find('deal', { where }));
    expect(err).not.toBeNull();
    expect(err).toMatchObject({ status: 400, code: 'INVALID_FILTER' });
    // The engine's wording contract: the refusal names the entry point…
    expect(err!.message).toMatch(/^find\('deal'\): /);
    // …and the caller learns the query never ran.
    expect(err!.message).toMatch(/NOT applied/);
    expect(reads).toHaveLength(0);
  });

  it('covers every engine verb that collects a filter — read and write sides', async () => {
    const where = { stage: undefined };
    for (const call of [
      () => engine.find('deal', { where }),
      () => engine.findOne('deal', { where }),
      () => engine.count('deal', { where }),
      () => engine.update('deal', { stage: 'x' }, { where, multi: true }),
      () => engine.delete('deal', { where, multi: true }),
    ]) {
      const err = await refusalOf(call());
      expect(err).not.toBeNull();
      expect(err).toMatchObject({ status: 400, code: 'INVALID_FILTER' });
    }
    expect(reads).toHaveLength(0);
    expect(writes).toHaveLength(0);
  });

  // ── the ARRAY form inherits the door through parseFilterAST ─────────────

  it('refuses a bad comparand arriving in a FilterArray triple', async () => {
    // The cast names the contract being bypassed: `FilterArray` is INPUT-ONLY
    // sugar `EngineQueryOptions.where` deliberately excludes (#5285), and this
    // case exists to prove the lowered triple inherits the door.
    const err = await refusalOf(
      engine.find('deal', { where: ['stage', '=', new Map()] } as unknown as EngineQueryOptions),
    );
    expect(err).toMatchObject({ status: 400, code: 'INVALID_FILTER' });
    expect(reads).toHaveLength(0);
  });

  // ── bigint: accepted, narrowed, copy-on-write ───────────────────────────

  it('narrows an exact-range bigint before the driver — the memory crash cell dies here', async () => {
    const rows = await engine.find('deal', { where: { amount: { $gt: BigInt(15) } } });
    expect(rows.map((r: any) => r.id)).toEqual(['d2']);
    const seen = reads[0]?.ast?.where?.amount?.$gt;
    expect(seen).toBe(15);
    expect(typeof seen).toBe('number');
  });

  it('the narrowing is copy-on-write — the caller’s bag is not edited under them', async () => {
    const where = { amount: { $gt: BigInt(15) } };
    await engine.find('deal', { where });
    expect(typeof where.amount.$gt).toBe('bigint');
  });

  it('a clean object filter still reaches the driver untouched', async () => {
    await engine.find('deal', { where: { stage: 'won', amount: { $gt: 5 } } });
    expect(reads[0]?.ast?.where).toEqual({ stage: 'won', amount: { $gt: 5 } });
  });
});
