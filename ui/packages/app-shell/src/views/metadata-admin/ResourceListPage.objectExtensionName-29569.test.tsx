// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#29569 — an `object_extension` row names, links and marks the
 * object it extends.
 *
 * Measured on the card: the pair `com.example.showcase.custom` extended
 * `showcase_task`, and the list read served the item as stored,
 * `{ extend: 'showcase_task', fields, _packageId }`, with no `name`
 * (`ObjectExtensionSchema` refuses one; the row is stored under the target's
 * name). The list read `name`, so Studio's All metadata area drew the row as
 * "—" and linked it to `…/object_extension/(unnamed-0)`, an empty page. The
 * type now declares `extend` as its identity key (`default-schemas.ts`).
 *
 * Pinned, each against a control:
 *
 *  - in the cross-package leg the row shows `showcase_task` under an "Object"
 *    header and links to that extension in its own package;
 *  - in the base's area the row is found by `extend`, carries the pair's
 *    "Added" mark, and its link addresses the extension, never `(unnamed-N)`;
 *  - the mark is looked up by `extend`: a read listing the extension as an
 *    override marks the row "Customized";
 *  - the search box matches `extend`;
 *  - the Label column shows the extension's own label;
 *  - CONTROL: a row of another type (`page`) still names and links by `name`.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
// The switch column waits on `audienceAnchorsOf`'s dynamic import of this exact
// specifier (see `ResourceListPage.environmentScope-7611.test.tsx`).
import '@objectstack/spec/identity';
import { MetadataAreaHostContext, type MetadataAreaHost } from './metadataAreaHost';

const BASE = 'com.example.showcase';
const PAIR = 'com.example.showcase.custom';

/** What the list read serves: the extension body as stored, no `name`. */
const LISTS: Record<string, Record<string, unknown>[]> = {
  object_extension: [
    {
      extend: 'showcase_task',
      label: 'Work items',
      fields: { custom_note__c: { type: 'text', label: 'Custom note' } },
      _packageId: PAIR,
    },
    { extend: 'showcase_project', fields: { budget_code__c: { type: 'text' } }, _packageId: PAIR },
  ],
  page: [{ name: 'task_board', label: 'Task board', _packageId: PAIR }],
};

/**
 * The package list as served: the code-provided base and its writable pair, a
 * project package, which the cross-package leg's list scopes to.
 */
const PACKAGES = [
  { manifest: { id: BASE, name: 'Showcase', scope: 'installed' } },
  { manifest: { id: PAIR, name: 'Showcase (custom)' } },
];

/** Stable singleton — the page's load effect keys on the client identity. */
const CLIENT = {
  list: async (type: string) => (type === 'package' ? PACKAGES : (LISTS[type] ?? [])),
};

const entry = (type: string, label: string) => ({
  type,
  label,
  domain: 'data',
  allowEnvironmentOverlay: false,
  allowRuntimeCreate: true,
});
const ENTRIES = [entry('object_extension', 'Object Extension'), entry('page', 'Page')];

vi.mock('./useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => CLIENT,
  useMetadataTypes: () => ({ loading: false, error: null, entries: ENTRIES }),
}));
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));
vi.mock('../../hooks/useCanAuthorMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useCanAuthorMetadata: () => true,
}));

import { MetadataResourceListPage } from './ResourceListPage';
import { registerDefaultMetadataSchemas } from './default-schemas';
import { t } from './i18n';

registerDefaultMetadataSchemas();

const EMPTY_COUNTS = { overrides: 0, extensions: 0, switchedOff: 0, contributions: 0 };
/** The base's read as served on the card: the extension's field, no override. */
const SERVED_READ = {
  packageId: BASE,
  overrides: [],
  extensions: [{ object: 'showcase_task', kind: 'field', name: 'custom_note__c' }],
  switchedOff: [],
  contributions: [],
  counts: { ...EMPTY_COUNTS, extensions: 1 },
};
let read: Record<string, unknown> = SERVED_READ;

const fetchMock = vi.fn(async (url: string) => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const u = String(url);
  if (u === '/api/v1/packages') {
    return json(200, { success: true, data: { packages: [{ manifest: { id: BASE, name: 'Showcase', scope: 'installed' }, writable: false }] } });
  }
  if (/^\/api\/v1\/packages\/[^/]+\/customizations$/.test(u)) return json(200, { success: true, data: read });
  if (u.startsWith('/api/v1/data/sys_metadata_activation')) {
    return json(200, { object: 'sys_metadata_activation', records: [], hasMore: false });
  }
  return json(404, { success: false });
});

