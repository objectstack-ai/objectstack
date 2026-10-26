/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12045 (B1's page-mount step) — `routeApprovalRecordReads`, the
 * console's adapter with the two reads a request's record page makes sent to
 * the approvals routes, on every surface that opens a request.
 *
 * The transport is a fake approvals server: the get route answers one request
 * with its `viewer` block, the actions route answers one request's timeline.
 * The host is a class instance, as the console's adapter is, so the pins can
 * hold that the routed adapter still reads as the host to everything else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  APPROVAL_ACTION_OBJECT,
  APPROVAL_REQUEST_OBJECT,
  routeApprovalRecordReads,
} from './approvalRequestsDataSource';

const BASE = 'http://test.local/api/v1';
const VIEWER = { can_act: true, is_submitter: false, can_override: false };
const TIMELINE = [
  { id: 'act_1', request_id: 'req_1', action: 'submit', created_at: '2026-10-01T09:00:00Z' },
  { id: 'act_2', request_id: 'req_1', action: 'approve', created_at: '2026-10-02T09:00:00Z' },
];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Every approvals request the fake server saw, path + query. */
let wire: string[] = [];

const transport = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  wire.push(url.pathname + url.search);
  const actions = /^\/api\/v1\/approvals\/requests\/([^/]+)\/actions$/.exec(url.pathname);
  if (actions) return json(200, { data: TIMELINE.filter((row) => row.request_id === decodeURIComponent(actions[1])) });
  const item = /^\/api\/v1\/approvals\/requests\/([^/]+)$/.exec(url.pathname);
  if (item) return json(200, { id: decodeURIComponent(item[1]), status: 'pending', viewer: VIEWER });
  return json(404, {});
});

/** The console's adapter, doubled as a class instance with state and methods. */
class FakeAdapter {
  readonly connected = true;
  find = vi.fn(async (_resource: string, _params?: unknown) => ({ data: [{ id: 'from_host' }], total: 1 }));
  findOne = vi.fn(async (_resource: string, id: string, _params?: unknown) => ({ id, from: 'host' }));
  create = vi.fn(async () => ({}));
  update = vi.fn(async () => ({}));
  delete = vi.fn(async () => true);
  aggregate = vi.fn(async (_resource: string, _params?: unknown) => [{ status: 'pending', count: 3 }]);
  getObjectSchema = vi.fn(async () => ({}));
}

let host: FakeAdapter;
const routed = () => routeApprovalRecordReads(host, { fetch: transport, baseUrl: BASE });

beforeEach(() => {
  wire = [];
  host = new FakeAdapter();
  transport.mockClear();
});

describe("a request's record reads go to the approvals routes (objectui#12045)", () => {
  it("a request's findOne reads the approvals get route, with the viewer block, and never the host", async () => {
    const row = await routed().findOne(APPROVAL_REQUEST_OBJECT, 'req_1', { $expand: ['submitter_id'] });
    expect(wire).toEqual(['/api/v1/approvals/requests/req_1']);
    expect(row).toMatchObject({ id: 'req_1', viewer: VIEWER });
    expect(host.findOne).not.toHaveBeenCalled();
  });

  it("one request's timeline reads the actions route, and never the host", async () => {
    const result = await routed().find(APPROVAL_ACTION_OBJECT, { $filter: { request_id: 'req_1' } });
    expect(wire).toEqual(['/api/v1/approvals/requests/req_1/actions']);
    expect(result.data.map((row) => (row as { id: string }).id)).toEqual(['act_1', 'act_2']);
    expect(host.find).not.toHaveBeenCalled();
  });
});

describe('lists of requests, and everything else, stay the adapter\'s (objectui#12045)', () => {
  it.each([
    ["a Setup list view's read, with its filter and sort", { $filter: { status: 'pending' }, $orderby: [{ field: 'updated_at', order: 'desc' }], $top: 50 }],
    ["the timeline's label read of its request_id column", { $filter: { id: { $in: ['req_1'] } }, $top: 1 }],
  ])('%s goes to the data API unchanged, and is never refused', async (_case, params) => {
    const result = await routed().find(APPROVAL_REQUEST_OBJECT, params as never);
    expect(host.find).toHaveBeenCalledWith(APPROVAL_REQUEST_OBJECT, params);
    expect(result.data).toEqual([{ id: 'from_host' }]);
    expect(wire).toEqual([]);
  });

  it("another object's reads, a timeline read that is not one request's, and the host's other row reads are the host's", async () => {
    const source = routed();
    await source.findOne('invoice', 'inv_1');
    await source.find(APPROVAL_ACTION_OBJECT, { $filter: { actor_id: 'u1' } });
    await source.aggregate(APPROVAL_REQUEST_OBJECT, { field: 'status', function: 'count', groupBy: 'status' });
    expect(host.findOne).toHaveBeenCalledWith('invoice', 'inv_1', undefined);
    expect(host.find).toHaveBeenCalledWith(APPROVAL_ACTION_OBJECT, { $filter: { actor_id: 'u1' } });
    expect(host.aggregate).toHaveBeenCalledTimes(1);
    expect(wire).toEqual([]);
  });

  it('reads as the host to everything else: its class, its state, and one identity per method', () => {
    const source = routed();
    expect(source).toBeInstanceOf(FakeAdapter);
    expect(source.connected).toBe(true);
    expect(source.create).toBe(source.create);
    expect(source.find).toBe(source.find);
    void source.create();
    expect(host.create).toHaveBeenCalledTimes(1);
  });
});
