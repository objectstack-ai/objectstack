/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7218 — the object page relays a per-view `rowColor`.
 *
 * ## The defect this pins
 *
 * `renderListView` builds `fullSchema` by spreading the OBJECT's `listSchema`
 * and then relaying 47 named keys off the active `viewDef`. `label`,
 * `description`, `color`, `conditionalFormatting`, `fieldTextColor` and the
 * rest each have a rung. `rowColor` had NONE, so `schema.rowColor` at the
 * `ListView` end could only ever be whatever arrived on the host's list schema,
 * and a per-view row colour was unreachable — authored, validated, built and
 * served correctly, then dropped here.
 *
 * Same shape as objectui#7199's `description`, and this file is that file's
 * sibling by construction: nothing errors, every authoring gate passes, and the
 * only symptom is that rows the author asked to be coloured are not.
 *
 * ## Why this is a relay and not an intent question
 *
 * `packages/app-shell/src/views/InterfaceListPage.tsx` — the interface route,
 * the third host — already relays `rowColor: view.rowColor` into a schema typed
 * `ListViewSchema`, alongside `grouping` and `pagination`, with no fence of any
 * kind. `rowColor` is a declared member of `ListViewSchema` (by-reference from
 * `@objectstack/spec`) and `ListView` reads it to seed `rowColorConfig`. So the
 * delivery path exists and is in use; this route simply did not take it.
 *
 * ⚠️ NOT `userActions.rowColor`, which is a different key at a different
 * nesting level that shares a name: a BOOLEAN permission toggle ("may the user
 * open the colour panel"), folded from the legacy `showColor` flag by
 * `normalizeListViewSchema` and asserted by that fold's own tests. This card is
 * the row-colour CONFIGURATION ("what the colours are"). The `userActions`
 * relay above is untouched by this change, and the last case holds the two
 * apart so a crossed wire fails instead of passing.
 *
 * ## The value DOES arrive here — the relay is where it dies
 *
 * `buildViewTabs` composes each entry through `viewEntry`, which is
 * `Object.assign` over the authored body and stamps only `id` afterwards. No
 * key whitelist runs between `objectDef.listViews` and `activeView`, so an
 * authored `rowColor` is present on `viewDef` and this relay is the single
 * point of loss.
 *
 * ## Direction and counts, written before the run (reverse verification)
 *
 * Deleting the `rowColor:` rung from `fullSchema` was PREDICTED to turn the
 * three view-authored cases RED (`captured.rowColor` `undefined`, or the
 * host-level value where the view's own was expected) and to leave the three
 * fallback/absence/`userActions` controls GREEN — they resolve through the
 * `...listSchema` spread and the untouched `userActions` fold, neither of which
 * the rung touches. Predicted 3 red / 3 passing.
 *
 * ⚠️ MEASURED 4 red / 2 passing, and the prediction was the thing that was
 * wrong. The last case is not a pure control: it asserts the config rung AND
 * the untouched toggle in ONE render, so it carries a FIX limb and goes red
 * with the other three. The two limbs are kept together on purpose — holding
 * the two same-named keys apart is only meaningful when both are read off the
 * same relayed schema — so the case stays as written.
 *
 * ⛔ The predicted line above is left EXACTLY as it was written before the run,
 * annotated rather than corrected: a prediction edited to agree with its result
 * is no longer evidence of anything. The gap is a mislabelling in THIS file,
 * not a finding about the relay — the case was filed under "controls" while
 * asserting the fix — and the controls that are genuinely pure (the
 * `...listSchema` fallback and the absence case) did stay green in both states,
 * which is the property the prediction existed to check.
 *
 * ## Why the schema is captured rather than rendered
 *
 * The claim is about what THIS file hands down, so `ListView` is stubbed and
 * its `schema` prop recorded — the same posture as
 * `ObjectView.viewDescriptionRelay-7199.test.tsx`. Whether the captured value
 * then colours a row is `plugin-list`/`plugin-grid`'s half (`useRowColor`), and
 * is not re-pinned here.
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
 * The in-tree host (`plugin-view`'s `ObjectView`) relays the ACTIVE VIEW's
 * `rowColor` into this slot as of this same card, so this stands in for an
 * object-level / host-supplied row colour. It is the rung's SECOND limb, and
 * the only way to exercise it from here.
 */
let hostListRowColor: unknown;

vi.mock('@object-ui/plugin-view', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ObjectView: (props: any) =>
    props.renderListView?.({
      schema: {
        ...(props.schema ?? {}),
        ...(hostListRowColor === undefined ? {} : { rowColor: hostListRowColor }),
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

/** The per-view row colour — the configuration this card is about. */
const VIEW_ROW_COLOR = { field: 'stage', colors: { won: '#16a34a', lost: '#dc2626' } };
/** A host/object-level one. Distinct so a crossed wire fails instead of passing. */
const LIST_ROW_COLOR = { field: 'priority', colors: { high: '#f97316' } };

function objectsWith(objectExtra: Record<string, unknown>, view: Record<string, unknown>) {
  return [
    {
      name: OBJECT_NAME,
      label: 'Task',
      fields: {
        id: { type: 'text', label: 'Id' },
        name: { type: 'text', label: 'Name' },
        stage: { type: 'text', label: 'Stage' },
      },
      listViews: {
        by_stage: { label: 'By stage', type: 'grid', columns: ['name'], ...view },
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
  // waiting on `rowColor` itself would hang rather than fail on a regression.
  await waitFor(() => {
    expect(captured?.options).toBeTruthy();
  });
  return captured;
}

/** Just the row colour the relay handed down. */
const relayedRowColor = async (objects: any[]): Promise<unknown> => (await relayed(objects)).rowColor;

beforeEach(() => {
  cleanup();
  captured = null;
  hostListRowColor = undefined;
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

describe("ObjectView relays the active view's own rowColor (objectui#7218)", () => {
  it('THE FIX: a per-view `rowColor` reaches the renderer', async () => {
    // Before the rung existed this was `undefined` for every object, which is
    // the whole of the reported defect.
    expect(await relayedRowColor(objectsWith({}, { rowColor: VIEW_ROW_COLOR }))).toEqual(VIEW_ROW_COLOR);
  });

  it('THE FIX: the config is relayed VERBATIM, palette included', async () => {
    // `ListView` seeds `rowColorConfig` from this value and reads `.field` and
    // `.colors` off it. A relay that carried the field alone would satisfy "a
    // rowColor arrives" while dropping the author's palette.
    const got: any = await relayedRowColor(objectsWith({}, { rowColor: VIEW_ROW_COLOR }));
    expect(got).toEqual(VIEW_ROW_COLOR);
    expect(got.colors).toEqual(VIEW_ROW_COLOR.colors);
  });

  it('THE FIX: the per-view value OVERRIDES a host-supplied list row colour', async () => {
    hostListRowColor = LIST_ROW_COLOR;
    expect(await relayedRowColor(objectsWith({}, { rowColor: VIEW_ROW_COLOR }))).toEqual(VIEW_ROW_COLOR);
  });

  it('CONTROL: the host-supplied row colour still shows when the view authors none', async () => {
    // The control that the rung is a FALLBACK, not a replacement. Green in
    // either world — it resolves through the `...listSchema` spread that the
    // rung's second limb only restates — so a fix that stomped the incoming
    // value with `undefined` fails here.
    hostListRowColor = LIST_ROW_COLOR;
    expect(await relayedRowColor(objectsWith({}, {}))).toEqual(LIST_ROW_COLOR);
  });

  it('CONTROL: no row colour anywhere stays absent', async () => {
    expect(await relayedRowColor(objectsWith({}, {}))).toBeUndefined();
  });

  it('the BOOLEAN `userActions.rowColor` toggle is never crossed with the config', async () => {
    // Two different keys at two nesting levels sharing a name. The toggle says
    // "may the user open the colour panel"; this card's key says "what the
    // colours are". A relay that folded one into the other would read as fixed
    // and render nothing — so both are asserted in one render, on a view that
    // authors the toggle OFF while authoring a colour config.
    const schema = await relayed(
      objectsWith({}, { rowColor: VIEW_ROW_COLOR, userActions: { rowColor: false } }),
    );
    expect(schema.rowColor).toEqual(VIEW_ROW_COLOR);
    expect(schema.userActions?.rowColor).toBe(false);
  });
});
