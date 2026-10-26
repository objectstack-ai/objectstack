/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7215 — field-level security on `$expand`, on the SECOND projection
 * site.
 *
 * `plugin-grid`'s `expandFls-7215.test.tsx` pins the first. The two exist
 * separately for the reason objectui#7179 measured: `ObjectGrid` builds its own
 * query when it fetches for itself, `ListView` builds one when it fetches and
 * hands the rows down — independent code paths, and a fix landing on one of
 * them ships with a green suite and a still-open hole on the other mounting
 * path. The ablation in the PR body demonstrates that property rather than
 * asserting it.
 *
 * ## This site leaks the denied field into `$select` as well
 *
 * Not a second card — the same one, measured. This builder's `$select` IS
 * FLS-gated (`rawCols.filter(c => perms.checkField(...))`), and then adds the
 * expand roots back unconditionally: `for (const e of expandFields)
 * required.add(e)`, on the stated ground that those roots are "known-valid
 * because `buildExpandFields()` derived them from the object schema". Valid,
 * yes; READABLE, never asked. So a denied lookup column walked back through
 * that union into `$select`, defeating objectui#6898's gate on this path.
 * Gating `expandFields` closes both halves at once — PIN 3.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

/** Stable stub identity — the memo and the fetch effect carry `perms` in deps. */
const { permsStub, state } = vi.hoisted(() => {
  const state: { isLoaded: boolean; readable: string[] } = {
    isLoaded: true,
    readable: [],
  };
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

import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';

const OBJECT = 'duly_task';

/**
 * `account` is the readable `lookup` control, `secret_account` the denied one,
 * `owner_dept` a denied `master_detail` so the pins cover the family rather
 * than one spelling. `computed_score` is deliberately NOT declared.
 */
const objectDef = {
  name: OBJECT,
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    account: { name: 'account', type: 'lookup', reference: 'accounts', label: 'Account' },
    secret_account: { name: 'secret_account', type: 'lookup', reference: 'accounts', label: 'Secret' },
    owner_dept: { name: 'owner_dept', type: 'master_detail', reference: 'departments', label: 'Dept' },
  },
};

const makeDataSource = () =>
  ({
    find: vi.fn(async () => ({ data: [], total: 0 })),
    // objectui#10881: over a data source that declares no `queryGroupHeaders`
    // a grouped grid view is refused before this component fetches anything.
    // Declaring it keeps the window fetch the grouping pins read the
    // projection from: what the filter chip counts and the client export read.
    queryGroupHeaders: vi.fn(async () => []),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => objectDef),
  }) as any;

/** Mount a list view and return the params it actually asked the server for. */
async function paramsFor(schemaExtra: Record<string, unknown>) {
  const dataSource = makeDataSource();
  const schema: any = {
    type: 'list-view',
    objectName: OBJECT,
    viewType: 'grid',
    ...schemaExtra,
  };
  render(
    <SchemaRendererProvider dataSource={dataSource}>
      <ListView schema={schema} dataSource={dataSource} />
    </SchemaRendererProvider>,
  );
  await waitFor(() => expect(dataSource.find).toHaveBeenCalled());
  const call = dataSource.find.mock.calls.at(-1)?.[1] ?? {};
  return {
    select: (call.$select ?? []) as string[],
    expand: (call.$expand ?? []) as string[],
  };
}

const expandFor = async (schemaExtra: Record<string, unknown>) =>
  (await paramsFor(schemaExtra)).expand;

beforeEach(() => {
  vi.clearAllMocks();
  state.isLoaded = true;
  state.readable = [];
});
afterEach(() => cleanup());

