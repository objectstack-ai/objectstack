// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25579] A child rule that reads a parent `summary` one hop through its
 * lookup judges the rows of ONE bulk create the way it judges them one by one
 * (ruling 6377847361, letter C: 「批量等于逐条」).
 *
 * The card's own reproduction, through the REAL import door
 * (`POST /api/v1/data/:object/import`), a REAL ObjectQL engine and a REAL
 * sqlite `:memory:` driver: a supplier carries `primary_contact_count`, a
 * `count` roll-up of its contacts filtered on `is_primary: true`, and the
 * contact's `script` rule refuses a primary contact when that count is already
 * above zero. The import buffers its creates into one batch, and the engine
 * resolved the supplier row once for the whole batch, so before this both
 * primary rows read `0` and both were created.
 *
 * The same rows are also driven straight at the two engine doors the batch
 * reaches: `insertMany` (partial success, the door the import uses) and
 * `insert(array)` (all or nothing). Each keeps its own success semantics; only
 * the count the rule reads moves.
 *
 * ## Reverse verification — predicted before running
 *
 * Drop the accumulation (judge every row against the stored row again): the
 * acceptance case, both engine-door cases and the preview case go red, each
 * admitting both primary rows; the non-primary, refused-row, single-write and
 * stored-primary cases stay green in both directions, because they pin what
 * the accumulation must NOT do.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';
import { mapDataError } from './error-response.js';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

const SUPPLIER = {
  name: 'xt_supplier', label: 'Supplier', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
    primary_contact_count: {
      name: 'primary_contact_count', type: 'summary' as const, label: 'Primary Contacts',
      summaryOperations: { object: 'xt_supplier_contact', field: 'is_primary', function: 'count' as const, filter: { is_primary: true } },
    },
  },
};

const CONTACT = {
  name: 'xt_supplier_contact', label: 'Supplier Contact', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
    is_primary: { name: 'is_primary', type: 'boolean' as const, label: 'Primary' },
    supplier: { name: 'supplier', type: 'lookup' as const, label: 'Supplier', reference: 'xt_supplier' },
  },
  validations: [
    {
      name: 'one_primary_contact', type: 'script', severity: 'error',
      message: 'A supplier has at most one primary contact.',
      condition: 'record.is_primary == true && record.supplier.primary_contact_count > 0',
    },
    {
      // An unrelated refusal, so a row the rules refuse can sit in the batch.
      name: 'no_placeholder_name', type: 'script', severity: 'error',
      message: 'Placeholder names are not allowed.',
      condition: "record.name == 'placeholder'",
    },
  ],
};

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
  const res: any = {
    write: () => true, end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

async function boot() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
  await engine.init();
  for (const o of [SUPPLIER, CONTACT]) engine.registry.registerObject(o as any);
  await engine.syncSchemas();
  for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
    if (!engine.registry.getObject(o.name)) engine.registry.registerObject(o as any);
  }
  const protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/data/:object/import');
  expect(route).toBeDefined();
  const importContacts = async (rows: Array<Record<string, unknown>>) => {
    const res = makeRes();
    await route!.handler({ params: { object: 'xt_supplier_contact' }, body: { format: 'json', rows } } as any, res);
    return res._json;
  };
  // A NEW supplier: the insert seeds its count at 0.
  await engine.insert('xt_supplier', { id: 's1', name: 'Acme' });
  const contacts = async () => (await engine.find('xt_supplier_contact', { where: { supplier: 's1' } })) as Array<Record<string, any>>;
  const primaryCount = async () => (await engine.findOne('xt_supplier', { where: { id: 's1' } }))?.primary_contact_count;
  return { engine, importContacts, contacts, primaryCount };
}

/**
 * The rule's refusal, as the engine throws it and as the data door answers it:
 * the ADR-0112 envelope's `code`, and the `status` the door maps it to.
 */
function expectRuleRefusal(err: unknown): void {
  expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
  expect(mapDataError(err).status).toBe(400);
  expect((err as { message?: string }).message).toContain('A supplier has at most one primary contact.');
}

async function refusalOf(write: Promise<unknown>): Promise<unknown> {
  try { await write; } catch (err) { return err; }
  throw new Error('expected the write to be refused');
}

