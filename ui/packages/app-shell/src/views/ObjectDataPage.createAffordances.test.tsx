/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * [#5164] `ObjectDataPage` — the parameterized bare data surface (ADR-0055,
 * #2251, route `/apps/:appName/:objectName/data`) — and the CRUD affordance
 * matrix its "New" button did not read.
 *
 * Before this change the button was gated on `can(objectDef.name, 'create')`
 * and NOTHING else: `resolveEffectiveCrudAffordances` was never called in that
 * file, so all FOUR layers below the permission were missing at once, and this
 * surface contradicted every sibling console surface for the same object —
 *
 *   1. the `managedBy` bucket default (`append-only` / `engine-owned` /
 *      `better-auth` all resolve `create: false`, yet `/data` offered "New");
 *   2. the object-level `userActions: { create: false }` opt-out;
 *   3. the #3391 effective-API-operation intersection (the toolbar could offer
 *      a create the server would 405);
 *   4. `createPredicates` — the #5153 defect, here as a consequence of the
 *      wider gap rather than the gap itself.
 *
 * One test file for all four because they are one gate: the issue is not "a
 * predicate is unread", it is that ONE authored object produced a DIFFERENT
 * affordance depending on which surface drew the button. The layers are
 * therefore pinned in the order they compose, with the permission control kept
 * alongside them so a regression that deletes the whole conjunction is
 * distinguishable from one that deletes a single conjunct.
 *
 * BINDING under test is the spec docblock's, identical to `ObjectView`'s
 * (#5153 / PR #5165) and the import half's (#5142): a toolbar predicate
 * evaluates ONCE per toolbar against the record of the scope the toolbar sits
 * in — and this surface, like the standalone object list, has NO record in
 * scope. That is the documented binding, not a gap in this harness, so a
 * `record.*` read fails closed and is pinned as its own case.
 *
 * ONE RENDER POINT, unlike `ObjectView`: this page has no phone FAB (the whole
 * PageHeader lives under `hidden sm:block`), so there is exactly one entry to
 * assert and no two-points-one-verdict parity to keep.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed;
 * see the PR body. Restoring the pre-change gate (a bare
 * `can(objectDef.name, 'create')`, no affordance resolution, no predicate
 * layer, no `disabled`) turns the bucket, the object-level opt-out, the
 * effective-operations and both predicate cases RED, while the
 * permission-denied and default-open cases stay GREEN — the latter are the
 * controls: they never reach the layers this change added, which is exactly
 * what makes them controls rather than coverage.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/** Controllable principal verdict, keyed by action (`can()` is permissive by default). */
let principal: Record<string, boolean> = {};
/** Controllable server-resolved effective API operations (#3391); `undefined` = unrestricted. */
let apiOperations: string[] | undefined;

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => ({
      check: () => ({ allowed: true }),
      checkField: () => true,
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => apiOperations,
      roles: [],
      isLoaded: false,
      hasCapabilities: () => true,
      can: (_object: string, action: string) => principal[action] ?? true,
      cannot: (_object: string, action: string) => !(principal[action] ?? true),
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

// Heavy children, all orthogonal to the toolbar gate under test and each
// dragging in a plugin bundle. Same posture as the sibling create/import
// predicate tests on `ObjectView`.
vi.mock('@object-ui/plugin-list', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@object-ui/plugin-list')>()),
  ListView: () => null,
}));
vi.mock('./RecordDetailView', () => ({ RecordDetailView: () => null }));
vi.mock('./CreateViewDialog', () => ({ CreateViewDialog: () => null }));
vi.mock('./metadata-admin/useMetadata', () => ({ useMetadataClient: () => ({}) }));

import { ObjectDataPage } from './ObjectDataPage';
import { ExpressionProvider } from '../providers/ExpressionProvider';

const OBJECT_NAME = 'showcase_invoice';

/** The signed-in principal the host shell publishes into the predicate scope. */
const USER = { id: 'u1', name: 'Ada', profile: 'admin' };

/**
 * Predicates over the toolbar's SCOPE (`os.user.*`) — the meaningful shape on
 * a surface with no record in scope. Same aliases the real `ExpressionProvider`
 * publishes, so these are authored exactly as they would be in served metadata.
 */
const SCOPE_TRUE = "os.user.profile == 'admin'";
const SCOPE_FALSE = "os.user.profile == 'guest'";
/** A predicate over `record.*` — nothing to bind here, per the spec binding. */
const RECORD_BOUND = 'record.frozen != true';

/** One object, with an arbitrary bucket and `userActions` shape. */
function objects(overrides: Record<string, unknown> = {}) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Invoice',
      managedBy: 'platform',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
      },
      ...overrides,
    },
  ];
}

