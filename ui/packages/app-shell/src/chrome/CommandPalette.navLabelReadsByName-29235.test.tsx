// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29235 — the palette labels an unlabelled navigation entry by
 * reading its target by name, never the whole object registry.
 *
 * Inside an app the console mounts the palette closed, and it names every
 * entry of the app's navigation on each render to build its filtered lists.
 * An entry with no label of its own is named through `useNavTargetLabel`
 * (objectui#9868), which read `useMetadata().objects`: the whole object
 * registry and the `/meta/view` list, on every in-app page whose route had
 * not loaded them (551 KB on app-crm). Measured on a production Console, it
 * was the reader left once the sidebar asked by name. It now asks with
 * `{ byName: true }`, as the sidebar does.
 *
 * Real subjects: `CommandPalette`, `CommandPaletteProvider` and
 * `MetadataProvider` over a fake adapter that records each read; the harness
 * is `CommandPalette.recentReadsByName-29121`'s.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MetadataProvider } from '../providers/MetadataProvider';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

vi.mock('../context/RecentItemsProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecentItems: () => ({ recentItems: [], addRecentItem: () => {}, clearRecentItems: () => {} }),
}));

vi.mock('../utils/getIcon', () => ({
  getIcon: () =>
    function StubIcon(props: { className?: string }) {
      return <svg data-testid="stub-icon" className={props.className} />;
    },
}));

import { CommandPalette } from './CommandPalette';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider';

// An app written without entry labels, as the spec allows (objectui#9868).
const APP = {
  name: 'ops',
  label: 'Ops',
  navigation: [
    { id: 'nav_accounts', type: 'object', objectName: 'crm_account' },
    { id: 'nav_contacts', type: 'object', objectName: 'crm_contact' },
  ],
};

const OBJECTS = [
  { name: 'crm_account', label: 'Account', fields: {} },
  { name: 'crm_contact', label: 'Contact', fields: {} },
  { name: 'crm_lead', label: 'Lead', fields: {} },
];

function makeAdapter(calls: string[]) {
  return {
    clearCache: vi.fn(),
    invalidateCache: vi.fn(),
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string, options?: { packageId?: string }) => {
          calls.push(options?.packageId ? `${type}?package=${options.packageId}` : type);
          const items = type === 'object' ? OBJECTS : type === 'app' ? [APP] : [];
          return Promise.resolve({ type, items: structuredClone(items) });
        },
        getItem: (type: string, name: string) => {
          calls.push(`${type}/${name}`);
          const item = (type === 'object' ? OBJECTS : []).find((o) => o.name === name) ?? null;
          return Promise.resolve({ item: structuredClone(item) });
        },
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

/** The whole-list reads a label could cost: the object registry and its views. */
const listReads = (calls: string[]) => calls.filter((c) => c === 'object' || c === 'view');

function mount(path: string): string[] {
  const calls: string[] = [];
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MemoryRouter initialEntries={[path]}>
        <MetadataProvider adapter={makeAdapter(calls)}>
          <CommandPaletteProvider>
            <CommandPalette apps={[APP]} activeApp={APP} objects={[]} onAppChange={() => {}} />
          </CommandPaletteProvider>
        </MetadataProvider>
      </MemoryRouter>
    </I18nProvider>,
  );
  return calls;
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));

beforeEach(() => sessionStorage.clear());
afterEach(() => cleanup());

describe('objectstack#29235 — the palette names an unlabelled entry by name', () => {
  it('closed inside an app: each entry’s object is read by name, never the whole list', async () => {
    const calls = mount('/apps/ops/page/home');
    await settle();
    await settle();
    expect(listReads(calls)).toEqual([]);
    expect(calls.filter((c) => c.startsWith('object/')).sort()).toEqual(['object/crm_account', 'object/crm_contact']);
  });

  it('opened: the entries show their objects’ labels, as the whole list gave them', async () => {
    const calls = mount('/apps/ops/page/home?palette=1');
    expect(await screen.findByText('Account')).toBeInTheDocument();
    expect(await screen.findByText('Contact')).toBeInTheDocument();
    await settle();
    expect(listReads(calls)).toEqual([]);
  });
});
