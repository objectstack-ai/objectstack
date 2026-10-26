/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7216 — field-level security on the SPECULATIVE half of `$select`.
 *
 * `ListView`'s projection builder asks two different questions and, before this
 * card, asked them of two different populations:
 *
 * | field source                      | known-field gate | FLS gate |
 * |-----------------------------------|:----------------:|:--------:|
 * | `schema.columns`                  |        —         |    yes   |
 * | grouping fields (objectui#7179)   |       yes        |    yes   |
 * | view bindings via `addSpeculative`|       yes        |    NO    |
 *
 * The two gates exist for unrelated failures and neither substitutes for the
 * other. The known-field gate keeps an UNKNOWN key out, because some backends
 * (the cloud multi-tenant runtime) answer an unknown `$select` key with an
 * EMPTY result set rather than ignoring it. The FLS gate keeps a KNOWN BUT
 * DENIED key out, because sending it leaks the value at the server boundary
 * even though the UI hides it (objectui#6898). A field can be perfectly
 * well-declared and still denied; that is the case this path did not handle.
 *
 * ## Why these pins drive the bindings and not the columns
 *
 * A denied COLUMN has been dropped since objectui#6898 by
 * `rawCols.filter(c => perms.checkField(...))` a few lines above. So a pin that
 * named the denied field in `columns` would pass on the UNFIXED tree and prove
 * nothing. Every pin below therefore reaches the denied field ONLY through a
 * view binding, with the columns list holding permitted fields — that is what
 * discriminates the new gate from the old one. PIN 12 states the discriminator
 * as an assertion rather than leaving it as a convention.
 *
 * ## Ordering
 *
 * The gate goes INSIDE `addSpeculative`, AFTER the known-field intersection it
 * already performs — the ordering objectui#7179 established for the grouping
 * fields. `checkField` answers **false for an undeclared key**, so asking it
 * first would drop derived and computed columns that are not real object
 * fields. PIN 10 pins that ordering; PIN 11 pins the platform-column carve-out
 * that comes with it (`created_at` is in `knownObjectFields` but is not a
 * field any object DECLARES, so a policy never mentions it and `checkField`
 * answers false for it — a calendar bound to `created_at` must not go blank).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';

/**
 * The stub is swapped by IDENTITY when the policy answers, because that is what
 * production does: `usePermissions()` returns one identity per context value
 * and "a new context value still produces a new identity, on purpose". The
 * fetch effect carries `perms` in its dependency list, so identity is the
 * signal that rebuilds the projection (PIN 14).
 */
const { holder, makePerms } = vi.hoisted(() => {
  const makePerms = (isLoaded: boolean, readable: string[]) => ({
    isLoaded,
    checkField: (_object: string, field: string, action: string) =>
      action === 'read' ? readable.includes(field) : true,
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
  });
  return { holder: { current: makePerms(true, []) }, makePerms };
});

vi.mock('@object-ui/permissions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@object-ui/permissions')>();
  return { ...actual, usePermissions: () => holder.current as any };
});

import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';

const OBJECT = 'duly_task';

/**
 * `computed_score` is deliberately NOT declared — it is the derived column the
 * ordering trap would take down. Everything else is declared, so every pin
 * below is about a KNOWN field, which is the whole point of the card.
 */
const objectDef = {
  name: OBJECT,
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    region: { name: 'region', type: 'text', label: 'Region' },
    status: { name: 'status', type: 'select', label: 'Status' },
    priority: { name: 'priority', type: 'select', label: 'Priority' },
    industry: { name: 'industry', type: 'text', label: 'Industry' },
    salary: { name: 'salary', type: 'currency', label: 'Salary' },
    start_date: { name: 'start_date', type: 'datetime', label: 'Start' },
    end_date: { name: 'end_date', type: 'datetime', label: 'End' },
    due_date: { name: 'due_date', type: 'datetime', label: 'Due' },
    cover_image: { name: 'cover_image', type: 'text', label: 'Cover' },
  },
};

/** Everything the principal may read. Nothing else is readable. */
const READABLE = ['id', 'subject', 'region', 'end_date'];

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

const selectFor = async (schemaExtra: Record<string, unknown>) =>
  (await paramsFor(schemaExtra)).select;

/** The columns every pin declares: permitted, so `cols` is never empty. */
const COLUMNS = ['subject', 'region'];

beforeEach(() => {
  vi.clearAllMocks();
  holder.current = makePerms(true, READABLE);
});
afterEach(() => cleanup());

