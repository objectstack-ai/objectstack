/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectGrid row-level CRUD + bulk delete vs every gate that narrows them:
 * the server's effective API operation set (#3720 — the fourth face of #3391)
 * and the CURRENT PRINCIPAL's permission on the object (#4096).
 *
 * One file on purpose. The row kebab and the bulk bar are two faces of the same
 * verdict, and the two gates are independent layers over it — keeping all four
 * combinations here is what makes a future divergence fail a test instead of
 * shipping.
 *
 * The main list's row kebab is a chain of its own: it never went through
 * `resolveEffectiveCrudAffordances`, so the toolbar (objectui#2823), detail/form
 * (#3546) and related-list rounds all missed it. `ObjectView` wires
 * `onEdit`/`onDelete` unconditionally and view JSON rarely declares
 * `operations`, so the gate was effectively "always on" — the row Edit/Delete
 * AND the (destructive) bulk delete rendered even for a caller whose effective
 * set carried neither `update` nor `delete`.
 *
 * These probe the REAL ObjectGrid through `usePermissions`, asserting the
 * user-visible outcome (menu items / selection checkboxes / bulk button).
 * The matrix mirrors objectui#2876 and keeps the `userActions` opt-out control
 * group: it proves the assertions can actually observe "hidden", so a hidden
 * result under a restricted effective set is not a false positive.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

// Stable stub identity: ObjectGrid carries `perms` in `useMemo` dependency
// arrays (the real `usePermissions` memoizes for exactly that reason), so a
// fresh object per call would churn those memos every render. `vi.hoisted`
// builds it before the hoisted `vi.mock` factory runs; the accessor reads
// mutable state so a test can swap the effective set without changing identity.
const { permsStub, state } = vi.hoisted(() => {
  const state: {
    effectiveOps: string[] | undefined;
    /** [#4096] The principal's `allowEdit` / `allowDelete` on this object. */
    permUpdate: boolean;
    permDelete: boolean;
    /** [#4096] Bypass the stub and run the REAL provider-less hook instead. */
    noProvider: boolean;
  } = { effectiveOps: undefined, permUpdate: true, permDelete: true, noProvider: false };
  return {
    state,
    // `isLoaded: false` keeps the FIELD-level filter out of the way so the
    // object-level gate is the only variable under test.
    permsStub: {
      isLoaded: false,
      checkField: () => true,
      getObjectApiOperations: () => state.effectiveOps,
      // [#4096] `can(obj, 'update' | 'delete')` — what `MePermissionsProvider`
      // resolves from `/me/permissions` `allowEdit` / `allowDelete`. It sits on
      // the SAME stub as `getObjectApiOperations` deliberately: the two layers
      // are independent gates, and a change that drops either one has to fail a
      // case in this file rather than in a file nobody thinks to open.
      can: (_obj: string, action: string) =>
        action === 'delete' ? state.permDelete : state.permUpdate,
    },
  };
});

// The real module stays reachable so the no-`PermissionProvider` case below
// exercises the ACTUAL fail-open fallback (`can: () => true`) instead of a
// hand-written imitation of it. The real hook is invoked on every render so
// hook order is stable whichever branch is returned.
vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return {
    ...actual,
    usePermissions: () => {
      const real = actual.usePermissions();
      return state.noProvider ? real : permsStub;
    },
  };
});

import { ObjectGrid } from '../ObjectGrid';
import { __clearRecordCrudVerdictCache } from '../hooks/useRecordCrudVerdicts';
import { installExplainDouble } from './explainDouble';
import { registerAllFields } from '@object-ui/fields';
import { ActionProvider, SchemaRendererProvider } from '@object-ui/react';

registerAllFields();

const OBJECT = 'test_object';
const ROWS = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
];

const FULL = ['get', 'list', 'create', 'update', 'delete'];
const READ_ONLY = ['get', 'list'];

