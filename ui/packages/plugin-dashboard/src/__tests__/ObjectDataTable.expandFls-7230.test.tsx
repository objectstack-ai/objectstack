/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7230 — field-level security on `ObjectDataTable`'s `$expand`.
 *
 * ## The site, and why it needs its own file
 *
 * This is the one of the five that does NOT call `buildExpandFields`. It builds
 * its own `$expand` whitelist in `computeLookupExpand`, and that helper has the
 * SAME two-arm shape and therefore the same two exposures:
 *
 *   - an explicit `columns` list → expand the relations the author named;
 *   - `cols.length > 0` false (auto-derive mode — the drill-down drawer, and
 *     any widget that names no columns) → expand EVERY lookup-type field the
 *     object schema declares.
 *
 * Neither arm asks whether the principal may READ the relation, so the second
 * arm asks the server to resolve every declared relation on the object, denied
 * ones included.
 *
 * ## The gate goes on the OUTPUT, for the same structural reason
 *
 * `computeLookupExpand` resolves both arms through `fieldsByName` — the object
 * schema's own field map — so every name it returns is DECLARED by
 * construction, exactly as `buildExpandFields`'s is. Gating its output
 * therefore inherits PR #7229's property unchanged: the "`checkField` answers
 * false for an undeclared key" trap is unreachable, and a derived /
 * host-joined column is never judged. Gating the INPUT would be unsound here
 * for the same measured reason as everywhere else — `cols.length > 0` reads an
 * emptied column list as "no restriction" and widens to every relation.
 *
 * ## Grading
 *
 * Defence-in-depth against ObjectStack's own server, as objectui#7215 recorded
 * (`FieldMasker.maskRecord` deletes the key the expansion is written back
 * under; the sub-read takes the referenced object's own CRUD + RLS + FLS,
 * objectstack#7626), and load-bearing for a backend that does not strip.
 *
 * The stub `checkField` is an ALLOWLIST, per `expandFls-7215.test.tsx`.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';

/** Stable stub identity — `perms` rides the fetch effect's dependency list. */
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

import { ObjectDataTable } from '../ObjectDataTable';

const OBJECT = 'opportunity';

/**
 * `account` is the readable `lookup` control, `owner_dept` the denied
 * `master_detail`, `secret_account` the denied `lookup` under test.
 * `computed_score` is never declared here — the derived key the ordering limit
 * protects.
 */
const OBJECT_FIELDS: Record<string, any> = {
  name: { type: 'text', label: 'Name' },
  amount: { type: 'currency', label: 'Amount' },
  account: { type: 'lookup', reference: 'accounts', label: 'Account' },
  secret_account: { type: 'lookup', reference: 'accounts', label: 'Secret Account' },
  owner_dept: { type: 'master_detail', reference: 'departments', label: 'Dept' },
};

const ROWS = [{ id: 'o1', name: 'Acme', amount: 10 }];

function makeDataSource() {
  return {
    find: vi.fn(async () => ({ data: ROWS })),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
  } as Record<string, any>;
}

/**
 * Render the widget and hand back the `$expand` it actually asked the server
 * for. The `waitFor` targets a recorded `find`, so a widget that stopped
 * fetching times out rather than reading as an empty expansion.
 */
async function expandFor(schemaExtra: Record<string, unknown>): Promise<string[]> {
  const ds = makeDataSource();
  render(
    <ObjectDataTable
      schema={{ type: 'object-data-table', objectName: OBJECT, ...schemaExtra } as never}
      dataSource={ds as never}
    />,
  );
  // ⚠️ Read the SCHEMA-DEPENDENT query. Since objectui#10664 the widget's query
  // waits on the settled definition (`useSettledSchema`), so a mount issues ONE
  // `find` and it is that one. The count is asserted, not assumed: an ungated
  // widget issues an unexpanded `find` first (`computeLookupExpand` returns `[]`
  // without a field map), and reading it would report "no expansion" for every
  // case and turn this whole file green for the wrong reason.
  await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalled());
  await waitFor(() => expect(ds.find).toHaveBeenCalled());
  await act(() => new Promise<void>((resolve) => setTimeout(resolve, 50)));
  expect(ds.find, 'more than one read per mount: the settled-definition gate is gone').toHaveBeenCalledTimes(1);
  return (ds.find.mock.calls[0]?.[1]?.$expand ?? []) as string[];
}

