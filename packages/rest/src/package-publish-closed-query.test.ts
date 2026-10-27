// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26857] `POST /packages/publish` declares its closed query set — EMPTY —
 * and refuses any name on the query string `400 VALIDATION_ERROR` with the
 * repo's one recognition sentence (`unknownQueryParamRefusalMessage`), before
 * the package service is resolved or asked to publish.
 *
 * Measured before this change: `POST /api/v1/packages/publish?dryRun=true`
 * published for real and answered `200`; the handler never read the query.
 *
 * Both halves (AGENTS.md route rule 5): a REFUSAL pin — status, code, the
 * shared sentence, and `publish` never called — beside a PRESERVATION pin on
 * the call without a query.
 */

import { describe, it, expect, vi } from 'vitest';
import { registerPackageRoutes } from './package-routes.js';
import { unknownQueryParamRefusalMessage } from './query-allowlist.js';

const AUTHOR = { resolveExecutionContext: async () => ({ userId: 'u_pkg', systemPermissions: ['manage_metadata'] }) };
const VIEWER = { resolveExecutionContext: async () => ({ userId: 'u_viewer', systemPermissions: [] as string[] }) };

const BODY = { manifest: { id: 'com.acme.app', version: '1.0.0' }, metadata: {} };

function mount(options: typeof AUTHOR) {
  const server: any = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn() };
  const service = { publish: vi.fn().mockResolvedValue({ success: true }) };
  registerPackageRoutes(server, () => service as any, '/api/v1', options);
  const handler = server.post.mock.calls.find((args: unknown[]) => args[0] === '/api/v1/packages/publish')?.[1];
  expect(handler, 'POST /api/v1/packages/publish must be mounted').toBeDefined();
  return { handler, service };
}

async function publish(handler: any, query: Record<string, unknown>) {
  const out: { status?: number; body?: any } = {};
  const res: any = {
    status(code: number) { out.status = code; return res; },
    json(body: any) { out.body = body; return res; },
    send(body: any) { out.body = body; return res; },
    header() { return res; },
  };
  await handler({ method: 'POST', body: BODY, params: {}, query, headers: {} }, res);
  return out;
}

describe('[#26857] POST /packages/publish — a closed, empty query set', () => {
  it.each([
    [{ dryRun: 'true' }],
    [{ dryRun: ['true', 'true'] }],
    [{ dryRun: 'true', force: '1' }],
  ])('refuses %j before the package service publishes', async (query) => {
    const { handler, service } = mount(AUTHOR);
    const out = await publish(handler, query);
    expect(out.status, JSON.stringify(out)).toBe(400);
    expect(out.body?.success).toBe(false);
    expect(out.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(out.body?.error?.message).toBe(unknownQueryParamRefusalMessage(query, []));
    expect(service.publish).not.toHaveBeenCalled();
  });

  it('preserves the call without a query: publish runs once and the route answers 200', async () => {
    const { handler, service } = mount(AUTHOR);
    const out = await publish(handler, {});
    expect(out.status).toBe(200);
    expect(service.publish).toHaveBeenCalledTimes(1);
  });

  it('answers a caller without manage_metadata 403 first: the capability gate outranks the query', async () => {
    const { handler, service } = mount(VIEWER);
    const out = await publish(handler, { dryRun: 'true' });
    expect(out.status).toBe(403);
    expect(service.publish).not.toHaveBeenCalled();
  });
});
