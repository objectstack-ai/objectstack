/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27520 row 14 — what the record page appends after an authored
 * page lines up with that page's cards.
 *
 * Measured on the showcase project page: the Attachments card the host appends
 * (the object declares `enable.files`, the page places no `record:attachments`)
 * drew 24 px wider on each side than the page's own cards, and the provenance
 * footer with it. The page renderer insets its body (`p-3 md:p-4 lg:p-6`) and
 * the appends sit beside the page, not inside it. They now take the same
 * horizontal inset.
 *
 * Mounted through `RecordDetailView` itself on an ASSIGNED record page, so the
 * inset is read off the page root the real page renderer draws, not copied.
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

const OBJECT = 'os_27520_project';
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

/** An authored page that places no `record:attachments`, so the host appends the panel. */
const ASSIGNED_PAGE = {
  name: 'os_27520_project_detail',
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

/** The page root's padding utilities, each as the horizontal inset an append must carry. */
function pageInsetOf(root: ParentNode): string[] {
  const page = root.querySelector('[data-page-type="record"]');
  expect(page, 'the page renderer must draw the record page root').toBeTruthy();
  const padding = Array.from(page!.classList).filter((c) => /^(?:[a-z]+:)?p-\d+$/.test(c));
  // Control: the page does inset its body; an inset-free page would make
  // every assertion below vacuous.
  expect(padding.length).toBeGreaterThan(0);
  return padding.map((c) => c.replace(/p-(\d+)$/, 'px-$1'));
}

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

describe('record page appends line up with the page cards (objectstack#27520 row 14)', () => {
  it('the appended Attachments panel takes the page body inset', async () => {
    const container = renderRecordPage([ASSIGNED_PAGE]);
    await waitFor(() => expect(container.textContent).toContain('auditor@example.com'));
    const fallback = await waitFor(() => {
      const el = container.querySelector('[data-record-attachments-fallback]');
      expect(el, 'the host appends the Attachments panel for an authored page that omits it').toBeTruthy();
      return el as HTMLElement;
    });
    const inset = pageInsetOf(container);
    for (const cls of inset) expect(fallback.classList).toContain(cls);
    // It is an append, not part of the page tree.
    expect(container.querySelector('[data-page-type="record"]')!.contains(fallback)).toBe(false);
  });

  it('the provenance footer takes the same inset', async () => {
    const container = renderRecordPage([ASSIGNED_PAGE]);
    const footer = await waitFor(() => {
      const el = container.querySelector('[data-testid="record-meta-footer"]');
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    for (const cls of pageInsetOf(container)) expect(footer.classList).toContain(cls);
  });
});