interface Case {
  /** Server-resolved effective operation set; `undefined` = no annotation. */
  effectiveOps?: string[];
  /** ADR-0103 lifecycle bucket on the fetched object schema. */
  managedBy?: string;
  userActions?: Record<string, unknown>;
  /** Extra view-schema keys (e.g. an author-declared `bulkActions`). */
  schema?: Record<string, unknown>;
  /** [#4096] `/me/permissions` `allowEdit` for the caller; default `true`. */
  permUpdate?: boolean;
  /** [#4096] `/me/permissions` `allowDelete` for the caller; default `true`. */
  permDelete?: boolean;
  /** [#4096] Render with NO `PermissionProvider` (standalone embed / old host). */
  noProvider?: boolean;
}

function renderGrid(c: Case) {
  state.effectiveOps = c.effectiveOps;
  state.permUpdate = c.permUpdate ?? true;
  state.permDelete = c.permDelete ?? true;
  state.noProvider = c.noProvider ?? false;
  const dataSource: any = {
    getObjectSchema: async (name: string) => ({
      name,
      ...(c.managedBy ? { managedBy: c.managedBy } : {}),
      ...(c.userActions ? { userActions: c.userActions } : {}),
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
    }),
  };
  const schema: any = {
    type: 'object-grid',
    objectName: OBJECT,
    columns: [{ field: 'name', label: 'Name' }],
    data: { provider: 'value', items: ROWS },
    ...c.schema,
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={dataSource}>
        <ObjectGrid
          schema={schema}
          dataSource={dataSource}
          onEdit={() => {}}
          onDelete={() => {}}
          onBulkDelete={() => {}}
        />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/**
 * Render the grid and report what the row kebab surfaces. Waits for the async
 * `getObjectSchema` fetch so the affordance verdict is the settled one — an
 * assertion taken before it lands would read the pre-fetch (all-open) state.
 */
async function rowKebab(c: Case): Promise<{ edit: boolean; delete: boolean }> {
  renderGrid(c);
  await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
  // Let the schema fetch settle before reading the (possibly empty) menu.
  await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());
  const triggers = screen.queryAllByTestId('row-action-trigger');
  // No trigger at all = the menu had nothing to show (RowActionMenu renders
  // the "⋮" only when at least one entry survives its gates).
  if (triggers.length === 0) return { edit: false, delete: false };
  await userEvent.click(triggers[0]);
  return {
    edit: screen.queryAllByTestId('row-action-builtin-edit').length > 0,
    delete: screen.queryAllByTestId('row-action-builtin-delete').length > 0,
  };
}

/** Whether the grid offers multi-select (the entry point to bulk delete). */
async function hasSelection(c: Case): Promise<boolean> {
  renderGrid(c);
  await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());
  return screen.queryAllByRole('checkbox').length > 0;
}

