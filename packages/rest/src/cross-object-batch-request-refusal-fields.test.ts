// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The cross-object batch door's request-schema refusal answers ADR-0114's
// `fields[]` (`POST {basePath}/batch`, `batch-routes.ts`).
//
// A body `CrossObjectBatchRequestSchema` refuses is answered `400
// VALIDATION_FAILED` like every per-object batch door of the same file
// (`/data/:object/batch`, `createMany`, `updateMany`, `deleteMany`): the
// failure mapped through `zodIssuesToFields` into `{ field, code, message }`
// elements of the field-level catalog. ADR-0114 D3 — Zod is mapped at the
// boundary, never passed through — so the raw Zod `issues` list is not on
// the wire, and a client keying on `fields` reads one shape on every batch door.

import { describe, it, expect, vi } from 'vitest';
import { FieldErrorSchema } from '@objectstack/spec/api';
// Paid during collection, not inside a case's clocked window: the route
// source reaches `@objectstack/objectql` through a dynamic import.
import '@objectstack/objectql';
import { RestServer } from './rest-server';

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

/**
 * A transactional engine whose every write is a spy: a refused request must
 * reach none of them. Never driven past the refusal, so no write double here
 * needs a dispatch check of its own.
 */
function makeQl() {
  return {
    transaction: vi.fn(async (cb: any, ctx: any) => cb({ __trx: true, ctx })),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

function buildServer(ql: ReturnType<typeof makeQl>) {
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockResolvedValue([]),
    createData: vi.fn(),
  };
  const rest = new RestServer(
    mockServer() as any, protocol as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, // kernelManager, envRegistry, defaultEnvIdProvider, authServiceProvider
    async () => ql,                             // objectQLProvider (positional arg #8)
  );
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const route = rest.getRoutes().find(
    (r) => r.method === 'POST' && (r.metadata?.summary ?? '').startsWith('Cross-object'),
  );
  expect(route, 'the cross-object batch route is registered').toBeTruthy();
  return route!;
}

async function post(body: unknown) {
  const ql = makeQl();
  const route = buildServer(ql);
  const res = mockRes();
  await route.handler({ method: 'POST', params: {}, headers: {}, body } as any, res);
  return { res, ql };
}

/** The refusal envelope every batch door of this server answers a schema failure with. */
function expectFieldsRefusal(res: any, ql: ReturnType<typeof makeQl>) {
  expect(res.statusCode).toBe(400);
  expect(res.body.code).toBe('VALIDATION_FAILED');
  expect(Array.isArray(res.body.fields), JSON.stringify(res.body)).toBe(true);
  expect(res.body.fields.length).toBeGreaterThan(0);
  for (const element of res.body.fields) {
    const parsed = FieldErrorSchema.safeParse(element);
    expect(parsed.success, JSON.stringify(element)).toBe(true);
  }
  // ADR-0114 D3: mapped at the boundary, never passed through.
  expect(res.body).not.toHaveProperty('issues');
  expect(ql.transaction).not.toHaveBeenCalled();
  expect(ql.insert).not.toHaveBeenCalled();
}

describe('POST {basePath}/batch — a request-schema refusal answers fields[] (ADR-0114)', () => {
  it('a non-array `operations` is an `invalid_type` on `operations`', async () => {
    const { res, ql } = await post({ operations: 'x' });
    expectFieldsRefusal(res, ql);
    expect(res.body.fields.map((f: any) => [f.field, f.code])).toEqual([['operations', 'invalid_type']]);
  });

  it('an empty body names `operations` as `required`', async () => {
    const { res, ql } = await post({});
    expectFieldsRefusal(res, ql);
    expect(res.body.fields.map((f: any) => [f.field, f.code])).toEqual([['operations', 'required']]);
  });

  it('an operation missing its object is located at its index', async () => {
    const { res, ql } = await post({ operations: [{ action: 'create', data: {} }] });
    expectFieldsRefusal(res, ql);
    expect(res.body.fields.map((f: any) => [f.field, f.code])).toContainEqual(['operations.0.object', 'required']);
  });
});
