/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12715 — a record rendered on a NAMED record page.
 *
 * The console's record route (`:objectName/record/:recordId`) shows a record on
 * the page its object's page assignment picks: the object's default record
 * page. Its sibling `RECORD_NAMED_PAGE_ROUTE`
 * (`:objectName/record/:recordId/page/:pageName`) names the page in the URL,
 * so a document that is not the default (the invoice's print page) renders for
 * the same record at a URL the server's print driver can load.
 *
 * Both routes are mounted here from the route constant `AppContent` declares,
 * under the same `/apps/:appName` parent, so what is measured is the console
 * URL, not a hand-fed prop. Pinned:
 *
 *  - the named page renders, as a print page, with the print root and the
 *    idle signal behaving as they do on the record route (the print driver
 *    waits on both);
 *  - the record route is unchanged: it still opens the default record page;
 *  - a name that is not a record page of the object (unknown, a page of
 *    another type, another object's record page) shows the page-not-found
 *    state and never the default page, a synthesized page, or the other page;
 *  - while the pages are loading nothing but the skeleton is drawn.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
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
// Orthogonal chrome — this file observes which page renders, and its root.
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
import { RECORD_NAMED_PAGE_ROUTE } from '../console/AppContent';
import {
  installSettleSignalGlobal,
  beginRequest,
  endRequest,
  __resetSettleSignal,
} from '../observability/settleSignal';

const OBJECT = 'invoice_12715';
const OTHER_OBJECT = 'delivery_12715';
const REC = 'INV-1';

const objectDef = {
  name: OBJECT,
  label: 'Invoice',
  fields: { id: { label: 'Id', type: 'text' }, name: { label: 'Number', type: 'text' } },
};

/** A page with one marker text in its main region, so the test can tell which page drew. */
function page(name: string, extra: Record<string, unknown>) {
  return {
    name,
    label: name,
    ...extra,
    regions: [{ name: 'main', components: [{ type: 'text', content: `PAGE:${name}` }] }],
  };
}

/** The invoice's default record page — the record view. */
const DEFAULT_PAGE = page('invoice_record', { type: 'record', object: OBJECT, isDefault: true });
/** A second record page of the invoice — the printable invoice document. */
const PRINT_PAGE = page('invoice_document', {
  type: 'record',
  object: OBJECT,
  print: { paperSize: 'A4' },
});
/** A page of the same name space that is not a record page. */
const APP_PAGE = page('invoice_dashboard', { type: 'app' });
/** A record page of ANOTHER object, carrying `print` so a wrong render would be a print page. */
const OTHER_OBJECT_PAGE = page('delivery_note', {
  type: 'record',
  object: OTHER_OBJECT,
  print: { paperSize: 'A4' },
});

const PAGES = [DEFAULT_PAGE, PRINT_PAGE, APP_PAGE, OTHER_OBJECT_PAGE];

/** A data source whose record read is held open until released, counted by the settle signal. */
function makeDataSource() {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const findOne = vi.fn(async () => {
    beginRequest();
    try {
      await gate;
      return { id: REC, name: 'INV-0001' };
    } finally {
      endRequest();
    }
  });
  return {
    ds: {
      find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
      findOne,
      create: vi.fn(async (_o: string, row: unknown) => row),
      update: vi.fn(async () => ({})),
      delete: vi.fn(async () => ({})),
      getObjectSchema: async () => objectDef,
    },
    release: () => release(),
  };
}

function makeMetadata(pages: unknown[], loading = false) {
  return {
    objects: [], pages, loading, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: loading ? () => new Promise<never>(() => {}) : async () => pages,
    getItem: async () => null,
    getItemsByType: () => pages,
  } as never;
}

function mount(url: string, opts: { loading?: boolean } = {}) {
  const { ds, release } = makeDataSource();
  const view = <RecordDetailView dataSource={ds as never} objects={[objectDef] as never} onEdit={() => {}} />;
  const utils = render(
    <MemoryRouter initialEntries={[url]}>
      <MetadataCtx.Provider value={makeMetadata(PAGES, opts.loading)}>
        <NavigationProvider>
          <Routes>
            <Route path="/apps/:appName">
              <Route path=":objectName/record/:recordId" element={view} />
              <Route path={RECORD_NAMED_PAGE_ROUTE} element={view} />
            </Route>
          </Routes>
        </NavigationProvider>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  return { ...utils, ds, release };
}

const objectui = () => (window as unknown as { __objectui: { idle: boolean } }).__objectui;
const printRoot = (container: HTMLElement) => container.querySelector('[data-print-page]');

/**
 * The server's ready predicate, read the way its print driver reads it: the
 * print root is in the document and the app is idle. Asserted false while the
 * record read is in flight, then true once it settles.
 */
async function expectPrintReadyAfterRecordLoads(
  container: HTMLElement,
  ds: ReturnType<typeof makeDataSource>['ds'],
  release: () => void,
) {
  await waitFor(() => expect(ds.findOne).toHaveBeenCalled());
  expect(objectui().idle).toBe(false);
  release();
  await waitFor(() => expect(objectui().idle).toBe(true));
  await waitFor(() => expect(printRoot(container)).not.toBeNull());
}

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
  installSettleSignalGlobal();
});

beforeEach(() => {
  __resetSettleSignal();
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
});

describe('the named record page route (objectui#12715)', () => {
  it('spells the route as a path segment under the record route', () => {
    expect(RECORD_NAMED_PAGE_ROUTE).toBe(':objectName/record/:recordId/page/:pageName');
  });

  it('renders the record on the named record page, as a print page, ready when idle', async () => {
    const { container, ds, release } = mount(`/apps/demo/${OBJECT}/record/${REC}/page/invoice_document`);

    await expectPrintReadyAfterRecordLoads(container, ds, release);
    expect(ds.findOne).toHaveBeenCalledWith(OBJECT, REC);
    await screen.findByText('PAGE:invoice_document');
    expect(screen.queryByText('PAGE:invoice_record')).toBeNull();
    expect(screen.queryByTestId('record-page-not-found')).toBeNull();
  });

  it('opens the default record page on the record route, unchanged', async () => {
    const { container, ds, release } = mount(`/apps/demo/${OBJECT}/record/${REC}`);

    await waitFor(() => expect(ds.findOne).toHaveBeenCalledWith(OBJECT, REC));
    release();
    await screen.findByText('PAGE:invoice_record');
    expect(screen.queryByText('PAGE:invoice_document')).toBeNull();
    expect(screen.queryByTestId('record-page-not-found')).toBeNull();
    // The default page declares no `print`: no print root on this route.
    expect(printRoot(container)).toBeNull();
  });

  it('gives the record route the same print root and idle signal when its default page is a print page', async () => {
    // Parity for the print driver: the default-route behaviour the named route
    // must match, measured on the same harness.
    const pages = [{ ...PRINT_PAGE, isDefault: true }];
    const { ds, release } = makeDataSource();
    const view = <RecordDetailView dataSource={ds as never} objects={[objectDef] as never} onEdit={() => {}} />;
    const { container } = render(
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT}/record/${REC}`]}>
        <MetadataCtx.Provider value={makeMetadata(pages)}>
          <NavigationProvider>
            <Routes>
              <Route path="/apps/:appName/:objectName/record/:recordId" element={view} />
            </Routes>
          </NavigationProvider>
        </MetadataCtx.Provider>
      </MemoryRouter>,
    );

    await expectPrintReadyAfterRecordLoads(container, ds, release);
    await screen.findByText('PAGE:invoice_document');
  });

  describe('a name that is not a record page of the object is refused, visibly', () => {
    const cases: Array<[string, string]> = [
      ['an unknown page name', 'no_such_page'],
      ['a page that is not a record page', APP_PAGE.name],
      ["another object's record page", OTHER_OBJECT_PAGE.name],
    ];

    it.each(cases)('%s shows page-not-found, never the default page or the other page', async (_label, name) => {
      const { container, ds } = mount(`/apps/demo/${OBJECT}/record/${REC}/page/${name}`);

      await screen.findByTestId('record-page-not-found');
      // No silent fallback: neither the default page nor any other page drew,
      // there is no print root for a driver to accept, and the record was not
      // read for a page that will not render.
      for (const p of PAGES) expect(screen.queryByText(`PAGE:${p.name}`)).toBeNull();
      expect(container.querySelector('[data-page-type]')).toBeNull();
      expect(printRoot(container)).toBeNull();
      expect(ds.findOne).not.toHaveBeenCalled();
    });
  });

  it('draws nothing but the skeleton while the pages are loading', async () => {
    const { container, ds } = mount(`/apps/demo/${OBJECT}/record/${REC}/page/invoice_document`, { loading: true });

    // Give every effect a turn; the page list never arrives.
    await new Promise((r) => setTimeout(r, 50));
    for (const p of PAGES) expect(screen.queryByText(`PAGE:${p.name}`)).toBeNull();
    expect(container.querySelector('[data-page-type]')).toBeNull();
    expect(printRoot(container)).toBeNull();
    expect(screen.queryByTestId('record-page-not-found')).toBeNull();
    expect(ds.findOne).not.toHaveBeenCalled();
  });
});
