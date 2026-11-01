// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28001] `ObjectQL.getCascadeDeleteObjects` names the objects a delete of a
 * record can cascade into, and the object read serves that list beside the
 * object as `cascadeDeleteObjects`, so a delete confirmation can name them.
 *
 * Ruling B on #28001: the client gets the list from the server, never from a
 * second copy of the engine rule. So the pins below hold three things:
 *
 *  - the list is the delete walk's own rule: a `master_detail` child by
 *    default, a lookup only when it declares `deleteBehavior: 'cascade'`, the
 *    grandchildren a child's own cascade reaches, and never a `restrict` or
 *    `set_null` relation, which remove nothing;
 *  - it agrees with the delete: every object whose rows a real delete removed
 *    is named, and nothing the delete left alone;
 *  - the real protocol serves it beside the item (both doors), read through
 *    the kernel's service table as a host composes it, and `item` is untouched.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
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
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((w) => matches(row, w))) return false;
        continue;
      }
      if (k === '$or' && Array.isArray(v)) {
        if (!v.some((w) => matches(row, w))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      // The delete's collection probes the records of one depth together.
      if (v && typeof v === 'object' && Array.isArray((v as Row).$in)) {
        if (!((v as Row).$in as unknown[]).some((x) => String(x) === String(row[k]))) return false;
        continue;
      }
      const exp = v && typeof v === 'object' && '$eq' in (v as Row) ? (v as Row).$eq : v;
      if ((row[k] ?? null) !== (exp ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'primary', version: '0.0.0', supports: {},
    rowIds: (o: string): string[] => Array.from(storeFor(o).keys()).sort(),
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: { where?: unknown; limit?: unknown } | undefined) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(o: string, ast: { where?: unknown } | undefined) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(o: string, data: Row) {
      nextId += 1;
      const id = (data.id as string | undefined) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Row) {
      const cur = storeFor(o).get(String(id));
      if (!cur) throw new Error(`not found ${o}/${id}`);
      const up = { ...cur, ...data, id };
      storeFor(o).set(String(id), up);
      return up;
    },
    async upsert(o: string, data: Row) {
      const id = data.id as string | undefined;
      if (id && storeFor(o).has(id)) return this.update(o, id, data);
      return this.create(o, data);
    },
    async delete(o: string, id: string) { return storeFor(o).delete(String(id)); },
    async count(o: string, ast: { where?: unknown } | undefined) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {},
    async rollback() {},
  };
  return driver;
}

const id = { name: 'id', type: 'text' as const, primaryKey: true };
const name = { name: 'name', type: 'text' as const };

/**
 * `cd_parent` ← `cd_child` (master_detail, the default cascade) ← `cd_grandchild`
 * (a lookup that declares `cascade`), beside the relations that remove nothing:
 * a `restrict` and a `set_null` sibling on the parent, and a default (`set_null`)
 * lookup on the child.
 */
const OBJECTS = [
  { name: 'cd_parent', label: 'Parent', fields: { id, name } },
  { name: 'cd_child', label: 'Child', fields: { id, name, parent: { name: 'parent', type: 'master_detail', reference: 'cd_parent', required: true } } },
  { name: 'cd_grandchild', label: 'Grandchild', fields: { id, name, child: { name: 'child', type: 'lookup', reference: 'cd_child', deleteBehavior: 'cascade' } } },
  { name: 'cd_pin', label: 'Pin', fields: { id, name, parent: { name: 'parent', type: 'lookup', reference: 'cd_parent', deleteBehavior: 'restrict' } } },
  { name: 'cd_tag', label: 'Tag', fields: { id, name, parent: { name: 'parent', type: 'lookup', reference: 'cd_parent', deleteBehavior: 'set_null' } } },
  { name: 'cd_note', label: 'Note', fields: { id, name, child: { name: 'child', type: 'lookup', reference: 'cd_child' } } },
  // An object nothing points at.
  { name: 'cd_loner', label: 'Loner', fields: { id, name } },
  // A tree whose own children cascade: the cycle terminates and names the object itself.
  { name: 'cd_folder', label: 'Folder', fields: { id, name, parent_folder: { name: 'parent_folder', type: 'tree', reference: 'cd_folder', deleteBehavior: 'cascade' } } },
];

const SYS_METADATA = {
  name: 'sys_metadata',
  label: 'System Metadata',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
    name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
    organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
    package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
    metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
    checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
    state: { name: 'state', label: 'State', type: 'text' as const },
    version: { name: 'version', label: 'Version', type: 'number' as const },
    created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
    updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
  },
};

async function makeEngine() {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const engine = new ObjectQL({ logger } as any);
  const driver = makeDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of OBJECTS) engine.registry.registerObject(o as any, '__test__');
  return { engine, driver };
}

