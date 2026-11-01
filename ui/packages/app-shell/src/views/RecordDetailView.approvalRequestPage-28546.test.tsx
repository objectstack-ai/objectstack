/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#28546 — an approval request's OWN record page asks no record
 * page payload.
 *
 * The payload (`DataSource.getRecordPage`, objectstack#27627) is the data
 * API's read, `POST /data/{object}/{id}/page`. A request is the approvals
 * service's record: its get serves the per-caller `viewer` block the decision
 * actions read and the approvers as an array, the data API attaches neither and
 * refuses the object to an ordinary approver. So a request's page reads each
 * part on its own through the adapter: the record through `findOne`, which the
 * console routes to the approvals get (pinned on the console's composition in
 * `apps/console/src/services/approvalRequestsDataSource.recordPagePayload-28546.test.tsx`).
 *
 * Pinned here on the REAL adapter, whose payload every other record page asks:
 * a request's page sends no page request and reads its record by `findOne`; an
 * ordinary record on the same adapter still opens with one page request; and
 * in a drawer, a request's next neighbour keeps the related-count warm-up an
 * open without a payload has.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
}));
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

import { MetadataCtx } from '@object-ui/react';
import { RelatedCountStore } from '@object-ui/components';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { __clearRecordEditableCache } from '../../../plugin-detail/src/useRecordEditable';
import { __resetRecordApprovalsStore } from '../hooks/useRecordApprovals';
import { RecordDetailView } from './RecordDetailView';
import { RecordDrawerUpcomingContext } from './recordDrawerStack';
import { SYS_APPROVAL_REQUEST_OBJECT } from './recordApprovalActions';

const BASE = 'http://test.local';
const ACTION = 'sys_approval_action';
const CONTACT = 'os_28546_contact';

const requestDef = {
  name: SYS_APPROVAL_REQUEST_OBJECT,
  label: 'Approval Request',
  nameField: 'process_label',
  fields: {
    id: { label: 'Id', type: 'text' },
    process_label: { label: 'Flow', type: 'text' },
    status: { label: 'Status', type: 'text' },
  },
};
const actionDef = {
  name: ACTION,
  label: 'Approval Action',
  fields: {
    id: { label: 'Id', type: 'text' },
    action: { label: 'Action', type: 'text' },
    request_id: { label: 'Request', type: 'lookup', reference: SYS_APPROVAL_REQUEST_OBJECT },
  },
};
const contactDef = { name: CONTACT, label: 'Contact', fields: { id: { label: 'Id', type: 'text' }, name: { label: 'Name', type: 'text' } } };
const ALL = [requestDef, actionDef, contactDef];

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

/** Every request sent, as `METHOD path` with the query decoded. */
let wire: string[] = [];

const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? 'GET').toUpperCase();
  const path = decodeURIComponent(url.replace(BASE, ''));
  wire.push(`${method} ${path}`);
  if (path.endsWith('/api/v1/discovery')) return json({ success: true, data: { capabilities: {}, routes: {} } });
  const meta = /\/api\/v1\/meta\/object\/([^/?]+)/.exec(path);
  if (meta) return json({ success: true, data: ALL.find((o) => o.name === meta[1]) ?? null });
  const page = /\/api\/v1\/data\/([^/?]+)\/([^/?]+)\/page$/.exec(path);
  if (page) return json({ success: true, data: { object: page[1], id: page[2], record: { id: page[2], name: `Contact ${page[2]}` }, related: [] } });
  const one = /\/api\/v1\/data\/([^/?]+)\?.*\["id","=","([^"]+)"\]/.exec(path);
  if (one && one[1] === SYS_APPROVAL_REQUEST_OBJECT) {
    return json({ success: true, data: { records: [{ id: one[2], process_label: `Request ${one[2]}`, status: 'pending' }], total: 1 } });
  }
  return json({ success: true, data: { records: [], total: 0 } });
});

beforeEach(() => {
  cleanup();
  wire = [];
  __clearRecordEditableCache();
  __resetRecordApprovalsStore();
  RelatedCountStore._reset();
  vi.stubGlobal('fetch', transport);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function open(objectName: string, recordId: string, upcoming: readonly string[] = [], embedded = false) {
  const ds = new ObjectStackAdapter({ baseUrl: BASE, fetch: transport as never, autoReconnect: false });
  await ds.connect();
  expect(typeof ds.getRecordPage, 'the adapter answers the record page payload').toBe('function');
  const metadata = {
    objects: ALL, pages: [], loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => [], getItem: async () => null, getItemsByType: () => [],
  } as never;
  return render(
    <React.StrictMode>
      <MemoryRouter initialEntries={[`/apps/demo/${objectName}/record/${recordId}`]}>
        <MetadataCtx.Provider value={metadata}>
          <RecordDrawerUpcomingContext.Provider value={upcoming.map((id) => ({ objectName, recordId: id }))}>
            <RecordDetailView
              dataSource={ds as never}
              objects={ALL as never}
              onEdit={() => {}}
              objectNameOverride={objectName}
              recordIdOverride={recordId}
              embedded={embedded}
            />
          </RecordDrawerUpcomingContext.Provider>
        </MetadataCtx.Provider>
      </MemoryRouter>
    </React.StrictMode>,
  );
}

const pageRequests = () => wire.filter((w) => /^POST \/api\/v1\/data\/[^/?]+\/[^/?]+\/page$/.test(w));
const recordReads = (object: string, id: string) =>
  wire.filter((w) => w.startsWith(`GET /api/v1/data/${object}?`) && w.includes(`["id","=","${id}"]`));

describe("objectstack#28546 — an approval request's own page asks no record page payload", () => {
  it('reads the request by findOne and sends no page request', async () => {
    await open(SYS_APPROVAL_REQUEST_OBJECT, 'req_1');
    await waitFor(() => expect(recordReads(SYS_APPROVAL_REQUEST_OBJECT, 'req_1').length).toBeGreaterThan(0), { timeout: 8000 });
    expect(pageRequests()).toEqual([]);
  });

  it('CONTROL: an ordinary record on the same adapter opens with its page request', async () => {
    await open(CONTACT, 'c1');
    await waitFor(() => expect(pageRequests()).toEqual([`POST /api/v1/data/${CONTACT}/c1/page`]), { timeout: 8000 });
    expect(recordReads(CONTACT, 'c1')).toEqual([]);
  });

  it("in a drawer, a request's next neighbour has its related counts warmed, and no page is asked for either", async () => {
    await open(SYS_APPROVAL_REQUEST_OBJECT, 'req_1', ['req_2'], true);
    await waitFor(
      () =>
        expect(
          wire.filter((w) => w.startsWith(`GET /api/v1/data/${ACTION}?`) && w.includes('"request_id","=","req_2"')).length,
        ).toBeGreaterThan(0),
      { timeout: 8000 },
    );
    expect(pageRequests()).toEqual([]);
  });
});
