// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27193, ADR-0144 D5] What `os migrate recompute-home-amounts --apply` leaves
 * in `sys_audit_log` when the REAL audit writers are installed, as they are in
 * the command's own boot (`buildDataMigrationPlugins({ audit: true })` mounts
 * AuditPlugin).
 *
 * The recompute writes each row it changes through `engine.update`, so it is a
 * write like any other: the shipped record-level writer records one `update`
 * row per rewritten record, and the run adds its own deployment-level entry
 * (no record, `metadata.event: home_amount.recompute`). The objectql pins see
 * only the run entry, because their composition installs no writers; this is
 * the pin with them, so "one entry per run" can never again be read as "one
 * row in the ledger".
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL, recomputeHomeAmounts } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { SysExchangeRate } from '@objectstack/platform-objects/system';

import { installAuditWriters } from './audit-writers.js';
import { SysActivity, SysAuditLog } from './objects/index.js';
import { installDefaultOrganization } from './default-organization.testkit.js';

const PKG = 'com.objectstack.audit.test.home-amount-recompute';
const SYS = { context: { isSystem: true } } as const;
const INVOICE = 'hr_invoice';

const invoiceObject = {
  name: INVOICE,
  label: 'Invoice',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    currency_code: { name: 'currency_code', label: 'Currency', type: 'text', valueDomain: 'iso_4217_currency' },
    invoice_date: { name: 'invoice_date', label: 'Date', type: 'date' },
    amount: {
      name: 'amount',
      label: 'Amount',
      type: 'currency',
      currencyConfig: {
        currencyMode: 'record',
        currencyField: 'currency_code',
        homeAmount: { field: 'amount_home', rateDate: 'invoice_date', rateField: 'amount_rate' },
      },
    },
    amount_home: { name: 'amount_home', label: 'Amount (home)', type: 'currency', readonly: true },
    amount_rate: { name: 'amount_rate', label: 'Rate', type: 'number', readonly: true },
  },
};

describe('[#27193] an applied recompute, under the real audit writers', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;

  beforeAll(async () => {
    engine = new ObjectQL();
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of [invoiceObject, SysExchangeRate, SysAuditLog, SysActivity]) engine.registry.registerObject(o as any, PKG);
    await engine.syncSchemas();
    await installDefaultOrganization(engine as never);
    engine.setHomeLocalizationResolver(async () => ({ currency: 'CNY' }));
    // The REAL shipped record-level writer, not a stand-in for it.
    installAuditWriters(engine, PKG);
  });

  afterAll(async () => {
    await engine?.destroy();
  });

  it('records one per-row update for each rewritten row, plus the one run-level entry', async () => {
    const rate = await engine.insert('sys_exchange_rate', { currency: 'USD', effective_date: '2026-01-01', rate: 0.1389, source: 'manual' }, SYS);
    const ids: string[] = [];
    for (const name of ['a', 'b', 'c']) {
      ids.push((await engine.insert(INVOICE, { name, currency_code: 'USD', invoice_date: '2026-03-15', amount: 10000 }, SYS)).id);
    }
    await engine.update('sys_exchange_rate', { id: rate.id, rate: 0.125 }, SYS);
    const ledger = async () =>
      (await engine.find('sys_audit_log', { where: { object_name: INVOICE }, context: SYS.context } as never)) as Array<Record<string, any>>;
    // The inserts' own `create` rows land first; the recompute adds only `update` rows.
    await vi.waitFor(async () => expect((await ledger()).filter((r) => r.action === 'create')).toHaveLength(3));
    expect((await ledger()).filter((r) => r.action === 'update')).toEqual([]);

    const report = await recomputeHomeAmounts(engine as never, { info() {}, warn() {} }, { object: INVOICE, apply: true, source: 'test' });
    expect(report).toMatchObject({ changed: 3, written: 3, audit: { written: true } });

    const updates = async () => (await ledger()).filter((r) => r.action === 'update');
    await vi.waitFor(async () => expect(await updates()).toHaveLength(4));
    const added = await updates();
    const perRow = added.filter((r) => r.record_id != null);
    const runLevel = added.filter((r) => r.record_id == null);
    expect(perRow.map((r) => r.record_id).sort()).toEqual([...ids].sort());
    expect(runLevel).toHaveLength(1);
    expect(runLevel[0]).toMatchObject({ action: 'update', object_name: INVOICE });
    expect(JSON.parse(String(runLevel[0]!.metadata))).toMatchObject({ event: 'home_amount.recompute', written: 3 });
  });
});
