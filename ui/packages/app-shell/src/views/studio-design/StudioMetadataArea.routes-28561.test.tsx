// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#28561 — Studio's "All metadata" area mounts the metadata-admin
 * pages (ADR-0146 D1) for a writable package, a read-only package and the
 * cross-package leg, and opens a pillar type in its pillar.
 *
 * The pages themselves are stubs here: each prints which page it is and the
 * host the area handed it, so these cases pin the AREA (its routes, its legs,
 * its gate). What each page does with the host is pinned beside the pages
 * (`metadataAreaHost.gates-28561.test.tsx`).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useSearchParams } from 'react-router-dom';
import { useMetadataAreaHost } from '../metadata-admin/metadataAreaHost';

function PageStub({ page }: { page: string }) {
  const host = useMetadataAreaHost();
  return (
    <div data-testid="area-page" data-page={page} data-host={JSON.stringify(host)}>
      {page}
    </div>
  );
}

/** The item page stub drops `?review=1` once open, as the real one does after opening its review sheet. */
function EditStub({ createMode }: { createMode?: boolean }) {
  const [search, setSearch] = useSearchParams();
  React.useEffect(() => {
    if (search.get('review') === '1') {
      const next = new URLSearchParams(search);
      next.delete('review');
      setSearch(next, { replace: true });
    }
  }, [search, setSearch]);
  return <PageStub page={createMode ? 'create' : 'item'} />;
}

vi.mock('../metadata-admin/index.js', () => ({
  MetadataDirectoryPage: () => <PageStub page="directory" />,
  MetadataDiagnosticsPage: () => <PageStub page="diagnostics" />,
  MetadataResourceListPage: () => <PageStub page="list" />,
  MetadataResourceEditPage: ({ createMode }: { createMode?: boolean }) => <EditStub createMode={createMode} />,
  MetadataResourceHistoryPage: () => <PageStub page="history" />,
}));

/**
 * objectstack#28569 — the form editor of an email template or a translation,
 * a stub printing the host and the member it opens (the editor itself is
 * pinned in `StudioBundleItemEditor.customize-28569.test.tsx`).
 */
vi.mock('./StudioBundleItemEditor.js', () => ({
  StudioBundleItemEditor: ({ type, name, member, readOnly }: { type: string; name: string; member?: string; readOnly: boolean }) => (
    <div data-testid="form-editor" data-item={JSON.stringify({ type, name, member: member ?? null, readOnly })}>
      <PageStub page="form-editor" />
    </div>
  ),
}));

/** `GET /api/v1/packages` as the listed manifests read it: one writable, one read-only, one kernel. */
let listed: Map<string, { id: string; name: string; writable: boolean; manifest: Record<string, unknown> }>;
let listFails = false;
vi.mock('./packages-io.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: vi.fn(async () => {
    if (listFails) throw new Error('HTTP 503');
    return listed;
  }),
}));

import { StudioMetadataArea } from './StudioMetadataArea';

const WRITABLE = 'com.example.crm';
const READ_ONLY = 'com.vendor.hr';
const KERNEL = 'com.objectstack.plugin-security';

beforeEach(() => {
  listFails = false;
  listed = new Map([
    [WRITABLE, { id: WRITABLE, name: 'CRM', writable: true, manifest: {} }],
    [READ_ONLY, { id: READ_ONLY, name: 'HR', writable: false, manifest: { scope: 'installed' } }],
    // A kernel package: hidden from the switcher, read-only all the same.
    [KERNEL, { id: KERNEL, name: 'Security', writable: false, manifest: { scope: 'system' } }],
  ]);
});
afterEach(cleanup);

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{`${pathname}${search}`}</div>;
}

function PackageArea() {
  const { pathname } = useLocation();
  const packageId = decodeURIComponent(pathname.split('/')[2] ?? '');
  return <StudioMetadataArea key={packageId} packageId={packageId} />;
}

function mount(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Where />
      <Routes>
        <Route path="/studio/~all/metadata/*" element={<StudioMetadataArea packageId={null} />} />
        <Route path="/studio/:packageId/metadata/*" element={<PackageArea />} />
        <Route path="/studio/:packageId/:tab" element={<div data-testid="pillar" />} />
        <Route path="/apps/setup/metadata/datasource" element={<div data-testid="setup-datasources" />} />
      </Routes>
    </MemoryRouter>,
  );
}

const where = () => screen.getByTestId('where').textContent ?? '';
async function page() {
  const el = await screen.findByTestId('area-page');
  return { page: el.getAttribute('data-page'), host: JSON.parse(el.getAttribute('data-host') ?? 'null') };
}

