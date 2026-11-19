// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34283] A roll-up `count`/`sum` that arrives with a RESTART — here, an app
 * whose new version boots with the roll-ups, over parent rows stored by the
 * version before — is sealed as computed at `kernel:bootstrapped`, so no
 * install door fills its stored rows. The boot names those holes once, with
 * the `os migrate summary-nulls` line that fills them, and writes nothing.
 * A column that holds a computed value is never named.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import type { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';
import { ADVISORY_SAMPLE_SIZE } from './stored-expression-backfill.js';
import { announceSummaryHoles } from './summary-hole-announce.js';

/** A memory driver that records every read and write, so a case can say what the boot touched. */
function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (v !== null && typeof v === 'object' && '$eq' in v) return row?.[k] === v.$eq;
      return row?.[k] === v;
    });
  };
  let n = 0;
  const writes: Array<{ verb: string; object: string }> = [];
  const reads: Array<{ object: string; limit?: number }> = [];
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async syncSchema() {},
    async find(object: string, ast: any) {
      reads.push({ object, limit: ast?.limit });
      let rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      rows = rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const page = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      return page.map((r) => ({ ...r }));
    },
    async findOne(object: string, ast: any) {
      reads.push({ object });
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return { ...r };
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${String(n).padStart(4, '0')}`;
      writes.push({ verb: 'create', object });
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      writes.push({ verb: 'update', object });
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async updateMany() { writes.push({ verb: 'updateMany', object: '?' }); return 0; },
    async delete(object: string, id: string) { writes.push({ verb: 'delete', object }); return storeFor(object).delete(id); },
    async deleteMany() { writes.push({ verb: 'deleteMany', object: '?' }); return 0; },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(object, r))); },
    async bulkUpdate() { writes.push({ verb: 'bulkUpdate', object: '?' }); return []; },
    async bulkDelete() { writes.push({ verb: 'bulkDelete', object: '?' }); },
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor, writes, reads };
}

const CONTRACT = 'qx_contract';
const INVOICE = 'qx_invoice';
const contract = { name: CONTRACT, label: 'Contract', fields: { title: { name: 'title', type: 'text', label: 'Title' } } };
const invoice = {
  name: INVOICE, label: 'Invoice',
  fields: {
    amount: { name: 'amount', type: 'number', label: 'Amount' },
    contract: { name: 'contract', type: 'lookup', label: 'Contract', reference: CONTRACT },
  },
};
/** The version that boots after the restart: the objects, and three roll-ups added by extension. */
const v2 = {
  id: 'com.qa.o2c', name: 'o2c', version: '6.3.0', objects: [contract, invoice],
  objectExtensions: [{
    extend: CONTRACT,
    fields: {
      invoiced_amount: { name: 'invoiced_amount', type: 'summary', label: 'Invoiced', summaryOperations: { object: INVOICE, field: 'amount', function: 'sum' } },
      invoice_count: { name: 'invoice_count', type: 'summary', label: 'Invoices', summaryOperations: { object: INVOICE, function: 'count' } },
      largest_invoice: { name: 'largest_invoice', type: 'summary', label: 'Largest invoice', summaryOperations: { object: INVOICE, field: 'amount', function: 'max' } },
    },
  }],
};

/**
 * Boot a real kernel whose app registers `v2` before `kernel:bootstrapped`,
 * over a driver already holding `seed` (rows stored by an earlier boot).
 * Returns the `[summary-holes]` warns and the driver writes the boot made.
 */
async function bootOver(d: ReturnType<typeof makeDriver>) {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  const warn = vi.spyOn((kernel as unknown as { logger: { warn: (...a: unknown[]) => void } }).logger, 'warn');
  const store: Plugin = {
    name: 'qx-store-plugin', type: 'driver', version: '1.0.0',
    init: async (ctx: PluginContext) => { ctx.registerService('driver.memory', d.driver); },
  };
  const app: Plugin = {
    name: 'qx-app-plugin', version: '1.0.0',
    init: async () => {},
    start: async (ctx: PluginContext) => { ctx.getService<ObjectQL>('objectql').registerApp(v2); },
  };
  await kernel.use(store);
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(app);
  const writesBefore = d.writes.length;
  await kernel.bootstrap();
  const said = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.startsWith('[summary-holes]'));
  return { kernel, said, bootWrites: d.writes.slice(writesBefore) };
}

describe('#34283 — a count/sum roll-up that arrives with a restart is announced at boot', () => {
  it('a NULL count/sum on stored rows is named once, with the summary-nulls line, and nothing is written', async () => {
    const d = makeDriver();
    // Stored by the version before: no roll-up column on the contracts.
    d.storeFor(CONTRACT).set('c1', { id: 'c1', title: 'acme' });
    d.storeFor(CONTRACT).set('c2', { id: 'c2', title: 'idle' });
    d.storeFor(INVOICE).set('i1', { id: 'i1', contract: 'c1', amount: 700 });

    const { kernel, said, bootWrites } = await bootOver(d);
    try {
      expect(said).toHaveLength(1);
      expect(said[0]).toContain('qx_contract.invoiced_amount (sum, 2 of the first 2 rows)');
      expect(said[0]).toContain('qx_contract.invoice_count (count, 2 of the first 2 rows)');
      // A NULL `max` is the reading of "no child rows": not a hole, not named.
      expect(said[0]).not.toContain('largest_invoice');
      expect(said[0]).toContain('`os migrate summary-nulls --object qx_contract`');
      expect(said[0]).toContain('`os migrate summary-nulls --apply --object qx_contract`');
      // Read-only: the boot wrote no row, so the holes are still there.
      expect(bootWrites).toEqual([]);
      expect(d.storeFor(CONTRACT).get('c1')).toEqual({ id: 'c1', title: 'acme' });
      // Bounded: one read of the parent, capped at the advisory sample; the child is not read.
      const sampleReads = d.reads.filter((r) => r.limit === ADVISORY_SAMPLE_SIZE);
      expect(sampleReads).toEqual([{ object: CONTRACT, limit: ADVISORY_SAMPLE_SIZE }]);
    } finally {
      await kernel.shutdown();
    }
  });

  it('CONTROL — a computed column announces nothing', async () => {
    const d = makeDriver();
    // Computed values: 0 is the empty-set reading of a count/sum, not a hole;
    // a NULL max on a row with no children is that function's own reading.
    d.storeFor(CONTRACT).set('c1', { id: 'c1', title: 'acme', invoiced_amount: 700, invoice_count: 1, largest_invoice: 700 });
    d.storeFor(CONTRACT).set('c2', { id: 'c2', title: 'idle', invoiced_amount: 0, invoice_count: 0, largest_invoice: null });
    d.storeFor(INVOICE).set('i1', { id: 'i1', contract: 'c1', amount: 700 });

    const { kernel, said, bootWrites } = await bootOver(d);
    try {
      expect(said).toEqual([]);
      expect(bootWrites).toEqual([]);
    } finally {
      await kernel.shutdown();
    }
  });

  it('CONTROL — an object it cannot read is skipped, never fails the boot, and is not named', async () => {
    const engine = {
      getConfigs: () => ({ [CONTRACT]: {} }),
      getOwnedSummaryDescriptors: () => [{ parentObject: CONTRACT, summaryField: 'invoice_count', childObject: INVOICE, fkField: 'contract', fn: 'count' as const }],
      find: async () => { throw new Error('table missing'); },
    };
    const warn = vi.fn();
    const debug = vi.fn();
    await expect(announceSummaryHoles(engine, { warn, debug })).resolves.toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith('[summary-holes] boot sample skipped', { object: CONTRACT, error: 'table missing' });
  });
});
