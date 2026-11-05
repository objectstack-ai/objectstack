// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30327 and the ui half of objectstack#30331 — the New datasource
 * dialog.
 *
 * #30327: the dialog started on the managed schema mode, which has no Sync and
 * whose schema sync adds an object's columns to an existing table of the same
 * name, on a page whose purpose is to read an existing database. Nothing said
 * what either mode does, and a managed row just had no Sync button.
 * #30331: a text box's default (SQLite's `:memory:`) was the box's VALUE, read
 * as a hint, so a typed path was appended to it (`:memory:/tmp/parts.db`).
 *
 * What is pinned:
 *  - (a) a new datasource starts on External, the select says what External
 *    does and when to pick it, and Create sends `schemaMode: 'external'` with
 *    the `external: {}` block the schema requires;
 *  - (b) choosing Managed swaps the sentence for the managed one, and Create
 *    sends `managed` with no block;
 *  - (c) a text or number box with a default starts empty with the default as
 *    its placeholder; a typed path is the whole value, and Test and Create
 *    send exactly it;
 *  - (d) CONTROL: a box left empty sends its default, so the request is what
 *    it was; a switch keeps its default as its value;
 *  - (e) an edit shows the stored values, no placeholder, and sends them as
 *    they stand;
 *  - (f) a managed row says why it has no Sync; an external row and the
 *    primary datasource say nothing;
 *  - (g) zh: the sentences read in Chinese.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@object-ui/i18n';
import { toast } from 'sonner';
import { t } from '../i18n.js';

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

import { DatasourceResourcePage } from './DatasourceResourcePage';

// The zh rows (g) reads live in the `studio` namespace's lazily fetched `zh`
// catalogue; resident before any case, so they read synchronously.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

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
const ok = (data: unknown, status = 200) => reply(status, { success: true, data });

/** The catalog's SQLite entry as `GET /datasources/drivers` serves it: a defaulted text box and a defaulted switch. */
const SQLITE = {
  id: 'sqlite',
  label: 'SQLite',
  configSchema: {
    properties: {
      filename: { type: 'string', title: 'Filename', default: ':memory:', description: 'Database file path, or ":memory:" for an ephemeral database' },
      wal: { type: 'boolean', title: 'WAL', default: true },
    },
  },
};
/** A defaulted number box beside a defaulted text box. */
const POSTGRES = {
  id: 'postgres',
  label: 'PostgreSQL',
  configSchema: {
    properties: {
      host: { type: 'string', title: 'Host', default: 'localhost' },
      port: { type: 'integer', title: 'Port', default: 5432 },
      database: { type: 'string', title: 'Database' },
    },
  },
};

interface Seen { method: string; url: string; body?: Record<string, unknown> }

function renderPage(opts: { rows?: unknown[]; stored?: Record<string, unknown>; language?: string } = {}) {
  const seen: Seen[] = [];
  state.fetch = (async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    seen.push({ method, url, body });
    if (url === '/api/v1/datasources/drivers') return ok({ drivers: [SQLITE, POSTGRES] });
    if (url === '/api/v1/datasources' && method === 'GET') return ok({ datasources: opts.rows ?? [] });
    if (url === '/api/v1/datasources' && method === 'POST') return ok({ datasource: { name: body?.name } }, 201);
    if (url === '/api/v1/datasources/test') return ok({ result: { ok: true } });
    if (opts.stored && url === `/api/v1/datasources/${String(opts.stored.name)}` && method === 'GET') {
      return ok({ datasource: opts.stored });
    }
    if (opts.stored && url === `/api/v1/datasources/${String(opts.stored.name)}` && method === 'PATCH') {
      return ok({ datasource: { name: opts.stored.name } });
    }
    return reply(404, { success: false, error: { code: 'NOT_FOUND', message: `unexpected ${method} ${url}` } });
  }) as typeof state.fetch;
  render(
    <I18nProvider config={{ defaultLanguage: opts.language ?? 'en', detectBrowserLanguage: false }}>
      <DatasourceResourcePage />
    </I18nProvider>,
  );
  return seen;
}

/** The input or select trigger beside a form label (the page's labels carry no `htmlFor`). */
function controlUnder(label: string | RegExp): HTMLElement {
  const lab = screen.getByText(label, { selector: 'label' });
  // A switch sits beside the div that holds its label; every other control under it.
  const control = lab.parentElement?.querySelector('input, [role="combobox"], [role="switch"]')
    ?? lab.parentElement?.parentElement?.querySelector('[role="switch"]');
  expect(control, `no control beside the "${String(label)}" label`).toBeTruthy();
  return control as HTMLElement;
}

