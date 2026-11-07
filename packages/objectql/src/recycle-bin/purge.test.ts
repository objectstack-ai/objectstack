// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30237, ADR-0148 D1/D3, Q3 = A] The recycle bin's removal side, through a
 * real `ObjectQL`: the permanent delete (`permanent: true`) writes no entry and
 * is dispatched as `purge`; `purge(entryId)` removes one entry and `empty(object)`
 * every entry of one object, each as ONE `purge` dispatch on the business
 * object, with no AST and no id, scoped to the caller's organization.
 *
 * The driver keeps real rows and honours `options.tenantId` the way the SQL
 * driver does (`organization_id = :tenant`), because "another organization's
 * entry is out of reach" cannot be told apart from "it is not" by a stub.
 */

import { describe, it, expect } from 'vitest';
import { RECYCLE_BIN_ENTRY_FIELDS } from '@objectstack/spec/data';
import { ObjectQL } from '../engine.js';
import { bindHooksToEngine } from '../hook-binder.js';

type Row = Record<string, unknown>;

function makeDriver(opts: { deleteMany?: boolean } = {}) {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Row, where: any, options: any): boolean => {
    if (options?.tenantId !== undefined && 'organization_id' in row && row.organization_id !== options.tenantId) return false;
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
        if (!(v as any).$in.some((x: unknown) => String(x) === String(row[k]))) return false;
        continue;
      }
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'primary',
    version: '0.0.0',
    supports: {},
    finds: [] as Array<{ object: string; limit: unknown }>,
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
    seed(o: string, row: Row) { storeFor(o).set(String(row.id), { ...row }); },
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any, options: any) {
      driver.finds.push({ object: o, limit: ast?.limit });
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where, options));
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map((r) => ({ ...r }));
    },
    async findOne(o: string, ast: any, options: any) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where, options)) return { ...r };
      return null;
    },
    async create(o: string, data: Row) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = JSON.parse(JSON.stringify({ ...data, id }));
      storeFor(o).set(id, row);
      return { ...row };
    },
    async update(o: string, id: string, data: Row) {
      const s = storeFor(o);
      const cur = s.get(String(id));
      if (!cur) throw new Error(`not found ${o}/${id}`);
      const up = { ...cur, ...data, id };
      s.set(String(id), up);
      return { ...up };
    },
    async delete(o: string, id: string, options: any) {
      const row = storeFor(o).get(String(id));
      if (!row || !matches(row, undefined, options)) return false;
      return storeFor(o).delete(String(id));
    },
    async count(o: string, ast: any, options: any) { return (await driver.find(o, ast, options)).length; },
  };
  if (opts.deleteMany !== false) {
    driver.deleteMany = async (o: string, ast: any, options: any) => {
      const doomed = await driver.find(o, { where: ast?.where }, options);
      for (const r of doomed) storeFor(o).delete(String((r as any).id));
      return doomed.length;
    };
  }
  return driver;
}

const text = (name: string) => ({ name, type: 'text' as const });

/** The bin, declared as `@objectstack/platform-objects` declares it. */
const bin = {
  name: 'sys_recycle_bin',
  label: 'Recycle Bin Entry',
  managedBy: 'engine-owned',
  fields: {
    ...RECYCLE_BIN_ENTRY_FIELDS,
    organization_id: { name: 'organization_id', type: 'lookup' as const, reference: 'sys_organization', deleteBehavior: 'cascade' },
  },
};
/** account ← contact (master_detail). */
const account = {
  name: 'account',
  label: 'Account',
  fields: { id: text('id'), name: text('name'), organization_id: text('organization_id') },
};
const contact = {
  name: 'contact',
  label: 'Contact',
  fields: {
    id: text('id'),
    name: text('name'),
    account: { name: 'account', type: 'master_detail' as const, reference: 'account' },
  },
};
const loner = { name: 'loner', label: 'Loner', fields: { id: text('id'), name: text('name') } };
const sysThing = { name: 'sys_thing', label: 'Thing', fields: { id: text('id'), name: text('name') } };

