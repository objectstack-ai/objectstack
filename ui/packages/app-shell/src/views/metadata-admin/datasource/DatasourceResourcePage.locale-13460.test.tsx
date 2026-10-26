// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13460 — Setup → Datasources speaks the designer's locale.
 *
 * The page's own copy (heading, buttons, status chips, the editor and the sync
 * dialog) was English literals under every locale. It now reads
 * `engine.datasource.*` rows from Studio's table, which covers en-US and zh-CN
 * (the `engine.*` carve-out in `packages/i18n/README.md`).
 *
 * Expectations are read from that table rather than retyped, and a guard
 * proves each zh row is a real zh row, so no case can pass on a missing key or
 * an English copy. The driver config schema's enum option values are not this
 * card's (objectui#13353) and are not asserted here.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

const state = vi.hoisted(() => ({
  fetch: (async () => undefined) as unknown as (url: string) => Promise<unknown>,
  // STABLE identity, like the real memoized client.
  metadataClient: {},
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createAuthenticatedFetch: () => (url: string) => state.fetch(url),
}));
vi.mock('../useMetadata.js', () => ({
  useMetadataClient: () => state.metadataClient,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { t } from '../i18n';
import { DatasourceResourcePage } from './DatasourceResourcePage';

afterEach(cleanup);

const DRIVER = { id: 'sqlite', label: 'SQLite', configSchema: { properties: {} } };

function serve(datasources: unknown[]) {
  const ok = (data: unknown) => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ success: true, data }),
  });
  state.fetch = async (url: string) =>
    url.endsWith('/api/v1/datasources/drivers') ? ok({ drivers: [DRIVER] }) : ok({ datasources });
}

function renderAt(language: string) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <DatasourceResourcePage />
    </I18nProvider>,
  );
}

const ZH = 'zh-CN';
const EN = 'en-US';

describe('Setup → Datasources reads engine.datasource.* (objectui#13460)', () => {
  it('guard: the zh rows the cases read are real zh rows', () => {
    for (const key of [
      'engine.datasource.title',
      'engine.datasource.new',
      'engine.datasource.empty',
      'engine.datasource.statusOk',
      'engine.datasource.schemaModeManaged',
      'engine.datasource.create',
    ]) {
      const zh = t(key, ZH);
      expect(zh, key).not.toBe(key);
      expect(zh, key).not.toBe(t(key, EN));
      expect(zh, key).toMatch(/\p{Script=Han}/u);
    }
  });

  it('zh: the heading, the empty state with its action slot, and the toolbar', async () => {
    serve([]);
    renderAt('zh');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(t('engine.datasource.title', ZH));
    // The empty sentence places the bold action where the zh row put it.
    const [before, after] = t('engine.datasource.empty', ZH).split('{action}');
    const action = await screen.findByText(t('engine.datasource.new', ZH), { selector: 'span' });
    expect(action.parentElement!.textContent).toBe(`${before}${t('engine.datasource.new', ZH)}${after}`);
    expect(screen.getByRole('button', { name: t('engine.datasource.refresh', ZH) })).toBeTruthy();
  });

  it('zh: a row draws its status chip and its actions in Chinese', async () => {
    serve([{ name: 'warehouse', driver: 'sqlite', status: 'ok', schemaMode: 'external' }]);
    renderAt('zh');
    expect(await screen.findByText(t('engine.datasource.statusOk', ZH))).toBeTruthy();
    expect(screen.getByRole('button', { name: t('engine.datasource.test', ZH) })).toBeTruthy();
    expect(screen.getByRole('button', { name: t('engine.datasource.sync', ZH) })).toBeTruthy();
    expect(screen.getByTitle(t('engine.datasource.edit', ZH))).toBeTruthy();
    expect(screen.getByTitle(t('engine.datasource.delete', ZH))).toBeTruthy();
  });

  it('zh: the create dialog labels its fields and buttons in Chinese', async () => {
    serve([]);
    renderAt('zh');
    fireEvent.click(await screen.findByRole('button', { name: t('engine.datasource.new', ZH) }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(t('engine.datasource.newDescription', ZH))).toBeTruthy();
    expect(within(dialog).getByText(`${t('engine.datasource.name', ZH)} *`)).toBeTruthy();
    expect(within(dialog).getByText(t('engine.datasource.schemaMode', ZH))).toBeTruthy();
    expect(within(dialog).getByText(t('engine.datasource.schemaModeManaged', ZH))).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: t('engine.datasource.create', ZH) })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: t('engine.cancel', ZH) })).toBeTruthy();
  });

  it('control: en renders the English the page always drew', async () => {
    serve([]);
    renderAt('en');
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Datasources');
    const action = await screen.findByText('New datasource', { selector: 'span' });
    expect(action.parentElement!.textContent).toBe('No datasources yet. Click New datasource to connect one.');
  });
});