describe('ListView — `$expand` is FLS-gated (objectui#7215)', () => {
  // ── PIN 1: the defect itself, on the second build site ─────────────────
  it('does NOT ask the server to EXPAND a lookup the principal cannot read', async () => {
    state.readable = ['subject', 'account', 'id'];
    const expand = await expandFor({ columns: ['subject', 'account', 'secret_account'] });
    expect(
      expand,
      'the two projection builders are independent paths — closing only the grid leaves this '
        + 'one open on every mounting that fetches through ListView',
    ).not.toContain('secret_account');
  });

  // ── PIN 2: the live control ────────────────────────────────────────────
  it('still expands a lookup the principal CAN read', async () => {
    state.readable = ['subject', 'account', 'id'];
    const expand = await expandFor({ columns: ['subject', 'account', 'secret_account'] });
    expect(expand).toContain('account');
  });

  // ── PIN 3: the denied field walked back into `$select` too ─────────────
  it('stops the denied field re-entering `$select` through the expand-roots union', async () => {
    state.readable = ['subject', 'account', 'id'];
    const { select } = await paramsFor({ columns: ['subject', 'account', 'secret_account'] });
    expect(
      select,
      'the `$select` gate drops the denied column and then `for (const e of expandFields) '
        + 'required.add(e)` puts it straight back — objectui#6898 is defeated on this path '
        + 'by the ungated expand roots, not by its own filter',
    ).not.toContain('secret_account');
    expect(select).toContain('account');
  });

  // ── PIN 4: `master_detail`, not only `lookup` ──────────────────────────
  it('gates a denied `master_detail` root too', async () => {
    state.readable = ['subject', 'account', 'id'];
    const expand = await expandFor({ columns: ['subject', 'account', 'owner_dept'] });
    expect(expand).not.toContain('owner_dept');
    expect(expand).toContain('account');
  });

  // ── PIN 5: THE ORDERING LIMIT ──────────────────────────────────────────
  it('leaves an UNDECLARED (derived / host-joined) column alone and keeps expanding', async () => {
    state.readable = ['subject', 'account', 'id'];
    const expand = await expandFor({ columns: ['subject', 'computed_score', 'account'] });
    expect(
      expand,
      '`checkField` answers false for a key no policy mentions; a gate in the wrong order '
        + 'would judge the derived column and take the expansion down with it',
    ).toEqual(['account']);
  });

  // ── PIN 6: reachable with no relational column named at all ────────────
  it('gates the no-columns case, where every declared relation is expanded', async () => {
    state.readable = ['subject', 'account', 'id'];
    const expand = await expandFor({});
    expect(expand).toEqual(['account']);
  });

  // ── PIN 7: the trap — gating the INPUT to empty WIDENS the expansion ───
  it('does not WIDEN to every relation when every collected column is denied', async () => {
    state.readable = ['subject', 'id'];
    const expand = await expandFor({ columns: ['secret_account'] });
    expect(
      expand,
      '`buildExpandFields` reads an empty column list as "no column restriction", so a gate '
        + 'applied to its INPUT turns one denied expansion into every relation the object has',
    ).toEqual([]);
  });

  // ── PIN 8: the view bindings reach the same helper ─────────────────────
  it('gates a denied relation reached through a kanban card binding', async () => {
    state.readable = ['subject', 'account', 'id'];
    const expand = await expandFor({
      columns: ['subject', 'account'],
      kanban: { groupByField: 'secret_account' },
    });
    expect(
      expand,
      'this memo collects the alternate views\' field bindings as well as `columns`; every '
        + 'route into the expand list is the same principal asking for the same record',
    ).not.toContain('secret_account');
    expect(expand).toContain('account');
  });

  // ── PIN 9: the grouping augmentation rides the same gate ───────────────
  it('gates a denied relation reached through `grouping.fields[]`', async () => {
    state.readable = ['subject', 'account', 'id'];
    const expand = await expandFor({
      columns: ['subject', 'account'],
      grouping: { fields: [{ field: 'secret_account', order: 'asc', collapsed: false }] },
    });
    expect(expand).not.toContain('secret_account');
    expect(expand).toContain('account');
  });

  // ── PIN 10: deferral — an unanswered policy filters nothing ────────────
  it('filters NOTHING while `/me/permissions` has not answered', async () => {
    state.isLoaded = false;
    state.readable = [];
    const expand = await expandFor({ columns: ['subject', 'account', 'secret_account'] });
    expect(
      expand,
      'never filter on an unanswered policy — a list with no PermissionProvider must keep '
        + 'expanding, or every related cell degrades to a bare id',
    ).toEqual(expect.arrayContaining(['account', 'secret_account']));
  });
});
