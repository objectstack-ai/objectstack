/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectGrid's `editable` schema key vs the principal's write verdict (#5143).
 *
 * #4647 gated inline editing at the **ListView** layer (PR #5145): the toolbar
 * toggle, the compact-toolbar entry and the `editable` value ListView hands
 * down are all ANDed with `isObjectInlineEditable` ∧ `can(obj, 'update')`.
 *
 * `ObjectGrid` has a SECOND, independent door into the same state that never
 * passes through ListView: a declaratively-authored `object-grid` block
 * carrying `editable: true`. It read that key raw, so a principal with no
 * `update` grant landed in editable cells and was stopped only by the server's
 * 403 — while the row kebab on those very same rows correctly hid Edit. One
 * component, two opposite answers to "may this user write these records?".
 *
 * These probe the REAL ObjectGrid through `usePermissions` and assert the
 * USER-VISIBLE outcome — does clicking a cell produce an editor — rather than
 * the prop that produces it. The kebab cases are kept in the same file on
 * purpose: the disagreement between the two affordances IS the bug, so a
 * future change that re-opens either half has to fail a case here.
 *
 * Sibling coverage: `rowCrudEffectiveOps.test.tsx` owns the row kebab / bulk
 * bar matrix (#3720 / #4096); this file owns the inline-edit surface.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import React from 'react';

// Stable stub identity: ObjectGrid carries `perms` in `useMemo` dependency
// arrays, so a fresh object per call would churn those memos every render.
// Mirrors `rowCrudEffectiveOps.test.tsx`'s hoisted-state pattern.
const { permsStub, state } = vi.hoisted(() => {
  const state: {
    /** `/me/permissions` `allowEdit` for the caller. */
    permUpdate: boolean;
    /** Server-resolved effective API operation set; `undefined` = no annotation. */
    effectiveOps: string[] | undefined;
    /** Bypass the stub and run the REAL provider-less hook instead. */
    noProvider: boolean;
  } = { permUpdate: true, effectiveOps: undefined, noProvider: false };
  return {
    state,
    permsStub: {
      // `isLoaded: false` keeps the FIELD-level filter out of the way so the
      // object-level gate is the only variable under test.
      isLoaded: false,
      checkField: () => true,
      getObjectApiOperations: () => state.effectiveOps,
      can: (_obj: string, action: string) =>
        action === 'update' ? state.permUpdate : true,
    },
  };
});

// The real module stays reachable so the no-`PermissionProvider` case exercises
// the ACTUAL fail-open fallback (`can: () => true`) instead of a hand-written
// imitation of it. The real hook is invoked on every render so hook order is
// stable whichever branch is returned.
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

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'inline_edit_gate_object';
const INLINE_ROWS = [
  { id: 'r1', name: 'Row One' },
  { id: 'r2', name: 'Row Two' },
];

interface Case {
  /** View schema `editable`; omit for a grid that never asked to be editable. */
  editable?: boolean;
  /** `/me/permissions` `allowEdit` for the caller; default `true`. */
  permUpdate?: boolean;
  /** Server-resolved effective API operation set. */
  effectiveOps?: string[];
  /** ADR-0103 lifecycle bucket on the fetched object schema. */
  managedBy?: string;
  userActions?: Record<string, unknown>;
  /** Render with NO `PermissionProvider` (standalone embed / Studio designer). */
  noProvider?: boolean;
  /** Drop `objectName` — a pure inline data grid with no object semantics. */
  noObjectName?: boolean;
  /**
   * Address the object through the DATA CONFIG only (`{ provider: 'object',
   * object: … }`) with no top-level `objectName`. ObjectGrid resolves the name
   * from either; ListView's gate reads only `schema.objectName`.
   */
  objectViaDataConfig?: boolean;
}

function makeDataSource(c: Case) {
  const store: Record<string, any> = {
    r1: { id: 'r1', name: 'Row One' },
    r2: { id: 'r2', name: 'Row Two' },
  };
  return {
    find: vi.fn(async () => {
      const data = Object.values(store).map((r) => ({ ...r }));
      return { data, total: data.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(async (_o: string, id: string) => ({ ...store[id] })),
    update: vi.fn(async (_o: string, id: string, changes: Record<string, any>) => {
      store[id] = { ...store[id], ...changes };
      return { ...store[id] };
    }),
    getObjectSchema: async (name: string) => ({
      name,
      ...(c.managedBy ? { managedBy: c.managedBy } : {}),
      ...(c.userActions ? { userActions: c.userActions } : {}),
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
    }),
  } as any;
}

function renderGrid(c: Case) {
  state.permUpdate = c.permUpdate ?? true;
  state.effectiveOps = c.effectiveOps;
  state.noProvider = c.noProvider ?? false;
  const ds = makeDataSource(c);
  const schema: any = {
    type: 'object-grid',
    ...(c.noObjectName || c.objectViaDataConfig ? {} : { objectName: OBJECT }),
    ...(c.objectViaDataConfig ? { data: { provider: 'object', object: OBJECT } } : {}),
    ...(c.editable != null ? { editable: c.editable } : {}),
    singleClickEdit: true,
    columns: [{ field: 'name', label: 'Name', type: 'text' }],
    pagination: { pageSize: 50 },
    ...(c.noObjectName ? { data: { provider: 'value', items: INLINE_ROWS } } : {}),
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectGrid schema={schema} dataSource={ds} onEdit={() => {}} onDelete={() => {}} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/** Find the `<td>` in `row` whose displayed text matches exactly. */
const cellByText = (row: HTMLElement, text: string) =>
  Array.from(row.querySelectorAll('td')).find(
    (td) => td.textContent?.trim() === text,
  ) as HTMLElement;

/**
 * Render, click the first row's Name cell, and report whether an in-cell
 * editor opened. This is the user-visible face of both `editable` and
 * `renderCellEditor`: DataTable only enters edit state when `editable` is on,
 * and only renders the injected widget when `renderCellEditor` is supplied.
 */
async function entersEditState(c: Case): Promise<boolean> {
  const { container } = renderGrid(c);
  await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());
  const row = container.querySelector('tbody tr') as HTMLElement;
  const td = cellByText(row, 'Row One');
  fireEvent.click(td);
  // The editor mounts synchronously on click; give React a tick to flush so a
  // `false` here means "never opened", not "not opened yet".
  await new Promise((r) => setTimeout(r, 50));
  return td.querySelector('input') != null;
}

/** Whether the row kebab offers the built-in Edit entry. */
async function kebabOffersEdit(c: Case): Promise<boolean> {
  renderGrid(c);
  await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText('Row Two')).toBeInTheDocument());
  const triggers = screen.queryAllByTestId('row-action-trigger');
  if (triggers.length === 0) return false;
  await userEvent.click(triggers[0]);
  return screen.queryAllByTestId('row-action-builtin-edit').length > 0;
}

/** Header cell count — the observable for the save/cancel `rowActions` column. */
async function headerCellCount(c: Case): Promise<number> {
  const { container } = renderGrid(c);
  await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText('Row Two')).toBeInTheDocument());
  return container.querySelectorAll('thead th').length;
}

beforeEach(() => {
  state.permUpdate = true;
  state.effectiveOps = undefined;
  state.noProvider = false;
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ObjectGrid `editable` vs can(object, 'update') (#5143)", () => {
  it('a — no update grant: an `editable: true` schema no longer enters edit state', async () => {
    expect(await entersEditState({ editable: true, permUpdate: false })).toBe(false);
  });

  it('b — with the grant: `editable: true` behaves exactly as before', async () => {
    expect(await entersEditState({ editable: true, permUpdate: true })).toBe(true);
  });

  it('c — no PermissionProvider (standalone embed / Studio designer) fails OPEN', async () => {
    // The REAL provider-less hook, not the stub: `can()` answers `true` with no
    // provider mounted, which is the fallback every sibling gate in ObjectGrid
    // relies on. A designer canvas must keep rendering an editable grid.
    expect(await entersEditState({ editable: true, noProvider: true })).toBe(true);
  });

  it('d — the row kebab keeps its own verdict, and the two now AGREE', async () => {
    // The disagreement in #5143's title, pinned from both sides: without the
    // grant BOTH affordances are withheld; with it BOTH are offered.
    expect(await kebabOffersEdit({ editable: true, permUpdate: false })).toBe(false);
    cleanup();
    expect(await entersEditState({ editable: true, permUpdate: false })).toBe(false);
    cleanup();
    expect(await kebabOffersEdit({ editable: true, permUpdate: true })).toBe(true);
    cleanup();
    expect(await entersEditState({ editable: true, permUpdate: true })).toBe(true);
  });

  it('e — the save/cancel column follows the same verdict, so the gated grid IS the non-editable grid', async () => {
    // `rowActions` exists only to carry inline-edit save/cancel. Left on the
    // raw schema key it would render a permanently empty trailing column for a
    // read-only principal — a shape no grid has today. The gated grid must be
    // column-for-column identical to one that never asked to be editable.
    const editableWithGrant = await headerCellCount({ editable: true, permUpdate: true });
    cleanup();
    const editableNoGrant = await headerCellCount({ editable: true, permUpdate: false });
    cleanup();
    const neverEditable = await headerCellCount({ permUpdate: true });

    expect(editableNoGrant).toBe(neverEditable);
    // Control: the column really is observable, so the equality above is not a
    // probe that cannot tell the two shapes apart.
    expect(editableWithGrant).toBe(neverEditable + 1);
  });
});

describe('ObjectGrid inline edit vs the object-level affordance (#5143)', () => {
  it("an engine-owned bucket closes inline edit even with the principal's grant", async () => {
    expect(await entersEditState({ editable: true, managedBy: 'engine-owned' })).toBe(false);
    cleanup();
    expect(await entersEditState({ editable: true, managedBy: 'append-only' })).toBe(false);
  });

  it('an explicit `userActions.edit: false` closes it', async () => {
    expect(await entersEditState({ editable: true, userActions: { edit: false } })).toBe(false);
  });

  it("a server effective set without `update` closes it (#3391/#3546)", async () => {
    expect(await entersEditState({ editable: true, effectiveOps: ['get', 'list'] }))
      .toBe(false);
    cleanup();
    expect(await entersEditState({ editable: true, effectiveOps: ['get', 'list', 'update'] }))
      .toBe(true);
  });

  it('intersects, never unions — a userActions opt-in cannot survive a missing grant', async () => {
    expect(await entersEditState({ editable: true, userActions: { edit: true }, permUpdate: false }))
      .toBe(false);
  });

  it('narrows only — no verdict can turn editing ON for a grid that never asked', async () => {
    expect(await entersEditState({ permUpdate: true })).toBe(false);
    cleanup();
    expect(await entersEditState({ editable: false, permUpdate: true })).toBe(false);
  });

  it('an object addressed through the DATA CONFIG is gated here too — this is the only gate on that shape', async () => {
    // Not a redundant copy of ListView's gate. ObjectGrid resolves
    // `objectName = dataConfig.object ?? schema.objectName`, while ListView's
    // `inlineEditOffered` reads `schema.objectName` alone — so a grid whose
    // object identity arrives ONLY through `data: { provider: 'object', object:
    // … }` falls through ListView's `schema.objectName ? … : true` branch open
    // and is judged solely by the verdict resolved in this component. Pinned so
    // that narrowing `objectName` back to the schema key fails here rather than
    // silently reopening the door on that shape.
    expect(await entersEditState({ editable: true, objectViaDataConfig: true, permUpdate: false }))
      .toBe(false);
    cleanup();
    expect(await entersEditState({ editable: true, objectViaDataConfig: true, permUpdate: true }))
      .toBe(true);
  });

  it('a pure inline data grid with no object semantics is untouched', async () => {
    // No `objectName` → nothing to have a permission verdict ABOUT, and no
    // object schema to resolve a bucket from. The gate must not close on a
    // grid the platform has no opinion about; `can()` is never consulted, and
    // `isObjectInlineEditable(null)` resolves the default-writable bucket.
    // `permUpdate: false` is set anyway to prove the verdict is not reached.
    expect(await entersEditState({ editable: true, noObjectName: true, permUpdate: false }))
      .toBe(true);
  });
});
