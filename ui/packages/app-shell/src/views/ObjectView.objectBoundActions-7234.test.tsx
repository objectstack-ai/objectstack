/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7234 — an object-declared action DOES reach the toolbar, and the
 * thing that hides it is the capability gate, not the relay.
 *
 * ## What the card predicted, and what was measured
 *
 * #7234 reports that an action declared on `objectDef.actions[]` with valid
 * `locations` renders at NO location, although the API serves the complete
 * declaration — and points at the relay, on the shape of objectui#7199 (a
 * per-view `description` served but never copied onto the ListView schema).
 * The `(objectDef as any)?.actions` cast at the `rowActionDefs` rung reads like
 * more of the same: a renderer casting its own object to reach a key.
 *
 * Measured on this tree, the relay is NOT the discard point. Case E below
 * answers the card's exact wire payload from the client the provider actually
 * calls (`meta.getItems('object')`) and walks it through `MetadataProvider`'s
 * own `objects` getter — `extractItems` → `normalizeSchemaReferenceKeys` →
 * `mergeViewsIntoObjects` → `attachInlineSubforms` — into this component's
 * props. The button is in the DOM at the end of it. No hand-built `objects`
 * array is involved in that case, which is what makes it evidence about the
 * chain rather than about the fixture.
 *
 * ## What actually hides it: ADR-0066 D4, `requiredPermissions`
 *
 * `action:bar` filters its own set through `useCapabilityGate` before
 * `actionRendersAt` ever runs, and so do the other two surfaces this card names
 * (`page:header` for `record_header` / `record_more`, the grid's row menu for
 * `list_item`) — one shared hook exactly so the three cannot drift apart. An
 * action declaring a capability the viewer does not hold is filtered out, at
 * every location at once, with no error and no 4xx. That is the reported
 * symptom, and it is this gate rather than a dropped key.
 *
 * The gate fails OPEN on unknown (`systemPermissions` absent → the action
 * shows) and CLOSED on a known array that lacks the capability — including the
 * empty array, which means "holds nothing", not "unknown". Cases F/G/H pin all
 * three readings, and F↔G are one differential: same payload, same code path,
 * only the held set differs.
 *
 * ⚠️ This file therefore pins CURRENT, DELIBERATE behaviour. It is not a fix
 * for #7234 and does not claim one.
 *
 * ## Ruled 2026-09-08, and case J is this file's half of the ruling
 *
 * Whether a declared-but-ungranted action should stay silently invisible was
 * the open question this file was written under. The maintainer ruled option
 * B: the hide STAYS for end users, and the reason becomes visible in an
 * author/admin channel that already exists — the action designer, pinned by
 * `capabilityGateChannel-7234.test.tsx`. Option C (drawing the action greyed
 * out with the missing capability named) was considered and REJECTED, because
 * it advertises to end users capabilities they do not have.
 *
 * ⇒ "No end-user change" is an acceptance criterion of that ruling, not a
 * side effect of it, so it gets a pin rather than a promise. Case J asserts the
 * end-user list surface still explains NOTHING in the gated state: an
 * implementer who lands the author-facing reason on a running app's list
 * surface turns it red. F establishes the button is gone; J establishes that
 * nothing took its place.
 *
 * ## Reverse verification — direction predicted before running
 *
 * Predicted, then observed (measurements recorded on the PR):
 *   • Deleting the `list_toolbar` gate's `objectDef.actions` read in
 *     `ObjectView.tsx` turns every presence case RED (A, D, E, G, I) and
 *     leaves every absence case GREEN (B, C, F, H) — an absence case asserts
 *     absence, which a deleted renderer supplies for the wrong reason. That
 *     asymmetry is why the presence cases carry the claim and the absence
 *     cases are only controls. Measured: 5 failed / 4 passed.
 *   • Making `useCapabilityGate` return `() => true` turns F and H RED and
 *     leaves every other case GREEN, which is what holds the two mechanisms
 *     apart: one ablation cannot redden both sets. Measured: 2 failed /
 *     7 passed.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/**
 * The capabilities the host reports for the signed-in principal, per case.
 * `undefined` is the "host never supplied them" reading the gate fails open on.
 */