interface Dispatch { object: string; operation: string; hasAst: boolean; hasId: boolean }

async function makeEngine(options: { withBin?: boolean; deleteMany?: boolean } = {}) {
  const engine = new ObjectQL();
  // The multi-organization posture, so a caller's organization scopes its reads
  // and writes (the default under test is `single`, which scopes nothing).
  engine.setTenancyPostureProvider(() => 'isolated');
  const driver = makeDriver({ deleteMany: options.deleteMany });
  engine.registerDriver(driver, true);
  await engine.init();
  const objects: any[] = [account, contact, loner, sysThing];
  if (options.withBin !== false) objects.push(bin);
  for (const o of objects) engine.registry.registerObject(o as any, '__test__');
  const dispatches: Dispatch[] = [];
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    const id = opCtx.options?.where?.id;
    dispatches.push({
      object: opCtx.object,
      operation: opCtx.operation,
      hasAst: !!opCtx.ast,
      hasId: typeof id === 'string' || typeof id === 'number',
    });
    await next();
  });
  return { engine, driver, dispatches };
}

/**
 * plugin-security's posture until it maps `purge` to `manageRecycleBin`: the
 * destructive verb, unmapped, is refused for every caller but the system.
 */
function refuseNonSystemPurge(engine: ObjectQL) {
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    if (opCtx.operation === 'purge' && opCtx.context?.isSystem !== true) {
      const err: any = new Error(`[Security] Access denied: purge on '${opCtx.object}'`);
      err.code = 'PERMISSION_DENIED';
      err.status = 403;
      throw err;
    }
    await next();
  });
}

const ORG1_USER = { context: { userId: 'u_alice', tenantId: 'org_1' } } as const;
const ORG2_USER = { context: { userId: 'u_bob', tenantId: 'org_2' } } as const;
const SYSTEM = { context: { isSystem: true } } as const;
const entriesOf = (driver: any) => driver.rowsOf('sys_recycle_bin') as Row[];

/** Delete two loners in each organization, so each holds two entries. */
async function seedEntries(engine: ObjectQL, driver: any) {
  for (const [id, who] of [['l1', ORG1_USER], ['l2', ORG1_USER], ['l3', ORG2_USER], ['l4', ORG2_USER]] as const) {
    driver.seed('loner', { id, name: id });
    await engine.delete('loner', { where: { id }, ...who });
  }
  driver.seed('account', { id: 'acc1', name: 'Acme', organization_id: 'org_1' });
  await engine.delete('account', { where: { id: 'acc1' }, ...ORG1_USER });
  return {
    of: (record: string) => entriesOf(driver).find((e) => e.record_id === record)!,
  };
}

