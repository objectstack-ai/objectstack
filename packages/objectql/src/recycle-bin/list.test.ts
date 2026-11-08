// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30237 PR 5, ADR-0148 D5] The recycle bin's listing, through a real
 * `ObjectQL`: one object's entries, newest first, paged, scoped to the
 * caller's organization, for a caller whose effective permissions grant
 * `manageRecycleBin` on the object. Every other caller is refused `403`, and
 * so is every caller when no permission resolver answers: fail closed.
 *
 * Also the `object` option the REST doors pass to `restore` / `purge`: an
 * entry addressed under an object it does not belong to is not found.
 */

import { describe, it, expect, vi } from 'vitest';
import { RECYCLE_BIN_ENTRY_FIELDS } from '@objectstack/spec/data';
import { ObjectQL } from '../engine.js';

type Row = Record<string, unknown>;

/** A driver that keeps rows and honours `tenantId`, equality `where`, `orderBy`, `limit` and `offset`. */
function makeDriver() {
  const stores = new Map<string, Map<string, Row>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: Row, where: any, options: any): boolean => {
    if (options?.tenantId !== undefined && 'organization_id' in row && row.organization_id !== options.tenantId) return false;
    for (const [k, v] of Object.entries(where ?? {})) {
      if (k.startsWith('$')) continue;
      if ((row[k] ?? null) !== (v ?? null)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'primary',
    version: '0.0.0',
    supports: {},
    finds: [] as Array<{ object: string; ast: any }>,
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
    seed(o: string, row: Row) { storeFor(o).set(String(row.id), { ...row }); },
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any, options: any) {
      driver.finds.push({ object: o, ast });
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where, options));
      const order: Array<{ field: string; order?: string }> = ast?.orderBy ?? [];
      rows.sort((a, b) => {
        for (const { field, order: dir } of order) {
          const x = String(a[field]); const y = String(b[field]);
          if (x !== y) return (x < y ? -1 : 1) * (dir === 'desc' ? -1 : 1);
        }
        return 0;
      });
      const from = typeof ast?.offset === 'number' ? ast.offset : 0;
      const page = typeof ast?.limit === 'number' ? rows.slice(from, from + ast.limit) : rows.slice(from);
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
      const up = { ...s.get(String(id)), ...data, id };
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
  return driver;
}

const text = (name: string) => ({ name, type: 'text' as const });
const bin = {
  name: 'sys_recycle_bin',
  label: 'Recycle Bin Entry',
  managedBy: 'engine-owned',
  fields: {
    ...RECYCLE_BIN_ENTRY_FIELDS,
    organization_id: { name: 'organization_id', type: 'lookup' as const, reference: 'sys_organization', deleteBehavior: 'cascade' },
  },
};
const account = { name: 'account', label: 'Account', fields: { id: text('id'), name: text('name'), organization_id: text('organization_id') } };
const contact = { name: 'contact', label: 'Contact', fields: { id: text('id'), name: text('name'), organization_id: text('organization_id') } };

async function makeEngine(options: { withBin?: boolean } = {}) {
  const engine = new ObjectQL();
  engine.setTenancyPostureProvider(() => 'isolated');
  const driver = makeDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  const objects: any[] = [account, contact];
  if (options.withBin !== false) objects.push(bin);
  for (const o of objects) engine.registry.registerObject(o as any, '__test__');
  const dispatches: string[] = [];
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    dispatches.push(`${opCtx.operation}:${opCtx.object}`);
    await next();
  });
  return { engine, driver, dispatches };
}

const ORG1 = { context: { userId: 'u_alice', tenantId: 'org_1' } } as const;
const SYSTEM = { context: { isSystem: true } } as const;
const MANAGER = { account: { allowRead: true, manageRecycleBin: true } };

function entry(id: string, object: string, recordId: string, deletedAt: string, organization = 'org_1'): Row {
  return {
    id,
    object_name: object,
    record_id: recordId,
    record_count: 1,
    snapshot: { rows: [{ object, id: recordId, values: { id: recordId, name: `n_${recordId}` } }], clearedReferences: [] },
    deleted_by: 'u_bob',
    deleted_at: deletedAt,
    retention_days: 30,
    purge_after: '2026-12-31T00:00:00.000Z',
    organization_id: organization,
  };
}

/** Three account entries and one contact entry in org_1, one account entry in org_2. */
function seed(driver: any) {
  driver.seed('sys_recycle_bin', entry('e1', 'account', 'a1', '2026-11-01T00:00:00.000Z'));
  driver.seed('sys_recycle_bin', entry('e2', 'account', 'a2', '2026-11-03T00:00:00.000Z'));
  driver.seed('sys_recycle_bin', entry('e3', 'account', 'a3', '2026-11-02T00:00:00.000Z'));
  driver.seed('sys_recycle_bin', entry('e4', 'contact', 'c1', '2026-11-04T00:00:00.000Z'));
  driver.seed('sys_recycle_bin', entry('e5', 'account', 'a5', '2026-11-05T00:00:00.000Z', 'org_2'));
}

