/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7215 — field-level security on the `$expand` PROJECTION.
 *
 * ## The half objectui#6898 did not close
 *
 * objectui#6898 gated `$select`. `$expand` was left ungated at both projection
 * sites: `buildExpandFields` was handed the RAW column list, so a `lookup` /
 * `master_detail` / `user` / `tree` column the principal cannot read was still
 * expanded. `$select` on a denied lookup asks for a bare foreign key; `$expand`
 * on the same field asks the server to RESOLVE it and return the related
 * record — the larger of the two disclosures was the ungated one.
 *
 * ## Grading, measured rather than assumed — same as objectui#6898
 *
 * Against ObjectStack's own server this is defence-in-depth, not a live leak,
 * and for the same mechanism the #6898 comment records: `plugin-security`'s
 * read middleware runs `FieldMasker.maskResults`, whose `maskRecord` does
 * `delete result[field]` on every unreadable key, and objectql's expand path
 * writes the resolved record back under THAT SAME KEY
 * (`record[fieldName] = recordMap.get(...)` in `engine.ts`), so the expanded
 * object is deleted by the same statement that deletes the bare id. The
 * expansion sub-read is itself gated (`__expandRead` takes the referenced
 * object's full CRUD + RLS + FLS treatment since objectstack#7626), so nothing
 * is disclosed on that path either. It is load-bearing for a backend that does
 * not strip — the same argument objectui#6723 / #6799 / #6898 accepted.
 *
 * ## Why the gate goes on the OUTPUT of `buildExpandFields`, not its input
 *
 * The card's suggested route was to filter the COLUMN LIST before it reaches
 * `buildExpandFields`. Measured here, that route is unsound in two directions,
 * and both are pinned below:
 *
 *  - `buildExpandFields` reads an EMPTY column list as "no column restriction"
 *    (`columns.length > 0` guards the intersection) and falls back to expanding
 *    EVERY declared relation. So a view whose only relational column is denied
 *    would have its input gated down to `[]` and its `$expand` WIDENED from the
 *    one denied field to all of them — PIN 6.
 *  - a view that declares no columns at all passes `undefined` and never had an
 *    input to gate — PIN 5.
 *
 * Gating the output satisfies the ordering requirement the card states
 * (intersect against the object's DECLARED fields first, ask `checkField` only
 * about survivors) structurally rather than by convention: `buildExpandFields`
 * returns a subset of the declared reference-bearing fields, so every name the
 * gate judges is declared by construction and the "`checkField` answers false
 * for an undeclared key" trap cannot be reached — PIN 4.
 *
 * ## Why the stub `checkField` is an ALLOWLIST
 *
 * Inherited from `projectionFls-6898.test.tsx` for its reason:
 * `PermissionProvider` answers `true` for a field no policy mentions, so under
 * it the undeclared-key limit would be green in both worlds for the wrong
 * reason. The stub models a server that ENUMERATES readable fields.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

/** Stable stub identity — `ObjectGrid` carries `perms` in memo dep arrays. */
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

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';

const OBJECT = 'opportunity';

/**
 * Two relations of DIFFERENT declared types, so the pins cover the family
 * rather than one spelling: `account` is the readable `lookup` control and
 * `owner_dept` the denied `master_detail`. `secret_account` is the denied
 * `lookup` — the field under test. `computed_score` is deliberately NOT
 * declared: the derived / host-joined key the ordering limit protects.
 */
const OBJECT_FIELDS = {
  name: { type: 'text', label: 'Name' },
  stage: { type: 'select', label: 'Stage' },
  account: { type: 'lookup', reference: 'accounts', label: 'Account' },
  secret_account: { type: 'lookup', reference: 'accounts', label: 'Secret Account' },
  owner_dept: { type: 'master_detail', reference: 'departments', label: 'Dept' },
};

const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  // objectui#10881: over a data source with no group header query a grouped
  // grid refuses and asks for nothing, so PIN 7's grouping needs one. It is
  // answered with no groups: PIN 7 groups only by a key this principal cannot
  // read, which the server is never asked to group by, so that grid fetches
  // its flat window — the projection under test.
  queryGroupHeaders: vi.fn().mockResolvedValue([]),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
});

/** Render a grid and return the `$expand` it actually asked the server for. */
const expandFor = async (schemaExtra: Record<string, unknown>): Promise<string[]> => {
  const ds = makeDataSource();
  const schema: any = { type: 'object-grid', objectName: OBJECT, ...schemaExtra };
  render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={ds as never} />
    </ActionProvider>,
  );
  await vi.waitFor(() => expect(ds.find).toHaveBeenCalled());
  return (ds.find.mock.calls.at(-1)?.[1]?.$expand ?? []) as string[];
};

