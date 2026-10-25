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

import { DatasourceResourcePage } from './DatasourceResourcePage';

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
