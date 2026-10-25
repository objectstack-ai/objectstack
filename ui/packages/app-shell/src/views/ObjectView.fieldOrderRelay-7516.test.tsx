/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7516 — the object page relays a per-view `fieldOrder`.
 *
 * ## The defect this pins
 *
 * `renderListView` builds `fullSchema` by spreading the host's `listSchema`
 * and then relaying keys off the active `viewDef`. `hiddenFields` had a rung;
 * `fieldOrder`, the other per-view half of the same field composition, had
 * NONE. So `schema.fieldOrder` at the `ListView` end could only ever be what
 * the host put on the list schema, and a per-view order was unreachable —
 * declared by the protocol, accepted and served, then dropped here. The
 * relay-rung census (`ObjectView.relayRungCensus-7559.test.ts`) carried it as a
 * `known-gap` until this card.
 *
 * ## What the rung carries, and what it does not decide
 *
 * objectstack#15184 ruling B kept `fieldOrder` and wrote the composition into
 * the contract: `columns` projects, `hiddenFields` subtracts from the
 * projection, `fieldOrder` sorts what survives (a surviving column it does not
 * list sorts last, keeping its `columns`-relative order). `ListView`'s
 * `effectiveFields` memo already runs those steps in that order on whatever
 * `schema.fieldOrder` it receives. The rung therefore only DELIVERS the view's
 * value into that slot — the same slot the list-node spelling fills — so the
 * two spellings compose identically by construction. Where both are present,
 * the view wins, the precedence the `hiddenFields` rung beside it uses.
 *
 * ## The value DOES arrive here — the relay is where it died
 *
 * `buildViewTabs` composes each entry through `viewEntry`, which is
 * `Object.assign` over the authored body and stamps only `id` afterwards, so an
 * authored `fieldOrder` is present on `viewDef`. The in-tree host
 * (`plugin-view`'s `ObjectView`) fills its own `fieldOrder` slot from a NAMED
 * list view only, and this page hands it no `listViews`, so on this route the
 * spread carries nothing for the key.
 *
 * ## Why the schema is captured rather than rendered
 *
 * The claim is about what THIS file hands down, so `ListView` is stubbed and
 * its `schema` prop recorded — the same posture as
 * `ObjectView.rowColorRelay-7218.test.tsx`. How the captured order then sorts
 * the columns is `plugin-list`'s half, and is not re-pinned here.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      check: () => ({ allowed: true }),
      checkField: () => true,
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      isLoaded: false,
      hasCapabilities: () => true,
      can: () => true,
      cannot: () => false,
    }),
    useFieldPermissions: () => ({ canRead: () => true, canWrite: () => true, permissions: [] }),
  };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1', name: 'Ada' }, activeOrganization: null }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/collaboration', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRealtimeSubscription: () => ({ lastMessage: null }),
  useConflictResolution: () => ({ hasConflicts: false, resolveAllConflicts: () => {} }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(), error: vi.fn(), info: vi.fn(),
    warning: vi.fn(), loading: vi.fn(), dismiss: vi.fn(),
  }),
}));

/** The list schema this page hands down — captured, not rendered. */
let captured: any = null;
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: (props: any) => {
    captured = props.schema;
    return null;
  },
}));

/**
 * What the HOST puts on the list schema before this page's relay runs — the
 * `listSchema` the `...listSchema` spread carries in. It stands in for the
 * list-node spelling (the in-tree host fills it from a named list view), and
 * it is the only way to exercise the rung's second limb from here.
 */
let hostList: Record<string, unknown> = {};

vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectView: (props: any) =>
    props.renderListView?.({
      schema: { ...(props.schema ?? {}), ...hostList },
      dataSource: props.dataSource,
      onEdit: props.onEdit,
      className: '',
      refreshKey: 0,
    }) ?? null,
  ViewTabBar: () => null,
  ManageViewsDialog: () => null,
}));

