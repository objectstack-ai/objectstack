/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7199 — the object page relays a per-view `description`.
 *
 * ## The defect this pins
 *
 * `renderListView` builds `fullSchema` by spreading the OBJECT's `listSchema`
 * and then relaying selected keys off the active `viewDef`. `label`, `sort`,
 * `filter`, `hiddenFields`, `inlineEdit`, `color`, `allowExport` and ~40 more
 * each have a rung. `description` had NONE, so `schema.description` at the
 * `ListView` end could only ever be the object-level list's description, and a
 * per-view one was unreachable — authored, validated, built and served
 * correctly, then dropped here.
 *
 * It is the "declared and inert" shape: nothing errors, every authoring gate
 * passes, the API serves the value, and the only symptom is that the sentence
 * the author wrote for the user is not on the screen. It bites hardest where a
 * view description is most wanted — disclosing a caveat about the view itself.
 *
 * ## The value DOES arrive here — the relay is where it dies
 *
 * Confirmed rather than assumed, because "the API serves it" traces the value
 * only as far as the meta API, not as far as this component's props:
 * `buildViewTabs` composes each entry through `viewEntry`, which is
 * `Object.assign` over the authored body and stamps only `id` afterwards. No
 * key whitelist runs between `objectDef.listViews` and `activeView`, so an
 * authored `description` is present on `viewDef` and this relay is the single
 * point of loss. The `objectDef.description` case below is what proves the fix
 * did not simply reach for the object-level value instead.
 *
 * ## ⚠️ NOT the page header's subtitle
 *
 * This page also renders `subtitle={objectDef.description ? objectDesc(objectDef) : undefined}`
 * on its `PageHeader`. That is the OBJECT's blurb — a different value with a
 * different audience. Crossing the two would put a view's caveat where the
 * object's description belongs, and would make the relay look fixed while
 * showing the wrong sentence. The last case holds them apart.
 *
 * ## Direction and counts, written before the run (reverse verification)
 *
 * Deleting the `description:` rung from `fullSchema` was PREDICTED to turn the
 * four view-authored cases RED (`captured.description` `undefined`, or the
 * object-level value where the view's own was expected) and to leave the two
 * fallback/absence controls GREEN — they resolve through the `...listSchema`
 * spread, which the rung does not touch. Predicted 4 red / 2 passing. Measured
 * outcome is recorded on the PR.
 *
 * ## Why the schema is captured rather than rendered
 *
 * The claim is about what THIS file hands down, so `ListView` is stubbed and
 * its `schema` prop recorded — the same posture as
 * `ObjectView.titleFieldConvergence.test.tsx`. Whether the captured value then
 * reaches the DOM (and how a locale map resolves once it does) is the other
 * half of objectui#7199 and is pinned in `plugin-list` by
 * `ListView.descriptionInlineLocale-7199.test.tsx`.
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
 * What the HOST puts on the list schema before this page's relay runs — i.e.
 * the `listSchema` the `...listSchema` spread carries in.
 *
 * The in-tree host (`plugin-view`'s `ObjectView`) sets no `description` of its
 * own today, so this is `undefined` for every case except the object-level
 * fallback control, where it stands in for an object-level list description.
 * That is the rung's SECOND limb, and the only way to exercise it from here.
 */
let hostListDescription: unknown;

vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectView: (props: any) =>
    props.renderListView?.({
      schema: {
        ...(props.schema ?? {}),
        ...(hostListDescription === undefined ? {} : { description: hostListDescription }),
      },
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

/** The per-view sentence — a caveat about THIS view, the text #7199 is about. */
const VIEW_DESC = 'Open and in-progress work only. Counts cover the loaded page.';
/** The object's own blurb. Distinct so a crossed wire fails instead of passing. */
const OBJECT_DESC = 'Every task in the workspace.';
/** An object-level LIST description — the relay rung's fallback limb. */
const LIST_DESC = 'The default task list.';

function objectsWith(objectExtra: Record<string, unknown>, view: Record<string, unknown>) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Task',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
      },
      listViews: {
        by_unit: { label: 'By business unit', type: 'grid', columns: ['name'], ...view },
      },
      ...objectExtra,
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

/** Render the object list and return the `description` the relay handed down. */
async function relayedDescription(objects: any[]): Promise<unknown> {
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
  // waiting on `description` itself would hang rather than fail on a regression.
  await waitFor(() => {
    expect(captured?.options).toBeTruthy();
  });
  return captured.description;
}

beforeEach(() => {
  cleanup();
  captured = null;
  hostListDescription = undefined;
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

describe('ObjectView relays the active view\'s own description (objectui#7199)', () => {
  it('THE FIX: a per-view `description` reaches the renderer', async () => {
    // Before the rung existed this was `undefined` for every object, which is
    // the whole of the reported defect.
    expect(await relayedDescription(objectsWith({}, { description: VIEW_DESC }))).toBe(VIEW_DESC);
  });

  it('THE FIX: an inline locale map is relayed VERBATIM, not flattened here', async () => {
    // `ListViewSchema.description` is `I18nLabel`. The relay's job is to carry
    // the authored value; resolution belongs at the render site, which holds
    // the audience locale. Flattening here would pick a locale on the wrong
    // side of the boundary and is pinned against by this case.
    const map = { en: 'Open work only.', 'zh-CN': '仅未完成的工作。' };
    expect(await relayedDescription(objectsWith({}, { description: map }))).toEqual(map);
  });

  it('THE FIX: the per-view value OVERRIDES an object-level list description', async () => {
    hostListDescription = LIST_DESC;
    expect(await relayedDescription(objectsWith({}, { description: VIEW_DESC }))).toBe(VIEW_DESC);
  });

  it('CONTROL: the object-level list description still shows when the view authors none', async () => {
    // The control that the rung is a FALLBACK, not a replacement. Green in
    // either world — it resolves through the `...listSchema` spread that the
    // rung's second limb only restates — so a fix that stomped the object-level
    // value with `undefined` fails here.
    hostListDescription = LIST_DESC;
    expect(await relayedDescription(objectsWith({}, {}))).toBe(LIST_DESC);
  });

  it('CONTROL: no description anywhere stays absent', async () => {
    expect(await relayedDescription(objectsWith({}, {}))).toBeUndefined();
  });

  it("the OBJECT's own description is never borrowed as the view's", async () => {
    // `objectDef.description` is the PageHeader's subtitle — a different value
    // with a different audience. A relay that reached for it would satisfy the
    // "a description arrives" reading of this card while showing the object's
    // blurb where the view's caveat belongs.
    const relayed = await relayedDescription(
      objectsWith({ description: OBJECT_DESC }, {}),
    );
    expect(relayed).toBeUndefined();
    expect(relayed).not.toBe(OBJECT_DESC);

    // …and with BOTH authored, the view's own still wins.
    cleanup();
    expect(
      await relayedDescription(objectsWith({ description: OBJECT_DESC }, { description: VIEW_DESC })),
    ).toBe(VIEW_DESC);
  });
});
