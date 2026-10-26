/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Each row of the ⌘K palette's recent group shows what it is (objectui#12852).
 *
 * Every row drew the same search glyph and its title alone, so two entries
 * that share a title — an organisation and its environment, both
 * "Objectstack" — were drawn identically. A row now carries its object's label
 * on the right and its object's icon on the left, as Home's "Recently
 * accessed" row does (objectui#12604). The object is the one `recentItemObject`
 * reads off the stored address, `/apps/APP/OBJECT/record/ID`.
 *
 * Pinned through the real `CommandPalette` + `CommandPaletteProvider` (opened
 * by its `?palette=1` deep link) under a real `MetadataCtx` and `I18nProvider`.
 * The recent-items store is replaced with a fixed list, and `getIcon` with a
 * stub that draws the icon NAME it was asked for, so the assertion reads which
 * icon a row chose rather than how Lucide draws it lazily.
 *
 *  - two records with the same title and different objects show different
 *    type text and different icons — the card's acceptance;
 *  - the type is the object's label in the viewer's language (zh-CN, en);
 *  - CONTROL: an entry whose object cannot be read off its address shows no
 *    type and the neutral record glyph;
 *  - CONTROL: the group still lists the first five record entries, in order,
 *    under its heading, and choosing a row opens its address.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import type { RecentItem } from '../context/RecentItemsProvider';

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
  { name: 'sys_organization', label: { en: 'Organization', 'zh-CN': '组织' }, icon: 'Building2' },
  { name: 'sys_environment', label: { en: 'Environment', 'zh-CN': '环境' }, icon: 'Server' },
];

const METADATA = {
  apps: [APP],
  objects: OBJECTS,
  dashboards: [],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

const VISITED = '2026-10-17T00:00:00.000Z';
const record = (id: string, href: string, label: string): RecentItem => ({ id, type: 'record', href, label, visitedAt: VISITED });

const ORG = record('record:sys_organization:o1', '/apps/cloud/sys_organization/record/o1', 'Objectstack');
const ENV = record('record:sys_environment:e1', '/apps/cloud/sys_environment/record/e1', 'Objectstack');

function Where() {
  const location = useLocation();
  return <span data-testid="location" data-path={location.pathname} />;
}

function mount(items: RecentItem[], language = 'en') {
  recent.items = items;
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: language, detectBrowserLanguage: false })} persistLanguage={false}>
      <MemoryRouter initialEntries={['/apps/cloud?palette=1']}>
        <MetadataCtx.Provider value={METADATA as never}>
          <CommandPaletteProvider>
            <Where />
            <CommandPalette apps={[APP]} activeApp={APP} objects={OBJECTS} onAppChange={() => {}} />
          </CommandPaletteProvider>
        </MetadataCtx.Provider>
      </MemoryRouter>
    </I18nProvider>,
  );
  if (!document.querySelector('[cmdk-input]')) throw new Error('the palette did not open');
}

/** Every row of the recent group: its title, its type text, and the icon it drew. */
function recentRows() {
  return Array.from(document.querySelectorAll('[cmdk-item][data-value^="recent "]')).map((el) => {
    const svg = el.querySelector('svg');
    return {
      title: el.querySelector('span.truncate:not([data-testid])')?.textContent ?? '',
      type: el.querySelector('[data-testid="palette-recent-type"]')?.textContent ?? null,
      icon: svg?.getAttribute('data-glyph') ?? (svg?.classList.contains('lucide-file-text') ? 'FileText' : svg?.getAttribute('class')),
    };
  });
}

afterEach(() => {
  cleanup();
  recent.items = [];
});

describe('objectui#12852 — a ⌘K recent row shows its type and its object’s icon', () => {
  it('two records with the same title and different objects are never drawn alike', () => {
    mount([ORG, ENV]);
    const rows = recentRows();
    expect(rows).toEqual([
      { title: 'Objectstack', type: 'Organization', icon: 'Building2' },
      { title: 'Objectstack', type: 'Environment', icon: 'Server' },
    ]);
    expect(rows[0].type).not.toBe(rows[1].type);
    expect(rows[0].icon).not.toBe(rows[1].icon);
  });

  it('under zh-CN the type is the object’s zh-CN label', () => {
    mount([ORG, ENV], 'zh-CN');
    expect(recentRows().map((r) => r.type)).toEqual(['组织', '环境']);
  });

  it('control: an entry whose object cannot be read off its address shows no type and the neutral glyph', () => {
    // Not `/apps/APP/OBJECT/record/ID`: the address names no object.
    mount([record('record:x', '/apps/cloud/record/x', 'Objectstack'), record('record:y', '/settings/profile', 'Profile')]);
    expect(recentRows()).toEqual([
      { title: 'Objectstack', type: null, icon: 'FileText' },
      { title: 'Profile', type: null, icon: 'FileText' },
    ]);
  });

  it('control: an object the metadata does not hold is typed by its machine name, with the neutral glyph', () => {
    mount([record('record:crm_lead:l1', '/apps/crm/crm_lead/record/l1', 'Objectstack')]);
    expect(recentRows()).toEqual([{ title: 'Objectstack', type: 'crm_lead', icon: 'FileText' }]);
  });

  it('control: the group lists the first five record entries, in order, under its heading, and a row opens its address', () => {
    const records = Array.from({ length: 7 }, (_, i) =>
      record(`record:sys_organization:o${i}`, `/apps/cloud/sys_organization/record/o${i}`, `Org ${i}`),
    );
    mount([
      { id: 'object:sys_organization', type: 'object', name: 'sys_organization', href: '/apps/cloud/sys_organization', visitedAt: VISITED },
      records[0],
      { id: 'page:home', type: 'page', name: 'home', href: '/apps/cloud/page/home', visitedAt: VISITED },
      ...records.slice(1),
    ]);
    const group = document.querySelector('[cmdk-group-heading]');
    expect(group?.textContent).toBe('Recently viewed');
    expect(recentRows().map((r) => r.title)).toEqual(['Org 0', 'Org 1', 'Org 2', 'Org 3', 'Org 4']);

    fireEvent.click(document.querySelectorAll('[cmdk-item][data-value^="recent "]')[2]);
    expect(screen.getByTestId('location').getAttribute('data-path')).toBe('/apps/cloud/sys_organization/record/o2');
    expect(document.querySelector('[data-testid="overlay:command-palette"]')).toBeNull();
  });
});
