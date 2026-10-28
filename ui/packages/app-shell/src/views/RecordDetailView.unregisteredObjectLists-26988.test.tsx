/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26988 — a record page leaves out a related list or rail entry
 * whose object this install does not hold.
 *
 * The reported reach (HotCRM on 18.2.0, a module's objects absent): an
 * opportunity's authored record page lists quotes; with the quote module not
 * installed the page drew "Crm Quote 0 — No related records found", the rail
 * read "+3 empty (Crm Quote · …)", and the page logged 404s on
 * `/api/v1/meta/object/…` and `/api/v1/data/…`. Since ADR-0141 a module's
 * objects can really be absent, so any app record page naming a dependent
 * module's object showed this.
 *
 * The rule is `DashboardView`'s `requiresObject` / `widget.object` filter: an
 * object-bound entry the registered object list does not hold is not drawn,
 * and nothing is asked about it. What this file pins, through the real page:
 *
 *   1. With the object absent, neither its related list (bound by
 *      `properties.objectName` or by `dataSource.object`) nor its rail entry is
 *      drawn, and no data or schema read names it — through the data source
 *      or `fetch`. The lists and rail entries of registered objects still draw.
 *   2. With the object present, the same page draws it and reads it.
 *
 * The deferral (an empty list prunes nothing) and the arms are pinned on the
 * helper, in `recordPageChildObjects.test.ts`.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { RelatedCountStore } from '@object-ui/components';

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

// Orthogonal chrome — same posture as RecordDetailView.authoredChildWriteRefreshesParent-26890.
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
const PARENT = 'os_26988_opportunity';
/** Registered: listed in a related list and in the rail; always drawn. */
const CONTACT = 'os_26988_contact';
/** The dependent module's objects: listed by the page, absent from the install unless a case installs them. */
const QUOTE = 'os_26988_crm_quote';
const LINE_ITEM = 'os_26988_crm_line_item';
const PRODUCT = 'os_26988_crm_product';
const RECORD_ID = 'opp-1';

const parentObject = {
  name: PARENT,
  label: 'Opportunity',
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
  },
};

const childOf = (name: string, label: string) => ({
  name,
  label,
  fields: {
    id: { type: 'text', label: 'Id' },
    name: { type: 'text', label: 'Name' },
    // Opted out of the derived lists: the authored page is the only place it shows.
    opportunity: { type: 'lookup', reference: PARENT, label: 'Opportunity', relatedList: false },
  },
});

const CONTACT_OBJECT = childOf(CONTACT, 'Contact');
const MODULE_OBJECTS = [childOf(QUOTE, 'Quote'), childOf(LINE_ITEM, 'Line Item'), childOf(PRODUCT, 'Product')];

/** The opportunity's authored record page, reduced to the blocks this card is about. */
const RECORD_PAGE = {
  name: 'os_26988_opportunity_detail',
  label: 'Opportunity',
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
        {
          type: 'record:related_list',
          id: 'contacts',
          properties: { objectName: CONTACT, relationshipField: 'opportunity', columns: ['name'], limit: 5 },
        },
        {
          type: 'record:related_list',
          id: 'quotes',
          properties: { objectName: QUOTE, relationshipField: 'opportunity', columns: ['name'], limit: 5 },
        },
        {
          // Bound through the element data source, which the block's gate maps onto `objectName`.
          type: 'record:related_list',
          id: 'line_items',
          dataSource: { object: LINE_ITEM },
          properties: { relationshipField: 'opportunity', columns: ['name'], limit: 5 },
        },
      ],
    },
    {
      name: 'aside',
      width: 'small',
      components: [
        {
          type: 'record:reference_rail',
          id: 'rail',
          properties: {
            entries: [
              { objectName: CONTACT, relationshipField: 'opportunity', limit: 3 },
              { objectName: PRODUCT, relationshipField: 'opportunity', limit: 3 },
            ],
          },
        },
      ],
    },
  ],
};

