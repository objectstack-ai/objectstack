// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26684] The import DRY RUN answers what the import COMMIT answers on the
 * same file, now that a bulk create counts the earlier rows of its batch when
 * a child rule reads a parent `summary` (#25579, ruling 6377847361 letter C:
 * 「批量等于逐条」).
 *
 * #25579's reproduction through the REAL import door
 * (`POST /api/v1/data/:object/import`), a REAL ObjectQL engine and a REAL
 * sqlite `:memory:` driver: a supplier carries `primary_contact_count`, a
 * `count` roll-up of its contacts filtered on `is_primary: true`, and the
 * contact's `script` rule refuses a primary contact when that count is already
 * above zero. The commit creates one of two primary rows and refuses the
 * other. The dry run used to ask the engine about each row ALONE, so both rows
 * read the stored `0` and both answered valid. Now the dry run previews the
 * file's create rows in the commit's own batches through the engine's
 * multi-row `validate()`, and each row keeps its own verdict.
 *
 * Every acceptance case runs the SAME file twice, on two fresh stacks — once
 * with `dryRun: true`, once committed — and pins that the per-row verdicts
 * agree (row, ok, action, error).
 *
 * The seat's addendum (6442401477): the preview's admit step now runs the
 * write's reference check, so a row the write refuses on a dangling reference
 * is refused by the preview too, and is not counted toward a later row.
 *
 * ## Reverse verification — predicted before running
 *
 * Ask the engine about each create row alone again (the run length set to 1):
 * the two-primary agreement case and the second-batch case go red, each
 * dry-running both primary rows valid; the non-primary, update-mode and
 * refused-row cases stay green. Drop the engine's reference check from the
 * preview: the two dangling-reference cases go red.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject, SysMetadataObject } from '@objectstack/metadata-core';
import { RestServer } from './rest-server';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
});

const REGION = {
  name: 'xt_region', label: 'Region', systemFields: false,
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
  },
};

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
    // A reference no rule traverses: only the write's reference check reads it.
    region: { name: 'region', type: 'lookup' as const, label: 'Region', reference: 'xt_region' },
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
  for (const o of [REGION, SUPPLIER, CONTACT]) engine.registry.registerObject(o as any);
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
  const importContacts = async (rows: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => {
    const res = makeRes();
    await route!.handler({ params: { object: 'xt_supplier_contact' }, body: { format: 'json', rows, ...extra } } as any, res);
    expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
    return res._json;
  };
  // A NEW supplier: the insert seeds its count at 0.
  await engine.insert('xt_supplier', { id: 's1', name: 'Acme' });
  await engine.insert('xt_region', { id: 'r1', name: 'North' });
  const contacts = async () => (await engine.find('xt_supplier_contact', { where: { supplier: 's1' } })) as Array<Record<string, any>>;
  return { engine, importContacts, contacts };
}

/** A row's verdict, in the words both halves of the import report it. */
const verdicts = (summary: { results: Array<Record<string, any>> }) =>
  summary.results.map((r) => ({ row: r.row, ok: r.ok, action: r.action, error: r.error }));

/**
 * The file dry-run on one fresh stack and committed on another; returns both
 * reports after pinning that they agree row by row.
 */
async function dryRunAndCommit(rows: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) {
  const dry = await (await boot()).importContacts(rows, { ...extra, dryRun: true });
  const committed = await boot();
  const commit = await committed.importContacts(rows, extra);
  expect(verdicts(dry)).toEqual(verdicts(commit));
  expect({ created: dry.created, updated: dry.updated, errors: dry.errors })
    .toEqual({ created: commit.created, updated: commit.updated, errors: commit.errors });
  return { dry, commit, committed };
}

