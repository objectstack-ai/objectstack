/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#35745 — the band above the tabs, on the pages that are NOT laid
 * out by `RecordPageColumns`.
 *
 * The record page's scroller and the column layout each padded their top
 * 24px on a desktop, stacking a 48px band under the header. The scroller now
 * pads only its sides and foot, and the column layout pads its own top
 * (pinned in `RecordPageColumns.test.tsx`). Everything else the scroller
 * hosts must still start clear of the header on its own: an authored page the
 * page renderer draws carries the renderer's `p-3 md:p-4 lg:p-6`, and a print
 * page's screen-only chrome, which sits above that page, takes its own top
 * margin. (The loading, error and not-found states are early returns of the
 * view and never render inside the scroller.)
 *
 * Mounted through `RecordDetailView` itself, so the padding is read off the
 * scroller and page root the real view and page renderer draw.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
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
// Orthogonal chrome, stubbed.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const OBJECT = 'os_35745_project';
const REC = 'prj-1';

const objectDef = {
  name: OBJECT,
  label: 'Project',
  enable: { files: true },
  highlightFields: ['name'],
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    owner_email: { label: 'Owner Email', type: 'text' },
  },
};

const RECORD = {
  id: REC,
  name: 'Website Relaunch',
  owner_email: 'auditor@example.com',
  created_at: '2026-01-02T03:04:05.000Z',
  updated_at: '2026-02-03T04:05:06.000Z',
};

/** An authored page the page renderer draws (not laid out by `RecordPageColumns`). */
const ASSIGNED_PAGE = {
  name: 'os_35745_project_detail',
  label: 'Project',
  type: 'record',
  object: OBJECT,
  regions: [
    {
      name: 'main',
      components: [
        { type: 'record:details', id: 'overview', properties: { sections: [{ label: 'Overview', fields: ['owner_email'] }] } },
      ],
    },
  ],
};

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0, hasMore: false, pageSize: 50 })),
    findOne: vi.fn(async (name: string, id: string) => (name === OBJECT ? { ...RECORD, id } : null)),
    create: vi.fn(async (_o: string, row: any) => row),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    getObjectSchema: async (name: string) => ({ name, fields: objectDef.fields }),
  } as any;
}

function makeMetadata(pages: any[]) {
  return {
    objects: [], pages, loading: false, error: null,
    refresh: async () => {}, invalidate: () => {},
    ensureType: async () => pages, getItem: async () => null,
    getItemsByType: () => pages,
  } as any;
}

function renderRecordPage(pages: any[]): HTMLElement {
  const { container } = render(
    <MemoryRouter initialEntries={[`/app/demo/${OBJECT}/${REC}`]}>
      <MetadataCtx.Provider value={makeMetadata(pages)}>
        <RecordDetailView
          dataSource={makeDataSource()}
          objects={[objectDef]}
          onEdit={() => {}}
          objectNameOverride={OBJECT}
          recordIdOverride={REC}
          embedded
        />
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
  return container;
}

/** The record page's scroller: the element the view scrolls the page in. */
function scrollerOf(root: ParentNode): HTMLElement {
  const el = root.querySelector('.scroll-pb-48');
  expect(el, 'the view must draw its page scroller').toBeTruthy();
  return el as HTMLElement;
}

/** Utilities that pad an element's TOP: `p-*`, `pt-*`, `py-*`, at any breakpoint. */
const topPadding = (el: Element) =>
  Array.from(el.classList).filter((c) => /^(?:[a-z]+:)?(?:p|pt|py)-\d+$/.test(c));

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

beforeEach(() => {
  cleanup();
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
});

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('the scroller pads no top; what it hosts starts clear of the header (objectstack#35745)', () => {
  it('an authored page drawn by the page renderer pads its own top, under a scroller that pads none', async () => {
    const container = renderRecordPage([ASSIGNED_PAGE]);
    await waitFor(() => expect(container.textContent).toContain('auditor@example.com'));
    const scroller = scrollerOf(container);
    expect(topPadding(scroller)).toEqual([]);
    // CONTROL: the scroller still insets its sides and foot.
    for (const cls of ['px-3', 'pb-3', 'sm:px-4', 'sm:pb-4', 'lg:px-6', 'lg:pb-6']) expect(scroller.classList).toContain(cls);
    const page = container.querySelector('[data-page-type="record"]') as HTMLElement;
    expect(page, 'the page renderer must draw the record page root').toBeTruthy();
    expect(scroller.contains(page)).toBe(true);
    expect(topPadding(page)).toEqual(expect.arrayContaining(['p-3', 'md:p-4', 'lg:p-6']));
  });

  it("a print page's screen-only chrome takes its own top margin above the page", async () => {
    const PRINT_PAGE = {
      ...ASSIGNED_PAGE,
      name: 'os_35745_project_print',
      isDefault: true,
      print: { paperSize: 'A4' },
      regions: [{ name: 'main', components: [{ type: 'text', value: 'Project sheet' }] }],
    };
    const container = renderRecordPage([PRINT_PAGE]);
    const chrome = await waitFor(() => {
      const el = container.querySelector('[data-record-print-chrome]');
      expect(el, 'a page that declares `print` draws the screen-only chrome').toBeTruthy();
      return el as HTMLElement;
    });
    const scroller = scrollerOf(container);
    expect(scroller.firstElementChild).toBe(chrome);
    expect(chrome.classList).toContain('mt-3');
    const page = container.querySelector('[data-print-page]') as HTMLElement;
    expect(page, 'the page is drawn as a print page').toBeTruthy();
    expect(topPadding(page)).toEqual(expect.arrayContaining(['p-3', 'md:p-4', 'lg:p-6']));
  });
});