async function openNew(language = 'en') {
  fireEvent.click(await screen.findByRole('button', { name: t('engine.datasource.new', language === 'zh' ? 'zh-CN' : 'en-US') }));
  return screen.findByRole('dialog');
}

async function chooseDriver(label: string) {
  await userEvent.click(controlUnder(/^Driver/));
  await userEvent.click(await screen.findByRole('option', { name: label }));
}

async function chooseMode(name: RegExp) {
  await userEvent.click(controlUnder('Schema mode'));
  await userEvent.click(await screen.findByRole('option', { name }));
}

const lastWrite = (seen: Seen[], method: string, url: string) => {
  const hits = seen.filter((r) => r.method === method && r.url === url);
  expect(hits.length, `a ${method} ${url} was sent`).toBeGreaterThan(0);
  return hits[hits.length - 1].body ?? {};
};

const EN = 'en-US';
const ZH = 'zh-CN';

describe('New datasource — starts on External and says what each schema mode does (objectstack#30327)', () => {
  it('(a) starts on External with its sentence, and Create sends external with the block', async () => {
    const seen = renderPage();
    const dialog = await openNew();
    expect(within(controlUnder('Schema mode')).getByText(t('engine.datasource.schemaModeExternal', EN))).toBeTruthy();
    expect(within(dialog).getByTestId('datasource-schema-mode-hint').textContent).toBe(t('engine.datasource.schemaModeExternalHint', EN));
    fireEvent.change(controlUnder('Name *'), { target: { value: 'parts_db' } });
    fireEvent.change(controlUnder('Filename'), { target: { value: '/srv/data/parts.db' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Create datasource/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const post = lastWrite(seen, 'POST', '/api/v1/datasources');
    expect(post).toMatchObject({ name: 'parts_db', driver: 'sqlite', schemaMode: 'external', config: { filename: '/srv/data/parts.db' } });
    expect(post.external).toEqual({});
  });

  it('(b) Managed swaps the sentence, and Create sends managed with no block', async () => {
    const seen = renderPage();
    const dialog = await openNew();
    await chooseMode(/^Managed/);
    expect(within(dialog).getByTestId('datasource-schema-mode-hint').textContent).toBe(t('engine.datasource.schemaModeManagedHint', EN));
    await chooseMode(/^Validate only/);
    expect(within(dialog).getByTestId('datasource-schema-mode-hint').textContent).toBe(t('engine.datasource.schemaModeValidateOnlyHint', EN));
    await chooseMode(/^Managed/);
    fireEvent.change(controlUnder('Name *'), { target: { value: 'scratch' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Create datasource/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const post = lastWrite(seen, 'POST', '/api/v1/datasources');
    expect(post.schemaMode).toBe('managed');
    expect('external' in post).toBe(false);
  });
});

describe('New datasource — a box default is a placeholder, not a value (objectstack#30331)', () => {
  it('(c) Filename starts empty with :memory: as its placeholder; a typed path is the whole value', async () => {
    const seen = renderPage();
    const dialog = await openNew();
    const filename = controlUnder('Filename') as HTMLInputElement;
    expect(filename.value).toBe('');
    expect(filename.placeholder).toBe(':memory:');
    await userEvent.type(filename, '/srv/data/parts.db');
    expect(filename.value).toBe('/srv/data/parts.db');
    fireEvent.click(within(dialog).getByRole('button', { name: /Test connection/ }));
    await waitFor(() => expect(seen.some((r) => r.url === '/api/v1/datasources/test')).toBe(true));
    expect(lastWrite(seen, 'POST', '/api/v1/datasources/test')).toMatchObject({ driver: 'sqlite', config: { filename: '/srv/data/parts.db', wal: true } });
  });

  it('(d) CONTROL: boxes left empty send their defaults; a switch keeps its default as its value', async () => {
    const seen = renderPage();
    const dialog = await openNew();
    expect((controlUnder('WAL')).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(dialog).getByRole('button', { name: /Test connection/ }));
    await waitFor(() => expect(seen.some((r) => r.url === '/api/v1/datasources/test')).toBe(true));
    expect(lastWrite(seen, 'POST', '/api/v1/datasources/test').config).toEqual({ filename: ':memory:', wal: true });

    await chooseDriver('PostgreSQL');
    const host = controlUnder('Host') as HTMLInputElement;
    const port = controlUnder('Port') as HTMLInputElement;
    expect([host.value, host.placeholder]).toEqual(['', 'localhost']);
    expect([port.value, port.placeholder]).toEqual(['', '5432']);
    fireEvent.change(controlUnder('Name *'), { target: { value: 'warehouse' } });
    fireEvent.change(controlUnder('Database'), { target: { value: 'wh' } });
    // Typed then cleared counts as empty.
    fireEvent.change(host, { target: { value: 'db' } });
    fireEvent.change(host, { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Create datasource/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(lastWrite(seen, 'POST', '/api/v1/datasources').config).toEqual({ host: 'localhost', port: 5432, database: 'wh' });
  });

  it('(e) an edit shows the stored values with no placeholder, and sends them as they stand', async () => {
    const stored = { name: 'parts_db', driver: 'sqlite', schemaMode: 'external', config: { filename: '/srv/data/parts.db' }, origin: 'runtime', hasSecret: false };
    const seen = renderPage({ rows: [{ name: 'parts_db', driver: 'sqlite', origin: 'runtime', status: 'ok', schemaMode: 'external' }], stored });
    fireEvent.click(await screen.findByTitle(t('engine.datasource.edit', EN)));
    const dialog = await screen.findByRole('dialog');
    const filename = controlUnder('Filename') as HTMLInputElement;
    expect(filename.value).toBe('/srv/data/parts.db');
    expect(filename.placeholder).toBe('');
    fireEvent.click(within(dialog).getByRole('button', { name: /Save changes/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(lastWrite(seen, 'PATCH', '/api/v1/datasources/parts_db').config).toEqual({ filename: '/srv/data/parts.db' });
  });
});

describe('A managed row says why it has no Sync (objectstack#30327)', () => {
  const rows = [
    { name: 'default', driver: 'sqlite', origin: 'code', status: 'ok', schemaMode: 'managed' },
    { name: 'scratch', driver: 'sqlite', origin: 'runtime', status: 'ok', schemaMode: 'managed' },
    { name: 'parts_db', driver: 'sqlite', origin: 'runtime', status: 'ok', schemaMode: 'external' },
  ];
  const rowOf = (name: string) => {
    const row = screen.getByText(name, { selector: 'code' }).closest('div.flex.items-center.gap-3');
    if (!(row instanceof HTMLElement)) throw new Error(`no ${name} row`);
    return row;
  };

  it('(f) the managed row carries the note; the external row and the primary datasource do not', async () => {
    renderPage({ rows });
    await screen.findByText('scratch', { selector: 'code' });
    expect(within(rowOf('scratch')).getByTestId('datasource-no-sync-note').textContent).toBe(t('engine.datasource.noSyncManaged', EN));
    expect(within(rowOf('scratch')).queryByRole('button', { name: t('engine.datasource.sync', EN) })).toBeNull();
    expect(within(rowOf('parts_db')).queryByTestId('datasource-no-sync-note')).toBeNull();
    expect(within(rowOf('parts_db')).getByRole('button', { name: t('engine.datasource.sync', EN) })).toBeTruthy();
    expect(within(rowOf('default')).queryByTestId('datasource-no-sync-note')).toBeNull();
  });

  it('(g) zh: the mode sentences and the note read in Chinese', async () => {
    for (const key of [
      'engine.datasource.schemaModeExternal',
      'engine.datasource.schemaModeManaged',
      'engine.datasource.schemaModeExternalHint',
      'engine.datasource.schemaModeManagedHint',
      'engine.datasource.schemaModeValidateOnlyHint',
      'engine.datasource.noSyncManaged',
    ]) {
      expect(t(key, ZH), key).toMatch(/\p{Script=Han}/u);
      expect(t(key, ZH), key).not.toBe(t(key, EN));
    }
    renderPage({ rows, language: 'zh' });
    await screen.findByText('scratch', { selector: 'code' });
    expect(within(rowOf('scratch')).getByTestId('datasource-no-sync-note').textContent).toBe(t('engine.datasource.noSyncManaged', ZH));
    const dialog = await openNew('zh');
    expect(within(dialog).getByTestId('datasource-schema-mode-hint').textContent).toBe(t('engine.datasource.schemaModeExternalHint', ZH));
  });
});
