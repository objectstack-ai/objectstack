// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22908] A multi-valued reference element of the wrong shape is refused on
 * the engine's write path, on both doors: a caller's write (the one the REST
 * data routes make) and the system principal's.
 *
 * Measured on `main` before the fix, on a deployment whose value-shape posture
 * is strict: `[{ id }]` was stored on a caller's insert and update (the
 * existence check skips an object-typed element), `[false]` / `[42]` reached
 * that check and came back `reference_not_found`, and the system principal —
 * for whom the existence check returns at once — stored all three verbatim.
 * The single-valued fields refused all three `invalid_type` on both doors.
 *
 * The SHAPE check is the record validator's, and it runs for a system write as
 * it does for a single value. Whether a referenced id EXISTS stays
 * `assertReferencesResolve`'s question, whose `isSystem` latitude is untouched:
 * the last case below pins that a well-formed id the existence check would
 * refuse a caller is still written by the system principal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from './engine.js';

const STRICT = 'OS_DATA_VALUE_SHAPE_STRICT_ENABLED';

const account = {
  name: 'ms_account',
  label: 'Account',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};

const sysUser = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
  },
};

const project = {
  name: 'ms_project',
  label: 'Project',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    team: { name: 'team', label: 'Team', type: 'lookup' as const, reference: 'ms_account', multiple: true },
    watchers: { name: 'watchers', label: 'Watchers', type: 'user' as const, reference: 'sys_user', multiple: true },
    owner: { name: 'owner', label: 'Owner', type: 'lookup' as const, reference: 'ms_account' },
    assignee: { name: 'assignee', label: 'Assignee', type: 'user' as const, reference: 'sys_user' },
  },
};

/** The card's three wrong shapes. */
const WRONG: Record<string, unknown> = { boolean: false, number: 42, 'embedded-record': { id: 'acc_1' } };

const DOORS = {
  caller: { userId: 'usr_1' },
  system: { isSystem: true },
} as const;

function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) return null;
      const next = { ...cur, ...data, id };
      s.set(id, next);
      return next;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it was admitted');
}

describe('[#22908] multi-valued reference elements on the engine write path (strict posture)', () => {
  let engine: ObjectQL;
  let stores: Map<string, Map<string, Record<string, unknown>>>;
  let prior: string | undefined;

  const projects = () => stores.get('ms_project') ?? new Map<string, Record<string, unknown>>();

  beforeEach(async () => {
    prior = process.env[STRICT];
    process.env[STRICT] = '1';
    engine = new ObjectQL();
    const stub = makeStubDriver();
    stores = stub.stores;
    engine.registerDriver(stub.driver, true);
    await engine.init();
    engine.registry.registerObject(account);
    engine.registry.registerObject(sysUser);
    engine.registry.registerObject(project);
    const sys = { context: { isSystem: true } } as any;
    await engine.insert('ms_account', { id: 'acc_1', name: 'Acme' }, sys);
    await engine.insert('ms_account', { id: 'acc_2', name: 'Globex' }, sys);
    await engine.insert('sys_user', { id: 'usr_1', name: 'Ada' }, sys);
    await engine.insert('ms_project', { id: 'prj_1', title: 'Base', team: ['acc_1'], watchers: ['usr_1'] }, sys);
  });

  afterEach(() => {
    if (prior === undefined) delete process.env[STRICT];
    else process.env[STRICT] = prior;
  });

  for (const [door, context] of Object.entries(DOORS)) {
    for (const field of ['team', 'watchers'] as const) {
      for (const [kind, element] of Object.entries(WRONG)) {
        it(`${door} insert: ${field} = [${kind}] answers invalid_type naming the field, and nothing is stored`, async () => {
          const before = projects().size;
          const err = await refusalOf(() =>
            engine.insert('ms_project', { title: 'T', [field]: [element] }, { context } as any),
          );
          expect(err.name).toBe('ValidationError');
          expect(err.code).toBe('VALIDATION_FAILED');
          expect(err.fields).toHaveLength(1);
          expect(err.fields[0]).toMatchObject({ field, code: 'invalid_type' });
          expect(projects().size).toBe(before);
        });

        it(`${door} update: ${field} = [${kind}] answers invalid_type naming the field, and the row is unchanged`, async () => {
          const held = projects().get('prj_1')?.[field];
          const err = await refusalOf(() =>
            engine.update('ms_project', { [field]: [element] }, { where: { id: 'prj_1' }, context } as any),
          );
          expect(err.name).toBe('ValidationError');
          expect(err.code).toBe('VALIDATION_FAILED');
          expect(err.fields).toHaveLength(1);
          expect(err.fields[0]).toMatchObject({ field, code: 'invalid_type' });
          expect(projects().get('prj_1')?.[field]).toEqual(held);
        });
      }
    }

    it(`${door} CONTROL: the single-valued rows refuse the same three, unchanged`, async () => {
      for (const field of ['owner', 'assignee'] as const) {
        for (const element of Object.values(WRONG)) {
          const err = await refusalOf(() =>
            engine.insert('ms_project', { title: 'T', [field]: element }, { context } as any),
          );
          expect(err.fields[0]).toMatchObject({ field, code: 'invalid_type' });
        }
      }
    });

    it(`${door} CONTROL: a well-formed id array is accepted on insert and on update`, async () => {
      const row: any = await engine.insert(
        'ms_project', { id: `prj_ok_${door}`, title: 'T', team: ['acc_1', 'acc_2'], watchers: ['usr_1'] }, { context } as any,
      );
      expect(row.team).toEqual(['acc_1', 'acc_2']);
      await engine.update('ms_project', { team: ['acc_2'], watchers: ['usr_1'] }, { where: { id: 'prj_1' }, context } as any);
      expect(projects().get('prj_1')).toMatchObject({ team: ['acc_2'], watchers: ['usr_1'] });
    });
  }

  it('the existence check keeps its isSystem latitude: a well-formed id that names no row is the caller\'s refusal only', async () => {
    const err = await refusalOf(() =>
      engine.insert('ms_project', { title: 'T', team: ['acc_missing'] }, { context: DOORS.caller } as any),
    );
    expect(err.fields[0]).toMatchObject({ field: 'team', code: 'reference_not_found' });
    const row: any = await engine.insert('ms_project', { title: 'T', team: ['acc_missing'] }, { context: DOORS.system } as any);
    expect(row.team).toEqual(['acc_missing']);
  });
});
