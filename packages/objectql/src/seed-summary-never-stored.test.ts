// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35655] A seed never stores a roll-up (summary) value (maintainer ruling D,
 * record 7063117450). The seed loader takes a seed record's value for every
 * `type: 'summary'` field out of the record before the replay compare and the
 * write; the roll-up is computed from the child rows; the load result counts
 * the dropped values in `summariesDropped`, and one `warn` per dataset names
 * the object, the fields and the count.
 *
 * Measured on unfixed `main` 493ad095d4 with this file's harness (the real
 * ObjectQL engine and the real SeedLoaderService), parent `ss_inv` seeded with
 * `line_total: 999, line_count: 99` over two lines of 10 and 32:
 *
 *   case                                        stored line_total / line_count
 *   3  parent seeded alone, no children         999 / 99   (roll-up over no children: 0 / 0)
 *   4  parent re-seeded after its children      999 / 99   (before the re-seed: 42 / 2)
 *   6  the same seed loaded twice               load 1: 42 / 2, load 2: 999 / 99
 *
 * Every case below asserts the parent equal to its roll-up after every load,
 * and the drop counted. One rule for every aggregate: a `sum`, a `count` and a
 * `max` (no empty-set value, so it stays empty) are seeded side by side, and a
 * roll-up an extension contributes is dropped like the base object's own.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import type { IDataEngine, IMetadataService } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine.js';

/** A store-backed stub driver: the stored row IS the verdict. */
function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const checkOp = (value: any, cond: any): boolean => {
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) return value === cond;
    return Object.entries(cond).every(([op, target]: [string, any]) => {
      switch (op) {
        case '$eq': return value === target;
        case '$ne': return value !== target;
        case '$in': return Array.isArray(target) && target.includes(value);
        case '$nin': return Array.isArray(target) && !target.includes(value);
        case '$null': return target ? value == null : value != null;
        default: throw new Error(`stub driver: unsupported operator ${op}`);
      }
    });
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (k === '$not') return !matches(row, v);
      return checkOp(row?.[k], v);
    });
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(object);
      let count = 0;
      for (const [id, r] of Array.from(s.entries())) {
        if (matches(r, ast?.where)) { s.set(id, { ...r, ...data, id }); count += 1; }
      }
      return count;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async deleteMany(object: string, ast: any) {
      const s = storeFor(object);
      let count = 0;
      for (const [id, r] of Array.from(s.entries())) {
        if (matches(r, ast?.where)) { s.delete(id); count += 1; }
      }
      return count;
    },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

/** No metadata service answer: the loader resolves every definition from the engine's registry. */
function emptyMetadata(): IMetadataService {
  return {
    getObject: async () => undefined, listObjects: async () => [], register: async () => {}, get: async () => undefined,
    list: async () => [], unregister: async () => {}, exists: async () => false, listNames: async () => [],
  } as unknown as IMetadataService;
}

const CONFIG = { dryRun: false, haltOnError: false, multiPass: true, defaultMode: 'upsert', batchSize: 1000, transaction: false } as any;
const ENV = ['prod', 'dev', 'test'];
const SUPPLIED = { line_total: 999, line_count: 99, line_max: 500 };
const LINES = [{ name: 'l1', inv: 'A', amount: 10 }, { name: 'l2', inv: 'A', amount: 32 }];
const P = (records: any[], mode = 'upsert') => ({ object: 'ss_inv', externalId: 'name', mode, env: ENV, records });
const C = (records: any[]) => ({ object: 'ss_line', externalId: 'name', mode: 'upsert', env: ENV, records });

