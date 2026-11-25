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
import { registerMetadataResource } from '../metadata-admin/registry';

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

/** objectstack#36905 — the permission set's full-screen page, a stub printing what the area handed it. */
vi.mock('./StudioPermissionSetPage.js', () => ({
  StudioPermissionSetPage: ({ packageId, name, readOnly }: { packageId: string; name: string; readOnly?: boolean }) => (
    <div data-testid="permission-page" data-item={JSON.stringify({ packageId, name, readOnly: !!readOnly })}>
      <PageStub page="permission-page" />
    </div>
  ),
}));

/** `GET /api/v1/packages` as the listed manifests read it: one writable, one read-only, one kernel. */
let listed: Map<string, { id: string; name: string; writable: boolean; manifest: Record<string, unknown> }>;
let listFails = false;
// objectstack#36904 — the object designer, stubbed: only where the area mounts it is under test.
vi.mock('./DataPillar.js', () => ({
  DataPillar: (props: { packageId: string; objectName: string; readOnly?: boolean }) => (
    <div data-testid="object-designer" data-package={props.packageId} data-object={props.objectName} data-readonly={String(!!props.readOnly)} />
  ),
}));
vi.mock('./packages-io.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchListedPackageManifests: vi.fn(async () => {
    if (listFails) throw new Error('HTTP 503');
    return listed;
  }),
}));

