// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29121 — the palette's recent rows read the objects they name, by
 * name.
 *
 * A recent record row draws its object's label and icon (objectui#12852). It
 * read them off `useMetadata().objects`, so opening the palette with a recent
 * record in the list loaded the whole object registry (and the view list) — on
 * Home, where nothing else had loaded it, that was the registry the page no
 * longer reads. Now each row's object is read by name.
 *
 * Real subjects: `CommandPalette`, `CommandPaletteProvider` and
 * `MetadataProvider` over a fake adapter that records each read; what the rows
 * print is pinned by `CommandPalette.recentItemType-12852`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import type { RecentItem } from '../context/RecentItemsProvider';
import { MetadataProvider } from '../providers/MetadataProvider';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

const recent = vi.hoisted(() => ({ items: [] as unknown[] }));
vi.mock('../context/RecentItemsProvider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecentItems: () => ({ recentItems: recent.items, addRecentItem: () => {}, clearRecentItems: () => {} }),
}));

vi.mock('../utils/getIcon', () => ({
  getIcon: (name: string) =>
    function StubIcon(props: { className?: string }) {
      return <svg data-testid="stub-icon" data-glyph={name} className={props.className} />;
    },
}));

import { CommandPalette } from './CommandPalette';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider';

const APP = { name: 'cloud', label: 'Cloud', navigation: [] };

const OBJECTS = [
  { name: 'sys_organization', label: 'Organization', icon: 'Building2', fields: {} },
  { name: 'sys_environment', label: 'Environment', icon: 'Server', fields: {} },
  { name: 'sys_user', label: 'User', icon: 'User', fields: {} },
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

const metaReads = (calls: string[]) =>
  calls.filter((c) => c === 'object' || c === 'view' || c.startsWith('object?') || c.startsWith('object/'));

const VISITED = '2026-10-17T00:00:00.000Z';
const record = (id: string, href: string, label: string): RecentItem => ({ id, type: 'record', href, label, visitedAt: VISITED });

function mount(items: RecentItem[]): string[] {
  recent.items = items;
  const calls: string[] = [];
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <MemoryRouter initialEntries={['/home?palette=1']}>
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

function recentRows() {
  return Array.from(document.querySelectorAll('[cmdk-item][data-value^="recent "]')).map((el) => ({
    type: el.querySelector('[data-testid="palette-recent-type"]')?.textContent ?? null,
    icon: el.querySelector('svg')?.getAttribute('data-glyph') ?? null,
  }));
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

beforeEach(() => sessionStorage.clear());
afterEach(() => {
  cleanup();
  recent.items = [];
});

describe('objectstack#29121 — the palette’s recent rows read their objects by name', () => {
  it('each recent record row’s object is read by name, for its type and its icon; the whole list is never read', async () => {
    const calls = mount([
      record('record:sys_organization:o1', '/apps/cloud/sys_organization/record/o1', 'Objectstack'),
      record('record:sys_environment:e1', '/apps/cloud/sys_environment/record/e1', 'Objectstack'),
    ]);
    await waitFor(() =>
      expect(recentRows()).toEqual([
        { type: 'Organization', icon: 'Building2' },
        { type: 'Environment', icon: 'Server' },
      ]),
    );
    await settle();
    expect([...metaReads(calls)].sort()).toEqual(['object/sys_environment', 'object/sys_organization']);
  });
});
