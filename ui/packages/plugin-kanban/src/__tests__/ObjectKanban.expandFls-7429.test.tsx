/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7429 — field-level security on `ObjectKanban`'s `$expand`.
 *
 * ## The site, and why it is the sharp one
 *
 * objectui#7215 / PR #7229 and objectui#7230 / PR #7428 gated `$expand` at six
 * of the helper's production call sites. This is one of the seven objectui#7429
 * recorded as still ungated. It passes **no column list at all**:
 *
 *     const expand = buildExpandFields(objectDef?.fields);
 *
 * `buildExpandFields` reads an absent column list as "no column restriction"
 * and falls back to **every declared relation on the object**, denied ones
 * included. So a standalone board does not merely fail to filter a column
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
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';

/** Stable stub identity — `ObjectKanban` carries `perms` in an effect dep list. */
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

// Registers `object-kanban`.
import '../index';
// The board renders INSIDE `KanbanRenderer`'s `React.lazy` boundary. Importing
// the chunk at module scope bills the cold transform to the import phase
// (unbounded) instead of racing a `waitFor` budget under full parallelism —
// the objectui#3010 rule, same specifier as `index.tsx`'s factory so ESM's
// module cache makes that factory resolve immediately.
import '../KanbanImpl';

const OBJECT = 'deal';

/**
 * Two relations of DIFFERENT declared types so the pins cover the family
 * rather than one spelling: `account` is the readable `lookup` control,
 * `owner_dept` the denied `master_detail`, `secret_account` the denied
 * `lookup` under test.
 */
const DEAL_FIELDS: Record<string, any> = {
  name: { type: 'text', label: 'Name' },
  status: { type: 'text', label: 'Status' },
  account: { type: 'lookup', reference: 'account', label: 'Account' },
  secret_account: { type: 'lookup', reference: 'account', label: 'Secret Account' },
  owner_dept: { type: 'master_detail', reference: 'department', label: 'Dept' },
};

const ROW = { id: 'd1', name: 'Q3 renewal', status: 'open' };

function makeAdapter() {
  return {
    find: vi.fn(async () => ({ data: [ROW] })),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: DEAL_FIELDS })),
  } as Record<string, any>;
}

/**
 * Render a standalone board and hand back the `$expand` it actually asked the
 * server for. The `waitFor` targets a real recorded call, so "the board
 * stopped fetching" times out rather than reading as an empty expansion.
 */
async function expandFor(): Promise<string[]> {
  const ds = makeAdapter();
  render(
    <SchemaRendererProvider dataSource={ds as any}>
      <SchemaRenderer
        schema={{
          type: 'object-kanban',
          objectName: OBJECT,
          groupBy: 'status',
          columns: [{ id: 'open', title: 'Open' }],
        } as any}
      />
    </SchemaRendererProvider>,
  );
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

describe('ObjectKanban — `$expand` is FLS-gated (objectui#7429)', () => {
  // ── PIN 1: the defect itself ────────────────────────────────────────────
  it('does NOT ask the server to EXPAND a lookup the principal cannot read', async () => {
    state.readable = ['id', 'name', 'status', 'account'];
    const expand = await expandFor();
    expect(
      expand,
      'with no column list this board expands EVERY declared relation, so a denied '
        + 'lookup is asked for by default rather than by configuration',
    ).not.toContain('secret_account');
  });

  // ── PIN 2: the live control — the gate narrows, it never empties ────────
  it('still expands a lookup the principal CAN read', async () => {
    state.readable = ['id', 'name', 'status', 'account'];
    const expand = await expandFor();
    expect(expand).toContain('account');
  });

  // ── PIN 3: `master_detail`, not only `lookup` ───────────────────────────
  it('gates a denied `master_detail` root too, not only `lookup`', async () => {
    state.readable = ['id', 'name', 'status', 'account'];
    const expand = await expandFor();
    expect(expand).not.toContain('owner_dept');
    expect(expand).toContain('account');
  });

  // ── PIN 4: the whole no-column-list set, asserted exactly ───────────────
  it('sends exactly the readable relations — asserted as a set, not merely by absence', async () => {
    state.readable = ['id', 'name', 'status', 'account'];
    const expand = await expandFor();
    expect(
      expand.slice().sort(),
      'an absence assertion alone would also pass if the expansion had gone empty',
    ).toEqual(['account']);
  });

  // ── PIN 5: every relation denied → no `$expand` at all, not a widened one ─
  it('omits `$expand` entirely when every declared relation is denied', async () => {
    state.readable = ['id', 'name', 'status'];
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
        + 'forever, and a board with no PermissionProvider must keep expanding',
    ).toEqual(expect.arrayContaining(['account', 'secret_account', 'owner_dept']));
  });
});
