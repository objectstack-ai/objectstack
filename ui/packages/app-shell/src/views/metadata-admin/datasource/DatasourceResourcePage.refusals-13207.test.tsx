// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13207 — Setup → Datasources draws a refusal as a refusal.
 *
 * Two positions of one defect on one page:
 *  - **Test.** `POST /api/v1/datasources/:name/test` answers 200
 *    `{ ok: false, error }` for a probe that failed. The page raised a success
 *    toast carrying the failure text.
 *  - **Sync objects.** `GET /api/v1/datasources/:name/remote-tables` answered
 *    with a refusal envelope. The page raised an error toast and then drew the
 *    dialog's empty state, "No remote tables found on this datasource.", so a
 *    refusal read as an empty datasource.
 *
 * What is pinned:
 *  - (a) Test answering `{ ok: false, error }` raises an error toast with the
 *    server's text, and no success toast.
 *  - (b) CONTROL: Test answering `{ ok: true }` raises a success toast.
 *  - (c) Sync refused with a 400 envelope shows the envelope's message in the
 *    dialog; the empty-datasource copy is absent and no toast double-reports.
 *  - (d) CONTROL: Sync succeeding with zero tables shows the empty copy.
 *  - (e) Sync refused after the dialog was closed reports through a toast.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

type Reply = { ok: boolean; status: number; text: () => Promise<string> };

const state = vi.hoisted(() => ({
  fetch: (async () => undefined) as unknown as (url: string, init?: RequestInit) => Promise<unknown>,
  // STABLE identity, like the real memoized client.
  metadataClient: {},
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => (url: string, init?: RequestInit) => state.fetch(url, init),
}));
vi.mock('../useMetadata.js', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() },
}));

import { toast } from 'sonner';
import { DatasourceResourcePage } from './DatasourceResourcePage';

afterEach(() => {
  cleanup();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

const reply = (status: number, payload: unknown): Reply => ({
  ok: status < 400,
  status,
  text: async () => JSON.stringify(payload),
});
const ok = (data: unknown) => reply(200, { success: true, data });
const refuse = (status: number, message: string) =>
  reply(status, { success: false, error: { code: 'DATASOURCE_ADMIN_ERROR', message } });

// `external`: only a federation source offers Sync (objectui#13318).
const ROW = { name: 'warehouse', driver: 'postgres', schemaMode: 'external', origin: 'runtime', active: true, status: 'unvalidated' };

/** The admin door, reduced to the list read plus the one route under test. */
function renderPage(route: (url: string, init?: RequestInit) => Promise<Reply> | Reply | undefined) {
  state.fetch = (async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/datasources' && (init?.method ?? 'GET') === 'GET') return ok({ datasources: [ROW] });
    const answer = await route(url, init);
    return answer ?? refuse(404, `unexpected ${init?.method ?? 'GET'} ${url}`);
  }) as typeof state.fetch;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <DatasourceResourcePage />
    </I18nProvider>,
  );
}

const TEST_URL = '/api/v1/datasources/warehouse/test';
const TABLES_URL = '/api/v1/datasources/warehouse/remote-tables';
const EMPTY_COPY = 'No remote tables found on this datasource.';

describe('DatasourceResourcePage — refusals read as refusals (objectui#13207)', () => {
  it('(a) a Test answering ok:false raises an error toast with the server text, and no success toast', async () => {
    const error = "[ObjectQL] Datasource 'warehouse' has no registered driver to introspect.";
    renderPage((url) => (url === TEST_URL ? ok({ ok: false, error }) : undefined));
    fireEvent.click(await screen.findByRole('button', { name: /Test/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain(error);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('(b) CONTROL: a Test answering ok:true raises a success toast', async () => {
    renderPage((url) => (url === TEST_URL ? ok({ ok: true, latencyMs: 12 }) : undefined));
    fireEvent.click(await screen.findByRole('button', { name: /Test/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('(c) a refused remote-tables read shows the envelope message in the dialog, not the empty copy', async () => {
    const message = "Datasource 'warehouse' has no registered driver to introspect.";
    renderPage((url) => (url === TABLES_URL ? refuse(400, message) : undefined));
    fireEvent.click(await screen.findByRole('button', { name: /Sync objects/ }));
    const dialog = await screen.findByRole('dialog');
    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toBe(message);
    expect(within(dialog).queryByText(EMPTY_COPY)).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('(d) CONTROL: a successful remote-tables read with zero tables shows the empty copy', async () => {
    renderPage((url) => (url === TABLES_URL ? ok({ tables: [] }) : undefined));
    fireEvent.click(await screen.findByRole('button', { name: /Sync objects/ }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(EMPTY_COPY)).toBeTruthy();
    expect(within(dialog).queryByRole('alert')).toBeNull();
  });

  it('(e) a refusal that arrives after the dialog was closed reports through an error toast', async () => {
    const message = 'introspection refused';
    let release: (r: Reply) => void = () => undefined;
    const pending = new Promise<Reply>((resolve) => { release = resolve; });
    renderPage((url) => (url === TABLES_URL ? pending : undefined));
    fireEvent.click(await screen.findByRole('button', { name: /Sync objects/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    release(refuse(400, message));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain(message);
  });
});
