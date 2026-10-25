/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectGrid's inline add-record row vs the principal's create verdict (#5148).
 *
 * The `create` face of the shape #5143 closed for `update`. `ObjectGrid`
 * resolves `permissionUpdate` / `permissionDelete` through `perms.can(...)` and
 * ANDs each into the affordance it governs, but the Airtable-style add-record
 * row was gated on `!!operations?.create` ALONE — an authoring flag that says
 * whether the affordance was *wired*, never a permission grant. So one
 * component answered "may this user create records here?" two opposite ways on
 * the same screen: the toolbar's New button hid itself for a principal with no
 * `create` grant, while the add row below it stayed live, walked the user
 * through filling it in, and earned a server 403.
 *
 * The conjunction is the one the sibling rulings already established —
 * #4646 / PR #5145 (`objectCanCreate = affordances.create ∧ can(obj,'create')`)
 * and #5143 (`inlineEditable = schema.editable ∧ objectInlineEditable`) — with
 * the operation moved to `create`.
 *
 * These probe the REAL ObjectGrid through `usePermissions` and assert the
 * USER-VISIBLE outcome — is the add-record row in the DOM — rather than the
 * prop that produces it.
 *
 * ⚠️ The fail-open leg is load-bearing, not decoration. `plugin-designer`'s
 * `FieldDesigner` and `ObjectManager` both build grids with
 * `operations: { create: true, update: true, delete: true }` when not
 * read-only, and designer surfaces typically run with NO `PermissionProvider`,
 * where `can()` answers `true`. That is the only thing standing between this
 * gate and a designer whose add row vanished. It is pinned here.
 *
 * Sibling coverage: `inlineEditPermissionGate.test.tsx` owns the inline-edit
 * surface (#5143); `rowCrudEffectiveOps.test.tsx` owns the row kebab / bulk bar
 * matrix (#3720 / #4096). This file owns the add-record row.
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

// Stable stub identity: ObjectGrid carries `perms` in `useMemo` dependency
// arrays, so a fresh object per call would churn those memos every render.
// Mirrors `inlineEditPermissionGate.test.tsx`'s hoisted-state pattern.
const { permsStub, state } = vi.hoisted(() => {
  const state: {
    /** `/me/permissions` create verdict for the caller. */
    permCreate: boolean;
    /** Server-resolved effective API operation set; `undefined` = no annotation. */
    effectiveOps: string[] | undefined;
    /** Bypass the stub and run the REAL provider-less hook instead. */
    noProvider: boolean;
  } = { permCreate: true, effectiveOps: undefined, noProvider: false };
  return {
    state,
    permsStub: {
      // `isLoaded: false` keeps the FIELD-level filter out of the way so the
      // object-level gate is the only variable under test.
      isLoaded: false,
      checkField: () => true,
      getObjectApiOperations: () => state.effectiveOps,
      can: (_obj: string, action: string) =>
        action === 'create' ? state.permCreate : true,
    },
  };
});

// The real module stays reachable so the no-`PermissionProvider` case exercises
// the ACTUAL fail-open fallback (`check: () => ({ allowed: true })`) instead of
// a hand-written imitation of it. The real hook is invoked on every render so
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

beforeAll(() => {
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = vi.fn() as any;
  }
});

const OBJECT = 'add_row_gate_object';

interface Case {
  /** View schema `operations`; omit for a grid that declares none. */
  operations?: Record<string, boolean>;
  /** `/me/permissions` create verdict for the caller; default `true`. */
  permCreate?: boolean;
  /** Server-resolved effective API operation set. */
  effectiveOps?: string[];
  /** Render with NO `PermissionProvider` (standalone embed / Studio designer). */
  noProvider?: boolean;
  /** Drop `objectName` — a pure inline data grid with no object semantics. */
  noObjectName?: boolean;
  /**
   * Address the object through the DATA CONFIG only (`{ provider: 'object',
   * object: … }`) with no top-level `objectName`. ObjectGrid resolves the name
   * from either.
   */
  objectViaDataConfig?: boolean;
}

function makeDataSource() {
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
    getObjectSchema: async (name: string) => ({
      name,
      fields: { id: { type: 'text' }, name: { type: 'text', label: 'Name' } },
    }),
  } as any;
}

function renderGrid(c: Case) {
  state.permCreate = c.permCreate ?? true;
  state.effectiveOps = c.effectiveOps;
  state.noProvider = c.noProvider ?? false;
  const ds = makeDataSource();
  const schema: any = {
    type: 'object-grid',
    ...(c.noObjectName || c.objectViaDataConfig ? {} : { objectName: OBJECT }),
    ...(c.objectViaDataConfig ? { data: { provider: 'object', object: OBJECT } } : {}),
    ...(c.operations != null ? { operations: c.operations } : {}),
    columns: [{ field: 'name', label: 'Name', type: 'text' }],
    pagination: { pageSize: 50 },
    ...(c.noObjectName
      ? { data: { provider: 'value', items: [{ id: 'r1', name: 'Row One' }, { id: 'r2', name: 'Row Two' }] } }
      : {}),
  };
  return render(
    <ActionProvider>
      <SchemaRendererProvider dataSource={ds}>
        <ObjectGrid schema={schema} dataSource={ds} onAddRecord={() => {}} />
      </SchemaRendererProvider>
    </ActionProvider>,
  );
}

/**
 * Render and report whether the Airtable-style add-record row is in the DOM.
 * `data-testid="add-record-row"` is DataTable's own handle on the row that
 * `showAddRow` renders, so this is the user-visible face of the gate.
 */
async function showsAddRow(c: Case): Promise<boolean> {
  renderGrid(c);
  await waitFor(() => expect(screen.getByText('Row One')).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText('Row Two')).toBeInTheDocument());
  return screen.queryAllByTestId('add-record-row').length > 0;
}

