// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21197] `readInternalColumn` — the one dereference of an `internal: true`
 * column for rows a consumer already holds.
 *
 * Pinned:
 *  - on a REAL engine the generic read strips the column, and the helper
 *    recovers each row's stored value through `resolveInternalField`, in row
 *    order, `null` for an unset one;
 *  - a row that still carries the column answers from the row, with no
 *    privileged read;
 *  - stripped versus unset is decided by the REGISTERED declaration: an engine
 *    whose object does not declare the column `internal` cannot have stripped
 *    it, so a missing key is unset and no accessor is needed;
 *  - FAIL-CLOSED: when the declaration says the strip ran and the value cannot
 *    be recovered (no accessor, or a row with no id) it throws, never answering
 *    "unset".
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectQL } from './engine.js';
import { readInternalColumn, type InternalColumnSource } from './secret-fields.js';
import type { EngineQueryOptions } from '@objectstack/spec/data';

const OBJECT = {
  name: 'pin_gate',
  label: 'Pinned Gate',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text', primaryKey: true },
    label: { name: 'label', label: 'Label', type: 'text' },
    gate_hash: { name: 'gate_hash', label: 'Gate Hash', type: 'text', internal: true },
  },
};

/** A driver that serialises every read and honours the caller's bound after the filter. */
function makeDriver() {
  const store = new Map<string, Map<string, Record<string, unknown>>>();
  const tableOf = (o: string) => {
    let t = store.get(o);
    if (!t) { t = new Map(); store.set(o, t); }
    return t;
  };
  const copy = <T,>(r: T): T => JSON.parse(JSON.stringify(r));
  // Equality and `$in` on any field, `$and` nested; other operators are refused
  // loudly rather than silently widened to "every row".
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [key, cond] of Object.entries<any>(where)) {
      if (key === '$and' && Array.isArray(cond)) {
        if (!cond.every((sub) => matches(row, sub))) return false;
        continue;
      }
      if (key.startsWith('$')) throw new Error(`fake driver: unsupported operator ${key}`);
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('$in' in cond) {
          if (!(cond.$in as unknown[]).includes(row[key])) return false;
          continue;
        }
        if ('$eq' in cond) {
          if ((row[key] ?? null) !== (cond.$eq ?? null)) return false;
          continue;
        }
        throw new Error(`fake driver: unsupported condition on ${key}`);
      }
      if ((row[key] ?? null) !== (cond ?? null)) return false;
    }
    return true;
  };
  return {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(tableOf(object).values()).filter((r) => matches(r, ast?.where));
      return (typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows).map(copy);
    },
    async findOne(object: string, ast: any) {
      for (const r of tableOf(object).values()) if (matches(r, ast?.where)) return copy(r);
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      const row = { ...data, id: String(data.id) };
      tableOf(object).set(row.id, row);
      return copy(row);
    },
    async update() { return null; },
    async delete() { return false; },
    async count(object: string) { return tableOf(object).size; },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
}

async function boot() {
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver() as any, true);
  await engine.init();
  engine.registry.registerObject(OBJECT as any, 'com.objectstack.test.read-internal-column');
  const sys = { context: { isSystem: true } as any } satisfies EngineQueryOptions;
  await engine.insert('pin_gate', { id: 'g1', label: 'one', gate_hash: 'stored-hash-one' }, sys);
  await engine.insert('pin_gate', { id: 'g2', label: 'two', gate_hash: null }, sys);
  await engine.insert('pin_gate', { id: 'g3', label: 'three', gate_hash: 'stored-hash-three' }, sys);
  return { engine, sys };
}

describe('[#21197] readInternalColumn', () => {
  it('on a real engine: the generic read strips the column, and each row gets its stored value back in order', async () => {
    const { engine, sys } = await boot();
    const rows = (await engine.find('pin_gate', { ...sys, orderBy: [{ field: 'id', order: 'asc' }] })) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.id)).toEqual(['g1', 'g2', 'g3']);
    for (const r of rows) expect(r).not.toHaveProperty('gate_hash');

    const spy = vi.spyOn(engine, 'resolveInternalField');
    const values = await readInternalColumn(engine, 'pin_gate', rows, 'gate_hash');
    expect(values).toEqual(['stored-hash-one', null, 'stored-hash-three']);
    expect(spy).toHaveBeenCalledTimes(1); // one batched read for the whole set
  });

  it('a row that still carries the column answers from the row, with no privileged read', async () => {
    const { engine } = await boot();
    const spy = vi.spyOn(engine, 'resolveInternalField');
    const values = await readInternalColumn(engine, 'pin_gate', [{ id: 'g1', gate_hash: 'carried' }, { id: 'g2', gate_hash: null }], 'gate_hash');
    expect(values).toEqual(['carried', null]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stripped versus unset is the REGISTERED declaration: undeclared means unset, and no accessor is needed', async () => {
    const resolve = vi.fn();
    const engine: InternalColumnSource = {
      getSchema: () => ({ ...OBJECT, fields: { ...OBJECT.fields, gate_hash: { ...OBJECT.fields.gate_hash, internal: false } } }) as any,
      resolveInternalField: resolve,
    };
    expect(await readInternalColumn(engine, 'pin_gate', [{ id: 'g1' }], 'gate_hash')).toEqual([null]);
    expect(await readInternalColumn({}, 'pin_gate', [{ id: 'g1' }], 'gate_hash')).toEqual([null]);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('FAIL-CLOSED: declared internal and missing, with no accessor or no id, throws rather than answering unset', async () => {
    const declared: InternalColumnSource = { getSchema: () => OBJECT as any };
    await expect(readInternalColumn(declared, 'pin_gate', [{ id: 'g1' }], 'gate_hash')).rejects.toThrow(/no accessor/);

    const { engine } = await boot();
    await expect(readInternalColumn(engine, 'pin_gate', [{ label: 'no id here' }], 'gate_hash')).rejects.toThrow(/no id/);
  });
});
