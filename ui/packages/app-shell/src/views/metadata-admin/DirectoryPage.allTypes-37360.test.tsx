// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37360 — 全部类型 All types (ADR-0084, amended 2026-11-25). The
 * 高级 fold's last row opens the area's type directory, and on a package that
 * page lists every type of the menu's six groups:
 *
 *  - the types the package holds, drawn as before: an item count, no mark;
 *  - after them in each group, the types it holds none of yet, each marked
 *    "None yet", with no count, and with the state word that says what can be
 *    done there — a type that cannot be made in Studio reads read-only;
 *  - a not-held type's tile opens its list, which carries New;
 *  - CONTROL: a type outside the six groups and a hidden type are not listed;
 *    a sweep that failed marks nothing; the cross-package leg lists only the
 *    environment catalog, as before.
 *
 * Pinned over the real directory page and the real list page; only the
 * metadata reads and the network are doubled.
 */

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/lint';
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@objectstack/spec/identity';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';
import type { RichMetadataTypeEntry } from './useMetadata';

const PKG = 'com.example.app';

const entry = (type: string, domain: string, allowEnvironmentOverlay: boolean, allowRuntimeCreate: boolean): RichMetadataTypeEntry =>
  ({ type, label: type, domain, allowEnvironmentOverlay, allowRuntimeCreate, overrideSource: 'registry' }) as RichMetadataTypeEntry;

/** Served in the server's order: by domain, then by type. The registry's own flags. */
const ENTRIES: RichMetadataTypeEntry[] = [
  entry('field', 'data', false, true),
  entry('hook', 'data', false, true),
  entry('object', 'data', false, true),
  entry('api', 'system', false, false),
  entry('doc', 'system', false, true),
  entry('email_template', 'system', true, true),
  entry('legacy_thing', 'identity', false, true),
];

/** What the doubled sweep answers; each case may change it before rendering. */
const sweep = vi.hoisted(() => ({
  error: null as string | null,
  packagesByType: {} as Record<string, string[]>,
  countsByType: {} as Record<string, number>,
}));

const CLIENT = {
  list: async (type: string) => (type === 'package' ? [{ manifest: { id: PKG, name: 'App', scope: 'project' } }] : []),
};

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: ENTRIES }),
  useGlobalDiagnostics: () => ({
    loading: false,
    error: sweep.error,
    summary: { entries: [], total: 0, scannedTypes: 0, scannedItems: 0 },
    byType: {},
    warnByType: {},
    countsByType: sweep.countsByType,
    lockedByType: {},
    packagesByType: sweep.packagesByType,
    allPackages: [PKG],
    reload: () => {},
  }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
}));

import { MetadataDirectoryPage, directoryNotHeldEntries } from './DirectoryPage';
import { MetadataResourceListPage } from './ResourceListPage';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { t } from './i18n';

registerDefaultMetadataSchemas();

const fetchMock = vi.fn(async (url: string) => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const u = String(url);
  if (u === '/api/v1/packages') {
    return json(200, { success: true, data: { packages: [{ manifest: { id: PKG, name: 'App', scope: 'project' }, writable: true }] } });
  }
  if (u.startsWith('/api/v1/data/sys_metadata_activation')) {
    return json(200, { object: 'sys_metadata_activation', records: [], hasMore: false });
  }
  return json(404, { success: false });
});

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  // The package holds objects and hooks, and nothing of the Platform group.
  sweep.error = null;
  sweep.packagesByType = { object: [PKG], hook: [PKG], doc: ['com.other.pkg'] };
  sweep.countsByType = { object: 3, hook: 1 };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const HOST: MetadataAreaHost = { packageId: PKG, readOnly: false, basePath: `/studio/${PKG}/metadata` };

function Location() {
  const l = useLocation();
  return <div data-testid="location">{`${l.pathname}${l.search}`}</div>;
}

function mount(host: MetadataAreaHost = HOST) {
  const base = host.basePath;
  return render(
    <MetadataAreaHostContext.Provider value={host}>
      <MemoryRouter initialEntries={[base]}>
        <Routes>
          <Route path={base} element={<MetadataDirectoryPage />} />
          <Route path={`${base}/:type`} element={<MetadataResourceListPage />} />
          <Route path="*" element={null} />
        </Routes>
        <Location />
      </MemoryRouter>
    </MetadataAreaHostContext.Provider>,
  );
}

const tile = (type: string) => screen.getByTestId(`directory-tile-${type}`);
const listedTypes = () =>
  screen.queryAllByTestId(/^directory-tile-[a-z_]+$/).map((el) => el.getAttribute('data-testid')!.replace('directory-tile-', ''));
