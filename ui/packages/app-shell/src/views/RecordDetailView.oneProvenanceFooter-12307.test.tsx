/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12307 — the record page draws ONE provenance footer for its record,
 * whatever the number of `record:details` nodes it carries.
 *
 * Measured on objectstack-ai/cloud's environment page before this change: a
 * one-row `record:details` top line plus a body `record:details` drew the same
 * "Created … Updated …" line twice, and a variant with one node per section
 * drew one per node plus a footer-only block where a hidden section sat. Every
 * `DetailView` mounted its own `<RecordMetaFooter>`; the line is the record's,
 * so this host now draws it once, at the page foot, and a `record:details`
 * node reading this page's record draws none (the renderer's half is pinned in
 * `@object-ui/plugin-detail`, `record-details.pageProvenance-12307`).
 *
 * Mounted through `RecordDetailView` itself, on an ASSIGNED record page, so the
 * count runs over the tree a tenant gets — the page renderer, the regions, the
 * registered `record:details` blocks and this host's own chrome together.
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
// Orthogonal chrome — stubbed so the only footer this file can count is the
// record page's.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

const OBJECT = 'os_12307_environment';
const REC = 'env-1';

const objectDef = {
  name: OBJECT,
  label: 'Environment',
  managedBy: 'platform',
  highlightFields: ['name'],
  fields: {
    id: { label: 'Id', type: 'text' },
    name: { label: 'Name', type: 'text' },
    region: { label: 'Region', type: 'text' },
    plan: { label: 'Plan', type: 'text' },
    notes: { label: 'Notes', type: 'text' },
    phase: { label: 'Phase', type: 'text' },
  },
};

/**
 * Audit TIMESTAMPS only, no actor, so the footer is drawn from the dates and no
 * user reference has to resolve; more than two seconds apart, so both its
 * segments draw. `notes` and `phase` are left unset on purpose: the third node
 * below sections only them.
 */
const RECORD = {
  id: REC,
  name: 'Production',
  region: 'eu-west',
  plan: 'Enterprise',
  created_at: '2026-01-02T03:04:05.000Z',
  updated_at: '2026-02-03T04:05:06.000Z',
};

/** The cloud environment page's shape: a one-row top line, a body, and a node whose only section is empty. */
const ASSIGNED_PAGE = {
  name: 'os_12307_environment_detail',
  label: 'Environment',
  type: 'record',
  object: OBJECT,
  regions: [
    {
      name: 'main',
      components: [
        { type: 'record:details', id: 'top_line', properties: { fields: ['region'] } },
        { type: 'record:details', id: 'body', properties: { sections: [{ label: 'Subscription', fields: ['plan'] }] } },
        { type: 'record:details', id: 'extras', properties: { sections: [{ label: 'Extras', fields: ['notes', 'phase'] }] } },
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

async function renderRecordPage(pages: any[]): Promise<HTMLElement> {
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

const footersIn = (root: ParentNode) => Array.from(root.querySelectorAll('[data-testid="record-meta-footer"]'));
const detailsNodes = (root: ParentNode) => Array.from(root.querySelectorAll('[data-obj-type="record:details"]'));

beforeAll(() => {
  // useIsMobile() keys off innerWidth (< 768 == mobile); pin a desktop width.
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

beforeEach(() => {
  cleanup();
  // Unrelated chrome (approvals, favourites…) reaches for the platform API; in
  // the test DOM that is a real socket. Answer it locally.
  vi.stubGlobal('fetch', vi.fn(async () =>
    new Response(JSON.stringify({ data: [] }), {
      status: 200, headers: { 'content-type': 'application/json' },
    })));
});

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('the record page draws one provenance footer for its record (objectui#12307)', () => {
  it('a page with several record:details nodes shows one footer, at the page foot', async () => {
    const container = await renderRecordPage([ASSIGNED_PAGE]);

    // Control: the assigned page rendered, all three nodes, with the record's
    // values — so the count below is over the tree a tenant gets.
    await waitFor(() => {
      expect(container.textContent).toContain('eu-west');
      expect(container.textContent).toContain('Enterprise');
    });
    expect(detailsNodes(container)).toHaveLength(3);

    await waitFor(() => expect(footersIn(container)).toHaveLength(1));
    const [footer] = footersIn(container);
    // It is the page's line, not one of the nodes': no `record:details` node
    // holds it.
    for (const node of detailsNodes(container)) {
      expect(node.contains(footer)).toBe(false);
    }
  });

  it('a node whose sections are all hidden draws nothing — no section, no footer-only block', async () => {
    const container = await renderRecordPage([ASSIGNED_PAGE]);
    await waitFor(() => expect(container.textContent).toContain('Enterprise'));

    const extras = container.querySelector('[data-obj-id="extras"]') ?? detailsNodes(container)[2];
    expect(extras, 'the third record:details node must be mounted').toBeTruthy();
    expect(extras!.textContent).toBe('');
    expect(footersIn(extras!)).toHaveLength(0);
  });

  it('the synthesized default page keeps exactly one footer too', async () => {
    const container = await renderRecordPage([]);
    await waitFor(() => expect(detailsNodes(container).length).toBeGreaterThan(0));
    await waitFor(() => expect(container.textContent).toContain('eu-west'));

    await waitFor(() => expect(footersIn(container)).toHaveLength(1));
  });
});