describe('the permanent delete (Q3 = A)', () => {
  it('deletes the record and its cascade, writes no entry, and is dispatched as `purge` on the row', async () => {
    const { engine, driver, dispatches } = await makeEngine();
    driver.seed('account', { id: 'acc1', name: 'Acme', organization_id: 'org_1' });
    driver.seed('contact', { id: 'c1', name: 'Ada', account: 'acc1' });

    await expect(engine.delete('account', { where: { id: 'acc1' }, permanent: true, ...ORG1_USER })).resolves.toBeTruthy();

    expect(driver.rowsOf('account')).toHaveLength(0);
    expect(driver.rowsOf('contact')).toHaveLength(0);
    expect(entriesOf(driver)).toHaveLength(0);
    const own = dispatches.filter((d) => d.object === 'account');
    expect(own).toEqual([{ object: 'account', operation: 'purge', hasAst: false, hasId: true }]);
  });

  it('still fires the delete hooks, which read `permanent` off the options', async () => {
    const { engine, driver } = await makeEngine();
    driver.seed('loner', { id: 'l1', name: 'one' });
    const seen: Array<{ event: string; permanent: unknown }> = [];
    for (const event of ['beforeDelete', 'afterDelete']) {
      engine.registerHook(event, async (ctx: any) => {
        seen.push({ event, permanent: ctx.input?.options?.permanent });
      }, { object: 'loner' });
    }

    await engine.delete('loner', { where: { id: 'l1' }, permanent: true, ...ORG1_USER });

    expect(seen).toEqual([
      { event: 'beforeDelete', permanent: true },
      { event: 'afterDelete', permanent: true },
    ]);
  });

  it('`permanent: false` is the ordinary delete, which keeps an entry', async () => {
    const { engine, driver, dispatches } = await makeEngine();
    driver.seed('loner', { id: 'l1', name: 'one' });

    await engine.delete('loner', { where: { id: 'l1' }, permanent: false, ...ORG1_USER });

    expect(entriesOf(driver)).toHaveLength(1);
    expect(dispatches.map((d) => d.operation)).toEqual(['delete']);
  });

  it('is refused, and changes nothing, where the security layer refuses `purge`', async () => {
    const { engine, driver } = await makeEngine();
    refuseNonSystemPurge(engine);
    driver.seed('loner', { id: 'l1', name: 'one' });

    await expect(engine.delete('loner', { where: { id: 'l1' }, permanent: true, ...ORG1_USER }))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(driver.rowsOf('loner')).toHaveLength(1);
    expect(entriesOf(driver)).toHaveLength(0);

    // The ordinary delete is not the purge verb, and is not refused.
    await engine.delete('loner', { where: { id: 'l1' }, ...ORG1_USER });
    expect(driver.rowsOf('loner')).toHaveLength(0);
    expect(entriesOf(driver)).toHaveLength(1);
  });

  it.each([
    ['a delete by filter', { where: { name: 'one' }, multi: true }],
    ['a by-id delete asked as a predicate', { where: { id: 'l1' }, multi: true }],
  ])('is refused 400 on %s, before any middleware or write', async (_label, shape) => {
    const { engine, driver, dispatches } = await makeEngine();
    driver.seed('loner', { id: 'l1', name: 'one' });

    await expect(engine.delete('loner', { ...shape, permanent: true, ...ORG1_USER } as any))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400, param: 'permanent', object: 'loner' });
    expect(dispatches).toEqual([]);
    expect(driver.rowsOf('loner')).toHaveLength(1);
  });

  it('is refused 400 on a platform object, whose delete is already permanent', async () => {
    const { engine, driver, dispatches } = await makeEngine();
    driver.seed('sys_thing', { id: 's1', name: 'one' });

    await expect(engine.delete('sys_thing', { where: { id: 's1' }, permanent: true, ...SYSTEM }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400, param: 'permanent', object: 'sys_thing' });
    expect(dispatches).toEqual([]);
    expect(driver.rowsOf('sys_thing')).toHaveLength(1);
  });

  it('refuses a `permanent` that is not a boolean, rather than reading it as either', async () => {
    const { engine, driver } = await makeEngine();
    driver.seed('loner', { id: 'l1', name: 'one' });

    await expect(engine.delete('loner', { where: { id: 'l1' }, permanent: 'true', ...ORG1_USER } as any))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400, param: 'permanent' });
    expect(driver.rowsOf('loner')).toHaveLength(1);
  });
});

