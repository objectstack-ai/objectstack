// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30377] A roll-up summary a package contributes BY EXTENSION, over a child
 * of an ENABLED package, is current again the moment its package is
 * re-enabled.
 *
 * While a package is disabled its `objectExtensions` fields are withheld from
 * the served object fold (#30304), so the roll-up index — built from that fold
 * — does not hold the package's summary, and the child writes made during the
 * disable recompute nothing. The child here belongs to the enabled app, so
 * those writes land; the stored summary column keeps the value it had when the
 * package was switched off. Re-enabling serves the field again, so without a
 * recompute it serves that stale value until the next write of a child.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectQL } from './engine.js';

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
  /** Parent-row writes, by object, so a case can count them. */
  const updates: Array<{ object: string; id: string; data: Record<string, unknown> }> = [];
  /** Ids whose next `update` throws, to drive a recompute failure. */
  const failUpdateOf = new Set<string>();
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where)).map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      if (failUpdateOf.has(id)) throw new Error(`fake driver: update of ${id} refused`);
      updates.push({ object, id, data });
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(object);
      let count = 0;
      for (const [id, r] of Array.from(s.entries())) if (matches(r, ast?.where)) { s.set(id, { ...r, ...data, id }); count += 1; }
      return count;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async deleteMany(object: string, ast: any) {
      const s = storeFor(object);
      let count = 0;
      for (const [id, r] of Array.from(s.entries())) if (matches(r, ast?.where)) { s.delete(id); count += 1; }
      return count;
    },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(object, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor, updates, failUpdateOf };
}

const APP = 'com.qa.rollup.app';
const MODULE = 'com.qa.rollup.notes';
const ACCOUNT = 'qr_account';
const NOTE = 'qr_note';
const TOTAL = 'qr_note_total';

const manifest = (id: string, type: string) =>
  ({ id, name: id, version: '1.0.0', type, namespace: 'qr', ...(type === 'module' ? { dependencies: { [APP]: '^1.0.0' } } : {}) }) as any;

describe('a roll-up a disabled package contributes by extension, over an enabled package\'s child', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let driver: ReturnType<typeof makeDriver>;
  let logger: Record<'debug' | 'info' | 'warn' | 'error', ReturnType<typeof vi.fn>> & Record<string, unknown>;

  beforeEach(async () => {
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn(), fatal: vi.fn() };
    logger.child = () => logger;
    engine = new ObjectQL({ logger });
    const d = makeDriver();
    driver = d;
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    const registry = engine.registry;
    registry.installPackage(manifest(APP, 'app'), 'code');
    registry.installPackage(manifest(MODULE, 'module'), 'code');
    // The app owns both the parent and the child.
    registry.registerObject({
      name: ACCOUNT, label: 'Account',
      fields: { name: { name: 'name', type: 'text', label: 'Name' } },
    } as any, APP, 'qr', 'own');
    registry.registerObject({
      name: NOTE, label: 'Note',
      fields: {
        amount: { name: 'amount', type: 'number', label: 'Amount' },
        account: { name: 'account', type: 'lookup', label: 'Account', reference: ACCOUNT },
      },
    } as any, APP, 'qr', 'own');
    // The module adds the roll-up to the app's parent, by extension.
    registry.registerObject({
      name: ACCOUNT,
      fields: {
        [TOTAL]: { name: TOTAL, type: 'summary', label: 'Note total', summaryOperations: { object: NOTE, field: 'amount', function: 'sum' } },
      },
    } as any, MODULE, 'qr', 'extend');
  });

  const stored = (id: string) => storeFor(ACCOUNT).get(id)?.[TOTAL];

  it('is current after re-enable, with no further child write', async () => {
    const acme = await engine.insert(ACCOUNT, { name: 'acme' });
    const beta = await engine.insert(ACCOUNT, { name: 'beta' });
    const first = await engine.insert(NOTE, { account: acme.id, amount: 10 });
    expect(stored(acme.id), 'precondition: the roll-up tracks while the module is enabled').toBe(10);

    engine.registry.disablePackage(MODULE);
    // The child belongs to the enabled app: its writes land during the disable.
    await engine.insert(NOTE, { account: acme.id, amount: 5 });
    await engine.update(NOTE, { id: first.id, amount: 20 });
    await engine.insert(NOTE, { account: beta.id, amount: 7 });

    engine.registry.enablePackage(MODULE);
    await engine.summaryRefreshSettled();

    const served = await engine.findOne(ACCOUNT, { where: { id: acme.id }, context: { isSystem: true } } as any);
    expect(served?.[TOTAL]).toBe(25);
    expect(stored(beta.id)).toBe(7);
  });

  it('writes no parent row on an enable when no child moved during the disable', async () => {
    const acme = await engine.insert(ACCOUNT, { name: 'acme' });
    await engine.insert(NOTE, { account: acme.id, amount: 10 });
    engine.registry.disablePackage(MODULE);
    driver.updates.length = 0;

    engine.registry.enablePackage(MODULE);
    await engine.summaryRefreshSettled();

    expect(driver.updates.filter((u) => u.object === ACCOUNT)).toEqual([]);
    expect(stored(acme.id)).toBe(10);
  });

  it('brings every other parent current when one parent\'s recompute fails, and says so at error', async () => {
    const acme = await engine.insert(ACCOUNT, { name: 'acme' });
    const beta = await engine.insert(ACCOUNT, { name: 'beta' });
    engine.registry.disablePackage(MODULE);
    await engine.insert(NOTE, { account: acme.id, amount: 5 });
    await engine.insert(NOTE, { account: beta.id, amount: 7 });
    driver.failUpdateOf.add(acme.id);

    engine.registry.enablePackage(MODULE);
    await engine.summaryRefreshSettled();

    expect(stored(beta.id)).toBe(7);
    expect(stored(acme.id)).toBe(0);
    const said = logger.error.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('[summary-refresh]'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain(`${ACCOUNT}/${acme.id}`);
    // The operator's re-run, once the cause is cleared.
    driver.failUpdateOf.clear();
    const report = await engine.refreshSummariesEnabledBy(MODULE);
    expect(report.failures).toEqual([]);
    expect(stored(acme.id)).toBe(5);
  });
});

describe('SchemaRegistry.onPackageEnabled', () => {
  it('announces an enable of a disabled package, and not one of a package already enabled', () => {
    const engine = new ObjectQL();
    const registry = engine.registry;
    registry.installPackage(manifest(APP, 'app'), 'code');
    const heard: string[] = [];
    const stop = registry.onPackageEnabled((id) => { heard.push(id); });

    registry.enablePackage(APP);
    expect(heard).toEqual([]);
    registry.disablePackage(APP);
    registry.enablePackage(APP);
    expect(heard).toEqual([APP]);
    stop();
    registry.disablePackage(APP);
    registry.enablePackage(APP);
    expect(heard).toEqual([APP]);
  });
});