vi.mock('./MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false, toggle: () => {} }),
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));

import { ObjectView } from './ObjectView';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'duly_task';

/** The per-view order — the value this card is about. */
const VIEW_FIELD_ORDER = ['stage', 'name'];
/** A list-node one. Distinct so a crossed wire fails instead of passing. */
const LIST_FIELD_ORDER = ['owner', 'stage', 'name'];

function objectsWith(view: Record<string, unknown>) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Task',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        stage: { type: 'text', label: 'Stage' },
        owner: { type: 'text', label: 'Owner' },
      },
      listViews: {
        by_stage: { label: 'By stage', type: 'grid', columns: ['name', 'stage', 'owner'], ...view },
      },
    },
  ];
}

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: [], total: 0 })),
    findOne: vi.fn(async () => null),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
  } as any;
}

/** Render the object list and return the whole schema the relay handed down. */
async function relayed(objects: any[]): Promise<any> {
  captured = null;
  render(
    <ExpressionProvider user={{ id: 'u1', name: 'Ada', profile: 'admin' }}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName"
            element={<ObjectView dataSource={makeDataSource()} objects={objects} onEdit={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
  // `options` is built unconditionally by the same object literal as the rung
  // under test, so its arrival is the signal that the relay actually ran —
  // waiting on `fieldOrder` itself would hang rather than fail on a regression.
  await waitFor(() => {
    expect(captured?.options).toBeTruthy();
  });
  return captured;
}

beforeEach(() => {
  cleanup();
  captured = null;
  hostList = {};
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
  vi.clearAllMocks();
});

describe("ObjectView relays the active view's own fieldOrder (objectui#7516)", () => {
  it('THE FIX: a per-view `fieldOrder` reaches the renderer, verbatim', async () => {
    // Before the rung existed this was `undefined` for every object on this
    // route, which is the whole of the defect. Verbatim, because the order IS
    // the value: the relay sorts nothing and filters nothing — composing it
    // with `columns` and `hiddenFields` is `ListView`'s job.
    const schema = await relayed(objectsWith({ fieldOrder: VIEW_FIELD_ORDER }));
    expect(schema.fieldOrder).toEqual(VIEW_FIELD_ORDER);
  });

  it('THE FIX: the per-view value OVERRIDES a list-node `fieldOrder`', async () => {
    hostList = { fieldOrder: LIST_FIELD_ORDER };
    const schema = await relayed(objectsWith({ fieldOrder: VIEW_FIELD_ORDER }));
    expect(schema.fieldOrder).toEqual(VIEW_FIELD_ORDER);
  });

  it('THE FIX: `fieldOrder` resolves by the same precedence as the `hiddenFields` rung beside it', async () => {
    // The two per-view halves of one composition. Both are supplied by the
    // list node AND by the view; both must come from the view, or `ListView`
    // would sort the view's subtraction by the list node's order.
    hostList = { hiddenFields: ['owner'], fieldOrder: LIST_FIELD_ORDER };
    const schema = await relayed(
      objectsWith({ hiddenFields: ['name'], fieldOrder: VIEW_FIELD_ORDER }),
    );
    expect(schema.hiddenFields).toEqual(['name']);
    expect(schema.fieldOrder).toEqual(VIEW_FIELD_ORDER);
  });

  it("CONTROL: the list node's own `fieldOrder` is unchanged when the view authors none", async () => {
    // The rung is a fallback, not a replacement: a fix that stomped the
    // incoming value with `undefined` fails here.
    hostList = { fieldOrder: LIST_FIELD_ORDER };
    const schema = await relayed(objectsWith({}));
    expect(schema.fieldOrder).toEqual(LIST_FIELD_ORDER);
  });

  it('CONTROL: no `fieldOrder` anywhere stays absent', async () => {
    const schema = await relayed(objectsWith({}));
    expect(schema.fieldOrder).toBeUndefined();
  });
});
