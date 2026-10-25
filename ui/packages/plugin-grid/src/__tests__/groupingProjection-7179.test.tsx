/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7179 — the fields a grid GROUPS BY reach the query.
 *
 * ## The defect
 *
 * `$select` was built from `columns` alone. A view declaring
 * `grouping: { fields: [{ field: 'business_unit' }] }` on a field absent from
 * its columns therefore never asked the server for that field, so it was
 * `undefined` on every row by the time grouping ran and `buildSegmentLabel`
 * answered `(empty)` for all of them: ONE group holding every record, with no
 * error, no warning and no empty state.
 *
 * ## The `(empty)` guard is NOT the bug and is deliberately untouched
 *
 * `useGroupedData`'s first line is right for a genuinely empty value and cannot
 * distinguish it from a field that was never fetched. The defect is upstream of
 * it, in the projection. Nothing here asserts on that guard.
 *
 * ## Both directions of the hazard are pinned, because they point OPPOSITE ways
 *
 * The naive union — concatenate every grouping field into `$select` — is
 * STRICTLY WORSE than the bug it fixes on any backend that answers an unknown
 * select key with an empty result set rather than ignoring it (the cloud
 * multi-tenant runtime does exactly that). It would trade one `(empty)` group
 * holding all the rows for NO rows, equally silently. So PIN 4 is as
 * load-bearing as PIN 1: the fix must widen the projection for a field the
 * object HAS and must refuse to widen it for one the object LACKS.
 *
 * ## `populate`, not just `select` (PIN 6)
 *
 * A `select` that fetches a bare foreign key without expanding it groups into
 * raw id buckets rather than names — better than one `(empty)` bucket, still
 * not right. It is the identical failure `plugin-list`'s `expandFields` memo
 * already records for kanban. So a lookup grouping field has to reach `$expand`
 * too, and that is a separate assertion from the `$select` one.
 *
 * ## Test-source note
 *
 * This file imports `../ObjectGrid` relatively and the root vitest config
 * aliases `@object-ui/*` to each package's `src`, so no build step stands
 * between the edit and the run — the ablation recorded in the PR body reads
 * source directly. (Same standing arrangement `projectionFls-6898.test.tsx`
 * documents; re-stated rather than cross-referenced so this file is readable
 * on its own.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import React from 'react';

/** Stable stub identity — `ObjectGrid` carries `perms` in memo dep arrays. */
const { permsStub, state } = vi.hoisted(() => {
  const state: { isLoaded: boolean; readable: string[] } = {
    isLoaded: false,
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

const OBJECT = 'duly_task';

/**
 * `business_unit` is the grouping field under test — declared, and deliberately
 * NOT a column in most cases here. `owner` is the LOOKUP one, for the
 * `populate` half. `secret_band` is declared and used for the FLS pin.
 * `ghost_field` is deliberately absent from this map: it is the unknown key
 * whose job is to be REFUSED.
 */
const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  subject: { type: 'text', label: 'Subject' },
  status: { type: 'select', label: 'Status' },
  business_unit: { type: 'text', label: 'Business Unit' },
  region: { type: 'text', label: 'Region' },
  secret_band: { type: 'text', label: 'Secret Band' },
  owner: { type: 'lookup', reference: 'sys_user', label: 'Owner' },
};

/**
 * Since objectui#10881 (ruling F) a grouped grid that fetches its own rows
 * asks for rows only over a data source that answers the group header query —
 * over a find-only one it refuses grouping and sends nothing. So this double
 * answers `queryGroupHeaders` with one group (every grouped field `'x'`), and
 * a grouped grid's projection is read off that group's row query, which
 * carries the grid's own `$select` / `$expand` exactly as the flat window did.
 */
const makeDataSource = () => ({
  find: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findOne: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
  queryGroupHeaders: vi.fn(async (_object: string, query: { groupBy?: string[] }) => [
    { ...Object.fromEntries((query.groupBy ?? []).map((field) => [field, 'x'])), count: 1 },
  ]),
});

/** Render a grid and return the params it actually asked the server for. */
const paramsFor = async (schemaExtra: Record<string, unknown>) => {
  const ds = makeDataSource();
  const schema: any = { type: 'object-grid', objectName: OBJECT, ...schemaExtra };
  render(
    <ActionProvider>
      <ObjectGrid schema={schema} dataSource={ds as never} />
    </ActionProvider>,
  );
  // Rows of THIS object: a lookup grouping key also reads the referenced
  // object, to label its groups.
  const rowCalls = () => ds.find.mock.calls.filter((c) => c[0] === OBJECT);
  await vi.waitFor(() => expect(rowCalls().length).toBeGreaterThan(0));
  const call = rowCalls().at(-1)?.[1] ?? {};
  return {
    select: (call.$select ?? []) as string[],
    expand: (call.$expand ?? []) as string[],
  };
};

const selectFor = async (schemaExtra: Record<string, unknown>) =>
  (await paramsFor(schemaExtra)).select;

const grouping = (...fields: string[]) => ({
  fields: fields.map((field) => ({ field, order: 'asc', collapsed: false })),
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default OFF, so the projection-shape pins below measure the union and not
  // the FLS gate. The FLS pin turns it on explicitly.
  state.isLoaded = false;
  state.readable = [];
});
afterEach(() => cleanup());

describe('ObjectGrid — `grouping` fields reach the projection (objectui#7179)', () => {
  // ── PIN 1: THE DEFECT ───────────────────────────────────────────────────
  it('asks the server for a grouping field that is NOT one of the columns', async () => {
    const select = await selectFor({
      columns: ['subject', 'status'],
      grouping: grouping('business_unit'),
    });
    expect(
      select,
      'the grid declared `grouping` on `business_unit` and never asked the server for it, '
        + 'so it is `undefined` on every row and every record lands in one `(empty)` group',
    ).toContain('business_unit');
  });

  it('still asks for the columns themselves — grouping widens, it never replaces', async () => {
    const select = await selectFor({
      columns: ['subject', 'status'],
      grouping: grouping('business_unit'),
    });
    expect(select).toContain('subject');
    expect(select).toContain('status');
  });

  // ── PIN 2: A UNION, NOT AN APPEND ───────────────────────────────────────
  it('does not duplicate a grouping field that is already a column', async () => {
    const select = await selectFor({
      columns: ['subject', 'business_unit'],
      grouping: grouping('business_unit'),
    });
    expect(
      select.filter((f) => f === 'business_unit'),
      'the projection must be a UNION — an append would send `business_unit` twice',
    ).toHaveLength(1);
  });

  it('leaves the projection unchanged when the grouping field is already a column', async () => {
    const withGrouping = await selectFor({
      columns: ['subject', 'business_unit'],
      grouping: grouping('business_unit'),
    });
    const withoutGrouping = await selectFor({ columns: ['subject', 'business_unit'] });
    expect([...withGrouping].sort()).toEqual([...withoutGrouping].sort());
  });

  // ── PIN 3: `fields` IS AN ARRAY — multi-level grouping ──────────────────
  it('covers every entry of a multi-level `grouping.fields[]`, not just the first', async () => {
    const select = await selectFor({
      columns: ['subject'],
      grouping: grouping('business_unit', 'region'),
    });
    expect(select).toContain('business_unit');
    expect(select, 'the key is an ARRAY — a first-entry-only read regresses nested grouping')
      .toContain('region');
  });

  // ── PIN 4: THE HAZARD — an unknown key must NOT reach the query ─────────
  it('REFUSES a grouping field the object does not declare', async () => {
    const select = await selectFor({
      columns: ['subject', 'status'],
      grouping: grouping('ghost_field'),
    });
    expect(
      select,
      'some backends answer an unknown `$select` key with an EMPTY RESULT SET rather than '
        + 'ignoring it, so an unguarded union would turn one `(empty)` group holding every row '
        + 'into NO rows — strictly worse than the bug being fixed, and equally silent',
    ).not.toContain('ghost_field');
  });

  it('still returns a usable projection when the grouping field is unknown — the list is not zeroed', async () => {
    const select = await selectFor({
      columns: ['subject', 'status'],
      grouping: grouping('ghost_field'),
    });
    // The positive half of PIN 4: refusing the unknown key must not collapse
    // the projection to nothing, which would be its own way of blanking a view.
    expect(select).toContain('subject');
    expect(select).toContain('status');
    expect(select).toContain('id');
  });

  it('keeps the KNOWN entries of a mixed grouping block and drops only the unknown one', async () => {
    const select = await selectFor({
      columns: ['subject'],
      grouping: grouping('business_unit', 'ghost_field'),
    });
    expect(select).toContain('business_unit');
    expect(select).not.toContain('ghost_field');
  });

  // ── PIN 5: FLS (objectui#6898 must stay closed) ─────────────────────────
  it('does NOT ask for a grouping field the principal cannot read', async () => {
    state.isLoaded = true;
    state.readable = ['id', 'subject', 'status', 'business_unit'];
    const select = await selectFor({
      columns: ['subject', 'status'],
      grouping: grouping('secret_band'),
    });
    expect(
      select,
      'a grouping field names a field just as capable of being denied as a column is, and the '
        + 'projection is the half that goes on the WIRE — unioning after the FLS filter reopens '
        + 'objectui#6898 through a new door',
    ).not.toContain('secret_band');
  });

  it('still asks for a readable grouping field when the gate is live', async () => {
    state.isLoaded = true;
    state.readable = ['id', 'subject', 'status', 'business_unit'];
    const select = await selectFor({
      columns: ['subject', 'status'],
      grouping: grouping('business_unit'),
    });
    expect(select, 'the gate narrows, it never empties').toContain('business_unit');
  });

  // ── PIN 6: `populate`, not just `select` ────────────────────────────────
  it('EXPANDS a lookup grouping field that is not a column', async () => {
    const { expand } = await paramsFor({
      columns: ['subject', 'status'],
      grouping: grouping('owner'),
    });
    expect(
      expand,
      'a `select` that fetches a bare FK without populating it groups into raw id buckets '
        + 'instead of names — better than one `(empty)` bucket, still the wrong answer',
    ).toContain('owner');
  });

  it('does not expand a NON-relational grouping field', async () => {
    const { expand } = await paramsFor({
      columns: ['subject'],
      grouping: grouping('business_unit'),
    });
    expect(expand).not.toContain('business_unit');
  });

  it('does not expand an UNKNOWN grouping field', async () => {
    const { expand } = await paramsFor({
      columns: ['subject'],
      grouping: grouping('ghost_field'),
    });
    expect(
      expand,
      '`buildExpandFields` returns a subset of the declared reference-bearing fields, so this '
        + 'is structural — the pin exists so a future refactor cannot make it accidental',
    ).not.toContain('ghost_field');
  });

  // ── PIN 7: THE `fields` ARM, not only the `columns` arm ─────────────────
  it('unions the grouping field into the `fields` arm too', async () => {
    const select = await selectFor({
      fields: ['subject', 'status'],
      grouping: grouping('business_unit'),
    });
    expect(
      select,
      'the projection has TWO arms and a fix landing on only one leaves the other blind — '
        + 'the exact failure mode this card was dispatched to avoid',
    ).toContain('business_unit');
  });

  // ── PIN 8: a malformed block contributes nothing, and never throws ──────
  it('is inert for a grid with no grouping at all', async () => {
    const withNoGrouping = await selectFor({ columns: ['subject', 'status'] });
    expect([...withNoGrouping].sort()).toEqual(['id', 'status', 'subject']);
  });

  it('survives a malformed `grouping` block without poisoning the projection', async () => {
    const select = await selectFor({
      columns: ['subject', 'status'],
      // Every entry here is off-spec: a bare string (the tempting shorthand
      // `GroupingFieldSchema` does NOT accept), an entry with no `field`, and a
      // non-string `field`. None may contribute a name.
      //
      // ⚠️ A `null` ENTRY IS DELIBERATELY ABSENT FROM THIS FIXTURE, and its
      // absence is a finding rather than an oversight. The harvester handles
      // `null` (pinned directly in `core`'s `grouping-fields.test.ts`, which
      // needs no grid to mount), but this component's `groupValueFormatter`
      // memo dereferences `gf.field` with no null guard, so a `null` entry
      // throws a TypeError and takes the whole grid down before any projection
      // is built. That is a pre-existing crash on `origin/main`, a different
      // defect class from this card's silent wrong answer, and it is filed
      // separately rather than ridden here.
      grouping: { fields: ['business_unit', {}, { field: 42 }] },
    });
    expect(select).toContain('subject');
    expect(select).not.toContain('42');
    expect(select).not.toContain('business_unit');
  });
});
