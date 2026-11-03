// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28782] The REST write doors #28781 left — public form submit, the
 * per-object batch, `createMany` / `updateMany` / `deleteMany`, and clone —
 * answer a write that landed under a failing roll-up with their own success
 * answer, never a 500 and never a failed row that invites a duplicating retry.
 *
 * ## The defect, measured on `origin/main` (`c9a9981da`) before this file
 *
 * A stored `summary` field summing a child TEXT field (`sum(memo)`) makes the
 * engine throw `ERR_SUMMARY_RECOMPUTE` ("the triggering records WERE written")
 * after every child write. #28781 taught the single-record POST / PATCH /
 * DELETE doors to answer the write's success. These doors still answered:
 *
 * - form submit, `createMany`, clone: `500 INTERNAL_ERROR`, rows stored;
 * - `batch`, `updateMany`, `deleteMany` (non-atomic): the first row reported
 *   `success: false` with the refusal, the rest NOT ATTEMPTED — though the
 *   first row was stored, so a client retrying the failed rows duplicated it.
 *
 * ## What is pinned
 *
 * - each door's existing success answer (status and body shape), every row
 *   stored once, and the parent's valid roll-ups (`child_sum`, `child_count`)
 *   recomputed;
 * - a refusal BEFORE the write still answers as it did (ruling 3);
 * - an ATOMIC batch keeps rolling back: the refusal is raised inside the
 *   transaction, so nothing landed and the rolled-back answer is the truth;
 * - the operator is told once per stale field, at `error`.
 *
 * Harness: the composed REST harness of #28781's
 * `data-write-summary-recompute-refused.test.ts` (`RestServer` →
 * `ObjectStackProtocolImplementation` → `ObjectQL` → a real `SqlDriver` on
 * better-sqlite3); the form door reads a form view through a protocol that
 * delegates every other call to the real one (the form and its object
 * are served from the fixtures: this harness registers no metadata service).
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

// [#10126] Pay the first transform of this dist-resolved workspace dep at module load.
import '@objectstack/spec/ui';

const PARENT = 'qsf_parent';
const CHILD = 'qsf_child';

const PARENT_OBJECT = {
  name: PARENT,
  label: 'Parent',
  fields: {
    name: { name: 'name', type: 'text' as const },
    child_sum: { name: 'child_sum', type: 'summary' as const, summaryOperations: { object: CHILD, function: 'sum', field: 'amount' } },
    child_count: { name: 'child_count', type: 'summary' as const, summaryOperations: { object: CHILD, function: 'count' } },
    // A sum over a text field, which every recompute refuses.
    probe_sf: { name: 'probe_sf', type: 'summary' as const, summaryOperations: { object: CHILD, function: 'sum', field: 'memo' } },
  },
};