describe('[#25579] acceptance — the card\'s import, through the real door', () => {
  it('two primary rows for a new supplier in one import: one is created, the other carries the rule\'s error', async () => {
    const { importContacts, contacts, primaryCount } = await boot();
    const summary = await importContacts([
      { id: 'k1', name: 'Zhang', supplier: 's1', is_primary: true },
      { id: 'k2', name: 'Li', supplier: 's1', is_primary: true },
    ]);
    expect(summary.created).toBe(1);
    expect(summary.errors).toBe(1);
    expect(summary.results[0]).toMatchObject({ ok: true, action: 'created' });
    expect(summary.results[1]).toMatchObject({ ok: false, action: 'failed' });
    expect(summary.results[1].error).toContain('A supplier has at most one primary contact.');
    expect((await contacts()).map((c) => c.id)).toEqual(['k1']);
    expect(await primaryCount()).toBe(1);
  });

  it('two NON-primary rows in one import both land: the summary\'s filter is honoured', async () => {
    const { importContacts, contacts, primaryCount } = await boot();
    const summary = await importContacts([
      { id: 'k1', name: 'Zhang', supplier: 's1', is_primary: false },
      { id: 'k2', name: 'Li', supplier: 's1', is_primary: false },
    ]);
    expect(summary.created).toBe(2);
    expect(summary.errors).toBe(0);
    expect((await contacts()).map((c) => c.id).sort()).toEqual(['k1', 'k2']);
    expect(await primaryCount()).toBe(0);
  });

  it('one primary and one non-primary row in one import both land', async () => {
    const { importContacts, primaryCount } = await boot();
    const summary = await importContacts([
      { id: 'k1', name: 'Zhang', supplier: 's1', is_primary: true },
      { id: 'k2', name: 'Li', supplier: 's1', is_primary: false },
    ]);
    expect(summary.created).toBe(2);
    expect(await primaryCount()).toBe(1);
  });

  it('a row the rules refuse does not raise the count a later row reads', async () => {
    const { importContacts, contacts, primaryCount } = await boot();
    const summary = await importContacts([
      { id: 'k1', name: 'placeholder', supplier: 's1', is_primary: true },
      { id: 'k2', name: 'Li', supplier: 's1', is_primary: true },
    ]);
    expect(summary.results[0]).toMatchObject({ ok: false, action: 'failed' });
    expect(summary.results[0].error).toContain('Placeholder names are not allowed.');
    expect(summary.results[1]).toMatchObject({ ok: true, action: 'created' });
    expect((await contacts()).map((c) => c.id)).toEqual(['k2']);
    expect(await primaryCount()).toBe(1);
  });
});

describe('[#25579] the two engine doors a bulk create reaches', () => {
  it('`insertMany` (partial success): the second primary row is refused with the rule\'s envelope, the first lands', async () => {
    const { engine, contacts, primaryCount } = await boot();
    const outcomes = await engine.insertMany('xt_supplier_contact', [
      { id: 'k1', name: 'Zhang', supplier: 's1', is_primary: true },
      { id: 'k2', name: 'Li', supplier: 's1', is_primary: true },
    ]);
    expect(outcomes.map((o) => o.ok)).toEqual([true, false]);
    expectRuleRefusal(outcomes[1]!.error);
    expect((await contacts()).map((c) => c.id)).toEqual(['k1']);
    expect(await primaryCount()).toBe(1);
  });

  it('`insert(array)` (all or nothing): the batch is refused with the rule\'s envelope, and nothing lands', async () => {
    const { engine, contacts, primaryCount } = await boot();
    expectRuleRefusal(await refusalOf(engine.insert('xt_supplier_contact', [
      { id: 'k1', name: 'Zhang', supplier: 's1', is_primary: true },
      { id: 'k2', name: 'Li', supplier: 's1', is_primary: true },
    ])));
    expect(await contacts()).toEqual([]);
    expect(await primaryCount()).toBe(0);
  });

  it('a single write behaves as before: the first primary lands, a second single write is refused', async () => {
    const { engine, contacts, primaryCount } = await boot();
    await engine.insert('xt_supplier_contact', { id: 'k1', name: 'Zhang', supplier: 's1', is_primary: true });
    expectRuleRefusal(await refusalOf(engine.insert('xt_supplier_contact', { id: 'k2', name: 'Li', supplier: 's1', is_primary: true })));
    expect((await contacts()).map((c) => c.id)).toEqual(['k1']);
    expect(await primaryCount()).toBe(1);
  });

  it('a multi-row insert preview (`validate`) answers what the write answers, and writes nothing', async () => {
    const { engine, contacts, primaryCount } = await boot();
    const preview = await engine.validate('xt_supplier_contact', [
      { id: 'k1', name: 'Zhang', supplier: 's1', is_primary: true },
      { id: 'k2', name: 'Li', supplier: 's1', is_primary: true },
      { id: 'k3', name: 'Wang', supplier: 's1', is_primary: false },
    ], { mode: 'insert' });
    expect(preview.results!.map((r) => r.valid)).toEqual([true, false, true]);
    expect(await contacts()).toEqual([]);
    expect(await primaryCount()).toBe(0);
  });

  it('a batch after a stored primary refuses every primary row in it', async () => {
    const { engine, contacts } = await boot();
    await engine.insert('xt_supplier_contact', { id: 'k0', name: 'Wang', supplier: 's1', is_primary: true });
    const outcomes = await engine.insertMany('xt_supplier_contact', [
      { id: 'k1', name: 'Zhang', supplier: 's1', is_primary: true },
      { id: 'k2', name: 'Li', supplier: 's1', is_primary: false },
    ]);
    expect(outcomes.map((o) => o.ok)).toEqual([false, true]);
    expect((await contacts()).map((c) => c.id).sort()).toEqual(['k0', 'k2']);
  });
});
