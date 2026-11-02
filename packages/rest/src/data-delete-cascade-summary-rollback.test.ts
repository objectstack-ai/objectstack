// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A DELETE whose `master_detail` cascade is stopped by a dependent's failing
 * roll-up answers a refusal, never the success of a delete that rolled back.
 *
 * ## The defect, measured on `origin/main` before this file was written
 *
 * The data door answers a write's success over the engine's stale-roll-up
 * refusal (`ERR_SUMMARY_RECOMPUTE`, "the triggering records WERE written").
 * Deleting an account cascades to its lines under the `'atomic'` plan; each
 * line's delete recomputes a roll-up on ANOTHER parent (`bucket.memo_sum`, a
 * sum over a text field, which every recompute refuses). The first line's
 * refusal stopped the cascade and the transaction rolled back, so neither the
 * account nor any line was deleted, yet the refusal reached the door unchanged
 * and `DELETE` answered `200 { success: true }`.
 *
 * ## What is pinned
 *
 * - `DELETE` of the account answers `500 INTERNAL_ERROR` (an unrecomputable
 *   roll-up is an internal failure), and the account and its lines are all
 *   still stored;
 * - CONTROL: `DELETE` of a line itself (its own write landed, only its
 *   recompute failed) still answers `200 { success: true }` and the line is
 *   gone.
 *
 * Harness: the composed REST harness of `data-write-summary-recompute-refused.test.ts`
 * (`RestServer` → `ObjectStackProtocolImplementation` → `ObjectQL` → a real
 * `SqlDriver` on better-sqlite3, which rolls back for real). The roll-up is
 * registered on the engine directly, as a stored object published before the
 * publish gate refused it would be.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server';
import { installDefaultOrganization } from './default-organization.testkit.js';

const ACCOUNT = 'qcr_account';
const BUCKET = 'qcr_bucket';
const LINE = 'qcr_line';

const ACCOUNT_OBJECT = { name: ACCOUNT, label: 'Account', fields: { name: { name: 'name', type: 'text' as const } } };

const BUCKET_OBJECT = {
  name: BUCKET,
  label: 'Bucket',
  fields: {
    name: { name: 'name', type: 'text' as const },
    // A sum over a text field: every recompute of it is refused.
    memo_sum: { name: 'memo_sum', type: 'summary' as const, summaryOperations: { object: LINE, function: 'sum', field: 'memo' } },
  },
};

const LINE_OBJECT = {
  name: LINE,
  label: 'Line',
  fields: {
    name: { name: 'name', type: 'text' as const },
    memo: { name: 'memo', type: 'text' as const },
    account: { name: 'account', type: 'master_detail' as const, reference: ACCOUNT, required: true, deleteBehavior: 'cascade' },
    bucket: { name: 'bucket', type: 'lookup' as const, reference: BUCKET },
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

const dir = mkdtempSync(join(tmpdir(), 'os-cascade-rollup-'));
let engine: ObjectQL;
let call: (method: string, path: string, req: Record<string, unknown>) => Promise<any>;

beforeAll(async () => {
  engine = new ObjectQL();
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: join(dir, 'cascade.sqlite') }, useNullAsDefault: true }) as any,
    true,
  );
  await engine.init();
  engine.registry.registerObject(ACCOUNT_OBJECT as any);
  engine.registry.registerObject(BUCKET_OBJECT as any);
  engine.registry.registerObject(LINE_OBJECT as any);
  await engine.syncSchemas();
  await installDefaultOrganization(engine);
  await engine.insert(ACCOUNT, { id: 'a1', name: 'A' } as any);
  await engine.insert(BUCKET, { id: 'b1', name: 'B' } as any);
  for (const id of ['l1', 'l2', 'l3']) {
    await engine.insert(LINE, { id, name: id, account: 'a1', bucket: 'b1' } as any).catch((e: any) => {
      // The seed itself meets the failing roll-up; its rows are written.
      if (e?.code !== 'ERR_SUMMARY_RECOMPUTE') throw e;
    });
  }

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

const rowIds = async (object: string) =>
  ((await engine.find(object, { fields: ['id'] })) as Array<{ id: string }>).map((r) => r.id).sort();

describe('a DELETE whose cascade a dependent\'s failing roll-up stops answers a refusal', () => {
  it('DELETE of the account answers 500 INTERNAL_ERROR, and nothing is deleted', async () => {
    const res = await call('DELETE', '/:object/:id', { params: { object: ACCOUNT, id: 'a1' } });
    expect(res._status, JSON.stringify(res._json)).toBe(500);
    // [#29421] The whole body, byte for byte: the refusal now DECLARES `500
    // INTERNAL_ERROR`, and the door answers exactly what it answered when it
    // reached the same 500 by falling through every message heuristic.
    expect(res._json).toEqual({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
    expect(await rowIds(ACCOUNT)).toEqual(['a1']);
    expect(await rowIds(LINE)).toEqual(['l1', 'l2', 'l3']);
  });

  it('CONTROL DELETE of a line itself landed: 200 success, the line is gone', async () => {
    const res = await call('DELETE', '/:object/:id', { params: { object: LINE, id: 'l3' } });
    expect(res._status ?? 200, JSON.stringify(res._json)).toBe(200);
    expect(res._json).toEqual({ object: LINE, id: 'l3', success: true });
    expect(await rowIds(LINE)).toEqual(['l1', 'l2']);
  });
});