async function makeHost() {
  const { engine, driver } = await makeEngine();
  engine.registry.registerObject(SYS_METADATA as any);
  for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) engine.registry.registerObject(o as any);
  // The kernel's service table as `ObjectQLPlugin` fills it: the engine under `objectql`.
  const services = new Map<string, unknown>([['objectql', engine], ['data', engine]]);
  return { engine, driver, protocol: new ObjectStackProtocolImplementation(engine, () => services as Map<string, any>) };
}

const SYSTEM = { context: { isSystem: true } } as any;

describe('[#28001] getCascadeDeleteObjects: the objects a delete can cascade into, by the delete\'s own rule', () => {
  it('names the master_detail child and the grandchild its lookup cascades into, and not the restrict / set_null siblings', async () => {
    const { engine } = await makeEngine();
    expect(engine.getCascadeDeleteObjects('cd_parent')).toEqual(['cd_child', 'cd_grandchild']);
    // One level down, the walk starts there.
    expect(engine.getCascadeDeleteObjects('cd_child')).toEqual(['cd_grandchild']);
  });

  it('control: an object nothing cascades into answers `[]`; one the registry does not hold answers `undefined`', async () => {
    const { engine } = await makeEngine();
    expect(engine.getCascadeDeleteObjects('cd_loner')).toEqual([]);
    expect(engine.getCascadeDeleteObjects('cd_grandchild')).toEqual([]);
    expect(engine.getCascadeDeleteObjects('cd_no_such_object')).toBeUndefined();
  });

  it('a self-cascading tree names itself once, and the walk terminates', async () => {
    const { engine } = await makeEngine();
    expect(engine.getCascadeDeleteObjects('cd_folder')).toEqual(['cd_folder']);
  });

  it('agrees with the delete: the objects whose rows a delete removed are exactly the ones named', async () => {
    const { engine, driver } = await makeEngine();
    const p = await engine.insert('cd_parent', { name: 'P' }, SYSTEM);
    const c = await engine.insert('cd_child', { name: 'C', parent: p.id }, SYSTEM);
    await engine.insert('cd_grandchild', { name: 'G', child: c.id }, SYSTEM);
    await engine.insert('cd_tag', { name: 'T', parent: p.id }, SYSTEM);
    await engine.insert('cd_note', { name: 'N', child: c.id }, SYSTEM);
    const others = ['cd_child', 'cd_grandchild', 'cd_tag', 'cd_note'];
    const before = Object.fromEntries(others.map((o) => [o, driver.rowIds(o).length]));

    const named = engine.getCascadeDeleteObjects('cd_parent');
    await engine.delete('cd_parent', { where: { id: p.id }, context: { isSystem: true } } as any);

    const emptied = others.filter((o) => before[o] > 0 && driver.rowIds(o).length === 0);
    // Non-vacuity: the delete reached two levels, and left the set_null holders standing.
    expect(emptied).toEqual(['cd_child', 'cd_grandchild']);
    expect(driver.rowIds('cd_tag')).toHaveLength(1);
    expect(driver.rowIds('cd_note')).toHaveLength(1);
    expect(named).toEqual(emptied);
  });
});

describe('[#28001] the object read serves `cascadeDeleteObjects` beside the item, from the engine', () => {
  it('both doors name the cascade, beside `item`, and `item` carries no such key', async () => {
    const { protocol } = await makeHost();

    const read: any = await protocol.getMetaItem({ type: 'object', name: 'cd_parent' } as any);
    expect(read.cascadeDeleteObjects).toEqual(['cd_child', 'cd_grandchild']);
    expect(read.item.name).toBe('cd_parent');
    expect(read.item).not.toHaveProperty('cascadeDeleteObjects');

    const cached: any = await protocol.getMetaItemCached({ type: 'object', name: 'cd_parent' });
    expect(cached.cascadeDeleteObjects).toEqual(['cd_child', 'cd_grandchild']);
    expect(cached.data).not.toHaveProperty('cascadeDeleteObjects');
  });

  it('control: `[]` where nothing cascades; no key on the execution face', async () => {
    const { protocol } = await makeHost();
    expect(((await protocol.getMetaItem({ type: 'object', name: 'cd_loner' } as any)) as any).cascadeDeleteObjects)
      .toEqual([]);
    expect(await protocol.getMetaItemForExecution({ type: 'object', name: 'cd_parent' } as any))
      .not.toHaveProperty('cascadeDeleteObjects');
  });

  it('an object registered later that cascades into this one is on the next read', async () => {
    const { engine, protocol } = await makeHost();
    expect(((await protocol.getMetaItem({ type: 'object', name: 'cd_loner' } as any)) as any).cascadeDeleteObjects)
      .toEqual([]);
    engine.registry.registerObject({
      name: 'cd_loner_line', label: 'Loner line',
      fields: { id, name, loner: { name: 'loner', type: 'master_detail', reference: 'cd_loner', required: true } },
    } as any, '__test__');
    expect(((await protocol.getMetaItem({ type: 'object', name: 'cd_loner' } as any)) as any).cascadeDeleteObjects)
      .toEqual(['cd_loner_line']);
  });
});
