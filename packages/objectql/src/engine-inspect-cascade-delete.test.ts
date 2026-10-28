// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24964] `ObjectQL.inspectCascadeDelete` lists what a by-id `delete()` of a
 * record removes, and does nothing else.
 *
 * It exists so the operator's remover of orphaned detail rows (`os db
 * orphans`) can list, in its dry run, the deeper details the delete reaches.
 * The listing is only worth printing if it is the delete's own set, so the
 * first pin compares the two on the same engine: what the inspection lists is
 * exactly what the delete then removes, root first, and nothing outside it.
 *
 * The rest pin "nothing else": no driver write, no #12166 elevation record
 * (that record names a delete, and none happened), relations that remove
 * nothing (`restrict`, `set_null`) not listed, and a dependents probe that
 * fails propagates rather than answering "no deeper details".
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from './engine.js';

type Row = Record<string, unknown>;

function makeDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string): Map<string, Row> => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Row, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where as Row)) {
      if (k.startsWith('$')) continue;
      // [#27004] The collection probes the records of one depth together.
      if (v && typeof v === 'object' && Array.isArray((v as Row).$in)) {
        if (!((v as Row).$in as unknown[]).some((x) => String(x) === String(row[k]))) return false;
        continue;
      }
      const exp = v && typeof v === 'object' && '$eq' in (v as Row) ? (v as Row).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const writes: string[] = [];
  const driver: any = {
    name: 'primary', version: '0.0.0', supports: {},
    writes,
    failFindOn: undefined as string | undefined,
    rowIds: (o: string): string[] => Array.from(storeFor(o).keys()).sort(),
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: { where?: unknown; limit?: unknown } | undefined) {
      if (driver.failFindOn === o) throw new Error(`connection reset reading ${o}`);
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(o: string, ast: { where?: unknown } | undefined) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(o: string, data: Row) {
      writes.push(`create ${o}`);
      nextId += 1;
      const id = (data.id as string | undefined) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Row) {
      writes.push(`update ${o}`);
      const cur = storeFor(o).get(String(id));
      if (!cur) throw new Error(`not found ${o}/${id}`);
      const up = { ...cur, ...data, id };
      storeFor(o).set(String(id), up);
      return up;
    },
    async delete(o: string, id: string) { writes.push(`delete ${o}`); return storeFor(o).delete(String(id)); },
    async count(o: string, ast: { where?: unknown } | undefined) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
  };
  return driver;
}

async function makeEngine() {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const engine = new ObjectQL({ logger } as any);
  const driver = makeDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  const id = { name: 'id', type: 'text' as const, primaryKey: true };
  const name = { name: 'name', type: 'text' as const };
  const objects = [
    { name: 'ic_master', fields: { id, name } },
    { name: 'ic_detail', fields: { id, name, master: { name: 'master', type: 'master_detail', reference: 'ic_master', required: true } } },
    { name: 'ic_line', fields: { id, name, detail: { name: 'detail', type: 'master_detail', reference: 'ic_detail', required: true } } },
    // Relations that remove nothing on a delete of an `ic_detail`.
    { name: 'ic_pin', fields: { id, name, detail: { name: 'detail', type: 'lookup', reference: 'ic_detail', deleteBehavior: 'restrict' } } },
    { name: 'ic_tag', fields: { id, name, detail: { name: 'detail', type: 'lookup', reference: 'ic_detail', deleteBehavior: 'set_null' } } },
  ];
  for (const o of objects) engine.registry.registerObject(o as any, '__test__');
  return { engine, driver, logger };
}

const SYSTEM = { context: { isSystem: true } } as any;

async function seed(engine: ObjectQL) {
  const m = await engine.insert('ic_master', { name: 'M' }, SYSTEM);
  const d1 = await engine.insert('ic_detail', { name: 'D1', master: m.id }, SYSTEM);
  const d2 = await engine.insert('ic_detail', { name: 'D2', master: m.id }, SYSTEM);
  const l1 = await engine.insert('ic_line', { name: 'L1', detail: d1.id }, SYSTEM);
  const l2 = await engine.insert('ic_line', { name: 'L2', detail: d1.id }, SYSTEM);
  const l3 = await engine.insert('ic_line', { name: 'L3', detail: d2.id }, SYSTEM);
  return { m, d1, d2, l1, l2, l3 };
}

describe('[#24964] inspectCascadeDelete lists what delete() removes, and does nothing else', () => {
  it('lists the root first, then every deeper detail the cascade reaches, and nothing outside it', async () => {
    const { engine } = await makeEngine();
    const { m, d1, d2, l1, l2, l3 } = await seed(engine);

    const listed = await engine.inspectCascadeDelete('ic_master', m.id);

    expect(listed[0]).toEqual({ object: 'ic_master', id: String(m.id) });
    expect(listed.slice(1).map((r) => `${r.object}/${r.id}`).sort()).toEqual(
      [`ic_detail/${d1.id}`, `ic_detail/${d2.id}`, `ic_line/${l1.id}`, `ic_line/${l2.id}`, `ic_line/${l3.id}`].sort(),
    );
    // One level down: only that detail's own lines.
    expect((await engine.inspectCascadeDelete('ic_detail', d2.id)).map((r) => `${r.object}/${r.id}`))
      .toEqual([`ic_detail/${d2.id}`, `ic_line/${l3.id}`]);
  });

  it('what it lists is exactly what the delete then removes', async () => {
    const { engine, driver } = await makeEngine();
    const { d1 } = await seed(engine);
    const before = { detail: driver.rowIds('ic_detail'), line: driver.rowIds('ic_line'), master: driver.rowIds('ic_master') };

    const listed = await engine.inspectCascadeDelete('ic_detail', d1.id);
    await engine.delete('ic_detail', { where: { id: d1.id }, context: { isSystem: true } } as any);

    const removed = [
      ...before.detail.filter((x: string) => !driver.rowIds('ic_detail').includes(x)).map((x: string) => `ic_detail/${x}`),
      ...before.line.filter((x: string) => !driver.rowIds('ic_line').includes(x)).map((x: string) => `ic_line/${x}`),
      ...before.master.filter((x: string) => !driver.rowIds('ic_master').includes(x)).map((x: string) => `ic_master/${x}`),
    ].sort();
    // Non-vacuity: the delete reached a deeper level, so the equality says something.
    expect(removed.length).toBe(3);
    expect(listed.map((r) => `${r.object}/${r.id}`).sort()).toEqual(removed);
  });

  it('issues no write and files no elevation record', async () => {
    const { engine, driver, logger } = await makeEngine();
    const { m } = await seed(engine);
    driver.writes.length = 0;
    logger.info.mockClear();

    await engine.inspectCascadeDelete('ic_master', m.id);

    expect(driver.writes).toEqual([]);
    const elevation = logger.info.mock.calls.filter((c) => String(c[0]).includes('[reference-cleanup]'));
    expect(elevation).toEqual([]);

    // The control: the delete it previews does file that record, through the same walk.
    await engine.delete('ic_master', { where: { id: m.id }, context: { isSystem: true } } as any);
    expect(logger.info.mock.calls.some((c) => String(c[0]).includes('[reference-cleanup]'))).toBe(true);
  });

  it('does not list a row a restrict or set_null relation holds: neither removes it', async () => {
    const { engine } = await makeEngine();
    const { d1 } = await seed(engine);
    await engine.insert('ic_pin', { name: 'P', detail: d1.id }, SYSTEM);
    await engine.insert('ic_tag', { name: 'T', detail: d1.id }, SYSTEM);

    const objects = new Set((await engine.inspectCascadeDelete('ic_detail', d1.id)).map((r) => r.object));
    expect(objects).toEqual(new Set(['ic_detail', 'ic_line']));
  });

  it('propagates a dependents probe that fails, rather than answering no deeper details', async () => {
    const { engine, driver } = await makeEngine();
    const { d1 } = await seed(engine);
    driver.failFindOn = 'ic_line';

    await expect(engine.inspectCascadeDelete('ic_detail', d1.id)).rejects.toThrow(/connection reset reading ic_line/);
  });
});
