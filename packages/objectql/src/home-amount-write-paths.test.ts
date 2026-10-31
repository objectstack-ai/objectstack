// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0144 D5] Import and REST writes reach the home projection through the
// one engine path, on a booted kernel: `ObjectQLPlugin` with its settings
// bridge (the home currency is the `settings` service's
// `localization.currency`, asked for the row's organization), the real
// protocol, and the shared import runner.
//
// The reading this pins: the REST data routes write through the protocol's
// `createData` / `updateData` (`packages/rest/src/crud-routes.ts`), which call
// `engine.insert` / `engine.update`; an import (`POST …/import` and the
// import-job worker, both `runImport`) writes through the protocol's
// `insertManyData` (batched, `engine.insertMany` → `engine.insert`) or
// `createData` / `updateData` (per row). Every one of them lands in the same
// insert or update seam, so every one of them converts, and refuses, alike.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectKernel, runImport, type ImportProtocolLike } from '@objectstack/core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQLPlugin } from './plugin.js';
import { ObjectQL } from './engine.js';
import { applyDriverQueryInMemory } from './driver-query-in-memory.js';

function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, any>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const select = (o: string, ast: any) =>
    applyDriverQueryInMemory(Array.from(storeFor(o).values()), { where: ast?.where, orderBy: ast?.orderBy, limit: ast?.limit, offset: ast?.offset });
  let n = 0;
  const driver: any = {
    name: 'fx-store', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async syncSchema() {},
    async find(o: string, ast: any) { return select(o, ast).map((r) => ({ ...r })); },
    async findOne(o: string, ast: any) { const [r] = select(o, { ...ast, limit: 1 }); return r ? { ...r } : null; },
    async create(o: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `rec_${n}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return { ...row };
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const row = { ...storeFor(o).get(id), ...data, id };
      storeFor(o).set(id, row);
      return { ...row };
    },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return select(o, ast).length; },
  };
  return { driver, storeFor };
}

const OBJECT = 'fx_invoice';
const HOME_AMOUNT = { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' };
const FIELDS = {
  ref: { name: 'ref', type: 'text' },
  currency_code: { name: 'currency_code', type: 'text', valueDomain: 'iso_4217_currency' },
  invoice_date: { name: 'invoice_date', type: 'date' },
  amount: { name: 'amount', type: 'currency', currencyConfig: { currencyMode: 'record', currencyField: 'currency_code', homeAmount: HOME_AMOUNT } },
  amount_home: { name: 'amount_home', type: 'currency', readonly: true },
  amount_rate: { name: 'amount_rate', type: 'number', readonly: true },
};

describe('import and REST writes convert through the same engine path', () => {
  let kernel: ObjectKernel;
  let objectql: ObjectQL;
  let stub: ReturnType<typeof makeStubDriver>;
  /** What the settings service was asked, and what it answers. */
  let settingsAsked: Array<{ ns: string; key: string; tenantId?: unknown }>;
  let home: string | undefined;

  async function bootKernel(withSettings: boolean) {
    settingsAsked = [];
    home = 'CNY';
    kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
    stub = makeStubDriver();
    await kernel.use({
      name: 'fx-store-plugin', type: 'driver', version: '1.0.0',
      init: async (ctx: any) => { ctx.registerService('driver.fx-store', stub.driver); },
    } as any);
    if (withSettings) {
      await kernel.use({
        name: 'fake-settings', type: 'standard', version: '1.0.0',
        init: async (ctx: any) => {
          ctx.registerService('settings', {
            async get(ns: string, key: string, c?: { tenantId?: unknown }) {
              settingsAsked.push({ ns, key, tenantId: c?.tenantId });
              return { value: home };
            },
          });
        },
      } as any);
    }
    await kernel.use(new ObjectQLPlugin());
    await kernel.bootstrap();
    objectql = kernel.getService<ObjectQL>('objectql');
    objectql.registry.registerObject({
      name: 'sys_exchange_rate', datasource: 'fx-store',
      fields: {
        currency: { name: 'currency', type: 'text', valueDomain: 'iso_4217_currency' },
        rate: { name: 'rate', type: 'number', scale: 12, precision: 24 },
        effective_date: { name: 'effective_date', type: 'date' },
      },
    } as any, 'test', 'test');
    objectql.registry.registerObject({ name: OBJECT, label: 'FX invoice', datasource: 'fx-store', fields: FIELDS } as any, 'test', 'test');
    stub.storeFor('sys_exchange_rate').set('usd', { id: 'usd', currency: 'USD', effective_date: '2026-01-01', rate: 0.1389 });
  }

  afterEach(async () => {
    if (kernel?.getState() === 'running') await kernel.shutdown();
  });

  const storedByRef = (ref: string) => {
    const hits = Array.from(stub.storeFor(OBJECT).values()).filter((r) => r.ref === ref);
    expect(hits.length, `one stored row for ${ref}`).toBe(1);
    return hits[0]!;
  };
  const protocol = () => new ObjectStackProtocolImplementation(objectql as never) as unknown as ImportProtocolLike & {
    createData(a: unknown): Promise<any>; updateData(a: unknown): Promise<any>;
  };
  const perRow = (): ImportProtocolLike => {
    const impl = protocol();
    return { findData: (a) => impl.findData(a), createData: (a) => impl.createData(a), updateData: (a) => impl.updateData(a) };
  };
  const metaMap = new Map<string, any>(Object.entries(FIELDS));
  const importRows = (p: ImportProtocolLike, rows: Array<Record<string, unknown>>, over: Record<string, unknown> = {}) => runImport({
    p, objectName: OBJECT, metaMap, writeMode: 'insert', matchFields: ['ref'], dryRun: false, runAutomations: false,
    trimWhitespace: true, skipBlankMatchKey: false, context: { userId: 'usr_importer', tenantId: 'org_a' }, rows, ...over,
  } as any);

  describe('with the settings service composed', () => {
    beforeEach(async () => { await bootKernel(true); });

    it('the REST door (protocol createData / updateData) converts on create and on an amount change', async () => {
      const p = protocol();
      await p.createData({ object: OBJECT, data: { ref: 'rest', currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 }, context: { userId: 'u1', tenantId: 'org_a' } });
      expect(storedByRef('rest')).toMatchObject({ amount_home: 71994.24, amount_rate: 0.1389 });
      await p.updateData({ object: OBJECT, id: storedByRef('rest').id, data: { amount: 1389 }, context: { userId: 'u1', tenantId: 'org_a' } });
      expect(storedByRef('rest')).toMatchObject({ amount_home: 10000, amount_rate: 0.1389 });
      // The home currency was asked of the settings service, for the row's organization.
      expect(settingsAsked).toContainEqual({ ns: 'localization', key: 'currency', tenantId: 'org_a' });
    });

    for (const [label, p] of [['batched (insertManyData)', protocol], ['per-row (createData)', perRow]] as const) {
      it(`an import, ${label}, converts each row and refuses a row with no rate in force`, async () => {
        const summary = await importRows(p(), [
          { ref: 'a', currency_code: 'USD', invoice_date: '2026-03-15', amount: '10000' },
          { ref: 'b', currency_code: 'CNY', amount: '12.345' },
          { ref: 'c', currency_code: 'USD', invoice_date: '2025-06-30', amount: '1' },
        ]);
        expect(summary.results.map((r: any) => r.ok)).toEqual([true, true, false]);
        expect(JSON.stringify(summary.results[2])).toContain('ERR_EXCHANGE_RATE_MISSING');
        expect(storedByRef('a')).toMatchObject({ amount_home: 71994.24, amount_rate: 0.1389 });
        expect(storedByRef('b')).toMatchObject({ amount_home: 12.35, amount_rate: 1 });
        expect(Array.from(stub.storeFor(OBJECT).values()).some((r) => r.ref === 'c')).toBe(false);
      });
    }

    it('a historical (preserveAudit) update-mode import of the home column is recomputed over, not kept', async () => {
      await importRows(protocol(), [{ ref: 'h', currency_code: 'USD', invoice_date: '2026-03-15', amount: '10000' }]);
      const summary = await importRows(perRow(), [{ ref: 'h', amount_home: '1', amount_rate: '9' }], {
        writeMode: 'update', treatAsHistorical: true,
      });
      expect(summary.results.map((r: any) => r.ok)).toEqual([true]);
      expect(storedByRef('h')).toMatchObject({ amount_home: 71994.24, amount_rate: 0.1389 });
    });

    it('an unset localization.currency refuses the REST write ERR_HOME_CURRENCY_UNSET', async () => {
      home = undefined;
      const err = await protocol().createData({ object: OBJECT, data: { ref: 'x', currency_code: 'USD', invoice_date: '2026-03-15', amount: 1 }, context: { userId: 'u1' } })
        .then(() => null, (e: { code?: string }) => e);
      expect(err?.code).toBe('ERR_HOME_CURRENCY_UNSET');
      expect(stub.storeFor(OBJECT).size).toBe(0);
    });
  });

  it('with no settings service composed, the home currency is unset — refused, never defaulted', async () => {
    await bootKernel(false);
    const err = await protocol().createData({ object: OBJECT, data: { ref: 'x', currency_code: 'CNY', amount: 1 }, context: { userId: 'u1' } })
      .then(() => null, (e: { code?: string }) => e);
    expect(err?.code).toBe('ERR_HOME_CURRENCY_UNSET');
  });
});
