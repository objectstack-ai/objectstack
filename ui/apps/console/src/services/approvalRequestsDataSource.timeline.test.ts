/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12045 — one request's timeline (`sys_approval_action`) reads
 * through `GET /approvals/requests/:id/actions`, not the data API, which is
 * closed to ordinary approver positions.
 *
 * The transport is a fake approvals server that answers the actions route as
 * objectstack's service does: the whole timeline, oldest first, `{ data }`.
 * The source applies the read's own ordering and window; the pins hold the
 * route it reads, the rows that come back, and what it refuses before any
 * request goes out.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataSource } from '@object-ui/types';
import { APPROVAL_ACTION_OBJECT, createApprovalRequestsDataSource } from './approvalRequestsDataSource';

const BASE = 'http://test.local/api/v1';

/** Three actions of one request, in the route's own order (created_at asc). */
const TIMELINE = [
  { id: 'act_1', request_id: 'req_1', action: 'submit', created_at: '2026-10-01T09:00:00Z', actor_name: 'Ada' },
  { id: 'act_2', request_id: 'req_1', action: 'approve', created_at: '2026-10-02T09:00:00Z', actor_name: 'Grace' },
  { id: 'act_3', request_id: 'req_1', action: 'comment', created_at: '2026-10-03T09:00:00Z', actor_name: 'Ada' },
];

let wire: string[] = [];

const transport = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  wire.push(url.pathname + url.search);
  const actions = /^\/api\/v1\/approvals\/requests\/([^/]+)\/actions$/.exec(url.pathname);
  if (actions) {
    const id = decodeURIComponent(actions[1]);
    return new Response(JSON.stringify({ data: TIMELINE.filter((row) => row.request_id === id) }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('{}', { status: 404 });
});

const host = {
  find: vi.fn(async () => ({ data: [{ id: 'from_host' }], total: 1 })),
  findOne: vi.fn(async () => null),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({})),
};

function source(): DataSource {
  return createApprovalRequestsDataSource({
    host: host as unknown as DataSource,
    scope: { kind: 'all' },
    fetch: transport,
    baseUrl: BASE,
  });
}

const ids = (result: { data: unknown[] }) => result.data.map((row) => (row as { id: string }).id);

beforeEach(() => {
  wire = [];
  host.find.mockClear();
  transport.mockClear();
});

describe("one request's timeline reads the actions route (objectui#12045)", () => {
  it('a read scoped to one request goes to that request\'s actions route, and never to the host', async () => {
    const result = await source().find(APPROVAL_ACTION_OBJECT, { $filter: { request_id: 'req_1' } });
    expect(wire).toEqual(['/api/v1/approvals/requests/req_1/actions']);
    expect(host.find).not.toHaveBeenCalled();
    expect(ids(result)).toEqual(['act_1', 'act_2', 'act_3']);
    expect(result.total).toBe(3);
  });

  it('the request id is path-encoded', async () => {
    await source().find(APPROVAL_ACTION_OBJECT, { $filter: { request_id: 'req/1 x' } });
    expect(wire).toEqual(['/api/v1/approvals/requests/req%2F1%20x/actions']);
  });

  it('applies $orderby, then windows with $top / $skip, and reports the whole timeline as total', async () => {
    const result = await source().find(APPROVAL_ACTION_OBJECT, {
      $filter: { request_id: 'req_1' },
      $orderby: [{ field: 'created_at', order: 'desc' }],
      $top: 2,
      $skip: 0,
    });
    expect(ids(result), 'the newest two, as a related list sorted newest-first asks').toEqual(['act_3', 'act_2']);
    expect(result.total).toBe(3);

    const second = await source().find(APPROVAL_ACTION_OBJECT, {
      $filter: { request_id: 'req_1' },
      $orderby: [{ field: 'created_at', order: 'desc' }],
      $top: 2,
      $skip: 2,
    });
    expect(ids(second)).toEqual(['act_1']);
    // The route has no paging: each read asked it for the whole timeline once.
    expect(wire).toEqual([
      '/api/v1/approvals/requests/req_1/actions',
      '/api/v1/approvals/requests/req_1/actions',
    ]);
  });

  it("honours $count: a tab strip's count probe reads the timeline's total from the route, and is never refused", async () => {
    const result = await source().find(APPROVAL_ACTION_OBJECT, { $filter: { request_id: 'req_1' }, $top: 1, $count: true });
    expect(result.total).toBe(3);
    expect(ids(result)).toEqual(['act_1']);
    expect(wire).toEqual(['/api/v1/approvals/requests/req_1/actions']);
    expect(host.find).not.toHaveBeenCalled();
  });

  it('drops $select and $expand: they shape columns, not which rows come back', async () => {
    const result = await source().find(APPROVAL_ACTION_OBJECT, {
      $filter: { request_id: 'req_1' },
      $select: ['action'],
      $expand: ['actor_id'],
    });
    expect(wire).toEqual(['/api/v1/approvals/requests/req_1/actions']);
    expect(ids(result)).toEqual(['act_1', 'act_2', 'act_3']);
  });

  it.each([
    ['a search', { $search: 'approve' }],
    ['an $orderby in the string form', { $orderby: 'created_at desc' }],
    ['a negative window', { $top: -1 }],
  ])('refuses %s with UNSUPPORTED_QUERY_PARAM before any request goes out', async (_case, extra) => {
    await expect(
      source().find(APPROVAL_ACTION_OBJECT, { $filter: { request_id: 'req_1' }, ...extra } as never),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_QUERY_PARAM' });
    expect(wire).toEqual([]);
    expect(host.find).not.toHaveBeenCalled();
  });

  it.each([
    ['no filter', undefined],
    ['a filter on another column', { $filter: { actor_id: 'u1' } }],
    ['one request AND another condition', { $filter: { request_id: 'req_1', action: 'approve' } }],
    ['a filter in the array form', { $filter: [['request_id', '=', 'req_1']] }],
  ])('control: a read with %s is not one request\'s timeline and goes to the host unchanged', async (_case, params) => {
    const result = await source().find(APPROVAL_ACTION_OBJECT, params as never);
    expect(wire).toEqual([]);
    expect(host.find).toHaveBeenCalledWith(APPROVAL_ACTION_OBJECT, params);
    expect(ids(result)).toEqual(['from_host']);
  });
});