const ROWS: Record<string, Array<{ id: string; name: string; opportunity: string }>> = {
  [CONTACT]: [{ id: 'c-1', name: 'Grace Hopper', opportunity: RECORD_ID }],
  [QUOTE]: [{ id: 'q-1', name: 'QTE-0007', opportunity: RECORD_ID }],
  [LINE_ITEM]: [{ id: 'li-1', name: 'Seat licence', opportunity: RECORD_ID }],
  [PRODUCT]: [{ id: 'p-1', name: 'Widget Pro', opportunity: RECORD_ID }],
};

function makeDataSource() {
  return {
    find: vi.fn(async (objectName: string) => {
      const rows = ROWS[objectName] ?? [];
      return { data: rows.map((r) => ({ ...r })), total: rows.length };
    }),
    findOne: vi.fn(async (objectName: string, id: string) => {
      if (objectName !== PARENT || id !== RECORD_ID) return null;
      return { id: RECORD_ID, name: 'Big Deal' };
    }),
    getObjectSchema: vi.fn(async (objectName: string) => {
      const all = [parentObject, CONTACT_OBJECT, ...MODULE_OBJECTS];
      return all.find((o) => o.name === objectName) ?? null;
    }),
  };
}

type FakeDataSource = ReturnType<typeof makeDataSource>;

function renderPage(ds: FakeDataSource, objects: unknown[]) {
  const metadata = {
    objects,
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
        <Routes>
          <Route
            path="/apps/:appName/:objectName/record/:recordId"
            element={<RecordDetailView dataSource={ds} objects={objects as any[]} onEdit={() => {}} />}
          />
        </Routes>
      </MetadataCtx.Provider>
    </MemoryRouter>,
  );
}

/** Every object name any data-source call was made for. */
const dataSourceObjects = (ds: FakeDataSource) =>
  new Set([...ds.find.mock.calls, ...ds.findOne.mock.calls, ...ds.getObjectSchema.mock.calls].map(([name]) => name));

/** Every URL handed to `fetch`. */
const fetchedUrls = () =>
  (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([input]) =>
    String(typeof input === 'object' && input && 'url' in input ? (input as Request).url : input),
  );

/** Let any read a mounted block could have scheduled land before reading. */
const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 100));
  });

async function settledPage(objects: unknown[]) {
  const ds = makeDataSource();
  renderPage(ds, objects);
  await waitFor(() => expect(ds.findOne).toHaveBeenCalledWith(PARENT, RECORD_ID, expect.anything()));
  // The registered list draws in both arms: the page is past its first render.
  await screen.findByText('Grace Hopper');
  await settle();
  return ds;
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

describe('RecordDetailView — a related list or rail entry whose object is not installed is left out (objectstack#26988)', () => {
  it('with the module absent, its lists and rail entry are not drawn and nothing is asked about their objects', async () => {
    const ds = await settledPage([parentObject, CONTACT_OBJECT]);

    // No humanized raw name, no empty list, no folded rail chip for any of the three.
    const text = document.body.textContent ?? '';
    for (const humanized of ['Crm Quote', 'Crm Line Item', 'Crm Product']) expect(text).not.toContain(humanized);
    expect(screen.queryByText('QTE-0007')).toBeNull();
    expect(screen.queryByText('Seat licence')).toBeNull();
    expect(screen.queryByText('Widget Pro')).toBeNull();

    // No `/meta/object` or `/data` round trip for them, through either door.
    const asked = dataSourceObjects(ds);
    for (const absent of [QUOTE, LINE_ITEM, PRODUCT]) {
      expect(asked.has(absent)).toBe(false);
      expect(fetchedUrls().filter((url) => url.includes(absent))).toEqual([]);
    }

    // The registered object's list and rail entry still draw and read.
    expect(asked.has(CONTACT)).toBe(true);
    expect(screen.getAllByText('Grace Hopper').length).toBeGreaterThan(0);
  });

  it('with the module installed, the same page draws and reads every list and rail entry', async () => {
    const ds = await settledPage([parentObject, CONTACT_OBJECT, ...MODULE_OBJECTS]);

    await screen.findByText('QTE-0007');
    await screen.findByText('Seat licence');
    const asked = dataSourceObjects(ds);
    for (const present of [CONTACT, QUOTE, LINE_ITEM, PRODUCT]) expect(asked.has(present)).toBe(true);
  });
});
