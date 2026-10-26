// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25901 — an interface list page whose `label` / `description` is an inline
 * locale map draws them in the viewer's language.
 *
 * `@objectstack/spec` types both as `I18nLabel`. The page read
 * `typeof page.label === 'string' ? page.label : page.name` for its heading and
 * its record drawer's title, and drew `page.description` only when it was a
 * string: a map label showed the page's machine name, a map description was
 * dropped. Both now go through `metadataText`, the helper the header and the
 * report page resolve the same values with; the machine name is the heading
 * only when no label resolves.
 *
 * Harness: `InterfaceListPage.packageScope-12980`'s — the real
 * `MetadataProvider` over a client double, in an app with no package — under a
 * real `I18nProvider` set to the viewer's language.
 *
 * Directions, written before the run: the map cells RED before the change (the
 * machine name, no description), GREEN after; the string control GREEN on
 * both sides.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AdapterCtx, useMetadata } from '@object-ui/react';
import { I18nProvider } from '@object-ui/i18n';

import { MetadataProvider } from '../../providers/MetadataProvider';
import { InterfaceListPage } from '../InterfaceListPage';
import { readPageObjectScope } from '../../console/appObjectScope';

const OBJECTS = [{ name: 'crm_account', label: 'Accounts', fields: { name: { type: 'text', label: 'Name' } } }];
const APPS = [{ name: 'crm', label: 'CRM' }];
const MAP_PAGE = {
  name: 'accounts_page',
  label: { en: 'Key accounts', 'zh-CN': '重点客户' },
  description: { en: 'Accounts we review weekly', 'zh-CN': '每周复盘的客户' },
  type: 'app',
  interfaceConfig: { source: 'crm_account' },
};
const STRING_PAGE = { ...MAP_PAGE, label: 'Key accounts', description: 'Accounts we review weekly' };

function adapter(page: unknown) {
  return {
    clearCache: vi.fn(),
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string) => {
          const items = type === 'object' ? OBJECTS : type === 'app' ? APPS : type === 'page' ? [page] : [];
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          const item = (type === 'object' ? OBJECTS : []).find((o) => o.name === name);
          return item ? Promise.resolve({ type, name, item: structuredClone(item) }) : Promise.reject(new Error('404'));
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

function PageRoute({ page }: { page: any }) {
  const metadata = useMetadata();
  const app = (metadata.apps as any[]).find((a) => a?.name === 'crm');
  if (!app) return null;
  const { ready } = readPageObjectScope(metadata.readObjectScope!, app, page);
  if (!ready) return <div data-testid="route-pending" />;
  return <InterfaceListPage page={page as never} />;
}

async function boot(page: any, language: 'en' | 'zh-CN') {
  const ds = { find: vi.fn(async () => ({ data: [], total: 0 })), getObjectSchema: vi.fn(async () => OBJECTS[0]) };
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: { en: {}, 'zh-CN': {} } }} persistLanguage={false}>
      <MetadataProvider adapter={adapter(page)}>
        <AdapterCtx.Provider value={ds as never}>
          <MemoryRouter initialEntries={[`/apps/crm/page/${page.name}`]}>
            <Routes>
              <Route path="/apps/:appName/page/:pageName" element={<PageRoute page={page} />} />
            </Routes>
          </MemoryRouter>
        </AdapterCtx.Provider>
      </MetadataProvider>
    </I18nProvider>,
  );
  await waitFor(() => expect(screen.getByTestId('interface-list-page')).toBeInTheDocument());
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(cleanup);

describe('InterfaceListPage — inline locale-map label and description (#25901)', () => {
  it.each([
    ['en', 'Key accounts', 'Accounts we review weekly'],
    ['zh-CN', '重点客户', '每周复盘的客户'],
  ] as const)('%s: the heading and description are the map\'s text, never the machine name', async (language, label, description) => {
    await boot(MAP_PAGE, language);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(label);
    expect(screen.getByText(description)).toBeInTheDocument();
    expect(screen.queryByText(MAP_PAGE.name)).not.toBeInTheDocument();
  });

  it('a map that resolves to no text falls back to the machine name', async () => {
    await boot({ ...MAP_PAGE, label: {}, description: {} }, 'en');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(MAP_PAGE.name);
  });

  it('control — a string label and description are drawn as given', async () => {
    await boot(STRING_PAGE, 'zh-CN');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Key accounts');
    expect(screen.getByText('Accounts we review weekly')).toBeInTheDocument();
  });
});
