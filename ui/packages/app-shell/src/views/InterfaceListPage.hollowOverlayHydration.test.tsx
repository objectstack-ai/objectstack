// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#5773 — the reachability card for the coupling recorded in
 * `narrowPersonalizationOverlay`'s docblock (`packages/data-objectstack/src/index.ts`)
 * while shipping objectui#5233's write half (PR #5772):
 *
 *   > those two [`listViewOverrides` / `getView`] answer with the stored
 *   > DOCUMENT … and `InterfaceListPage` hydrates a hollow view out of that
 *   > document.
 *
 * `InterfaceListPage`'s hollow-view hydration effect fetches
 * a view's per-view overlay row through `listViewOverrides`/`getView` — the
 * SAME undocked-narrowing read path the docblock is talking about — whenever
 * the ADR-0017 expansion serves a source view with no `columns`. Before
 * objectui#5233, `persistViewPatch` wrote a system view's overlay as
 * `{ ...baseViewDef, ...patch }`, so that row carried a frozen COPY of the
 * source view's columns at write time; the merge `{ ...resolvedView,
 * ...hydratedView }` picked those up and the page rendered STALE columns.
 * After #5233 the same write site stored the patch alone — no `columns` key
 * — so the merge contributes nothing towards `hasColumns`, and the page's own
 * defaulting (`defaultColumnsFromObject`) fires instead.
 *
 * That write site is retired (objectui#12504: `persistViewPatch` and the
 * adapter's `updateViewConfig`), so both row shapes are now rows an install
 * already carries, and the hydration effect still reads them. This is the
 * card's step 1: CONSTRUCT the case (a hollow ADR-0017 expansion item for a
 * system view that also carries a personalization overlay row), with the row
 * put in the store in the shape the retired write stored it, read through the
 * REAL `ObjectStackAdapter` and the REAL `InterfaceListPage` render — not
 * reasoned about, because the coupling lives in what the hydration effect does
 * with a row it actually fetched.
 *
 * Two cases, so the second is a control that PROVES the first discriminates
 * something real: with the CURRENT (post-#5233) thin overlay shape the page
 * renders defaults; with the OLD (pre-#5233) fat overlay shape — reachable
 * today only via a row an install has been carrying since before the fix,
 * exactly as `overlayPatchOnly.test.ts`'s own "PRE-FIX" case frames it — the
 * SAME component renders the frozen stale columns instead. If both cases
 * rendered the same thing, this test would not be measuring the hydration
 * effect at all.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return {
    ...actual,
    useObjectTranslation: () => ({ t: (_k: string, o?: any) => o?.defaultValue ?? _k }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return {
    ...actual,
    useAuth: () => ({}),
  };
});

// Only `ListView`'s resolved `schema.columns` is under test here — the
// hydration effect's output, not the grid's own record-fetching/rendering
// stack (which `ObjectView`'s and `ListView`'s own suites already cover).
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => (
    <div data-testid="rendered-columns">{JSON.stringify(props?.schema?.columns ?? null)}</div>
  ),
}));

let testDataSource: any;
let testObjects: any[];

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await (importOriginal as any)();
  return {
    ...actual,
    useAdapter: () => testDataSource,
    useMetadata: () => ({ objects: testObjects }),
  };
});

import { ObjectStackAdapter } from '@object-ui/data-objectstack';
import { InterfaceListPage } from './InterfaceListPage';

const OBJECT_NAME = 'crm_lead';
const VIEW_ID = `${OBJECT_NAME}.default`;

/** Stub `sys_metadata`-shaped store, keyed `type::name` — same convention as
 * `ObjectView.overlayPatchOnly.test.ts`'s harness. */
function makeMetaStore() {
  const rows = new Map<string, any>();
  const meta = {
    getItems: vi.fn(async (type: string) => ({
      type,
      items: [...rows.entries()].filter(([k]) => k.startsWith(`${type}::`)).map(([, v]) => v),
    })),
    getItem: vi.fn(async (type: string, name: string) => {
      const item = rows.get(`${type}::${name}`);
      if (!item) {
        const err: any = new Error(`Not found: ${type}/${name}`);
        err.status = 404;
        throw err;
      }
      return { type, name, item };
    }),
    saveItem: vi.fn(async (type: string, name: string, item: any) => {
      rows.set(`${type}::${name}`, { ...item });
      return { success: true, item: rows.get(`${type}::${name}`) };
    }),
  };
  return { meta, rows };
}

/**
 * Put a personalization overlay in the store the way the retired toolbar write
 * (`updateViewConfig`, objectui#12504) stored one: the body, with `object`,
 * `name` and the `_isOverride` marker stamped on it.
 */
function plantOverlay(rows: Map<string, any>, body: Record<string, unknown>) {
  rows.set(`view::${VIEW_ID}`, { ...body, object: OBJECT_NAME, name: VIEW_ID, _isOverride: true });
}

function makeAdapter(meta: any) {
  const ds: any = new ObjectStackAdapter({
    baseUrl: 'http://test.local',
    fetch: vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { capabilities: {}, routes: {} } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
  });
  ds.connected = true;
  ds.connectionState = 'connected';
  ds.client = { meta };
  return ds;
}

/** The object as `useMetadata().objects` serves it — a hollow ADR-0017
 * expansion item is what `InterfaceListPage` resolves as the source view: a
 * `list` entry the framework expanded for `VIEW_ID`, with an empty `columns`
 * (truthy, renders nothing — exactly the case `hasColumns` exists to catch). */
function makeObjectDef() {
  return {
    name: OBJECT_NAME,
    fields: {
      name: { type: 'text' },
      status: { type: 'select' },
    },
    listViews: {
      [VIEW_ID]: { name: VIEW_ID, type: 'grid', columns: [] },
    },
  };
}

const page = {
  name: 'crm_lead_list_page',
  label: 'Leads',
  // recordAction: 'none' keeps `useNavigationOverlay`'s `isOverlay` false so
  // `NavigationOverlay` never mounts — irrelevant to the hydration seam under
  // test, and mounting it would only add unrelated surface to the render.
  interfaceConfig: { source: OBJECT_NAME, sourceView: 'default', recordAction: 'none' },
};

describe('objectui#5773 — InterfaceListPage hollow view + personalization overlay hydration', () => {
  it('REACHABLE: a hollow system view + a thin post-#5233 overlay row hydrates to renderer DEFAULTS, not a hollow grid', async () => {
    const { meta, rows } = makeMetaStore();
    const ds = makeAdapter(meta);
    testDataSource = ds;
    testObjects = [makeObjectDef()];

    // The LAST shape the retired toolbar write stored for a toggle on this
    // system view (a density change): the patch alone plus the tab's
    // `viewKind`, no `columns` — objectui#5233's write half.
    plantOverlay(rows, { rowHeight: 'compact', viewKind: 'list' });

    // Confirms the row really is thin at rest — the premise this case
    // depends on, measured rather than assumed.
    const storedOverlay = (await ds.listViewOverrides(OBJECT_NAME))[VIEW_ID];
    expect(storedOverlay).toBeDefined();
    expect(storedOverlay).not.toHaveProperty('columns');
    expect(storedOverlay.rowHeight).toBe('compact');

    render(<InterfaceListPage page={page} />);

    // `defaultColumnsFromObject` over `makeObjectDef()`'s two business
    // fields — the renderer's own fallback, reached because neither the
    // hollow resolved view NOR the thin overlay it merges with carries a
    // `columns` key.
    await waitFor(() => {
      expect(screen.getByTestId('rendered-columns').textContent).toBe(
        JSON.stringify(['name', 'status']),
      );
    });
  });

  it('CONTROL: the same hollow view with a PRE-#5233 fat overlay row still renders the frozen stale columns (proves the pin discriminates old vs. new row shapes)', async () => {
    const { meta, rows } = makeMetaStore();
    const ds = makeAdapter(meta);
    testDataSource = ds;
    testObjects = [makeObjectDef()];

    // What `persistViewPatch` USED TO send before objectui#5233 — the whole
    // active tab (frozen at write time) plus the one changed key. An install
    // that has not touched this view since then is still carrying a row
    // shaped exactly like this one (`ObjectView.overlayPatchOnly.test.ts`'s
    // own "PRE-FIX" framing).
    plantOverlay(rows, {
      viewKind: 'list',
      type: 'grid',
      columns: ['status'],
      rowHeight: 'compact',
    });

    const storedOverlay = (await ds.listViewOverrides(OBJECT_NAME))[VIEW_ID];
    expect(storedOverlay.columns).toEqual(['status']);

    render(<InterfaceListPage page={page} />);

    // The frozen row's `columns` — NOT `defaultColumnsFromObject`'s
    // `['name', 'status']` — is what a pre-#5233 install would still be
    // rendering for this system view today. If this assertion and the
    // REACHABLE case above ever produced the SAME string, the pin above
    // would not be testing the hydration effect at all.
    await waitFor(() => {
      expect(screen.getByTestId('rendered-columns').textContent).toBe(
        JSON.stringify(['status']),
      );
    });
  });
});
