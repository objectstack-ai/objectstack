/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7429 — field-level security on `ObjectTree`'s `$expand`.
 *
 * ## The site, and why it is the sharp one
 *
 * objectui#7215 / PR #7229 and objectui#7230 / PR #7428 gated `$expand` at six
 * of the helper's production call sites. This is one of the seven objectui#7429
 * recorded as still ungated. It passes **no column list at all**:
 *
 *     const expand = buildExpandFields(objectSchema?.fields);
 *
 * `buildExpandFields` reads an absent column list as "no column restriction"
 * and falls back to **every declared relation on the object**, denied ones
 * included. So a standalone tree does not merely fail to filter a column
 * list — it has none, and therefore asks the server to resolve the maximum
 * possible set of relations by default. That is the ordinary shape of this
 * surface, not a corner of it.
 *
 * ## Grading — defence-in-depth, stated the same way #7215 / #7230 stated it
 *
 * Against ObjectStack's own server this is not a live disclosure:
 * `plugin-security`'s `FieldMasker.maskRecord` does `delete result[field]` on
 * every unreadable key and objectql's expand path writes the resolved record
 * back under THAT SAME KEY, so one statement removes the expanded object and
 * the bare id alike; the expansion sub-read itself takes the referenced
 * object's full CRUD + RLS + FLS treatment (objectstack#7626). It is
 * load-bearing for a backend that does not strip, and the client-request side
 * is real regardless: this component asks the server to resolve relations the
 * current principal cannot read.
 *
 * ## The gate goes on the OUTPUT of `buildExpandFields` — copied, not re-derived
 *
 * PR #7229 settled the shape and PR #7428 applied it unchanged at four more
 * sites. On THIS site the input-gating route is not merely unsound, it is
 * unreachable: the call passes `undefined`, so there is no input to gate.
 * Gating the output also makes the "`checkField` answers false for an
 * undeclared key" trap structurally unreachable, because `buildExpandFields`
 * returns a subset of the object's DECLARED reference-bearing fields — every
 * name the gate judges is declared by construction.
 *
 * ## Why the stub `checkField` is an ALLOWLIST
 *
 * Inherited from `expandFls-7215.test.tsx` for its reason: the real
 * `PermissionProvider` answers `true` for a field no policy mentions, so a
 * denial has to be modelled by a stub that ENUMERATES readable fields — the
 * shape a server reporting field permissions actually has.
 *
 * ## `parent_id` is always readable in this fixture
 *
 * The tree's own parent pointer (`type: 'tree'`) is part of the same
 * reference-bearing family `buildExpandFields` expands (`EXPANDABLE_FIELD_TYPES`
 * in `packages/core/src/utils/expand-fields.ts`), so it is included in the
 * gate's judgment like any other relation — kept readable here so the pins
 * below stay about the `lookup` / `master_detail` distinction, not about
 * whether the hierarchy itself renders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';

/** Stable stub identity — `ObjectTree` carries `perms` in an effect dep list. */
const { permsStub, state } = vi.hoisted(() => {
  const state: { isLoaded: boolean; readable: string[] } = { isLoaded: true, readable: [] };
  return {
    state,
    permsStub: {
      get isLoaded() { return state.isLoaded; },
      checkField: (_object: string, field: string, action: string) =>
        action === 'read' ? state.readable.includes(field) : true,
      check: () => ({ allowed: true }),
      getFieldPermissions: () => [],
      getRowFilter: () => undefined,
      getObjectApiOperations: () => undefined,
      roles: [],
      userId: null,
      systemPermissions: undefined,
      hasCapabilities: () => true,
      can: () => true,
      cannot: () => false,
    },
  };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => permsStub as any };
});

import { ObjectTree } from './ObjectTree';

const OBJECT = 'business_unit';

const FIELDS: Record<string, any> = {
  name: { type: 'text', label: 'Name' },
  parent_id: { type: 'tree', reference: OBJECT, label: 'Parent' },
  account: { type: 'lookup', reference: 'accounts', label: 'Account' },
  secret_account: { type: 'lookup', reference: 'accounts', label: 'Secret Account' },
  owner_dept: { type: 'master_detail', reference: 'departments', label: 'Dept' },
};

const ROW = { id: 'bu1', name: 'Root unit', parent_id: null };

function schemaFor() {
  return {
    type: 'object-tree',
    objectName: OBJECT,
    parentField: 'parent_id',
    labelField: 'name',
    fields: ['name'],
  } as any;
}

function makeDataSource() {
  return {
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: FIELDS })),
    find: vi.fn(async () => [ROW]),
  } as Record<string, any>;
}

/**
 * Render a standalone tree and hand back the `$expand` it actually asked the
 * server for. The `waitFor` targets a real recorded call, so "the tree stopped
 * fetching" times out rather than reading as an empty expansion.
 */
async function expandFor(): Promise<string[]> {
  const ds = makeDataSource();
  render(<ObjectTree schema={schemaFor()} dataSource={ds as any} />);
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  return (ds.find.mock.calls.at(-1)?.[1]?.$expand ?? []) as string[];
}

beforeEach(() => {
  vi.clearAllMocks();
  state.isLoaded = true;
  state.readable = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ObjectTree — `$expand` is FLS-gated (objectui#7429)', () => {
  // ── PIN 1: the defect itself ────────────────────────────────────────────
  it('does NOT ask the server to EXPAND a lookup the principal cannot read', async () => {
    state.readable = ['id', 'name', 'parent_id', 'account'];
    const expand = await expandFor();
    expect(
      expand,
      'with no column list this tree expands EVERY declared relation, so a denied '
        + 'lookup is asked for by default rather than by configuration',
    ).not.toContain('secret_account');
  });

  // ── PIN 2: the live control — the gate narrows, it never empties ────────
  it('still expands a lookup the principal CAN read', async () => {
    state.readable = ['id', 'name', 'parent_id', 'account'];
    const expand = await expandFor();
    expect(expand).toContain('account');
  });

  // ── PIN 3: `master_detail`, not only `lookup` ───────────────────────────
  it('gates a denied `master_detail` root too, not only `lookup`', async () => {
    state.readable = ['id', 'name', 'parent_id', 'account'];
    const expand = await expandFor();
    expect(expand).not.toContain('owner_dept');
    expect(expand).toContain('account');
  });

  // ── PIN 4: the whole no-column-list set, asserted exactly ───────────────
  it('sends exactly the readable relations — asserted as a set, not merely by absence', async () => {
    state.readable = ['id', 'name', 'parent_id', 'account'];
    const expand = await expandFor();
    expect(
      expand.slice().sort(),
      'an absence assertion alone would also pass if the expansion had gone empty',
    ).toEqual(['account', 'parent_id']);
  });

  // ── PIN 5: every relation denied → no `$expand` at all, not a widened one ─
  it('omits `$expand` entirely when every declared relation is denied', async () => {
    state.readable = ['id', 'name'];
    const expand = await expandFor();
    expect(expand).toEqual([]);
  });

  // ── PIN 6: deferral — an unanswered policy filters nothing ─────────────
  it('filters NOTHING while `/me/permissions` has not answered', async () => {
    state.isLoaded = false;
    state.readable = [];
    const expand = await expandFor();
    expect(
      expand,
      'never filter on an unanswered policy — the no-provider default is `isLoaded: false` '
        + 'forever, and a tree with no PermissionProvider must keep expanding',
    ).toEqual(expect.arrayContaining(['account', 'secret_account', 'owner_dept', 'parent_id']));
  });
});
