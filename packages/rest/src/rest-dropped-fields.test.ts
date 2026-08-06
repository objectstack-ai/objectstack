// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#3431] The REST write paths must surface the engine's LEGAL field strips so
// an external caller is not left to diff the returned row to notice a field
// never landed (the same silent-success class #3407 fixed flow-side). The
// DataProtocol result carries `droppedFields`; the REST layer echoes it as the
// `X-ObjectStack-Dropped-Fields` response header AND keeps the structured list
// on the body. The STATUS CODE is unchanged (200 update / 201 create) — a strip
// is legitimate semantics, not a failure.

import { describe, it, expect, vi } from 'vitest';
import { RestServer } from './rest-server';

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}

function mockRes() {
  const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
  res.end = vi.fn(() => res);
  return res;
}

function buildServer(protocolOverrides: Record<string, any>) {
  const protocol: any = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    // No object registered → enforceApiAccess default-allows and the handler
    // proceeds straight to the (mocked) write method.
    getMetaItems: vi.fn().mockResolvedValue([]),
    ...protocolOverrides,
  };
  const rest = new RestServer(mockServer() as any, protocol, { api: { requireAuth: false } } as any);
  (rest as any).resolveExecCtx = async () => ({ userId: 'test-user' });
  rest.registerRoutes();
  const find = (method: string, suffix: string) =>
    rest.getRoutes().find((r) => r.method === method && r.path.endsWith(suffix))!;
  return {
    protocol,
    patch: find('PATCH', '/:object/:id'),
    create: find('POST', '/:object'),
  };
}

const DROPPED = [{ object: 'approval_case', fields: ['approval_status'], reason: 'readonly' as const }];

describe('PATCH /data/:object/:id — X-ObjectStack-Dropped-Fields (#3431)', () => {
  it('sets the header and keeps droppedFields on the body when the write stripped a field', async () => {
    const updateData = vi.fn().mockResolvedValue({
      object: 'approval_case', id: 'rec-1', record: { id: 'rec-1', title: 'B' }, droppedFields: DROPPED,
    });
    const { patch } = buildServer({ updateData });
    const res = mockRes();
    await patch.handler(
      { params: { object: 'approval_case', id: 'rec-1' }, body: { title: 'B', approval_status: 'approved' }, headers: {} } as any,
      res,
    );
    expect(res.headers['X-ObjectStack-Dropped-Fields']).toBe('approval_status;reason=readonly');
    expect(res.body.droppedFields).toEqual(DROPPED);
    // Success semantics unchanged — no error status was set.
    expect(res.statusCode).toBe(200);
  });

  it('joins multiple dropped fields/reasons into one header value', async () => {
    const updateData = vi.fn().mockResolvedValue({
      object: 'approval_case', id: 'rec-1', record: {},
      droppedFields: [
        { object: 'approval_case', fields: ['locked_at', 'owner'], reason: 'readonly_when' },
        { object: 'approval_case', fields: ['approval_status'], reason: 'readonly' },
      ],
    });
    const { patch } = buildServer({ updateData });
    const res = mockRes();
    await patch.handler({ params: { object: 'approval_case', id: 'rec-1' }, body: {}, headers: {} } as any, res);
    expect(res.headers['X-ObjectStack-Dropped-Fields']).toBe(
      'locked_at;reason=readonly_when, owner;reason=readonly_when, approval_status;reason=readonly',
    );
  });

  it('does NOT set the header when nothing was dropped', async () => {
    const updateData = vi.fn().mockResolvedValue({ object: 'approval_case', id: 'rec-1', record: { id: 'rec-1' } });
    const { patch } = buildServer({ updateData });
    const res = mockRes();
    await patch.handler({ params: { object: 'approval_case', id: 'rec-1' }, body: { title: 'B' }, headers: {} } as any, res);
    expect(res.headers).not.toHaveProperty('X-ObjectStack-Dropped-Fields');
    expect(res.body).not.toHaveProperty('droppedFields');
  });
});

describe('POST /data/:object — X-ObjectStack-Dropped-Fields on create (#3431)', () => {
  it('sets the header (status still 201) when the create ingress stripped a readonly field', async () => {
    const createData = vi.fn().mockResolvedValue({
      object: 'approval_case', id: 'rec-1', record: { id: 'rec-1', title: 'A' }, droppedFields: DROPPED,
    });
    const { create } = buildServer({ createData });
    const res = mockRes();
    await create.handler(
      { params: { object: 'approval_case' }, body: { title: 'A', approval_status: 'approved' }, headers: {} } as any,
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(res.headers['X-ObjectStack-Dropped-Fields']).toBe('approval_status;reason=readonly');
    expect(res.body.droppedFields).toEqual(DROPPED);
  });
});
