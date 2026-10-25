/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12032 — approval requests through a code-built `ApiDataSource`
 * door, so `ListView` reads them with `viewer` as a field and the scopes stay
 * server-side.
 *
 * The transport below is a fake approvals server. It restates the two route
 * facts that make this module necessary, read from objectstack's REST server:
 *
 *   - `GET /approvals/requests` has a CLOSED parameter set
 *     (`APPROVAL_REQUEST_LIST_PARAMS`, copied verbatim below) and answers any
 *     other name `400 { error: { code: 'VALIDATION_ERROR' } }`. Before this
 *     module, `ListView`'s `$top` alone drew that 400 on every read;
 *   - `GET /approvals/requests/:id` answers the row bare and reads no query.
 *
 * `ListView` is the REAL component over the REAL door: what it sends is what a
 * list view on this source sends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import { SchemaRendererProvider } from '@object-ui/react';
import { ListView } from '@object-ui/plugin-list';
import type { DataSource } from '@object-ui/types';
import {
  APPROVAL_REQUEST_OBJECT,
  createApprovalRequestsDataSource,
  type ApprovalRequestScope,
} from './approvalRequestsDataSource';

const BASE = 'http://test.local/api/v1';

/** Verbatim from objectstack `packages/rest/src/rest-server.ts`. */
const APPROVAL_REQUEST_LIST_PARAMS = [
  'object',
  'recordId', 'record_id',
  'status',
  'approverId', 'approver_id',
  'submitterId', 'submitter_id',
  'q',
  'limit', 'offset',
];

const VIEWER = { can_act: true, is_submitter: false, can_override: false };
/** A list row: the service attaches `viewer` to list reads, never `decision_progress`. */
const LIST_ROW = {
  id: 'req_1', process_name: 'invoice_approval', object_name: 'invoice', record_id: 'inv_1',
  status: 'pending', viewer: VIEWER,
};
/** A single read: `decision_progress` too (pending, aggregating behavior). */
const GET_ROW = { ...LIST_ROW, decision_progress: { behavior: 'quorum', got: 1, need: 2 } };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Every approvals request the fake server saw, path + query. */
let wire: string[] = [];

const transport = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  wire.push(url.pathname + url.search);
  if (url.pathname === '/api/v1/approvals/requests') {
    const unknown = [...url.searchParams.keys()].filter((k) => !APPROVAL_REQUEST_LIST_PARAMS.includes(k)).sort();
    if (unknown.length > 0) {
      return json(400, { error: { code: 'VALIDATION_ERROR', message: `Unknown query parameter(s): ${unknown.join(', ')}` } });
    }
    // `total` only when the caller pages, as the route answers.
    return json(200, url.searchParams.has('limit') ? { data: [LIST_ROW], total: 61 } : { data: [LIST_ROW] });
  }
  const item = /^\/api\/v1\/approvals\/requests\/([^/]+)$/.exec(url.pathname);
  if (item) {
    const id = decodeURIComponent(item[1]);
    if (id === 'gone') return json(404, { code: 'REQUEST_NOT_FOUND', error: `Approval request '${id}' not found` });
    return json(200, { ...GET_ROW, id });
  }
  return json(404, {});
});

const OBJECT_DEF = {
  name: APPROVAL_REQUEST_OBJECT,
  label: 'Approval Request',
  fields: {
    process_name: { name: 'process_name', label: 'Process', type: 'text' },
    status: { name: 'status', label: 'Status', type: 'text' },
    submitter_id: { name: 'submitter_id', label: 'Submitter', type: 'lookup', reference: 'sys_user' },
    updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' },
  },
};

/** The console's own adapter, doubled: everything that is not an approvals read. */
function makeHost() {
  return {
    find: vi.fn(async () => ({ data: [{ id: 'u1', name: 'Ada' }], total: 1 })),
    findOne: vi.fn(async (_resource: string, id: string) => ({ id, name: 'Ada' })),
    create: vi.fn(async (_resource: string, data: unknown) => data),
    update: vi.fn(async (_resource: string, _id: string, data: unknown) => data),
    delete: vi.fn(async () => true),
    getObjectSchema: vi.fn(async () => OBJECT_DEF),
    aggregate: vi.fn(async () => [{ status: 'pending', count: 99 }]),
    queryGroupHeaders: vi.fn(async () => []),
    exportDownload: vi.fn(async () => ({ blob: new Blob(), filename: 'x.csv' })),
  };
}

const SCOPES: Record<string, ApprovalRequestScope> = {
  awaitingMe: { kind: 'awaiting_me', approverIds: ['u1', 'ada@example.com', 'position:manager'] },
  submittedByMe: { kind: 'submitted_by_me', submitterId: 'u1' },
  all: { kind: 'all' },
};

function source(scope: ApprovalRequestScope, host = makeHost()) {
  return { host, ds: createApprovalRequestsDataSource({ host: host as unknown as DataSource, scope, fetch: transport, baseUrl: BASE }) };
}

beforeEach(() => {
  wire = [];
  transport.mockClear();
});

