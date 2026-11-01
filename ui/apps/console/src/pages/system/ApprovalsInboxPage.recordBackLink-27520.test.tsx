/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectstack#27520 row 12 — a row's record link keeps a way back to the inbox.
 *
 * The record link stays where it was: the console's standard record route in
 * the inbox's own app segment (`ApprovalsInboxPage.recordLink.test.tsx` pins
 * the href). Inside an app whose navigation does not list the record's object,
 * such as the Account app, which lists the inbox, the record page had no way
 * back. The link now hands the record page the history-state origin every list
 * row hands it (`state.from`), so the page's crumb row draws a link back to the
 * inbox, named as the inbox's own header names it.
 *
 * The harness mounts the REAL inbox page and, on the record route, the REAL
 * `RecordDetailView`; only the HTTP transport, the console adapter and the
 * inbox's list read (`approvalsApi.listRequests`) are doubled.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const { approvalsApiStub, ROW, AUTH } = vi.hoisted(() => {
  const ROW = {
    id: 'req_27520',
    process_name: 'flow:invoice_approval',
    process_label: 'Invoice Approval',
    object_name: 'invoice',
    object_label: 'Invoice',
    record_id: 'inv_1',
    record_title: 'INV-1010',
    status: 'pending',
    pending_approvers: ['u1'],
    submitter_id: 'u2',
    submitter_name: 'Sam Submitter',
    submitted_at: '2026-10-20T09:00:00.000Z',
    updated_at: '2026-10-20T09:00:00.000Z',
  };
  const approvalsApiStub = {
    listRequests: vi.fn(async () => ({ data: [ROW], total: 1 })),
    getRequest: vi.fn(async () => ({ data: ROW })),
    listActions: vi.fn(async () => ({ data: [] })),
    approve: vi.fn(async () => ({ data: ROW, finalized: true })),
    reject: vi.fn(async () => ({ data: ROW, finalized: true })),
  };
  // A STABLE singleton: a fresh user per render re-runs the inbox's load
  // effect forever, and the queue never leaves its skeleton.
  const AUTH = { user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null };
  return { approvalsApiStub, ROW, AUTH };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => AUTH,
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
vi.mock('../../services/approvalsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  approvalsApi: approvalsApiStub,
}));

import { AdapterCtx, MetadataCtx, SchemaRendererProvider, useAdapter } from '@object-ui/react';
import { I18nProvider, type I18nConfig } from '@object-ui/i18n';
import { RecordDetailView } from '@object-ui/app-shell';
import { ApprovalsInboxPage } from './ApprovalsInboxPage';

/** The Account app's route segment: its nav lists the inbox, not invoices. */
const APP = 'account';
const INBOX = `/apps/${APP}/component/approvals/inbox`;
const RECORD_PAGE = `/apps/${APP}/invoice/record/${ROW.record_id}`;

const INVOICE_DEF = {
  name: 'invoice',
  label: 'Invoice',
  pluralLabel: 'Invoices',
  nameField: 'name',
  fields: { name: { type: 'text', label: 'Invoice Number' } },
};
const RECORD = { id: ROW.record_id, name: ROW.record_title };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
vi.stubGlobal('fetch', vi.fn(async () => json(200, { success: true, data: [] })));

const host = {
  // The inbox's readability probe reads `id in (…)`: the record is readable.
  find: vi.fn(async (_object: string, params?: Record<string, unknown>) => {
    const ids = (params?.$filter as { id?: { $in?: string[] } } | undefined)?.id?.$in;
    return ids ? { data: ids.map((id) => ({ id })), total: ids.length } : { data: [], total: 0 };
  }),
  findOne: vi.fn(async (object: string, id: string) => (object === 'invoice' && id === RECORD.id ? RECORD : null)),
  create: vi.fn(), update: vi.fn(), delete: vi.fn(),
  getObjectSchema: vi.fn(async (name: string) => (name === 'invoice' ? INVOICE_DEF : null)),
};
const metadata = {
  apps: [], objects: [INVOICE_DEF], dashboards: [], reports: [],
  pages: [], loading: false, error: null,
  refresh: async () => {}, invalidate: () => {}, ensureType: async () => [],
  getItem: vi.fn(async (type: string, name: string) => (type === 'object' && name === 'invoice' ? INVOICE_DEF : null)),
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};
const EN: I18nConfig = { defaultLanguage: 'en', detectBrowserLanguage: false };

/** `DefaultAppContent`'s generic record route: the view over `useAdapter()`. */
function GenericRecordRoute() {
  return <RecordDetailView dataSource={useAdapter()} objects={metadata.objects as never} onEdit={() => {}} />;
}

function RouterProbe() {
  const location = useLocation();
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>;
}

function renderAt(entry: string) {
  return render(
    <I18nProvider config={EN} persistLanguage={false}>
      <MemoryRouter initialEntries={[entry]}>
        <SchemaRendererProvider dataSource={host as never}>
          <MetadataCtx.Provider value={metadata as never}>
            <AdapterCtx.Provider value={host as never}>
              <RouterProbe />
              <Routes>
                <Route path="/apps/:appName/component/approvals/inbox" element={<ApprovalsInboxPage />} />
                <Route path="/apps/:appName/:objectName/record/:recordId" element={<GenericRecordRoute />} />
              </Routes>
            </AdapterCtx.Provider>
          </MetadataCtx.Provider>
        </SchemaRendererProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
}

const where = () => screen.getByTestId('where').textContent;

/** The desktop row's record link (the mobile card draws none). */
async function recordLink(): Promise<HTMLElement> {
  await screen.findAllByText(ROW.record_title, undefined, { timeout: 8000 });
  const row = screen.getAllByRole('row').find((r) => within(r).queryAllByText(ROW.record_title).length > 0);
  if (!row) throw new Error('no inbox row for the request');
  return within(row).findByRole('link', { name: ROW.record_title }, { timeout: 8000 });
}

beforeEach(() => {
  for (const fn of Object.values(approvalsApiStub)) fn.mockClear();
});
afterEach(cleanup);

describe('the inbox record link keeps a way back to the inbox (objectstack#27520 row 12)', () => {
  it('the record page it opens draws a link back to the inbox, and the link returns there', async () => {
    renderAt(INBOX);
    const link = await recordLink();
    // The target app stays the inbox's own (the recordLink pin's href).
    expect(link).toHaveAttribute('href', RECORD_PAGE);
    fireEvent.click(link);
    expect(where()).toBe(RECORD_PAGE);

    const back = await screen.findByRole('link', { name: 'Approvals Inbox' }, { timeout: 8000 });
    expect(back).toHaveAttribute('href', INBOX);
    fireEvent.click(back);
    expect(where()).toBe(INBOX);
  });

  it('CONTROL: a record page reached without the inbox draws no such link', async () => {
    renderAt(RECORD_PAGE);
    await screen.findAllByText(ROW.record_title, undefined, { timeout: 8000 });
    expect(screen.queryByRole('link', { name: 'Approvals Inbox' })).toBeNull();
  });
});