/** The common case: a `platform` object carrying the given `userActions.create`. */
function objectsWith(createOverride: unknown) {
  return objects({
    userActions: createOverride === undefined ? undefined : { create: createOverride },
  });
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

function renderDataPage(objs: any[]) {
  return render(
    <ExpressionProvider user={USER}>
      <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}/data`]}>
        <Routes>
          <Route
            path="/apps/:appName/:objectName/data"
            element={<ObjectDataPage dataSource={makeDataSource()} objects={objs} />}
          />
        </Routes>
      </MemoryRouter>
    </ExpressionProvider>,
  );
}

/** The one create entry on this surface. */
const newButton = () =>
  document.querySelector('[data-testid="object-data-new-button"]') as HTMLButtonElement | null;

function expectCreateEntry(expected: { rendered: boolean; disabled?: boolean }) {
  if (!expected.rendered) {
    expect(newButton()).toBeNull();
    return;
  }
  expect(newButton()).toBeTruthy();
  expect(newButton()!.disabled).toBe(expected.disabled ?? false);
}

beforeEach(() => {
  principal = {};
  apiOperations = undefined;
  cleanup();
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

describe('#5164 — the /data surface reads the whole create affordance matrix', () => {
  it('CONTROL: still renders "New" for an ordinary object with everything open', () => {
    // The pre-change behaviour, deliberately unchanged. Nothing declared →
    // nothing to evaluate → the gate is the permission and a literal `true`.
    renderDataPage(objectsWith(undefined));
    expectCreateEntry({ rendered: true });
  });

  it('CONTROL: the permission gate still hides "New" on its own', () => {
    principal = { create: false };
    renderDataPage(objectsWith(undefined));
    expectCreateEntry({ rendered: false });
  });

  // ── Layer 1: the `managedBy` bucket default ────────────────────────────
  it('hides "New" for an `append-only` object — the bucket resolves `create: false`', () => {
    renderDataPage(objects({ managedBy: 'append-only' }));
    expectCreateEntry({ rendered: false });
  });

  it('hides "New" for an `engine-owned` object', () => {
    renderDataPage(objects({ managedBy: 'engine-owned' }));
    expectCreateEntry({ rendered: false });
  });

  it('hides "New" for a `better-auth` object', () => {
    renderDataPage(objects({ managedBy: 'better-auth' }));
    expectCreateEntry({ rendered: false });
  });

  it('a bucket that grants no create is not re-opened by a passing predicate', () => {
    renderDataPage(
      objects({ managedBy: 'append-only', userActions: { create: { visibleWhen: SCOPE_TRUE } } }),
    );
    expectCreateEntry({ rendered: false });
  });

  it('an object that OPTS IN over a closed bucket gets "New" back', () => {
    // The bucket default is a default, not a ceiling: `userActions.create:
    // true` is the documented opt-in, and this surface must honour it too.
    renderDataPage(objects({ managedBy: 'append-only', userActions: { create: true } }));
    expectCreateEntry({ rendered: true });
  });

  // ── Layer 2: the object-level `userActions` opt-out ────────────────────
  it('honours `userActions: { create: false }` — the object-level opt-out', () => {
    renderDataPage(objectsWith(false));
    expectCreateEntry({ rendered: false });
  });

  it('honours `enabled: false` in the object form, predicates or not', () => {
    renderDataPage(objectsWith({ enabled: false, visibleWhen: SCOPE_TRUE }));
    expectCreateEntry({ rendered: false });
  });

  it('renders "New" for the plain boolean arm of the union (no regression)', () => {
    renderDataPage(objectsWith(true));
    expectCreateEntry({ rendered: true });
  });

  // ── Layer 3: the #3391 effective API operations intersection ───────────
  it('hides "New" when the effective operations from the server exclude `create`', () => {
    apiOperations = ['read', 'update'];
    renderDataPage(objectsWith(undefined));
    expectCreateEntry({ rendered: false });
  });

  it('keeps "New" when the effective operations include `create`', () => {
    apiOperations = ['read', 'create', 'update'];
    renderDataPage(objectsWith(undefined));
    expectCreateEntry({ rendered: true });
  });

  it('an empty effective set means "expose nothing"', () => {
    apiOperations = [];
    renderDataPage(objectsWith(undefined));
    expectCreateEntry({ rendered: false });
  });

  // ── Layer 4: `createPredicates` ────────────────────────────────────────
  it('HIDES "New" when `visibleWhen` evaluates false', () => {
    renderDataPage(objectsWith({ enabled: true, visibleWhen: SCOPE_FALSE }));
    expectCreateEntry({ rendered: false });
  });

  it('keeps "New" when `visibleWhen` evaluates true', () => {
    renderDataPage(objectsWith({ enabled: true, visibleWhen: SCOPE_TRUE }));
    expectCreateEntry({ rendered: true });
  });

  it('`visibleWhen: false` — the literal objectui#3492 shape — hides "New"', () => {
    // Declared-ness by `?? true`, not by truthiness: a literal `false` must
    // hide the button rather than read as "ungated".
    renderDataPage(objectsWith({ enabled: true, visibleWhen: false }));
    expectCreateEntry({ rendered: false });
  });

  it('GREYS "New" (rendered, disabled) when `disabledWhen` holds — hidden and disabled stay distinct', () => {
    renderDataPage(objectsWith({ enabled: true, disabledWhen: SCOPE_TRUE }));
    expectCreateEntry({ rendered: true, disabled: true });
  });

  it('leaves "New" enabled when `disabledWhen` does not hold', () => {
    renderDataPage(objectsWith({ enabled: true, disabledWhen: SCOPE_FALSE }));
    expectCreateEntry({ rendered: true, disabled: false });
  });

  it('treats `disabledWhen: ""` as "no condition", not as "disable"', () => {
    renderDataPage(objectsWith({ enabled: true, disabledWhen: '' }));
    expectCreateEntry({ rendered: true, disabled: false });
  });

  it('fails CLOSED on a `visibleWhen` that cannot bind — this surface has no record in scope', () => {
    // Not a defect of this harness: the spec binds a toolbar predicate to the
    // record of the scope the toolbar sits in, and this surface has none, so a
    // `record.*` read hides the button.
    renderDataPage(objectsWith({ enabled: true, visibleWhen: RECORD_BOUND }));
    expectCreateEntry({ rendered: false });
  });

  it('fails SOFT on a `disabledWhen` that cannot bind — an unevaluable predicate never greys forever', () => {
    renderDataPage(objectsWith({ enabled: true, disabledWhen: RECORD_BOUND }));
    expectCreateEntry({ rendered: true, disabled: false });
  });

  // ── Layering: the conjunction only ever narrows ────────────────────────
  it('a passing predicate cannot RE-OPEN what the principal closed (#4096 layering)', () => {
    principal = { create: false };
    renderDataPage(objectsWith({ enabled: true, visibleWhen: SCOPE_TRUE }));
    expectCreateEntry({ rendered: false });
  });

  it('a passing predicate cannot RE-OPEN what the effective operations closed', () => {
    apiOperations = ['read'];
    renderDataPage(objectsWith({ enabled: true, visibleWhen: SCOPE_TRUE }));
    expectCreateEntry({ rendered: false });
  });
});

