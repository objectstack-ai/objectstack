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
 *
 * objectstack#32305 (the second describe): a refusal's line is the envelope's
 * `message`; the rationale and the remedy are its `details.hint`. The page
 * shows the hint under the line wherever the server sends one, keeping its
 * line breaks, and nothing extra when it sends none. Envelopes below are the
 * shape `datasourceAdminRefusal` / `withRefusalDetails` (service-datasource
 * `datasource-refusal.ts`) answer on `main`.
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
const refuse = (status: number, message: string, details?: Record<string, unknown>) =>
  reply(status, { success: false, error: { code: 'DATASOURCE_ADMIN_ERROR', message, ...(details ? { details } : {}) } });

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

// ── objectstack#32305: the hint under the line ─────────────────────────────

const SQLITE = { id: 'sqlite', label: 'SQLite', configSchema: { properties: {} } };
const CREATE_URL = '/api/v1/datasources';
const DRAFT_TEST_URL = '/api/v1/datasources/test';

/** A multi-finding config refusal, as `listedRefusal('invalid_config', …)` builds it. */
const CONFIG_LINE = "Invalid configuration for driver 'sqlite': 2 issue(s) found.";
const CONFIG_FINDINGS = ['config.filename: Required', 'config.readonly: Expected boolean, received string'];
const CONFIG_REFUSAL = { reason: 'invalid_config', hint: CONFIG_FINDINGS.join('\n') };

/** A Sync-door refusal, as `withRefusalDetails(err, 'not_federation_source', hint)` builds it. */
const SYNC_LINE = "Datasource 'warehouse' is not a federation source.";
const SYNC_HINT = "Sync reads a datasource whose schemaMode is external or validate-only.\nSet its Schema mode to External, then Sync again.";

/** Opens the editor on a new datasource named `warehouse`. */
async function openNewDatasource() {
  fireEvent.click(await screen.findByRole('button', { name: /New datasource/ }));
  const name = (await screen.findByText('Name *', { selector: 'label' })).parentElement?.querySelector('input');
  expect(name, 'the Name box').toBeTruthy();
  fireEvent.change(name as HTMLInputElement, { target: { value: 'warehouse' } });
}

function withDrivers(route: (url: string, init?: RequestInit) => Reply | undefined) {
  return (url: string, init?: RequestInit) => (url === '/api/v1/datasources/drivers' ? ok({ drivers: [SQLITE] }) : route(url, init));
}

describe('DatasourceResourcePage — a refusal shows its details.hint under its line (objectstack#32305)', () => {
  it('a refused Save toasts the line, with the multi-finding hint as the description, one finding per line', async () => {
    renderPage(withDrivers((url, init) => (url === CREATE_URL && init?.method === 'POST' ? refuse(400, CONFIG_LINE, CONFIG_REFUSAL) : undefined)));
    await openNewDatasource();
    fireEvent.click(screen.getByRole('button', { name: /Create datasource/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    const [line, options] = vi.mocked(toast.error).mock.calls[0] as [string, { description?: unknown; descriptionClassName?: string }];
    expect(line).toContain(CONFIG_LINE);
    expect(line).not.toContain(CONFIG_FINDINGS[0]);
    expect(String(options?.description).split('\n')).toEqual(CONFIG_FINDINGS);
    expect(options?.descriptionClassName).toContain('whitespace-pre-line');
  });

  it('CONTROL: a refused Save with no hint toasts the line alone', async () => {
    const message = "Datasource 'warehouse' already exists.";
    renderPage(withDrivers((url, init) => (url === CREATE_URL && init?.method === 'POST' ? refuse(400, message, { reason: 'already_exists' }) : undefined)));
    await openNewDatasource();
    fireEvent.click(screen.getByRole('button', { name: /Create datasource/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0]).toHaveLength(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain(message);
  });

  it('a refused draft Test draws the hint under the editor\'s inline line, one finding per line', async () => {
    renderPage(withDrivers((url) => (url === DRAFT_TEST_URL ? refuse(400, CONFIG_LINE, CONFIG_REFUSAL) : undefined)));
    await openNewDatasource();
    fireEvent.click(screen.getByRole('button', { name: /Test connection/ }));
    const hint = await screen.findByTestId('datasource-refusal-hint');
    expect(hint.textContent).toBe(CONFIG_FINDINGS.join('\n'));
    expect(hint.className).toContain('whitespace-pre-line');
    expect(screen.getByText(CONFIG_LINE)).toBeTruthy();
  });

  it('a refused remote-tables read draws the hint under the line in the Sync dialog, keeping its line breaks', async () => {
    renderPage((url) => (url === TABLES_URL ? refuse(400, SYNC_LINE, { reason: 'not_federation_source', hint: SYNC_HINT }) : undefined));
    fireEvent.click(await screen.findByRole('button', { name: /Sync objects/ }));
    const alert = await within(await screen.findByRole('dialog')).findByRole('alert');
    const hint = within(alert).getByTestId('datasource-refusal-hint');
    expect(hint.textContent).toBe(SYNC_HINT);
    expect(hint.className).toContain('whitespace-pre-line');
    expect(alert.textContent).toBe(SYNC_LINE + SYNC_HINT);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('CONTROL: a refused remote-tables read with no hint draws the line alone', async () => {
    renderPage((url) => (url === TABLES_URL ? refuse(400, SYNC_LINE, { reason: 'not_federation_source' }) : undefined));
    fireEvent.click(await screen.findByRole('button', { name: /Sync objects/ }));
    const alert = await within(await screen.findByRole('dialog')).findByRole('alert');
    expect(alert.textContent).toBe(SYNC_LINE);
    expect(within(alert).queryByTestId('datasource-refusal-hint')).toBeNull();
  });

  it('a refused row Test toasts the line with the hint as the description', async () => {
    const line = "Datasource 'warehouse' is defined in code.";
    const hint = 'Change it in the code that declares it.';
    renderPage((url) => (url === TEST_URL ? refuse(400, line, { reason: 'code_defined', hint }) : undefined));
    fireEvent.click(await screen.findByRole('button', { name: /Test/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain(line);
    expect(vi.mocked(toast.error).mock.calls[0][1]).toMatchObject({ description: hint });
  });
});