describe('the area mounts the metadata pages (objectstack#28561)', () => {
  it('a writable package: the directory, scoped to the package, writes ungated', async () => {
    mount(`/studio/${WRITABLE}/metadata`);
    expect(await page()).toEqual({
      page: 'directory',
      host: { packageId: WRITABLE, readOnly: false, basePath: `/studio/${WRITABLE}/metadata` },
    });
    // The URL carries the package, which the item page binds its saves to.
    expect(where()).toBe(`/studio/${WRITABLE}/metadata?package=${WRITABLE}`);
  });

  it('a read-only package: the same pages under the read-only gate', async () => {
    mount(`/studio/${READ_ONLY}/metadata/translation?package=${READ_ONLY}`);
    expect(await page()).toEqual({
      page: 'list',
      host: { packageId: READ_ONLY, readOnly: true, basePath: `/studio/${READ_ONLY}/metadata` },
    });
  });

  it('a kernel package, which the switcher hides, is read-only too', async () => {
    mount(`/studio/${KERNEL}/metadata/agent/a1?package=${KERNEL}`);
    expect((await page()).host.readOnly).toBe(true);
  });

  it('a package the list cannot answer for stays ungated, as the pillars do', async () => {
    listFails = true;
    mount(`/studio/${WRITABLE}/metadata?package=${WRITABLE}`);
    expect((await page()).host.readOnly).toBe(false);
  });

  it('the cross-package leg: no package, and the environment-scope permission list', async () => {
    mount('/studio/~all/metadata/permission?scope=environment');
    expect(await page()).toEqual({
      page: 'list',
      host: { packageId: null, readOnly: false, basePath: '/studio/~all/metadata' },
    });
    expect(where()).toBe('/studio/~all/metadata/permission?scope=environment');
  });

  it('the environment scope opened under a package moves to the cross-package leg', async () => {
    mount(`/studio/${WRITABLE}/metadata/permission/admin_full_access?scope=environment&package=${WRITABLE}`);
    expect((await page()).page).toBe('item');
    expect(where()).toBe('/studio/~all/metadata/permission/admin_full_access?scope=environment');
  });

  it('diagnostics and history are the area\'s routes too', async () => {
    mount(`/studio/${WRITABLE}/metadata/_diagnostics?package=${WRITABLE}`);
    expect((await page()).page).toBe('diagnostics');
    cleanup();
    mount(`/studio/${WRITABLE}/metadata/flow/f1/history?package=${WRITABLE}`);
    expect((await page()).page).toBe('history');
  });

  it('create: a writable package opens it, a read-only package lands on the list', async () => {
    mount(`/studio/${WRITABLE}/metadata/translation/new?package=${WRITABLE}`);
    expect((await page()).page).toBe('create');
    cleanup();
    mount(`/studio/${READ_ONLY}/metadata/translation/new?package=${READ_ONLY}`);
    expect((await page()).page).toBe('list');
    expect(where()).toBe(`/studio/${READ_ONLY}/metadata/translation?package=${READ_ONLY}`);
  });

  it('a datasource URL opens Setup\'s Datasources page', async () => {
    mount(`/studio/${WRITABLE}/metadata/datasource?package=${WRITABLE}`);
    expect(await screen.findByTestId('setup-datasources')).toBeInTheDocument();
  });
});

describe('a pillar type opened from the area opens its pillar', () => {
  for (const [type, pillar] of [
    ['object', 'data'],
    ['flow', 'automations'],
    ['view', 'interfaces'],
    ['permission', 'access'],
  ] as const) {
    it(`${type} → ${pillar}, with \`?surface=\``, async () => {
      mount(`/studio/${WRITABLE}/metadata/${type}/item_1?package=${WRITABLE}`);
      await screen.findByTestId('pillar');
      const url = new URL(where(), 'http://x');
      expect(url.pathname).toBe(`/studio/${WRITABLE}/${pillar}`);
      expect(url.searchParams.get('surface')).toBe(`${type}:item_1`);
    });
  }

  it('a type no pillar designs opens the generic page', async () => {
    mount(`/studio/${WRITABLE}/metadata/agent/support_bot?package=${WRITABLE}`);
    expect((await page()).page).toBe('item');
  });

  it('`?review=1` opens the generic page and its review, and the page stays once the review is open', async () => {
    mount(`/studio/${WRITABLE}/metadata/flow/f1?package=${WRITABLE}&review=1`);
    expect((await page()).page).toBe('item');
    // The stub dropped `?review=1`, as the item page does: the item stays.
    await waitFor(() => expect(where()).toBe(`/studio/${WRITABLE}/metadata/flow/f1?package=${WRITABLE}`));
    expect(screen.queryByTestId('pillar')).toBeNull();
    expect((await page()).page).toBe('item');
  });

  it('the cross-package leg opens a pillar type on the generic page: it names no package', async () => {
    mount('/studio/~all/metadata/permission/admin_full_access?scope=environment');
    expect((await page()).page).toBe('item');
    expect(screen.queryByTestId('pillar')).toBeNull();
  });
});

describe('an email template or a translation opens the form editor (objectstack#28569)', () => {
  const item = () => JSON.parse(screen.getByTestId('form-editor').getAttribute('data-item') ?? 'null');

  it('a translation of a writable package', async () => {
    mount(`/studio/${WRITABLE}/metadata/translation/ui_en?package=${WRITABLE}`);
    expect((await page()).page).toBe('form-editor');
    expect(item()).toEqual({ type: 'translation', name: 'ui_en', member: null, readOnly: false });
  });

  it('an email template of a read-only package, at the locale the list row names', async () => {
    mount(`/studio/${READ_ONLY}/metadata/email_template/welcome?package=${READ_ONLY}&member=zh-CN`);
    expect((await page()).host.readOnly).toBe(true);
    expect(item()).toEqual({ type: 'email_template', name: 'welcome', member: 'zh-CN', readOnly: true });
  });

  it('`?review=1` opens the generic page and its review', async () => {
    mount(`/studio/${WRITABLE}/metadata/email_template/welcome?package=${WRITABLE}&review=1`);
    expect((await page()).page).toBe('item');
    expect(screen.queryByTestId('form-editor')).toBeNull();
  });

  it('the cross-package leg opens the generic page: it names no package to write', async () => {
    mount('/studio/~all/metadata/translation/ui_en?package=all');
    expect((await page()).page).toBe('item');
    expect(screen.queryByTestId('form-editor')).toBeNull();
  });
});