describe('each scope is a server-side query on the list route (objectui#12032)', () => {
  it('awaiting me: pending requests where any of my identities is an approver', async () => {
    const { ds } = source(SCOPES.awaitingMe);
    const out = await ds.find(APPROVAL_REQUEST_OBJECT);
    expect(wire).toEqual(['/api/v1/approvals/requests?status=pending&approverId=u1%2Cada%40example.com%2Cposition%3Amanager']);
    expect(out.data).toEqual([LIST_ROW]);
  });

  it('submitted by me: the requests I submitted, any status', async () => {
    const { ds } = source(SCOPES.submittedByMe);
    await ds.find(APPROVAL_REQUEST_OBJECT);
    expect(wire).toEqual(['/api/v1/approvals/requests?submitterId=u1']);
  });

  it('all: no scope parameter at all', async () => {
    const { ds } = source(SCOPES.all);
    await ds.find(APPROVAL_REQUEST_OBJECT);
    expect(wire).toEqual(['/api/v1/approvals/requests']);
  });

  it('a scope that names no identity reads as empty and sends nothing, never as the unscoped list', async () => {
    for (const scope of [
      { kind: 'awaiting_me', approverIds: ['', '  '] },
      { kind: 'submitted_by_me', submitterId: undefined },
    ] as ApprovalRequestScope[]) {
      const { ds } = source(scope);
      expect(await ds.find(APPROVAL_REQUEST_OBJECT, { $top: 50 })).toEqual({ data: [], total: 0 });
    }
    expect(wire).toEqual([]);
  });
});

describe('the list translates the data-API names it can, drops a projection, refuses the rest (objectui#12032)', () => {
  it('$top → limit, $skip → offset, $search → q; $select is dropped; the envelope total comes through', async () => {
    const { ds } = source(SCOPES.all);
    const out = await ds.find(APPROVAL_REQUEST_OBJECT, {
      $top: 25, $skip: 50, $search: '  acme ', $select: ['id', 'status'],
    });
    expect(wire).toEqual(['/api/v1/approvals/requests?limit=25&offset=50&q=acme']);
    expect(out).toMatchObject({ data: [LIST_ROW], total: 61 });
  });

  it('the scope and the translated names ride together', async () => {
    const { ds } = source(SCOPES.awaitingMe);
    await ds.find(APPROVAL_REQUEST_OBJECT, { $top: 50 });
    expect(wire).toEqual(['/api/v1/approvals/requests?status=pending&approverId=u1%2Cada%40example.com%2Cposition%3Amanager&limit=50']);
  });

  it.each([
    ['$filter', { $filter: { status: 'approved' } }],
    ['$orderby', { $orderby: [{ field: 'updated_at', order: 'desc' }] }],
    ['$expand', { $expand: ['submitter_id'] }],
    ['$searchFields', { $search: 'acme', $searchFields: ['process_name'] }],
  ])('%s is refused before any request, with the code ListView reads as a rejected query', async (name, params) => {
    const { ds } = source(SCOPES.awaitingMe);
    const err = await ds.find(APPROVAL_REQUEST_OBJECT, { $top: 50, ...params } as never).then(
      () => null,
      (e: unknown) => e as Error & { code?: string },
    );
    expect(err?.code).toBe('UNSUPPORTED_QUERY_PARAM');
    expect(err?.message).toContain(name);
    expect(wire).toEqual([]);
  });

  it('absent values are absent: an undefined $orderby or an empty $filter is not a refusal', async () => {
    const { ds } = source(SCOPES.all);
    await ds.find(APPROVAL_REQUEST_OBJECT, { $top: 10, $orderby: undefined, $filter: {} } as never);
    expect(wire).toEqual(['/api/v1/approvals/requests?limit=10']);
  });
});

describe('the get reads one request, viewer and decision_progress as fields (objectui#12032)', () => {
  it('serves the row as the service sends it, with no scope parameter and none of the caller’s QueryParams', async () => {
    const { ds } = source(SCOPES.awaitingMe);
    const row = await ds.findOne(APPROVAL_REQUEST_OBJECT, 'req_1', { $expand: ['submitter_id'] });
    expect(wire).toEqual(['/api/v1/approvals/requests/req_1']);
    expect(row.viewer).toEqual(VIEWER);
    expect(row.decision_progress).toEqual({ behavior: 'quorum', got: 1, need: 2 });
  });

  it('encodes the id into the path', async () => {
    const { ds } = source(SCOPES.all);
    await ds.findOne(APPROVAL_REQUEST_OBJECT, 'a/b c');
    expect(wire).toEqual(['/api/v1/approvals/requests/a%2Fb%20c']);
  });

  it('a 404 resolves null (not found)', async () => {
    const { ds } = source(SCOPES.all);
    expect(await ds.findOne(APPROVAL_REQUEST_OBJECT, 'gone')).toBeNull();
  });
});