beforeEach(() => {
  state.effectiveOps = undefined;
  state.permUpdate = true;
  state.permDelete = true;
  state.noProvider = false;
  // [#4296] This file's grids carry an objectName and rows with ids, so each
  // render batches a record-level explain probe. Answer it from a double
  // instead of the network (objectui#3339 / PR #4105). It answers `visible:
  // true` for every row, so the OBJECT-level matrix below — which is what this
  // file pins — is measured with the record layer contributing nothing.
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('ObjectGrid row CRUD vs the effective API operation set (#3720)', () => {
  // The exact matrix from the issue: A baseline, B the bug, C control group.
  it('A — full effective set keeps row Edit/Delete and multi-select', async () => {
    expect(await rowKebab({ effectiveOps: FULL })).toEqual({ edit: true, delete: true });
    cleanup();
    expect(await hasSelection({ effectiveOps: FULL })).toBe(true);
  });

  it('B — a read-only effective set hides row Edit/Delete and multi-select', async () => {
    expect(await rowKebab({ effectiveOps: READ_ONLY })).toEqual({ edit: false, delete: false });
    cleanup();
    expect(await hasSelection({ effectiveOps: READ_ONLY })).toBe(false);
  });

  it('C — control group: the userActions opt-out is observably honored', async () => {
    // Proves the assertions above can actually observe "hidden" — without this
    // control a passing B could just be a broken probe.
    expect(await rowKebab({ effectiveOps: FULL, userActions: { edit: false, delete: false } }))
      .toEqual({ edit: false, delete: false });
  });

  it('gates update and delete independently', async () => {
    expect(await rowKebab({ effectiveOps: ['get', 'list', 'update'] }))
      .toEqual({ edit: true, delete: false });
    cleanup();
    expect(await rowKebab({ effectiveOps: ['get', 'list', 'delete'] }))
      .toEqual({ edit: false, delete: true });
  });

  it('a missing effective set preserves the pre-#3720 behavior', async () => {
    // Unrestricted object / old backend / no PermissionProvider.
    expect(await rowKebab({ effectiveOps: undefined })).toEqual({ edit: true, delete: true });
    cleanup();
    expect(await hasSelection({ effectiveOps: undefined })).toBe(true);
  });

  it('intersects, never unions — a server grant cannot re-open a userActions opt-out', async () => {
    expect(await rowKebab({ effectiveOps: FULL, userActions: { edit: false, delete: false } }))
      .toEqual({ edit: false, delete: false });
  });

  it('intersects, never unions — a userActions opt-in cannot survive a server denial', async () => {
    expect(await rowKebab({ effectiveOps: READ_ONLY, userActions: { edit: true, delete: true } }))
      .toEqual({ edit: false, delete: false });
  });
});

describe('ObjectGrid row CRUD vs the ADR-0103 bucket lock (#3720)', () => {
  it('engine-owned buckets no longer leak generic row Edit/Delete', async () => {
    // `engine-owned`, NOT the residual `'system'` this used to pass. Protocol
    // 17 split that bucket (objectstack#3355): the engine-owned objects moved
    // to `engine-owned` and the admin/user-writable half became `system-data`,
    // so `'system'` is no longer a bucket at all and now resolves to the
    // default-writable fallback. The lock this pins lives on `engine-owned`.
    expect(await rowKebab({ managedBy: 'engine-owned' })).toEqual({ edit: false, delete: false });
    cleanup();
    expect(await rowKebab({ managedBy: 'append-only' })).toEqual({ edit: false, delete: false });
  });

  it('platform / config objects are untouched', async () => {
    expect(await rowKebab({ managedBy: 'platform' })).toEqual({ edit: true, delete: true });
    cleanup();
    expect(await rowKebab({ managedBy: 'config' })).toEqual({ edit: true, delete: true });
  });

  it('a userActions opt-in re-opens a bucket-locked object (sys_user-style edit)', async () => {
    expect(await rowKebab({ managedBy: 'better-auth', userActions: { edit: true } }))
      .toEqual({ edit: true, delete: false });
  });
});

describe('ObjectGrid bulk delete vs the object delete verdict (#3720)', () => {
  it('drops an author-declared bulkActions delete when the server denies it', async () => {
    // `bulkActions: ['delete']` is a WIRING declaration, not a permission
    // grant — the destructive button must not outlive the effective set.
    renderGrid({ effectiveOps: READ_ONLY, schema: { bulkActions: ['delete'] } });
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());
    expect(screen.queryAllByRole('checkbox').length).toBe(0);
  });

  it('keeps a declared bulkActions delete when the effective set allows it', async () => {
    renderGrid({ effectiveOps: FULL, schema: { bulkActions: ['delete'] } });
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    const boxes = screen.queryAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    await userEvent.click(boxes[boxes.length - 1]);
    await waitFor(() => expect(screen.getByTestId('bulk-action-delete')).toBeInTheDocument());
  });

  it('keeps NON-delete bulk actions when the server denies delete', async () => {
    // Custom ids route through the action runner with their own gates — the
    // delete verdict must not take them down with it.
    renderGrid({ effectiveOps: READ_ONLY, schema: { bulkActions: ['delete', 'notify'] } });
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    const boxes = screen.queryAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    await userEvent.click(boxes[boxes.length - 1]);
    await waitFor(() => expect(screen.getByTestId('bulk-action-notify')).toBeInTheDocument());
    expect(screen.queryByTestId('bulk-action-delete')).not.toBeInTheDocument();
  });

  it('drops the built-in bulk delete for a principal with no allowDelete', async () => {
    // [#4096] The row gate and the bulk bar must move together — fixing the
    // kebab while the (more destructive) bulk button stays open would be the
    // same bug one control over.
    renderGrid({ effectiveOps: FULL, permDelete: false, schema: { bulkActions: ['delete'] } });
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('Bob')).toBeInTheDocument());
    expect(screen.queryAllByRole('checkbox').length).toBe(0);
  });

  it('drops a bulkActionDefs entry whose operation is delete', async () => {
    renderGrid({
      // [objectui#12082] An effective set that serves `update` but not
      // `delete`: the update def is the control that stays, now that a bulk
      // field update rides the edit verdict (`bulkUpdateGrant-12082.test.tsx`)
      // — under READ_ONLY it is withheld too.
      effectiveOps: ['get', 'list', 'update'],
      schema: {
        bulkActionDefs: [
          { name: 'purge', label: 'Purge', operation: 'delete' },
          { name: 'reassign', label: 'Reassign', operation: 'update' },
        ],
      },
    });
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    const boxes = screen.queryAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    await userEvent.click(boxes[boxes.length - 1]);
    await waitFor(() => expect(screen.getByTestId('bulk-action-reassign')).toBeInTheDocument());
    expect(screen.queryByTestId('bulk-action-purge')).not.toBeInTheDocument();
  });
});