import { StudioMetadataArea } from './StudioMetadataArea';
// The source under test reaches dynamic imports of `@objectstack/lint`; their first
// load is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';

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
    // objectstack#36901 — history is the item page's History tab: the old
    // address opens it there, its query kept.
    mount(`/studio/${WRITABLE}/metadata/hook/h1/history?package=${WRITABLE}`);
    expect((await page()).page).toBe('item');
    expect(where()).toBe(`/studio/${WRITABLE}/metadata/hook/h1?package=${WRITABLE}&tab=history`);
  });

  it('CONTROL: a type whose item page is its own editor, or a designer\'s, keeps the standalone history page', async () => {
    // The permission set's matrix editor links `./history`; it has no tabs.
    registerMetadataResource({ type: 'matrix_36901', EditPage: () => null });
    mount(`/studio/${WRITABLE}/metadata/matrix_36901/m1/history?package=${WRITABLE}`);
    expect((await page()).page).toBe('history');
    expect(where()).toBe(`/studio/${WRITABLE}/metadata/matrix_36901/m1/history?package=${WRITABLE}`);
    cleanup();
    // So does an item a pillar's designer opens (a flow), which has no tab row yet.
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

/**
 * objectstack#36897 — on a read-only base with its customization handed in,
 * the create is the pair's: the ensure door is asked once and its answer's
 * package opens the create; a walled door, or a refusal, never writes.
 */
describe("a read-only base's create opens in its .custom pair (objectstack#36897)", () => {
  const PAIR = `${READ_ONLY}.custom`;
  const customizationOf = (walled: boolean, ensurePackage: () => Promise<unknown>) =>
    ({ base: READ_ONLY, baseLabel: 'HR', basedOn: null, walled, pairId: null, ensure: async () => PAIR, ensurePackage }) as any;
  function mountCustomized(customization: unknown, at = `/studio/${READ_ONLY}/metadata/translation/new?package=${READ_ONLY}`) {
    return render(
      <MemoryRouter initialEntries={[at]}>
        <Where />
        <Routes>
          <Route path={`/studio/${READ_ONLY}/metadata/*`} element={<StudioMetadataArea packageId={READ_ONLY} customization={customization as any} />} />
          <Route path="/studio/:packageId/metadata/*" element={<PackageArea />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("the ensure door's pair opens the create", async () => {
    listed.set(PAIR, { id: PAIR, name: 'HR (customizations)', writable: true, manifest: {} });
    const ensurePackage = vi.fn(async () => ({ basePackageId: READ_ONLY, packageId: PAIR, namespace: 'hrx', created: true, writable: true }));
    mountCustomized(customizationOf(false, ensurePackage));
    await waitFor(() => expect(where()).toBe(`/studio/${PAIR}/metadata/translation/new?package=${encodeURIComponent(PAIR)}`));
    expect((await page()).page).toBe('create');
    expect(ensurePackage).toHaveBeenCalledTimes(1);
  });

  it('a refusal is shown where the create was asked, and nothing opens', async () => {
    const ensurePackage = vi.fn(async () => {
      throw new Error('The customization package could not be created.');
    });
    mountCustomized(customizationOf(false, ensurePackage));
    expect(await screen.findByTestId('studio-area-pair-create-refused')).toHaveTextContent('could not be created');
    expect(where()).toBe(`/studio/${READ_ONLY}/metadata/translation/new?package=${READ_ONLY}`);
  });

  it("the list is told it may offer the create exactly where the area opens one in the pair", async () => {
    const list = `/studio/${READ_ONLY}/metadata/translation?package=${READ_ONLY}`;
    mountCustomized(customizationOf(false, vi.fn()), list);
    expect((await page()).host).toMatchObject({ readOnly: true, pairCreate: true });
    cleanup();
    mountCustomized(customizationOf(true, vi.fn()), list);
    expect((await page()).host).not.toHaveProperty('pairCreate');
    cleanup();
    mount(list);
    expect((await page()).host).not.toHaveProperty('pairCreate');
  });

  it('a kernel package has no pair: no create is offered, and its create URL lands on the list', async () => {
    const ensurePackage = vi.fn();
    const kernelCustomization = { ...customizationOf(false, ensurePackage), base: KERNEL };
    render(
      <MemoryRouter initialEntries={[`/studio/${KERNEL}/metadata/agent/new?package=${KERNEL}`]}>
        <Where />
        <Routes>
          <Route path={`/studio/${KERNEL}/metadata/*`} element={<StudioMetadataArea packageId={KERNEL} customization={kernelCustomization} />} />
        </Routes>
      </MemoryRouter>,
    );
    const at = await page();
    expect(at.page).toBe('list');
    expect(at.host).not.toHaveProperty('pairCreate');
    expect(ensurePackage).not.toHaveBeenCalled();
  });

  it('a walled door never asks, and lands on the list as before', async () => {
    const ensurePackage = vi.fn();
    mountCustomized(customizationOf(true, ensurePackage));
    expect((await page()).page).toBe('list');
    expect(ensurePackage).not.toHaveBeenCalled();
  });
});

describe('a pillar type opened from the area opens its pillar', () => {
  for (const [type, pillar] of [
    ['flow', 'automations'],
  ] as const) {
    it(`${type} → ${pillar}, with \`?surface=\``, async () => {
      mount(`/studio/${WRITABLE}/metadata/${type}/item_1?package=${WRITABLE}`);
      await screen.findByTestId('pillar');
      const url = new URL(where(), 'http://x');
      expect(url.pathname).toBe(`/studio/${WRITABLE}/${pillar}`);
      expect(url.searchParams.get('surface')).toBe(`${type}:item_1`);
    });
  }

  // objectstack#36904 — an object opens its designer on its own address.
  it('an object opens the object designer on its own address, bound to the package', async () => {
    mount(`/studio/${WRITABLE}/metadata/object/item_1?package=${WRITABLE}`);
    const designer = await screen.findByTestId('object-designer');
    expect(designer).toHaveAttribute('data-package', WRITABLE);
    expect(designer).toHaveAttribute('data-object', 'item_1');
    expect(designer).toHaveAttribute('data-readonly', 'false');
    expect(new URL(where(), 'http://x').pathname).toBe(`/studio/${WRITABLE}/metadata/object/item_1`);
  });

  // objectstack#36904 — the object's old history address is its designer's History tab.
  it("an object's history address opens its designer on the History tab, the query kept", async () => {
    mount(`/studio/${WRITABLE}/metadata/object/item_1/history?package=${WRITABLE}`);
    const designer = await screen.findByTestId('object-designer');
    expect(designer).toHaveAttribute('data-object', 'item_1');
    expect(where()).toBe(`/studio/${WRITABLE}/metadata/object/item_1?package=${WRITABLE}&tab=history`);
    expect(screen.queryByTestId('area-page')).toBeNull();
  });

  it('CONTROL: an object under `?review=1` keeps the generic page and its draft review', async () => {
    mount(`/studio/${WRITABLE}/metadata/object/item_1?package=${WRITABLE}&review=1`);
    expect((await page()).page).toBe('item');
    expect(screen.queryByTestId('object-designer')).toBeNull();
  });

  it('a type no pillar designs opens the generic page', async () => {
    mount(`/studio/${WRITABLE}/metadata/agent/support_bot?package=${WRITABLE}`);
    expect((await page()).page).toBe('item');
  });

  // objectstack#36502 — the Interfaces pillar is retired, so a view (like a
  // page, dashboard or report) is read and edited on the generic page.
  it('a view opens the generic page, no longer the retired Interfaces pillar', async () => {
    mount(`/studio/${WRITABLE}/metadata/view/item_1?package=${WRITABLE}`);
    expect((await page()).page).toBe('item');
    expect(new URL(where(), 'http://x').pathname).toBe(`/studio/${WRITABLE}/metadata/view/item_1`);
  });

  it('on a read-only package a view opens the Customize editor, the door the retired Interfaces pillar was (objectstack#36502)', async () => {
    mount(`/studio/${READ_ONLY}/metadata/view/item_1?package=${READ_ONLY}`);
    expect((await page()).page).toBe('form-editor');
    expect(JSON.parse(screen.getByTestId('form-editor').getAttribute('data-item') ?? 'null')).toEqual({
      type: 'view',
      name: 'item_1',
      member: null,
      readOnly: true,
    });
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

describe('a permission set opens its matrix full-screen at its metadata address (objectstack#36905)', () => {
  const item = () => JSON.parse(screen.getByTestId('permission-page').getAttribute('data-item') ?? 'null');

  it('on a writable package, in place: no pillar', async () => {
    mount(`/studio/${WRITABLE}/metadata/permission/sales_rep?package=${WRITABLE}`);
    expect((await page()).page).toBe('permission-page');
    expect(item()).toEqual({ packageId: WRITABLE, name: 'sales_rep', readOnly: false });
    expect(where()).toBe(`/studio/${WRITABLE}/metadata/permission/sales_rep?package=${WRITABLE}`);
    expect(screen.queryByTestId('pillar')).toBeNull();
  });

  it('on a read-only package, under its gate', async () => {
    mount(`/studio/${READ_ONLY}/metadata/permission/hr_viewer?package=${READ_ONLY}`);
    expect((await page()).page).toBe('permission-page');
    expect(item()).toEqual({ packageId: READ_ONLY, name: 'hr_viewer', readOnly: true });
  });

  it('CONTROL: the cross-package leg keeps the generic page (the matrix\'s environment presentation)', async () => {
    mount('/studio/~all/metadata/permission/admin_full_access?scope=environment');
    expect((await page()).page).toBe('item');
    expect(screen.queryByTestId('permission-page')).toBeNull();
  });

  it('its old history address opens the page\'s History tab; the cross-package leg keeps the standalone page', async () => {
    // As `builtinComponents` registers it: the matrix is the type's own editor.
    registerMetadataResource({ type: 'permission', EditPage: () => null });
    mount(`/studio/${WRITABLE}/metadata/permission/sales_rep/history?package=${WRITABLE}`);
    expect((await page()).page).toBe('permission-page');
    expect(where()).toBe(`/studio/${WRITABLE}/metadata/permission/sales_rep?package=${WRITABLE}&tab=history`);
    cleanup();
    mount('/studio/~all/metadata/permission/admin_full_access/history?scope=environment');
    expect((await page()).page).toBe('history');
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
