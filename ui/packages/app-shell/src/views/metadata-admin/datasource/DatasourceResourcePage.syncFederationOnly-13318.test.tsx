// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13318 — Setup → Datasources offers "Sync objects" only on a
 * federation source.
 *
 * Every Sync door (remote tables, object draft, import, catalog refresh)
 * refuses a datasource that is not a federation source with a `400`
 * (objectstack#24837): a managed one, declared or by default, and the
 * platform's primary datasource `default` by name. The page offered the
 * button on every row, so on a managed row it opened a dialog that could only
 * show the refusal.
 *
 * What is pinned, over the list payload `GET /api/v1/datasources` serves:
 *  - (a) a row with no `schemaMode` and a row with `schemaMode: 'managed'`
 *    show no Sync button;
 *  - (b) a row with `external` and a row with `validate-only` show it;
 *  - (c) the `default` row shows none, even declared `external`;
 *  - (d) CONTROL: on an `external` row, Sync opens the dialog and lists the
 *    remote tables.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
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

import { DatasourceResourcePage } from './DatasourceResourcePage';

afterEach(() => cleanup());

const reply = (status: number, payload: unknown): Reply => ({
  ok: status < 400,
  status,
  text: async () => JSON.stringify(payload),
});
const ok = (data: unknown) => reply(200, { success: true, data });

type Row = { name: string; schemaMode?: 'managed' | 'external' | 'validate-only' };

/** The admin door: the list read and the one remote-tables read. */
function renderPage(rows: Row[], tables: Record<string, unknown[]> = {}) {
  const requested: string[] = [];
  state.fetch = (async (url: string, init?: RequestInit) => {
    requested.push(`${init?.method ?? 'GET'} ${url}`);
    if (url === '/api/v1/datasources') {
      return ok({
        datasources: rows.map((r) => ({ driver: 'postgres', origin: 'runtime', active: true, status: 'unvalidated', ...r })),
      });
    }
    const m = /^\/api\/v1\/datasources\/([^/]+)\/remote-tables$/.exec(url);
    if (m && tables[m[1]]) return ok({ tables: tables[m[1]] });
    return reply(404, { success: false, error: { code: 'NOT_FOUND', message: `unexpected ${url}` } });
  }) as typeof state.fetch;
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <DatasourceResourcePage />
    </I18nProvider>,
  );
  return requested;
}

/** The list row whose name chip reads `name`. */
async function rowOf(name: string): Promise<HTMLElement> {
  const chip = await screen.findByText(name, { selector: 'code' });
  const row = chip.closest('div.flex.items-center.gap-3');
  if (!(row instanceof HTMLElement)) throw new Error(`no row for ${name}`);
  return row;
}

const syncIn = (row: HTMLElement) => within(row).queryByRole('button', { name: /Sync objects/ });

describe('DatasourceResourcePage — Sync is offered only on a federation source (objectui#13318)', () => {
  it('(a) a row with no schemaMode and a managed row show no Sync button', async () => {
    renderPage([{ name: 'qa_mem' }, { name: 'crm_db', schemaMode: 'managed' }]);
    const undeclared = await rowOf('qa_mem');
    const managed = await rowOf('crm_db');
    // The rows rendered: their Test buttons are there.
    expect(within(undeclared).getByRole('button', { name: /Test/ })).toBeTruthy();
    expect(within(managed).getByRole('button', { name: /Test/ })).toBeTruthy();
    expect(syncIn(undeclared)).toBeNull();
    expect(syncIn(managed)).toBeNull();
  });

  it('(b) an external row and a validate-only row show the Sync button', async () => {
    renderPage([{ name: 'warehouse', schemaMode: 'external' }, { name: 'legacy_erp', schemaMode: 'validate-only' }]);
    expect(syncIn(await rowOf('warehouse'))).not.toBeNull();
    expect(syncIn(await rowOf('legacy_erp'))).not.toBeNull();
  });

  it('(c) the default row shows no Sync button, even declared external', async () => {
    renderPage([{ name: 'default', schemaMode: 'external' }, { name: 'warehouse', schemaMode: 'external' }]);
    expect(syncIn(await rowOf('default'))).toBeNull();
    expect(syncIn(await rowOf('warehouse'))).not.toBeNull();
  });

  it('(d) CONTROL: Sync on an external row opens the dialog and lists the remote tables', async () => {
    const requested = renderPage(
      [{ name: 'warehouse', schemaMode: 'external' }],
      { warehouse: [{ name: 'orders', columnCount: 4 }, { name: 'customers', columnCount: 7 }] },
    );
    const sync = syncIn(await rowOf('warehouse'));
    if (!sync) throw new Error('the external row offers no Sync button');
    fireEvent.click(sync);
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('orders')).toBeTruthy();
    expect(within(dialog).getByText('customers')).toBeTruthy();
    expect(requested).toContain('GET /api/v1/datasources/warehouse/remote-tables');
  });
});
