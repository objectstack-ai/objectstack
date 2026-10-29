// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The credential-column guard's filter / sort half (ADR-0100), against a REAL
 * {@link ObjectQL} engine over a minimal recording driver: every refusal is
 * the ADR-0112 `INVALID_FIELD` / 400 envelope and leaves the driver unasked;
 * a has-a-value check, a system context and every non-credential field are
 * served as before.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { isCredentialPresenceCondition } from './credential-evaluation-guard.js';

function makeRecordingDriver() {
  const rows = new Map<string, Record<string, unknown>[]>();
  const calls: string[] = [];
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      if (v !== null && typeof v === 'object') continue;
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      calls.push(`find:${object}`);
      return (rows.get(object) ?? []).filter((r) => matches(r, ast?.where)).map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      calls.push(`findOne:${object}`);
      const r = (rows.get(object) ?? []).find((x) => matches(x, ast?.where));
      return r ? { ...r } : null;
    },
    async count(object: string, ast: any) {
      calls.push(`count:${object}`);
      return (rows.get(object) ?? []).filter((r) => matches(r, ast?.where)).length;
    },
    async aggregate(object: string) {
      calls.push(`aggregate:${object}`);
      return [{ n: (rows.get(object) ?? []).length }];
    },
    async create(object: string, data: Record<string, unknown>) {
      const list = rows.get(object) ?? [];
      const row = { id: `r${list.length + 1}`, ...data };
      list.push(row);
      rows.set(object, list);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      calls.push(`update:${object}`);
      return { id, ...data };
    },
    async updateMany(object: string) { calls.push(`updateMany:${object}`); return 0; },
    async delete(object: string) { calls.push(`delete:${object}`); return true; },
    async deleteMany(object: string) { calls.push(`deleteMany:${object}`); return 0; },
    async upsert(_o: string, data: Record<string, unknown>) { return data; },
    async bulkCreate() { return []; }, async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, rows, calls };
}

const person = {
  name: 'cg_person', label: 'Person',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    pin: { name: 'pin', label: 'PIN', type: 'password' as const },
  },
};

const vault = {
  name: 'cg_vault', label: 'Vault',
  searchableFields: ['name', 'pin'],
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    pin: { name: 'pin', label: 'PIN', type: 'password' as const },
    token: { name: 'token', label: 'Token', type: 'secret' as const },
    holder: { name: 'holder', label: 'Holder', type: 'lookup' as const, reference: 'cg_person' },
  },
};

const USER = { userId: 'u1', roles: ['admin'] };
const SYSTEM = { isSystem: true };

async function buildEngine() {
  const engine = new ObjectQL();
  const recording = makeRecordingDriver();
  engine.registerDriver(recording.driver, true);
  await engine.init();
  engine.registry.registerObject(person as any);
  engine.registry.registerObject(vault as any);
  recording.rows.set('cg_person', [{ id: 'p1', name: 'Pat', pin: '1234' }]);
  recording.rows.set('cg_vault', [{ id: 'v1', name: 'alpha', pin: 'p@ssw0rd!', token: 'secret:h1', holder: 'p1' }]);
  return { engine, ...recording };
}

/** The ADR-0112 envelope the refusal carries, asserted on the thrown error. */
async function expectRefused(run: () => Promise<unknown>, field: string, param: string) {
  let thrown: any;
  try { await run(); } catch (e) { thrown = e; }
  expect(thrown, 'the call was refused').toBeDefined();
  expect(thrown.code).toBe('INVALID_FIELD');
  expect(thrown.status).toBe(400);
  expect(thrown.httpStatus).toBe(400);
  expect(thrown.field).toBe(field);
  expect(thrown.param).toBe(param);
}

