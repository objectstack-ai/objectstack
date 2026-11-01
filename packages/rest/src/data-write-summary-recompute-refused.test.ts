// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28661] A child write whose roll-up recompute is refused answers what the
 * write answers when it succeeds — never a 500 for a write that landed.
 *
 * ## The defect, measured on `origin/main` before this file was written
 *
 * A published `summary` field summing a child TEXT field (`sum(memo)`) made
 * every create, update and delete of the child answer 500 `INTERNAL_ERROR`,
 * though each write had landed and the parent's valid sibling roll-ups had
 * recomputed. The recompute's `engine.aggregate` refuses the pair after the
 * commit, the engine reports that as `SummaryRecomputeError` ("the triggering
 * records WERE written"), and the data door mapped it to an unhandled 500. A
 * client that retried a create made a duplicate.
 *
 * The publish door refuses such a roll-up now; a stored one published before
 * that, or a recompute that fails for any other reason, still reaches this
 * path, which is what this file pins.
 *
 * ## What is pinned
 *
 * - POST answers 201, PATCH 200 and DELETE 200, each with the body the same
 *   write answers when every roll-up recomputes;
 * - the record is persisted ONCE, and the parent's valid roll-ups
 *   (`child_sum`, `child_count`) recompute on each write;
 * - the protocol's own `createData` still throws `ERR_SUMMARY_RECOMPUTE`
 *   carrying the written record — the contract the import runner reads to
 *   mark a row created with a stale summary — so only the HTTP door's answer
 *   changes.
 *
 * Harness: the composed REST harness of `data-write-result-declared-fields.test.ts`
 * (`RestServer` → `ObjectStackProtocolImplementation` → `ObjectQL` → a real
 * `SqlDriver` on better-sqlite3). The roll-up is registered on the engine
 * directly, as a stored object published before the publish gate refused it
 * would be.
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

const PARENT = 'qsf_parent';
const CHILD = 'qsf_child';

const PARENT_OBJECT = {
  name: PARENT,
  label: 'Parent',
  fields: {
    name: { name: 'name', type: 'text' as const },
    child_sum: { name: 'child_sum', type: 'summary' as const, summaryOperations: { object: CHILD, function: 'sum', field: 'amount' } },
    child_count: { name: 'child_count', type: 'summary' as const, summaryOperations: { object: CHILD, function: 'count' } },
    // The card's probe: a sum over a text field, which every recompute refuses.
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

const dir = mkdtempSync(join(tmpdir(), 'os-28661-'));
let engine: ObjectQL;
let protocol: ObjectStackProtocolImplementation;
let call: (method: string, path: string, req: Record<string, unknown>) => Promise<any>;
let warn: ReturnType<typeof vi.spyOn>;

beforeAll(async () => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
  ] as any).catch((e: any) => {
    // The seed itself meets the failing roll-up; its rows are written.
    if (e?.code !== 'ERR_SUMMARY_RECOMPUTE') throw e;
  });

  protocol = new ObjectStackProtocolImplementation(engine as any);
  const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const routes = rest.getRoutes();
  call = async (method, path, req) => {
    const route = routes.find((r: any) => r.method === method && r.path === `/api/v1/data${path}`);
    expect(route, `${method} /api/v1/data${path}`).toBeDefined();
    const res = makeRes();
    await route!.handler({ query: {}, headers: {}, ...req } as any, res);
    return res;
  };
});

afterAll(async () => {
  warn.mockRestore();
  try { await engine.destroy(); } catch { /* noop */ }
  rmSync(dir, { recursive: true, force: true });
});

const parentRow = async () => (await engine.findOne(PARENT, { where: { id: 'p1' } } as any)) as any;
const childRows = async (where: Record<string, unknown>) => (await engine.find(CHILD, { where } as any)) as any[];

describe('[#28661] a child write under a failing roll-up answers its success answer', () => {
  it('POST answers 201 with the created record, persisted once, and the valid roll-ups recompute', async () => {
    const res = await call('POST', '/:object', { params: { object: CHILD }, body: { name: 'x', amount: 60, parent: 'p1' } });
    expect(res._status, JSON.stringify(res._json)).toBe(201);
    expect(res._json).toMatchObject({ object: CHILD, record: { name: 'x', amount: 60, parent: 'p1' } });
    expect(res._json.id).toBe(res._json.record.id);
    expect(await childRows({ name: 'x' })).toHaveLength(1);
    expect(await parentRow()).toMatchObject({ child_sum: 295, child_count: 3 });
  });

  it('PATCH answers 200 with the updated record, and the valid roll-ups recompute', async () => {
    const res = await call('PATCH', '/:object/:id', { params: { object: CHILD, id: 'c1' }, body: { amount: 35 } });
    expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
    expect(res._json).toMatchObject({ object: CHILD, id: 'c1', record: { id: 'c1', amount: 35 } });
    expect((await childRows({ id: 'c1' }))[0]).toMatchObject({ amount: 35 });
    expect(await parentRow()).toMatchObject({ child_sum: 230, child_count: 3 });
  });

  it('DELETE answers 200 success, the row is gone, and the valid roll-ups recompute', async () => {
    const res = await call('DELETE', '/:object/:id', { params: { object: CHILD, id: 'c2' } });
    expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
    expect(res._json).toEqual({ object: CHILD, id: 'c2', success: true });
    expect(await childRows({ id: 'c2' })).toEqual([]);
    expect(await parentRow()).toMatchObject({ child_sum: 95, child_count: 2 });
  });

  it('the protocol below the door still reports the stale roll-up: ERR_SUMMARY_RECOMPUTE, carrying the written record', async () => {
    const err: any = await protocol
      .createData({ object: CHILD, data: { name: 'y', amount: 1, parent: 'p1' }, context: { userId: 'test-user' } } as any)
      .then(() => null, (e: unknown) => e);
    expect(err?.code).toBe('ERR_SUMMARY_RECOMPUTE');
    expect(err.written).toMatchObject({ name: 'y', amount: 1 });
    expect(await childRows({ name: 'y' })).toHaveLength(1);
  });
});