describe('purge(entryId)', () => {
  it('removes the one entry, dispatched once as `purge` on its object with no AST and no id', async () => {
    const { engine, driver, dispatches } = await makeEngine();
    const seeded = await seedEntries(engine, driver);
    const entry = seeded.of('l1');
    dispatches.length = 0;

    await expect(engine.purge(entry.id as string, ORG1_USER)).resolves.toBe(true);

    expect(entriesOf(driver).map((e) => e.record_id).sort()).toEqual(['acc1', 'l2', 'l3', 'l4']);
    expect(dispatches).toEqual([{ object: 'loner', operation: 'purge', hasAst: false, hasId: false }]);
  });

  it("answers false for an entry of another organization, and leaves it", async () => {
    const { engine, driver, dispatches } = await makeEngine();
    const seeded = await seedEntries(engine, driver);
    dispatches.length = 0;

    await expect(engine.purge(seeded.of('l3').id as string, ORG1_USER)).resolves.toBe(false);

    expect(entriesOf(driver)).toHaveLength(5);
    expect(dispatches).toEqual([]);
  });

  it('answers false for an id no entry has, and when the composition registers no bin', async () => {
    const withBin = await makeEngine();
    await expect(withBin.engine.purge('no_such_entry', ORG1_USER)).resolves.toBe(false);

    const noBin = await makeEngine({ withBin: false });
    await expect(noBin.engine.purge('no_such_entry', ORG1_USER)).resolves.toBe(false);
    expect(noBin.dispatches).toEqual([]);
  });

  it('removes nothing where the security layer refuses `purge`; the system purges', async () => {
    const { engine, driver } = await makeEngine();
    refuseNonSystemPurge(engine);
    const seeded = await seedEntries(engine, driver);
    const id = seeded.of('l1').id as string;

    await expect(engine.purge(id, ORG1_USER)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(entriesOf(driver)).toHaveLength(5);

    await expect(engine.purge(id, SYSTEM)).resolves.toBe(true);
    expect(entriesOf(driver)).toHaveLength(4);
  });

  it.each([[''], [null], [{ id: 'x' }]])('refuses %j as the entry id, 400', async (entryId) => {
    const { engine, dispatches } = await makeEngine();
    await expect(engine.purge(entryId as any, ORG1_USER)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400, param: 'entryId' });
    expect(dispatches).toEqual([]);
  });
});

describe('empty(object)', () => {
  it("removes the caller's organization's entries of that object, in one `purge` dispatch, and counts them", async () => {
    const { engine, driver, dispatches } = await makeEngine();
    await seedEntries(engine, driver);
    dispatches.length = 0;

    await expect(engine.empty('loner', ORG1_USER)).resolves.toBe(2);

    // Org 2's loners and org 1's account stay.
    expect(entriesOf(driver).map((e) => e.record_id).sort()).toEqual(['acc1', 'l3', 'l4']);
    expect(dispatches).toEqual([{ object: 'loner', operation: 'purge', hasAst: false, hasId: false }]);
  });

  it('removes every organization\'s entries of that object for the system', async () => {
    const { engine, driver } = await makeEngine();
    await seedEntries(engine, driver);

    await expect(engine.empty('loner', SYSTEM)).resolves.toBe(4);
    expect(entriesOf(driver).map((e) => e.record_id)).toEqual(['acc1']);
  });

  it('removes them one page at a time on a driver with no `deleteMany`', async () => {
    const { engine, driver } = await makeEngine({ deleteMany: false });
    await seedEntries(engine, driver);
    driver.finds.length = 0;

    await expect(engine.empty('loner', SYSTEM)).resolves.toBe(4);
    expect(entriesOf(driver).map((e) => e.record_id)).toEqual(['acc1']);
    // Every read of the bin was bounded.
    expect(driver.finds.filter((f: any) => f.object === 'sys_recycle_bin').every((f: any) => f.limit === 500)).toBe(true);
  });

  it('reads as many pages as it takes, and stops on a page the driver removes nothing from', async () => {
    const { engine, driver } = await makeEngine({ deleteMany: false });
    for (let i = 0; i < 1_100; i += 1) {
      driver.seed('sys_recycle_bin', { id: `e${i}`, object_name: 'loner', record_id: `l${i}` });
    }
    driver.finds.length = 0;

    await expect(engine.empty('loner', SYSTEM)).resolves.toBe(1_100);
    expect(entriesOf(driver)).toHaveLength(0);
    expect(driver.finds.filter((f: any) => f.object === 'sys_recycle_bin')).toHaveLength(3);

    // A driver that answers `false` for every removal cannot hold the loop,
    // even on a full page.
    for (let i = 0; i < 500; i += 1) {
      driver.seed('sys_recycle_bin', { id: `stuck${i}`, object_name: 'loner', record_id: `s${i}` });
    }
    driver.delete = async () => false;
    await expect(engine.empty('loner', SYSTEM)).resolves.toBe(0);
    expect(entriesOf(driver)).toHaveLength(500);
  });

  it('empties the entries of an object that is no longer registered', async () => {
    const { engine, driver } = await makeEngine();
    driver.seed('sys_recycle_bin', { id: 'e_gone', object_name: 'uninstalled_thing', record_id: 'x1', organization_id: 'org_1' });

    await expect(engine.empty('uninstalled_thing', ORG1_USER)).resolves.toBe(1);
    expect(entriesOf(driver)).toHaveLength(0);
  });

  it('removes nothing where the security layer refuses `purge`', async () => {
    const { engine, driver } = await makeEngine();
    refuseNonSystemPurge(engine);
    await seedEntries(engine, driver);

    await expect(engine.empty('loner', ORG1_USER)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(entriesOf(driver)).toHaveLength(5);
  });

  it('answers 0 when the composition registers no bin', async () => {
    const { engine, dispatches } = await makeEngine({ withBin: false });
    await expect(engine.empty('loner', ORG1_USER)).resolves.toBe(0);
    expect(dispatches).toEqual([]);
  });

  it.each([
    ['', 'object'],
    ['sys_thing', 'object'],
    ['cloud_anything', 'object'],
  ])('refuses %j, 400', async (object, param) => {
    const { engine, dispatches } = await makeEngine();
    await expect(engine.empty(object, SYSTEM)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400, param });
    expect(dispatches).toEqual([]);
  });
});