const word = (type: string) => tile(type).querySelector('[data-state-word]')?.getAttribute('data-state-word');

describe('全部类型 All types: the directory lists every type of the six groups on a package (objectstack#37360)', () => {
  it('the held types as before, then in each group the ones the package holds none of yet', async () => {
    mount();
    await screen.findByTestId('directory-tile-object');
    // Data: the held hook and object, in served order. Platform: none held, so all three follow.
    expect(listedTypes()).toEqual(['hook', 'object', 'api', 'doc', 'email_template']);
    for (const held of ['hook', 'object']) {
      expect(tile(held)).not.toHaveAttribute('data-held');
      expect(screen.queryByTestId(`directory-tile-not-held-${held}`)).toBeNull();
    }
    expect(within(tile('object')).getByTitle('3 item(s) of this type')).toHaveTextContent('3');
  });

  it('a type held by none is marked "None yet", with no count, and with the word that says what can be done', async () => {
    mount();
    await screen.findByTestId('directory-tile-object');
    for (const type of ['api', 'doc', 'email_template']) {
      expect(tile(type)).toHaveAttribute('data-held', 'false');
      expect(screen.getByTestId(`directory-tile-not-held-${type}`)).toHaveTextContent('None yet');
      expect(within(tile(type)).queryByTitle(/item\(s\) of this type/)).toBeNull();
    }
    expect(word('email_template')).toBe('writable');
    expect(word('doc')).toBe('addable');
    expect(screen.getByTestId('directory-tile-not-held-doc')).toHaveAttribute(
      'title',
      'This package holds none yet: open the list to make the first',
    );
    // Cannot be made in Studio: listed, read-only, and its mark says none can be made here.
    expect(word('api')).toBe('readOnly');
    expect(screen.getByTestId('directory-tile-not-held-api')).toHaveAttribute(
      'title',
      'This package holds none, and none can be made here',
    );
  });

  it('"Hide read-only" drops the types that cannot be made here, held or not', async () => {
    mount();
    await screen.findByTestId('directory-tile-object');
    fireEvent.click(screen.getByRole('button', { name: /^Hide read-only/ }));
    expect(listedTypes()).toEqual(['hook', 'object', 'doc', 'email_template']);
  });

  it("a not-held type's tile opens its list, which carries New", async () => {
    mount();
    await screen.findByTestId('directory-tile-email_template');
    expect(tile('email_template')).toHaveAttribute('href', `/studio/${PKG}/metadata/email_template?package=${PKG}`);
    fireEvent.click(tile('email_template'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(`/studio/${PKG}/metadata/email_template?package=${PKG}`),
    );
    expect(await screen.findByTestId('metadata-list-create')).toBeInTheDocument();
    // The header's New and the empty list's own: the package holds none yet.
    // objectstack#37918 — "New X" in the Studio area.
    expect(screen.getAllByRole('button', { name: new RegExp(`^${t('engine.list.create', 'en-US')}\\b`) }).length).toBeGreaterThan(0);
  });

  it('CONTROL: a type outside the six groups and a hidden type are never listed', async () => {
    mount();
    await screen.findByTestId('directory-tile-object');
    expect(screen.queryByTestId('directory-tile-legacy_thing')).toBeNull();
    expect(screen.queryByTestId('directory-tile-field')).toBeNull();
  });

  it('CONTROL: a sweep that failed said nothing of what the package holds — nothing is marked', async () => {
    sweep.error = 'not found';
    sweep.packagesByType = {};
    mount();
    await screen.findByText(t('engine.directory.noMatches', 'en-US'));
    expect(listedTypes()).toEqual([]);
    expect(screen.queryAllByTestId(/^directory-tile-not-held-/)).toEqual([]);
  });

  it('CONTROL: the cross-package leg lists the environment catalog only, with no mark', async () => {
    mount({ packageId: null, readOnly: false, basePath: '/studio/~all/metadata' });
    await screen.findByRole('heading', { level: 1 });
    expect(listedTypes()).toEqual([]);
    expect(screen.queryAllByTestId(/^directory-tile-not-held-/)).toEqual([]);
  });
});

describe('directoryNotHeldEntries (objectstack#37360)', () => {
  it('every served type of the six groups the package does not hold, in served order; none off a package', () => {
    const held = ENTRIES.filter((e) => e.type === 'object');
    expect(directoryNotHeldEntries(ENTRIES, held, true).map((e) => e.type)).toEqual(['hook', 'api', 'doc', 'email_template']);
    expect(directoryNotHeldEntries(ENTRIES, held, false)).toEqual([]);
  });
});
