/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * [#5142] The object-list toolbar's Import button and `userActions.import`.
 *
 * `@objectstack/spec@17.0.0` widened BOTH toolbar-scope keys, not just
 * `create`: `userActions.create` and `userActions.import` are typed
 * identically (`z.union([z.boolean(), RowCrudActionOverrideSchema])`) and
 * `resolveCrudAffordances` emits a predicate envelope for each. objectui#4646
 * gave `createPredicates` a consumer (the related-list toolbar); `importPredicates`
 * had ZERO consumers in objectui src, so an author could write
 * `userActions.import.visibleWhen`, have the spec accept it and the resolver
 * parse it, and watch this toolbar offer the CSV wizard unconditionally.
 *
 * BINDING under test is the spec docblock's: a toolbar predicate evaluates ONCE
 * per toolbar against the record of the scope the toolbar sits in — and a
 * STANDALONE object list (this surface) has no record in scope. That is not a
 * gap in this test's setup, it is the documented binding: "On a standalone
 * object list there is no record in scope, so a predicate reading `record.*`
 * has nothing to bind and — per the fail-closed rule above — hides the button."
 * Both halves are pinned below: the scope-bound predicates (`os.user.*` and
 * plain constants) that are the meaningful shape here, and the `record.*` one
 * that fails closed.
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed;
 * see the PR body. Restoring the pre-change gate
 * (`affordances.import && can(objectDef.name, 'create')` with no predicate
 * layer and no `disabled`) turns the `visibleWhen` and `disabledWhen` cases
 * RED — the button renders, enabled, in all of them — while the boolean-arm,
 * no-predicate and permission-gate cases stay GREEN in both worlds: they never
 * reach the predicate layer, which is exactly what makes them the controls.
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

/** Controllable principal verdict, keyed by action (`can()` is permissive by default). */
let principal: Record<string, boolean> = {};

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

// Heavy children: orthogonal to the toolbar gate under test, and each drags in
// a plugin bundle. Same posture as the sibling RecordDetailView render tests.
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

const OBJECT_NAME = 'showcase_invoice';

/** The signed-in principal the host shell publishes into the predicate scope. */
const USER = { id: 'u1', name: 'Ada', profile: 'admin' };

/**
 * Predicates over the toolbar's SCOPE (`os.user.*`) — the meaningful shape on a
 * standalone list, where there is no record to bind. Same aliases the real
 * `ExpressionProvider` publishes, so these are authored exactly as they would
 * be in served metadata.
 */
const SCOPE_TRUE = "os.user.profile == 'admin'";
const SCOPE_FALSE = "os.user.profile == 'guest'";
/** A predicate over `record.*` — nothing to bind here, per the spec binding. */
const RECORD_BOUND = 'record.frozen != true';

/** An object whose `userActions.import` carries the given override. */
function objectsWith(importOverride: unknown) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Invoice',
      managedBy: 'platform',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
      },
      userActions: importOverride === undefined ? undefined : { import: importOverride },
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

const importButton = () =>
  document.querySelector('[data-testid="object-view-import-button"]') as HTMLButtonElement | null;

beforeEach(() => {
  principal = {};
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

describe('#5142 — the object-list toolbar honours `userActions.import` predicates', () => {
  it('renders Import for the plain boolean arm of the union (no regression)', () => {
    renderList(objectsWith(true));
    expect(importButton()).toBeTruthy();
    expect(importButton()!.disabled).toBe(false);
  });

  it('renders Import when the object declares no `userActions` at all', () => {
    // `platform` is the only bucket granting import by default — the pre-change
    // behaviour, unchanged: with no predicates there is nothing to evaluate.
    renderList(objectsWith(undefined));
    expect(importButton()).toBeTruthy();
    expect(importButton()!.disabled).toBe(false);
  });

  it('renders Import when the object form declares `enabled` but no predicates', () => {
    renderList(objectsWith({ enabled: true }));
    expect(importButton()).toBeTruthy();
    expect(importButton()!.disabled).toBe(false);
  });

  it('HIDES Import when `visibleWhen` evaluates false', () => {
    renderList(objectsWith({ enabled: true, visibleWhen: SCOPE_FALSE }));
    expect(importButton()).toBeNull();
  });

  it('keeps Import when `visibleWhen` evaluates true', () => {
    renderList(objectsWith({ enabled: true, visibleWhen: SCOPE_TRUE }));
    expect(importButton()).toBeTruthy();
  });

  it('GREYS Import (renders, disabled) when `disabledWhen` holds — hidden and disabled stay distinct', () => {
    renderList(objectsWith({ enabled: true, disabledWhen: SCOPE_TRUE }));
    const btn = importButton();
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(true);
  });

  it('leaves Import enabled when `disabledWhen` does not hold', () => {
    renderList(objectsWith({ enabled: true, disabledWhen: SCOPE_FALSE }));
    expect(importButton()).toBeTruthy();
    expect(importButton()!.disabled).toBe(false);
  });

  it('fails CLOSED on a `visibleWhen` that cannot bind — the standalone list has no record in scope', () => {
    // Not a defect of this harness: the spec binds a toolbar predicate to the
    // record of the scope the toolbar sits in, and says in as many words that a
    // standalone object list has none, so a `record.*` read hides the button.
    renderList(objectsWith({ enabled: true, visibleWhen: RECORD_BOUND }));
    expect(importButton()).toBeNull();
  });

  it('fails SOFT on a `disabledWhen` that cannot bind — an unevaluable predicate never greys forever', () => {
    renderList(objectsWith({ enabled: true, disabledWhen: RECORD_BOUND }));
    const btn = importButton();
    expect(btn).toBeTruthy();
    expect(btn!.disabled).toBe(false);
  });

  it('treats `disabledWhen: ""` as "no condition", not as "disable"', () => {
    renderList(objectsWith({ enabled: true, disabledWhen: '' }));
    expect(importButton()).toBeTruthy();
    expect(importButton()!.disabled).toBe(false);
  });

  it('honours the object-level opt-out — `import: false` hides it, predicates or not', () => {
    renderList(objectsWith({ enabled: false, visibleWhen: SCOPE_TRUE }));
    expect(importButton()).toBeNull();
  });

  it('a passing predicate cannot RE-OPEN what the principal closed (#4096 layering)', () => {
    // The permission gate objectui#4647 fixed and the predicate layer stack;
    // neither short-circuits the other. `visibleWhen` is true here, so if the
    // layer order were inverted the button would come back.
    principal = { create: false };
    renderList(objectsWith({ enabled: true, visibleWhen: SCOPE_TRUE }));
    expect(importButton()).toBeNull();
  });

  it('the permission gate still hides Import with no predicates declared', () => {
    principal = { create: false };
    renderList(objectsWith(true));
    expect(importButton()).toBeNull();
  });

  it('a non-platform bucket that never opted in shows no Import, predicates or not', () => {
    // `config` makes import opt-in; the predicate must not resurrect it.
    renderList([
      {
        name: OBJECT_NAME,
        label: 'Invoice',
        managedBy: 'config',
        fields: { id: { type: 'text' }, name: { type: 'text' } },
        userActions: { import: { visibleWhen: SCOPE_TRUE } },
      },
    ]);
    expect(importButton()).toBeNull();
  });
});