const DECLARED = { create: true, update: true, delete: true };

beforeEach(() => {
  state.permCreate = true;
  state.effectiveOps = undefined;
  state.noProvider = false;
  __clearRecordCrudVerdictCache();
  installExplainDouble();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ObjectGrid add-record row vs can(object, 'create') (#5148)", () => {
  it('a — with the grant: a declared `operations.create` still shows the add row', async () => {
    expect(await showsAddRow({ operations: DECLARED, permCreate: true })).toBe(true);
  });

  it('b — no create grant: a declared `operations.create` no longer shows the add row', async () => {
    // THE DEFECT. Before the fix the author declaration was the whole gate, so
    // a principal with no `create` grant was offered the row, filled it in, and
    // was stopped only by the server's 403 — while the toolbar's New button on
    // the very same screen had already hidden itself for that principal.
    expect(await showsAddRow({ operations: DECLARED, permCreate: false })).toBe(false);
  });

  it('c — the author declaration still governs: a grant cannot open a row that was never declared', async () => {
    // A conjunction, not a replacement. The verdict narrows; it never widens.
    expect(await showsAddRow({ operations: { create: false }, permCreate: true })).toBe(false);
    cleanup();
    // …and a grid that declares no `operations` at all is untouched: the
    // `{ update: !!onEdit, delete: !!onDelete }` default carries no `create`.
    expect(await showsAddRow({ permCreate: true })).toBe(false);
  });

  it('d — no PermissionProvider (Studio designer / standalone embed) fails OPEN', async () => {
    // The REAL provider-less hook, not the stub. `plugin-designer`'s
    // `FieldDesigner` (`:172`) and `ObjectManager` (`:119`) BOTH build grids
    // with `operations: { create: true, update: true, delete: true }` when not
    // read-only, and both typically render with no `PermissionProvider`
    // mounted. `can()` answers `true` there, so the designer's add row must
    // survive this change untouched. If this leg ever goes red, a missing
    // check has been converted into a regression.
    expect(await showsAddRow({ operations: DECLARED, noProvider: true })).toBe(true);
  });

  it('e — the two answers now AGREE, pinned from both sides', async () => {
    // The disagreement in #5148's title: without the grant the row is
    // withheld; with it the row is offered. Both directions pinned so a future
    // change that re-opens either half has to fail a case here.
    expect(await showsAddRow({ operations: DECLARED, permCreate: false })).toBe(false);
    cleanup();
    expect(await showsAddRow({ operations: DECLARED, permCreate: true })).toBe(true);
  });

  it('f — an object addressed through the DATA CONFIG is gated too', async () => {
    // ObjectGrid resolves `objectName = dataConfig.object ?? schema.objectName`,
    // so a grid whose object identity arrives ONLY through `data: { provider:
    // 'object', object: … }` must be judged by the same verdict. Pinned so that
    // narrowing `objectName` back to the schema key fails here rather than
    // silently reopening the door on that shape.
    expect(await showsAddRow({ operations: DECLARED, objectViaDataConfig: true, permCreate: false }))
      .toBe(false);
    cleanup();
    expect(await showsAddRow({ operations: DECLARED, objectViaDataConfig: true, permCreate: true }))
      .toBe(true);
  });

  it('g — a pure inline data grid with no object semantics is untouched', async () => {
    // No `objectName` → nothing to have a permission verdict ABOUT. The gate
    // must not close on a grid the platform has no opinion about; `can()` is
    // never consulted. `permCreate: false` is set anyway to prove the verdict
    // is not reached.
    expect(await showsAddRow({ operations: DECLARED, noObjectName: true, permCreate: false }))
      .toBe(true);
  });
});
