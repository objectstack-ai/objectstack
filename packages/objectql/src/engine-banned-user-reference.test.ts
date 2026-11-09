// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30205] A new assignment to a banned user is refused at the server.
 *
 * Banning a user leaves the `sys_user` row in place, so the write-time
 * reference check resolved a banned user like any other, and
 * `POST /data/OBJECT` with `assignee` set to the banned user answered 201 —
 * new work for someone who cannot sign in. The check now refuses it with the
 * field code `reference_user_banned`, on the same terms as
 * `reference_not_found`: only a value the caller supplied, only a value the
 * write ADDS, never a system write. The ban-state read is elevated the way the
 * existence probe is. The caller's own read door is asked first, as for every
 * `lookup` and `user` value (#29029): it asks for the user's id alone, and a
 * user it does not return answers `reference_not_found`, its ban never read.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

const user = {
  name: 'sys_user',
  label: 'User',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    banned: { name: 'banned', label: 'Banned', type: 'boolean' as const },
    ban_expires: { name: 'ban_expires', label: 'Ban Expires', type: 'datetime' as const },
  },
};

const ticket = {
  name: 'ban_ticket',
  label: 'Ticket',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
    title: { name: 'title', label: 'Title', type: 'text' as const },
    assignee: { name: 'assignee', label: 'Assignee', type: 'lookup' as const, reference: 'sys_user' },
    reviewer: { name: 'reviewer', label: 'Reviewer', type: 'user' as const },
    watchers: { name: 'watchers', label: 'Watchers', type: 'lookup' as const, reference: 'sys_user', multiple: true },
  },
};

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
      if (v && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(row[k])) return false;
        continue;
      }
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
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
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
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const rows = await this.find(object, ast);
      for (const r of rows) storeFor(object).set(r.id as string, { ...r, ...data, id: r.id });
      return rows.length;
    },
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

/** Capture a rejection so its structured `fields[]` can be inspected. */
async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected the write to be refused, but it succeeded');
}

const ALICE = { userId: 'u_alice' };
const DAY = 24 * 60 * 60 * 1000;