describe('everything that is not an approvals read is the host’s (objectui#12032)', () => {
  it('another resource’s find and findOne go to the host, untouched', async () => {
    const { ds, host } = source(SCOPES.awaitingMe);
    const params = { $top: 50, $select: ['id', 'name'] };
    expect(await ds.find('sys_user', params)).toEqual({ data: [{ id: 'u1', name: 'Ada' }], total: 1 });
    expect(host.find).toHaveBeenCalledWith('sys_user', params);
    expect(await ds.findOne('sys_user', 'u1')).toEqual({ id: 'u1', name: 'Ada' });
    expect(host.findOne).toHaveBeenCalledWith('sys_user', 'u1', undefined);
    expect(wire).toEqual([]);
  });

  it('writes and metadata go to the host, approval requests included', async () => {
    const { ds, host } = source(SCOPES.all);
    await ds.update(APPROVAL_REQUEST_OBJECT, 'req_1', { status: 'x' } as never);
    expect(host.update).toHaveBeenCalledWith(APPROVAL_REQUEST_OBJECT, 'req_1', { status: 'x' });
    expect(await ds.getObjectSchema(APPROVAL_REQUEST_OBJECT)).toBe(OBJECT_DEF);
    expect(wire).toEqual([]);
  });

  it('the host’s other row reads are refused for approval requests, and the host’s for everything else', async () => {
    const { ds, host } = source(SCOPES.awaitingMe);
    const routed = ds as DataSource & Required<Pick<DataSource, 'aggregate' | 'queryGroupHeaders'>>;
    const err = await routed.aggregate(APPROVAL_REQUEST_OBJECT, { field: 'status', function: 'count' } as never)
      .then(() => null, (e: Error & { code?: string }) => e);
    expect(err?.code).toBe('UNSUPPORTED_QUERY_PARAM');
    await expect(routed.queryGroupHeaders(APPROVAL_REQUEST_OBJECT, {} as never)).rejects.toMatchObject({ code: 'UNSUPPORTED_QUERY_PARAM' });
    expect(host.aggregate).not.toHaveBeenCalled();
    expect(host.queryGroupHeaders).not.toHaveBeenCalled();

    await routed.aggregate('invoice', { field: 'amount', function: 'sum' } as never);
    expect(host.aggregate).toHaveBeenCalledWith('invoice', { field: 'amount', function: 'sum' });
  });

  it('a host method reads as one identity across reads', () => {
    const { ds } = source(SCOPES.all);
    expect(ds.getObjectSchema).toBe(ds.getObjectSchema);
    expect((ds as DataSource).aggregate).toBe((ds as DataSource).aggregate);
    expect(ds.find).toBe(ds.find);
  });
});

/** Mount the REAL ListView on a routed source. */
function renderList(schema: Record<string, unknown>, scope: ApprovalRequestScope, props: Record<string, unknown> = {}) {
  const { ds } = source(scope);
  const utils = render(
    <SchemaRendererProvider dataSource={ds}>
      <ListView
        schema={{ type: 'list-view', objectName: APPROVAL_REQUEST_OBJECT, ...schema } as never}
        dataSource={ds}
        {...props}
      />
    </SchemaRendererProvider>,
  );
  return utils;
}

async function errorPanel(container: HTMLElement): Promise<HTMLElement> {
  await waitFor(() => expect(container.querySelector('[data-testid="list-error-state"]')).not.toBeNull(), { timeout: 5000 });
  return container.querySelector('[data-testid="list-error-state"]') as HTMLElement;
}

describe('through the real ListView (objectui#12032)', () => {
  it('a list view reads its scope page by page and draws the rows, with no $ name on the wire', async () => {
    renderList({ columns: ['process_name', 'status'] }, SCOPES.awaitingMe);
    expect(await screen.findByText('invoice_approval', undefined, { timeout: 5000 })).toBeInTheDocument();
    const reads = wire.filter((w) => w.startsWith('/api/v1/approvals/requests'));
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read).toMatch(/[?&]limit=\d+/);
      expect(read).toContain('status=pending&approverId=');
      expect(read).not.toContain('%24');
    }
  });

  it('the toolbar search term reaches the route as q', async () => {
    renderList({ columns: ['process_name'] }, SCOPES.all, { initialSearchTerm: 'acme' });
    expect(await screen.findByText('invoice_approval', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(wire.some((w) => /[?&]q=acme\b/.test(w))).toBe(true);
  });

  it.each([
    ['$filter', { columns: ['process_name'], filter: [['status', '=', 'approved']] }, {}],
    ['$orderby', { columns: ['process_name'], sort: [{ field: 'updated_at', order: 'desc' }] }, {}],
    ['$expand', { columns: ['process_name', 'submitter_id'] }, {}],
    ['$searchFields', { columns: ['process_name'], searchableFields: ['process_name'] }, { initialSearchTerm: 'acme' }],
  ])('a view that needs %s shows the rejected-query panel, and no unfiltered rows', async (_name, schema, props) => {
    const { container } = renderList(schema, SCOPES.awaitingMe, props);
    const panel = await errorPanel(container);
    expect(panel.getAttribute('data-error-kind')).toBe('rejected');
    expect(screen.queryByText('invoice_approval')).toBeNull();
    expect(wire.filter((w) => w.startsWith('/api/v1/approvals/requests'))).toEqual([]);
  });
});
