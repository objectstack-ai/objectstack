/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11958 — the record page's "print" action (card ② of the ruling of
 * record on objectstack#8346, M1: "a 'print' action on the record page that
 * opens the browser's print preview of the bound page").
 *
 * The page bound to a record is the record page `RecordDetailView` renders for
 * it (`usePageAssignment`). When that page declares `print`, the view offers a
 * Print action that hands off to the browser's print preview, and the page is
 * drawn as a print page (`PageRenderer` stamps the scoping attribute its print
 * stylesheet reads). The control is the same page without `print`: no action,
 * no print page.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada', image: null }, activeOrganization: null }),
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordPresence: () => [],
  PresenceAvatars: () => null,
}));
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));
// Orthogonal chrome — this file observes the print action and the page root only.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';
import { NavigationProvider } from '../context/NavigationContext';

const OBJECT = 'invoice_11958';
const REC = 'INV-1';

const objectDef = {
  name: OBJECT,
  label: 'Invoice',
  fields: { id: { label: 'Id', type: 'text' }, name: { label: 'Number', type: 'text' } },
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
    findOne: vi.fn(async () => ({ id: REC, name: 'INV-0001' })),
    create: vi.fn(async (_o: string, row: unknown) => row),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: async () => objectDef,
  };
}

/** The record page bound to the object: the invoice document, with or without `print`. */
function boundPage(print?: Record<string, unknown>) {
  return {
    name: 'invoice_document',
    label: 'Invoice',
    type: 'record',
    object: OBJECT,
    ...(print ? { print } : {}),
    regions: [
      { name: 'header', components: [{ type: 'text', value: 'ACME Ltd' }] },
      { name: 'main', components: [{ type: 'text', value: 'Invoice body' }] },
    ],
  };
}

function makeMetadata(pages: unknown[]) {
  return {
    objects: [], pages, loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => pages, getItem: async () => null,
    getItemsByType: () => pages,
  } as never;
}

async function mount(page: Record<string, unknown>) {
  const ds = makeDataSource();
  const utils = render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT}/${REC}`]}>
      <MetadataCtx.Provider value={makeMetadata([page])}>
        <NavigationProvider>
          <RecordDetailView
            dataSource={ds as never}
            objects={[objectDef] as never}
            onEdit={() => {}}
            objectNameOverride={OBJECT}
            recordIdOverride={REC}
          />
        </NavigationProvider>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
  await waitFor(() => expect(utils.container.querySelector('[data-page-type]')).not.toBeNull());
  return utils;
}

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

beforeEach(() => {
  // Unrelated chrome reaches for the platform API; serve it from a double so
  // happy-dom never opens a socket (objectui#6640).
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ allowed: true, data: [] }),
    text: async () => '{}',
  })) as never);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RecordDetailView — the record page’s print action opens the browser print preview of the bound print page (objectui#11958)', () => {
  it('a bound page that declares `print` is drawn as a print page, with a Print action that calls the browser print preview', async () => {
    // happy-dom ships no `window.print`; the browser's is stood in for here.
    const print = vi.fn();
    Object.defineProperty(window, 'print', { configurable: true, writable: true, value: print });
    const { container, findByTestId } = await mount(boundPage({ paperSize: 'A4', repeatHeader: true }));
    expect(container.querySelector('[data-print-page]')).not.toBeNull();
    const action = await findByTestId('record-print-button');
    expect(print).not.toHaveBeenCalled();
    fireEvent.click(action);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('CONTROL — the same bound page without `print` offers no Print action and is no print page', async () => {
    const { container, queryByTestId } = await mount(boundPage());
    expect(queryByTestId('record-print-button')).toBeNull();
    expect(container.querySelector('[data-print-page]')).toBeNull();
  });
});