beforeEach(() => {
  read = SERVED_READ;
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const area = (packageId: string | null): MetadataAreaHost => ({
  packageId,
  readOnly: packageId !== null,
  basePath: `/studio/${packageId ?? '~all'}/metadata`,
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
}

function mountList(host: MetadataAreaHost, type: string, search = '') {
  return render(
    <MetadataAreaHostContext.Provider value={host}>
      <MemoryRouter initialEntries={[`${host.basePath}/${type}${search}`]}>
        <Routes>
          <Route path={`${host.basePath}/${type}`} element={<MetadataResourceListPage type={type} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </MetadataAreaHostContext.Provider>,
  );
}

const linkOf = (row: HTMLElement) => within(row).getAllByRole('link')[0]!;
const marksOf = (row: HTMLElement) =>
  within(row)
    .queryAllByTestId('customization-mark')
    .map((m) => m.getAttribute('data-kind'));

describe('an object_extension row names, links and marks the object it extends (objectstack#29569)', () => {
  it('the cross-package leg shows `extend` under an "Object" header and links to that extension', async () => {
    mountList(area(null), 'object_extension');
    const row = await screen.findByTestId('metadata-row-showcase_task');

    const cells = within(row).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('showcase_task');
    expect(cells[0]).not.toHaveTextContent('—');
    expect(screen.queryByTestId(/^metadata-row-\(unnamed-/)).toBeNull();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers[0]).toBe(t('engine.list.col.extend', 'en-US'));
    expect(t('engine.list.col.extend', 'en-US')).toBe('Object');

    const href = linkOf(row).getAttribute('href') ?? '';
    expect(href).toBe(`/studio/~all/metadata/object_extension/showcase_task?package=${encodeURIComponent(PAIR)}`);
    fireEvent.click(linkOf(row));
    expect(screen.getByTestId('where')).toHaveTextContent(
      `/studio/~all/metadata/object_extension/showcase_task?package=${PAIR}`,
    );
  });

  it("in the base's area the pair's row is found by `extend`, marked Added, and opens that extension", async () => {
    mountList(area(BASE), 'object_extension', `?package=${BASE}`);
    const row = await screen.findByTestId('metadata-row-showcase_task');
    await within(row).findByTestId('customization-mark');

    expect(within(row).getAllByRole('cell')[0]).toHaveTextContent('showcase_task');
    expect(marksOf(row)).toEqual(['added']);
    expect(linkOf(row).getAttribute('href')).toBe(
      `/studio/${BASE}/metadata/object_extension/showcase_task?package=${encodeURIComponent(PAIR)}`,
    );
  });

  it('the mark is looked up by `extend`: a read listing the extension as an override marks it Customized', async () => {
    read = {
      ...SERVED_READ,
      overrides: [{ type: 'object_extension', name: 'showcase_task' }],
      counts: { ...EMPTY_COUNTS, overrides: 1, extensions: 1 },
    };
    mountList(area(BASE), 'object_extension', `?package=${BASE}`);
    const row = await screen.findByTestId('metadata-row-showcase_task');
    await within(row).findByTestId('customization-mark');

    expect(marksOf(row)).toEqual(['customized']);
    // CONTROL: the other extension the read does not list stays "Added".
    expect(marksOf(screen.getByTestId('metadata-row-showcase_project'))).toEqual(['added']);
  });

  it('the search box matches `extend`', async () => {
    mountList(area(null), 'object_extension');
    await screen.findByTestId('metadata-row-showcase_task');

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'project' } });
    expect(screen.getByTestId('metadata-row-showcase_project')).toBeInTheDocument();
    expect(screen.queryByTestId('metadata-row-showcase_task')).toBeNull();
  });

  it("the Label column shows the extension's own label", async () => {
    mountList(area(null), 'object_extension');
    const row = await screen.findByTestId('metadata-row-showcase_task');

    expect(within(row).getAllByRole('cell')[1]).toHaveTextContent('Work items');
    expect(within(screen.getByTestId('metadata-row-showcase_project')).getAllByRole('cell')[1]).toHaveTextContent('—');
  });

  it('CONTROL: a row of another type still names and links by `name`', async () => {
    mountList(area(null), 'page');
    const row = await screen.findByTestId('metadata-row-task_board');

    expect(within(row).getAllByRole('cell')[0]).toHaveTextContent('task_board');
    expect(linkOf(row).getAttribute('href')).toBe(
      `/studio/~all/metadata/page/task_board?package=${encodeURIComponent(PAIR)}`,
    );
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
    expect(headers[0]).toBe(t('engine.list.col.name', 'en-US'));
  });
});
