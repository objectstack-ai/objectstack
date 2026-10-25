/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * [#5153] The object-list page's "New" button, its phone-only floating "+",
 * and `userActions.create`.
 *
 * `createPredicates` had exactly ONE consumer in objectui before this change:
 * `RelatedRecordActionsBridge` (objectui#4646, PR #5145), which closed the
 * **related-list** toolbar. The standalone object-list page renders the same
 * affordance twice — a PageHeader button and the phone FAB that stands in for
 * it once the header is hidden — and neither read the key: both gated on
 * `affordances.create && can(objectDef.name, 'create')`, the object-level
 * verdict alone. One `userActions.create` object form therefore got two
 * different verdicts depending on which surface rendered the button, and
 * `visibleWhen: false` (the objectui#3492 shape) did not hide this "New".
 *
 * BINDING under test is the spec docblock's, identical to the import half
 * (#5142) landed in this same file: a toolbar predicate evaluates ONCE per
 * toolbar against the record of the scope the toolbar sits in — and a
 * STANDALONE object list (this surface) has no record in scope. That is not a
 * gap in this harness, it is the documented binding: "On a standalone object
 * list there is no record in scope, so a predicate reading `record.*` has
 * nothing to bind and — per the fail-closed rule above — hides the button."
 * Both halves are pinned below: the scope-bound predicates (`os.user.*`) that
 * are the meaningful shape here, and the `record.*` one that fails closed.
 *
 * TWO RENDER POINTS. Every case asserts BOTH entry points, because they are
 * one affordance rendered twice: a phone user and a desktop user must not get
 * different answers for one declaration. (`sm:hidden` / `hidden sm:block` are
 * CSS-only, so both are in the DOM here and each is asserted directly.)
 *
 * REVERSE VERIFICATION — direction predicted before running, then observed;
 * see the PR body. Restoring the pre-change gate at EITHER render point (the
 * bare `affordances.create && can(...)` conjunction, no predicate layer and no
 * `disabled`) turns that point's `visibleWhen` / `disabledWhen` cases RED while
 * the OTHER point's stay green — which is what makes the two entries
 * separately observable rather than one assertion counted twice. The
 * boolean-arm, no-predicate, bucket and permission cases stay GREEN in both
 * worlds: they never reach the predicate layer, which is exactly what makes
 * them the controls.
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
// a plugin bundle. Same posture as the sibling import-predicate test.
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
import { RelatedRecordActionsBridge } from './RelatedRecordActionsBridge';
import { useRelatedRecordActions } from '@object-ui/react';
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

/** An object whose `userActions.create` carries the given override. */
function objectsWith(createOverride: unknown) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Invoice',
      managedBy: 'platform',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
      },
      userActions: createOverride === undefined ? undefined : { create: createOverride },
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

/** The PageHeader "New" (desktop). */
const newButton = () =>
  document.querySelector('[data-testid="object-view-new-button"]') as HTMLButtonElement | null;
/** Its phone-only floating counterpart. */
const fab = () =>
  document.querySelector('[data-testid="mobile-fab-create"]') as HTMLButtonElement | null;

/**
 * Both render points at once. They are one affordance, so every case states the
 * expected verdict once and this asserts it against each entry separately —
 * a regression at either point fails here, naming which one.
 */
function expectBothCreateEntries(expected: { rendered: boolean; disabled?: boolean }) {
  if (!expected.rendered) {
    expect(newButton()).toBeNull();
    expect(fab()).toBeNull();
    return;
  }
  expect(newButton()).toBeTruthy();
  expect(fab()).toBeTruthy();
  expect(newButton()!.disabled).toBe(expected.disabled ?? false);
  expect(fab()!.disabled).toBe(expected.disabled ?? false);
}

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

describe('#5153 — the object-list page honours `userActions.create` predicates', () => {
  it('renders New + FAB for the plain boolean arm of the union (no regression)', () => {
    renderList(objectsWith(true));
    expectBothCreateEntries({ rendered: true });
  });

  it('renders New + FAB when the object declares no `userActions` at all', () => {
    // The pre-change behaviour, unchanged: with no predicates declared there is
    // nothing to evaluate and the gate is a literal `true`.
    renderList(objectsWith(undefined));
    expectBothCreateEntries({ rendered: true });
  });

  it('renders New + FAB when the object form declares `enabled` but no predicates', () => {
    renderList(objectsWith({ enabled: true }));
    expectBothCreateEntries({ rendered: true });
  });

  it('HIDES New AND the FAB when `visibleWhen` evaluates false', () => {
    renderList(objectsWith({ enabled: true, visibleWhen: SCOPE_FALSE }));
    expectBothCreateEntries({ rendered: false });
  });

  it('keeps New + FAB when `visibleWhen` evaluates true', () => {
    renderList(objectsWith({ enabled: true, visibleWhen: SCOPE_TRUE }));
    expectBothCreateEntries({ rendered: true });
  });

  it('GREYS New AND the FAB (render, disabled) when `disabledWhen` holds — hidden and disabled stay distinct', () => {
    renderList(objectsWith({ enabled: true, disabledWhen: SCOPE_TRUE }));
    expectBothCreateEntries({ rendered: true, disabled: true });
  });

  it('leaves New + FAB enabled when `disabledWhen` does not hold', () => {
    renderList(objectsWith({ enabled: true, disabledWhen: SCOPE_FALSE }));
    expectBothCreateEntries({ rendered: true, disabled: false });
  });

  it('fails CLOSED on a `visibleWhen` that cannot bind — the standalone list has no record in scope', () => {
    // Not a defect of this harness: the spec binds a toolbar predicate to the
    // record of the scope the toolbar sits in, and says in as many words that a
    // standalone object list has none, so a `record.*` read hides the button.
    renderList(objectsWith({ enabled: true, visibleWhen: RECORD_BOUND }));
    expectBothCreateEntries({ rendered: false });
  });

  it('fails SOFT on a `disabledWhen` that cannot bind — an unevaluable predicate never greys forever', () => {
    renderList(objectsWith({ enabled: true, disabledWhen: RECORD_BOUND }));
    expectBothCreateEntries({ rendered: true, disabled: false });
  });

  it('treats `disabledWhen: ""` as "no condition", not as "disable"', () => {
    renderList(objectsWith({ enabled: true, disabledWhen: '' }));
    expectBothCreateEntries({ rendered: true, disabled: false });
  });

  it('honours the object-level opt-out — `create: false` hides both, predicates or not', () => {
    renderList(objectsWith({ enabled: false, visibleWhen: SCOPE_TRUE }));
    expectBothCreateEntries({ rendered: false });
  });

  it('a passing predicate cannot RE-OPEN what the principal closed (#4096 layering)', () => {
    // The permission gate and the predicate layer stack; neither short-circuits
    // the other. `visibleWhen` is true here, so if the layer order were
    // inverted the button would come back.
    principal = { create: false };
    renderList(objectsWith({ enabled: true, visibleWhen: SCOPE_TRUE }));
    expectBothCreateEntries({ rendered: false });
  });

  it('the permission gate still hides both with no predicates declared', () => {
    principal = { create: false };
    renderList(objectsWith(true));
    expectBothCreateEntries({ rendered: false });
  });

  it('a bucket that grants no create shows neither entry, predicates or not', () => {
    // `append-only` resolves `create: false`; a predicate must not resurrect it.
    renderList([
      {
        name: OBJECT_NAME,
        label: 'Invoice',
        managedBy: 'append-only',
        fields: { id: { type: 'text' }, name: { type: 'text' } },
        userActions: { create: { visibleWhen: SCOPE_TRUE } },
      },
    ]);
    expectBothCreateEntries({ rendered: false });
  });
});

/**
 * PER-ENTRY OBSERVABILITY. The cases above assert both render points inside one
 * test, which is the right economy for thirteen cases but means a regression at
 * EITHER point fails the SAME test name. These four pin the two headline
 * verdicts one entry at a time, so removing the predicate layer from a single
 * render point produces a crisp two-red / two-green split naming the point that
 * broke, instead of a wall of ambiguous failures. This is the shape the reverse
 * verification in the PR body is read against.
 */
describe('#5153 — each create render point is separately observable', () => {
  it('the header "New" alone: hidden when `visibleWhen` is false', () => {
    renderList(objectsWith({ enabled: true, visibleWhen: SCOPE_FALSE }));
    expect(newButton()).toBeNull();
  });

  it('the phone FAB alone: hidden when `visibleWhen` is false', () => {
    renderList(objectsWith({ enabled: true, visibleWhen: SCOPE_FALSE }));
    expect(fab()).toBeNull();
  });

  it('the header "New" alone: greyed when `disabledWhen` holds', () => {
    renderList(objectsWith({ enabled: true, disabledWhen: SCOPE_TRUE }));
    expect(newButton()).toBeTruthy();
    expect(newButton()!.disabled).toBe(true);
  });

  it('the phone FAB alone: greyed when `disabledWhen` holds', () => {
    renderList(objectsWith({ enabled: true, disabledWhen: SCOPE_TRUE }));
    expect(fab()).toBeTruthy();
    expect(fab()!.disabled).toBe(true);
  });
});

/**
 * FAMILY PARITY — the point of the issue, asserted directly.
 *
 * `create` now has three render points across the app: the related list's
 * "+ New" (#4646 / PR #5145), and this page's header button and phone FAB
 * (#5153). The defect was never "a predicate is unread" in the abstract; it was
 * that ONE authored declaration produced DIFFERENT verdicts depending on which
 * surface drew the button. So the parity is what gets pinned, in a single
 * render of all three under one scope.
 *
 * The subject must be a SCOPE-only predicate (`os.user.*`): that is the shape
 * which binds identically everywhere, and the only one for which "the same
 * answer on all three" is the correct expectation. A `record.*` predicate
 * deliberately does NOT agree across these surfaces — the related list binds
 * the host record and this page has none — which is the spec's binding, not a
 * defect, and is pinned as its own case above.
 */
describe('#5153 — one `userActions.create` declaration, one verdict on all three create surfaces', () => {
  const CHILD_PARENT = { id: 'p1', name: 'Order', frozen: false };

  function renderAllThree(createOverride: unknown) {
    const verdicts = { relatedList: undefined as boolean | undefined };
    function Probe() {
      const api = useRelatedRecordActions();
      const handlers =
        api?.resolve({ objectName: OBJECT_NAME, relationshipField: 'order', parentId: 'p1' }) ?? {};
      verdicts.relatedList = typeof handlers.onCreate === 'function';
      return null;
    }
    render(
      <ExpressionProvider user={USER}>
        <MemoryRouter initialEntries={[`/apps/demo/${OBJECT_NAME}`]}>
          <>
            <Routes>
              <Route
                path="/apps/:appName/:objectName"
                element={
                  <ObjectView
                    dataSource={makeDataSource()}
                    objects={objectsWith(createOverride)}
                    onEdit={() => {}}
                  />
                }
              />
            </Routes>
            <RelatedRecordActionsBridge
              appName="demo"
              objects={objectsWith(createOverride)}
              dataSource={{ delete: vi.fn() } as any}
              parentObjectName="order"
              parentRecordId="p1"
              parentRecord={CHILD_PARENT}
              parentObjectFields={{ id: { type: 'text' }, frozen: { type: 'boolean' } }}
            >
              <Probe />
            </RelatedRecordActionsBridge>
          </>
        </MemoryRouter>
      </ExpressionProvider>,
    );
    return {
      relatedList: verdicts.relatedList,
      objectListNew: newButton() != null,
      mobileFab: fab() != null,
    };
  }

  it('`visibleWhen` false: all three agree on HIDDEN', () => {
    const v = renderAllThree({ enabled: true, visibleWhen: SCOPE_FALSE });
    expect(v).toEqual({ relatedList: false, objectListNew: false, mobileFab: false });
  });

  it('`visibleWhen` true: all three agree on SHOWN', () => {
    const v = renderAllThree({ enabled: true, visibleWhen: SCOPE_TRUE });
    expect(v).toEqual({ relatedList: true, objectListNew: true, mobileFab: true });
  });

  it('`visibleWhen: false` — the literal objectui#3492 shape — hides all three', () => {
    const v = renderAllThree({ enabled: true, visibleWhen: false });
    expect(v).toEqual({ relatedList: false, objectListNew: false, mobileFab: false });
  });

  it('the plain boolean arm still shows all three', () => {
    const v = renderAllThree(true);
    expect(v).toEqual({ relatedList: true, objectListNew: true, mobileFab: true });
  });
});