beforeEach(() => {
  vi.clearAllMocks();
  state.isLoaded = true;
  state.readable = [];
});
afterEach(() => cleanup());

describe('ObjectGrid — `$expand` is FLS-gated (objectui#7215)', () => {
  // ── PIN 1: the defect itself ────────────────────────────────────────────
  it('does NOT ask the server to EXPAND a lookup the principal cannot read', async () => {
    state.readable = ['name', 'account', 'id'];
    const expand = await expandFor({ columns: ['name', 'account', 'secret_account'] });
    expect(
      expand,
      'objectui#6898 closed `$select` on this same field; `$expand` asks the server to '
        + 'RESOLVE it and hand back the related record, which is the larger disclosure',
    ).not.toContain('secret_account');
  });

  // ── PIN 2: the live control — the gate narrows, it never empties ────────
  it('still expands a lookup the principal CAN read', async () => {
    state.readable = ['name', 'account', 'id'];
    const expand = await expandFor({ columns: ['name', 'account', 'secret_account'] });
    expect(
      expand,
      'a gate that killed all expansion would turn every related cell into a bare id — '
        + 'the "8UY9zHWBfjYjYor4 instead of Initech Solutions" failure this codebase already records',
    ).toContain('account');
  });

  // ── PIN 3: `master_detail`, not only `lookup` ───────────────────────────
  it('gates a denied `master_detail` root too, not only `lookup`', async () => {
    state.readable = ['name', 'account', 'id'];
    const expand = await expandFor({ columns: ['name', 'account', 'owner_dept'] });
    expect(expand).not.toContain('owner_dept');
    expect(expand).toContain('account');
  });

  // ── PIN 4: THE ORDERING LIMIT — an undeclared column is not judged ──────
  it('leaves an UNDECLARED (derived / host-joined) column alone and keeps expanding', async () => {
    state.readable = ['name', 'account', 'id'];
    const expand = await expandFor({ columns: ['name', 'computed_score', 'account'] });
    expect(
      expand,
      '`checkField` answers false for a key no policy mentions, so a gate applied in the '
        + 'wrong order would drop the derived column and, with it, the whole expansion',
    ).toEqual(['account']);
  });

  // ── PIN 5: reachable with NO column list at all ─────────────────────────
  it('gates the no-columns case, where every declared relation is expanded', async () => {
    state.readable = ['name', 'account', 'id'];
    const expand = await expandFor({});
    expect(
      expand,
      'with no `columns` the helper expands EVERY declared relation, so there is no input '
        + 'list to gate — this is the case an input-side filter cannot reach at all',
    ).toEqual(['account']);
  });

  // ── PIN 6: the trap — gating the INPUT to empty WIDENS the expansion ────
  it('does not WIDEN to every relation when the only relational column is denied', async () => {
    state.readable = ['name', 'id'];
    const expand = await expandFor({ columns: ['name', 'secret_account'] });
    expect(
      expand,
      '`buildExpandFields` reads an empty column list as "no column restriction" and falls '
        + 'back to every declared relation, so a gate applied to its INPUT turns one denied '
        + 'expansion into all of them',
    ).toEqual([]);
  });

  // ── PIN 7: the grouping augmentation rides the same gate ───────────────
  it('gates a denied relation reached through `grouping.fields[]`', async () => {
    state.readable = ['name', 'account', 'id'];
    const expand = await expandFor({
      columns: ['name', 'account'],
      grouping: { fields: [{ field: 'secret_account', order: 'asc', collapsed: false }] },
    });
    expect(
      expand,
      'objectui#7179 unions the grouping fields into the expand column list; that union is '
        + 'reached by the same principal and takes the same gate',
    ).not.toContain('secret_account');
    expect(expand).toContain('account');
  });

  // ── PIN 8: deferral — an unanswered policy filters nothing ─────────────
  it('filters NOTHING while `/me/permissions` has not answered', async () => {
    state.isLoaded = false;
    state.readable = [];
    const expand = await expandFor({ columns: ['name', 'account', 'secret_account'] });
    expect(
      expand,
      'never filter on an unanswered policy — the no-provider default is `isLoaded: false` '
        + 'forever, and a grid with no PermissionProvider must keep expanding',
    ).toEqual(expect.arrayContaining(['account', 'secret_account']));
  });
});