describe('[#26684] the dry run agrees with the commit on a batch-aware parent-summary rule', () => {
  it('two primary rows for a new supplier: the dry run refuses the second with the commit\'s message', async () => {
    const { dry, committed } = await dryRunAndCommit([
      { id: 'k1', name: 'Zhang', supplier: 's1', is_primary: true },
      { id: 'k2', name: 'Li', supplier: 's1', is_primary: true },
    ]);
    expect(dry).toMatchObject({ dryRun: true, created: 1, errors: 1 });
    expect(dry.results[0]).toMatchObject({ row: 1, ok: true, action: 'created' });
    expect(dry.results[1]).toMatchObject({ row: 2, ok: false, action: 'failed' });
    expect(dry.results[1].error).toContain('A supplier has at most one primary contact.');
    expect((await committed.contacts()).map((c) => c.id)).toEqual(['k1']);
  });

  it('the dry run writes nothing', async () => {
    const { importContacts, contacts, engine } = await boot();
    await importContacts([
      { id: 'k1', name: 'Zhang', supplier: 's1', is_primary: true },
      { id: 'k2', name: 'Li', supplier: 's1', is_primary: true },
    ], { dryRun: true });
    expect(await contacts()).toEqual([]);
    expect((await engine.findOne('xt_supplier', { where: { id: 's1' } }))?.primary_contact_count).toBe(0);
  });

  it('two NON-primary rows both answer valid in the dry run, as both land', async () => {
    const { dry } = await dryRunAndCommit([
      { id: 'k1', name: 'Zhang', supplier: 's1', is_primary: false },
      { id: 'k2', name: 'Li', supplier: 's1', is_primary: false },
    ]);
    expect(dry).toMatchObject({ created: 2, errors: 0 });
  });

  it('a row the rules refuse does not raise the count a later row reads, in the dry run as in the commit', async () => {
    const { dry } = await dryRunAndCommit([
      { id: 'k1', name: 'placeholder', supplier: 's1', is_primary: true },
      { id: 'k2', name: 'Li', supplier: 's1', is_primary: true },
    ]);
    expect(dry.results[0].error).toContain('Placeholder names are not allowed.');
    expect(dry.results[1]).toMatchObject({ ok: true, action: 'created' });
  });

  it('a file larger than one batch: two primary rows in the second batch agree with the commit', async () => {
    // 200 rows is the commit's batch (`Math.min(progressEvery, MAX_CREATE_BATCH_SIZE)`).
    const rows: Array<Record<string, unknown>> = [];
    for (let n = 1; n <= 200; n++) rows.push({ id: `a${n}`, name: `Filler ${n}`, supplier: 's1', is_primary: false });
    rows.push({ id: 'k1', name: 'Zhang', supplier: 's1', is_primary: true });
    rows.push({ id: 'k2', name: 'Li', supplier: 's1', is_primary: true });
    rows.push({ id: 'a201', name: 'Filler 201', supplier: 's1', is_primary: false });
    const { dry } = await dryRunAndCommit(rows);
    expect(dry).toMatchObject({ created: 202, errors: 1 });
    expect(dry.results[201]).toMatchObject({ row: 202, ok: false, action: 'failed' });
    expect(dry.results[201].error).toContain('A supplier has at most one primary contact.');
  });
});

describe('[#26684] an update-mode dry run keeps its per-row preview', () => {
  it('an update against a stored primary is refused, a rename is not, as on the commit', async () => {
    const seed = async (b: Awaited<ReturnType<typeof boot>>) => {
      await b.engine.insert('xt_supplier_contact', { id: 'k1', name: 'Zhang', supplier: 's1', is_primary: true });
      await b.engine.insert('xt_supplier_contact', { id: 'k2', name: 'Li', supplier: 's1', is_primary: false });
      await b.engine.insert('xt_supplier_contact', { id: 'k3', name: 'Wang', supplier: 's1', is_primary: false });
    };
    const rows = [
      { name: 'Li', is_primary: true },
      { name: 'Wang', supplier: 's1' },
    ];
    const extra = { writeMode: 'update', matchFields: ['name'] };
    const dryStack = await boot();
    await seed(dryStack);
    const dry = await dryStack.importContacts(rows, { ...extra, dryRun: true });
    const commitStack = await boot();
    await seed(commitStack);
    const commit = await commitStack.importContacts(rows, extra);
    expect(verdicts(dry)).toEqual(verdicts(commit));
    expect(dry.results[0]).toMatchObject({ ok: false, action: 'failed' });
    expect(dry.results[0].error).toContain('A supplier has at most one primary contact.');
    expect(dry.results[1]).toMatchObject({ ok: true, action: 'updated' });
  });
});

describe('[#26684] the preview admits a row as the write admits it: after the reference check', () => {
  const ROWS = [
    // Refused by the write's reference check: no xt_region row `nowhere`.
    { id: 'k1', name: 'Zhang', supplier: 's1', region: 'nowhere', is_primary: true },
    { id: 'k2', name: 'Li', supplier: 's1', region: 'r1', is_primary: true },
  ];

  it('a multi-row preview refuses the dangling row and does not count it, as `insertMany` does', async () => {
    const write = await boot();
    const outcomes = await write.engine.insertMany('xt_supplier_contact', ROWS.map((r) => ({ ...r })));
    expect(outcomes.map((o) => o.ok)).toEqual([false, true]);

    const { engine } = await boot();
    const preview = await engine.validate('xt_supplier_contact', ROWS.map((r) => ({ ...r })), { mode: 'insert' });
    expect(preview.results!.map((r) => r.valid)).toEqual([false, true]);
    expect(preview.results![0]!.errors.map((e) => [e.field, e.code])).toEqual([['region', 'reference_not_found']]);
    const refused = outcomes[0]!;
    if (refused.ok) throw new Error('expected the first row to be refused');
    expect((refused.error as { fields?: Array<{ field: string; code: string }> }).fields?.map((f) => [f.field, f.code]))
      .toEqual([['region', 'reference_not_found']]);
  });

  it('a single-row preview refuses a dangling reference, as the single insert does', async () => {
    const { engine } = await boot();
    const preview = await engine.validate('xt_supplier_contact', { ...ROWS[0] }, { mode: 'insert' });
    expect(preview.results![0]).toMatchObject({ valid: false });
    expect(preview.results![0]!.errors.map((e) => [e.field, e.code])).toEqual([['region', 'reference_not_found']]);
    await expect(engine.insert('xt_supplier_contact', { ...ROWS[0] })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('a caller the write-gate probe refuses is told nothing about which ids exist', async () => {
    const { engine } = await boot();
    engine.registerWriteGateProbe(async () => false);
    const preview = await engine.validate('xt_supplier_contact', { ...ROWS[0], is_primary: false }, { mode: 'insert' });
    expect(preview.results![0]!.errors.map((e) => e.code)).not.toContain('reference_not_found');
  });
});
