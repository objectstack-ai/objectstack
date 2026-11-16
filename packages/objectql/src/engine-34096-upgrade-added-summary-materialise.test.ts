// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34096] A roll-up `summary` field that a package install or upgrade adds
 * reads, on the parent rows stored before it, what a new row with the same
 * children reads, with no child write.
 *
 * The upgrade here is the shape the install door drives: the running engine
 * already holds version 1 of a package (registered at boot, which seals the
 * set of roll-ups the stored rows were computed for), rows are written, and
 * version 2 is registered with `objectExtensions` that add a `sum`, a `count`
 * and a `max` roll-up to an object that already has parent and child rows.
 * Then the door asks the engine for its schema sync (`ObjectQL.syncSchemas`),
 * as `MarketplaceInstallLocal` does after its hot register.
 *
 * Before the fix the new columns stayed `null` on every pre-upgrade parent
 * until one of its children was written, while a parent created after the
 * upgrade read `0` for the same empty child set.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';
import { backfillSummaryNulls } from './summary-backfill.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const checkOp = (value: any, cond: any): boolean => {
    if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) return value === cond;
    return Object.entries(cond).every(([op, target]: [string, any]) => {
      switch (op) {
        case '$eq': return value === target;
        case '$ne': return value !== target;
        case '$gt': return value > target;
        case '$gte': return value >= target;
        case '$lt': return value < target;
        case '$lte': return value <= target;
        case '$in': return Array.isArray(target) && target.includes(value);
        case '$nin': return Array.isArray(target) && !target.includes(value);
        default: return true;
      }
    });
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (k === '$not') return !matches(row, v);
      return checkOp(row?.[k], v);
    });
  };
  let n = 0;
  /** Every driver write, by verb and object, so a case can say what moved. */
  const writes: Array<{ verb: string; object: string; id?: string; data?: Record<string, unknown> }> = [];
  /** Every driver read, by object, so a case can say a sync read nothing. */
  const reads: string[] = [];
  /** Ids whose next `update` throws, to drive a failed backfill row. */
  const failUpdateOf = new Set<string>();
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(object: string, ast: any) {
      reads.push(object);
      let rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // Keyset order (`id` ascending) so the backfill's walk pages as on a real driver.
      rows = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      reads.push(object);
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${String(n).padStart(4, '0')}`;
      const row = { ...data, id };
      writes.push({ verb: 'create', object, id, data });
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      if (failUpdateOf.has(id)) throw new Error(`fake driver: update of ${id} refused`);
      writes.push({ verb: 'update', object, id, data });
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async updateMany() { return 0; },
    async delete(object: string, id: string) { writes.push({ verb: 'delete', object, id }); return storeFor(object).delete(id); },
    async deleteMany() { return 0; },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(object, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor, writes, reads, failUpdateOf };
}

const APP = 'com.qa.o2c';
const CONTRACT = 'qx_contract';
const INVOICE = 'qx_invoice';
const INVOICED = 'invoiced_amount';
const INVOICE_COUNT = 'invoice_count';
const LAST_INVOICE = 'largest_invoice';

const contract = { name: CONTRACT, label: 'Contract', fields: { title: { name: 'title', type: 'text', label: 'Title' } } };
const invoice = {
  name: INVOICE, label: 'Invoice',
  fields: {
    amount: { name: 'amount', type: 'number', label: 'Amount' },
    contract: { name: 'contract', type: 'lookup', label: 'Contract', reference: CONTRACT },
  },
};
const ROLLUPS = {
  [INVOICED]: { name: INVOICED, type: 'summary', label: 'Invoiced', summaryOperations: { object: INVOICE, field: 'amount', function: 'sum' } },
  [INVOICE_COUNT]: { name: INVOICE_COUNT, type: 'summary', label: 'Invoices', summaryOperations: { object: INVOICE, function: 'count' } },
  [LAST_INVOICE]: { name: LAST_INVOICE, type: 'summary', label: 'Largest invoice', summaryOperations: { object: INVOICE, field: 'amount', function: 'max' } },
};

/** Version 1: the objects, no roll-up. */
const v1 = { id: APP, name: 'o2c', version: '6.2.0', objects: [contract, invoice] };
/** Version 2: the same objects, and the roll-ups added by extension. */
const v2 = { ...v1, version: '6.3.0', objectExtensions: [{ extend: CONTRACT, fields: ROLLUPS }] };
/** Version 3: nothing new about roll-ups. */
const v3 = { ...v2, version: '6.4.0' };

/**
 * The end of the boot: every package of this boot is registered, and the
 * roll-ups present now are the ones the stored rows were computed for. The
 * plugin calls this at `kernel:bootstrapped`. Read optionally so that, on a
 * build without it, this file reads red on the defect itself rather than on a
 * missing method.
 */
function bootCompleted(engine: ObjectQL): void {
  (engine as unknown as { sealSummariesMaterialisedAtBoot?: () => unknown }).sealSummariesMaterialisedAtBoot?.call(engine);
}

describe('#34096 — a roll-up an upgrade adds is materialised on the rows stored before it', () => {
  let engine: ObjectQL;
  let d: ReturnType<typeof makeDriver>;
  let logger: Record<'debug' | 'info' | 'warn' | 'error', ReturnType<typeof vi.fn>> & Record<string, unknown>;
  const SYS = { context: { isSystem: true } } as const;

  beforeEach(async () => {
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn(), fatal: vi.fn() };
    logger.child = () => logger;
    engine = new ObjectQL({ logger });
    d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registerApp(v1);
    bootCompleted(engine);
  });

  const read = async (id: string) => engine.findOne(CONTRACT, { where: { id }, ...SYS });

  /** Two contracts with invoices and one without, all stored under version 1. */
  async function storeUnderV1() {
    const acme = await engine.insert(CONTRACT, { title: 'acme' }, SYS);
    const beta = await engine.insert(CONTRACT, { title: 'beta' }, SYS);
    const idle = await engine.insert(CONTRACT, { title: 'idle' }, SYS);
    await engine.insert(INVOICE, { contract: acme.id, amount: 36000 }, SYS);
    await engine.insert(INVOICE, { contract: acme.id, amount: 4000 }, SYS);
    await engine.insert(INVOICE, { contract: beta.id, amount: 700 }, SYS);
    return { acme, beta, idle };
  }

  async function upgrade(body: Record<string, unknown>) {
    engine.registerApp(body);
    await engine.syncSchemas();
  }

  it('every pre-upgrade parent reads its computed value after the upgrade, with no child write', async () => {
    const { acme, beta, idle } = await storeUnderV1();
    const before = d.writes.length;

    await upgrade(v2);

    expect(d.writes.slice(before).filter((w) => w.object === INVOICE)).toEqual([]);
    expect(await read(acme.id)).toMatchObject({ [INVOICED]: 40000, [INVOICE_COUNT]: 2, [LAST_INVOICE]: 36000 });
    expect(await read(beta.id)).toMatchObject({ [INVOICED]: 700, [INVOICE_COUNT]: 1, [LAST_INVOICE]: 700 });
    // A parent with no children: `count`/`sum` read 0 (their empty-set value),
    // `max` reads null (undefined on an empty set) — what a new row reads.
    const idleRow = await read(idle.id);
    expect(idleRow?.[INVOICED]).toBe(0);
    expect(idleRow?.[INVOICE_COUNT]).toBe(0);
    expect(idleRow?.[LAST_INVOICE] ?? null).toBeNull();
  });

  it('a pre-upgrade parent reads exactly what a new parent with the same children reads', async () => {
    const { acme, idle } = await storeUnderV1();
    await upgrade(v2);

    const fresh = await engine.insert(CONTRACT, { title: 'fresh' }, SYS);
    const freshIdle = await engine.insert(CONTRACT, { title: 'fresh idle' }, SYS);
    await engine.insert(INVOICE, { contract: fresh.id, amount: 36000 }, SYS);
    await engine.insert(INVOICE, { contract: fresh.id, amount: 4000 }, SYS);

    const pick = (row: any) => ({
      [INVOICED]: row?.[INVOICED], [INVOICE_COUNT]: row?.[INVOICE_COUNT], [LAST_INVOICE]: row?.[LAST_INVOICE] ?? null,
    });
    expect(pick(await read(acme.id))).toEqual(pick(await read(fresh.id)));
    expect(pick(await read(idle.id))).toEqual(pick(await read(freshIdle.id)));
  });

  it('a second upgrade that adds no roll-up reads and writes nothing for roll-ups', async () => {
    await storeUnderV1();
    await upgrade(v2);
    const writesBefore = d.writes.length;
    const readsBefore = d.reads.length;

    await upgrade(v3);

    expect(d.writes.slice(writesBefore)).toEqual([]);
    expect(d.reads.slice(readsBefore)).toEqual([]);
  });

  it('a roll-up present when the boot completed is not walked by a later sync', async () => {
    // A boot that already carries version 2 (a restart of an upgraded
    // deployment, or the install-local rehydrate at `kernel:ready`).
    const booted = new ObjectQL({ logger });
    const d2 = makeDriver();
    booted.registerDriver(d2.driver, true);
    await booted.init();
    booted.registerApp(v2);
    await booted.syncSchemas();
    bootCompleted(booted);
    const readsBefore = d2.reads.length;

    await booted.syncSchemas();

    expect(d2.reads.slice(readsBefore)).toEqual([]);
    expect(d2.writes).toEqual([]);
  });

  it('writes the parent as the system, in no organization, and fires no hook of the child object', async () => {
    const { acme } = await storeUnderV1();
    const childHooks = vi.fn();
    for (const event of ['beforeInsert', 'afterInsert', 'beforeUpdate', 'afterUpdate']) {
      engine.registerHook(event, childHooks, { object: INVOICE });
    }
    const observed: Array<{ object: string; operation: string; isSystem: boolean; tenantId: unknown }> = [];
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      observed.push({
        object: opCtx.object, operation: opCtx.operation,
        isSystem: opCtx.context?.isSystem === true, tenantId: opCtx.context?.tenantId,
      });
      return next();
    });

    await upgrade(v2);

    expect(childHooks).not.toHaveBeenCalled();
    expect((await read(acme.id))?.[INVOICED]).toBe(40000);
    const parentUpdates = observed.filter((o) => o.object === CONTRACT && o.operation === 'update');
    expect(parentUpdates.length).toBeGreaterThan(0);
    for (const op of parentUpdates) expect(op).toMatchObject({ isSystem: true, tenantId: undefined });
    expect(observed.filter((o) => o.object === INVOICE && o.operation !== 'find' && o.operation !== 'aggregate')).toEqual([]);
  });

  it('an interrupted backfill is retried by the next sync, and the re-run fills only what is still null', async () => {
    const { acme, beta } = await storeUnderV1();
    d.failUpdateOf.add(acme.id);

    await upgrade(v2);

    expect((await read(beta.id))?.[INVOICED]).toBe(700);
    expect((await read(acme.id))?.[INVOICED] ?? null).toBeNull();
    const said = logger.error.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('[summary-materialise]'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(`${CONTRACT}.${INVOICED}`);
    expect(said[0]).toContain('os migrate summary-nulls --apply');

    d.failUpdateOf.clear();
    const writesBefore = d.writes.length;
    await engine.syncSchemas();

    expect((await read(acme.id))).toMatchObject({ [INVOICED]: 40000, [INVOICE_COUNT]: 2, [LAST_INVOICE]: 36000 });
    // Only the row the first run could not write is written again.
    const rewritten = new Set(d.writes.slice(writesBefore).filter((w) => w.object === CONTRACT).map((w) => w.id));
    expect([...rewritten]).toEqual([acme.id]);
  });
});

describe('#34096 — the ObjectQL plugin records the boot\'s roll-ups, so an install door after it materialises', () => {
  it('an upgrade after a real kernel boot fills the pre-upgrade parents', async () => {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    const d = makeDriver();
    await kernel.use({
      name: 'qx-store-plugin', type: 'driver', version: '1.0.0',
      init: async (ctx: any) => { ctx.registerService('driver.memory', d.driver); },
    } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    try {
      const engine = kernel.getService<ObjectQL>('objectql');
      engine.registerApp(v1);
      await engine.syncSchemas();
      const SYS = { context: { isSystem: true } } as const;
      const acme = await engine.insert(CONTRACT, { title: 'acme' }, SYS);
      await engine.insert(INVOICE, { contract: acme.id, amount: 36000 }, SYS);

      engine.registerApp(v2);
      await engine.syncSchemas();

      const row = await engine.findOne(CONTRACT, { where: { id: acme.id }, ...SYS });
      expect(row).toMatchObject({ [INVOICED]: 36000, [INVOICE_COUNT]: 1, [LAST_INVOICE]: 36000 });
    } finally {
      await kernel.shutdown();
    }
  });
});

/**
 * The install door's writes are end-state data, not user events: its seed
 * writes carry `skipAutomations`, and so does this walk's parent write. No
 * metadata-bound hook or record-change flow runs on a backfilled parent,
 * while the engine's own roll-up recompute does, so a chained roll-up moves.
 * `os migrate summary-nulls` is the operator's run, at the operator's time,
 * and keeps firing them.
 */
describe('#34096 — the install walk runs no automation on the parents it backfills', () => {
  const ACCOUNT = 'qx_account';
  const ROLLED = 'contracts_invoiced';
  const account = { name: ACCOUNT, label: 'Account', fields: { title: { name: 'title', type: 'text', label: 'Title' } } };
  const contractOfAccount = {
    ...contract,
    fields: { ...contract.fields, account: { name: 'account', type: 'lookup', label: 'Account', reference: ACCOUNT } },
  };
  const c1 = { id: APP, name: 'o2c', version: '6.2.0', objects: [account, contractOfAccount, invoice] };
  // The upgrade adds the contract roll-ups AND one on the account over the
  // contract's new `invoiced_amount`: the account is a parent of a parent.
  const c2 = {
    ...c1, version: '6.3.0',
    objectExtensions: [
      { extend: CONTRACT, fields: ROLLUPS },
      { extend: ACCOUNT, fields: { [ROLLED]: { name: ROLLED, type: 'summary', label: 'Invoiced over contracts', summaryOperations: { object: CONTRACT, field: INVOICED, function: 'sum' } } } },
    ],
  };
  const SYS = { context: { isSystem: true } } as const;

  async function setUp(opts: { sealed: boolean }) {
    const logger: any = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn(), fatal: vi.fn() };
    logger.child = () => logger;
    const engine = new ObjectQL({ logger });
    const d = makeDriver();
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registerApp(c1);
    if (opts.sealed) bootCompleted(engine);
    const firm = await engine.insert(ACCOUNT, { title: 'firm' }, SYS);
    const acme = await engine.insert(CONTRACT, { title: 'acme', account: firm.id }, SYS);
    await engine.insert(INVOICE, { contract: acme.id, amount: 36000 }, SYS);
    await engine.insert(INVOICE, { contract: acme.id, amount: 4000 }, SYS);
    // A metadata-bound hook on the parent, bound as an app binds one.
    const boundCalls: string[] = [];
    engine.bindHooks([
      { name: 'contract_touch', object: CONTRACT, events: ['beforeUpdate', 'afterUpdate'], handler: async (ctx: any) => { boundCalls.push(ctx.event); } },
    ] as any, { packageId: APP });
    const parentWrites: Array<{ skipAutomations: unknown }> = [];
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (opCtx.object === CONTRACT && opCtx.operation === 'update') parentWrites.push({ skipAutomations: opCtx.context?.skipAutomations });
      return next();
    });
    engine.registerApp(c2);
    return { engine, firm, acme, boundCalls, parentWrites, logger };
  }

  it('writes each backfilled parent with skipAutomations, and its metadata-bound update hook does not fire', async () => {
    const { engine, acme, boundCalls, parentWrites } = await setUp({ sealed: true });
    await engine.syncSchemas();

    expect((await engine.findOne(CONTRACT, { where: { id: acme.id }, ...SYS }))?.[INVOICED]).toBe(40000);
    expect(parentWrites.length).toBeGreaterThan(0);
    for (const w of parentWrites) expect(w.skipAutomations).toBe(true);
    expect(boundCalls).toEqual([]);
  });

  it('still recomputes a chained roll-up: the account over the contracts it just filled', async () => {
    const { engine, firm } = await setUp({ sealed: true });
    await engine.syncSchemas();

    expect((await engine.findOne(ACCOUNT, { where: { id: firm.id }, ...SYS }))?.[ROLLED]).toBe(40000);
  });

  it('CONTROL — the operator backfill (os migrate summary-nulls) writes with automations on, as before', async () => {
    const { engine, acme, boundCalls, parentWrites, logger } = await setUp({ sealed: false });
    // Unsealed: the door's sync walks nothing, so only the operator's run writes.
    await engine.syncSchemas();
    expect(parentWrites).toEqual([]);

    await backfillSummaryNulls(engine, logger, { apply: true, recomputeUndefinedOnEmpty: [`${CONTRACT}.${LAST_INVOICE}`] });

    expect((await engine.findOne(CONTRACT, { where: { id: acme.id }, ...SYS }))?.[INVOICED]).toBe(40000);
    expect(parentWrites.length).toBeGreaterThan(0);
    for (const w of parentWrites) expect(w.skipAutomations).toBeUndefined();
    expect(boundCalls).toContain('beforeUpdate');
  });
});

