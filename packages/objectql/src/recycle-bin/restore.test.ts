// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30237, ADR-0148 D2] The recycle bin's restore, through a real `ObjectQL`:
 * an entry deleted through the engine's own delete is written back under its
 * original ids, master first, with no insert hook run; its cleared references
 * are re-linked while nothing has changed them; roll-ups recompute; one
 * `data.record.restored` is published per row; and the entry goes. The three
 * 409 refusals each write nothing and keep the entry.
 *
 * The driver keeps real rows and honours `options.tenantId` the way the SQL
 * driver does (`organization_id = :tenant`), and declares no transactions, so
 * the restore's own write-by-write undo is what keeps a failed restore from
 * leaving rows behind.
 */

import { describe, it, expect, vi } from 'vitest';
import { RECYCLE_BIN_ENTRY_FIELDS, RECORD_RESTORED_EVENT } from '@objectstack/spec/data';
import { ObjectQL } from '../engine.js';
import { relinkedValue } from './restore.js';

type Row = Record<string, unknown>;

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
    /** When set, `create` of this object refuses as a store's unique constraint would. */
    refuseCreateOf: undefined as string | undefined,
    rowsOf: (o: string) => Array.from(storeFor(o).values()),
    rowOf: (o: string, id: string) => storeFor(o).get(id),
    seed(o: string, row: Row) { storeFor(o).set(String(row.id), { ...row }); },
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(o: string, ast: any, options: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where, options));
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map((r) => ({ ...r }));
    },
    async findOne(o: string, ast: any, options: any) {
      for (const r of storeFor(o).values()) if (matches(r, ast?.where, options)) return { ...r };
      return null;
    },
    async create(o: string, data: Row) {
      if (driver.refuseCreateOf === o) {
        const err: any = new Error('UNIQUE constraint failed: contact.email');
        err.code = 'SQLITE_CONSTRAINT_UNIQUE';
        throw err;
      }
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
/** account ← contact (master_detail); account has a unique `code`. */
const account = {
  name: 'account',
  label: 'Account',
  fields: {
    id: text('id'),
    name: text('name'),
    code: { name: 'code', type: 'text' as const, unique: true },
    created_by: text('created_by'),
    created_at: text('created_at'),
    organization_id: text('organization_id'),
  },
};
const contact = {
  name: 'contact',
  label: 'Contact',
  fields: {
    id: text('id'),
    name: text('name'),
    account: { name: 'account', type: 'master_detail' as const, reference: 'account' },
    organization_id: text('organization_id'),
  },
};
/** A live row pointing at an account by a single-valued and a multi-valued `set_null` lookup. */
const deal = {
  name: 'deal',
  label: 'Deal',
  fields: {
    id: text('id'),
    name: text('name'),
    primary_account: { name: 'primary_account', type: 'lookup' as const, reference: 'account', deleteBehavior: 'set_null' },
    accounts: { name: 'accounts', type: 'lookup' as const, reference: 'account', multiple: true, deleteBehavior: 'set_null' },
    organization_id: text('organization_id'),
  },
};

interface Dispatch { object: string; operation: string; hasAst: boolean; hasId: boolean }

async function makeEngine(options: { withBin?: boolean } = {}) {
  const engine = new ObjectQL();
  engine.setTenancyPostureProvider(() => 'isolated');
  const driver = makeDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  const objects: any[] = [account, contact, deal];
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
  const published: Array<{ type: string; object: string; recordId: string; organizationId?: string }> = [];
  engine.setRealtimeService({
    publish: async (envelope: any) => {
      published.push({
        type: envelope.type,
        object: envelope.object,
        recordId: envelope.payload?.recordId,
        organizationId: envelope.payload?.organizationId,
      });
    },
  } as any);
  return { engine, driver, dispatches, published };
}

/**
 * plugin-security's posture until it maps `restore` to its grants: the
 * destructive verb, unmapped, is refused for every caller but the system.
 */
function refuseNonSystemRestore(engine: ObjectQL) {
  engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
    if (opCtx.operation === 'restore' && opCtx.context?.isSystem !== true) {
      const err: any = new Error(`[Security] Access denied: restore on '${opCtx.object}'`);
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
const entryOf = (driver: any, record: string) => entriesOf(driver).find((e) => e.record_id === record)!;

const ACME = { id: 'acc1', name: 'Acme', code: 'ACME', created_by: 'u_carol', created_at: '2026-01-02T03:04:05.000Z', organization_id: 'org_1' };

/** Seed Acme with two contacts and delete it, so one entry holds all three rows. */
async function deleteAcme(engine: ObjectQL, driver: any) {
  driver.seed('account', ACME);
  driver.seed('contact', { id: 'c1', name: 'Ann', account: 'acc1', organization_id: 'org_1' });
  driver.seed('contact', { id: 'c2', name: 'Ben', account: 'acc1', organization_id: 'org_1' });
  await engine.delete('account', { where: { id: 'acc1' }, ...ORG1_USER });
  return entryOf(driver, 'acc1').id as string;
}

describe('restore(entryId)', () => {
  it('writes the entry back under its original ids, master first, as one `restore` dispatch, and removes the entry', async () => {
    const { engine, driver, dispatches } = await makeEngine();
    const entryId = await deleteAcme(engine, driver);
    expect(driver.rowsOf('account')).toHaveLength(0);
    expect(driver.rowsOf('contact')).toHaveLength(0);
    dispatches.length = 0;

    const result = await engine.restore(entryId, ORG1_USER);

    expect(result).toEqual({
      entryId,
      object: 'account',
      recordId: 'acc1',
      rows: [{ object: 'account', id: 'acc1' }, { object: 'contact', id: 'c1' }, { object: 'contact', id: 'c2' }],
      relinked: 0,
    });
    expect(driver.rowOf('account', 'acc1')).toEqual(ACME);
    expect(driver.rowOf('contact', 'c1')).toMatchObject({ name: 'Ann', account: 'acc1' });
    expect(driver.rowOf('contact', 'c2')).toMatchObject({ name: 'Ben', account: 'acc1' });
    expect(entriesOf(driver)).toHaveLength(0);
    expect(dispatches).toEqual([{ object: 'account', operation: 'restore', hasAst: false, hasId: false }]);
  });

  it('keeps `created_by` / `created_at` as the snapshot holds them', async () => {
    const { engine, driver } = await makeEngine();
    const entryId = await deleteAcme(engine, driver);
    await engine.restore(entryId, SYSTEM);
    expect(driver.rowOf('account', 'acc1')).toMatchObject({ created_by: 'u_carol', created_at: '2026-01-02T03:04:05.000Z' });
  });

  it('runs no insert hook: a restore is not a create', async () => {
    const { engine, driver } = await makeEngine();
    const entryId = await deleteAcme(engine, driver);
    const fired: string[] = [];
    for (const event of ['beforeInsert', 'afterInsert']) {
      engine.registerHook(event, async (ctx: any) => { fired.push(`${event}:${ctx.object}`); }, { object: ['account', 'contact'] });
    }

    await engine.restore(entryId, ORG1_USER);

    expect(driver.rowsOf('account')).toHaveLength(1);
    expect(fired).toEqual([]);
  });

  it('publishes one `data.record.restored` per row, master first, and no create event', async () => {
    const { engine, driver, published } = await makeEngine();
    const entryId = await deleteAcme(engine, driver);
    published.length = 0;

    await engine.restore(entryId, ORG1_USER);

    expect(RECORD_RESTORED_EVENT).toBe('data.record.restored');
    expect(published).toEqual([
      { type: RECORD_RESTORED_EVENT, object: 'account', recordId: 'acc1', organizationId: 'org_1' },
      { type: RECORD_RESTORED_EVENT, object: 'contact', recordId: 'c1', organizationId: 'org_1' },
      { type: RECORD_RESTORED_EVENT, object: 'contact', recordId: 'c2', organizationId: 'org_1' },
    ]);
  });

  it('recomputes roll-ups from the rows that are back, one call per object', async () => {
    const { engine, driver } = await makeEngine();
    const entryId = await deleteAcme(engine, driver);
    const recompute = vi.spyOn(engine as any, 'recomputeSummaries');

    await engine.restore(entryId, ORG1_USER);

    expect(recompute.mock.calls.map((c) => [c[0], (c[1] as Row[]).map((r) => r.id), c[2]])).toEqual([
      ['account', ['acc1'], null],
      ['contact', ['c1', 'c2'], null],
    ]);
  });

  it("answers null for another organization's entry, and leaves it", async () => {
    const { engine, driver } = await makeEngine();
    const entryId = await deleteAcme(engine, driver);
    await expect(engine.restore(entryId, ORG2_USER)).resolves.toBeNull();
    expect(entriesOf(driver)).toHaveLength(1);
    expect(driver.rowsOf('account')).toHaveLength(0);
  });

  it('answers null for an id no entry has, and when the composition registers no bin', async () => {
    const withBin = await makeEngine();
    await expect(withBin.engine.restore('no_such_entry', ORG1_USER)).resolves.toBeNull();

    const noBin = await makeEngine({ withBin: false });
    await expect(noBin.engine.restore('no_such_entry', ORG1_USER)).resolves.toBeNull();
    expect(noBin.dispatches).toEqual([]);
  });

  it.each([[''], [null], [{ id: 'x' }]])('refuses %j as the entry id, 400', async (entryId) => {
    const { engine, dispatches } = await makeEngine();
    await expect(engine.restore(entryId as any, ORG1_USER)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400, param: 'entryId' });
    expect(dispatches).toEqual([]);
  });

  it('restores nothing where the security layer refuses `restore`; the system restores', async () => {
    const { engine, driver } = await makeEngine();
    refuseNonSystemRestore(engine);
    const entryId = await deleteAcme(engine, driver);

    await expect(engine.restore(entryId, ORG1_USER)).rejects.toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
    expect(driver.rowsOf('account')).toHaveLength(0);
    expect(entriesOf(driver)).toHaveLength(1);

    await expect(engine.restore(entryId, SYSTEM)).resolves.toMatchObject({ recordId: 'acc1' });
    expect(driver.rowsOf('account')).toHaveLength(1);
    expect(entriesOf(driver)).toHaveLength(0);
  });
});

describe('re-linking the references the delete cleared (ADR-0148 D2)', () => {
  /**
   * Acme deleted while a deal points at it. The single-valued clear is the
   * engine's own; the multi-valued one is written into the entry and the row
   * by hand, the shape the cascade records (`remainderAfterMemberRemoval`), so
   * this suite does not depend on how this double answers a multi-valued probe.
   */
  async function deleteReferencedAcme() {
    const made = await makeEngine();
    const { engine, driver } = made;
    driver.seed('account', ACME);
    driver.seed('account', { id: 'acc2', name: 'Beta', code: 'BETA', organization_id: 'org_1' });
    driver.seed('deal', { id: 'd1', name: 'One', primary_account: 'acc1', accounts: ['acc2'], organization_id: 'org_1' });
    await engine.delete('account', { where: { id: 'acc1' }, ...ORG1_USER });
    expect(driver.rowOf('deal', 'd1')).toMatchObject({ primary_account: null, accounts: ['acc2'] });
    const entry = entryOf(driver, 'acc1');
    const snapshot = entry.snapshot as { clearedReferences: unknown[] };
    expect(snapshot.clearedReferences).toEqual([{ object: 'deal', id: 'd1', field: 'primary_account', value: 'acc1' }]);
    snapshot.clearedReferences.push({ object: 'deal', id: 'd1', field: 'accounts', value: 'acc1' });
    return { ...made, entryId: entry.id as string };
  }

  it('re-links both arities while nothing has changed them since', async () => {
    const { engine, driver, entryId } = await deleteReferencedAcme();
    const result = await engine.restore(entryId, ORG1_USER);
    expect(result?.relinked).toBe(2);
    expect(driver.rowOf('deal', 'd1')).toMatchObject({ primary_account: 'acc1', accounts: ['acc2', 'acc1'] });
  });

  it('leaves a single-valued reference somebody pointed elsewhere since where they put it', async () => {
    const { engine, driver, entryId } = await deleteReferencedAcme();
    await engine.update('deal', { id: 'd1', primary_account: 'acc2' }, ORG1_USER as any);

    const result = await engine.restore(entryId, ORG1_USER);

    // The multi-valued field no longer holds the member, so it is re-linked;
    // the single-valued one holds another value, so it stays.
    expect(result?.relinked).toBe(1);
    expect(driver.rowOf('deal', 'd1')).toMatchObject({ primary_account: 'acc2', accounts: ['acc2', 'acc1'] });
  });

  it('skips a referencing row that is gone', async () => {
    const { engine, driver, entryId } = await deleteReferencedAcme();
    await engine.delete('deal', { where: { id: 'd1' }, permanent: true, ...ORG1_USER });
    await expect(engine.restore(entryId, ORG1_USER)).resolves.toMatchObject({ relinked: 0 });
    expect(driver.rowOf('account', 'acc1')).toBeDefined();
  });

  it.each([
    ['single, empty', { type: 'lookup' }, null, 'a', 'a'],
    ['single, held', { type: 'lookup' }, 'b', 'a', undefined],
    ['multi, member gone', { type: 'lookup', multiple: true }, ['b'], 'a', ['b', 'a']],
    ['multi, empty', { type: 'lookup', multiple: true }, null, 'a', ['a']],
    ['multi, member held', { type: 'lookup', multiple: true }, ['a', 'b'], 'a', undefined],
  ])('relinkedValue: %s', (_label, field, current, value, expected) => {
    expect(relinkedValue(field, current, value)).toEqual(expected);
  });
});

describe('the three refusals (409, ADR-0148 D2): nothing is written and the entry stays', () => {
  it('RESTORE_PACKAGE_UNINSTALLED: an object of the entry is no longer registered', async () => {
    const { engine, driver } = await makeEngine();
    const entryId = await deleteAcme(engine, driver);
    engine.registry.unregisterObject('contact', { force: true });

    await expect(engine.restore(entryId, ORG1_USER)).rejects.toMatchObject({
      code: 'RESTORE_PACKAGE_UNINSTALLED', status: 409, object: 'contact', entryId,
    });
    expect(driver.rowsOf('account')).toHaveLength(0);
    expect(entriesOf(driver)).toHaveLength(1);
  });

  it('RESTORE_PARENT_PURGED: a detail whose master was deleted for good', async () => {
    const { engine, driver } = await makeEngine();
    driver.seed('account', ACME);
    driver.seed('contact', { id: 'c1', name: 'Ann', account: 'acc1', organization_id: 'org_1' });
    await engine.delete('contact', { where: { id: 'c1' }, ...ORG1_USER });
    await engine.delete('account', { where: { id: 'acc1' }, permanent: true, ...ORG1_USER });
    const entryId = entryOf(driver, 'c1').id as string;

    await expect(engine.restore(entryId, ORG1_USER)).rejects.toMatchObject({
      code: 'RESTORE_PARENT_PURGED', status: 409, object: 'contact', recordId: 'c1', field: 'account',
      parentObject: 'account', parentId: 'acc1',
    });
    await expect(engine.restore(entryId, ORG1_USER)).rejects.not.toHaveProperty('parentEntryId');
    expect(driver.rowsOf('contact')).toHaveLength(0);
    expect(entriesOf(driver)).toHaveLength(1);
  });

  it('RESTORE_PARENT_PURGED (known gap): a detail whose master is the record of another entry; restoring that one first succeeds', async () => {
    const { engine, driver } = await makeEngine();
    driver.seed('account', ACME);
    driver.seed('contact', { id: 'c1', name: 'Ann', account: 'acc1', organization_id: 'org_1' });
    await engine.delete('contact', { where: { id: 'c1' }, ...ORG1_USER });
    await engine.delete('account', { where: { id: 'acc1' }, ...ORG1_USER });
    const contactEntry = entryOf(driver, 'c1').id as string;
    const accountEntry = entryOf(driver, 'acc1').id as string;

    await expect(engine.restore(contactEntry, ORG1_USER)).rejects.toMatchObject({
      code: 'RESTORE_PARENT_PURGED', status: 409, parentObject: 'account', parentId: 'acc1', parentEntryId: accountEntry,
    });
    expect(driver.rowsOf('contact')).toHaveLength(0);
    expect(entriesOf(driver)).toHaveLength(2);

    await engine.restore(accountEntry, ORG1_USER);
    await expect(engine.restore(contactEntry, ORG1_USER)).resolves.toMatchObject({ recordId: 'c1' });
    expect(driver.rowOf('contact', 'c1')).toMatchObject({ account: 'acc1' });
  });

  it('RESTORE_UNIQUE_VALUE_TAKEN: a live row holds a unique value of a snapshotted row', async () => {
    const { engine, driver } = await makeEngine();
    const entryId = await deleteAcme(engine, driver);
    driver.seed('account', { id: 'acc9', name: 'Acme Two', code: 'ACME', organization_id: 'org_1' });

    await expect(engine.restore(entryId, ORG1_USER)).rejects.toMatchObject({
      code: 'RESTORE_UNIQUE_VALUE_TAKEN', status: 409, object: 'account', recordId: 'acc1', field: 'code', entryId,
    });
    expect(driver.rowOf('account', 'acc1')).toBeUndefined();
    expect(driver.rowsOf('contact')).toHaveLength(0);
    expect(entriesOf(driver)).toHaveLength(1);
  });

  it("RESTORE_UNIQUE_VALUE_TAKEN: a per-organization unique value held in another organization does not refuse", async () => {
    const { engine, driver } = await makeEngine();
    const entryId = await deleteAcme(engine, driver);
    driver.seed('account', { id: 'acc9', name: 'Elsewhere', code: 'ACME', organization_id: 'org_2' });
    await expect(engine.restore(entryId, SYSTEM)).resolves.toMatchObject({ recordId: 'acc1' });
  });

  it('RESTORE_UNIQUE_VALUE_TAKEN: a live row holds the id', async () => {
    const { engine, driver } = await makeEngine();
    const entryId = await deleteAcme(engine, driver);
    driver.seed('contact', { id: 'c2', name: 'Someone else', organization_id: 'org_1' });

    await expect(engine.restore(entryId, ORG1_USER)).rejects.toMatchObject({
      code: 'RESTORE_UNIQUE_VALUE_TAKEN', status: 409, object: 'contact', recordId: 'c2', field: 'id',
    });
    expect(driver.rowsOf('account')).toHaveLength(0);
    expect(entriesOf(driver)).toHaveLength(1);
  });

  it("RESTORE_UNIQUE_VALUE_TAKEN: the store's own unique violation at the write, with every earlier write undone", async () => {
    const { engine, driver } = await makeEngine();
    const entryId = await deleteAcme(engine, driver);
    driver.refuseCreateOf = 'contact';

    await expect(engine.restore(entryId, ORG1_USER)).rejects.toMatchObject({
      code: 'RESTORE_UNIQUE_VALUE_TAKEN', status: 409, object: 'contact', recordId: 'c1', entryId,
    });
    // The master was written first and is undone: no transaction covers it here.
    expect(driver.rowsOf('account')).toHaveLength(0);
    expect(entriesOf(driver)).toHaveLength(1);
  });
});