let heldCapabilities: string[] | undefined;

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      systemPermissions: heldCapabilities,
      check: () => ({ allowed: true }),
      checkField: () => true,
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      isLoaded: true,
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
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

// Heavy children: orthogonal to the toolbar under test, and each drags in a
// plugin bundle. Same posture as the sibling predicate suites in this dir.
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: () => null,
}));
vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectView: () => null,
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
import { MetadataProvider, useMetadata } from '../providers/MetadataProvider';

const OBJECT_NAME = 'duly_catalog_item';

/**
 * The card's served payload, verbatim: one valid location, and NO `visible`
 * predicate — the reporter's sharpest case, since it removes the predicate
 * layer from the explanation entirely.
 */
const APPLY_TO_PEOPLE = {
  name: 'duly_catalog_apply_to_people',
  objectName: OBJECT_NAME,
  type: 'script',
  label: 'Apply to people',
  locations: ['list_toolbar'],
};

/** The same declaration as the app that found this ships it: capability-gated. */
const APPLY_TO_PEOPLE_GATED = {
  ...APPLY_TO_PEOPLE,
  requiredPermissions: ['duly.catalog.apply'],
};

function objectsWithActions(actions: unknown) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Catalog item',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
      },
      ...(actions === undefined ? {} : { actions }),
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

const USER = { id: 'u1', name: 'Ada', profile: 'admin' };