describe('ADR-0100 credential-column guard — filter and sort keys', () => {
  let ctx: Awaited<ReturnType<typeof buildEngine>>;
  beforeEach(async () => { ctx = await buildEngine(); });

  const refusedWheres: Array<[string, unknown, string]> = [
    ['equality', { pin: 'p@ssw0rd!' }, 'pin'],
    ['$eq with a value', { pin: { $eq: 'p@ssw0rd!' } }, 'pin'],
    ['$ne with a value', { pin: { $ne: 'x' } }, 'pin'],
    ['range', { pin: { $gt: 'o' } }, 'pin'],
    ['$startsWith', { pin: { $startsWith: 'p@' } }, 'pin'],
    ['$contains', { pin: { $contains: 'ssw' } }, 'pin'],
    ['$in', { pin: { $in: ['a', 'b'] } }, 'pin'],
    ['a secret column', { token: { $startsWith: 'secret:' } }, 'token'],
    ['inside $or', { $or: [{ name: 'alpha' }, { pin: 'x' }] }, 'pin'],
    ['inside $not', { $not: { pin: 'x' } }, 'pin'],
    ['$not over a value operator', { pin: { $not: { $eq: 'x' } } }, 'pin'],
    ['a cross-field comparand', { name: { $eq: { $field: 'pin' } } }, 'pin'],
    ['the array form', [['pin', '=', 'p@ssw0rd!']], 'pin'],
  ];

  for (const [label, where, field] of refusedWheres) {
    it(`find refuses ${label} on a credential column, before the driver is asked`, async () => {
      await expectRefused(() => ctx.engine.find('cg_vault', { where: where as any, context: USER as any }), field, 'where');
      expect(ctx.calls).toEqual([]);
    });
  }

  it('a context-less engine call is judged like any non-system caller', async () => {
    await expectRefused(() => ctx.engine.find('cg_vault', { where: { pin: 'x' } }), 'pin', 'where');
  });

  it('refuses orderBy on a password and on a secret column', async () => {
    await expectRefused(
      () => ctx.engine.find('cg_vault', { orderBy: [{ field: 'pin', order: 'asc' }], context: USER as any }), 'pin', 'orderBy',
    );
    await expectRefused(
      () => ctx.engine.find('cg_vault', { orderBy: [{ field: 'token', order: 'desc' }], context: USER as any }), 'token', 'orderBy',
    );
    expect(ctx.calls).toEqual([]);
  });

  it('refuses on findOne, count, aggregate (where and per-aggregation filter), update and delete', async () => {
    await expectRefused(() => ctx.engine.findOne('cg_vault', { where: { pin: 'x' }, context: USER as any }), 'pin', 'where');
    await expectRefused(() => ctx.engine.count('cg_vault', { where: { pin: 'x' }, context: USER as any }), 'pin', 'where');
    await expectRefused(
      () => ctx.engine.aggregate('cg_vault', { where: { pin: 'x' }, aggregations: [{ function: 'count', alias: 'n' }] } as any, { context: USER as any }),
      'pin', 'where',
    );
    await expectRefused(
      () => ctx.engine.aggregate('cg_vault', {
        aggregations: [{ function: 'count', alias: 'n', filter: { pin: { $gt: 'o' } } }],
      } as any, { context: USER as any }),
      'pin', 'aggregations[0].filter',
    );
    await expectRefused(
      () => ctx.engine.update('cg_vault', { name: 'z' }, { where: { pin: 'x' }, multi: true, context: USER } as any), 'pin', 'where',
    );
    await expectRefused(
      () => ctx.engine.delete('cg_vault', { where: { pin: 'x' }, multi: true, context: USER } as any), 'pin', 'where',
    );
    expect(ctx.calls).toEqual([]);
  });

  it('refuses a credential column in an expand entry, judged against the target object', async () => {
    await expectRefused(
      () => ctx.engine.find('cg_vault', { expand: { holder: { object: 'cg_person', where: { pin: '1234' } } }, context: USER } as any),
      'pin', 'expand.holder.where',
    );
    await expectRefused(
      () => ctx.engine.find('cg_vault', { expand: { holder: { object: 'cg_person', orderBy: [{ field: 'pin' }] } }, context: USER } as any),
      'pin', 'expand.holder.orderBy',
    );
    expect(ctx.calls).toEqual([]);
  });

  it('refuses a nested-relation condition on the related object’s credential column', async () => {
    await expectRefused(
      () => ctx.engine.find('cg_vault', { where: { holder: { pin: '1234' } }, context: USER as any }), 'pin', 'where',
    );
  });

  const presence: Array<[string, unknown]> = [
    ['bare null', { pin: null }],
    ['$null: true', { pin: { $null: true } }],
    ['$null: false', { pin: { $null: false } }],
    ['$exists', { pin: { $exists: true } }],
    ['$empty', { pin: { $empty: false } }],
    ['$eq: null', { pin: { $eq: null } }],
    ['$ne: null', { token: { $ne: null } }],
    ['$not over a presence check', { pin: { $not: { $null: true } } }],
  ];
  for (const [label, where] of presence) {
    it(`serves a has-a-value check (${label})`, async () => {
      await expect(ctx.engine.find('cg_vault', { where: where as any, context: USER as any })).resolves.toBeInstanceOf(Array);
      expect(ctx.calls).toContain('find:cg_vault');
    });
  }

  it('serves a system context unchanged — the server’s own match on a credential column', async () => {
    const rows = await ctx.engine.find('cg_vault', { where: { pin: 'p@ssw0rd!' }, context: SYSTEM as any });
    expect(rows.map((r: any) => r.id)).toEqual(['v1']);
    await expect(ctx.engine.find('cg_vault', { orderBy: [{ field: 'pin', order: 'asc' }], context: SYSTEM as any })).resolves.toHaveLength(1);
    await expect(ctx.engine.count('cg_vault', { where: { pin: 'p@ssw0rd!' }, context: SYSTEM as any })).resolves.toBe(1);
  });

  it('leaves every non-credential field unaffected', async () => {
    const rows = await ctx.engine.find('cg_vault', {
      where: { name: 'alpha', holder: 'p1' }, orderBy: [{ field: 'name', order: 'asc' }], context: USER as any,
    });
    expect(rows.map((r: any) => r.id)).toEqual(['v1']);
    await expect(ctx.engine.count('cg_vault', { where: { name: 'alpha' }, context: USER as any })).resolves.toBe(1);
  });

  it('a search never scans a credential column, even one the author listed as searchable', async () => {
    let seenWhere: unknown;
    const original = ctx.driver.find;
    ctx.driver.find = async (object: string, ast: any) => { seenWhere = ast?.where; return original.call(ctx.driver, object, ast); };
    await ctx.engine.find('cg_vault', { search: 'p@ss', context: USER } as any);
    expect(JSON.stringify(seenWhere)).toContain('"name"');
    expect(JSON.stringify(seenWhere)).not.toContain('"pin"');
  });
});

describe('isCredentialPresenceCondition', () => {
  it('accepts only presence shapes', () => {
    expect(isCredentialPresenceCondition(null)).toBe(true);
    expect(isCredentialPresenceCondition({ $null: true })).toBe(true);
    expect(isCredentialPresenceCondition({ $ne: null })).toBe(true);
    expect(isCredentialPresenceCondition({})).toBe(false);
    expect(isCredentialPresenceCondition('x')).toBe(false);
    expect(isCredentialPresenceCondition({ $null: 'yes' })).toBe(false);
    expect(isCredentialPresenceCondition({ $null: true, $eq: 'x' })).toBe(false);
    expect(isCredentialPresenceCondition({ $exists: true, $empty: false })).toBe(true);
  });
});