/**
 * [#4096] The principal layer, through the real ObjectGrid.
 *
 * `apiOperations` answers "which verbs does this OBJECT publish"; it is
 * principal-independent (the report measured 30/30 shared objects byte-identical
 * between an account with `allowEdit` and one without), so intersecting only
 * with it left the row kebab and the bulk bar permanently open for read-only
 * accounts — while the toolbar's New button and the record header's Edit/Delete
 * on the very same screen were correctly hidden. The gate now also ANDs
 * `can(obj, 'update' | 'delete')`, i.e. `/me/permissions` `allowEdit` /
 * `allowDelete` — the toolbar's own source.
 *
 * The three cases the fix must hold simultaneously, in both directions:
 *   • a principal WITH the write grant still sees Edit/Delete (no over-tightening);
 *   • a principal WITHOUT it sees neither (the bug);
 *   • NO `PermissionProvider` at all still sees both (fail-open preserved for
 *     standalone embeds / older hosts — this one runs the real hook, not a stub).
 */
describe('ObjectGrid row CRUD vs the principal permission gate (#4096)', () => {
  it('a principal WITH allowEdit/allowDelete keeps both entries', async () => {
    expect(await rowKebab({ effectiveOps: FULL, permUpdate: true, permDelete: true }))
      .toEqual({ edit: true, delete: true });
    cleanup();
    expect(await hasSelection({ effectiveOps: FULL, permUpdate: true, permDelete: true })).toBe(true);
  });

  it('a principal WITHOUT allowEdit/allowDelete loses both — on a fully exposed object', async () => {
    // The exact reported shape: identical full `apiOperations`, opposite
    // `allowEdit`/`allowDelete`. Pre-#4096 this returned `{ edit: true, delete: true }`.
    expect(await rowKebab({ effectiveOps: FULL, permUpdate: false, permDelete: false }))
      .toEqual({ edit: false, delete: false });
    cleanup();
    expect(await hasSelection({ effectiveOps: FULL, permUpdate: false, permDelete: false })).toBe(false);
  });

  it('with NO PermissionProvider both entries survive (fail-open preserved)', async () => {
    // Runs the REAL `usePermissions` with no provider mounted: `can: () => true`
    // and `getObjectApiOperations: () => undefined`. A standalone embed has no
    // permission source and must not lose its Edit/Delete to this tightening.
    expect(await rowKebab({ noProvider: true })).toEqual({ edit: true, delete: true });
    cleanup();
    expect(await hasSelection({ noProvider: true })).toBe(true);
  });

  it('gates update and delete independently', async () => {
    expect(await rowKebab({ effectiveOps: FULL, permUpdate: true, permDelete: false }))
      .toEqual({ edit: true, delete: false });
    cleanup();
    expect(await rowKebab({ effectiveOps: FULL, permUpdate: false, permDelete: true }))
      .toEqual({ edit: false, delete: true });
  });

  it('keeps apiOperations as a layer — a write grant cannot re-open a closed exposure surface', async () => {
    expect(await rowKebab({ effectiveOps: READ_ONLY, permUpdate: true, permDelete: true }))
      .toEqual({ edit: false, delete: false });
  });
});