/**
 * [ADR-0148 D3, ruling A recorded in 6691358077] A hook bound from metadata
 * (through the hook binder) is app-authored code, and so is its in-process
 * `handler`: its `ctx.api` refuses a permanent delete as a sandboxed body's
 * does, with the same code and sentence, under the caller and under
 * `runAs: 'system'`, by id and in bulk, on every api derived from it. Its
 * ordinary delete still enters the bin; platform code keeps the permanent
 * delete.
 */
describe("an app-authored hook handler's permanent delete (ruling A)", () => {
  const RULE_SENTENCE =
    'A hook handler cannot delete a record permanently: app-authored code cannot purge; its deletes enter the recycle bin.';

  /**
   * Bind one hook through the binder, on `account`'s `beforeInsert`, whose
   * handler runs `use(ctx.api)` and keeps what it answered or threw; then fire
   * it once with an insert by `ORG1_USER`.
   */
  async function runHandler(
    engine: ObjectQL,
    runAs: 'inherit' | 'user' | 'system',
    use: (api: any) => Promise<unknown>,
  ): Promise<{ value?: unknown; error?: any }> {
    const seen: { value?: unknown; error?: any } = {};
    const bound = bindHooksToEngine(engine, [{
      name: 'purge_on_create',
      object: 'account',
      events: ['beforeInsert'],
      runAs,
      handler: async (ctx: any) => {
        try { seen.value = await use(ctx.api); } catch (e) { seen.error = e; }
      },
    } as any], { packageId: 'app_under_test' });
    expect(bound).toMatchObject({ registered: 1, errors: [] });
    await engine.insert('account', { id: 'acc_trigger', name: 'Trigger', organization_id: 'org_1' }, ORG1_USER);
    return seen;
  }

  const lonerDispatches = (dispatches: Dispatch[]) => dispatches.filter((d) => d.object === 'loner');

  for (const runAs of ['inherit', 'user', 'system'] as const) {
    for (const [shape, options] of [
      ['by id', { where: { id: 'l1' }, permanent: true }],
      ['in bulk', { where: { name: 'one' }, multi: true, permanent: true }],
    ] as const) {
      it(`runAs '${runAs}': \`delete(…, { permanent: true })\` ${shape} is refused 400 naming the rule; nothing is removed`, async () => {
        const { engine, driver, dispatches } = await makeEngine();
        driver.seed('loner', { id: 'l1', name: 'one' });

        const { error } = await runHandler(engine, runAs, (api) => api.object('loner').delete(options));

        expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, param: 'permanent', object: 'loner' });
        expect(String(error?.message).startsWith(RULE_SENTENCE)).toBe(true);
        expect(lonerDispatches(dispatches)).toEqual([]);
        expect(driver.rowsOf('loner').map((r: Row) => r.id)).toEqual(['l1']);
        expect(entriesOf(driver)).toHaveLength(0);
      });
    }
  }

  for (const [derivation, use] of [
    ['`sudo()`', (api: any) => api.sudo().object('loner').delete({ where: { id: 'l1' }, permanent: true })],
    ['`transaction(cb)`', (api: any) => api.transaction((trx: any) => trx.object('loner').delete({ where: { id: 'l1' }, permanent: true }))],
  ] as const) {
    it(`is refused the same way on the api ${derivation} derives`, async () => {
      const { engine, driver, dispatches } = await makeEngine();
      driver.seed('loner', { id: 'l1', name: 'one' });

      const { error } = await runHandler(engine, 'inherit', use);

      expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400, param: 'permanent', object: 'loner' });
      expect(String(error?.message).startsWith(RULE_SENTENCE)).toBe(true);
      expect(lonerDispatches(dispatches)).toEqual([]);
      expect(driver.rowsOf('loner').map((r: Row) => r.id)).toEqual(['l1']);
    });
  }

  it('judges the options it forwards: a `permanent` that answers differently on a second read is read once', async () => {
    const { engine, driver, dispatches } = await makeEngine();
    driver.seed('loner', { id: 'l1', name: 'one' });
    let reads = 0;
    const options = { where: { id: 'l1' }, get permanent() { reads += 1; return reads > 1; } };

    const { error } = await runHandler(engine, 'system', (api) => api.object('loner').delete(options));

    expect(error).toBeUndefined();
    expect(reads).toBe(1);
    expect(lonerDispatches(dispatches).map((d) => d.operation)).toEqual(['delete']);
    expect(entriesOf(driver).map((e) => e.record_id)).toEqual(['l1']);
  });

  for (const runAs of ['inherit', 'system'] as const) {
    for (const [label, options] of [
      ['no `permanent` key', { where: { id: 'l1' } }],
      ['`permanent: false`', { where: { id: 'l1' }, permanent: false }],
    ] as const) {
      it(`runAs '${runAs}': the handler's delete with ${label} is the ordinary delete, which enters the bin`, async () => {
        const { engine, driver, dispatches } = await makeEngine();
        driver.seed('loner', { id: 'l1', name: 'one' });

        const { error } = await runHandler(engine, runAs, (api) => api.object('loner').delete(options));

        expect(error).toBeUndefined();
        expect(lonerDispatches(dispatches).map((d) => d.operation)).toEqual(['delete']);
        expect(driver.rowsOf('loner')).toEqual([]);
        expect(entriesOf(driver).map((e) => e.record_id)).toEqual(['l1']);
      });
    }
  }

  it("platform code keeps the permanent delete: a hook registered in code, and the engine's own context", async () => {
    const { engine, driver, dispatches } = await makeEngine();
    driver.seed('loner', { id: 'l1', name: 'one' });
    driver.seed('loner', { id: 'l2', name: 'two' });
    engine.registerHook('beforeInsert', async (ctx: any) => {
      await ctx.api.object('loner').delete({ where: { id: 'l1' }, permanent: true });
    }, { object: 'account' });

    await engine.insert('account', { id: 'acc_trigger', name: 'Trigger', organization_id: 'org_1' }, ORG1_USER);
    await engine.createContext({ isSystem: true }).object('loner').delete({ where: { id: 'l2' }, permanent: true });

    expect(lonerDispatches(dispatches).map((d) => d.operation)).toEqual(['purge', 'purge']);
    expect(driver.rowsOf('loner')).toEqual([]);
    expect(entriesOf(driver)).toHaveLength(0);
  });
});