const CHILD_OBJECT = {
  name: CHILD,
  label: 'Child',
  fields: {
    name: { name: 'name', type: 'text' as const },
    memo: { name: 'memo', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    parent: { name: 'parent', type: 'master_detail' as const, reference: PARENT, required: true, deleteBehavior: 'cascade' },
  },
};

const FORM_VIEW = {
  name: 'qsf_child_form',
  object: CHILD,
  viewKind: 'form',
  config: {
    data: { object: CHILD },
    sections: [{ fields: ['name', 'amount', 'parent'] }],
    sharing: { enabled: true, allowAnonymous: true, publicLink: '/forms/qsf' },
  },
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

const dir = mkdtempSync(join(tmpdir(), 'os-28782-'));
let engine: ObjectQL;
let call: (method: string, path: string, req: Record<string, unknown>) => Promise<any>;
let warn: ReturnType<typeof vi.spyOn>;
let errorLog: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // The package harness declares `OS_REST_LOG: 'silent'`; this file reads the
  // shipped default, because the error line is part of what it pins.
  vi.stubEnv('OS_REST_LOG', 'info');
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'rollup.sqlite') }, useNullAsDefault: true }) as any,
    true,
  );
  await engine.init();
  engine.registry.registerObject(PARENT_OBJECT as any);
  engine.registry.registerObject(CHILD_OBJECT as any);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  await engine.insert(PARENT, { id: 'p1', name: 'P' } as any);
  await engine.insert(CHILD, [
    { id: 'c1', name: 'c1', amount: 100, parent: 'p1' },
    { id: 'c2', name: 'c2', amount: 135, parent: 'p1' },
    { id: 'c3', name: 'c3', amount: 10, parent: 'p1' },
  ] as any).catch((e: any) => {
    // The seed itself meets the failing roll-up; its rows are written.
    if (e?.code !== 'ERR_SUMMARY_RECOMPUTE') throw e;
  });

  const real = new ObjectStackProtocolImplementation(engine as any);
  // The form door finds its form among the `view` items; everything else is the real protocol.
  const protocol = new Proxy(real as any, {
    get(target, prop, receiver) {
      if (prop === 'getMetaItemsPerPackage') return async () => [];
      if (prop === 'getMetaItems') {
        // The engine holds the objects; this harness registers no metadata service.
        return async (req: any) => (req?.type === 'view' ? [FORM_VIEW] : req?.type === 'object' ? [CHILD_OBJECT, PARENT_OBJECT] : target.getMetaItems(req));
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
  const rest = new RestServer(createMockServer() as any, protocol, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const routes = rest.getRoutes();
  call = async (method, path, req) => {
    const route = routes.find((r: any) => r.method === method && r.path === `/api/v1${path}`);
    expect(route, `${method} /api/v1${path}`).toBeDefined();
    const res = makeRes();
    await route!.handler({ query: {}, headers: {}, ...req } as any, res);
    return res;
  };
});

afterAll(async () => {
  warn.mockRestore();
  errorLog.mockRestore();
  vi.unstubAllEnvs();
  try { await engine.destroy(); } catch { /* noop */ }
  rmSync(dir, { recursive: true, force: true });
});

const parentRow = async () => (await engine.findOne(PARENT, { where: { id: 'p1' } })) as any;
const childRows = async (where: Record<string, unknown>) => (await engine.find(CHILD, { where })) as any[];
const sumOfAmounts = async () => (await engine.find(CHILD, { where: { parent: 'p1' } }) as any[]).reduce((a, r) => a + Number(r.amount ?? 0), 0);

describe('[#28782] the remaining REST write doors answer a landed write under a failing roll-up with their own success', () => {
  it('public form submit answers 201 { id }, the row stored once', async () => {
    const res = await call('POST', '/forms/:slug/submit', { params: { slug: 'qsf' }, body: { name: 'form1', amount: 7, parent: 'p1' } });
    expect(res._status, JSON.stringify(res._json)).toBe(201);
    const rows = await childRows({ name: 'form1' });
    expect(rows).toHaveLength(1);
    expect(res._json).toEqual({ id: rows[0].id });
  });

  it('createMany answers 201 { object, records, count }, every row stored once', async () => {
    const res = await call('POST', '/data/:object/createMany', {
      params: { object: CHILD },
      body: [{ name: 'many1', amount: 1, parent: 'p1' }, { name: 'many2', amount: 2, parent: 'p1' }],
    });
    expect(res._status, JSON.stringify(res._json)).toBe(201);
    expect(res._json).toMatchObject({ object: CHILD, count: 2 });
    expect(res._json.records.map((r: any) => r.name)).toEqual(['many1', 'many2']);
    expect(await childRows({ name: 'many1' })).toHaveLength(1);
    expect(await childRows({ name: 'many2' })).toHaveLength(1);
    expect(await parentRow()).toMatchObject({ child_sum: await sumOfAmounts() });
  });

  it('the per-object batch (create, non-atomic) reports every row a success, each stored once', async () => {
    const res = await call('POST', '/data/:object/batch', {
      params: { object: CHILD },
      body: { operation: 'create', records: [{ data: { name: 'b1', amount: 3, parent: 'p1' } }, { data: { name: 'b2', amount: 4, parent: 'p1' } }] },
    });
    expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
    expect(res._json).toMatchObject({ success: true, succeeded: 2, failed: 0 });
    expect(res._json.results.map((r: any) => r.success)).toEqual([true, true]);
    expect(await childRows({ name: 'b1' })).toHaveLength(1);
    expect(await childRows({ name: 'b2' })).toHaveLength(1);
  });

  it('updateMany (non-atomic) reports every row a success, the values stored', async () => {
    const res = await call('POST', '/data/:object/updateMany', {
      params: { object: CHILD },
      body: { records: [{ id: 'c1', data: { amount: 40 } }, { id: 'c3', data: { amount: 20 } }] },
    });
    expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
    expect(res._json).toMatchObject({ success: true, succeeded: 2, failed: 0 });
    expect((await childRows({ id: 'c1' }))[0]).toMatchObject({ amount: 40 });
    expect((await childRows({ id: 'c3' }))[0]).toMatchObject({ amount: 20 });
    expect(await parentRow()).toMatchObject({ child_sum: await sumOfAmounts() });
  });

  it('clone answers 201 with the copy, stored once', async () => {
    const res = await call('POST', '/data/:object/:id/clone', { params: { object: CHILD, id: 'c2' }, body: { name: 'clone1' } });
    expect(res._status, JSON.stringify(res._json)).toBe(201);
    expect(res._json).toMatchObject({ object: CHILD, record: { name: 'clone1', amount: 135, parent: 'p1' } });
    expect(await childRows({ name: 'clone1' })).toHaveLength(1);
  });

  it('deleteMany (non-atomic) reports every row a success, the rows gone', async () => {
    const [b1] = await childRows({ name: 'b1' });
    const [b2] = await childRows({ name: 'b2' });
    const res = await call('POST', '/data/:object/deleteMany', { params: { object: CHILD }, body: { ids: [b1.id, b2.id] } });
    expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
    expect(res._json).toMatchObject({ success: true, succeeded: 2, failed: 0 });
    expect(await childRows({ name: 'b1' })).toEqual([]);
    expect(await childRows({ name: 'b2' })).toEqual([]);
    expect(await parentRow()).toMatchObject({ child_sum: await sumOfAmounts() });
  });

  it('an atomic batch still rolls back: the refusal is raised inside the transaction, so nothing landed', async () => {
    const res = await call('POST', '/data/:object/batch', {
      params: { object: CHILD },
      body: { operation: 'create', records: [{ data: { name: 'atomic1', amount: 5, parent: 'p1' } }], options: { atomic: true } },
    });
    expect(res._json?.success, JSON.stringify(res._json)).toBe(false);
    expect(await childRows({ name: 'atomic1' })).toEqual([]);
  });

  it('a refusal before the write answers as it did: a batch row missing its required parent fails, nothing stored', async () => {
    const res = await call('POST', '/data/:object/batch', {
      params: { object: CHILD },
      body: { operation: 'create', records: [{ data: { name: 'orphan1', amount: 5 } }] },
    });
    expect(res._json).toMatchObject({ success: false, succeeded: 0, failed: 1 });
    expect(res._json.results[0].errors[0].code).not.toBe('ERR_SUMMARY_RECOMPUTE');
    expect(await childRows({ name: 'orphan1' })).toEqual([]);
  });

  it('the operator is told once, at error, which summary column is stale', () => {
    const lines = errorLog.mock.calls.map((c: unknown[]) => String(c[0])).filter((l: string) => l.includes('could not be recomputed'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(`"${PARENT}.probe_sf"`);
  });
});
