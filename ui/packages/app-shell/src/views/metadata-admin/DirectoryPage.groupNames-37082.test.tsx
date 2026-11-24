// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37082 — one name per group across Studio. The left menu, the All
 * metadata directory's group headings and domain chips, and the domain badge
 * on a type or item page (`PageShell`, which Setup's datasource pages draw too)
 * name the `system` group Platform / 平台 and the `security` group Access / 访问
 * (objectstack ADR-0084, amended 2026-11-24), in en and in zh-CN.
 *
 * Pinned over the real directory page and the real header, each word compared
 * with the menu's own (`studioMenuGroupLabel`); CONTROL: the `data` group keeps
 * Data / 数据, and the retired words System / 系统 and Security / 安全 are drawn
 * nowhere.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';
import type { RichMetadataTypeEntry } from './useMetadata';

const PKG = 'com.example.showcase';

const entry = (type: string, domain: string): RichMetadataTypeEntry =>
  ({ type, label: type, domain, allowEnvironmentOverlay: false, allowRuntimeCreate: true }) as RichMetadataTypeEntry;

const ENTRIES: RichMetadataTypeEntry[] = [
  entry('object', 'data'),
  entry('datasource', 'system'),
  entry('translation', 'system'),
  entry('permission', 'security'),
];

const CLIENT = { list: async () => [] };

/** The locale the page reads; each case sets it before rendering. */
let LOCALE = 'en';

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: ENTRIES }),
  useGlobalDiagnostics: () => ({
    loading: false,
    error: null,
    summary: { entries: [], total: 0, scannedTypes: 0, scannedItems: 0 },
    byType: {},
    warnByType: {},
    countsByType: {},
    lockedByType: {},
    packagesByType: Object.fromEntries(ENTRIES.map((e) => [e.type, [PKG]])),
    allPackages: [PKG],
    reload: () => {},
  }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => LOCALE,
}));
vi.stubGlobal(
  'fetch',
  vi.fn(async () =>
    new Response(JSON.stringify({ success: true, data: { packages: [] } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
);

import { MetadataDirectoryPage } from './DirectoryPage';
import { PageShell } from './PageShell';
import { studioMenuGroupLabel } from '../studio-design/studioMenuGroupLabel';

afterEach(() => {
  cleanup();
});

const host: MetadataAreaHost = { packageId: PKG, readOnly: false, basePath: `/studio/${PKG}/metadata` };

const CASES = [
  { locale: 'en', data: 'Data', platform: 'Platform', access: 'Access', retired: ['System', 'Security'] },
  { locale: 'zh-CN', data: '数据', platform: '平台', access: '访问', retired: ['系统', '安全'] },
] as const;

function renderDirectory() {
  return render(
    <MetadataAreaHostContext.Provider value={host}>
      <MemoryRouter>
        <MetadataDirectoryPage />
      </MemoryRouter>
    </MetadataAreaHostContext.Provider>,
  );
}

function renderShell(type: string, itemName?: string) {
  const e = ENTRIES.find((x) => x.type === type);
  return render(
    <MemoryRouter>
      <PageShell entry={e} itemName={itemName}>
        <div />
      </PageShell>
    </MemoryRouter>,
  );
}

describe.each(CASES)('one name per group ($locale, objectstack#37082)', (c) => {
  it('the menu names the groups Platform and Access', () => {
    expect(studioMenuGroupLabel('system', c.locale)).toBe(c.platform);
    expect(studioMenuGroupLabel('security', c.locale)).toBe(c.access);
    expect(studioMenuGroupLabel('data', c.locale)).toBe(c.data);
  });

  it('the directory\'s group headings use the menu\'s names', async () => {
    LOCALE = c.locale;
    renderDirectory();
    await screen.findByText('datasource', { selector: 'code' });
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => (h.textContent ?? '').trim());
    expect(headings).toEqual(
      expect.arrayContaining([
        `${studioMenuGroupLabel('data', c.locale)} (1)`,
        `${studioMenuGroupLabel('security', c.locale)} (1)`,
        `${studioMenuGroupLabel('system', c.locale)} (2)`,
      ]),
    );
    expect(headings).toEqual(expect.arrayContaining([`${c.platform} (2)`, `${c.access} (1)`, `${c.data} (1)`]));
    for (const word of c.retired) expect(headings.join(' ')).not.toContain(word);
  });

  it('the directory\'s domain chips use the menu\'s names', async () => {
    LOCALE = c.locale;
    renderDirectory();
    await screen.findByText('datasource', { selector: 'code' });
    expect(screen.getByRole('button', { name: `${studioMenuGroupLabel('system', c.locale)} (2)` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${studioMenuGroupLabel('security', c.locale)} (1)` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${c.platform} (2)` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${c.access} (1)` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `${c.data} (1)` })).toBeInTheDocument();
    for (const word of c.retired) {
      expect(screen.queryByRole('button', { name: new RegExp(`^${word} \\(`, 'u') })).toBeNull();
    }
  });

  it('a type page\'s badge uses the menu\'s names', () => {
    LOCALE = c.locale;
    renderShell('datasource');
    const title = document.querySelector('h1')!.parentElement!;
    expect(within(title).getByText(studioMenuGroupLabel('system', c.locale))).toBeInTheDocument();
    expect(within(title).getByText(c.platform)).toBeInTheDocument();
    cleanup();
    renderShell('permission');
    expect(within(document.querySelector('h1')!.parentElement!).getByText(c.access)).toBeInTheDocument();
  });

  it('an item page\'s badge uses the menu\'s names (Setup\'s datasource item page draws this header)', () => {
    LOCALE = c.locale;
    renderShell('datasource', 'main_db');
    const meta = screen.getByTestId('page-shell-header-meta');
    expect(within(meta).getByText(studioMenuGroupLabel('system', c.locale))).toBeInTheDocument();
    expect(within(meta).getByText(c.platform)).toBeInTheDocument();
    cleanup();
    renderShell('permission', 'sales_rep');
    expect(within(screen.getByTestId('page-shell-header-meta')).getByText(c.access)).toBeInTheDocument();
    for (const word of c.retired) expect(screen.getByTestId('page-shell-header-meta').textContent).not.toContain(word);
  });
});