function renderList(objects: any[]) {
  return render(
    <ExpressionProvider user={USER}>
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
}

/** The reporter's URL shape — the object's named list view, not the bare list. */
function renderListAtView(objects: any[]) {
  return render(
    <ExpressionProvider user={USER}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/view/list`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/view/:viewId"
            element={<ObjectView dataSource={makeDataSource()} objects={objects} onEdit={() => {}} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
}

const toolbarButton = () => screen.queryByRole('button', { name: /Apply to people/ });

/** Absence is only meaningful after the render has had a chance to settle. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

describe('objectui#7234 — object-declared actions reach the list toolbar', () => {
  beforeEach(() => {
    heldCapabilities = undefined;
    vi.clearAllMocks();
  });
  afterEach(() => cleanup());

  it('A: draws the button when the objectDef carries the action', async () => {
    renderList(objectsWithActions([APPLY_TO_PEOPLE]));
    await waitFor(() => expect(toolbarButton()).toBeTruthy());
  });

  it('B (control): nothing is drawn when the object declares no actions', async () => {
    renderList(objectsWithActions(undefined));
    await settle();
    expect(toolbarButton()).toBeNull();
  });

  it('C (control): the same action at record_header only is not on this toolbar', async () => {
    renderList(objectsWithActions([{ ...APPLY_TO_PEOPLE, locations: ['record_header'] }]));
    await settle();
    expect(toolbarButton()).toBeNull();
  });

  it('D: draws it on the /view/:viewId route with a declared list view', async () => {
    const objects = objectsWithActions([APPLY_TO_PEOPLE]);
    (objects[0] as any).listViews = {
      list: { name: 'list', label: 'All items', type: 'grid', columns: ['name'] },
    };
    renderListAtView(objects);
    await waitFor(() => expect(toolbarButton()).toBeTruthy());
  });

  it('E: END TO END — the served /meta/object payload reaches the DOM', async () => {
    // The client the provider actually calls, answering the card's payload.
    // Nothing here hand-builds the `objects` array: it is whatever
    // MetadataProvider's own getter produces from this response.
    const adapter = {
      clearCache: vi.fn(),
      // objectui#13044 — the real MetadataProvider reads an object by name through
      // the adapter's `getObjectSchema`; this double answers it from its own by-name door.
      getObjectSchema(this: { getClient(): any }, name: string) {
        return this.getClient()
          .meta.getItem('object', name)
          .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
      },
      getClient: () => ({
        meta: {
          getItems: (type: string) =>
            Promise.resolve({
              type,
              items:
                type === 'object'
                  ? [
                      {
                        name: OBJECT_NAME,
                        label: 'Catalog item',
                        fields: { id: { type: 'text' }, name: { type: 'text' } },
                        actions: [APPLY_TO_PEOPLE],
                      },
                    ]
                  : [],
            }),
          getItem: () => Promise.resolve({ item: null }),
        },
      }),
    } as any;

    function Host() {
      const { objects } = useMetadata();
      if (!objects.length) return null;
      return <ObjectView dataSource={makeDataSource()} objects={objects} onEdit={() => {}} />;
    }

    render(
      <MetadataProvider adapter={adapter}>
        <ExpressionProvider user={USER}>
          <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}`]}>
            <Routes>
              <Route path="/apps/:appName/:objectName" element={<Host />} />
            </Routes>
          </MemoryRouter>
        </ExpressionProvider>
      </MetadataProvider>,
    );

    await waitFor(() => expect(toolbarButton()).toBeTruthy(), { timeout: 3000 });
  });

  // ── ADR-0066 D4: the gate that actually hides the app's actions ──────────
  //
  // F and G are ONE differential: identical payload, identical code path, only
  // the held capability set differs. That is what identifies the gate as the
  // cause rather than as a coincidence of the fixture.

  it('F: a gated action is hidden from a viewer holding a different capability', async () => {
    heldCapabilities = ['duly.task.update_status'];
    renderList(objectsWithActions([APPLY_TO_PEOPLE_GATED]));
    await settle();
    expect(toolbarButton()).toBeNull();
  });

  it('G: the SAME payload is drawn once the viewer holds that capability', async () => {
    heldCapabilities = ['duly.catalog.apply'];
    renderList(objectsWithActions([APPLY_TO_PEOPLE_GATED]));
    await waitFor(() => expect(toolbarButton()).toBeTruthy());
  });

  it('H: an empty held set is "holds nothing", not "unknown" — still hidden', async () => {
    heldCapabilities = [];
    renderList(objectsWithActions([APPLY_TO_PEOPLE_GATED]));
    await settle();
    expect(toolbarButton()).toBeNull();
  });

  it('I: unknown held set fails OPEN — the gated action is drawn', async () => {
    heldCapabilities = undefined;
    renderList(objectsWithActions([APPLY_TO_PEOPLE_GATED]));
    await waitFor(() => expect(toolbarButton()).toBeTruthy());
  });

  // ── Ruling part (a): the end user is told nothing, and stays told nothing ──

  it('J: the hidden state explains NOTHING on the end-user surface', async () => {
    // Case F's exact setup — the gate closed on a capability this viewer lacks.
    heldCapabilities = ['duly.task.update_status'];
    const { container } = renderList(objectsWithActions([APPLY_TO_PEOPLE_GATED]));
    await settle();

    expect(toolbarButton()).toBeNull();

    // Paired positive: the list surface itself DID render. Without it an empty
    // tree would satisfy every negative below for the wrong reason — the same
    // asymmetry this file's ablation note states for cases B / C / F / H.
    expect(screen.getByText('Catalog item')).toBeTruthy();

    // Nothing names the capability, and no notice stands in for the button.
    // Asserted over the whole rendered tree rather than one node, because the
    // route this must refuse is "surface it somewhere in the running app",
    // which does not commit to a location in advance.
    const rendered = container.textContent ?? '';
    expect(rendered).not.toContain('duly.catalog.apply');
    expect(rendered).not.toMatch(/capabilit/i);
    expect(rendered).not.toMatch(/requiredPermissions/i);
    expect(rendered).not.toMatch(/permission/i);
  });
});