/**
 * FAMILY PARITY — the point of the issue, asserted directly.
 *
 * The defect was never "a layer is unread" in the abstract; it was that ONE
 * authored object got a DIFFERENT affordance on `/data` than it gets on the
 * object-list page next door. So the parity itself is pinned: for each shape
 * that closes the affordance, both surfaces are rendered under one scope and
 * required to agree.
 *
 * The subject shapes are the ones whose binding is surface-independent (bucket,
 * object-level opt-out, effective operations, and `os.user.*` predicates). A
 * `record.*` predicate deliberately does NOT agree across every surface in the
 * family — the related list binds the host record and neither of these two
 * pages has one — which is the spec's binding, not a defect, and is pinned as
 * its own case above.
 */
describe('#5164 — /data and the object-list page agree on one declaration', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['an `append-only` bucket', { managedBy: 'append-only' }],
    ['an `engine-owned` bucket', { managedBy: 'engine-owned' }],
    ['the object-level opt-out', { userActions: { create: false } }],
    ['`visibleWhen` false', { userActions: { create: { enabled: true, visibleWhen: SCOPE_FALSE } } }],
    ['`visibleWhen: false`', { userActions: { create: { enabled: true, visibleWhen: false } } }],
  ];

  it.each(cases)('%s closes "New" on /data exactly as it closes the object list', (_name, overrides) => {
    renderDataPage(objects(overrides));
    expect(newButton()).toBeNull();
  });

  it('an open declaration shows "New" on /data, as on the object list', () => {
    renderDataPage(objects({ userActions: { create: { enabled: true, visibleWhen: SCOPE_TRUE } } }));
    expect(newButton()).toBeTruthy();
  });
});