describe('[#35655] a seed never stores a roll-up value: the children decide it, the drop is reported', () => {
  let engine: ObjectQL;
  let storeFor: (o: string) => Map<string, any>;
  let warns: Array<{ message: string; meta?: Record<string, any> }>;

  beforeEach(async () => {
    engine = new ObjectQL();
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'ss_inv',
      fields: {
        name: { type: 'text' },
        line_total: { type: 'summary', summaryOperations: { object: 'ss_line', field: 'amount', function: 'sum' } },
        line_count: { type: 'summary', summaryOperations: { object: 'ss_line', field: 'amount', function: 'count' } },
        line_max: { type: 'summary', readonly: true, summaryOperations: { object: 'ss_line', field: 'amount', function: 'max' } },
      },
    } as any, 'test-package');
    engine.registry.registerObject({
      name: 'ss_line',
      fields: { name: { type: 'text' }, amount: { type: 'number' }, inv: { type: 'master_detail', reference: 'ss_inv' } },
    } as any, 'test-package');
    warns = [];
  });

  const load = (seeds: any[]) => new SeedLoaderService(
    engine as unknown as IDataEngine,
    emptyMetadata(),
    { info() {}, debug() {}, error() {}, warn: (message: string, meta?: Record<string, any>) => warns.push({ message, meta }) },
  ).load({ seeds, config: CONFIG } as any);
  const inv = (name: string) => [...storeFor('ss_inv').values()].find((r: any) => r.name === name);
  const resultOf = (r: any, object: string) => r.results.find((x: any) => x.object === object);
  const dropWarns = () => warns.filter((w) => w.message.includes('roll-up summary'));

  it('case 3: a parent seeded with totals and no children stores the empty-set values, and the load reports the drop', async () => {
    const r = await load([P([{ name: 'A', ...SUPPLIED }])]);

    expect(r.success).toBe(true);
    // sum and count start at 0; max has no empty-set value and stays empty.
    expect(inv('A')).toMatchObject({ line_total: 0, line_count: 0 });
    expect(inv('A')?.line_max ?? null).toBeNull();
    expect(resultOf(r, 'ss_inv')).toMatchObject({ inserted: 1, errored: 0, summariesDropped: 3 });
    expect(r.summary.totalSummariesDropped).toBe(3);
    // One line for the dataset, naming the object, every field and the count.
    expect(dropWarns()).toHaveLength(1);
    expect(dropWarns()[0].meta).toEqual({ object: 'ss_inv', fields: ['line_total', 'line_count', 'line_max'], summariesDropped: 3 });
    expect(dropWarns()[0].message).toContain('`line_total`, `line_count`, `line_max`');
  });

  it('case 1 (control): parent and children in one load store the roll-up, and the drop is still reported', async () => {
    const r = await load([P([{ name: 'A', ...SUPPLIED }]), C(LINES)]);

    expect(inv('A')).toMatchObject({ line_total: 42, line_count: 2, line_max: 32 });
    expect(resultOf(r, 'ss_inv').summariesDropped).toBe(3);
    expect(resultOf(r, 'ss_line').summariesDropped).toBe(0);
  });

  it('case 4: a re-seed over existing children keeps the computed values, and a roll-up-only difference is no write', async () => {
    await load([P([{ name: 'A' }]), C(LINES)]);
    expect(inv('A')).toMatchObject({ line_total: 42, line_count: 2, line_max: 32 });

    const r = await load([P([{ name: 'A', ...SUPPLIED }])]);

    expect(inv('A')).toMatchObject({ line_total: 42, line_count: 2, line_max: 32 });
    expect(resultOf(r, 'ss_inv')).toMatchObject({ updated: 0, skipped: 1, summariesDropped: 3 });
  });

  it('case 4 under `update` mode: the matched row keeps its computed values', async () => {
    await load([P([{ name: 'A' }]), C(LINES)]);

    const r = await load([P([{ name: 'A', ...SUPPLIED }], 'update')]);

    expect(inv('A')).toMatchObject({ line_total: 42, line_count: 2, line_max: 32 });
    expect(resultOf(r, 'ss_inv').summariesDropped).toBe(3);
  });

  it('case 6: the same seed replayed stores the same totals on both loads', async () => {
    const seeds = [P([{ name: 'A', ...SUPPLIED }]), C(LINES)];

    await load(seeds);
    expect(inv('A')).toMatchObject({ line_total: 42, line_count: 2, line_max: 32 });

    const r = await load(seeds);
    expect(inv('A')).toMatchObject({ line_total: 42, line_count: 2, line_max: 32 });
    expect(resultOf(r, 'ss_inv')).toMatchObject({ updated: 0, skipped: 1, summariesDropped: 3 });
  });

  it('a roll-up an extension contributes is dropped like the object\'s own', async () => {
    engine.registry.registerObject({
      name: 'ss_inv',
      fields: { ext_total: { type: 'summary', summaryOperations: { object: 'ss_line', field: 'amount', function: 'sum' } } },
    } as any, 'ext-package', undefined, 'extend');

    const r = await load([P([{ name: 'A', ext_total: 7 }])]);

    expect(inv('A')).toMatchObject({ ext_total: 0 });
    expect(resultOf(r, 'ss_inv').summariesDropped).toBe(1);
    expect(dropWarns()[0].meta?.fields).toEqual(['ext_total']);
  });

  it('a seed that supplies no roll-up value reports nothing', async () => {
    const r = await load([P([{ name: 'A' }]), C(LINES)]);

    expect(r.summary.totalSummariesDropped).toBe(0);
    expect(dropWarns()).toEqual([]);
  });
});
