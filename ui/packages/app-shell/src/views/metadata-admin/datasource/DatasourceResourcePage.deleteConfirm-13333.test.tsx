// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13333 — Setup → Datasources asks its delete in the console's in-app
 * AlertDialog, naming the datasource by its label and its name, never through
 * the browser's native `confirm()`.
 *
 * What is pinned:
 *  - (a) the row's Delete opens the in-app dialog; its title names the label,
 *    its body names the machine name; accepting sends one `DELETE`.
 *  - (b) CONTROL: Cancel sends no `DELETE`.
 *  - (c) a row with no label is named by its name.
 *  - every case: `window.confirm` is never called.
 *
 * The objects that still use the datasource (the second describe): the confirm
 * lists the objects whose metadata names it, and a `400` refusal is reported in
 * the console's language, naming those objects and what to do. Expectations are
 * read from Studio's table, never retyped; no case matches the server's English.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

type Reply = { ok: boolean; status: number; text: () => Promise<string> };

const state = vi.hoisted(() => ({
  fetch: (async () => undefined) as unknown as (url: string, init?: RequestInit) => Promise<unknown>,
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
import { t, tFormat } from '../i18n';
import { DatasourceResourcePage } from './DatasourceResourcePage';

// The zh rows read below live in the lazily fetched `studio` namespace; resident
// before any case, so they read synchronously.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

const nativeConfirm = vi.fn(() => true);
beforeEach(() => {
  nativeConfirm.mockClear();
  vi.stubGlobal('confirm', nativeConfirm);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  expect(nativeConfirm).not.toHaveBeenCalled();
});

const reply = (status: number, payload: unknown): Reply => ({
  ok: status < 400,
  status,
  text: async () => JSON.stringify(payload),
});
const ok = (data: unknown) => reply(200, { success: true, data });

const BASE = { driver: 'postgres', schemaMode: 'managed', origin: 'runtime', active: true, status: 'unvalidated' };

function renderPage(row: Record<string, unknown>) {
  const deletes: string[] = [];
  state.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/v1/datasources' && method === 'GET') return ok({ datasources: [row] });
    if (method === 'DELETE') {
      deletes.push(url);
      return ok({});
    }
    return reply(404, { success: false, error: { message: `unexpected ${method} ${url}` } });
  }) as typeof state.fetch;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <DatasourceResourcePage />
    </I18nProvider>,
  );
  return deletes;
}

describe('DatasourceResourcePage — the delete confirm is in-app and names the datasource (objectui#13333)', () => {
  it('(a) the title names the label, the body the name, and accepting sends one DELETE', async () => {
    const deletes = renderPage({ ...BASE, name: 'warehouse', label: 'Sales Warehouse' });
    fireEvent.click(await screen.findByTitle('Delete'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('Delete datasource "Sales Warehouse"?');
    expect(dialog.textContent).toContain('The connection warehouse is removed. This cannot be undone.');
    fireEvent.click(within(dialog).getByTestId('datasource-delete-confirm'));
    await waitFor(() => expect(deletes).toEqual(['/api/v1/datasources/warehouse']));
  });

  it('(b) CONTROL: Cancel sends no DELETE', async () => {
    const deletes = renderPage({ ...BASE, name: 'warehouse', label: 'Sales Warehouse' });
    fireEvent.click(await screen.findByTitle('Delete'));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByTestId('datasource-delete-cancel'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(deletes).toEqual([]);
  });

  it('(c) a datasource with no label is named by its name', async () => {
    renderPage({ ...BASE, name: 'warehouse' });
    fireEvent.click(await screen.findByTitle('Delete'));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByRole('heading').textContent).toBe('Delete datasource "warehouse"?');
  });
});

const OBJECTS = [
  { name: 'part', label: 'Part', datasource: 'parts_db' },
  { name: 'supplier', label: '供应商', datasource: 'parts_db' },
  { name: 'stock_level', datasource: 'parts_db' },
  { name: 'account', label: 'Account', datasource: 'default' },
];
/** The server's own refusal text: what the page shows when it cannot name the objects. */
const SERVER_REFUSAL = "Cannot remove datasource 'parts_db': 3 object(s) are still bound to it.";

function renderBound(
  language: string,
  { objects = OBJECTS, deleteStatus = 400 }: { objects?: unknown[]; deleteStatus?: number } = {},
) {
  const deletes: string[] = [];
  state.metadataClient = { list: async (type: string) => (type === 'object' ? objects : []) };
  state.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (url === '/api/v1/datasources' && method === 'GET') {
      return ok({ datasources: [{ ...BASE, name: 'parts_db', label: 'Parts DB' }] });
    }
    if (method === 'DELETE') {
      deletes.push(url);
      return reply(deleteStatus, { success: false, error: { code: 'DATASOURCE_ADMIN_ERROR', message: SERVER_REFUSAL } });
    }
    return reply(404, { success: false, error: { message: `unexpected ${method} ${url}` } });
  }) as typeof state.fetch;
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <DatasourceResourcePage />
    </I18nProvider>,
  );
  return deletes;
}

