/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11574 — switching a server-grouped grid's grouping field paints
 * exactly the server's groups for the NEW field, at every step.
 *
 * The defect, as the card measured it in the Console: Title (10 groups) →
 * Priority showed 13 headers (9 phantom `(empty)` ones stuck on "Loading
 * grid…" beside the 4 real ones), → Status 8 (3 phantom + 5), → Priority 8
 * (4 phantom + 4), while the server's grouped query answered 4, 5, 4. A
 * reload cleared them.
 *
 * Triage ruling (comment 5973408350): the header state is keyed by the
 * grouping field and its query, so a field change discards the previous
 * field's headers and their pending row queries. Pinned here: the
 * Title → Priority → Status → Priority sequence, and an in-flight row query
 * for a discarded header that never renders.
 *
 * The double answers `queryGroupHeaders` by bucketing every stored row under
 * the compiled query's own `groupBy`, and `find` by applying the compiled row
 * query's `$filter` / `$top` / `$skip` — the two faces
 * `serverGrouping-7189.test.tsx` pins the grid consuming. A query can be HELD
 * by the test, so an answer lands exactly when the pin needs it to.
 */
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { withinBand } from './groupBandScope';
import '@testing-library/jest-dom';
import React from 'react';

import { ObjectGrid } from '../ObjectGrid';
import { ActionProvider } from '@object-ui/react';
import type { DataSource, ObjectGridSchema } from '@object-ui/types';
import { registerAllFields } from '@object-ui/fields';

beforeAll(() => {
  registerAllFields();
});

const OBJECT = 'showcase_task';

const OBJECT_FIELDS = {
  id: { type: 'text', label: 'Id' },
  title: { type: 'text', label: 'Title' },
  priority: { type: 'text', label: 'Priority' },
  status: { type: 'text', label: 'Status' },
  impact: { type: 'text', label: 'Impact' },
};

interface Task { [field: string]: string; id: string; title: string; priority: string; status: string; impact: string }

/** The card's shape: 10 titles, 4 priorities, 5 statuses. */
const TASKS: Task[] = [
  { id: 't01', title: 'Draft the brief', priority: 'high', status: 'todo', impact: 'low' },
  { id: 't02', title: 'Book the venue', priority: 'low', status: 'todo', impact: 'high' },
  { id: 't03', title: 'Review the budget', priority: 'medium', status: 'in_progress', impact: 'medium' },
  { id: 't04', title: 'Hire the caterer', priority: 'urgent', status: 'in_progress', impact: 'high' },
  { id: 't05', title: 'Print the badges', priority: 'low', status: 'review', impact: 'low' },
  { id: 't06', title: 'Test the stream', priority: 'high', status: 'review', impact: 'medium' },
  { id: 't07', title: 'Send the invites', priority: 'medium', status: 'done', impact: 'high' },
  { id: 't08', title: 'Order the swag', priority: 'urgent', status: 'done', impact: 'low' },
  { id: 't09', title: 'Brief the speakers', priority: 'high', status: 'blocked', impact: 'high' },
  { id: 't10', title: 'Close the books', priority: 'medium', status: 'blocked', impact: 'medium' },
];

/** The `FilterCondition` subset the compiled queries use: `$and`, `$eq`, `$null`, equality. */
function matches(row: Record<string, unknown>, cond: unknown): boolean {
  if (cond === undefined || cond === null) return true;
  return Object.entries(cond as Record<string, unknown>).every(([key, value]) => {
    if (key === '$and') return (value as unknown[]).every((c) => matches(row, c));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const op = value as Record<string, unknown>;
      if ('$eq' in op) return row[key] === op.$eq;
      if ('$null' in op) return op.$null ? row[key] == null : row[key] != null;
      throw new Error(`double: unsupported operator ${JSON.stringify(op)}`);
    }
    return row[key] === value;
  });
}

/** The group predicates of one row query: `[field, value]`, `null` for `$null`. */
function groupPredicatesOf(filter: unknown): Array<[string, unknown]> {
  const and = (filter as { $and?: unknown[] } | undefined)?.$and ?? [];
  return and.flatMap((c) => Object.entries(c as Record<string, unknown>).map(([field, op]) => {
    const o = op as Record<string, unknown>;
    return [field, o && typeof o === 'object' && '$null' in o ? null : (o?.$eq ?? op)] as [string, unknown];
  }));
}

