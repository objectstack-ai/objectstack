/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26890 — a child write through a related list the record page's
 * AUTHOR declared refreshes the parent record's header, in place.
 *
 * The reported reach (HotCRM on 18.2.0, quote QTE-0007 → Related → Quote Line
 * Items → New → Create): the line-item hook rolled the total onto the quote,
 * the server held the new total, and the header kept the old one until a
 * reload.
 *
 * objectui#12244 already re-reads the parent on a child write, but only for the
 * children the record page DERIVES from the relationship graph
 * (`deriveRelatedLists`). An authored record page declares its own related
 * lists — `record:related_list` blocks and `record:reference_rail` entries —
 * and a child it lists there need not be one the graph derives: its FK may opt
 * out of the derived lists (`relatedList: false`), the page then being the only
 * place that child is shown. A write to such a child reached the bus under the
 * child's name and matched nothing, so the parent row stayed as first loaded.
 *
 * What this file pins, through the real page and the real MutationEvent bridge:
 *
 *   1. A create, an update and a delete of a child the authored page lists in a
 *      `record:related_list` block each re-read the parent once, and the
 *      header shows the server's recomputed total.
 *   2. The same for a child listed only in a `record:reference_rail` entry.
 *   3. Scope stays tight: a write to an object the page does not list and the
 *      graph does not derive does not re-read the parent.
 *
 * The fake backend recomputes the rollup itself, as the server's hook does, so
 * the figure the header shows can only have come from a fresh read of the
 * parent.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MetadataCtx, useMutationInvalidationBridge } from '@object-ui/react';
import { RelatedCountStore } from '@object-ui/components';
import type { DataSourceMutationEvent } from '@object-ui/types';

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
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Orthogonal chrome — same posture as RecordDetailView.childWriteRefreshesParent-12244.
vi.mock('./ActionConfirmDialog', () => ({ ActionConfirmDialog: () => null }));
vi.mock('./ActionParamDialog', () => ({ ActionParamDialog: () => null }));
vi.mock('./ActionResultDialog', () => ({ ActionResultDialog: () => null }));
vi.mock('./FlowRunner', () => ({ FlowRunner: () => null }));
vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));

import { RecordDetailView } from './RecordDetailView';

beforeAll(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

const APP = 'crm';
const PARENT = 'os_26890_quote';
/** Listed in a `record:related_list` block; its FK opts out of the derived lists. */
const LINE = 'os_26890_quote_line';
/** Listed only in the rail; its FK opts out of the derived lists too. */
const NOTE = 'os_26890_quote_note';
/** Points at the parent with `relatedList: false` and appears nowhere on the page. */
const AUDIT = 'os_26890_quote_audit';
const RECORD_ID = 'q-7';

const parentObject = {
  name: PARENT,
  label: 'Quote',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    total_price: { type: 'number', label: 'Total' },
  },
};

const childOf = (name: string, label: string) => ({
  name,
  label,
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    quantity: { type: 'number', label: 'Quantity' },
    unit_price: { type: 'number', label: 'Unit Price' },
    quote: { type: 'master_detail', reference: PARENT, label: 'Quote', relatedList: false },
  },
});

const OBJECTS = [parentObject, childOf(LINE, 'Quote Line'), childOf(NOTE, 'Quote Note'), childOf(AUDIT, 'Quote Audit')];

/** The quote's authored record page, reduced to the blocks this card is about. */
const RECORD_PAGE = {
  name: 'os_26890_quote_detail',
  label: 'Quote',
  type: 'record',
  object: PARENT,
  kind: 'full',
  template: 'default',
  isDefault: true,
  regions: [
    {
      name: 'main',
      width: 'large',
      components: [
        { type: 'page:header', properties: { title: '{name}' } },
        { type: 'record:details', properties: { sections: [{ name: 'o', label: 'Overview', fields: ['total_price'] }] } },
        {
          type: 'record:related_list',
          id: 'quote_lines',
          properties: { objectName: LINE, relationshipField: 'quote', columns: ['name', 'quantity'], limit: 10 },
        },
      ],
    },
    {
      name: 'aside',
      width: 'small',
      components: [
        {
          type: 'record:reference_rail',
          id: 'quote_rail',
          properties: { entries: [{ objectName: NOTE, relationshipField: 'quote', limit: 3 }] },
        },
      ],
    },
  ],
};

/**
 * A backend that owns the rollup: every write to a line recomputes the
 * parent's `total_price` server-side; the client only learns the new figure by
 * reading the parent again. Writes are announced through `onMutation`, the
 * event the console's MutationEvent bridge fans out onto the bus — the create
 * the record-form overlay makes included.
 */