const AUTHORED_COLUMNS = {
  columns: [
    { field: 'name', label: 'Name' },
    { field: 'account', label: 'Account' },
    { field: 'secret_account', label: 'Secret Account' },
    { field: 'owner_dept', label: 'Dept' },
  ],
};

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

describe('ObjectDataTable — `$expand` is FLS-gated (objectui#7230)', () => {
  describe('the explicit-columns arm', () => {
    // ── PIN 1: the defect ────────────────────────────────────────────────
    it('does NOT ask the server to EXPAND a lookup the principal cannot read', async () => {
      state.readable = ['id', 'name', 'amount', 'account'];
      const expand = await expandFor(AUTHORED_COLUMNS);
      expect(expand).not.toContain('secret_account');
    });

    // ── PIN 2: `master_detail`, not only `lookup` ───────────────────────
    it('gates a denied `master_detail` column too', async () => {
      state.readable = ['id', 'name', 'amount', 'account'];
      const expand = await expandFor(AUTHORED_COLUMNS);
      expect(expand).not.toContain('owner_dept');
    });

    // ── PIN 3: the live control ─────────────────────────────────────────
    it('still expands a lookup the principal CAN read', async () => {
      state.readable = ['id', 'name', 'amount', 'account'];
      const expand = await expandFor(AUTHORED_COLUMNS);
      expect(
        expand,
        'a gate that killed all expansion would render a bare foreign-key id in every '
          + 'lookup cell — the failure `computeLookupExpand` exists to prevent',
      ).toEqual(['account']);
    });
  });

  describe('the auto-derive arm — no columns, every declared relation expanded', () => {
    // ── PIN 4: the sharp case ───────────────────────────────────────────
    it('gates the no-columns case, where every lookup-type field is expanded', async () => {
      state.readable = ['id', 'name', 'amount', 'account'];
      const expand = await expandFor({});
      expect(
        expand,
        'with no `columns` the whitelist arm falls through to every declared relation, so '
          + 'there is no input list to gate — the case an input-side filter cannot reach',
      ).toEqual(['account']);
    });

    // ── PIN 5: every relation denied → nothing expanded, not everything ──
    it('sends no `$expand` when every declared relation is denied', async () => {
      state.readable = ['id', 'name', 'amount'];
      const expand = await expandFor({});
      expect(expand).toEqual([]);
    });
  });

  describe('limits', () => {
    // ── PIN 6: THE ORDERING LIMIT — an undeclared column is not judged ───
    it('leaves an UNDECLARED (derived / host-joined) column alone and keeps expanding', async () => {
      state.readable = ['id', 'name', 'amount', 'account'];
      const expand = await expandFor({
        columns: [
          { field: 'name', label: 'Name' },
          { field: 'computed_score', label: 'Score' },
          { field: 'account', label: 'Account' },
        ],
      });
      expect(
        expand,
        '`computeLookupExpand` resolves both arms through the object schema’s own field '
          + 'map, so a derived column is absent from its OUTPUT and is never judged',
      ).toEqual(['account']);
    });

    // ── PIN 7: deferral — an unanswered policy filters nothing ──────────
    it('filters NOTHING while `/me/permissions` has not answered', async () => {
      state.isLoaded = false;
      state.readable = [];
      const expand = await expandFor(AUTHORED_COLUMNS);
      expect(
        expand,
        'never filter on an unanswered policy — the no-provider default is `isLoaded: false` '
          + 'forever, and a dashboard table with no PermissionProvider must keep expanding',
      ).toEqual(expect.arrayContaining(['account', 'secret_account', 'owner_dept']));
    });
  });
});
