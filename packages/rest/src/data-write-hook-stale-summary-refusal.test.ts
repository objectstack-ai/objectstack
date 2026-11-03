// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A POST whose hook made a write of its own, and that write's roll-up could
 * not be recomputed, never answers the hook's record as its own result.
 *
 * ## The defect, measured before this file was written
 *
 * The data door answers a write's success over the engine's stale-roll-up
 * refusal (`ERR_SUMMARY_RECOMPUTE`, "the triggering records WERE written"),
 * using the refusal's `written` as the created record. An `afterInsert` hook on
 * the case writes a line through `ctx.api`, and the line's roll-up into the
 * bucket (`memo_sum`, a sum over a text field) refuses on every recompute. That
 * refusal left the hook and reached the door unchanged, so `POST /data/case`
 * answered `201 { object: case, id: <the LINE's id>, record: <the LINE row> }`.
 * That held for a metadata-bound hook (whose unit then committed both rows)
 * and for a code-registered one alike.
 *
 * ## What is pinned
 *
 * - a metadata-bound hook (an aborting `afterInsert`, so the write opens its
 *   own unit): `500 INTERNAL_ERROR`, byte for byte, and neither row is stored;
 * - a code-registered hook (no unit): the same answer, and both rows are stored,
 *   as the refusal's text says;
 * - CONTROL: `POST` of a line itself (its own write landed, only its recompute
 *   failed) still answers `201` with its own row.
 *
 * Harness: the composed REST harness of `data-delete-cascade-summary-rollback.test.ts`
 * (`RestServer` → `ObjectStackProtocolImplementation` → `ObjectQL` → a real
 * `SqlDriver` on better-sqlite3, which rolls back for real).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const CASE = 'qhr_case';
const CODE_CASE = 'qhr_code_case';
const BUCKET = 'qhr_bucket';
const LINE = 'qhr_line';

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

const dir = mkdtempSync(join(tmpdir(), 'os-hook-rollup-'));
let engine: ObjectQL;
let call: (method: string, path: string, req: Record<string, unknown>) => Promise<any>;

/** The hook's own write: a line, whose roll-up into the bucket every recompute refuses. */
const writeLine = (name: string) => async (ctx: any) => { await ctx.api.object(LINE).insert({ name, bucket: 'b1' }); };

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'hook.sqlite') }, useNullAsDefault: true }) as any,
    true,
  );
  await engine.init();
  engine.registry.registerObject({ name: CASE, label: 'Case', fields: { name: { name: 'name', type: 'text' } } } as any);
  engine.registry.registerObject({ name: CODE_CASE, label: 'Code case', fields: { name: { name: 'name', type: 'text' } } } as any);
  engine.registry.registerObject({
    name: BUCKET, label: 'Bucket',
    fields: {
      name: { name: 'name', type: 'text' },
      // A sum over a text field: every recompute of it is refused.
      memo_sum: { name: 'memo_sum', type: 'summary', summaryOperations: { object: LINE, function: 'sum', field: 'memo' } },
    },
  } as any);
  engine.registry.registerObject({
    name: LINE, label: 'Line',
    fields: {
      name: { name: 'name', type: 'text' },
      memo: { name: 'memo', type: 'text' },
      bucket: { name: 'bucket', type: 'master_detail', reference: BUCKET },
    },
  } as any);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  await engine.insert(BUCKET, { id: 'b1', name: 'B' } as any);
  bindHooksToEngine(engine as any, [
    { name: 'line_writer', object: CASE, events: ['afterInsert'], handler: writeLine('from-meta-hook') } as any,
  ], { packageId: 'app:qhr' });
  engine.registerHook('afterInsert', writeLine('from-code-hook'), { object: CODE_CASE });

  const protocol = new ObjectStackProtocolImplementation(engine as any);
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
  try { await engine.destroy(); } catch { /* noop */ }
  rmSync(dir, { recursive: true, force: true });
});

const names = async (object: string) =>
  ((await engine.find(object, { fields: ['name'] })) as Array<{ name: string }>).map((r) => r.name).sort();

describe('a POST whose hook\'s own write cannot recompute its roll-up never answers the hook\'s record', () => {
  it('a metadata-bound afterInsert: 500 INTERNAL_ERROR, and neither row is stored', async () => {
    const res = await call('POST', '/:object', { params: { object: CASE }, body: { name: 'c-1' } });
    expect(res._status, JSON.stringify(res._json)).toBe(500);
    expect(res._json).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    expect(await names(CASE)).toEqual([]);
    expect(await names(LINE)).toEqual([]);
  });

  it('a code-registered afterInsert (no unit): the same answer, and both rows are stored', async () => {
    const res = await call('POST', '/:object', { params: { object: CODE_CASE }, body: { name: 'cc-1' } });
    expect(res._status, JSON.stringify(res._json)).toBe(500);
    expect(res._json).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    expect(await names(CODE_CASE)).toEqual(['cc-1']);
    expect(await names(LINE)).toEqual(['from-code-hook']);
  });

  it('CONTROL POST of a line itself landed: 201 with its own row', async () => {
    const res = await call('POST', '/:object', { params: { object: LINE }, body: { name: 'direct', bucket: 'b1' } });
    expect(res._status ?? 201, JSON.stringify(res._json)).toBe(201);
    expect(res._json?.object).toBe(LINE);
    expect(res._json?.record?.name).toBe('direct');
    expect(res._json?.id).toBe(res._json?.record?.id);
  });
});