interface Gate { what: string; open: () => void }

/**
 * A data source serving both compiled queries over the whole store. A query
 * the `hold` predicates accept waits on a gate the test opens.
 */
const makeServerDataSource = (rows: Task[]) => {
  const gates: Gate[] = [];
  const hold: {
    headers?: (groupBy: string[]) => boolean;
    rows?: (predicates: Array<[string, unknown]>) => boolean;
  } = {};
  const wait = (what: string) => new Promise<void>((resolve) => { gates.push({ what, open: resolve }); });
  const ds = {
    gates,
    hold,
    queryGroupHeaders: vi.fn(async (_object: string, query: { where?: unknown; groupBy?: string[] }) => {
      const groupBy = query.groupBy ?? [];
      if (hold.headers?.(groupBy)) await wait(`headers ${groupBy.join(',')}`);
      const buckets = new Map<string, number>();
      for (const row of rows.filter((r) => matches(r, query.where))) {
        const key = JSON.stringify(groupBy.map((f) => row[f] ?? null));
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
      return [...buckets.entries()].map(([key, count]) => {
        const values = JSON.parse(key) as unknown[];
        return { ...Object.fromEntries(groupBy.map((f, i) => [f, values[i]])), count };
      });
    }),
    find: vi.fn(async (_object: string, params: Record<string, unknown>) => {
      const predicates = groupPredicatesOf(params.$filter);
      if (hold.rows?.(predicates)) await wait(`rows ${JSON.stringify(predicates)}`);
      const matching = rows.filter((r) => matches(r, params.$filter));
      const skip = (params.$skip as number | undefined) ?? 0;
      const top = (params.$top as number | undefined) ?? matching.length;
      return { data: matching.slice(skip, skip + top), total: matching.length };
    }),
    findOne: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getObjectSchema: vi.fn(async () => ({ name: OBJECT, fields: OBJECT_FIELDS })),
  };
  return ds;
};
type ServerDataSource = ReturnType<typeof makeServerDataSource>;

/** Open the one held gate whose description starts with `what`. */
async function openGate(ds: ServerDataSource, what: string) {
  const i = ds.gates.findIndex((g) => g.what.startsWith(what));
  if (i < 0) throw new Error(`no held query "${what}"; held: ${ds.gates.map((g) => g.what).join(' | ')}`);
  const [gate] = ds.gates.splice(i, 1);
  await act(async () => { gate.open(); });
}

/** The server's group set for one field: its distinct values, as labels. */
const serverGroupsOf = (field: string) => [...new Set(TASKS.map((t) => String(t[field])))].sort();

const grid = (ds: ServerDataSource, field: string) => (
  <ActionProvider>
    <ObjectGrid
      schema={{
        type: 'object-grid',
        objectName: OBJECT,
        columns: ['title'],
        grouping: { fields: [{ field }] },
        pagination: { pageSize: 100 },
      } as ObjectGridSchema}
      dataSource={ds as unknown as DataSource}
    />
  </ActionProvider>
);

const groupRows = () => [...document.querySelectorAll('[data-testid^="group-row-"]')];
const headerLabels = () => groupRows().map((r) => r.querySelector('.group-label')?.textContent ?? '');
const groupRowEl = (label: string) => groupRows().find((r) => r.querySelector('.group-label')?.textContent === label);
const stuckLoading = () => document.querySelectorAll('[data-testid^="group-rows-loading-"]');

/** Every header list the grid paints, sampled on each DOM mutation. */
function recordPaintedHeaders() {
  const painted: string[][] = [];
  const observer = new MutationObserver(() => {
    const labels = headerLabels();
    if (labels.length > 0) painted.push(labels);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  return { painted, stop: () => observer.disconnect() };
}

/**
 * The grid paints exactly the server's groups for `field` — `expected` of
 * them, the card's number — and every open group's rows arrive.
 */
async function expectServerGroups(field: string, expected: number) {
  const answer = serverGroupsOf(field);
  expect(answer).toHaveLength(expected);
  await vi.waitFor(() => expect(headerLabels()).toEqual(expect.arrayContaining(answer)));
  // Exactly the server's groups: none left over from the previous field.
  expect([...headerLabels()].sort()).toEqual(answer);
  expect(headerLabels()).not.toContain('(empty)');
  // …and no group is left on "Loading grid…".
  await vi.waitFor(() => expect(stuckLoading()).toHaveLength(0));
}

afterEach(() => cleanup());

describe('switching the grouping field paints the server\'s groups for the new field (objectui#11574)', () => {
  it('Title → Priority → Status → Priority: the header count equals the server\'s groups at every step', async () => {
    const ds = makeServerDataSource(TASKS);
    const recorder = recordPaintedHeaders();
    const view = render(grid(ds, 'title'));
    await expectServerGroups('title', 10);

    for (const [field, expected] of [['priority', 4], ['status', 5], ['priority', 4]] as const) {
      // The server answers the new field's header query after the grid has
      // settled on the switch, as a network does.
      ds.hold.headers = (groupBy) => groupBy.includes(field);
      view.rerender(grid(ds, field));
      await vi.waitFor(() => expect(ds.gates.map((g) => g.what)).toContain(`headers ${field}`));
      await act(async () => {});
      ds.hold.headers = undefined;
      await openGate(ds, `headers ${field}`);
      await expectServerGroups(field, expected);
    }
    recorder.stop();

    // Never painted on the way, either: every header list the grid showed is
    // one field's whole server answer — no phantom `(empty)` header, and no
    // previous field's group read under the next field's name.
    const answers = (['title', 'priority', 'status'] as const).map((f) => JSON.stringify(serverGroupsOf(f)));
    expect(recorder.painted.length).toBeGreaterThan(0);
    for (const labels of recorder.painted) {
      expect(answers).toContain(JSON.stringify([...labels].sort()));
    }

    // No row query was asked for a group the server did not answer: every
    // group predicate names a value the server grouped by.
    for (const [, params] of ds.find.mock.calls) {
      for (const [field, value] of groupPredicatesOf(params.$filter)) {
        expect(serverGroupsOf(field)).toContain(value);
      }
    }
  });

  it('a row query in flight for a discarded header never renders, even under a new group with the same key', async () => {
    // `priority` and `impact` share one value set, so the group `high` has
    // the same composite key under both fields.
    const ds = makeServerDataSource(TASKS);
    // Held: the `high` page under either field, and the Impact header query.
    ds.hold.rows = (predicates) => predicates.some(([f, v]) => (f === 'priority' || f === 'impact') && v === 'high');
    ds.hold.headers = (groupBy) => groupBy.includes('impact');

    // Grouped by Priority, the `priority = high` page is in flight.
    const view = render(grid(ds, 'priority'));
    await vi.waitFor(() => expect([...headerLabels()].sort()).toEqual(serverGroupsOf('priority')));
    await vi.waitFor(() => expect(ds.gates.map((g) => g.what)).toContainEqual(expect.stringContaining('"priority","high"')));

    // Switch to Impact while it is in flight.
    view.rerender(grid(ds, 'impact'));

    // The discarded header's rows answer AFTER the switch…
    await openGate(ds, 'rows [["priority","high"]]');
    // …then the server answers Impact's groups.
    await openGate(ds, 'headers impact');
    await vi.waitFor(() => expect([...headerLabels()].sort()).toEqual(serverGroupsOf('impact')));

    // Impact's `high` group is still waiting on its own page: it shows
    // "Loading grid…", and none of Priority-high's rows.
    const priorityHigh = TASKS.filter((t) => t.priority === 'high' && t.impact !== 'high').map((t) => t.title);
    const impactHigh = TASKS.filter((t) => t.impact === 'high').map((t) => t.title);
    const high = () => withinBand(groupRowEl('high')!);
    for (const title of priorityHigh) expect(high().queryByText(title)).toBeNull();
    expect(withinBand(groupRowEl('high')!).querySelector('[data-testid^="group-rows-loading-"]')).not.toBeNull();

    // Its own page lands: exactly Impact-high's rows.
    await vi.waitFor(() => expect(ds.gates.map((g) => g.what)).toContainEqual(expect.stringContaining('"impact","high"')));
    await openGate(ds, 'rows [["impact","high"]]');
    for (const title of impactHigh) await vi.waitFor(() => expect(high().getByText(title)).toBeInTheDocument());
    for (const title of priorityHigh) expect(high().queryByText(title)).toBeNull();
  });
});