describe('[#30205] a new assignment to a banned user is refused', () => {
  let engine: ObjectQL;
  let stores: Map<string, Map<string, Record<string, unknown>>>;
  let userReads: Array<{ elevated: boolean; fields: string[] }>;

  beforeEach(async () => {
    engine = new ObjectQL();
    const stub = makeStubDriver();
    stores = stub.stores;
    engine.registerDriver(stub.driver, true);
    await engine.init();
    engine.registry.registerObject(user);
    engine.registry.registerObject(ticket);
    const sys = { context: { isSystem: true } } as any;
    await engine.insert('sys_user', { id: 'u_alice', name: 'Alice', banned: false }, sys);
    await engine.insert('sys_user', { id: 'u_bob', name: 'Bob', banned: true }, sys);
    await engine.insert('sys_user', { id: 'u_carol', name: 'Carol', banned: true, ban_expires: new Date(Date.now() + DAY).toISOString() }, sys);
    await engine.insert('sys_user', { id: 'u_dave', name: 'Dave', banned: true, ban_expires: new Date(Date.now() - DAY).toISOString() }, sys);
    // [#29029] A non-system caller reads a user's id, as a member does, and
    // no other column of it: its own read of the ban columns is refused.
    userReads = [];
    engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
      if (ctx.object === 'sys_user' && ['find', 'findOne', 'count'].includes(ctx.operation)) {
        const elevated = ctx.context?.isSystem === true;
        const fields: string[] = Array.isArray(ctx.ast?.fields) ? ctx.ast.fields.map(String) : [];
        userReads.push({ elevated, fields });
        if (!elevated && (fields.length === 0 || fields.some((f) => f !== 'id'))) {
          throw Object.assign(new Error('no read access to sys_user'), { code: 'PERMISSION_DENIED', statusCode: 403 });
        }
      }
      await next();
    });
  });

  it('an insert naming a banned user is refused, and nothing is written', async () => {
    const err = await refusalOf(() => engine.insert('ban_ticket', { title: 'T', assignee: 'u_bob' }, { context: ALICE } as any));
    expect(err.name).toBe('ValidationError');
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fields).toHaveLength(1);
    expect(err.fields[0]).toMatchObject({ field: 'assignee', code: 'reference_user_banned', value: 'u_bob' });
    expect(stores.get('ban_ticket')?.size ?? 0).toBe(0);
  });

  it('the caller cannot read the ban columns, and is refused all the same: the ban is read elevated', async () => {
    await refusalOf(() => engine.insert('ban_ticket', { title: 'T', assignee: 'u_bob' }, { context: ALICE } as any));
    const own = userReads.filter((r) => !r.elevated);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.fields.length === 1 && r.fields[0] === 'id')).toBe(true);
    expect(userReads.some((r) => r.elevated && r.fields.includes('banned'))).toBe(true);
  });

  it('[#29029] a user the caller cannot read is reference_not_found, and its ban is not read', async () => {
    engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
      if (ctx.object === 'sys_user' && ctx.context?.isSystem !== true) {
        throw Object.assign(new Error('no read access to sys_user'), { code: 'PERMISSION_DENIED', statusCode: 403 });
      }
      await next();
    });
    userReads = [];
    const err = await refusalOf(() => engine.insert('ban_ticket', { title: 'T', assignee: 'u_bob' }, { context: ALICE } as any));
    expect(err.fields).toHaveLength(1);
    expect(err.fields[0]).toMatchObject({ field: 'assignee', code: 'reference_not_found', value: 'u_bob' });
    expect(userReads.some((r) => r.fields.includes('banned'))).toBe(false);
    expect(stores.get('ban_ticket')?.size ?? 0).toBe(0);
  });

  it('a `user` field and a ban with an expiry still ahead are refused too', async () => {
    const err = await refusalOf(() => engine.insert('ban_ticket', { title: 'T', reviewer: 'u_carol' }, { context: ALICE } as any));
    expect(err.fields[0]).toMatchObject({ field: 'reviewer', code: 'reference_user_banned', value: 'u_carol' });
  });

  it('a multi-valued user field is refused for its banned member only', async () => {
    const err = await refusalOf(() => engine.insert('ban_ticket', { title: 'T', watchers: ['u_alice', 'u_bob'] }, { context: ALICE } as any));
    expect(err.fields).toHaveLength(1);
    expect(err.fields[0]).toMatchObject({ field: 'watchers', code: 'reference_user_banned', value: 'u_bob' });
  });

  it('an active user, and a user whose ban has expired, are assigned as before', async () => {
    const a: any = await engine.insert('ban_ticket', { title: 'A', assignee: 'u_alice' }, { context: ALICE } as any);
    expect(a.assignee).toBe('u_alice');
    const d: any = await engine.insert('ban_ticket', { title: 'D', assignee: 'u_dave' }, { context: ALICE } as any);
    expect(d.assignee).toBe('u_dave');
  });

  it('an update that repoints a field at a banned user is refused, and the stored value does not move', async () => {
    const row: any = await engine.insert('ban_ticket', { title: 'T', assignee: 'u_alice' }, { context: ALICE } as any);
    const err = await refusalOf(() => engine.update('ban_ticket', { assignee: 'u_bob' }, { where: { id: row.id }, context: ALICE } as any));
    expect(err.fields[0]).toMatchObject({ field: 'assignee', code: 'reference_user_banned' });
    const after: any = await engine.findOne('ban_ticket', { where: { id: row.id }, context: { isSystem: true } });
    expect(after.assignee).toBe('u_alice');
  });

  it('a row that already holds the banned user stays editable: the value is not the write\'s', async () => {
    // Assigned before the ban (a system write stands in for history).
    await engine.insert('ban_ticket', { id: 't_old', title: 'Old', assignee: 'u_bob' }, { context: { isSystem: true } } as any);
    // An edit form carries the whole record back, the banned assignee with it.
    const updated: any = await engine.update(
      'ban_ticket', { title: 'Old, edited', assignee: 'u_bob' }, { where: { id: 't_old' }, context: ALICE } as any,
    );
    expect(updated).toMatchObject({ title: 'Old, edited', assignee: 'u_bob' });
  });

  it('a system write is exempt, as it is from the existence check', async () => {
    const row: any = await engine.insert('ban_ticket', { title: 'S', assignee: 'u_bob' }, { context: { isSystem: true } } as any);
    expect(row.assignee).toBe('u_bob');
  });

  it('a missing user is still reference_not_found, not a ban', async () => {
    const err = await refusalOf(() => engine.insert('ban_ticket', { title: 'T', assignee: 'u_nobody' }, { context: ALICE } as any));
    expect(err.fields[0]).toMatchObject({ field: 'assignee', code: 'reference_not_found' });
  });

  it('a user read that throws refuses nothing and logs a warning, as the existence probe fails open', async () => {
    const warnings: unknown[][] = [];
    const logger = (engine as any).logger;
    const warn = logger.warn;
    logger.warn = (...a: unknown[]) => { warnings.push(a); };
    engine.registerMiddleware(async (ctx: any, next: () => Promise<void>) => {
      if (ctx.object === 'sys_user' && ctx.operation === 'findOne') throw new Error('user store unreachable');
      await next();
    });
    try {
      const row: any = await engine.insert('ban_ticket', { title: 'T', assignee: 'u_bob' }, { context: ALICE } as any);
      expect(row.assignee).toBe('u_bob');
      expect(warnings.some(([m]) => String(m).includes('could not read the referenced user'))).toBe(true);
    } finally {
      logger.warn = warn;
    }
  });
});
