/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7179 — the SECOND projection build site.
 *
 * The card was dispatched on the assumption that `$select` is assembled in ONE
 * place. It is assembled in two, and they are independent: `ObjectGrid` builds
 * its own when it fetches for itself, and `ListView` builds one when it fetches
 * and hands the rows down to the grid. `plugin-grid`'s
 * `groupingProjection-7179.test.tsx` pins the first. This pins the second, and
 * the two files exist separately because a fix landing on only one of them is
 * the specific failure mode this card was dispatched to avoid — a grid that
 * groups correctly on one mounting path and shows one `(empty)` bucket on the
 * other.
 *
 * This builder had an arm for every OTHER view kind's grouping already:
 * `collectViewFields` reads `groupByField` for kanban, gantt and timeline. The
 * grid was the only projection-blind path of the four because it spells the
 * same intent differently — `grouping.fields[]`, an array of objects — so it
 * matched none of the candidate keys.
 *
 * Both halves of the query are pinned here, because `$select` alone is not the
 * whole fix: this builder's `expandFields` memo carries a comment recording the
 * exact failure a `select` without a `populate` produces for a lookup ("list
 * view shows 'Initech Solutions' but kanban used to show '8UY9zHWBfjYjYor4'"),
 * and a grid grouped by a lookup would land in it.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { ListView } from '../ListView';
import { SchemaRendererProvider } from '@object-ui/react';

const OBJECT = 'duly_task';

/**
 * `ghost_field` is deliberately absent: it is the unknown key whose job is to
 * be refused. `owner` is the lookup, for the `populate` half.
 */
const objectDef = {
  name: OBJECT,
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' },
    subject: { name: 'subject', type: 'text', label: 'Subject' },
    status: { name: 'status', type: 'select', label: 'Status' },
    business_unit: { name: 'business_unit', type: 'text', label: 'Business Unit' },
    region: { name: 'region', type: 'text', label: 'Region' },
    owner: { name: 'owner', type: 'lookup', reference: 'sys_user', label: 'Owner' },
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

const selectFor = async (schemaExtra: Record<string, unknown>) =>
  (await paramsFor(schemaExtra)).select;

const grouping = (...fields: string[]) => ({
  fields: fields.map((field) => ({ field, order: 'asc', collapsed: false })),
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('ListView — `grouping` fields reach the projection (objectui#7179)', () => {
  // ── PIN 1: THE DEFECT, on the second build site ─────────────────────────
  it('asks the server for a grouping field that is NOT one of the columns', async () => {
    const select = await selectFor({
      columns: ['subject', 'status'],
      grouping: grouping('business_unit'),
    });
    expect(
      select,
      'this builder already unions `groupByField` for kanban / gantt / timeline; the grid '
        + 'spells the same intent as `grouping.fields[]` and matched none of the candidate keys',
    ).toContain('business_unit');
  });

  it('still asks for the columns themselves', async () => {
    const select = await selectFor({
      columns: ['subject', 'status'],
      grouping: grouping('business_unit'),
    });
    expect(select).toContain('subject');
    expect(select).toContain('status');
  });

  // ── PIN 2: the `groupBy` shorthand the view designer writes ─────────────
  it('covers the `groupBy` shorthand, which normalizes into the same block', async () => {
    const select = await selectFor({ columns: ['subject'], groupBy: 'business_unit' });
    expect(
      select,
      '`groupBy` / `groupBy2` are what the visual view editor writes; they are normalized into '
        + 'a GroupingConfig before render, so the projection must follow the normalized value '
        + 'rather than the authored key',
    ).toContain('business_unit');
  });

  it('covers the second level of the `groupBy2` shorthand too', async () => {
    const select = await selectFor({
      columns: ['subject'],
      groupBy: 'business_unit',
      groupBy2: 'region',
    });
    expect(select).toContain('business_unit');
    expect(select).toContain('region');
  });

  // ── PIN 3: A UNION, NOT AN APPEND ───────────────────────────────────────
  it('does not duplicate a grouping field that is already a column', async () => {
    const select = await selectFor({
      columns: ['subject', 'business_unit'],
      grouping: grouping('business_unit'),
    });
    expect(select.filter((f) => f === 'business_unit')).toHaveLength(1);
  });

  it('leaves the projection unchanged when the grouping field is already a column', async () => {
    const withGrouping = await selectFor({
      columns: ['subject', 'business_unit'],
      grouping: grouping('business_unit'),
    });
    const withoutGrouping = await selectFor({ columns: ['subject', 'business_unit'] });
    expect([...withGrouping].sort()).toEqual([...withoutGrouping].sort());
  });

  // ── PIN 4: THE HAZARD — an unknown key must NOT zero the list ───────────
  it('REFUSES a grouping field the object does not declare', async () => {
    const select = await selectFor({
      columns: ['subject', 'status'],
      grouping: grouping('ghost_field'),
    });
    expect(
      select,
      'this builder states the reason in terms: "some backends reject unknown select keys with '
        + 'an empty result set rather than ignoring them ... a single unknown column in $select '
        + 'silently zeroes the whole list"',
    ).not.toContain('ghost_field');
  });

  it('still returns a usable projection when the grouping field is unknown', async () => {
    const select = await selectFor({
      columns: ['subject', 'status'],
      grouping: grouping('ghost_field'),
    });
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

  // ── PIN 5: `populate`, not just `select` ────────────────────────────────
  it('EXPANDS a lookup grouping field that is not a column', async () => {
    const { expand } = await paramsFor({
      columns: ['subject', 'status'],
      grouping: grouping('owner'),
    });
    expect(
      expand,
      'without this the server returns the bare FK and the grid buckets by raw id instead of '
        + 'by name — the failure this memo already records for kanban',
    ).toContain('owner');
  });

  it('does not expand an unknown grouping field', async () => {
    const { expand } = await paramsFor({
      columns: ['subject'],
      grouping: grouping('ghost_field'),
    });
    expect(expand).not.toContain('ghost_field');
  });

  // ── PIN 6: inert without grouping ───────────────────────────────────────
  it('leaves a grid with no grouping exactly as it was', async () => {
    const select = await selectFor({ columns: ['subject', 'status'] });
    expect([...select].sort()).toEqual(['id', 'status', 'subject']);
  });
});