function makeBackend() {
  const lines = [
    { id: 'l-1', name: 'Seat licence', quantity: 3, unit_price: 2000, quote: RECORD_ID },
    { id: 'l-2', name: 'Onboarding', quantity: 1, unit_price: 3000, quote: RECORD_ID },
  ];
  const rollup = () => lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
  const listeners = new Set<(e: DataSourceMutationEvent) => void>();
  const emit = (e: DataSourceMutationEvent) => {
    for (const l of Array.from(listeners)) l(e);
  };
  const ds = {
    find: vi.fn(async (objectName: string) => {
      if (objectName !== LINE) return { data: [], total: 0 };
      return { data: lines.map((l) => ({ ...l })), total: lines.length };
    }),
    findOne: vi.fn(async (objectName: string, id: string) => {
      if (objectName !== PARENT || id !== RECORD_ID) return null;
      return { id: RECORD_ID, name: 'QTE-0007', total_price: rollup() };
    }),
    create: vi.fn(async (objectName: string, row: { name: string; quantity: number; unit_price: number }) => {
      const created = { id: `l-${lines.length + 1}`, quote: RECORD_ID, ...row };
      if (objectName === LINE) lines.push(created);
      // The adapter's create event names the resource, not the id.
      emit({ type: 'create', resource: objectName, record: created });
      return created;
    }),
    update: vi.fn(async (objectName: string, id: string, patch: { quantity?: number }) => {
      if (objectName === LINE) {
        const line = lines.find((l) => l.id === id);
        if (line) Object.assign(line, patch);
      }
      emit({ type: 'update', resource: objectName, id });
      return { id, ...patch };
    }),
    delete: vi.fn(async (objectName: string, id: string) => {
      if (objectName === LINE) {
        const at = lines.findIndex((l) => l.id === id);
        if (at >= 0) lines.splice(at, 1);
      }
      emit({ type: 'delete', resource: objectName, id });
      return true;
    }),
    onMutation: (cb: (e: DataSourceMutationEvent) => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return { ds, rollup };
}

type FakeDataSource = ReturnType<typeof makeBackend>['ds'];

/** The console mounts the MutationEvent bridge once, in `AppContent`. */
function ConsoleHost({ dataSource, children }: { dataSource: unknown; children: React.ReactNode }) {
  useMutationInvalidationBridge(dataSource);
  return <>{children}</>;
}

function renderPage(ds: FakeDataSource) {
  const metadata = {
    objects: OBJECTS,
    pages: [RECORD_PAGE],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
  } as unknown as React.ContextType<typeof MetadataCtx>;
  return render(
    <MemoryRouter initialEntries={[`/apps/${APP}/${PARENT}/record/${RECORD_ID}`]}>
      <MetadataCtx.Provider value={metadata}>
        <ConsoleHost dataSource={ds}>
          <Routes>
            <Route
              path="/apps/:appName/:objectName/record/:recordId"
              element={<RecordDetailView dataSource={ds} objects={OBJECTS} onEdit={() => {}} />}
            />
          </Routes>
        </ConsoleHost>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

/** Reads of the PARENT record — the read every header block draws from. */
const parentReads = (ds: FakeDataSource) =>
  ds.findOne.mock.calls.filter(([objectName, id]) => objectName === PARENT && id === RECORD_ID).length;

/** Is `figure` (e.g. 9000) on screen, in any grouping the number formatter picks? */
const figureShown = (figure: number) => {
  const text = document.body.textContent ?? '';
  return text.includes(String(figure)) || text.includes(figure.toLocaleString('en-US'));
};

/** Let any refetch a change could have scheduled land before reading. */
const settle = () => act(async () => {
  await new Promise((r) => setTimeout(r, 50));
});

async function settledPage() {
  const backend = makeBackend();
  renderPage(backend.ds);
  await waitFor(() => expect(parentReads(backend.ds)).toBe(1));
  await screen.findByText('Seat licence');
  await waitFor(() => expect(figureShown(backend.rollup())).toBe(true));
  return backend;
}

beforeEach(() => {
  cleanup();
  RelatedCountStore._reset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('RecordDetailView — a child write through an AUTHORED related list refreshes the parent (objectstack#26890)', () => {
  it('a create of a line the authored related list shows re-reads the parent once and shows the recomputed total', async () => {
    const { ds, rollup } = await settledPage();
    expect(rollup()).toBe(9000);
    const headerBefore = document.querySelector('header');

    await act(async () => {
      await ds.create(LINE, { name: 'Training', quantity: 2, unit_price: 2700 });
    });

    expect(rollup()).toBe(14400);
    await waitFor(() => expect(parentReads(ds)).toBe(2));
    await waitFor(() => expect(figureShown(14400)).toBe(true));
    expect(figureShown(9000)).toBe(false);
    await settle();
    expect(parentReads(ds)).toBe(2);
    // In place: the same header node.
    expect(document.querySelector('header')).toBe(headerBefore);
  });

  it('an update and a delete of such a line each re-read the parent', async () => {
    const { ds } = await settledPage();

    await act(async () => {
      await ds.update(LINE, 'l-2', { quantity: 2 });
    });
    await waitFor(() => expect(parentReads(ds)).toBe(2));
    await waitFor(() => expect(figureShown(12000)).toBe(true));

    await act(async () => {
      await ds.delete(LINE, 'l-1');
    });
    await waitFor(() => expect(parentReads(ds)).toBe(3));
    await waitFor(() => expect(figureShown(6000)).toBe(true));
  });

  it('a write to a child the page lists only in its reference rail re-reads the parent', async () => {
    const { ds } = await settledPage();

    await act(async () => {
      await ds.create(NOTE, { name: 'Discount approved', quantity: 0, unit_price: 0 });
    });

    await waitFor(() => expect(parentReads(ds)).toBe(2));
  });

  it('a write to a child the page does not list and the graph does not derive does not re-read the parent', async () => {
    const { ds } = await settledPage();

    await act(async () => {
      await ds.create(AUDIT, { name: 'Viewed', quantity: 0, unit_price: 0 });
    });
    await settle();

    expect(parentReads(ds)).toBe(1);
  });
});