async function openConfirm(deleteTitle: string) {
  fireEvent.click(await screen.findByTitle(deleteTitle));
  return screen.findByRole('alertdialog');
}

describe('DatasourceResourcePage — the objects that still use a datasource are named before and after its delete', () => {
  afterEach(() => {
    state.metadataClient = {};
    vi.mocked(toast.error).mockClear();
  });

  it('guard: the zh rows the cases read are real zh rows', () => {
    for (const key of ['engine.datasource.deleteBoundBody', 'engine.datasource.deleteBoundRefused']) {
      expect(t(key, 'zh-CN')).not.toBe(t(key, 'en-US'));
      expect(t(key, 'zh-CN')).toMatch(/\p{Script=Han}/u);
    }
  });

  it('the confirm lists the objects bound to this datasource, and no other datasource\'s', async () => {
    renderBound('zh');
    const dialog = await openConfirm(t('engine.datasource.delete', 'zh-CN'));
    const list = await within(dialog).findByTestId('datasource-delete-bound');
    expect(within(list).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Part (part)',
      '供应商 (supplier)',
      'stock_level',
    ]);
    expect(dialog.textContent).toContain(tFormat('engine.datasource.deleteBoundBody', 'zh-CN', { name: 'parts_db' }));
    expect(dialog.textContent).not.toContain(tFormat('engine.datasource.deleteBody', 'zh-CN', { name: 'parts_db' }));
  });

  it('a 400 refusal is reported in zh, naming the objects, never in the server\'s English', async () => {
    const deletes = renderBound('zh');
    const dialog = await openConfirm(t('engine.datasource.delete', 'zh-CN'));
    await within(dialog).findByTestId('datasource-delete-bound');
    fireEvent.click(within(dialog).getByTestId('datasource-delete-confirm'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(deletes).toEqual(['/api/v1/datasources/parts_db']);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      tFormat('engine.datasource.deleteBoundRefused', 'zh-CN', {
        name: 'parts_db',
        objects: ['Part (part)', '供应商 (supplier)', 'stock_level'].join(t('engine.datasource.boundObjectSeparator', 'zh-CN')),
      }),
    );
  });

  it('CONTROL: with no bound object the confirm keeps its plain body, and a 400 keeps the server\'s message', async () => {
    renderBound('en', { objects: [{ name: 'account', datasource: 'default' }] });
    const dialog = await openConfirm('Delete');
    expect(dialog.textContent).toContain(tFormat('engine.datasource.deleteBody', 'en-US', { name: 'parts_db' }));
    expect(within(dialog).queryByTestId('datasource-delete-bound')).toBeNull();
    fireEvent.click(within(dialog).getByTestId('datasource-delete-confirm'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      tFormat('engine.datasource.deleteFailed', 'en-US', { name: 'parts_db', error: SERVER_REFUSAL }),
    );
  });

  it('CONTROL: a failure that is not a 400 keeps the server\'s message even while objects are bound', async () => {
    renderBound('en', { deleteStatus: 503 });
    const dialog = await openConfirm('Delete');
    await within(dialog).findByTestId('datasource-delete-bound');
    fireEvent.click(within(dialog).getByTestId('datasource-delete-confirm'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(vi.mocked(toast.error).mock.calls[0][0]).toBe(
      tFormat('engine.datasource.deleteFailed', 'en-US', { name: 'parts_db', error: SERVER_REFUSAL }),
    );
  });
});
