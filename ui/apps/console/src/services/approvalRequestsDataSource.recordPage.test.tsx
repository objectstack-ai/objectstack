/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#12032 — one approval request on the REAL record page, read through
 * the routed approvals source.
 *
 * `RecordDetailView` tells three failed answers apart (objectui#11902): a
 * refusal ("no access"), a failure ("could not load", with Retry) and a 404
 * ("not found"). That needs the adapter to resolve `null` ONLY for a 404 and
 * to reject everything else. The door's `findOne` used to resolve `null` for
 * every failure, so a refused or failed approvals get read as "not found".
 * These pins mount the page over the routed source with only the HTTP
 * transport doubled, so each answer reaches the page as the door hands it.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
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
import { I18nProvider, type I18nConfig } from '@object-ui/i18n';
import { RecordDetailView } from '@object-ui/app-shell';
import type { DataSource } from '@object-ui/types';
import { APPROVAL_REQUEST_OBJECT, createApprovalRequestsDataSource } from './approvalRequestsDataSource';

const BASE = 'http://test.local/api/v1';
const REQ = 'req_12032';
const ROW = {
  id: REQ, process_name: 'invoice_approval', object_name: 'invoice', record_id: 'inv_1', status: 'pending',
  viewer: { can_act: true, is_submitter: false, can_override: false },
  decision_progress: { behavior: 'quorum', got: 1, need: 2 },
};

const objectDef = {
  name: APPROVAL_REQUEST_OBJECT,
  label: 'Approval Request',
  nameField: 'process_name',
  fields: {
    id: { label: 'Id', type: 'text' },
    process_name: { label: 'Process', type: 'text' },
    status: { label: 'Status', type: 'text' },
    // A declared relation, so the page asks for `$expand`, as it will for the real object.
    submitter_id: { label: 'Submitter', type: 'lookup', reference: 'sys_user' },
  },
};

type Answer = 'ok' | 'forbidden' | 'serverError' | 'notFound';
let answer: Answer = 'ok';
let getReads: string[] = [];

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The approvals get, answered as objectstack's route answers it. */
const approvalsTransport = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  getReads.push(url.pathname + url.search);
  switch (answer) {
    case 'forbidden': return json(403, { code: 'FORBIDDEN', error: 'not a party to this request' });
    case 'serverError': return json(500, { code: 'APPROVAL_REQUEST_GET_FAILED', error: 'db down' });
    case 'notFound': return json(404, { code: 'REQUEST_NOT_FOUND', error: `Approval request '${REQ}' not found` });
    default: return json(200, ROW);
  }
});

/** The page's own global-`fetch` side reads; never a real socket. */
vi.stubGlobal('fetch', vi.fn(async () => json(200, { success: true, data: [] })));

/** The console's adapter, doubled: the page's side reads land here. */
const host = {
  find: vi.fn(async (_resource: string, _params?: unknown) => ({ data: [], total: 0 })),
  findOne: vi.fn(async () => null),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  getObjectSchema: vi.fn(async () => objectDef),
};

const EN: I18nConfig = { defaultLanguage: 'en', detectBrowserLanguage: false };

function openRequestPage() {
  const ds = createApprovalRequestsDataSource({
    host: host as unknown as DataSource,
    scope: { kind: 'awaiting_me', approverIds: ['u1'] },
    fetch: approvalsTransport,
    baseUrl: BASE,
  });
  const metadata = {
    objects: [objectDef], pages: [], loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => [], getItem: async () => null, getItemsByType: () => [],
  } as never;
  render(
    <I18nProvider config={EN} persistLanguage={false}>
      <MemoryRouter initialEntries={[`/apps/demo/${APPROVAL_REQUEST_OBJECT}/record/${REQ}`]}>
        <MetadataCtx.Provider value={metadata}>
          <RecordDetailView
            dataSource={ds as never}
            objects={[objectDef] as never}
            onEdit={() => {}}
            objectNameOverride={APPROVAL_REQUEST_OBJECT}
            recordIdOverride={REQ}
          />
        </MetadataCtx.Provider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

const NOT_FOUND = 'Record not found';

afterEach(() => {
  cleanup();
  answer = 'ok';
  getReads = [];
});

describe('the record page over the routed approvals source (objectui#12032)', () => {
  it('a 403 renders the no-access state, never not-found', async () => {
    answer = 'forbidden';
    openRequestPage();
    const state = await screen.findByTestId('record-access-denied', undefined, { timeout: 5000 });
    expect(state).toHaveTextContent('You don’t have access to Approval Request records');
    expect(screen.queryAllByText(NOT_FOUND)).toHaveLength(0);
  });

  it('a 500 renders the retryable load error, never not-found', async () => {
    answer = 'serverError';
    openRequestPage();
    const state = await screen.findByTestId('record-load-failed', undefined, { timeout: 5000 });
    expect(state).toHaveTextContent('Couldn’t load this record');
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
    expect(screen.queryAllByText(NOT_FOUND)).toHaveLength(0);
  });

  it('control: a 404 still renders not-found', async () => {
    answer = 'notFound';
    openRequestPage();
    expect(await screen.findByText(NOT_FOUND, undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByTestId('record-access-denied')).toBeNull();
    expect(screen.queryByTestId('record-load-failed')).toBeNull();
  });

  it('control: a found request renders, read once from the get route with no query', async () => {
    answer = 'ok';
    openRequestPage();
    expect((await screen.findAllByText('invoice_approval', undefined, { timeout: 5000 })).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.queryByTestId('record-load-failed')).toBeNull());
    expect(new Set(getReads)).toEqual(new Set([`/api/v1/approvals/requests/${REQ}`]));
    // The page's side reads went to the host, not to the approvals route.
    expect(host.find).toHaveBeenCalled();
    expect(host.find.mock.calls.every(([resource]) => resource !== APPROVAL_REQUEST_OBJECT)).toBe(true);
  });
});