describe('ListView — speculative view bindings are FLS-gated (objectui#7216)', () => {
  // ── PIN 1: kanban `groupByField` ────────────────────────────────────────
  it('does not project a DENIED kanban grouping field', async () => {
    const select = await selectFor({
      columns: COLUMNS,
      kanban: { groupByField: 'industry' },
    });
    expect(
      select,
      'the kanban binding is intersected against the declared fields and then added '
        + 'unconditionally — `industry` is declared, denied, and reached `$select` anyway',
    ).not.toContain('industry');
  });

  // ── PIN 2: the live control for PIN 1 ───────────────────────────────────
  it('still projects a PERMITTED kanban grouping field', async () => {
    const select = await selectFor({
      columns: COLUMNS,
      kanban: { groupByField: 'region' },
    });
    expect(
      select,
      'a gate that dropped this too would be indistinguishable from deleting the binding arm',
    ).toContain('region');
  });

  // ── PIN 3: gantt date bindings, denied and permitted in one mounting ─────
  it('drops a denied gantt `startDateField` and keeps the permitted `endDateField`', async () => {
    const select = await selectFor({
      columns: COLUMNS,
      gantt: { startDateField: 'start_date', endDateField: 'end_date' },
    });
    expect(select).not.toContain('start_date');
    expect(
      select,
      'both bindings ride the same helper, so the pin is only meaningful if the permitted '
        + 'one survives the same call',
    ).toContain('end_date');
  });

  // ── PIN 4: timeline start binding ───────────────────────────────────────
  //
  // RE-SPELLED by objectui#6152 round 14: the fixture wrote the pre-#2231
  // `dateField`, which reached the collectors only as the core fold's
  // `startDateField`. The collectors no longer list the alias, so once that
  // fold retires the old fixture would project nothing for a reason that has
  // nothing to do with FLS. The spec key keeps the pin about the gate.
  //
  // REWRITTEN by objectui#10222 (ruling batch #223 item 5b, letter A), not
  // deleted: what it guards, the DENIED date binding, is unchanged.
  // Its fixture used to carry `metaFields: ['region']` as the permitted
  // binding beside it. That key is undeclared on the spec's timeline block and
  // the projection no longer reads it, so it can no longer be the live
  // control. It was never a discriminating one either: `region` is in
  // `COLUMNS`, so it reached `$select` through the column path whatever the
  // binding did. The permitted binding is now `endDateField: 'end_date'`,
  // which only the timeline binding can put in `$select`, the same shape PIN
  // 3 uses for gantt. That the retired key projects nothing is pinned in
  // `ListView.timelineMetaFieldsRetired-10222.test.tsx`.
  it('does not project a DENIED timeline date binding', async () => {
    const select = await selectFor({
      columns: COLUMNS,
      timeline: { startDateField: 'due_date', endDateField: 'end_date' },
    });
    expect(select).not.toContain('due_date');
    expect(
      select,
      'both bindings ride the same helper, so the pin is only meaningful if the permitted '
        + 'one survives the same call',
    ).toContain('end_date');
  });

  // ── PIN 5: calendar bindings ────────────────────────────────────────────
  it('does not project a DENIED calendar date binding', async () => {
    const select = await selectFor({
      columns: COLUMNS,
      calendar: { startDateField: 'due_date', colorField: 'region' },
    });
    expect(select).not.toContain('due_date');
    expect(select).toContain('region');
  });

  // ── PIN 6: gallery bindings ─────────────────────────────────────────────
  it('does not project a DENIED gallery cover binding', async () => {
    const select = await selectFor({
      columns: COLUMNS,
      gallery: { coverField: 'cover_image', titleField: 'subject' },
    });
    expect(select).not.toContain('cover_image');
    expect(select).toContain('subject');
  });

  // ── PIN 7: the `options.<view>` spelling is the same path ───────────────
  it('gates the nested `options.kanban` spelling too', async () => {
    const select = await selectFor({
      columns: COLUMNS,
      options: { kanban: { groupByField: 'industry', columns: ['salary'] } },
    });
    expect(select).not.toContain('industry');
    expect(
      select,
      'kanban card `columns` are collected by the same helper as the grouping binding',
    ).not.toContain('salary');
  });

  // ── PIN 8: the timeline's AUTO-ADDED status / priority badge fields ─────
  //
  // These two are not authored anywhere — the builder adds them itself for
  // every configured timeline. (It used to skip them when the block carried a
  // `metaFields` list; that undeclared key is retired and no longer read,
  // objectui#10222, ruling batch #223 item 5b, letter A.) Nothing upstream can
  // have filtered them, so this caller is the one with no other line of
  // defence at all.
  it('does not project the auto-added `status` / `priority` badges when denied', async () => {
    const select = await selectFor({
      columns: COLUMNS,
      timeline: { titleField: 'subject' },
    });
    expect(select).not.toContain('status');
    expect(select).not.toContain('priority');
  });

  // ── PIN 9: `grouping.fields[]` keeps the guard objectui#7179 gave it ────
  //
  // The gate moved from the `addGroupingField` wrapper into `addSpeculative`;
  // that wrapper's predicate was byte-identical to the one now inside the
  // helper. This pin is what makes the collapse checkable — plugin-list had no
  // FLS pin for the grouping path before this file.
  it('still gates a denied `grouping.fields[]` entry after the gate moved', async () => {
    const select = await selectFor({
      columns: COLUMNS,
      grouping: { fields: [{ field: 'industry', order: 'asc', collapsed: false }] },
    });
    expect(select).not.toContain('industry');
    expect(select).toContain('subject');
  });

  // ── PIN 10: THE ORDERING LIMIT ──────────────────────────────────────────
  it('leaves an UNDECLARED binding to the known-field gate and keeps the rest', async () => {
    const select = await selectFor({
      columns: COLUMNS,
      kanban: { groupByField: 'computed_score', columns: ['region'] },
    });
    expect(
      select,
      'the known-field gate drops it because some backends answer an unknown `$select` key '
        + 'with an empty result set',
    ).not.toContain('computed_score');
    expect(
      select,
      '`checkField` answers false for a key no policy mentions; a gate asked BEFORE the '
        + 'known-field intersection would judge the derived binding and, worse, would be the '
        + 'reason it was dropped',
    ).toContain('region');
  });

  // ── PIN 11: the platform-column carve-out ───────────────────────────────
  //
  // `created_at` is in `knownObjectFields` (the builder adds it) but no object
  // DECLARES it, so no field policy mentions it and `checkField` answers false.
  // Gating it would blank every calendar bound to a platform timestamp.
  it('keeps a platform record column bound by a view even though no policy grants it', async () => {
    const select = await selectFor({
      columns: COLUMNS,
      calendar: { startDateField: 'created_at' },
    });
    expect(
      select,
      'the platform columns are provisioned on every object and published in none, so an '
        + 'FLS answer about them is always false — the carve-out is objectui#7179\'s and is '
        + 'load-bearing, not symmetry',
    ).toContain('created_at');
  });

  // ── PIN 12: THE DISCRIMINATOR ───────────────────────────────────────────
  //
  // Proves the pins above measure the NEW gate and not objectui#6898's older
  // column gate: the same denied field is dropped from `columns` on the
  // unfixed tree, and was NOT dropped from a binding.
  it('drops a denied COLUMN through the pre-existing gate (control for the new one)', async () => {
    const select = await selectFor({ columns: [...COLUMNS, 'industry'] });
    expect(
      select,
      'objectui#6898 already filters `schema.columns`; if this ever fails the pins above '
        + 'stop discriminating the two gates',
    ).not.toContain('industry');
  });

  // ── PIN 13: deferral — an unanswered policy filters nothing ─────────────
  it('filters NOTHING while `/me/permissions` has not answered', async () => {
    holder.current = makePerms(false, []);
    const select = await selectFor({
      columns: COLUMNS,
      kanban: { groupByField: 'industry' },
    });
    expect(
      select,
      'never filter on an unanswered policy — the no-provider default is `isLoaded: false` '
        + 'forever, and a kanban with no PermissionProvider must keep grouping',
    ).toContain('industry');
  });

  // ── PIN 14: the gate is not DEAD — it must survive the async answer ─────
  //
  // `/me/permissions` resolves asynchronously, so on the first render
  // `isLoaded` is false and the gate defers. If the fetch effect stops
  // depending on `perms`, nothing rebuilds the projection and this gate never
  // runs on the only fetch most lists make. 9 of 10 pins passed on exactly
  // such a dead gate in objectui#6898; this is the one that would not.
  it('re-projects once the policy answers — the gate is not dead on the first fetch', async () => {
    holder.current = makePerms(false, []);
    const ds = makeDataSource();
    const schema: any = {
      type: 'list-view',
      objectName: OBJECT,
      viewType: 'grid',
      columns: COLUMNS,
      kanban: { groupByField: 'industry' },
    };
    const { rerender } = render(
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={schema} dataSource={ds} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => expect(ds.find).toHaveBeenCalled());
    expect(
      (ds.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[],
      'baseline: while unanswered the denied binding is still requested',
    ).toContain('industry');

    // The policy answers — a NEW context value, hence a new identity.
    holder.current = makePerms(true, READABLE);
    rerender(
      <SchemaRendererProvider dataSource={ds}>
        <ListView schema={schema} dataSource={ds} />
      </SchemaRendererProvider>,
    );
    await waitFor(() => {
      const latest = (ds.find.mock.calls.at(-1)?.[1]?.$select ?? []) as string[];
      expect(
        latest,
        'the projection was never rebuilt after the policy answered — `perms` is missing '
          + 'from the fetch effect deps and this gate is dead in practice',
      ).not.toContain('industry');
    });
  });
});