describe('listRecycleBin(object) (#30237 PR 5)', () => {
  it("answers the object's entries in the caller's organization, newest first, each with its snapshot, and dispatches nothing", async () => {
    const { engine, driver, dispatches } = await makeEngine();
    seed(driver);
    engine.registerEffectiveObjectPermissionsResolver(async () => MANAGER);

    const page = await engine.listRecycleBin('account', ORG1);

    expect(page.object).toBe('account');
    expect(page.hasMore).toBe(false);
    expect(page.entries.map((e) => e.id)).toEqual(['e2', 'e3', 'e1']);
    expect(page.entries[0]).toEqual({
      id: 'e2',
      object: 'account',
      recordId: 'a2',
      recordCount: 1,
      snapshot: { rows: [{ object: 'account', id: 'a2', values: { id: 'a2', name: 'n_a2' } }], clearedReferences: [] },
      deletedBy: 'u_bob',
      deletedAt: '2026-11-03T00:00:00.000Z',
      retentionDays: 30,
      purgeAfter: '2026-12-31T00:00:00.000Z',
    });
    expect(dispatches).toEqual([]);
  });

  it('pages by `limit` and `offset`, and says when more follow', async () => {
    const { engine, driver } = await makeEngine();
    seed(driver);
    engine.registerEffectiveObjectPermissionsResolver(async () => MANAGER);

    const first = await engine.listRecycleBin('account', { ...ORG1, limit: 2 });
    expect(first.entries.map((e) => e.id)).toEqual(['e2', 'e3']);
    expect(first.hasMore).toBe(true);
    const second = await engine.listRecycleBin('account', { ...ORG1, limit: 2, offset: 2 });
    expect(second.entries.map((e) => e.id)).toEqual(['e1']);
    expect(second.hasMore).toBe(false);
  });

  it('lists for `modifyAllRecords`, which implies the manager bit', async () => {
    const { engine, driver } = await makeEngine();
    seed(driver);
    engine.registerEffectiveObjectPermissionsResolver(async () => ({ account: { allowRead: true, modifyAllRecords: true } }));
    await expect(engine.listRecycleBin('account', ORG1)).resolves.toMatchObject({ entries: [{ id: 'e2' }, { id: 'e3' }, { id: 'e1' }] });
  });

  it('refuses, 403, when no permission resolver answers: it fails closed, and reads nothing', async () => {
    const { engine, driver } = await makeEngine();
    seed(driver);

    await expect(engine.listRecycleBin('account', ORG1)).rejects.toMatchObject({
      code: 'PERMISSION_DENIED', status: 403, httpStatus: 403, object: 'account',
    });
    expect(driver.finds).toEqual([]);
  });

  it.each([
    ['allowRestoreOwnDeleted only', { account: { allowRead: true, allowRestoreOwnDeleted: true } }],
    ['allowDelete only', { account: { allowRead: true, allowDelete: true } }],
    ['manageRecycleBin without read', { account: { allowRead: false, manageRecycleBin: true } }],
    ['manageRecycleBin on another object only', { contact: { allowRead: true, manageRecycleBin: true } }],
  ])('refuses, 403, for %s', async (_label, permissions) => {
    const { engine, driver } = await makeEngine();
    seed(driver);
    engine.registerEffectiveObjectPermissionsResolver(async () => permissions);

    await expect(engine.listRecycleBin('account', ORG1)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(driver.finds).toEqual([]);
  });

  it('refuses, 403, when the resolver throws: it fails closed', async () => {
    const { engine, driver } = await makeEngine();
    seed(driver);
    engine.registerEffectiveObjectPermissionsResolver(async () => { throw new Error('grants store down'); });
    await expect(engine.listRecycleBin('account', ORG1)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
  });

  it('lists for the system with no resolver asked', async () => {
    const { engine, driver } = await makeEngine();
    seed(driver);
    const resolver = vi.fn(async () => ({}));
    engine.registerEffectiveObjectPermissionsResolver(resolver);

    await expect(engine.listRecycleBin('account', SYSTEM)).resolves.toMatchObject({ object: 'account' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('answers no entry for a caller the tenant wall denies (no active organization)', async () => {
    const { engine, driver } = await makeEngine();
    seed(driver);
    engine.registerEffectiveObjectPermissionsResolver(async () => MANAGER);

    await expect(engine.listRecycleBin('account', { context: { userId: 'u_alice' } }))
      .resolves.toEqual({ object: 'account', entries: [], hasMore: false });
    expect(driver.finds).toEqual([]);
  });

  it('answers no entry when the composition registers no bin', async () => {
    const { engine } = await makeEngine({ withBin: false });
    engine.registerEffectiveObjectPermissionsResolver(async () => MANAGER);
    await expect(engine.listRecycleBin('account', ORG1)).resolves.toEqual({ object: 'account', entries: [], hasMore: false });
  });

  it('refuses a platform object, 400, before any permission is asked', async () => {
    const { engine } = await makeEngine();
    const resolver = vi.fn(async () => MANAGER);
    engine.registerEffectiveObjectPermissionsResolver(resolver);
    await expect(engine.listRecycleBin('sys_user', ORG1)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400, param: 'object' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it.each([
    ['limit', 0], ['limit', 201], ['limit', 1.5], ['limit', '10'], ['offset', -1], ['offset', 'x'],
  ])('refuses %s = %j, 400', async (param, value) => {
    const { engine } = await makeEngine();
    engine.registerEffectiveObjectPermissionsResolver(async () => MANAGER);
    await expect(engine.listRecycleBin('account', { ...ORG1, [param]: value } as any))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400, param });
  });
});

describe("restore / purge under an addressed object (the REST doors' `object` option)", () => {
  it('restore answers null, and dispatches nothing, for an entry of another object', async () => {
    const { engine, driver, dispatches } = await makeEngine();
    driver.seed('account', { id: 'a1', name: 'Acme', organization_id: 'org_1' });
    await engine.delete('account', { where: { id: 'a1' }, ...ORG1 });
    const entryId = String(driver.rowsOf('sys_recycle_bin')[0].id);
    dispatches.length = 0;

    await expect(engine.restore(entryId, { ...ORG1, object: 'contact' })).resolves.toBeNull();
    expect(dispatches).toEqual([]);
    expect(driver.rowsOf('sys_recycle_bin')).toHaveLength(1);

    await expect(engine.restore(entryId, { ...ORG1, object: 'account' })).resolves.toMatchObject({ entryId, recordId: 'a1' });
  });

  it('purge answers false, and dispatches nothing, for an entry of another object', async () => {
    const { engine, driver, dispatches } = await makeEngine();
    seed(driver);

    await expect(engine.purge('e1', { ...ORG1, object: 'contact' })).resolves.toBe(false);
    expect(dispatches).toEqual([]);
    expect(driver.rowsOf('sys_recycle_bin').map((e: Row) => e.id)).toContain('e1');

    await expect(engine.purge('e1', { ...ORG1, object: 'account' })).resolves.toBe(true);
    expect(dispatches).toEqual(['purge:account']);
  });
});

describe('delete(…, { onRecycleBinEntry }) tells the entry the delete wrote (#30237 PR 5)', () => {
  it('calls back with the entry id once the row is removed', async () => {
    const { engine, driver } = await makeEngine();
    driver.seed('account', { id: 'a1', name: 'Acme', organization_id: 'org_1' });
    const told: string[] = [];
    await engine.delete('account', { where: { id: 'a1' }, ...ORG1, onRecycleBinEntry: (id: string) => told.push(id) });
    const entries = driver.rowsOf('sys_recycle_bin');
    expect(entries).toHaveLength(1);
    expect(told).toEqual([String(entries[0].id)]);
  });

  it('does not call back when the delete writes no entry: permanent, no bin, or a platform object', async () => {
    const told: string[] = [];
    const onRecycleBinEntry = (id: string) => told.push(id);

    const permanent = await makeEngine();
    permanent.driver.seed('account', { id: 'a1', name: 'Acme', organization_id: 'org_1' });
    await permanent.engine.delete('account', { where: { id: 'a1' }, ...SYSTEM, permanent: true, onRecycleBinEntry });

    const noBin = await makeEngine({ withBin: false });
    noBin.driver.seed('account', { id: 'a1', name: 'Acme', organization_id: 'org_1' });
    await noBin.engine.delete('account', { where: { id: 'a1' }, ...ORG1, onRecycleBinEntry });

    expect(told).toEqual([]);
  });

  it.each([
    [false, 'not found'],
    [0, 'kept'],
  ])('does not call back when the driver answers %j (%s): no deletion an undo could reverse', async (answer) => {
    const { engine, driver } = await makeEngine();
    driver.seed('account', { id: 'a1', name: 'Acme', organization_id: 'org_1' });
    const realDelete = driver.delete;
    driver.delete = async (o: string, id: string, options: any) => {
      if (o === 'account') return answer as any;
      return realDelete(o, id, options);
    };
    const told: string[] = [];
    await engine.delete('account', { where: { id: 'a1' }, ...ORG1, onRecycleBinEntry: (id: string) => told.push(id) })
      .catch(() => undefined);
    expect(told).toEqual([]);
  });

  it('does not call back when the removal fails, and the entry goes with it', async () => {
    const { engine, driver } = await makeEngine();
    driver.seed('account', { id: 'a1', name: 'Acme', organization_id: 'org_1' });
    const realDelete = driver.delete;
    driver.delete = async (o: string, id: string, options: any) => {
      if (o === 'account') throw new Error('store down');
      return realDelete(o, id, options);
    };
    const told: string[] = [];
    await expect(engine.delete('account', { where: { id: 'a1' }, ...ORG1, onRecycleBinEntry: (id: string) => told.push(id) }))
      .rejects.toThrow('store down');
    expect(told).toEqual([]);
    expect(driver.rowsOf('sys_recycle_bin')).toHaveLength(0);
  });
});
