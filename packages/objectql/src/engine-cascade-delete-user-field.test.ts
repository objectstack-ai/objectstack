// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29253] A `deleteBehavior` a `user` field DECLARES is what deleting that
 * user does; a `user` field that declares none is left as it was.
 *
 * ## The defect
 *
 * `FieldSchema` accepts `deleteBehavior` on a `user` field and round-trips an
 * authored value, but materializes none on a bare one. The referential delete
 * walk admitted `master_detail`, `lookup` and `tree` only, so it never read a
 * `user` relation: a `user` field declared `restrict` did not refuse deleting
 * the user, one declared `cascade` did not delete the row holding it, and both
 * kept the deleted user's id.
 *
 * ## Which door deletes a user
 *
 * Every user delete reaches `ObjectQL.delete` by id: better-auth's own deletes
 * of the user row (admin remove-user, self delete-user) go through the
 * plugin-auth adapter, which calls `engine.delete(model, { where: { id }, context: {
 * isSystem: true, … } })`; the generic data doors refuse a caller-context
 * `sys_user` delete (ADR-0092 D2). So the pins below delete through the
 * engine, both without a context and with the adapter's system context.
 *
 * ## What is pinned here
 *
 *  - a `user` field that authors no `deleteBehavior` (the spec's parse output,
 *    and a raw registration): deleting the user leaves the holder as it was,
 *    keeping the id, exactly as before;
 *  - `restrict`, single and multi-valued: refused with the walk's own
 *    ADR-0112 envelope (`DELETE_RESTRICTED` / 409, naming the holder's
 *    object), the same envelope a `lookup` restrict answers; a user nobody
 *    holds still deletes;
 *  - `cascade`, single and multi-valued: the holding rows are deleted, and a
 *    row holding another user is left alone;
 *  - `set_null`: a single field is cleared; a multi-valued one loses only the
 *    deleted member, and an emptied set is `[]`;
 *  - a REQUIRED `user` field's `set_null` escalates to the refusal, as a
 *    required `lookup`'s does;
 *  - a `user` field naming no `reference` still references `sys_user`;
 *  - one unit of work: a refusal after a cascade rolls the cascade back.
 *
 * The driver has REAL snapshot rollback (the `engine-cascade-delete-tree`
 * shape), and its WHERE matcher answers `$or` / `$and` / `$in` / `$contains`
 * and REFUSES any other operator rather than answering it silently wrong.
 */

import { describe, it, expect } from 'vitest';
import { FieldSchema } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

type Row = Record<string, unknown>;

function matchesValue(stored: unknown, cond: unknown): boolean {
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    const ops = cond as Row;
    for (const op of Object.keys(ops)) {
      const v = ops[op];
      if (op === '$eq') { if ((stored ?? null) !== (v ?? null)) return false; continue; }
      if (op === '$in') { if (!Array.isArray(v) || !v.some((e) => e === stored)) return false; continue; }
      if (op === '$contains') {
        const hit = Array.isArray(stored)
          ? stored.some((e) => String(e) === String(v))
          : typeof stored === 'string' && stored.includes(String(v));
        if (!hit) return false;
        continue;
      }
      throw new Error(`test driver: operator ${op} is not implemented`);
    }
    return true;
  }
  return (stored ?? null) === (cond ?? null);
}

function matches(row: Row, where: unknown): boolean {
  if (!where || typeof where !== 'object') return true;
  for (const key of Object.keys(where as Row)) {
    const cond = (where as Row)[key];
    if (key === '$or') {
      if (!Array.isArray(cond) || !cond.some((w) => matches(row, w))) return false;
      continue;
    }
    if (key === '$and') {
      if (!Array.isArray(cond) || !cond.every((w) => matches(row, w))) return false;
      continue;
    }
    if (key.startsWith('$')) throw new Error(`test driver: combinator ${key} is not implemented`);
    if (!matchesValue(row[key], cond)) return false;
  }
  return true;
}

function makeDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string): Map<string, Row> => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const committed: unknown[] = [];
  const rolledBack: unknown[] = [];
  const snapshots = new Map<unknown, Map<string, Map<string, Row>>>();
  let nextId = 0;
  const driver: any = {
    name: 'primary', version: '0.0.0', supports: {},
    committed, rolledBack,
    rowOf: (o: string, id: unknown): Row | undefined => storeFor(o).get(String(id)),
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
      const s = storeFor(o);
      const cur = s.get(String(id));
      if (!cur) throw new Error(`not found ${o}/${id}`);
      const up = { ...cur, ...data, id };
      s.set(String(id), up);
      return up;
    },
    async upsert(o: string, data: Row) {
      const id = data.id as string | undefined;
      return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data);
    },
    async delete(o: string, id: string) { return storeFor(o).delete(String(id)); },
    async count(o: string, ast: { where?: unknown } | undefined) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Row[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() {
      const handle = { __trx: snapshots.size + committed.length + rolledBack.length + 1 };
      const snap = new Map<string, Map<string, Row>>();
      for (const [o, s] of stores) snap.set(o, new Map(Array.from(s, ([k, v]) => [k, { ...v }])));
      snapshots.set(handle, snap);
      return handle;
    },
    async commit(handle: unknown) { snapshots.delete(handle); committed.push(handle); },
    async rollback(handle: unknown) {
      const snap = snapshots.get(handle);
      if (snap) { stores.clear(); for (const [o, s] of snap) stores.set(o, s); }
      snapshots.delete(handle);
      rolledBack.push(handle);
    },
  };
  return driver;
}

const id = { name: 'id', type: 'text' as const, primaryKey: true };
const name = { name: 'name', type: 'text' as const };

/** The user object a `user` field's type fixes as its target. */
const sysUser = { name: 'sys_user', label: 'User', fields: { id, name } };

/** An object holding a person in the field `person`, declared as `personDef`. */
const holder = (objectName: string, personDef: Record<string, unknown>) => ({
  name: objectName,
  label: objectName,
  fields: { id, name, person: { name: 'person', ...personDef } },
});

/** A `user` field as the spec's parse produces it, which is what a built artifact carries. */
const parsedUser = (extra: Record<string, unknown> = {}) =>
  FieldSchema.parse({ type: 'user', reference: 'sys_user', ...extra }) as Record<string, unknown>;

async function makeEngine(objects: unknown[]) {
  const quiet = () => {};
  const engine = new ObjectQL({ logger: { debug: quiet, info: quiet, warn: quiet, error: quiet } } as any);
  const driver = makeDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [sysUser, ...objects]) engine.registry.registerObject(o as any, '__test__');
  return { engine, driver };
}

/** The adapter's door: plugin-auth deletes a user by id as the system. */
const SYSTEM = { isSystem: true };

async function refusalOf(promise: Promise<unknown>): Promise<any> {
  try { await promise; } catch (err) { return err; }
  throw new Error('expected the delete to be refused');
}

