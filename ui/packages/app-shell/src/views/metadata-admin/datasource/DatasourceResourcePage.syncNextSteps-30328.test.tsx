// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#30328 — after Sync creates objects, the dialog says what was
 * created, links each new object, and names the two steps left before people
 * can use it: add it to an app, and grant access in a permission set.
 *
 * A synced object is in no app, and an ordinary member is refused it until a
 * permission set grants it, so a bare "Synced 1 object" toast left the
 * administrator with no way to the object and no word on what was missing.
 *
 * What is pinned, over the four reads and writes a Sync run makes:
 *  - (a) one object created: the dialog stays open on the result, its link
 *    opens the object under the app the page is in, and both steps are named;
 *  - (b) two created and one refused: each created object is linked, the
 *    refusal still reaches the error toast;
 *  - (c) none created: the dialog closes as before, with the refusal toasted;
 *  - (d) zh: the result and both steps read in Chinese.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';
import { toast } from 'sonner';
import { t, tFormat } from '../i18n.js';

type Reply = { ok: boolean; status: number; text: () => Promise<string> };

const state = vi.hoisted(() => ({
  fetch: (async () => undefined) as unknown as (url: string, init?: RequestInit) => Promise<unknown>,
  saved: [] as string[],
  // STABLE identity, like the real memoized client.
  metadataClient: {} as { save?: (type: string, name: string, def: unknown) => Promise<unknown> },
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

// The zh rows (d) reads live in the `studio` namespace's lazily fetched `zh`
// catalogue; resident before any case, so they read synchronously.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

beforeEach(() => {
  state.saved = [];
  state.metadataClient.save = async (_type: string, name: string) => {
    state.saved.push(name);
    return {};
  };
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.success).mockClear();
});
afterEach(() => cleanup());

const reply = (status: number, payload: unknown): Reply => ({
  ok: status < 400,
  status,
  text: async () => JSON.stringify(payload),
});
const ok = (data: unknown) => reply(200, { success: true, data });

/** The path the router is on, so a link's click can be read as a navigation. */
function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

/**
 * Setup's Datasources page with one external row, `parts_db`, whose remote
 * tables are `tables`. A table in `refused` answers the draft with a 400.
 */
function renderPage(tables: string[], refused: string[] = [], language = 'en') {
  state.fetch = (async (url: string, init?: RequestInit) => {
    if (url === '/api/v1/datasources') {
      return ok({ datasources: [{ name: 'parts_db', driver: 'sqlite', origin: 'runtime', active: true, status: 'ok', schemaMode: 'external' }] });
    }
    if (url === '/api/v1/datasources/parts_db/remote-tables') {
      return ok({ tables: tables.map((name) => ({ name, columnCount: 3 })) });
    }
    if (url === '/api/v1/datasources/parts_db/object-draft' && init?.method === 'POST') {
      const { table } = JSON.parse(String(init.body)) as { table: string };
      if (refused.includes(table)) {
        return reply(400, { success: false, error: { code: 'EXTERNAL_DATASOURCE_ERROR', message: `cannot draft ${table}` } });
      }
      const label = table.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
      return ok({ draft: { name: table, datasource: 'parts_db', definition: { name: table, label, fields: {} } } });
    }
    return reply(404, { success: false, error: { code: 'NOT_FOUND', message: `unexpected ${url}` } });
  }) as typeof state.fetch;
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={['/apps/setup/metadata/datasource']}>
        <Routes>
          <Route path="*" element={<><DatasourceResourcePage /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** Opens Sync on `parts_db`, ticks `pick`, and runs it; resolves on the open dialog. */
async function sync(pick: string[]): Promise<HTMLElement> {
  const chip = await screen.findByText('parts_db', { selector: 'code' });
  const row = chip.closest('div.flex.items-center.gap-3');
  if (!(row instanceof HTMLElement)) throw new Error('no parts_db row');
  const syncButton = within(row).getAllByRole('button').find((b) => b.querySelector('svg.lucide-boxes'));
  if (!syncButton) throw new Error('the external row offers no Sync button');
  fireEvent.click(syncButton);
  const dialog = await screen.findByRole('dialog');
  for (const table of pick) {
    const label = (await within(dialog).findByText(table)).closest('label');
    fireEvent.click(within(label as HTMLElement).getByRole('checkbox'));
  }
  const run = within(dialog).getAllByRole('button').find((b) => b.querySelector('svg.lucide-boxes'));
  if (!run) throw new Error('no Create button');
  fireEvent.click(run);
  return dialog;
}

const EN = 'en-US';
const ZH = 'zh-CN';

describe('DatasourceResourcePage — Sync result links the new objects and names the steps left (objectstack#30328)', () => {
  it('(a) one object: the dialog stays on the result, links the object under the app, and names both steps', async () => {
    renderPage(['spare_parts']);
    const dialog = await sync(['spare_parts']);
    const result = await within(dialog).findByTestId('datasource-sync-result');
    expect(state.saved).toEqual(['spare_parts']);
    expect(result.textContent).toContain(tFormat('engine.datasource.syncedOne', EN, { name: 'parts_db' }));
    const link = within(result).getByTestId('datasource-sync-object-link');
    expect(link.textContent).toBe('Spare Parts (spare_parts)');
    expect(link.getAttribute('href')).toBe('/apps/setup/spare_parts');
    expect(result.textContent).toContain(t('engine.datasource.syncNextStepsOne', EN));
    const steps = within(result).getAllByRole('listitem').map((li) => li.textContent);
    expect(steps).toContain(t('engine.datasource.syncNextStepApp', EN));
    expect(steps).toContain(t('engine.datasource.syncNextStepAccess', EN));
    // The result replaces the toast, so it is said once.
    expect(toast.success).not.toHaveBeenCalled();
    // The link is a router link: following it moves the console, not the page.
    fireEvent.click(link);
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/apps/setup/spare_parts'));
  });

  it('(b) two created, one refused: both created are linked and the refusal is toasted', async () => {
    renderPage(['spare_parts', 'suppliers', 'broken'], ['broken']);
    const dialog = await sync(['spare_parts', 'suppliers', 'broken']);
    const result = await within(dialog).findByTestId('datasource-sync-result');
    expect(result.textContent).toContain(tFormat('engine.datasource.synced', EN, { count: 2, name: 'parts_db' }));
    expect(result.textContent).toContain(t('engine.datasource.syncNextSteps', EN));
    const hrefs = within(result).getAllByTestId('datasource-sync-object-link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/apps/setup/spare_parts', '/apps/setup/suppliers']);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toast.error).mock.calls[0][0])).toContain('broken: cannot draft broken');
    // The footer's Close leaves the result.
    const close = within(dialog).getAllByRole('button', { name: t('engine.close', EN) }).find((b) => b.textContent === t('engine.close', EN));
    if (!close) throw new Error('no footer Close button');
    fireEvent.click(close);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('(c) none created: the dialog closes and the refusal is toasted', async () => {
    renderPage(['broken'], ['broken']);
    await sync(['broken']);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(state.saved).toEqual([]);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('datasource-sync-result')).toBeNull();
  });

  it('(d) zh: the result and both steps read in Chinese', async () => {
    for (const key of ['engine.datasource.syncNextStepsOne', 'engine.datasource.syncNextStepApp', 'engine.datasource.syncNextStepAccess']) {
      expect(t(key, ZH), key).toMatch(/\p{Script=Han}/u);
    }
    renderPage(['spare_parts'], [], 'zh');
    const dialog = await sync(['spare_parts']);
    const result = await within(dialog).findByTestId('datasource-sync-result');
    expect(result.textContent).toContain(tFormat('engine.datasource.syncedOne', ZH, { name: 'parts_db' }));
    expect(result.textContent).toContain(t('engine.datasource.syncNextStepsOne', ZH));
    expect(result.textContent).toContain(t('engine.datasource.syncNextStepApp', ZH));
    expect(result.textContent).toContain(t('engine.datasource.syncNextStepAccess', ZH));
  });
});