describe('[#29253] a user field\'s declared deleteBehavior takes effect when the user is deleted', () => {
  describe('no deleteBehavior declared: the delete goes through unchanged', () => {
    it('the spec\'s parse materializes no deleteBehavior on a user field', () => {
      // The premise the pins below read: a bare `user` field declares nothing.
      expect('deleteBehavior' in parsedUser()).toBe(false);
      expect('deleteBehavior' in parsedUser({ multiple: true })).toBe(false);
    });

    it.each([
      ['as the spec parses it', parsedUser()],
      ['as the spec parses it, multi-valued', parsedUser({ multiple: true })],
      ['a raw registration', { type: 'user', reference: 'sys_user' }],
      ['a required one', parsedUser({ required: true })],
    ])('%s: the user is deleted, and the holder is kept with the id unchanged', async (_label, def) => {
      const { engine, driver } = await makeEngine([holder('uf_plain', def)]);
      const u = await engine.insert('sys_user', { name: 'U' });
      const value = (def as Row).multiple === true ? [u.id] : u.id;
      const h = await engine.insert('uf_plain', { name: 'H', person: value });

      await engine.delete('sys_user', { where: { id: u.id }, context: SYSTEM } as any);

      expect(driver.rowOf('sys_user', u.id)).toBeUndefined();
      expect(driver.rowOf('uf_plain', h.id)).toMatchObject({ name: 'H', person: value });
    });
  });

  describe('restrict', () => {
    it.each([
      ['single', parsedUser({ deleteBehavior: 'restrict' }), false],
      ['multi-valued', parsedUser({ deleteBehavior: 'restrict', multiple: true }), true],
    ])('%s: deleting a held user is refused with the walk\'s envelope, and both rows stay', async (_label, def, multi) => {
      const { engine, driver } = await makeEngine([holder('uf_guard', def)]);
      const u = await engine.insert('sys_user', { name: 'U' });
      const other = await engine.insert('sys_user', { name: 'O' });
      const value = multi ? [other.id, u.id] : u.id;
      const h = await engine.insert('uf_guard', { name: 'H', person: value });

      const err = await refusalOf(engine.delete('sys_user', { where: { id: u.id }, context: SYSTEM } as any));

      expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'uf_guard' });
      expect(driver.rowOf('sys_user', u.id)).toMatchObject({ name: 'U' });
      expect(driver.rowOf('uf_guard', h.id)).toMatchObject({ name: 'H', person: value });
    });

    it('answers the same code and status a lookup restrict to the same user answers', async () => {
      const { engine } = await makeEngine([
        holder('uf_guard_user', parsedUser({ deleteBehavior: 'restrict' })),
        holder('uf_guard_lookup', { type: 'lookup', reference: 'sys_user', deleteBehavior: 'restrict' }),
      ]);
      const viaUser = await engine.insert('sys_user', { name: 'A' });
      const viaLookup = await engine.insert('sys_user', { name: 'B' });
      await engine.insert('uf_guard_user', { name: 'H', person: viaUser.id });
      await engine.insert('uf_guard_lookup', { name: 'H', person: viaLookup.id });

      const userErr = await refusalOf(engine.delete('sys_user', { where: { id: viaUser.id } } as any));
      const lookupErr = await refusalOf(engine.delete('sys_user', { where: { id: viaLookup.id } } as any));

      expect({ code: userErr.code, status: userErr.status }).toEqual({ code: lookupErr.code, status: lookupErr.status });
      expect(userErr.dependentObject).toBe('uf_guard_user');
      expect(lookupErr.dependentObject).toBe('uf_guard_lookup');
    });

    it('lets a user nobody holds go', async () => {
      const { engine, driver } = await makeEngine([holder('uf_guard', parsedUser({ deleteBehavior: 'restrict' }))]);
      const held = await engine.insert('sys_user', { name: 'held' });
      const free = await engine.insert('sys_user', { name: 'free' });
      await engine.insert('uf_guard', { name: 'H', person: held.id });

      await engine.delete('sys_user', { where: { id: free.id }, context: SYSTEM } as any);

      expect(driver.rowOf('sys_user', free.id)).toBeUndefined();
      expect(driver.rowOf('sys_user', held.id)).toMatchObject({ name: 'held' });
    });

    it('a user field naming no reference still references sys_user', async () => {
      const { engine, driver } = await makeEngine([holder('uf_bare_ref', { type: 'user', deleteBehavior: 'restrict' })]);
      const u = await engine.insert('sys_user', { name: 'U' });
      const h = await engine.insert('uf_bare_ref', { name: 'H', person: u.id });

      const err = await refusalOf(engine.delete('sys_user', { where: { id: u.id } } as any));

      expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'uf_bare_ref' });
      expect(driver.rowOf('uf_bare_ref', h.id)).toMatchObject({ person: u.id });
    });
  });

  describe('cascade', () => {
    it.each([
      ['single', parsedUser({ deleteBehavior: 'cascade' }), false],
      ['multi-valued', parsedUser({ deleteBehavior: 'cascade', multiple: true }), true],
    ])('%s: the rows holding the user are deleted, and a row holding another user stays', async (_label, def, multi) => {
      const { engine, driver } = await makeEngine([holder('uf_owned', def)]);
      const u = await engine.insert('sys_user', { name: 'U' });
      const other = await engine.insert('sys_user', { name: 'O' });
      const h = await engine.insert('uf_owned', { name: 'H', person: multi ? [other.id, u.id] : u.id });
      const bystander = await engine.insert('uf_owned', { name: 'B', person: multi ? [other.id] : other.id });

      await engine.delete('sys_user', { where: { id: u.id }, context: SYSTEM } as any);

      expect(driver.rowOf('sys_user', u.id)).toBeUndefined();
      expect(driver.rowOf('uf_owned', h.id)).toBeUndefined();
      expect(driver.rowOf('uf_owned', bystander.id)).toMatchObject({ name: 'B' });
      expect(driver.rowOf('sys_user', other.id)).toMatchObject({ name: 'O' });
    });

    it('is one unit of work: a restrict refusing after the cascade rolls the cascade back', async () => {
      const { engine, driver } = await makeEngine([
        holder('uf_owned', parsedUser({ deleteBehavior: 'cascade' })),
        holder('uf_guard', parsedUser({ deleteBehavior: 'restrict' })),
      ]);
      const u = await engine.insert('sys_user', { name: 'U' });
      const owned = await engine.insert('uf_owned', { name: 'owned', person: u.id });
      await engine.insert('uf_guard', { name: 'guard', person: u.id });

      const err = await refusalOf(engine.delete('sys_user', { where: { id: u.id }, context: SYSTEM } as any));

      expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'uf_guard' });
      expect(driver.rowOf('uf_owned', owned.id)).toMatchObject({ name: 'owned', person: u.id });
      expect(driver.rowOf('sys_user', u.id)).toMatchObject({ name: 'U' });
      expect(driver.committed).toHaveLength(0);
    });
  });

  describe('set_null', () => {
    it('single: the holder is kept with the field cleared', async () => {
      const { engine, driver } = await makeEngine([holder('uf_clear', parsedUser({ deleteBehavior: 'set_null' }))]);
      const u = await engine.insert('sys_user', { name: 'U' });
      const other = await engine.insert('sys_user', { name: 'O' });
      const h = await engine.insert('uf_clear', { name: 'H', person: u.id });
      const bystander = await engine.insert('uf_clear', { name: 'B', person: other.id });

      await engine.delete('sys_user', { where: { id: u.id }, context: SYSTEM } as any);

      expect(driver.rowOf('sys_user', u.id)).toBeUndefined();
      expect(driver.rowOf('uf_clear', h.id)).toMatchObject({ name: 'H', person: null });
      expect(driver.rowOf('uf_clear', bystander.id)).toMatchObject({ name: 'B', person: other.id });
    });

    it('multi-valued: only the deleted member is removed, and an emptied set is []', async () => {
      const { engine, driver } = await makeEngine([
        holder('uf_clear_many', parsedUser({ deleteBehavior: 'set_null', multiple: true })),
      ]);
      const u = await engine.insert('sys_user', { name: 'U' });
      const other = await engine.insert('sys_user', { name: 'O' });
      const both = await engine.insert('uf_clear_many', { name: 'both', person: [other.id, u.id] });
      const only = await engine.insert('uf_clear_many', { name: 'only', person: [u.id] });

      await engine.delete('sys_user', { where: { id: u.id }, context: SYSTEM } as any);

      expect(driver.rowOf('uf_clear_many', both.id)).toMatchObject({ person: [other.id] });
      expect(driver.rowOf('uf_clear_many', only.id)).toMatchObject({ person: [] });
    });

    it('a required user field\'s set_null cannot clear it, so the user delete is refused', async () => {
      const { engine, driver } = await makeEngine([
        holder('uf_required', parsedUser({ deleteBehavior: 'set_null', required: true })),
      ]);
      const u = await engine.insert('sys_user', { name: 'U' });
      const h = await engine.insert('uf_required', { name: 'H', person: u.id });

      const err = await refusalOf(engine.delete('sys_user', { where: { id: u.id }, context: SYSTEM } as any));

      expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentObject: 'uf_required' });
      expect(driver.rowOf('uf_required', h.id)).toMatchObject({ person: u.id });
    });
  });
});
